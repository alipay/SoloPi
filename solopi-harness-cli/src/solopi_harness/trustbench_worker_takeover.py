"""Offline fault injection for managed Worker lease takeover."""

from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
from pathlib import Path
from typing import Any, Dict, Mapping

from .managed_execution import ManagedExecutionError, ManagedExecutionStore


SCHEMA = "solopi.trustbench.worker-takeover/v0"
OLD_DIGEST = hashlib.sha256(b"expired-worker-evidence").hexdigest()
NEW_DIGEST = hashlib.sha256(b"successor-worker-evidence").hexdigest()
OLD_OUTCOME = hashlib.sha256(b"expired-worker-outcome").hexdigest()
NEW_OUTCOME = hashlib.sha256(b"successor-worker-outcome").hexdigest()


def evaluate(snapshot: Mapping[str, Any]) -> Dict[str, Any]:
    """Score persisted state, not just API return values."""
    old = snapshot.get("oldAssignment") or {}
    new = snapshot.get("newAssignment") or {}
    report = snapshot.get("report") or {}
    shards = report.get("shards") or []
    attempts = (shards[0].get("attempts") or []) if len(shards) == 1 else []
    old_attempt = attempts[0] if len(attempts) == 2 else {}
    new_attempt = attempts[1] if len(attempts) == 2 else {}
    events = snapshot.get("events") or []
    types = [event.get("type") for event in events]
    old_events = [event for event in events if event.get("attemptId") == old.get("attemptId")]
    new_events = [event for event in events if event.get("attemptId") == new.get("attemptId")]
    checks = {
        "expired_requeued": snapshot.get("recovery") == {"requeued": 1, "terminated": 0},
        "successor_fenced": (
            old.get("taskId") == new.get("taskId") == report.get("taskId")
            and old.get("shardId") == new.get("shardId")
            and old.get("deviceId") == new.get("deviceId")
            and old.get("attemptId") != new.get("attemptId")
            and old.get("leaseId") != new.get("leaseId")
            and isinstance(old.get("ownerGeneration"), int)
            and new.get("ownerGeneration") == old["ownerGeneration"] + 1
            and new.get("attemptNumber") == old.get("attemptNumber", 0) + 1
        ),
        "old_writes_rejected": snapshot.get("oldWriteCodes") == {
            "heartbeat": "stale_assignment",
            "complete": "stale_assignment",
            "fail": "stale_assignment",
        },
        "old_history_retained": (
            len(attempts) == 2
            and old_attempt.get("attemptId") == old.get("attemptId")
            and old_attempt.get("workerId") == "worker-old"
            and old_attempt.get("ownerGeneration") == old.get("ownerGeneration")
            and old_attempt.get("status") == "expired"
            and old_attempt.get("failureCategory") == "lease_expired"
            and old_attempt.get("verificationOutcomeFingerprint") is None
            and old_attempt.get("evidenceDigest") is None
            and old_attempt.get("reportPath") is None
            and old_attempt.get("finishedAt") == 1020
        ),
        "successor_result_only": (
            report.get("status") == "passed"
            and report.get("terminal") is True
            and report.get("exitCode") == 0
            and len(shards) == 1
            and shards[0].get("status") == "passed"
            and new_attempt.get("attemptId") == new.get("attemptId")
            and new_attempt.get("workerId") == "worker-new"
            and new_attempt.get("ownerGeneration") == new.get("ownerGeneration")
            and new_attempt.get("status") == "passed"
            and new_attempt.get("verificationOutcomeFingerprint") == NEW_OUTCOME
            and new_attempt.get("evidenceDigest") == NEW_DIGEST
            and new_attempt.get("reportPath") is None
            and snapshot.get("taskStatus") == "passed"
            and OLD_OUTCOME not in json.dumps(report)
            and OLD_DIGEST not in json.dumps(report)
        ),
        "event_lineage": (
            report.get("eventCount") == len(events)
            and [event.get("taskSequence") for event in events] == list(range(1, len(events) + 1))
            and types.count("lease_expired") == 1
            and types.count("assignment_claimed") == 2
            and types.count("attempt_completed") == 1
            and any(event.get("type") == "lease_expired" for event in old_events)
            and not any(event.get("type") == "attempt_completed" for event in old_events)
            and any(event.get("type") == "attempt_completed"
                    and event.get("content", {}).get("evidenceDigest") == NEW_DIGEST
                    for event in new_events)
        ),
    }
    return {"status": "passed" if all(checks.values()) else "failed", "checks": checks}


