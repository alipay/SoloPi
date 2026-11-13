"""Controlled-input compilation and independent judge; no device or model access."""

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode = True
HARNESS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HARNESS / "src" / "solopi_harness"))
import goalpath
import verification_engine
import solopi_ai

SPEC = importlib.util.spec_from_file_location(
    "prepare_controlled", HARNESS / "examples" / "vision-regression" / "prepare_controlled.py")
controlled = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(controlled)


def node(identifier, text="", **extra):
    result = {"nodeId": identifier, "resourceId": controlled.PACKAGE + ":id/" + identifier,
              "packageName": controlled.PACKAGE, "text": text, "className": "android.widget.Button",
              "visible": True, "isVisibleToUser": True, "isEnabled": True, "isClickable": True,
              "isPassword": False, "nodeBound": {"left": 30, "top": 100, "right": 570, "bottom": 170}}
    result.update(extra)
    return result


def context(variant="normal", unlabeled=False):
    label = "" if unlabeled else "查看"
    children = [node("page_state", "VISUAL_DIALOG" if variant == "dialog" else "VISUAL_ORDERS",
                     className="android.widget.TextView", isClickable=False)]
    if variant != "dialog":
        for identifier in ("visual_a7", "visual_b2", "visual_c9"):
            if identifier == "visual_b2" and variant == "no-target":
                continue
            children.append(node(identifier, label, isEnabled=not (identifier == "visual_b2" and variant == "disabled")))
    children.append(node("reset_button", "返回场景选择"))
    observed = {"observationId": "fixture-current", "page": node(
        "root", "", isClickable=False, className="android.widget.LinearLayout", children=children,
        nodeBound={"left": 0, "top": 0, "right": 600, "bottom": 900})}
    return {"stepId": controlled.STEP, "goal": controlled.GOAL, "allowedActions": ["click"],
            "observation": observed, "visual": {
                "schemaVersion": "solopi.ai.visual-observation/v1", "observationId": "fixture-current",
                "imagePath": "/private/tmp/controlled-test-fixture.png", "sha256": "a" * 64,
                "width": 600, "height": 900, "treeFingerprint": "b" * 64, "attempts": 1}}


class FixtureAdapter:
    def __init__(self, variant, reached=True):
        self.variant, self.reached = variant, reached

    def execute(self, segment, scenario, decisions):
        evidence = [{"type": "automatic_test_fixture", "content": {"segment": segment["segmentId"]}}]
        if segment["route"] != "dynamic":
            return {"state": "passed", "evidence": evidence}
        if not self.reached or self.variant in {"no-target", "dialog", "disabled"}:
            return {"state": "not_tested", "reason": "checkpoint_not_reached", "evidence": evidence}
        actual = "已取消" if self.variant == "wrong-result" else "已支付"
        observed = {"page": {"children": [node("page_state", "DETAIL", isClickable=False),
                                           node("order_status", actual, isClickable=False)]}}
        return {"state": "done", "agentDone": True, "observation": observed, "evidence": evidence}


class PrepareControlledTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="solopi-controlled-tests-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()

    def test_four_groups_nine_variants_compile_into_new_directories(self):
        manifest = controlled.prepare(self.root / "bundle")
        self.assertFalse(manifest["deviceVerified"])
        self.assertEqual("controlled-vision-preparation-settle-v4", manifest["planRevision"])
        self.assertEqual(set(controlled.GROUPS), set(manifest["groups"]))
        count = 0
        for group, details in manifest["groups"].items():
            self.assertEqual(set(controlled.GROUPS[group]["variants"]), set(details["variants"]))
            for variant, paths in details["variants"].items():
                count += 1
                plan = json.loads(Path(paths["plan"]).read_text())
                requirement = json.loads(Path(paths["requirement"]).read_text())
                policy = json.loads(Path(paths["policy"]).read_text())
                verification_engine.validate_verification_plan(plan)
                self.assertEqual(plan["planFingerprint"], paths["planFingerprint"])
                self.assertEqual(plan, verification_engine.compile_verification_plan(requirement))
                self.assertEqual(policy, goalpath.validate_policy(policy))
                self.assertFalse(paths["deviceVerified"])
                for file in [paths["plan"], paths["policy"], paths["requirement"], *paths["cases"]]:
                    self.assertTrue(Path(file).is_relative_to(self.root / "bundle"))
                for file in paths["cases"]:
                    # Use the import/CLI validator as well as plan validation;
                    # malformed replay parameter/selector contracts must fail.
                    case = json.loads(Path(file).read_text())
                    validated = solopi_ai.normalize_case(case)
                    self.assertEqual(case["operationLog"], json.loads(validated["operationLog"]))
                prepared = next(segment for segment in plan["intent"]["scenarios"][0]["segments"]
                                if segment["phase"] == "test" and segment["route"] == "deterministic")
                gestures = prepared["case"]["operationLog"]["steps"][:2]
                self.assertEqual(["GLOBAL_SCROLL_TO_TOP"] * 2,
                                 [step["operationMethod"]["actionEnum"] for step in gestures])
                self.assertEqual([{"scrollDistance": "90"}] * 2,
                                 [step["operationMethod"]["operationParam"] for step in gestures])
                self.assertEqual([None, None], [step["operationNode"] for step in gestures])
                cleanup = next(segment for segment in plan["intent"]["scenarios"][0]["segments"]
                               if segment["phase"] == "cleanup")
                cleanup_steps = cleanup["case"]["operationLog"]["steps"]
                self.assertEqual(["CLICK", "SLEEP", "ASSERT"],
                                 [step["operationMethod"]["actionEnum"] for step in cleanup_steps])
                self.assertEqual({"text": "1200"}, cleanup_steps[1]["operationMethod"]["operationParam"])
                self.assertEqual({"assertMode": "assert_accurate", "assertInputContent": "SCENARIOS"},
                                 cleanup_steps[-1]["operationMethod"]["operationParam"])
        self.assertEqual(9, count)

    def test_every_variant_has_identical_goal_policy_budget_and_fixed_cleanup(self):
        original_policy = controlled.controlled_policy("controlled-icon", "normal")
        for group, details in controlled.GROUPS.items():
            for variant in details["variants"]:
                requirement = controlled.controlled_requirement(group, variant)
                scenario = requirement["scenarios"][0]
                dynamic = next(step for step in scenario["steps"] if step["type"] == "explore")
                self.assertEqual(controlled.GOAL, dynamic["goal"])
                self.assertEqual(["click"], dynamic["allowedActions"])
                self.assertEqual(3, dynamic["budget"]["maxSteps"])
                self.assertEqual(original_policy, controlled.controlled_policy(group, variant))
                self.assertTrue(all(item["required"] for item in scenario["cleanup"]))
                cleanup_id = scenario["cleanup"][0]["action"]["selector"]["resourceId"]
                self.assertTrue(cleanup_id.endswith("visual_dialog_reset" if variant == "dialog" else "reset_button"))
                self.assertEqual(["return-to-scenarios", "settle-scenario-list", "scenario-list-visible"],
                                 [item["id"] for item in scenario["cleanup"]])
                self.assertEqual({"type": "wait", "durationMs": 1200}, scenario["cleanup"][1]["action"])
                self.assertEqual("SCENARIOS", scenario["cleanup"][-1]["oracle"]["expected"])

    def test_fixed_preparation_selects_exact_entry_variant_and_checks_actual_ready_page(self):
        for group, details in controlled.GROUPS.items():
            for index, variant in enumerate(details["variants"]):
                scenario = controlled.controlled_requirement(group, variant)["scenarios"][0]
                steps = {step["id"]: step for step in scenario["steps"]}
                self.assertEqual("SCENARIOS", scenario["preconditions"][0]["oracle"]["expected"])
                for number in (1, 2):
                    self.assertEqual({"type": "scroll", "direction": "up", "distance": 90},
                                     steps["reveal-controlled-groups-%d" % number]["action"])
                self.assertEqual(controlled.selector(details["entry"]), steps["select-group"]["action"]["selector"])
                self.assertEqual(controlled.selector("visual_variant_" + "abc"[index]), steps["select-variant"]["action"]["selector"])
                self.assertEqual("VISUAL_DIALOG" if variant == "dialog" else "VISUAL_ORDERS",
                                 scenario["checkpoints"][0]["oracle"]["expected"])

    def test_all_nine_plans_settle_each_preparation_click_before_next_target_or_exact_oracle(self):
        manifest = controlled.prepare(self.root / "settled-bundle")
        checked = 0
        for group, details in manifest["groups"].items():
            for variant, paths in details["variants"].items():
                with self.subTest(group=group, variant=variant):
                    checked += 1
                    requirement = json.loads(Path(paths["requirement"]).read_text())
                    scenario = requirement["scenarios"][0]
                    self.assertEqual(
                        ["reveal-controlled-groups-1", "reveal-controlled-groups-2", "select-group",
                         "settle-variant-picker", "select-variant", "settle-prepared-page", controlled.STEP],
                        [step["id"] for step in scenario["steps"]],
                    )
                    for index in (3, 5):
                        self.assertEqual({"type": "wait", "durationMs": 1200}, scenario["steps"][index]["action"])
                    self.assertEqual("settle-prepared-page", scenario["checkpoints"][0]["afterStep"])
                    self.assertEqual({"maxSteps": 3, "maxDurationMs": 180000, "idleTimeoutMs": 120000,
                                      "maxRepeatedActions": 2, "maxNoProgressSteps": 2},
                                     scenario["steps"][-1]["budget"])
                    plan = json.loads(Path(paths["plan"]).read_text())
                    verification_engine.validate_verification_plan(plan)
                    self.assertEqual(plan, verification_engine.compile_verification_plan(requirement))
                    prepared = next(segment for segment in plan["intent"]["scenarios"][0]["segments"]
                                    if segment["phase"] == "test" and segment["route"] == "deterministic")
                    operations = prepared["case"]["operationLog"]["steps"]
                    self.assertEqual(["GLOBAL_SCROLL_TO_TOP", "GLOBAL_SCROLL_TO_TOP", "CLICK", "SLEEP",
                                      "CLICK", "SLEEP", "ASSERT"],
                                     [step["operationMethod"]["actionEnum"] for step in operations])
                    for index in (3, 5):
                        self.assertEqual({"text": "1200"}, operations[index]["operationMethod"]["operationParam"])
                    self.assertEqual({"assertMode": "assert_accurate", "assertInputContent":
                                      "VISUAL_DIALOG" if variant == "dialog" else "VISUAL_ORDERS"},
                                     operations[-1]["operationMethod"]["operationParam"])
        self.assertEqual(9, checked)

    def test_strong_rules_can_choose_unlabeled_real_node_in_shared_expanded_pool(self):
        policy = controlled.controlled_policy("controlled-icon", "normal")
        provider = goalpath.GoalPathDecisionProvider(policy, mode="rules", visual_observations=True, include_unlabeled=True)
        result = provider.decide(context(unlabeled=True))
        self.assertEqual({"type": "click", "nodeId": "visual_b2"}, result["action"])
        self.assertEqual(3, len(result["modelReceipt"]["candidates"]))
        semantic = goalpath.GoalPathDecisionProvider(policy, mode="rules").decide(context(unlabeled=True))
        self.assertEqual("blocked", semantic["type"])

    def test_disabled_absent_and_modal_targets_are_rejected_without_distractor_click(self):
        cases = [("controlled-overlay", "dialog"), ("controlled-overlay", "disabled"),
                 ("controlled-no-target-wrong-result", "no-target")]
        for group, variant in cases:
            with self.subTest(variant=variant):
                provider = goalpath.GoalPathDecisionProvider(controlled.controlled_policy(group, variant), mode="rules")
                result = provider.decide(context(variant))
                self.assertEqual("blocked", result["type"])
                self.assertNotIn("action", result)

    def test_model_request_does_not_receive_rule_ids_variant_or_wrong_oracle_answer(self):
        request_capture = mock.Mock(return_value={"choice": "abstain"})
        request_capture.model = "automatic-test-fixture"
        policy = controlled.controlled_policy("controlled-no-target-wrong-result", "wrong-oracle")
        provider = goalpath.GoalPathDecisionProvider(policy, mode="llm", llm_predictor=request_capture,
                                                   visual_observations=True, include_unlabeled=True)
        provider.decide(context())
        public = json.dumps(request_capture.call_args.args[0], ensure_ascii=False)
        for private in ("resourceId", "visual_b2", "wrong-oracle", controlled.WRONG_ORACLE, "rule"):
            self.assertNotIn(private, public)
        self.assertEqual(3, len(request_capture.call_args.args[0]["candidates"]))
        self.assertEqual({"查看"}, {item["label"] for item in request_capture.call_args.args[0]["candidates"].values()})

    def test_independent_judge_preserves_all_three_statuses(self):
        for group, details in controlled.GROUPS.items():
            for variant in details["variants"]:
                with self.subTest(group=group, variant=variant):
                    plan = verification_engine.compile_verification_plan(controlled.controlled_requirement(group, variant))
                    report = verification_engine.execute_verification_plan(plan, FixtureAdapter(variant), now_ms=0)
                    self.assertEqual(controlled.expectation(variant)["status"], report["status"])
                    if variant in {"wrong-result", "wrong-oracle"}:
                        checkpoints = {item["checkpointId"]: item for item in report["scenarios"][0]["checkpoints"]}
                        self.assertEqual("passed", checkpoints["detail-reached"]["status"])
                        self.assertEqual("oracle_mismatch", checkpoints["order-is-paid"]["reason"])
                        self.assertEqual("已取消" if variant == "wrong-result" else "已支付",
                                         checkpoints["order-is-paid"]["actual"])
                        if variant == "wrong-oracle":
                            self.assertEqual("passed", checkpoints["actual-paid-before-sentinel"]["status"])

    def test_wrong_oracle_without_actual_arrival_is_not_a_valid_failure_control(self):
        requirement = controlled.controlled_requirement("controlled-no-target-wrong-result", "wrong-oracle")
        plan = verification_engine.compile_verification_plan(requirement)
        report = verification_engine.execute_verification_plan(plan, FixtureAdapter("wrong-oracle", reached=False), now_ms=0)
        self.assertEqual("not_tested", report["status"])
        checkpoints = {item["checkpointId"]: item for item in report["scenarios"][0]["checkpoints"]}
        self.assertEqual("not_tested", checkpoints["order-is-paid"]["status"])

    def test_output_existing_symlink_and_traversal_never_overwrite(self):
        controlled.prepare(self.root / "bundle", "controlled-overlay")
        saved = (self.root / "bundle/manifest.json").read_bytes()
        with self.assertRaises(FileExistsError):
            controlled.prepare(self.root / "bundle")
        self.assertEqual(saved, (self.root / "bundle/manifest.json").read_bytes())
        (self.root / "link").symlink_to(self.root / "bundle", target_is_directory=True)
        with self.assertRaises(FileExistsError):
            controlled.prepare(self.root / "link")
        with self.assertRaises(ValueError):
            controlled.prepare(self.root / "bundle/../escape")
        with self.assertRaises(ValueError):
            controlled.prepare(self.root / "other", "../escape")
        self.assertFalse((self.root / "escape").exists())
        self.assertFalse((self.root / "other").exists())

    def test_compile_failure_leaves_no_partial_output(self):
        with mock.patch.object(verification_engine, "compile_verification_plan", side_effect=ValueError("fixture-error")):
            with self.assertRaises(ValueError):
                controlled.prepare(self.root / "bundle")
        self.assertFalse((self.root / "bundle").exists())


if __name__ == "__main__":
    unittest.main()
