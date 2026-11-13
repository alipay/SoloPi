"""Collect one local verification run into an explicitly UNLABELED pilot bundle.

No device, model API, credentials, expected answers or benchmark rows are used.
Choose a new ignored output directory, for example output/vision-pilot/run-01.
The bundle is deliberately not a vision-benchmark dataset manifest: a separate
independent labeling and freezing step is required before any evaluation.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import stat

from . import goalpath, goalpath_vision, verification_engine, vision_benchmark as benchmark, visual_observation


SCHEMA = "solopi.ai.vision-unlabeled-collection/v1"
MAX_FILES = 2000
MAX_TOTAL_BYTES = 256 * 1024 * 1024


class CollectionError(ValueError):
    """Fixed codes only; never disclose source UI, paths or exception payloads."""


def _require(condition, code):
    if not condition:
        raise CollectionError(code)


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _json(raw):
    try:
        return benchmark._decode(raw)
    except (ValueError, RecursionError):
        raise CollectionError("invalid_json") from None


class _Source:
    def __init__(self, root):
        supplied = Path(root).expanduser()
        _require(not supplied.is_symlink(), "invalid_run_root")
        self.root = supplied.resolve(strict=True)
        _require(self.root.is_dir(), "invalid_run_root")
        self.files = {}
        self.total = 0

    def read(self, name):
        _require(benchmark._text(name, 4096) and "\\" not in name and ":" not in name,
                 "invalid_source_path")
        relative = Path(name)
        _require(".." not in relative.parts, "source_outside_run")
        candidate = relative if relative.is_absolute() else self.root / relative
        # Code security: accept the runner's absolute references only inside this
        # explicit run root. Reject intermediate/final symlinks, not just '..'.
        try:
            local = candidate.relative_to(self.root)
            current = self.root
            for part in local.parts:
                current = current / part
                _require(not current.is_symlink(), "source_symlink")
            target = candidate.resolve(strict=True)
            target.relative_to(self.root)
        except (ValueError, OSError, RuntimeError):
            raise CollectionError("source_outside_run") from None
        descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            _require(stat.S_ISREG(info.st_mode) and 0 <= info.st_size <= benchmark.MAX_BYTES,
                     "invalid_source_file")
            raw = stream.read(benchmark.MAX_BYTES + 1)
        _require(len(raw) <= benchmark.MAX_BYTES, "source_too_large")
        key = target.relative_to(self.root).as_posix()
        if key in self.files:
            _require(self.files[key] == raw, "source_changed")
        else:
            self.total += len(raw)
            _require(len(self.files) < MAX_FILES and self.total <= MAX_TOTAL_BYTES, "collection_limit")
            self.files[key] = raw
        return key, raw

    def evidence(self, ref, kind=None):
        _require(isinstance(ref, dict) and benchmark._sha(ref.get("sha256"))
                 and type(ref.get("size")) is int and ref["size"] >= 0
                 and (kind is None or ref.get("type") == kind), "invalid_evidence_reference")
        key, raw = self.read(ref.get("path"))
        _require(_sha(raw) == ref["sha256"] and len(raw) == ref["size"], "evidence_digest_mismatch")
        return key, raw


def _outcome(report):
    return {"planFingerprint": report["planFingerprint"], "status": report["status"],
            "scenarios": [{"scenarioId": item["scenarioId"], "status": item["status"],
                "failureCategory": item["failure"]["category"] if item["failure"] else None,
                "checkpoints": [{"checkpointId": cp["checkpointId"], "status": cp["status"],
                                 "reason": cp["reason"]} for cp in item["checkpoints"]],
                "cleanup": item["cleanup"]["status"]} for item in report["scenarios"]]}


def _run(source):
    _, report_raw = source.read("report.json")
    report = _json(report_raw)
    _require(isinstance(report, dict) and report.get("schemaVersion") == verification_engine.REPORT_SCHEMA
             and benchmark._id(report.get("reportId")) and report.get("status") in {"passed", "failed", "not_tested"}
             and isinstance(report.get("scenarios"), list) and report["scenarios"], "invalid_run_report")
    _require(isinstance(report.get("artifacts"), dict), "missing_run_plan")
    _, plan_raw = source.read(report["artifacts"].get("plan"))
    plan = _json(plan_raw)
    try:
        verification_engine.validate_verification_plan(plan)
        _require(plan.get("platform", "android") == "android"
                 and report["planFingerprint"] == plan["planFingerprint"]
                 and report["requirementId"] == plan["intent"]["requirement"]["id"], "run_plan_identity_mismatch")
        _require(verification_engine.canonical_fingerprint(_outcome(report)) == report["outcomeFingerprint"],
                 "run_outcome_identity_mismatch")
        expected_ids = [item["id"] for item in plan["intent"]["scenarios"]]
        _require([item["scenarioId"] for item in report["scenarios"]] == expected_ids, "run_scenarios_mismatch")
        statuses = [item["status"] for item in report["scenarios"]]
        _require(all(item in {"passed", "failed", "not_tested"} for item in statuses), "invalid_scenario_status")
        aggregate = "failed" if "failed" in statuses else "not_tested" if "not_tested" in statuses else "passed"
        _require(aggregate == report["status"], "run_status_mismatch")
    except (KeyError, TypeError, verification_engine.VerificationError):
        raise CollectionError("invalid_run_contract") from None
    entries = report.get("evidence")
    _require(isinstance(entries, list), "invalid_run_evidence")
    registry = {}
    for entry in entries:
        _require(isinstance(entry, dict) and benchmark._id(entry.get("id"))
                 and benchmark._sha(entry.get("sha256")) and entry["id"] == "evidence-" + entry["sha256"][:20]
                 and entry["id"] not in registry, "invalid_run_evidence")
        registry[entry["id"]] = entry
    return report, report_raw, plan, plan_raw, registry


def _capture(source, event, package, refs):
    visual, observation = event.get("visual"), event.get("observation")
    _require(isinstance(visual, dict) and goalpath_vision.VISUAL_FIELDS.issubset(visual)
             and isinstance(observation, dict) and visual.get("observationId") == observation.get("observationId"),
             "visual_observation_identity_mismatch")
    snapshot = visual_observation._snapshot(observation, package)
    _require(snapshot == (visual["treeFingerprint"], visual["width"], visual["height"], visual.get("rotation")),
             "visual_tree_identity_mismatch")
    key, raw = source.read(visual["imagePath"])
    _require(_sha(raw) == visual["sha256"], "visual_digest_mismatch")
    # Code security: identical screenshots share a content-derived evidence ID;
    # the registry retains the first type/path, possibly a prior replay capture.
    # Only accept the current segment's explicit refs, verify the retained file,
    # then independently validate this decision capture's exact path and bytes.
    linked = [ref for ref in refs if ref.get("type") in {"decision_screenshot", "segment_screenshot", "replay_screenshot"}
              and ref.get("sha256") == visual["sha256"]]
    _require(bool(linked), "visual_not_in_segment_evidence")
    source.evidence(linked[0])
    checked = {field: visual[field] for field in goalpath_vision.VISUAL_FIELDS}
    checked["imagePath"] = str(source.root / key)
    _require(goalpath_vision._png_bytes(checked) == raw, "visual_changed")
    return {"visual": visual, "observation": observation, "sourcePath": key, "raw": raw}


def _candidates_match(request, receipt, active, allowed):
    private = receipt.get("candidates")
    _require(receipt.get("provider") == "goalpath" and isinstance(private, dict), "invalid_goalpath_receipt")
    public = goalpath._public_candidates(private)
    pending, nodes = [active["observation"]["page"]], {}
    while pending:
        node = pending.pop()
        nodes[node["nodeId"]] = node
        pending.extend(node.get("children", []))
    for key, item in private.items():
        _require(item["action"]["type"] in allowed, "candidate_action_mismatch")
        if "nodeId" in item:
            _require(item["nodeId"] in nodes and item["action"].get("nodeId") == item["nodeId"],
                     "candidate_node_mismatch")
            left, top, right, bottom = goalpath._bounds(nodes[item["nodeId"]])
            public[key]["visualBounds"] = [max(0, left), max(0, top), min(active["visual"]["width"], right),
                                           min(active["visual"]["height"], bottom)]
    _require(public == request["candidates"], "candidate_request_mismatch")


def _inventory(source):
    report, report_raw, plan, plan_raw, registry = _run(source)
    copied = {"source/report.json": report_raw, "source/plan.json": plan_raw}
    samples, captures, exclusions, seen_requests = [], [], [], set()
    planned = {item["id"]: item for item in plan["intent"]["scenarios"]}
    dynamic_count = 0
    for scenario in report["scenarios"]:
        original = planned[scenario["scenarioId"]]
        segments = {item["segmentId"]: item for item in original["segments"]}
        seen_segments = set()
        for segment in scenario["segments"]:
            segment_id = segment.get("segmentId")
            _require(segment_id in segments and segment_id not in seen_segments, "segment_identity_mismatch")
            seen_segments.add(segment_id)
            planned_segment = segments[segment_id]
            _require(segment.get("route") == planned_segment["route"]
                     and segment.get("phase") == planned_segment["phase"], "segment_identity_mismatch")
            if segment["route"] != "dynamic":
                continue
            dynamic_count += 1
            identity = {"scenarioId": scenario["scenarioId"], "segmentId": segment_id}
            ref_ids = segment.get("evidenceRefs")
            _require(isinstance(ref_ids, list) and all(ref in registry for ref in ref_ids), "segment_evidence_missing")
            refs = [registry[ref] for ref in ref_ids]
            transcripts = [ref for ref in refs if ref.get("type") == "agent_transcript"]
            if not transcripts:
                exclusions.append({**identity, "reason": "dynamic_transcript_unavailable"})
                continue
            _require(len(transcripts) == 1, "ambiguous_segment_transcript")
            key, raw = source.evidence(transcripts[0], "agent_transcript")
            transcript = _json(raw)
            step = planned_segment["dynamicStep"]
            _require(isinstance(transcript, dict) and transcript.get("scenarioId") == scenario["scenarioId"]
                     and transcript.get("stepId") == step["id"], "transcript_identity_mismatch")
            if "goal" in transcript:
                _require(transcript["goal"] == step["goal"] and transcript.get("allowedActions") == step["allowedActions"],
                         "transcript_step_mismatch")
            transcript_name = "source/transcript-%04d.json" % dynamic_count
            copied[transcript_name] = raw
            events = transcript.get("events", [])
            _require(isinstance(events, list) and len(events) <= 10000, "invalid_transcript_events")
            active, before = None, len(samples) + len(exclusions)
            for event_index, event in enumerate(events):
                _require(isinstance(event, dict), "invalid_transcript_event")
                location = {**identity, "eventIndex": event_index, "transcript": transcript_name}
                if event.get("type") == "visual_observation":
                    active = _capture(source, event, original["targetAppPackage"], refs)
                    name = "captures/capture-%04d.png" % (len(captures) + 1)
                    copied[name] = active["raw"]
                    capture = {**location, "screenshot": {"path": name, "sha256": _sha(active["raw"])},
                               "observationId": active["visual"]["observationId"], "usedByRequest": False}
                    captures.append(capture)
                    active["capture"] = capture
                elif event.get("type") == "visual_capture_failed":
                    active = None
                    exclusions.append({**location, "reason": "visual_capture_failed"})
                decision = event.get("decision")
                if not isinstance(decision, dict):
                    continue
                receipt = decision.get("modelReceipt")
                if not isinstance(receipt, dict) or "requestEvidence" not in receipt:
                    _require(not (isinstance(receipt, dict) and "visual" in receipt and "requestDigest" in receipt),
                             "request_evidence_missing")
                    exclusions.append({**location, "reason": "decision_without_choice_request"})
                    continue
                _require(active is not None, "request_without_visual_observation")
                request_ref = receipt["requestEvidence"]
                request_key, request_raw = source.evidence(request_ref, "decision_request")
                _require(any(ref.get("type") == "decision_request" and ref.get("sha256") == request_ref["sha256"]
                             and source.read(ref.get("path"))[0] == request_key for ref in refs),
                         "request_not_in_segment_evidence")
                _require(request_key not in seen_requests, "duplicate_request_evidence")
                seen_requests.add(request_key)
                request = _json(request_raw)
                _require(isinstance(request, dict) and request.get("goal") == step["goal"]
                         and request.get("visual") == {field: active["visual"][field] for field in goalpath_vision.VISUAL_FIELDS}
                         and receipt.get("visual") == request["visual"]
                         and receipt.get("observationId") == request["visual"]["observationId"]
                         and receipt.get("requestDigest") == benchmark._digest(request), "request_identity_mismatch")
                goalpath_vision._semantic_request(request)
                _candidates_match(request, receipt, active, step["allowedActions"])
                sample_id = "sample-%04d" % (len(samples) + 1)
                request_name = "requests/" + sample_id + ".json"
                copied[request_name] = request_raw
                active["capture"]["usedByRequest"] = True
                samples.append({**location, "sampleId": sample_id, "labelStatus": "unlabeled",
                    "request": {"path": request_name, "sha256": _sha(request_raw)},
                    "screenshot": copy.deepcopy(active["capture"]["screenshot"]),
                    "sourceRequestPath": request_key, "sourceScreenshotPath": active["sourcePath"],
                    "observationId": request["visual"]["observationId"],
                    "treeFingerprint": request["visual"]["treeFingerprint"]})
                active = None
            if len(samples) + len(exclusions) == before:
                exclusions.append({**identity, "transcript": transcript_name, "reason": "no_choice_request"})
    for capture in captures:
        if not capture["usedByRequest"]:
            exclusions.append({key: value for key, value in capture.items() if key != "usedByRequest"}
                              | {"reason": "capture_without_choice_request"})
    if not dynamic_count:
        exclusions.append({"reason": "no_executed_dynamic_segment"})
    return report, copied, samples, captures, exclusions


def collect(run_artifacts, output_dir, *, task_id, source_group_id, group_id, split):
    """Verify and copy one local run; leave every sample unlabeled and unevaluable.

    Group and split are explicit caller declarations, never inferred or randomly
    assigned. This single-run collector cannot certify isolation across bundles.
    Source report status is preserved, and is not a choice label or benefit row.
    """
    try:
        _require(all(benchmark._id(value) for value in (task_id, source_group_id, group_id))
                 and split in {"dev", "holdout"}, "invalid_collection_identity")
        source = _Source(run_artifacts)
        requested = Path(output_dir).expanduser()
        _require(requested.name not in {"", ".", ".."} and ".." not in requested.parts,
                 "invalid_output_directory")
        _require(not requested.exists() and not requested.is_symlink(), "output_already_exists")
        output = requested.parent.resolve() / requested.name
        _require(not output.is_relative_to(source.root), "output_inside_source_run")
        report, copied, samples, captures, exclusions = _inventory(source)
        # Code security: validate the whole source before creating output; copy
        # cached verified bytes with fixed filenames and private exclusive files.
        for key, raw in tuple(source.files.items()):
            _require(source.read(key)[1] == raw, "source_changed")
        assignment = {"taskId": task_id, "sourceGroupId": source_group_id, "groupId": group_id, "split": split}
        for sample in samples:
            sample.update(assignment)
        bundle = {"schemaVersion": SCHEMA, "status": "unlabeled", "evaluationReady": False,
            "realDeviceBenefitEvaluated": False, "sourceOriginAuthenticated": False,
            "automaticTestFixture": any(item.get("type") == "automatic_test_fixture" for item in report["evidence"]),
            "assignment": assignment, "sourceRun": {"reportId": report["reportId"], "status": report["status"],
                "planFingerprint": report["planFingerprint"], "outcomeFingerprint": report["outcomeFingerprint"],
                "report": {"path": "source/report.json", "sha256": _sha(copied["source/report.json"])},
                "plan": {"path": "source/plan.json", "sha256": _sha(copied["source/plan.json"])}},
            "samples": samples, "captures": captures, "exclusions": exclusions,
            "notes": ["No expected answers generated; independent labels and dataset freezing are required.",
                "Split/group assignments are declarations; no cross-bundle isolation is certified.",
                "Hashes verify local evidence consistency, not physical capture origin or task success."]}
        pending = {"schemaVersion": "solopi.ai.vision-pending-labels/v1", "status": "unlabeled",
            "evaluationReady": False, "labels": [{"sampleId": sample["sampleId"], "expectedChoice": None,
                "independentEvidence": [], "labelStatus": "unlabeled"} for sample in samples]}
        copied["pending-labels.json"] = (json.dumps(pending, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
        copied["bundle.json"] = (json.dumps(bundle, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2) + "\n").encode()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.mkdir(mode=0o700)
        for name, raw in copied.items():
            target = output / name
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with target.open("xb") as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(raw)
        return bundle
    except CollectionError:
        raise
    except Exception:
        # Code security: decoder, JSON, filesystem and contract exception text
        # may contain paths or raw UI. The CLI reports fixed errors only.
        raise CollectionError("collection_validation_or_io_failed") from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", required=True, help="One existing verification run directory")
    parser.add_argument("--output", required=True, help="New ignored private output directory")
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--source-group-id", required=True)
    parser.add_argument("--group-id", required=True)
    parser.add_argument("--split", required=True, choices=("dev", "holdout"))
    args = parser.parse_args(argv)
    try:
        bundle = collect(args.artifacts, args.output, task_id=args.task_id,
                         source_group_id=args.source_group_id, group_id=args.group_id, split=args.split)
    except CollectionError as exc:
        parser.exit(2, "Collection rejected: " + str(exc) + "\n")
    print(json.dumps({"schemaVersion": SCHEMA, "status": "unlabeled", "evaluationReady": False,
                      "samples": len(bundle["samples"]), "exclusions": len(bundle["exclusions"])}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
