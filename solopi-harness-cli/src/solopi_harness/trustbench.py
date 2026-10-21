"""Validate a frozen TrustBench pilot suite and score a real verification report."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from . import verification_engine


SUITE_SCHEMA = "solopi.trustbench.suite/v0"
ALLOWED_STATUSES = {"passed", "failed", "not_tested"}
CHECKPOINT_STATUS_BY_DIMENSION = {
    "task_success": "passed",
    "false_pass_rejection": "failed",
    "false_done_rejection": "failed",
    "unknown_preservation": "not_tested",
    "cleanup_verification": "passed",
}


class TrustBenchError(ValueError):
    pass


def _object(value: Any, label: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise TrustBenchError("%s must be an object" % label)
    return value


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        return _object(json.loads(path.read_text(encoding="utf-8")), str(path))
    except (OSError, json.JSONDecodeError) as exc:
        raise TrustBenchError("cannot read %s: %s" % (path, exc)) from exc


def _frozen_file(repo_root: Path, entry: Any, label: str) -> Dict[str, Any]:
    source = _object(entry, label)
    relative = source.get("path")
    digest = source.get("sha256")
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        raise TrustBenchError("%s.path must be a repository-relative path" % label)
    if not isinstance(digest, str) or len(digest) != 64:
        raise TrustBenchError("%s.sha256 must be a SHA-256 digest" % label)
    target = (repo_root / relative).resolve()
    if not target.is_relative_to(repo_root.resolve()):
        raise TrustBenchError("%s.path escapes the repository" % label)
    try:
        actual = hashlib.sha256(target.read_bytes()).hexdigest()
    except OSError as exc:
        raise TrustBenchError("cannot read %s: %s" % (target, exc)) from exc
    if actual != digest:
        raise TrustBenchError("%s digest mismatch: %s" % (label, relative))
    return _read_json(target)


def validate_suite(suite_path: Path, repo_root: Path) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    suite = _read_json(suite_path)
    if suite.get("schemaVersion") != SUITE_SCHEMA:
        raise TrustBenchError("unsupported suite schema")
    requirement = _frozen_file(repo_root, suite.get("requirement"), "requirement")
    decisions = _frozen_file(repo_root, suite.get("decisions"), "decisions")
    if requirement.get("targetAppPackage") != suite.get("targetAppPackage"):
        raise TrustBenchError("target app does not match requirement")
    try:
        plan = verification_engine.compile_verification_plan(requirement)
    except verification_engine.VerificationError as exc:
        raise TrustBenchError("invalid requirement: %s" % exc) from exc
    scenarios = {item["id"]: item for item in plan["intent"]["scenarios"]}
    probes = suite.get("probes")
    if not isinstance(probes, list) or not probes:
        raise TrustBenchError("suite requires probes")
    seen_ids = set()
    seen_scenarios = set()
    for probe in probes:
        item = _object(probe, "probe")
        probe_id = item.get("id")
        scenario_id = item.get("scenarioId")
        if not isinstance(probe_id, str) or not probe_id or probe_id in seen_ids:
            raise TrustBenchError("probe IDs must be unique and nonempty")
        if scenario_id not in scenarios or scenario_id in seen_scenarios:
            raise TrustBenchError("probe scenario is missing or repeated: %s" % scenario_id)
        if item.get("expectedStatus") not in ALLOWED_STATUSES:
            raise TrustBenchError("unsupported expected status: %s" % probe_id)
        if item.get("dimension") not in CHECKPOINT_STATUS_BY_DIMENSION:
            raise TrustBenchError("unsupported probe dimension: %s" % probe_id)
        category = item.get("expectedFailureCategory")
        if item["expectedStatus"] == "passed" and category is not None:
            raise TrustBenchError("passed probe cannot expect a failure category")
        if item["expectedStatus"] != "passed" and not isinstance(category, str):
            raise TrustBenchError("non-passed probe needs a failure category")
        seen_ids.add(probe_id)
        seen_scenarios.add(scenario_id)
    if seen_scenarios != set(scenarios):
        raise TrustBenchError("suite probes do not cover every compiled scenario")
    for scenario_id, steps in decisions.items():
        if scenario_id not in scenarios or not isinstance(steps, dict):
            raise TrustBenchError("decisions contain unknown scenario: %s" % scenario_id)
        dynamic_ids = {
            segment["dynamicStep"]["id"]
            for segment in scenarios[scenario_id]["segments"]
            if segment["route"] == "dynamic"
        }
        if not set(steps).issubset(dynamic_ids):
            raise TrustBenchError("decisions contain unknown dynamic step: %s" % scenario_id)
        if any(not isinstance(value, list) for value in steps.values()):
            raise TrustBenchError("dynamic decisions must be lists: %s" % scenario_id)
    return suite, plan


def score_report(suite: Dict[str, Any], plan: Dict[str, Any], report: Any) -> Dict[str, Any]:
    source = _object(report, "report")
    if source.get("schemaVersion") != verification_engine.REPORT_SCHEMA:
        raise TrustBenchError("unsupported report schema")
    if source.get("planFingerprint") != plan["planFingerprint"]:
        raise TrustBenchError("report belongs to another plan")
    evidence = source.get("evidence")
    if not isinstance(evidence, list) or not all(isinstance(e, dict) for e in evidence):
        raise TrustBenchError("report evidence must be a list of objects")
    evidence_ids = {item.get("id") for item in evidence}
    if None in evidence_ids or len(evidence_ids) != len(evidence):
        raise TrustBenchError("report has missing or duplicate evidence IDs")
    if not isinstance(source.get("reportId"), str) or not source["reportId"]:
        raise TrustBenchError("report ID is missing")
    scenarios = source.get("scenarios")
    if not isinstance(scenarios, list) or not all(isinstance(s, dict) for s in scenarios):
        raise TrustBenchError("report scenarios must be a list of objects")
    by_id = {item.get("scenarioId"): item for item in scenarios}
    if len(by_id) != len(scenarios):
        raise TrustBenchError("report has duplicate scenario IDs")
    if set(by_id) != set(plan["intent"]["executionOrder"]):
        raise TrustBenchError("report is missing or adding scenarios")
    planned_scenarios = {item["id"]: item for item in plan["intent"]["scenarios"]}
    results = []
    for probe in suite["probes"]:
        scenario = by_id[probe["scenarioId"]]
        checkpoints = scenario.get("checkpoints")
        expected_checkpoints = {
            item["id"] for item in planned_scenarios[probe["scenarioId"]]["checkpoints"]
        }
        if not isinstance(checkpoints, list) or {
            item.get("checkpointId") for item in checkpoints if isinstance(item, dict)
        } != expected_checkpoints or len(checkpoints) != len(expected_checkpoints):
            raise TrustBenchError("checkpoint set differs from plan: %s" % probe["id"])
        refs = []
        for field in ("segments", "checkpoints"):
            items = scenario.get(field, [])
            if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
                raise TrustBenchError("invalid %s: %s" % (field, probe["id"]))
            for item in items:
                item_refs = item.get("evidenceRefs")
                if not isinstance(item_refs, list) or not item_refs:
                    raise TrustBenchError("missing evidence references: %s" % probe["id"])
                refs.extend(item_refs)
        for field in ("preconditions", "cleanup"):
            section = _object(scenario.get(field), field)
            section_refs = section.get("evidenceRefs")
            if not isinstance(section_refs, list):
                raise TrustBenchError("invalid %s evidence references: %s" % (field, probe["id"]))
            refs.extend(section_refs)
        if any(ref not in evidence_ids for ref in refs):
            raise TrustBenchError("unresolved evidence reference: %s" % probe["id"])
        failure = scenario.get("failure")
        category = failure.get("category") if isinstance(failure, dict) else None
        checkpoint_statuses = {
            item["checkpointId"]: item.get("status") for item in checkpoints
        }
        expected_checkpoint_status = CHECKPOINT_STATUS_BY_DIMENSION[probe["dimension"]]
        observed_cleanup_status = scenario["cleanup"].get("status")
        expected_cleanup_status = (
            "failed" if probe["dimension"] == "cleanup_verification" else "passed"
        )
        matched = (scenario.get("status") == probe["expectedStatus"] and
                   category == probe["expectedFailureCategory"] and
                   all(status == expected_checkpoint_status
                       for status in checkpoint_statuses.values()) and
                   observed_cleanup_status == expected_cleanup_status)
        results.append({
            "probeId": probe["id"],
            "dimension": probe["dimension"],
            "expectedStatus": probe["expectedStatus"],
            "observedStatus": scenario.get("status"),
            "observedFailureCategory": category,
            "observedCheckpointStatuses": checkpoint_statuses,
            "observedCleanupStatus": observed_cleanup_status,
            "matched": matched,
        })
    outcome_contract = {
        "planFingerprint": plan["planFingerprint"],
        "status": source.get("status"),
        "scenarios": [
            {
                "scenarioId": item["scenarioId"],
                "status": item.get("status"),
                "failureCategory": item["failure"].get("category")
                if isinstance(item.get("failure"), dict) else None,
                "checkpoints": [
                    {"checkpointId": cp["checkpointId"], "status": cp.get("status"),
                     "reason": cp.get("reason")}
                    for cp in item["checkpoints"]
                ],
                "cleanup": item["cleanup"].get("status"),
            }
            for item in scenarios
        ],
    }
    if source.get("outcomeFingerprint") != verification_engine.canonical_fingerprint(
        outcome_contract
    ):
        raise TrustBenchError("report outcome fingerprint mismatch")
    return {
        "schemaVersion": "solopi.trustbench.result/v0",
        "evaluationTrack": "oracle_contract_pilot",
        "agentPerformanceEligible": False,
        "suiteId": suite["id"],
        "suiteFingerprint": verification_engine.canonical_fingerprint(suite),
        "planFingerprint": plan["planFingerprint"],
        "reportId": source.get("reportId"),
        "matched": sum(item["matched"] for item in results),
        "total": len(results),
        "probes": results,
    }


def audit_evidence_bundle(report: Any, bundle_root: Path,
                          file_stats: Optional[Dict[str, Tuple[int, str]]] = None) -> Dict[str, Any]:
    source = _object(report, "report")
    evidence = source.get("evidence")
    scenarios = source.get("scenarios")
    if not isinstance(evidence, list) or not isinstance(scenarios, list):
        raise TrustBenchError("audit requires report evidence and scenarios")

    root = bundle_root.resolve()
    by_id = {}
    inline_by_id = {}
    for item in evidence:
        entry = _object(item, "evidence")
        evidence_id = entry.get("id")
        digest = entry.get("sha256")
        size = entry.get("size")
        raw_path = entry.get("path")
        if raw_path is None and "content" in entry:
            content = {"type": entry.get("type"), "content": entry.get("content")}
            if (not isinstance(evidence_id, str) or evidence_id in by_id or
                    evidence_id in inline_by_id or
                    digest != verification_engine.canonical_fingerprint(content) or
                    evidence_id != "evidence-%s" % digest[:20]):
                raise TrustBenchError("invalid inline evidence entry: %s" % evidence_id)
            inline_by_id[evidence_id] = entry
            continue
        if (not isinstance(evidence_id, str) or evidence_id in by_id or
                not isinstance(digest, str) or len(digest) != 64 or
                evidence_id != "evidence-%s" % digest[:20] or evidence_id in inline_by_id or
                isinstance(size, bool) or not isinstance(size, int) or size < 0 or
                not isinstance(raw_path, str) or not Path(raw_path).is_absolute()):
            raise TrustBenchError("invalid file evidence entry: %s" % evidence_id)
        path = Path(raw_path).resolve()
        if not path.is_relative_to(root):
            raise TrustBenchError("evidence path belongs to another run: %s" % evidence_id)
        relative = path.relative_to(root)
        if len(relative.parts) < 3 or relative.parts[0] != "segments":
            raise TrustBenchError("evidence is outside a segment: %s" % evidence_id)
        if file_stats is None:
            try:
                hasher = hashlib.sha256()
                actual_size = 0
                with path.open("rb") as artifact:
                    for chunk in iter(lambda: artifact.read(1024 * 1024), b""):
                        hasher.update(chunk)
                        actual_size += len(chunk)
                actual_digest = hasher.hexdigest()
            except OSError as exc:
                raise TrustBenchError("cannot read evidence %s: %s" % (evidence_id, exc)) from exc
        else:
            actual_size, actual_digest = file_stats.get(str(path), (-1, ""))
        if actual_size != size or actual_digest != digest:
            raise TrustBenchError("evidence digest or size mismatch: %s" % evidence_id)
        by_id[evidence_id] = relative.parts[1]

    segment_ids = set()
    evidence_owners = {}
    referenced_ids = set()
    for scenario in scenarios:
        scenario = _object(scenario, "scenario")
        scenario_id = scenario.get("scenarioId")
        for segment in scenario.get("segments", []):
            segment = _object(segment, "segment")
            segment_id = segment.get("segmentId")
            phase = segment.get("phase")
            if (not isinstance(scenario_id, str) or not isinstance(segment_id, str) or
                    segment_id in segment_ids or phase not in {"precondition", "test", "cleanup"}):
                raise TrustBenchError("missing or duplicate segment ID")
            segment_ids.add(segment_id)
            for evidence_id in segment.get("evidenceRefs", []):
                if by_id.get(evidence_id) != segment_id:
                    raise TrustBenchError("evidence belongs to another segment: %s" % evidence_id)
                referenced_ids.add(evidence_id)
                evidence_owners[evidence_id] = (scenario_id, phase)
        for section_name, phase in (("checkpoints", "test"),
                                    ("preconditions", "precondition"),
                                    ("cleanup", "cleanup")):
            section = scenario.get(section_name)
            items = section if section_name == "checkpoints" else [section]
            if not isinstance(items, list):
                raise TrustBenchError("invalid %s evidence references" % section_name)
            for item in items:
                section_item = _object(item, section_name)
                for evidence_id in section_item.get("evidenceRefs", []):
                    if evidence_id in inline_by_id:
                        inline = inline_by_id[evidence_id]
                        content = inline["content"]
                        if (section_name != "checkpoints" or
                                inline["type"] != "checkpoint_unreached" or
                                not isinstance(content, dict) or
                                content.get("scenarioId") != scenario_id or
                                content.get("checkpointId") != section_item.get("checkpointId") or
                                section_item.get("status") != "not_tested"):
                            raise TrustBenchError("inline evidence belongs to another checkpoint: %s" % evidence_id)
                        referenced_ids.add(evidence_id)
                        continue
                    if evidence_owners.get(evidence_id) != (scenario_id, phase):
                        raise TrustBenchError("%s evidence belongs to another phase or scenario: %s" %
                                              (section_name, evidence_id))
    if set(by_id.values()) != segment_ids or set(by_id) | set(inline_by_id) != referenced_ids:
        raise TrustBenchError("bundle has missing or unreferenced segment evidence")
    result = {"verifiedFiles": len(by_id), "verifiedSegments": len(segment_ids)}
    if inline_by_id:
        result["verifiedInline"] = len(inline_by_id)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate or score a TrustBench pilot suite")
    parser.add_argument("command", choices=("validate", "score", "audit"))
    parser.add_argument("--suite", required=True, type=Path)
    parser.add_argument("--repo-root", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        suite, plan = validate_suite(args.suite, args.repo_root)
        if args.command in {"score", "audit"}:
            if args.report is None:
                raise TrustBenchError("%s requires --report" % args.command)
            report = _read_json(args.report)
            result = score_report(suite, plan, report)
            if args.command == "audit":
                result["evidenceAudit"] = audit_evidence_bundle(report, args.report.parent)
        else:
            result = {"suiteId": suite["id"],
                      "suiteFingerprint": verification_engine.canonical_fingerprint(suite),
                      "planFingerprint": plan["planFingerprint"],
                      "probes": len(suite["probes"])}
    except TrustBenchError as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
