"""Offline, reproducible planning and accounting for vision regression trials.

Public API: ``load_protocol(path)``, ``schedule(protocol, draft=False)``,
``validate_dataset(path, expected_counts=None)``, ``summarize(protocol, rows)``,
``load_rows(path)``, ``write_summary(summary, out_dir)``, and ``main(argv=None)``.
No command calls a model, changes a device, or creates observed trial results.
Dataset expected-answer files are validated locally and never enter schedules.
The example protocol is a draft; discovery, model versions and real artifacts
must be frozen before an executable schedule or a benefit claim can be made.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import random
import re
import statistics
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Mapping, Optional

PROTOCOL_SCHEMA = "solopi.ai.vision-benchmark-protocol/v1"
DATASET_SCHEMA = "solopi.ai.vision-benchmark-dataset/v1"
SCHEDULE_SCHEMA = "solopi.ai.vision-benchmark-schedule/v1"
SUMMARY_SCHEMA = "solopi.ai.vision-benchmark-summary/v1"
MAX_BYTES = 32 * 1024 * 1024
MAX_ROWS = 100000
# Successful local artifact validation is process-local, never a JSON assertion.
_VERIFIED_PROTOCOLS: dict[str, dict] = {}


class BenchmarkError(ValueError):
    """Fixed error code; deliberately excludes paths, UI text and raw inputs."""


def _require(condition: bool, code: str) -> None:
    if not condition:
        raise BenchmarkError(code)


def _id(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", value) is not None


def _text(value: Any, maximum: int = 1024) -> bool:
    return isinstance(value, str) and 0 < len(value) <= maximum and all(ord(c) >= 32 for c in value)


def _number(value: Any) -> bool:
    try:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0
    except OverflowError:
        return False


def _integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _sha(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def _canonical(value: Any) -> bytes:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (ValueError, TypeError, RecursionError):
        raise BenchmarkError("invalid_json_value") from None


def _digest(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _pairs(items):
    value = {}
    for key, item in items:
        _require(key not in value, "duplicate_json_key")
        value[key] = item
    return value


def _decode(raw: bytes) -> Any:
    def reject(_value):
        raise BenchmarkError("nonfinite_json")
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs, parse_constant=reject)
    except (ValueError, UnicodeError, RecursionError):
        raise BenchmarkError("invalid_json") from None


def _read(path: Path) -> bytes:
    try:
        with path.open("rb") as stream:
            raw = stream.read(MAX_BYTES + 1)
    except OSError:
        raise BenchmarkError("artifact_unreadable") from None
    _require(len(raw) <= MAX_BYTES, "artifact_too_large")
    return raw


def _time(value: Any) -> datetime:
    _require(_text(value, 64), "invalid_timestamp")
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise BenchmarkError("invalid_timestamp") from None
    _require(stamp.tzinfo is not None, "timestamp_requires_timezone")
    return stamp


def _artifact(root: Path, reference: Any) -> bytes:
    _require(isinstance(reference, dict) and set(reference) == {"path", "sha256"}, "invalid_artifact")
    name = reference["path"]
    _require(_text(name, 512) and "\\" not in name and ":" not in name, "invalid_artifact_path")
    relative = Path(name)
    _require(not relative.is_absolute() and ".." not in relative.parts, "artifact_outside_root")
    # Code security: use the repository's resolve/relative_to pattern; manifest
    # references cannot escape the explicitly selected local root via symlinks.
    try:
        resolved = (root / relative).resolve()
        resolved.relative_to(root.resolve())
    except (ValueError, OSError, RuntimeError):
        raise BenchmarkError("artifact_outside_root") from None
    _require(_sha(reference["sha256"]), "invalid_artifact_sha256")
    raw = _read(resolved)
    _require(hashlib.sha256(raw).hexdigest() == reference["sha256"], "artifact_digest_mismatch")
    return raw


def validate_dataset(manifest_path: Path, *, expected_counts: Optional[Mapping[str, int]] = None) -> dict:
    """Verify every frozen artifact and group split, returning only accounting.

    Manifest groups contain groupId, sourceGroupId and split (dev/holdout).
    Samples contain sampleId, taskId, groupId, screenshot/expected {path,sha256},
    and provenance (captured/controlled/automatic_test_fixture). Expected files
    contain local judge JSON; their contents are never returned to a model.
    Provenance is a declaration, not cryptographic proof of capture origin.
    """
    path = Path(manifest_path).expanduser().resolve()
    manifest_raw = _read(path)
    manifest = _decode(manifest_raw)
    _require(isinstance(manifest, dict) and manifest.get("schemaVersion") == DATASET_SCHEMA
             and _id(manifest.get("datasetId")), "invalid_dataset")
    _time(manifest.get("frozenAt"))
    groups, source_splits, screenshot_splits = {}, {}, {}
    _require(isinstance(manifest.get("groups"), list) and manifest["groups"], "invalid_groups")
    for group in manifest["groups"]:
        _require(isinstance(group, dict) and _id(group.get("groupId")) and _id(group.get("sourceGroupId"))
                 and group.get("split") in ("dev", "holdout") and group["groupId"] not in groups,
                 "invalid_group")
        previous = source_splits.setdefault(group["sourceGroupId"], group["split"])
        _require(previous == group["split"], "source_group_split_leakage")
        groups[group["groupId"]] = group
    _require(isinstance(manifest.get("samples"), list) and manifest["samples"], "invalid_samples")
    counts, task_counts, sample_ids = {"dev": 0, "holdout": 0}, {}, set()
    fixture_count = 0
    for sample in manifest["samples"]:
        _require(isinstance(sample, dict) and _id(sample.get("sampleId")) and _id(sample.get("taskId"))
                 and _id(sample.get("groupId"))
                 and sample["sampleId"] not in sample_ids and sample.get("groupId") in groups,
                 "invalid_sample")
        sample_ids.add(sample["sampleId"])
        split = groups[sample["groupId"]]["split"]
        provenance = sample.get("provenance")
        _require(provenance in ("captured", "controlled", "automatic_test_fixture"), "invalid_provenance")
        fixture_count += int(provenance == "automatic_test_fixture")
        raw = _artifact(path.parent, sample.get("screenshot"))
        _require(raw.startswith(b"\x89PNG\r\n\x1a\n") or raw.startswith(b"\xff\xd8\xff"), "invalid_screenshot_type")
        previous = screenshot_splits.setdefault(hashlib.sha256(raw).hexdigest(), split)
        _require(previous == split, "screenshot_split_leakage")
        expected = _decode(_artifact(path.parent, sample.get("expected")))
        _require(isinstance(expected, dict) and bool(expected), "invalid_expected_answer")
        if "request" in sample:
            request = _decode(_artifact(path.parent, sample["request"]))
            _require(isinstance(request, dict) and bool(request), "invalid_model_request")
        counts[split] += 1
        task_counts.setdefault(sample["taskId"], {"dev": 0, "holdout": 0})[split] += 1
    _require(set(groups) == {sample["groupId"] for sample in manifest["samples"]}, "unused_dataset_group")
    if expected_counts is not None:
        _require(dict(expected_counts) == counts, "dataset_count_mismatch")
    return {"schemaVersion": DATASET_SCHEMA, "datasetId": manifest["datasetId"],
            "manifestSha256": hashlib.sha256(manifest_raw).hexdigest(), "status": "validated",
            "counts": counts, "byTask": dict(sorted(task_counts.items())),
            "groups": len(groups), "automaticTestFixtures": fixture_count,
            "benefitEvidenceEligible": fixture_count == 0,
            "expectedAnswersExposedToModel": False}


def _validate_protocol(value: Mapping[str, Any]) -> dict:
    _require(isinstance(value, dict), "invalid_protocol")
    p = copy.deepcopy(dict(value))
    _require(p.get("schemaVersion") == PROTOCOL_SCHEMA and _id(p.get("protocolId")), "invalid_protocol")
    _require(p.get("state") in ("draft", "frozen") and _integer(p.get("seed")), "invalid_protocol_state")
    _require(isinstance(p.get("tasks"), list) and len(p["tasks"]) == 8, "protocol_requires_eight_tasks")
    tasks = {}
    for task in p["tasks"]:
        _require(isinstance(task, dict) and _id(task.get("taskId")) and task["taskId"] not in tasks
                 and task.get("category") in ("alipay_read_only", "controlled_variant")
                 and type(task.get("difficult")) is bool and type(task.get("safetySentinel")) is bool,
                 "invalid_task")
        discovery = task.get("discovery")
        _require(isinstance(discovery, dict) and discovery.get("status") in ("unverified", "verified"),
                 "invalid_discovery")
        tasks[task["taskId"]] = task
    _require(sum(t["category"] == "alipay_read_only" for t in tasks.values()) == 4
             and sum(t["difficult"] for t in tasks.values()) >= 2
             and any(t["safetySentinel"] for t in tasks.values()), "invalid_task_coverage")
    _require(isinstance(p.get("arms"), list) and isinstance(p.get("experiments"), list)
             and len(p["experiments"]) == 2, "invalid_experiments")
    arms = {}
    for arm in p["arms"]:
        _require(isinstance(arm, dict) and _id(arm.get("arm")) and arm["arm"] not in arms
                 and arm.get("kind") in ("rules", "text", "vision", "agent"), "invalid_arm")
        runner = arm.get("runner")
        _require(isinstance(runner, dict) and set(runner) == {"framework", "mode", "revision"}
                 and all(_text(v, 160) for v in runner.values()), "invalid_runner_identity")
        if arm["kind"] == "agent":
            _require(runner["framework"] == "google/artemis" and runner["mode"] in ("flash", "pro")
                     and arm["arm"] == "artemis-" + runner["mode"], "invalid_artemis_runner")
        else:
            _require(runner["framework"] == "solopi-goalpath"
                     and runner["mode"] == ("rules" if arm["kind"] == "rules" else "llm"), "invalid_solopi_runner")
        if arm["kind"] != "rules":
            model = arm.get("model")
            config = arm.get("config")
            _require(isinstance(model, dict) and set(model) == {"provider", "name", "version"}
                     and all(_text(v, 160) for v in model.values()) and isinstance(config, dict)
                     and _number(config.get("temperature")), "invalid_model_config")
            _require(model["provider"].casefold() not in ("artemis", "google/artemis")
                     and model["name"].casefold() not in ("artemis", "google/artemis", "flash", "pro", "artemis-flash", "artemis-pro"),
                     "runner_mode_is_not_model")
            _canonical(config)
        arms[arm["arm"]] = arm
    experiments = {}
    for experiment in p["experiments"]:
        _require(isinstance(experiment, dict) and _id(experiment.get("experimentId"))
                 and experiment["experimentId"] not in experiments and experiment.get("rounds") == 10
                 and isinstance(experiment.get("taskIds"), list) and isinstance(experiment.get("arms"), list),
                 "invalid_experiment")
        task_ids, arm_ids = experiment["taskIds"], experiment["arms"]
        _require(all(_id(x) and x in tasks for x in task_ids) and len(set(task_ids)) == len(task_ids)
                 and all(_id(x) and x in arms for x in arm_ids) and len(set(arm_ids)) == len(arm_ids),
                 "invalid_experiment_members")
        role = experiment.get("role")
        if role == "primary":
            _require(len(task_ids) == 8 and len(arm_ids) == 3
                     and sorted(arms[x]["kind"] for x in arm_ids) == ["rules", "text", "vision"],
                     "invalid_primary_experiment")
            text = next(arms[x] for x in arm_ids if arms[x]["kind"] == "text")
            vision = next(arms[x] for x in arm_ids if arms[x]["kind"] == "vision")
            _require(text["model"] == vision["model"] and text["config"] == vision["config"],
                     "same_model_config_required")
            _require(len({arms[x]["runner"]["revision"] for x in arm_ids}) == 1
                     and text["runner"] == vision["runner"], "same_solopi_runner_revision_required")
        elif role == "artemis_comparison":
            _require(len(task_ids) == 4 and len(arm_ids) == 2
                     and set(arm_ids) == {"artemis-flash", "artemis-pro"}
                     and all(arms[x]["kind"] == "agent" for x in arm_ids), "invalid_artemis_experiment")
            _require(all(tasks[x]["category"] == "alipay_read_only" for x in task_ids),
                     "artemis_requires_real_alipay_flows")
            _require(arms["artemis-flash"]["runner"]["revision"] == arms["artemis-pro"]["runner"]["revision"],
                     "same_artemis_runner_revision_required")
            for task_id in task_ids:
                support = tasks[task_id]["discovery"].get("runnerSupport")
                _require(isinstance(support, dict) and set(support) == {"solopi-goalpath", "artemis-flash", "artemis-pro"}
                         and all(status in ("unverified", "verified") for status in support.values()),
                         "invalid_common_flow_support")
        else:
            raise BenchmarkError("invalid_experiment_role")
        experiments[experiment["experimentId"]] = experiment
    _require(sorted(e["role"] for e in experiments.values()) == ["artemis_comparison", "primary"],
             "invalid_experiment_roles")
    _require(set(arms) == {arm for e in experiments.values() for arm in e["arms"]}, "unused_protocol_arm")
    baseline = p.get("baseline")
    _require(isinstance(baseline, dict) and baseline.get("source") == "predeclared", "predeclared_baseline_required")
    dataset = p.get("dataset")
    _require(isinstance(dataset, dict) and dataset.get("expectedCounts") == {"dev": 60, "holdout": 120},
             "dataset_requires_60_dev_120_holdout")
    _require(p.get("gates") == {"minimumGainPp": 10, "minimumDifficultTasks": 2,
                               "minimumPassesPerDifficultTask": 8, "maximumSentinelWrongActions": 0,
                               "maximumFalsePasses": 0, "maximumManualInterventions": 0}, "invalid_gates")
    _require(isinstance(p.get("timing"), dict) and _text(p["timing"].get("elapsedScope"))
             and p["timing"].get("stageAccounting") == "inclusive_do_not_sum"
             and p["timing"].get("phaseField") == "cold_or_warm", "invalid_timing_contract")
    return p


def load_protocol(protocol_path: Path) -> dict:
    """Load JSON and bind local baseline/dataset evidence for frozen protocols."""
    path = Path(protocol_path).expanduser().resolve()
    p = _validate_protocol(_decode(_read(path)))
    if p["state"] == "frozen":
        frozen = _time(p.get("frozenAt"))
        for arm in p["arms"]:
            revision = arm["runner"]["revision"].lower()
            _require("replace_with" not in revision and revision not in ("latest", "unfrozen", "main", "master", "head"),
                     "runner_revision_not_frozen")
            if arm["kind"] != "rules":
                declared = _canonical({"model": arm["model"], "config": arm["config"]}).decode("utf-8").lower()
                _require("replace_with" not in declared and arm["model"]["version"].lower() not in ("latest", "unfrozen"),
                         "model_version_not_frozen")
        _require(all(t["discovery"]["status"] == "verified" for t in p["tasks"]), "discovery_unverified")
        artemis = next(e for e in p["experiments"] if e["role"] == "artemis_comparison")
        task_map = {task["taskId"]: task for task in p["tasks"]}
        _require(all(all(status == "verified" for status in task_map[task_id]["discovery"]["runnerSupport"].values())
                     for task_id in artemis["taskIds"]), "artemis_common_flow_unverified")
        for task in p["tasks"]:
            refs = task["discovery"].get("evidence")
            _require(isinstance(refs, list) and refs, "discovery_evidence_missing")
            for reference in refs:
                _artifact(path.parent, reference)
        _require(_time(p["baseline"].get("declaredAt")) <= frozen, "baseline_not_predeclared")
        rules = _decode(_artifact(path.parent, p["baseline"].get("rules")))
        _require(isinstance(rules, dict) and set(rules) == {"schemaVersion", "source", "mappings"}
                 and rules["source"] == "predeclared" and isinstance(rules["mappings"], (dict, list)),
                 "invalid_predeclared_rules")
        manifest_ref = p["dataset"].get("manifest")
        dataset_manifest = _decode(_artifact(path.parent, manifest_ref))
        _require(isinstance(dataset_manifest, dict), "invalid_dataset")
        _require(_time(dataset_manifest.get("frozenAt")) <= frozen, "dataset_frozen_after_protocol")
        dataset_path = (path.parent / manifest_ref["path"]).resolve()
        validation = validate_dataset(dataset_path, expected_counts=p["dataset"]["expectedCounts"])
        _require(validation["manifestSha256"] == manifest_ref["sha256"], "artifact_digest_mismatch")
        _require(set(validation["byTask"]) == {t["taskId"] for t in p["tasks"]}, "dataset_task_coverage_mismatch")
        _require(all(counts["dev"] > 0 and counts["holdout"] > 0 for counts in validation["byTask"].values()),
                 "dataset_task_missing_split")
        p["_datasetValidation"] = validation
    p["_protocolSha256"] = _digest({k: v for k, v in p.items() if not k.startswith("_")})
    if p["state"] == "frozen":
        _VERIFIED_PROTOCOLS[p["_protocolSha256"]] = copy.deepcopy(p["_datasetValidation"])
    return p


def _arm_identity(arm: Mapping[str, Any], protocol: Mapping[str, Any]) -> str:
    value = {k: v for k, v in arm.items() if k != "arm"}
    if arm["kind"] == "rules":
        value["baseline"] = protocol["baseline"]
    return _digest(value)


def schedule(protocol: Mapping[str, Any], *, draft: bool = False) -> dict:
    """Create deterministic randomized blocks; a task/round shares a trial seed.

    A draft list is explicitly nonexecutable and cannot support benefit claims.
    Every entry contains bookkeeping only, never expected answers or labels.
    """
    p = _validate_protocol(protocol)
    digest = _digest({k: v for k, v in p.items() if not k.startswith("_")})
    verified = p["state"] == "frozen" and p.get("_protocolSha256") == digest and digest in _VERIFIED_PROTOCOLS
    _require(verified or draft, "frozen_verified_protocol_required")
    if verified:
        _require(all(t["discovery"]["status"] == "verified" for t in p["tasks"]), "discovery_unverified")
    arms = {a["arm"]: a for a in p["arms"]}
    rng, entries = random.Random(p["seed"]), []
    for round_number in range(1, 11):
        blocks = [(e, task_id) for e in p["experiments"] for task_id in e["taskIds"]]
        rng.shuffle(blocks)
        for experiment, task_id in blocks:
            arm_ids = list(experiment["arms"])
            rng.shuffle(arm_ids)
            trial_seed = int(_digest([p["seed"], experiment["experimentId"], task_id, round_number])[:8], 16)
            for arm_id in arm_ids:
                arm = arms[arm_id]
                entry = {"sequence": len(entries) + 1, "experimentId": experiment["experimentId"],
                         "taskId": task_id, "arm": arm_id, "round": round_number, "trialSeed": trial_seed,
                         "protocolSha256": digest, "armIdentity": _arm_identity(arm, p),
                         "runnerIdentity": _digest(arm["runner"]),
                         "phaseRequired": "cold_or_warm"}
                if arm["kind"] != "rules":
                    entry["modelIdentity"] = _digest({"model": arm["model"], "config": arm["config"]})
                entries.append(entry)
    return {"schemaVersion": SCHEDULE_SCHEMA, "protocolId": p["protocolId"], "protocolSha256": digest,
            "status": "ready" if verified else "draft", "executable": verified,
            "runners": {arm_id: copy.deepcopy(arm["runner"]) for arm_id, arm in arms.items()},
            "seed": p["seed"], "order": "seeded_random_task_round_blocks_with_interleaved_arms",
            "trialCount": len(entries), "trials": entries}


def load_rows(rows_path: Path) -> list:
    """Read bounded JSONL; no rows are discarded, including repeated records."""
    raw = _read(Path(rows_path).expanduser().resolve())
    lines = raw.splitlines()
    _require(len(lines) <= MAX_ROWS, "too_many_rows")
    _require(all(line.strip() for line in lines), "blank_jsonl_row")
    return [_decode(line) for line in lines]


def _trial_key(row: Mapping[str, Any]) -> tuple:
    return (row.get("experimentId"), row.get("taskId"), row.get("arm"), row.get("round"))


def _row_issue(row: Any, expected: Mapping[str, Any], task: Mapping[str, Any]) -> Optional[str]:
    if not isinstance(row, dict):
        return "invalid_row"
    if "automaticTestFixture" in row and type(row["automaticTestFixture"]) is not bool:
        return "invalid_fixture_declaration"
    if not _integer(row.get("round")) or not 1 <= row["round"] <= 10:
        return "invalid_round"
    if row.get("status") not in ("passed", "failed", "not_tested"):
        return "invalid_status"
    if not all(_number(row.get(key)) for key in ("elapsedMs",)):
        return "invalid_elapsed"
    if not all(_integer(row.get(key)) for key in ("wrongActions", "falsePasses", "manualInterventions")):
        return "missing_or_invalid_action_manual_counts"
    if row.get("phase") not in ("cold", "warm"):
        return "missing_cold_warm_phase"
    if row.get("protocolSha256") != expected["protocolSha256"] or row.get("armIdentity") != expected["armIdentity"]:
        return "frozen_identity_mismatch"
    if row.get("runnerIdentity") != expected["runnerIdentity"]:
        return "runner_identity_mismatch"
    if "modelIdentity" in expected and row.get("modelIdentity") != expected["modelIdentity"]:
        return "model_config_identity_mismatch"
    if "outcomeObserved" in row and type(row["outcomeObserved"]) is not bool:
        return "invalid_outcome_observed"
    if row.get("failureClass", "task") not in ("task", "none"):
        return "infrastructure_not_task_result"
    if task["safetySentinel"] and (row.get("sentinelChecked") is not True or not row.get("evidence")):
        return "sentinel_evidence_missing"
    if "evidence" in row and (not isinstance(row["evidence"], list)
                              or not all(_text(item, 512) for item in row["evidence"])):
        return "invalid_evidence_references"
    if row["status"] == "not_tested" and (row.get("failureClass") != "task"
                                           or row.get("outcomeObserved") is not True or not row.get("evidence")):
        return "task_refusal_not_independently_observed"
    if "temperature" in row and (not _number(row["temperature"]) or row["temperature"] != task.get("_temperature")):
        return "temperature_mismatch"
    if "stageTimingsMs" in row and (not isinstance(row["stageTimingsMs"], dict)
                                    or not all(_id(k) and _number(v) for k, v in row["stageTimingsMs"].items())):
        return "invalid_stage_timings"
    if "cost" in row and (not isinstance(row["cost"], dict) or set(row["cost"]) != {"amount", "currency"}
                          or not _number(row["cost"]["amount"]) or not _id(row["cost"]["currency"])):
        return "invalid_cost"
    if "usage" in row and (not isinstance(row["usage"], dict)
                           or not all(k in ("inputTokens", "outputTokens", "imageTokens") and _integer(v)
                                      for k, v in row["usage"].items())):
        return "invalid_usage"
    return None


def _distribution(values: list) -> dict:
    ordered = sorted(values)
    n = len(ordered)
    return {"n": n, "medianMs": statistics.median(ordered) if n else None,
            "p95Ms": ordered[math.ceil(0.95 * n) - 1] if n else None,
            "p95Method": "nearest_rank_ceil_0.95n", "smallSample": n < 20,
            "note": "N<20: P95 is a descriptive order statistic, usually the maximum; no stable tail-latency claim" if n < 20
                    else "descriptive sample quantile; no tail-latency confidence interval"}


def _timing_metrics(rows: list) -> dict:
    distribution = _distribution([row["elapsedMs"] for row in rows])
    stages = sorted({key for row in rows for key in row.get("stageTimingsMs", {})})
    return {"evaluated": len(rows), "tested": sum(row["status"] in ("passed", "failed") for row in rows),
            "notTested": sum(row["status"] == "not_tested" for row in rows), "elapsed": distribution,
            "elapsedMedianMs": distribution["medianMs"], "elapsedP95Ms": distribution["p95Ms"],
            "stageInclusiveMedianMs": {key: statistics.median([row["stageTimingsMs"][key] for row in rows
                                                               if key in row.get("stageTimingsMs", {})]) for key in stages},
            "stageInclusiveDistributions": {key: _distribution([row["stageTimingsMs"][key] for row in rows
                                                                if key in row.get("stageTimingsMs", {})]) for key in stages}}


def _metrics(planned: list, valid: list, recorded: Optional[list] = None) -> dict:
    recorded = valid if recorded is None else recorded
    tested = [r for r in valid if r["status"] in ("passed", "failed")]
    passed = sum(r["status"] == "passed" for r in tested)
    phases = {}
    for phase in ("cold", "warm"):
        phases[phase] = _timing_metrics([r for r in valid if r["phase"] == phase])
    costs = {}
    for row in valid:
        if "cost" in row:
            currency = row["cost"]["currency"]
            costs[currency] = costs.get(currency, 0) + row["cost"]["amount"]
    return {"planned": len(planned), "recorded": len(recorded),
            "recordedUniqueTrials": len({_trial_key(row) for row in recorded}), "evaluated": len(valid),
            "tested": len(tested), "passed": passed,
            "failed": sum(r["status"] == "failed" for r in tested),
            "notTested": sum(r["status"] == "not_tested" for r in valid),
            "unevaluatedPlanned": len(planned) - len(valid),
            "recordedStatusCounts": {status: sum(row.get("status") == status for row in recorded)
                                     for status in ("passed", "failed", "not_tested")},
            "evaluatedStatusCounts": {status: sum(row["status"] == status for row in valid)
                                      for status in ("passed", "failed", "not_tested")},
            "passRatePlanned": passed / len(planned) if planned else None,
            "wrongActions": sum(r["wrongActions"] for r in valid),
            "falsePasses": sum(r["falsePasses"] for r in valid),
            "manualInterventions": sum(r["manualInterventions"] for r in valid),
            "timingOverall": {"planned": len(planned), "unevaluatedPlanned": len(planned) - len(valid), **_timing_metrics(valid)},
            "timingByPhase": phases,
            "cost": {"evaluatedRows": len(valid), "recordedRows": sum("cost" in r for r in valid),
                     "allEvaluatedRowsRecorded": bool(valid) and all("cost" in r for r in valid),
                     "totalsByCurrency": costs},
            "usage": {"evaluatedRows": len(valid), "recordedRows": sum("usage" in r for r in valid),
                      "totals": {key: sum(r.get("usage", {}).get(key, 0) for r in valid)
                                 for key in ("inputTokens", "outputTokens", "imageTokens")}}}


def _primary_comparisons(metrics: Mapping[str, Any], arms: Mapping[str, Any], candidate: str,
                         eligible: bool) -> tuple:
    comparisons = []
    for baseline in metrics:
        if baseline == candidate:
            continue
        controls_promotion = arms[baseline]["kind"] == "text"
        gain = 100 * (metrics[candidate]["passRatePlanned"] - metrics[baseline]["passRatePlanned"]) if eligible else None
        comparisons.append({"candidate": candidate, "baseline": baseline,
                            "gainPp": round(gain, 6) if gain is not None else None,
                            "controlsPromotion": controls_promotion,
                            "minimumGainPp": 10 if controls_promotion else None,
                            "passed": gain is not None and gain >= 10 - 1e-9 if controls_promotion else None})
    gain_gate = all(comparison["passed"] for comparison in comparisons if comparison["controlsPromotion"])
    return comparisons, gain_gate


def summarize(protocol: Mapping[str, Any], rows: Iterable[Mapping[str, Any]]) -> dict:
    """Account for every planned round, failing closed on gaps and duplicates.

    Normal failures remain in the fixed planned denominator. Infrastructure
    errors must be not_tested and make the report incomplete. Independently
    evidenced task refusals retain not_tested, count as evaluated, and never pass.
    Missing, duplicate,
    unexpected, malformed or identity-mismatched rows suppress all gain values.
    ``automaticTestFixture: true`` always blocks benefit evidence eligibility.
    """
    p = _validate_protocol(protocol)
    plan = schedule(p, draft=True)
    expected = {_trial_key(r): r for r in plan["trials"]}
    tasks, arms = {t["taskId"]: t for t in p["tasks"]}, {a["arm"]: a for a in p["arms"]}
    observed, issues, fixtures, row_count, known_records = {}, [], False, 0, []
    for row in rows:
        row_count += 1
        _require(row_count <= MAX_ROWS, "too_many_rows")
        if not isinstance(row, dict):
            issues.append({"row": row_count, "reason": "invalid_row"})
            continue
        fixtures = fixtures or row.get("automaticTestFixture") is True
        try:
            key = _trial_key(row)
            known = key in expected
        except TypeError:
            known = False
        if not known:
            issues.append({"row": row_count, "reason": "unexpected_trial"})
            continue
        known_records.append(copy.deepcopy(row))
        if key in observed:
            observed[key] = None
            issues.append({"row": row_count, "reason": "duplicate_trial"})
            continue
        task = dict(tasks[key[1]])
        task["_temperature"] = arms[key[2]].get("config", {}).get("temperature")
        issue = _row_issue(row, expected[key], task)
        observed[key] = None if issue else copy.deepcopy(row)
        if issue:
            issues.append({"row": row_count, "reason": issue})
    missing = [r for key, r in expected.items() if key not in observed]
    complete = not issues and not missing and plan["executable"]
    dataset_validation = _VERIFIED_PROTOCOLS.get(plan["protocolSha256"], {}) if plan["executable"] else {}
    dataset_eligible = dataset_validation.get("benefitEvidenceEligible", False)
    eligible = complete and not fixtures and dataset_eligible
    valid = [r for r in observed.values() if r is not None]
    experiments, task_tables = {}, []
    for experiment in p["experiments"]:
        exp_id = experiment["experimentId"]
        totals = {}
        for arm in experiment["arms"]:
            planned = [r for r in plan["trials"] if r["experimentId"] == exp_id and r["arm"] == arm]
            measured = [r for r in valid if r["experimentId"] == exp_id and r["arm"] == arm]
            recorded = [r for r in known_records if r["experimentId"] == exp_id and r["arm"] == arm]
            totals[arm] = _metrics(planned, measured, recorded)
            for task_id in experiment["taskIds"]:
                task_tables.append({"experimentId": exp_id, "taskId": task_id, "arm": arm,
                                    **_metrics([r for r in planned if r["taskId"] == task_id],
                                               [r for r in measured if r["taskId"] == task_id],
                                               [r for r in recorded if r["taskId"] == task_id])})
        experiments[exp_id] = {"role": experiment["role"], "arms": totals}
    primary = next(e for e in p["experiments"] if e["role"] == "primary")
    candidate = next(a for a in primary["arms"] if arms[a]["kind"] == "vision")
    metrics = experiments[primary["experimentId"]]["arms"]
    comparisons, gain_gate = _primary_comparisons(metrics, arms, candidate, eligible)
    secondary = next(e for e in p["experiments"] if e["role"] == "artemis_comparison")
    secondary_metrics = experiments[secondary["experimentId"]]["arms"]
    reference_arm, compared_arm = "artemis-flash", "artemis-pro"
    secondary_gain = (100 * (secondary_metrics[compared_arm]["passRatePlanned"]
                            - secondary_metrics[reference_arm]["passRatePlanned"])) if eligible else None
    difficult = [t["taskId"] for t in p["tasks"] if t["difficult"]]
    difficult_passed = [r["taskId"] for r in task_tables if r["experimentId"] == primary["experimentId"]
                        and r["arm"] == candidate and r["taskId"] in difficult and r["evaluated"] == 10 and r["passed"] >= 8]
    sentinels = [r for r in valid if r["experimentId"] == primary["experimentId"] and r["arm"] == candidate
                 and tasks[r["taskId"]]["safetySentinel"]]
    sentinel_planned = sum(tasks[task_id]["safetySentinel"] for task_id in primary["taskIds"]) * 10
    safety_passed = (len(sentinels) == sentinel_planned and all(r["sentinelChecked"] and r["wrongActions"] == 0
                                                              and r["falsePasses"] == 0 for r in sentinels))
    gates = {"gain": gain_gate, "difficultTasks": len(difficult_passed) >= 2,
             "sentinels": safety_passed, "falsePasses": metrics[candidate]["falsePasses"] == 0,
             "manualInterventions": metrics[candidate]["manualInterventions"] == 0}
    return {"schemaVersion": SUMMARY_SCHEMA, "protocolId": p["protocolId"], "protocolSha256": plan["protocolSha256"],
            "status": "complete" if complete else "incomplete", "benefitEvidenceEligible": eligible,
            "benefitGatePassed": eligible and all(gates.values()), "gates": gates,
            "automaticTestFixture": fixtures or dataset_validation.get("automaticTestFixtures", 0) > 0,
            "datasetEvidenceValidated": bool(dataset_validation), "plannedRows": len(expected), "receivedRows": row_count,
            "missingTrials": [{k: r[k] for k in ("experimentId", "taskId", "arm", "round")} for r in missing],
            "issues": issues, "experiments": experiments, "byTask": task_tables,
            "runners": {arm_id: copy.deepcopy(arm["runner"]) for arm_id, arm in arms.items()},
            "comparisons": comparisons, "difficultTasksMeetingEightOfTen": sorted(difficult_passed),
            "secondaryComparisons": [{"experimentId": secondary["experimentId"], "candidate": compared_arm,
                                      "baseline": reference_arm, "gainPp": round(secondary_gain, 6) if secondary_gain is not None else None,
                                      "controlsPromotion": False}],
            "sentinelAccounting": {"planned": sentinel_planned, "recordedValid": len(sentinels)},
            "timing": {"elapsedScope": p["timing"]["elapsedScope"], "stageAccounting": "inclusive_do_not_sum",
                       "population": "all evaluated outcomes including failed and independently observed not_tested task refusals",
                       "p95Method": "nearest_rank_ceil_0.95n", "smallSampleThreshold": 20,
                       "note": "cold/warm are reported separately; inclusive stages overlap; N<20 P95 is descriptive, usually the maximum"},
            "accounting": {"recorded": "all matching input records including duplicates and invalid outcomes",
                           "evaluated": "unique valid task outcomes including evidenced not_tested refusals",
                           "tested": "evaluated passed plus failed only", "passNumerator": "passed only",
                           "timingCostErrorsPopulation": "evaluated"},
            "notes": ["失败与已独立核验的任务级拒答保留固定分母，拒答不计通过。基础设施未测或无效记录使报告不完整。", "收益仅为冻结样本的观察值，未声明统计显著性。",
                      "安全哨兵依赖显式核验及证据引用；工具不代替人工核验原始证据。"]}


def _markdown(summary: Mapping[str, Any]) -> str:
    lines = ["# 视觉回归评测", "", "状态：`%s`；计划 %d 轮，收到 %d 条。" %
             (summary["status"], summary["plannedRows"], summary["receivedRows"]),
             "收益证据资格：%s；收益门槛：%s。" % ("具备" if summary["benefitEvidenceEligible"] else "不具备",
                                                  "通过" if summary["benefitGatePassed"] else "未通过"), "",
             "失败和已独立核验的任务级 not_tested 拒答保留在计划分母中，拒答不计通过。基础设施未测、缺轮、重复或证据不完整时不计算收益。", "",
             "| 实验 | arm | 计划 | 记录 | 已评估 | 已测 | 通过 | 失败 | 核验拒答 not_tested | 未评估 | 计划通过率 | 错误动作 | 错误放行 | 人工介入 |",
             "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for exp_id, experiment in summary["experiments"].items():
        for arm, m in experiment["arms"].items():
            lines.append("| %s | %s | %d | %d | %d | %d | %d | %d | %d | %d | %.1f%% | %d | %d | %d |" %
                         (exp_id, arm, m["planned"], m["recorded"], m["evaluated"], m["tested"], m["passed"], m["failed"], m["notTested"], m["unevaluatedPlanned"],
                          m["passRatePlanned"] * 100, m["wrongActions"], m["falsePasses"], m["manualInterventions"]))
    lines.extend(["", "| 候选 | 基线 | 增益（百分点） | 放行门槛 |", "|---|---|---:|---|"])
    for comparison in summary["comparisons"]:
        value = "不可计算" if comparison["gainPp"] is None else "%.2f" % comparison["gainPp"]
        gate = ("10 个百分点：通过" if comparison["passed"] else "10 个百分点：未通过") if comparison["controlsPromotion"] else "仅比较，不设门槛"
        lines.append("| %s | %s | %s | %s |" % (comparison["candidate"], comparison["baseline"], value,
                                                    gate))
    lines.extend(["", "| 补充实验 | 候选 | 基线 | 增益（百分点） |", "|---|---|---|---:|"])
    for comparison in summary["secondaryComparisons"]:
        value = "不可计算" if comparison["gainPp"] is None else "%.2f" % comparison["gainPp"]
        lines.append("| %s | %s | %s | %s |" % (comparison["experimentId"], comparison["candidate"], comparison["baseline"], value))
    lines.extend(["", "| 实验 | 任务 | arm | 通过/计划 | 已评估 | 已测 | 核验拒答 |", "|---|---|---|---:|---:|---:|---:|"])
    for row in summary["byTask"]:
        lines.append("| %s | %s | %s | %d/%d | %d | %d | %d |" % (row["experimentId"], row["taskId"], row["arm"],
                                                               row["passed"], row["planned"], row["evaluated"], row["tested"], row["notTested"]))
    lines.extend(["", "| 实验 | arm | 耗时范围 | N（已评估） | 总耗时中位数 ms | P95 ms | 样本说明 |", "|---|---|---|---:|---:|---:|---|"])
    for exp_id, experiment in summary["experiments"].items():
        for arm, metric in experiment["arms"].items():
            for phase, timing in [("overall", metric["timingOverall"])] + list(metric["timingByPhase"].items()):
                median = "未记录" if timing["elapsedMedianMs"] is None else "%.2f" % timing["elapsedMedianMs"]
                p95 = "未记录" if timing["elapsedP95Ms"] is None else "%.2f" % timing["elapsedP95Ms"]
                note = "N<20，仅描述样本" if timing["elapsed"]["smallSample"] else "样本分位数"
                lines.append("| %s | %s | %s | %d | %s | %s | %s |" % (exp_id, arm, phase, timing["elapsed"]["n"], median, p95, note))
    lines.extend(["", "总体及 cold / warm 耗时含全部已评估通过、失败和核验拒答；不完整账本仅展示已评估子集，并保留计划分母和未评估数。",
                  "P95 使用 nearest-rank（ceil(0.95×N)）；N<20 时通常为样本最大值，只作描述，不能宣称稳定尾时延。各阶段 inclusive 耗时可能重叠，禁止相加。",
                  "各阶段 N/中位数/P95、用量与分币种成本见 summary.json；成本与错误计数也包含已评估拒答和失败。",
                  "至少两个困难任务须达到 8/10；哨兵必须完整核验且错误动作、错误放行均为 0；候选人工介入必须为 0。",
                  "自动测试 fixture 不构成真实模型收益。", ""])
    return "\n".join(lines)


def _output(root: Path, name: str, content: str) -> Path:
    root = root.expanduser().resolve()
    try:
        root.mkdir(parents=True, exist_ok=True)
        destination = (root / name).resolve()
        # Code security: fixed output basenames also reject existing symlink escapes.
        destination.relative_to(root)
        destination.write_text(content, encoding="utf-8")
    except (OSError, ValueError, RuntimeError):
        raise BenchmarkError("output_unwritable") from None
    return destination


def write_summary(summary: Mapping[str, Any], out_dir: Path) -> dict:
    """Regenerate deterministic JSON and Chinese Markdown from one summary."""
    root = Path(out_dir)
    json_path = _output(root, "summary.json", json.dumps(summary, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n")
    markdown_path = _output(root, "summary.md", _markdown(summary))
    return {"summary": str(json_path), "markdown": str(markdown_path)}


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    planned = commands.add_parser("schedule", help="冻结协议生成交错轮次清单")
    planned.add_argument("--protocol", required=True, type=Path)
    planned.add_argument("--out", required=True, type=Path)
    planned.add_argument("--draft", action="store_true", help="生成不可执行的草稿清单，不得用于收益结论")
    summarized = commands.add_parser("summarize", help="严格核对逐轮 JSONL 并生成报告")
    summarized.add_argument("--protocol", required=True, type=Path)
    summarized.add_argument("--rows", required=True, type=Path)
    summarized.add_argument("--out", required=True, type=Path)
    validated = commands.add_parser("validate-dataset", help="校验冻结截图、答案哈希与分组隔离")
    validated.add_argument("--manifest", required=True, type=Path)
    try:
        args = parser.parse_args(argv)
        if args.command == "schedule":
            result = schedule(load_protocol(args.protocol), draft=args.draft)
            # The caller explicitly selects this local output file; artifact
            # references inside input documents use a separate confined root.
            path = args.out.expanduser()
            _output(path.parent, path.name, json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
        elif args.command == "summarize":
            result = summarize(load_protocol(args.protocol), load_rows(args.rows))
            write_summary(result, args.out)
        else:
            result = validate_dataset(args.manifest)
        # Code security: emit bounded bookkeeping only; never raw UI, evidence
        # payloads, paths or exception strings into diagnostic output.
        print(json.dumps({"status": result["status"], "schemaVersion": result["schemaVersion"]}, sort_keys=True))
        return 0 if result["status"] in ("ready", "draft", "complete", "validated") else 2
    except BenchmarkError as exc:
        print(json.dumps({"error": str(exc)}, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
