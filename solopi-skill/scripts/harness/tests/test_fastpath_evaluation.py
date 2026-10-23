"""Synthetic unit fixtures only: these are not phone captures or model evidence."""
import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from solopi_harness.fastpath_evaluation import DATASET_SCHEMA, RULES_SCHEMA, DatasetError, evaluate_dataset, load_dataset

PACKAGE = "org.example.synthetic"
PREDECLARED = {"kind": "predeclared", "reference": "Synthetic unit fixture authored before evaluation"}


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.goal = "Open delivery status"
        self.context = {"stepId": "choose", "goal": self.goal, "allowedActions": ["click"],
                        "observation": {"observationId": "synthetic-observation", "page": {
                            "packageName": PACKAGE, "children": [self.node("order", "order", "Order details"),
                                self.node("delivery", "delivery", "Track shipment"),
                                self.node("support", "support", "Contact support")]}}}
        self.policy = {"schemaVersion": "solopi.ai.fastpath-policy/v1", "targetPackage": PACKAGE,
                       "steps": {"choose": {"instructions": "Choose the requested action or abstain.",
                                            "stopWhen": {"selector": {"resourceId": "finished"}, "field": "text", "equals": "Done"},
                                            "candidateSelectors": [{"resourceId": key} for key in ("order", "delivery", "support")]}}}
        self.rules = {"schemaVersion": RULES_SCHEMA, "mappings": [{"goal": self.goal,
                      "resourceSelector": {"resourceId": "delivery"}, "exactText": "Delivery status",
                      "provenance": copy.deepcopy(PREDECLARED)}]}
        self.manifest = {"schemaVersion": DATASET_SCHEMA, "datasetId": "synthetic-unit-only",
                         "frozenAt": "2026-09-27T00:00:00Z", "ruleConfig": self.write("rules.json", self.rules),
                         "policies": {"common": dict(self.write("policy.json", self.policy), provenance=copy.deepcopy(PREDECLARED))},
                         "groups": [self.group("test")], "cases": [self.case("positive", "test", self.context, ["delivery"])]}
        self.save()

    def node(self, node_id, resource, text):
        return {"nodeId": node_id, "resourceId": resource, "text": text, "packageName": PACKAGE,
                "visible": True, "isEnabled": True, "isClickable": True}

    def write(self, name, value):
        raw = json.dumps(value, ensure_ascii=False).encode("utf-8")
        (self.root / name).write_bytes(raw)
        return {"path": name, "sha256": hashlib.sha256(raw).hexdigest()}

    def save(self):
        self.write("manifest.json", self.manifest)
        return self.root / "manifest.json"

    def group(self, split, identifier=None):
        identifier = identifier or split
        return {"id": identifier, "split": split, "sourcePageId": "source-" + identifier,
                "layoutFamilyId": "layout-" + identifier,
                "provenance": {"kind": "synthetic", "description": "Synthetic unit fixture; not captured on phone"}}

    def case(self, identifier, group, context, targets):
        return {"id": identifier, "groupId": group, "policyId": "common", "context": self.write(identifier + ".json", context),
                "expected": {"outcome": "act" if targets else "refuse", "nodeIds": targets}, "tags": ["synthetic"]}

    def predictor(self, choice="candidate_1"):
        def predict(request):
            criteria = request["questions"]["action"]["criteria"]
            probabilities = {key: (1.0 if key == choice else 0.0) for key in criteria}
            return {"answers": {"action": {"choice": choice, "probs": probabilities}}}
        return mock.Mock(side_effect=predict)

    def evaluate(self, **kwargs):
        return evaluate_dataset(self.save(), **kwargs)

    def test_id_baseline_survives_renaming_and_model_gain_is_not_invented(self):
        result = self.evaluate(predictor=self.predictor())
        self.assertEqual(1, result["summary"]["resource_id"]["correctActions"])
        self.assertEqual(0, result["summary"]["text"]["correctActions"])
        self.assertEqual([], result["incrementalCoverage"]["resource_id"]["additionalCorrectCases"])
        self.assertEqual(["positive"], result["incrementalCoverage"]["text"]["additionalCorrectCases"])
        self.assertFalse(result["summary"]["laya"]["verifierFalsePass"]["available"])
        self.assertFalse(result["maintenance"]["available"])

    def test_labels_raw_ui_paths_and_node_ids_do_not_reach_predictor_or_report(self):
        predictor = self.predictor()
        result = self.evaluate(predictor=predictor)
        request = predictor.call_args.args[0]
        self.assertEqual({"state", "questions", "model"}, set(request))
        self.assertNotIn("expected", json.dumps(request))
        serialized = json.dumps(result)
        for forbidden in (self.goal, "Track shipment", "positive.json", "source-test", "nodeId", str(self.root)):
            self.assertNotIn(forbidden, serialized)

    def test_no_match_wrong_action_and_model_abstention_are_separate(self):
        negative = copy.deepcopy(self.context)
        negative["goal"] = "Pay an invoice"
        self.manifest["cases"].append(self.case("no-match", "test", negative, []))
        result = self.evaluate(predictor=self.predictor())
        summary = result["summary"]["laya"]
        self.assertEqual(1, summary["negativeActionErrors"])
        self.assertEqual(2, summary["modelCalls"])
        self.assertEqual(0.5, summary["wrongActionRateAmongIssued"])
        self.assertEqual(1, result["summary"]["resource_id"]["negativeRefusals"])
        result = self.evaluate(predictor=self.predictor("abstain"))
        self.assertEqual(1, result["summary"]["laya"]["positiveRefusals"])
        self.assertEqual(1, result["summary"]["laya"]["negativeRefusals"])
        self.assertEqual(0, result["summary"]["laya"]["wrongActions"])

    def test_disabled_node_blocks_all_providers_without_calling_model(self):
        self.context["observation"]["page"]["children"][1]["isEnabled"] = False
        self.manifest["cases"] = [self.case("disabled", "test", self.context, [])]
        predictor = self.predictor()
        result = self.evaluate(predictor=predictor)
        predictor.assert_not_called()
        for summary in result["summary"].values():
            self.assertEqual(1, summary["negativeRefusals"])
            self.assertEqual({"candidate_not_actionable": 1}, summary["refusalReasons"])
            self.assertEqual(0, summary["modelCalls"])

    def test_ambiguous_selector_is_a_guard_refusal_not_model_semantic_accuracy(self):
        duplicate = self.node("another-delivery", "delivery", "Track shipment")
        self.context["observation"]["page"]["children"].append(duplicate)
        self.manifest["cases"] = [self.case("ambiguous", "test", self.context, [])]
        predictor = self.predictor()
        result = self.evaluate(predictor=predictor)
        predictor.assert_not_called()
        self.assertEqual({"ambiguous_candidate": 1}, result["summary"]["laya"]["refusalReasons"])
        self.assertEqual(0, result["summary"]["laya"]["modelCalls"])

    def test_low_margin_positive_refusal_keeps_score_without_counting_a_wrong_action(self):
        self.policy["steps"]["choose"]["minMargin"] = 0.2
        self.manifest["policies"]["common"].update(self.write("policy.json", self.policy))
        predictor = mock.Mock(return_value={"answers": {"action": {"choice": "candidate_1", "probs": {
            "candidate_0": 0.3, "candidate_1": 0.4, "candidate_2": 0.2, "abstain": 0.1}}}})
        result = self.evaluate(predictor=predictor)
        summary = result["summary"]["laya"]
        self.assertEqual(1, summary["positiveRefusals"])
        self.assertEqual(0, summary["wrongActions"])
        row = next(row for row in result["samples"] if row["provider"] == "laya")
        self.assertAlmostEqual(0.1, row["margin"])
        self.assertEqual(0.4, row["selectedProbability"])
        self.assertEqual(1, result["byTag"]["synthetic"]["laya"]["positiveRefusals"])

    def test_candidate_coverage_distinguishes_missing_candidate_from_wrong_model(self):
        self.policy["steps"]["choose"]["candidateSelectors"] = [{"resourceId": "order"}]
        self.manifest["policies"]["common"].update(self.write("policy.json", self.policy))
        result = self.evaluate(predictor=self.predictor("candidate_0"))
        self.assertEqual(0, result["summary"]["laya"]["candidateCoveredPositiveCases"])
        self.assertEqual(1, result["summary"]["laya"]["wrongActions"])

    def test_source_or_layout_family_cannot_cross_splits(self):
        for field in ("sourcePageId", "layoutFamilyId"):
            dev = self.group("dev")
            dev[field] = self.manifest["groups"][0][field]
            self.manifest["groups"] = [self.group("test"), dev]
            with self.subTest(field=field), self.assertRaisesRegex(DatasetError, "group_split_leakage"):
                self.evaluate()

    def test_derived_variants_keep_parent_split_and_are_not_real_captures(self):
        derived = self.group("test", "variant")
        derived.update(sourcePageId="source-test", layoutFamilyId="layout-test")
        derived["provenance"] = {"kind": "derived", "parentGroupId": "test", "transformation": "Reordered synthetic children"}
        self.manifest["groups"].append(derived)
        self.manifest["cases"].append(self.case("derived", "variant", self.context, ["delivery"]))
        result = self.evaluate()
        self.assertEqual({"real_capture": 0, "derived": 1, "synthetic": 1}, result["sampleCounts"]["provenance"])
        self.assertEqual(1, result["sampleCounts"]["sourcePages"])
        self.manifest["groups"][1]["sourcePageId"] = "false-independent-source"
        with self.assertRaisesRegex(DatasetError, "derived_group_leakage"):
            self.evaluate()

    def test_rule_or_policy_development_source_cannot_reference_test_label(self):
        bad_source = {"kind": "development", "caseIds": ["positive"]}
        self.rules["mappings"][0]["provenance"] = bad_source
        self.manifest["ruleConfig"] = self.write("rules.json", self.rules)
        with self.assertRaisesRegex(DatasetError, "test_label_leakage"):
            self.evaluate()
        self.rules["mappings"][0]["provenance"] = PREDECLARED
        self.manifest["ruleConfig"] = self.write("rules.json", self.rules)
        self.manifest["policies"]["common"]["provenance"] = bad_source
        with self.assertRaisesRegex(DatasetError, "test_label_leakage"):
            self.evaluate()

    def test_development_mapping_can_be_frozen_and_used_on_unseen_test_family(self):
        self.manifest["groups"].append(self.group("dev"))
        dev_context = copy.deepcopy(self.context)
        dev_context["observation"]["page"]["children"][1]["text"] = "Delivery status"
        self.manifest["cases"].append(self.case("development", "dev", dev_context, ["delivery"]))
        self.rules["mappings"][0]["provenance"] = {"kind": "development", "caseIds": ["development"]}
        self.manifest["ruleConfig"] = self.write("rules.json", self.rules)
        result = self.evaluate()
        self.assertEqual(1, result["sampleCounts"]["cases"])
        self.assertEqual(1, result["summary"]["resource_id"]["correctActions"])

    def test_all_artifacts_checked_before_prediction_including_non_selected_split(self):
        self.manifest["groups"].append(self.group("dev"))
        self.manifest["cases"].append(self.case("dev-case", "dev", self.context, ["delivery"]))
        (self.root / "dev-case.json").write_text('{}', encoding="utf-8")
        predictor = self.predictor()
        with self.assertRaisesRegex(DatasetError, "artifact_digest_mismatch"):
            self.evaluate(predictor=predictor)
        predictor.assert_not_called()

    def test_identical_tree_cannot_be_relabeled_into_another_split(self):
        self.manifest["groups"].append(self.group("dev"))
        self.manifest["cases"].append(self.case("dev-copy", "dev", self.context, ["delivery"]))
        with self.assertRaisesRegex(DatasetError, "observation_split_leakage"):
            self.evaluate()

    def test_identical_capture_cannot_be_relabeled_into_another_split(self):
        source = self.write("capture.json", {"syntheticCaptureFixture": True})
        self.manifest["groups"][0]["provenance"] = {"kind": "real_capture", "source": source}
        dev = self.group("dev")
        dev["provenance"] = {"kind": "real_capture", "source": source}
        self.manifest["groups"].append(dev)
        with self.assertRaisesRegex(DatasetError, "capture_split_leakage"):
            self.evaluate()

    def test_derived_cycle_fails_closed(self):
        first, second = self.group("test", "one"), self.group("test", "two")
        for group, parent in ((first, "two"), (second, "one")):
            group.update(sourcePageId="same", layoutFamilyId="same")
            group["provenance"] = {"kind": "derived", "parentGroupId": parent, "transformation": "Synthetic cycle"}
        self.manifest["groups"].extend([first, second])
        with self.assertRaisesRegex(DatasetError, "derived_group_cycle"):
            self.evaluate()

    def test_path_traversal_absolute_path_and_symlink_escape_rejected(self):
        outside = self.root.parent / (self.root.name + "-outside.json")
        outside.write_text('{}', encoding="utf-8")
        self.addCleanup(lambda: outside.unlink(missing_ok=True))
        (self.root / "escape.json").symlink_to(outside)
        for path in ("../" + outside.name, str(outside), "escape.json"):
            self.manifest["ruleConfig"] = {"path": path, "sha256": hashlib.sha256(b'{}').hexdigest()}
            with self.subTest(path=path), self.assertRaisesRegex(DatasetError, "artifact_outside_dataset"):
                self.evaluate()

    def test_duplicate_json_fields_nonfinite_and_digest_tampering_rejected(self):
        for raw, error in ((b'{"a":1,"a":2}', "duplicate_json_key"), (b'{"a":NaN}', "nonfinite_json")):
            (self.root / "rules.json").write_bytes(raw)
            self.manifest["ruleConfig"]["sha256"] = hashlib.sha256(raw).hexdigest()
            with self.subTest(error=error), self.assertRaisesRegex(DatasetError, error):
                self.evaluate()

    def test_real_capture_requires_digest_verified_source_and_does_not_publish_it(self):
        capture = self.write("private-capture.json", {"privateAccount": "unit-test-sensitive"})
        self.manifest["groups"][0]["provenance"] = {"kind": "real_capture", "source": capture}
        result = self.evaluate()
        self.assertEqual(1, result["sampleCounts"]["provenance"]["real_capture"])
        self.assertNotIn("unit-test-sensitive", json.dumps(result))
        (self.root / "private-capture.json").write_text('{}', encoding="utf-8")
        with self.assertRaisesRegex(DatasetError, "artifact_digest_mismatch"):
            self.evaluate()

    def test_false_pass_needs_supplied_independent_actual_judge_evidence(self):
        label = {"provider": "resource_id", "businessOutcome": "fail", "verdict": "pass", "runId": "actual-run-1",
                 "independentJudge": True, "evidence": self.write("judge.json", {"fixtureOnly": True})}
        self.manifest["cases"][0]["judgeLabels"] = [label]
        result = self.evaluate()
        self.assertEqual(1.0, result["summary"]["resource_id"]["verifierFalsePass"]["rateAmongBusinessFailures"])
        self.assertFalse(result["summary"]["text"]["verifierFalsePass"]["available"])
        label["independentJudge"] = False
        with self.assertRaisesRegex(DatasetError, "invalid_judge_labels"):
            self.evaluate()

    def test_same_judge_run_cannot_inflate_denominator_through_multiple_cases(self):
        label = {"provider": "resource_id", "businessOutcome": "fail", "verdict": "fail", "runId": "same-run",
                 "independentJudge": True, "evidence": self.write("judge.json", {"fixtureOnly": True})}
        self.manifest["cases"][0]["judgeLabels"] = [label]
        repeated = self.case("another-expression", "test", self.context, ["delivery"])
        repeated["judgeLabels"] = [copy.deepcopy(label)]
        self.manifest["cases"].append(repeated)
        with self.assertRaisesRegex(DatasetError, "duplicate_judge_run"):
            self.evaluate()

    def test_maintenance_counts_explicit_config_delta_without_inventing_saved_work(self):
        after = copy.deepcopy(self.rules)
        after["mappings"][0]["exactText"] = "Track shipment"
        self.manifest["maintenance"] = {"before": self.manifest["ruleConfig"], "after": self.write("after.json", after)}
        result = self.evaluate()
        self.assertEqual(1, result["maintenance"]["modified"])
        self.assertEqual(0, result["maintenance"]["added"])
        self.assertEqual(0, result["maintenance"]["removed"])

    def test_clickable_parent_can_be_selected_by_child_resource_id(self):
        self.context["observation"]["page"]["children"][1] = {
            "nodeId": "container", "packageName": PACKAGE, "visible": True,
            "isEnabled": True, "isClickable": True, "children": [self.node("delivery", "delivery", "Track shipment")]}
        self.context["observation"]["page"]["children"][1]["children"][0]["isClickable"] = False
        self.policy["steps"]["choose"]["candidateResolution"] = "self-or-clickable-ancestor"
        self.manifest["policies"]["common"].update(self.write("policy.json", self.policy))
        self.manifest["cases"] = [self.case("parent", "test", self.context, ["container"])]
        result = self.evaluate(predictor=self.predictor())
        self.assertEqual(1, result["summary"]["resource_id"]["correctActions"])
        self.assertEqual(1, result["summary"]["laya"]["correctActions"])

    def test_stable_id_on_clickable_parent_does_not_artificially_give_model_gain(self):
        label = self.node("delivery", "delivery-label", "Track shipment")
        label["isClickable"] = False
        self.context["observation"]["page"]["children"][1] = {
            "nodeId": "container", "resourceId": "unique-clickable-id", "packageName": PACKAGE,
            "visible": True, "isEnabled": True, "isClickable": True, "children": [label]}
        self.policy["steps"]["choose"]["candidateSelectors"][1] = {"resourceId": "delivery-label"}
        self.policy["steps"]["choose"]["candidateResolution"] = "self-or-clickable-ancestor"
        self.rules["mappings"][0]["resourceSelector"] = {"resourceId": "unique-clickable-id"}
        self.manifest["policies"]["common"].update(self.write("policy.json", self.policy))
        self.manifest["ruleConfig"] = self.write("rules.json", self.rules)
        self.manifest["cases"] = [self.case("parent-id", "test", self.context, ["container"])]
        result = self.evaluate(predictor=self.predictor())
        self.assertEqual(1, result["summary"]["resource_id"]["correctActions"])
        self.assertEqual([], result["incrementalCoverage"]["resource_id"]["additionalCorrectCases"])
        self.assertEqual(0, result["incrementalCoverage"]["resource_id"]["netAdditionalCorrect"])

    def test_inference_error_is_a_refusal_without_raw_exception(self):
        predictor = mock.Mock(side_effect=ValueError("private-token-and-ui"))
        result = self.evaluate(predictor=predictor)
        self.assertEqual({"predictor_unavailable": 1}, result["summary"]["laya"]["refusalReasons"])
        self.assertNotIn("private-token-and-ui", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