def _rejection_code(operation) -> str:
    try:
        operation()
    except ManagedExecutionError as exc:
        return exc.code
    return "accepted"


def run_probe() -> Dict[str, Any]:
    result: Dict[str, Any] = {"schemaVersion": SCHEMA, "status": "infra_error"}
    try:
        with tempfile.TemporaryDirectory(prefix="trustbench-worker-") as directory:
            store = ManagedExecutionStore(Path(directory) / "managed.sqlite")
            store.register_device("probe-device", "PROBE-SERIAL", "android", 35,
                                  ["verification"], {}, now_ms=1)
            task = store.submit_task(
                plan={"schemaVersion": "solopi.ai.verification-plan/v1",
                      "planFingerprint": hashlib.sha256(b"worker-takeover-plan").hexdigest()},
                matrix=[{"id": "main", "selector": {"platform": "android"}}],
                idempotency_key="trustbench-worker-takeover",
                owner_token="trustbench-owner-token-1234567890",
                max_retries=1, lease_duration_ms=1000, now_ms=10,
            )
            old = store.claim_next("worker-old", now_ms=20)
            if old is None:
                raise RuntimeError("old Worker could not claim the task")
            store.start_attempt(old, now_ms=21)
            recovery = store.recover_expired(now_ms=1020)
            new = store.claim_next("worker-new", now_ms=2020)
            if new is None:
                raise RuntimeError("new Worker could not claim the requeued task")
            store.start_attempt(new, now_ms=2021)
            old_codes = {
                "heartbeat": _rejection_code(lambda: store.heartbeat(old, now_ms=2022)),
                "complete": _rejection_code(lambda: store.complete_assignment(
                    old, "passed", report={"outcomeFingerprint": OLD_OUTCOME},
                    evidence_digest=OLD_DIGEST, now_ms=2022)),
                "fail": _rejection_code(lambda: store.fail_assignment(
                    old, "late_worker_failure", retryable=False, now_ms=2022)),
            }
            store.complete_assignment(
                new, "passed", report={"outcomeFingerprint": NEW_OUTCOME},
                evidence_digest=NEW_DIGEST, now_ms=2030,
            )
            snapshot = {
                "oldAssignment": {key: old[key] for key in ("taskId", "shardId", "attemptId",
                                  "attemptNumber", "deviceId", "leaseId", "ownerGeneration")},
                "newAssignment": {key: new[key] for key in ("taskId", "shardId", "attemptId",
                                  "attemptNumber", "deviceId", "leaseId", "ownerGeneration")},
                "recovery": recovery,
                "oldWriteCodes": old_codes,
                "taskStatus": store.task_status(task["taskId"])["status"],
                "report": store.task_report(task["taskId"]),
                "events": store.task_events(task["taskId"]),
            }
            result.update(evaluate(snapshot))
            result["snapshot"] = snapshot
    except Exception as exc:
        result["status"] = "infra_error"
        result["error"] = "%s: %s" % (type(exc).__name__, exc)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="TrustBench offline Worker takeover probe")
    parser.add_argument("--artifacts", required=True, type=Path,
                        help="new directory for the probe result")
    args = parser.parse_args()
    args.artifacts.mkdir(parents=True, exist_ok=False)
    result = run_probe()
    target = args.artifacts / "result.json"
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "result": str(target.resolve())}))
    return 0 if result["status"] == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
