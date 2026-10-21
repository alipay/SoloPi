"""Fail-closed ledger for frozen TrustBench Notes Agent attempts."""

import argparse
import hashlib
import json
import subprocess
import tarfile
from pathlib import Path

from .trustbench import TrustBenchError, audit_evidence_bundle
from .trustbench_notes_storage import FROZEN_TASKS
from . import verification_engine


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise TrustBenchError("cannot read %s: %s" % (path, error)) from error


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class RunSource:
    def __init__(self, run_dir, archive=None):
        self.run_dir = run_dir
        self.archive = archive
        self.contents = {}
        self.file_stats = None
        if archive is not None:
            self._read_archive()

    def _read_archive(self):
        archive = self.archive
        process = None
        if archive.suffix == ".zst":
            process = subprocess.Popen(["zstd", "-q", "-dc", str(archive)],
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            source = process.stdout
            mode = "r|"
        elif archive.suffix == ".gz":
            source = None
            mode = "r|gz"
        else:
            raise TrustBenchError("unsupported archive format: %s" % archive)
        stats = {}
        wanted = {"report.json", "plan.json", "storage-readback.json"}
        try:
            with tarfile.open(name=archive if source is None else None,
                              fileobj=source, mode=mode) as stream:
                for member in stream:
                    path = Path(member.name)
                    if "__MACOSX" in path.parts or any(part.startswith("._") for part in path.parts):
                        continue
                    if (path.is_absolute() or ".." in path.parts or not path.parts or
                            path.parts[0] != self.run_dir.name):
                        raise TrustBenchError("archive member escapes run: %s" % member.name)
                    if member.isdir():
                        continue
                    if not member.isfile():
                        raise TrustBenchError("archive has non-regular member: %s" % member.name)
                    relative = Path(*path.parts[1:])
                    key = str(relative)
                    stat_key = str((self.run_dir / relative).resolve())
                    if not key or stat_key in stats:
                        raise TrustBenchError("duplicate archive member: %s" % member.name)
                    artifact = stream.extractfile(member)
                    if artifact is None:
                        raise TrustBenchError("unreadable archive member: %s" % member.name)
                    hasher = hashlib.sha256()
                    total = 0
                    chunks = [] if (key in wanted or key.endswith("/agent-transcript.json")) else None
                    for chunk in iter(lambda: artifact.read(1024 * 1024), b""):
                        hasher.update(chunk)
                        total += len(chunk)
                        if chunks is not None:
                            if total > 10 * 1024 * 1024:
                                raise TrustBenchError("oversized JSON artifact: %s" % member.name)
                            chunks.append(chunk)
                    if total != member.size:
                        raise TrustBenchError("archive member size mismatch: %s" % member.name)
                    stats[stat_key] = (total, hasher.hexdigest())
                    if chunks is not None:
                        self.contents[key] = b"".join(chunks)
            if process is not None:
                process.stdout.close()
                stderr = process.stderr.read()
                code = process.wait()
                process.stderr.close()
                if code:
                    raise TrustBenchError("archive decompression failed: %s (%s)" %
                                          (archive, stderr.decode("utf-8", "replace")[:120]))
        except (OSError, tarfile.TarError) as error:
            raise TrustBenchError("cannot read archive %s: %s" % (archive, error)) from error
        finally:
            if process is not None and process.poll() is None:
                process.terminate()
                process.stdout.close()
                process.communicate()
        self.file_stats = stats

    def read_json(self, relative):
        if self.archive is None:
            return read_json(self.run_dir / relative)
        try:
            return json.loads(self.contents[str(relative)])
        except (KeyError, ValueError) as error:
            raise TrustBenchError("missing or invalid archived JSON: %s" % relative) from error

    def sha256(self, relative):
        if self.archive is None:
            return digest(self.run_dir / relative)
        key = str((self.run_dir / relative).resolve())
        if key not in self.file_stats:
            raise TrustBenchError("missing archived file: %s" % relative)
        return self.file_stats[key][1]


def evaluate_attempt(run_dir, track, model_id=None, archive=None):
    if track not in {"control", "model"}:
        raise TrustBenchError("track must be control or model")
    source = RunSource(run_dir, archive)
    report, plan = source.read_json("report.json"), source.read_json("plan.json")
    task = FROZEN_TASKS.get(plan.get("planFingerprint"))
    if not task or plan.get("sourceFingerprint") != task["sourceFingerprint"]:
        raise TrustBenchError("run is not a frozen Notes task: %s" % run_dir)
    if report.get("planFingerprint") != plan["planFingerprint"]:
        raise TrustBenchError("report plan fingerprint mismatch: %s" % run_dir)
    if report.get("schemaVersion") != verification_engine.REPORT_SCHEMA:
        raise TrustBenchError("unsupported report schema")
    scenarios = report.get("scenarios", [])
    if len(scenarios) != 1 or scenarios[0].get("scenarioId") != task["scenarioId"]:
        raise TrustBenchError("unexpected scenario: %s" % run_dir)
    outcome_contract = {
        "planFingerprint": plan["planFingerprint"],
        "status": report.get("status"),
        "scenarios": [{
            "scenarioId": item["scenarioId"],
            "status": item.get("status"),
            "failureCategory": item["failure"].get("category")
            if isinstance(item.get("failure"), dict) else None,
            "checkpoints": [{"checkpointId": cp["checkpointId"], "status": cp.get("status"),
                             "reason": cp.get("reason")}
                            for cp in item["checkpoints"]],
            "cleanup": item["cleanup"].get("status"),
        } for item in scenarios],
    }
    if report.get("outcomeFingerprint") != verification_engine.canonical_fingerprint(outcome_contract):
        raise TrustBenchError("report outcome fingerprint mismatch")
    audit = audit_evidence_bundle(report, run_dir, source.file_stats)
    scenario = scenarios[0]
    dynamic = [s for s in scenario.get("segments", []) if s.get("route") == "dynamic"]
    planned_dynamic = [s for s in plan["intent"]["scenarios"][0]["segments"]
                       if s.get("route") == "dynamic"]
    if [s.get("segmentId") for s in dynamic] != [s["segmentId"] for s in planned_dynamic[:len(dynamic)]]:
        raise TrustBenchError("dynamic segments differ from frozen plan")
    receipts = []
    actions = 0
    transcript_hashes = {}
    action_error_code = None
    for segment in dynamic:
        transcript_path = Path("segments") / segment["segmentId"] / "agent-transcript.json"
        transcript = source.read_json(transcript_path)
        transcript_hashes[segment["segmentId"]] = source.sha256(transcript_path)
        segment_receipts = []
        for event in transcript.get("events", []):
            if event.get("type") == "act":
                actions += 1
                result = event.get("result")
                if isinstance(result, dict) and isinstance(result.get("receipt"), dict):
                    receipt_status = result["receipt"].get("status")
                    if receipt_status in {"failed", "rejected"}:
                        action_error_code = result["receipt"].get("errorCode")
            receipt = event.get("decision", {}).get("modelReceipt")
            if receipt is not None:
                receipts.append(receipt)
                segment_receipts.append(receipt)
        if track == "model" and segment.get("state") == "done" and not segment_receipts:
            raise TrustBenchError("completed model segment lacks decision receipts")
    if track == "model":
        if not model_id or (dynamic and not receipts and scenario.get("status") == "passed"):
            raise TrustBenchError("model identity or decision receipts missing")
        if any(not isinstance(receipt, dict) for receipt in receipts):
            raise TrustBenchError("invalid model decision receipt")
        if any(r.get("modelId") != model_id or not r.get("requestId") or
               r.get("fallbackUsed") is not False for r in receipts):
            raise TrustBenchError("model identity, request ID, or fallback mismatch")
        for receipt in receipts:
            budget = receipt.get("maxOutputTokens")
            if budget is not None and (isinstance(budget, bool) or
                    not isinstance(budget, int) or budget < 1):
                raise TrustBenchError("invalid model output token budget")
        recorded_budgets = {r.get("maxOutputTokens") for r in receipts}
        if len(recorded_budgets) > 1:
            raise TrustBenchError("mixed or missing model output budgets in one attempt")
        model_output_tokens = next(iter(recorded_budgets), None)
    elif receipts:
        raise TrustBenchError("control run contains model receipts")
    else:
        model_output_tokens = None

    status = scenario.get("status")
    if report.get("status") != status:
        raise TrustBenchError("report and scenario status mismatch")
    checkpoints = {item.get("checkpointId"): item for item in scenario.get("checkpoints", [])}
    storage_sha = None
    device_serial = None
    apk_sha = None
    if status == "passed":
        if (len(dynamic) != len(planned_dynamic) or not dynamic or
                any(s.get("state") != "done" or not s.get("agentDone") for s in dynamic)):
            raise TrustBenchError("passed run lacks Agent done")
        if (len(checkpoints) != len(scenario.get("checkpoints", [])) or
                set(checkpoints) != {"list-is-empty", *task["uiExpected"]}):
            raise TrustBenchError("checkpoint set mismatch")
        if (any(item.get("status") != "passed" for item in checkpoints.values()) or
                any(checkpoints[checkpoint].get("actual") != expected
                    for checkpoint, expected in task["uiExpected"].items())):
            raise TrustBenchError("passed report has mismatched UI checkpoint")
        receipt = source.read_json("storage-readback.json")
        device_serial = receipt.get("serial")
        apk_sha = receipt.get("apkSha256")
        if (receipt.get("status") == "failed" and
                receipt.get("reason") == "persisted_values_mismatch" and
                receipt.get("runId") == run_dir.name):
            outcome = "evidence_invalid"
            storage_sha = source.sha256("storage-readback.json")
        elif (receipt.get("status") != "passed" or
                receipt.get("runId") != run_dir.name or
                receipt.get("planFingerprint") != plan["planFingerprint"] or
                receipt.get("observed") != task["expected"] or
                not receipt.get("apkSha256") or not receipt.get("serial")):
            raise TrustBenchError("missing or mismatched storage receipt")
        else:
            storage_sha = source.sha256("storage-readback.json")
            outcome = "passed"
    elif status == "not_tested":
        outcome = ("provider_not_tested" if any(s.get("reason") == "model_decision_failed"
                                                 for s in dynamic) else "not_tested")
    elif status == "failed" and not dynamic and checkpoints.get("list-is-empty", {}).get("status") == "failed":
        outcome = "setup_failed"
    elif status == "failed":
        outcome = "task_failed"
    else:
        raise TrustBenchError("unsupported report status")
    intent = plan.get("intent", {})
    task_id = intent.get("requirement", {}).get("id")
    budgets = [step.get("budget") for item in intent.get("scenarios", [])
               for step in item.get("steps", []) if step.get("type") == "explore"]
    return {
        "runId": run_dir.name,
        "track": track,
        "modelId": model_id if track == "model" else None,
        "modelMaxOutputTokens": model_output_tokens,
        "planFingerprint": plan["planFingerprint"],
        "taskId": task_id,
        "agentBudget": budgets[0] if len(budgets) == 1 else None,
        "reportId": report.get("reportId"),
        "outcome": outcome,
        "failureReason": next((s["reason"] for s in dynamic if s.get("reason")), None) if status != "passed" else None,
        "actionErrorCode": action_error_code,
        "agentDone": any(s.get("agentDone") for s in dynamic),
        "actions": actions,
        "modelDecisionCount": len(receipts),
        "startedAt": report.get("startedAt"),
        "finishedAt": report.get("finishedAt"),
        "evidenceAudit": audit,
        "reportSha256": source.sha256("report.json"),
        "planSha256": source.sha256("plan.json"),
        "eventsSha256": source.sha256("events.jsonl"),
        "transcriptSha256": next(iter(transcript_hashes.values())) if len(transcript_hashes) == 1 else None,
        "transcriptSha256s": transcript_hashes,
        "storageReceiptSha256": storage_sha,
        "deviceSerial": device_serial,
        "apkSha256": apk_sha,
        "source": "archive" if archive else "directory",
    }


def evaluate_manifest(manifest_path):
    manifest = read_json(manifest_path)
    if manifest.get("schemaVersion") != "solopi.trustbench.agent-ledger-manifest/v1":
        raise TrustBenchError("unsupported manifest schema")
    attempts = manifest.get("attempts")
    if not isinstance(attempts, list) or not attempts:
        raise TrustBenchError("manifest needs attempts")
    rows = []
    seen = set()
    for item in attempts:
        if not isinstance(item, dict) or not isinstance(item.get("runDir"), str):
            raise TrustBenchError("invalid attempt entry")
        run_dir = Path(item["runDir"]).resolve()
        archive = item.get("archive")
        if archive is not None:
            if not isinstance(archive, str) or not archive:
                raise TrustBenchError("invalid archive path")
            archive = Path(archive).resolve()
            if not archive.is_file() or not archive.name.startswith(run_dir.name + ".tar."):
                raise TrustBenchError("archive does not match run directory")
        if run_dir in seen:
            raise TrustBenchError("duplicate run directory")
        seen.add(run_dir)
        rows.append(evaluate_attempt(run_dir, item.get("track"), item.get("modelId"), archive))
    counts = {status: sum(row["outcome"] == status for row in rows)
              for status in ("passed", "setup_failed", "provider_not_tested", "not_tested",
                             "task_failed", "evidence_invalid")}
    by_track = {track: {status: sum(row["track"] == track and row["outcome"] == status
                                   for row in rows) for status in counts}
                for track in ("control", "model")}
    policy_groups = {}
    for row in rows:
        key = (row["track"], row["planFingerprint"], row["modelId"],
               row["modelMaxOutputTokens"], row["deviceSerial"], row["apkSha256"])
        group = policy_groups.setdefault(key, {"track": row["track"],
            "planFingerprint": row["planFingerprint"], "modelId": row["modelId"],
            "modelMaxOutputTokens": row["modelMaxOutputTokens"],
            "deviceSerial": row["deviceSerial"], "apkSha256": row["apkSha256"],
            "attempts": 0, "counts": {status: 0 for status in counts}, "runIds": []})
        group["attempts"] += 1
        group["counts"][row["outcome"]] += 1
        group["runIds"].append(row["runId"])
    return {"schemaVersion": "solopi.trustbench.agent-ledger/v1",
            "attempts": rows, "rawCounts": counts, "countsByTrack": by_track,
            "policyGroups": list(policy_groups.values()),
            "eligibleForReliabilityEstimate": False,
            "limitations": ["limited trials on two devices", "small task set",
                            "storage receipt is local fixture truth"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = evaluate_manifest(args.manifest)
    except TrustBenchError as error:
        parser.error(str(error))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
