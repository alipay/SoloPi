"""Frozen, group-isolated offline decisions; never executes an Android action.

Expected labels are used only after prediction. Real-capture provenance is an
explicit declaration plus a verified source digest, not proof of capture origin.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
import statistics
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Mapping, Optional

from .fastpath import FastPathDecisionProvider, PROMPT_TEMPLATE_VERSION, _nodes, validate_policy

DATASET_SCHEMA = "solopi.ai.fastpath-dataset/v1"
RULES_SCHEMA = "solopi.ai.fastpath-evaluation-rules/v1"
REPORT_SCHEMA = "solopi.ai.fastpath-dataset-evaluation/v1"
MAX_JSON_BYTES = 16 * 1024 * 1024
SPLITS = {"train", "dev", "test"}
PROVIDERS = {"resource_id", "text", "laya"}
SELECTOR_FIELDS = {"resourceId", "packageName", "className", "text", "description", "contentDescription"}


class DatasetError(ValueError):
    """A deliberately fixed error code; never includes a path or UI payload."""


def _require(condition: bool, code: str) -> None:
    if not condition:
        raise DatasetError(code)


def _identifier(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,159}", value) is not None


def _text(value: Any, maximum: int = 2048) -> bool:
    return (isinstance(value, str) and 0 < len(value) <= maximum
            and all(ord(character) >= 32 for character in value))


def _keys(value: Any, required: set, optional: set = frozenset()) -> None:
    _require(isinstance(value, dict) and required <= set(value) <= required | optional, "invalid_fields")


def _pairs(items):
    result = {}
    for key, value in items:
        _require(key not in result, "duplicate_json_key")
        result[key] = value
    return result


def _decode(raw: bytes):
    def reject(_value):
        raise DatasetError("nonfinite_json")
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs, parse_constant=reject)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise DatasetError("invalid_json") from None


def _read_bytes(path: Path) -> bytes:
    try:
        with path.open("rb") as stream:
            raw = stream.read(MAX_JSON_BYTES + 1)
    except OSError:
        raise DatasetError("artifact_unreadable") from None
    _require(len(raw) <= MAX_JSON_BYTES, "artifact_too_large")
    return raw


class _Artifacts:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.digests = set()

    def read(self, reference: Mapping[str, Any], *, json_data: bool = True):
        _keys(reference, {"path", "sha256"})
        relative = reference["path"]
        _require(_text(relative, 512) and "\\" not in relative and ":" not in relative,
                 "invalid_artifact_path")
        name = Path(relative)
        _require(not name.is_absolute() and ".." not in name.parts, "artifact_outside_dataset")
        # Code security: first implementation following path-traversal guidance;
        # manifest references stay within the explicitly chosen local dataset root,
        # including after resolving symlinks. Read once, then hash those same bytes.
        try:
            source = (self.root / name).resolve()
            source.relative_to(self.root)
        except (ValueError, OSError, RuntimeError):
            raise DatasetError("artifact_outside_dataset") from None
        digest = reference["sha256"]
        _require(isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest) is not None,
                 "invalid_sha256")
        raw = _read_bytes(source)
        _require(hashlib.sha256(raw).hexdigest() == digest, "artifact_digest_mismatch")
        self.digests.add(digest)
        return _decode(raw) if json_data else raw


def _configuration_provenance(value: Any, cases: Mapping[str, Any], groups: Mapping[str, Any]) -> None:
    _require(isinstance(value, dict), "invalid_configuration_provenance")
    if value.get("kind") == "predeclared":
        _keys(value, {"kind", "reference"})
        _require(_text(value["reference"]), "invalid_configuration_provenance")
    elif value.get("kind") == "development":
        _keys(value, {"kind", "caseIds"})
        identifiers = value["caseIds"]
        _require(isinstance(identifiers, list) and 1 <= len(identifiers) <= 5000
                 and all(_identifier(item) for item in identifiers), "invalid_configuration_provenance")
        for identifier in identifiers:
            _require(identifier in cases and groups[cases[identifier]["groupId"]]["split"] != "test",
                     "test_label_leakage")
    else:
        raise DatasetError("invalid_configuration_provenance")


def _rules(value: Any, cases: Mapping[str, Any], groups: Mapping[str, Any]) -> dict:
    _keys(value, {"schemaVersion", "mappings"})
    _require(value["schemaVersion"] == RULES_SCHEMA and isinstance(value["mappings"], list)
             and len(value["mappings"]) <= 5000, "invalid_rules")
    result = {}
    for mapping in value["mappings"]:
        _keys(mapping, {"goal", "provenance"}, {"resourceSelector", "exactText"})
        goal = mapping["goal"]
        _require(_text(goal) and goal not in result, "invalid_goal_mapping")
        _require("resourceSelector" in mapping or "exactText" in mapping, "empty_goal_mapping")
        _configuration_provenance(mapping["provenance"], cases, groups)
        if "resourceSelector" in mapping:
            selector = mapping["resourceSelector"]
            _require(isinstance(selector, dict) and "resourceId" in selector
                     and set(selector) <= SELECTOR_FIELDS
                     and all(_text(item) for item in selector.values()), "invalid_resource_selector")
        if "exactText" in mapping:
            _require(_text(mapping["exactText"], 512), "invalid_text_mapping")
        result[goal] = copy.deepcopy(mapping)
    return result


def load_dataset(manifest_path: Path) -> dict:
    """Validate all splits and all digests before any model is called."""
    path = Path(manifest_path).expanduser().resolve()
    raw = _read_bytes(path)
    manifest = _decode(raw)
    _keys(manifest, {"schemaVersion", "datasetId", "frozenAt", "ruleConfig", "policies", "groups", "cases"},
          {"maintenance"})
    _require(manifest["schemaVersion"] == DATASET_SCHEMA and _identifier(manifest["datasetId"])
             and _text(manifest["frozenAt"], 64), "invalid_manifest")
    _require(isinstance(manifest["groups"], list) and 1 <= len(manifest["groups"]) <= 5000
             and isinstance(manifest["cases"], list) and 1 <= len(manifest["cases"]) <= 5000,
             "invalid_dataset_size")
    try:
        frozen_at = datetime.fromisoformat(manifest["frozenAt"].replace("Z", "+00:00"))
        _require(frozen_at.tzinfo is not None, "invalid_freeze_timestamp")
    except ValueError:
        raise DatasetError("invalid_freeze_timestamp") from None
    artifacts = _Artifacts(path.parent)
    capture_splits, observation_splits = {}, {}
    groups, cases, source_splits, family_splits = {}, {}, {}, {}
    for group in manifest["groups"]:
        _keys(group, {"id", "split", "sourcePageId", "layoutFamilyId", "provenance"})
        _require(all(_identifier(group[key]) for key in ("id", "sourcePageId", "layoutFamilyId"))
                 and isinstance(group["split"], str) and group["split"] in SPLITS
                 and group["id"] not in groups, "invalid_group")
        for registry, key in ((source_splits, "sourcePageId"), (family_splits, "layoutFamilyId")):
            previous = registry.setdefault(group[key], group["split"])
            _require(previous == group["split"], "group_split_leakage")
        groups[group["id"]] = copy.deepcopy(group)
    for group in groups.values():
        provenance = group["provenance"]
        _require(isinstance(provenance, dict), "invalid_capture_provenance")
        kind = provenance.get("kind")
        if kind == "real_capture":
            _keys(provenance, {"kind", "source"}, {"capturedAt"})
            artifacts.read(provenance["source"], json_data=False)
            previous = capture_splits.setdefault(provenance["source"]["sha256"], group["split"])
            _require(previous == group["split"], "capture_split_leakage")
            if "capturedAt" in provenance:
                _require(_text(provenance["capturedAt"], 64), "invalid_capture_provenance")
        elif kind == "derived":
            _keys(provenance, {"kind", "parentGroupId", "transformation"})
            parent_id = provenance["parentGroupId"]
            _require(_identifier(parent_id) and parent_id in groups and parent_id != group["id"]
                     and _text(provenance["transformation"]), "invalid_capture_provenance")
            parent = groups[parent_id]
            _require(parent["split"] == group["split"] and parent["sourcePageId"] == group["sourcePageId"]
                     and parent["layoutFamilyId"] == group["layoutFamilyId"], "derived_group_leakage")
        elif kind == "synthetic":
            _keys(provenance, {"kind", "description"})
            _require(_text(provenance["description"]), "invalid_capture_provenance")
        else:
            raise DatasetError("invalid_capture_provenance")
    for group in groups.values():
        visited, current = set(), group
        while current["provenance"].get("kind") == "derived":
            _require(current["id"] not in visited, "derived_group_cycle")
            visited.add(current["id"])
            parent_id = current["provenance"].get("parentGroupId")
            _require(isinstance(parent_id, str) and parent_id in groups, "invalid_capture_provenance")
            current = groups[parent_id]
    for case in manifest["cases"]:
        _keys(case, {"id", "groupId", "policyId", "context", "expected", "tags"}, {"judgeLabels"})
        _require(all(_identifier(case[key]) for key in ("id", "groupId", "policyId"))
                 and case["id"] not in cases and case["groupId"] in groups, "invalid_case")
        _keys(case["expected"], {"outcome", "nodeIds"})
        expected = case["expected"]
        _require(expected["outcome"] in ("act", "refuse") and isinstance(expected["nodeIds"], list)
                 and len(expected["nodeIds"]) <= 8
                 and all(_text(item, 160) for item in expected["nodeIds"])
                 and len(set(expected["nodeIds"])) == len(expected["nodeIds"])
                 and bool(expected["nodeIds"]) == (expected["outcome"] == "act"), "invalid_expected")
        _require(isinstance(case["tags"], list) and len(case["tags"]) <= 32
                 and all(_identifier(tag) for tag in case["tags"]), "invalid_tags")
        cases[case["id"]] = copy.deepcopy(case)
    rules = _rules(artifacts.read(manifest["ruleConfig"]), cases, groups)
    policies = {}
    _require(isinstance(manifest["policies"], dict) and 1 <= len(manifest["policies"]) <= 100,
             "invalid_policies")
    for identifier, reference in manifest["policies"].items():
        _require(_identifier(identifier), "invalid_policy_id")
        _keys(reference, {"path", "sha256", "provenance"})
        _configuration_provenance(reference["provenance"], cases, groups)
        try:
            policies[identifier] = validate_policy(artifacts.read({key: reference[key] for key in ("path", "sha256")}))
        except DatasetError:
            raise
        except Exception:
            raise DatasetError("invalid_policy") from None
    judge_run_keys = set()
    for case in cases.values():
        _require(case["policyId"] in policies, "unknown_policy")
        context = artifacts.read(case["context"])
        _keys(context, {"stepId", "goal", "allowedActions", "observation"})
        _require(_identifier(context["stepId"]) and _text(context["goal"])
                 and isinstance(context["allowedActions"], list)
                 and all(isinstance(item, str) for item in context["allowedActions"])
                 and isinstance(context["observation"], dict), "invalid_context")
        _require(context["stepId"] in policies[case["policyId"]]["steps"], "unknown_policy_step")
        try:
            nodes = _nodes(context["observation"]["page"])
        except (KeyError, ValueError, TypeError):
            raise DatasetError("invalid_observation") from None
        # Relabeling group IDs cannot make the exact same tree a held-out page.
        page_digest = hashlib.sha256(json.dumps(context["observation"]["page"], sort_keys=True,
                                               ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()
        previous = observation_splits.setdefault(page_digest, groups[case["groupId"]]["split"])
        _require(previous == groups[case["groupId"]]["split"], "observation_split_leakage")
        observed_ids = {node.get("nodeId") for node in nodes if isinstance(node.get("nodeId"), str)}
        _require(set(case["expected"]["nodeIds"]) <= observed_ids, "expected_node_not_observed")
        case["loadedContext"] = context
        labels = case.get("judgeLabels", [])
        _require(isinstance(labels, list) and len(labels) <= 3, "invalid_judge_labels")
        seen = set()
        for label in labels:
            _keys(label, {"provider", "businessOutcome", "verdict", "runId", "independentJudge", "evidence"})
            _require(isinstance(label["provider"], str) and label["provider"] in PROVIDERS
                     and label["provider"] not in seen and label["businessOutcome"] in ("pass", "fail")
                     and label["verdict"] in ("pass", "fail", "not_tested")
                     and _identifier(label["runId"]) and label["independentJudge"] is True,
                     "invalid_judge_labels")
            seen.add(label["provider"])
            run_key = (label["provider"], label["runId"])
            _require(run_key not in judge_run_keys, "duplicate_judge_run")
            judge_run_keys.add(run_key)
            artifacts.read(label["evidence"], json_data=False)
    maintenance = {"available": False, "reason": "explicit_before_after_configs_not_supplied"}
    if "maintenance" in manifest:
        change = manifest["maintenance"]
        _keys(change, {"before", "after"})
        before = _rules(artifacts.read(change["before"]), cases, groups)
        after = _rules(artifacts.read(change["after"]), cases, groups)
        added, removed = set(after) - set(before), set(before) - set(after)
        def content(mapping):
            return {key: value for key, value in mapping.items() if key != "provenance"}
        changed = [goal for goal in set(before) & set(after) if content(before[goal]) != content(after[goal])]
        maintenance = {"available": True, "unit": "goal_mapping_changes", "added": len(added),
                       "removed": len(removed), "modified": len(changed),
                       "beforeDigest": change["before"]["sha256"], "afterDigest": change["after"]["sha256"],
                       "limitation": "Configuration delta only; no inferred human effort or scripts saved."}
    return {"manifest": manifest, "manifestDigest": hashlib.sha256(raw).hexdigest(), "groups": groups,
            "cases": cases, "policies": policies, "rules": rules, "maintenance": maintenance,
            "verifiedArtifactDigests": sorted(artifacts.digests)}


def _rule_decision(kind: str, context: dict, mapping: Optional[dict], gate: dict) -> dict:
    receipt = gate["modelReceipt"]
    candidates = receipt["candidates"]
    if not candidates or gate["type"] == "done" or receipt["reason"] != "exact_text_not_unique":
        return gate
    field = "resourceSelector" if kind == "resource_id" else "exactText"
    if mapping is None or field not in mapping:
        return {"type": "blocked", "reason": "goal_not_configured"}
    if kind == "resource_id":
        nodes = {node.get("nodeId"): node for node in _nodes(context["observation"]["page"])
                 if isinstance(node.get("nodeId"), str)}
        # A stable ID may belong to either the semantic label or its clickable
        # container. Treat each eligible action as one match so the ID baseline
        # is not artificially weakened by the model's label extraction strategy.
        matches = [candidate for candidate in candidates.values()
                   if any(all(nodes[node_id].get(key) == value for key, value in mapping[field].items())
                          for node_id in {candidate.get("sourceNodeId", candidate["nodeId"]), candidate["nodeId"]})]
    else:
        matches = [candidate for candidate in candidates.values() if candidate["label"] == mapping[field]]
    if len(matches) != 1:
        return {"type": "blocked", "reason": "rule_match_not_unique"}
    return {"type": "act", "action": copy.deepcopy(matches[0]["action"]), "reason": "configured_rule_match"}


def _rate(numerator: int, denominator: int):
    return numerator / denominator if denominator else None


def _summarize(rows: list, labels: list) -> dict:
    positives = [row for row in rows if row["expectedOutcome"] == "act"]
    negatives = [row for row in rows if row["expectedOutcome"] == "refuse"]
    acted = [row for row in rows if row["decisionType"] == "act"]
    wrong = [row for row in acted if not row["correct"]]
    false_pass = sum(label["businessOutcome"] == "fail" and label["verdict"] == "pass" for label in labels)
    failed_truth = sum(label["businessOutcome"] == "fail" for label in labels)
    return {"cases": len(rows), "positiveCases": len(positives), "negativeCases": len(negatives),
            "correctActions": sum(row["correct"] for row in positives),
            "correctActionRate": _rate(sum(row["correct"] for row in positives), len(positives)),
            "candidateCoveredPositiveCases": sum(row["targetInCandidatePool"] for row in positives),
            "candidateCoverage": _rate(sum(row["targetInCandidatePool"] for row in positives), len(positives)),
            "issuedActions": len(acted), "wrongActions": len(wrong),
            "modelCalls": sum(row["modelCalls"] for row in rows),
            "wrongActionRatePerDecision": _rate(len(wrong), len(rows)),
            "wrongActionRateAmongIssued": _rate(len(wrong), len(acted)),
            "nonActionTerminations": sum(row["decisionType"] == "done" for row in rows),
            "positiveRefusals": sum(row["decisionType"] == "blocked" for row in positives),
            "negativeRefusals": sum(row["decisionType"] == "blocked" for row in negatives),
            "negativeActionErrors": sum(row["decisionType"] == "act" for row in negatives),
            "refusalReasons": {reason: sum(row["reason"] == reason and row["decisionType"] == "blocked" for row in rows)
                               for reason in sorted({row["reason"] for row in rows if row["decisionType"] == "blocked"})},
            "medianDecisionMs": statistics.median(row["decisionMs"] for row in rows) if rows else None,
            "verifierFalsePass": {"available": bool(labels), "labeledRuns": len(labels),
                                  "businessFailureRuns": failed_truth, "falsePasses": false_pass if labels else None,
                                  "rateAmongBusinessFailures": _rate(false_pass, failed_truth),
                                  "basis": "supplied_independent_real_run_labels" if labels else "not_measured_offline"}}


def evaluate_dataset(manifest_path: Path, *, predictor: Optional[Callable] = None,
                     split: str = "test", model_version: str = "injected-predictor") -> dict:
    """Compare frozen ID/text baselines and optionally the existing Laya adapter.

    The injected callable receives the provider request only, never case labels,
    IDs, source paths, provenance, train/dev examples, or judge verdicts.
    """
    _require(isinstance(split, str) and split in SPLITS, "invalid_split")
    dataset = load_dataset(manifest_path)
    selected = [case for case in dataset["cases"].values()
                if dataset["groups"][case["groupId"]]["split"] == split]
    _require(bool(selected), "empty_split")
    rows, judge_labels = [], {name: [] for name in PROVIDERS}
    for case in selected:
        context, policy = case["loadedContext"], dataset["policies"][case["policyId"]]
        # Remove exactText so the rules provider collects only eligible candidates;
        # this avoids adding a magic text that could accidentally match a UI label.
        probe_policy = copy.deepcopy(policy)
        probe_policy["steps"][context["stepId"]].pop("exactText", None)
        gate_started = time.perf_counter()
        gate = FastPathDecisionProvider(probe_policy, mode="rules").decide(copy.deepcopy(context))
        gate_ms = (time.perf_counter() - gate_started) * 1000
        candidates = gate["modelReceipt"]["candidates"]
        correct_ids = set(case["expected"]["nodeIds"])
        covered = bool(correct_ids & {item["nodeId"] for item in candidates.values()})
        for name in ("resource_id", "text", "laya"):
            if name == "laya" and predictor is None:
                continue
            started = time.perf_counter()
            calls = 0
            def counted_predictor(request):
                nonlocal calls
                calls += 1
                return predictor(request)
            if name == "laya":
                provider = FastPathDecisionProvider(policy, predictor=counted_predictor, model_version=model_version)
                decision = provider.decide(copy.deepcopy(context))
                elapsed = (time.perf_counter() - started) * 1000
            else:
                decision = _rule_decision(name, context, dataset["rules"].get(context["goal"]), gate)
                elapsed = gate_ms + (time.perf_counter() - started) * 1000
            kind = decision["type"]
            correct = (decision.get("action", {}).get("nodeId") in correct_ids if kind == "act"
                       else kind == "blocked" and case["expected"]["outcome"] == "refuse")
            group = dataset["groups"][case["groupId"]]
            # Code security: fixed output schema excludes raw goals, UI labels, node
            # IDs, paths, model payloads, and arbitrary exception messages.
            rows.append({"caseId": case["id"], "groupId": case["groupId"], "provider": name,
                         "provenanceKind": group["provenance"]["kind"], "tags": case["tags"],
                         "expectedOutcome": case["expected"]["outcome"], "decisionType": kind,
                         "reason": decision.get("reason", decision.get("modelReceipt", {}).get("reason", "unknown")),
                         "correct": correct, "candidateCount": len(candidates),
                         "targetInCandidatePool": covered, "decisionMs": round(elapsed, 3),
                         "modelCalls": calls,
                         "selectedProbability": decision.get("modelReceipt", {}).get("selectedProbability"),
                         "margin": decision.get("modelReceipt", {}).get("margin")})
        for label in case.get("judgeLabels", []):
            judge_labels[label["provider"]].append(label)
    summary = {name: _summarize([row for row in rows if row["provider"] == name], judge_labels[name])
               for name in ("resource_id", "text", "laya") if any(row["provider"] == name for row in rows)}
    comparisons = {}
    if predictor is not None:
        by_key = {(row["caseId"], row["provider"]): row for row in rows}
        for baseline in ("resource_id", "text"):
            gained, lost = [], []
            for case in selected:
                if case["expected"]["outcome"] != "act":
                    continue
                model_ok = by_key[(case["id"], "laya")]["correct"]
                baseline_ok = by_key[(case["id"], baseline)]["correct"]
                if model_ok and not baseline_ok:
                    gained.append(case["id"])
                elif baseline_ok and not model_ok:
                    lost.append(case["id"])
            comparisons[baseline] = {"additionalCorrectCases": gained, "lostCorrectCases": lost,
                                     "netAdditionalCorrect": len(gained) - len(lost)}
    groups = {case["groupId"] for case in selected}
    by_tag = {tag: {name: _summarize([row for row in rows if row["provider"] == name and tag in row["tags"]], [])
                    for name in summary}
              for tag in sorted({tag for case in selected for tag in case["tags"]})}
    return {"schemaVersion": REPORT_SCHEMA, "datasetId": dataset["manifest"]["datasetId"], "split": split,
            "manifestDigest": dataset["manifestDigest"], "frozenAt": dataset["manifest"]["frozenAt"],
            "promptTemplateVersion": PROMPT_TEMPLATE_VERSION,
            "modelVersion": model_version if predictor is not None else None,
            "verifiedArtifactDigests": dataset["verifiedArtifactDigests"],
            "sampleCounts": {"cases": len(selected), "groups": len(groups),
                             "sourcePages": len({dataset["groups"][group]["sourcePageId"] for group in groups}),
                             "layoutFamilies": len({dataset["groups"][group]["layoutFamilyId"] for group in groups}),
                             "provenance": {kind: sum(dataset["groups"][case["groupId"]]["provenance"]["kind"] == kind
                                                      for case in selected)
                                            for kind in ("real_capture", "derived", "synthetic")}},
            "summary": summary, "byTag": by_tag, "incrementalCoverage": comparisons, "maintenance": dataset["maintenance"],
            "limitations": ["Offline action proposals only; no device action or business result is executed.",
                            "Group provenance and predeclared configuration are declarations, not independently attested.",
                            "Sibling expressions and derived variants are correlated; case count is not independent task count.",
                            "Decision timings exclude device capture, transport, replay, cleanup and evidence export.",
                            "Predictor state and tuning history are caller-controlled; held-out labels must not be used for tuning."],
            "samples": rows}
