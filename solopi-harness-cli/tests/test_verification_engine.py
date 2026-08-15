import copy
import importlib.util
import json
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = (
    REPO_ROOT
    / "solopi-harness-cli"
    / "src"
    / "solopi_harness"
    / "verification_engine.py"
)
SPEC = importlib.util.spec_from_file_location("verification_engine", MODULE_PATH)
verification_engine = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = verification_engine
SPEC.loader.exec_module(verification_engine)


def selector(resource_id):
    return {
        "resourceId": resource_id,
        "className": "android.widget.TextView",
        "packageName": "com.example.counter",
    }


def observation(value):
    return {
        "observationId": "observation-%s" % value,
        "page": {
            "className": "android.widget.FrameLayout",
            "children": [
                {
                    "className": "android.widget.TextView",
                    "resourceId": "com.example.counter:id/counter_value",
                    "packageName": "com.example.counter",
                    "text": str(value),
                    "description": "Counter value",
                    "children": [],
                }
            ],
        },
    }


class FakeAdapter:
    def __init__(self, outcomes=None):
        self.outcomes = outcomes or {}
        self.calls = []

    def execute(self, segment, scenario, decisions):
        self.calls.append((segment["phase"], segment["segmentId"], decisions))
        result = copy.deepcopy(self.outcomes.get(segment["segmentId"]))
        if result is not None:
            return result
        return {
            "state": "passed",
            "evidence": [
                {
                    "type": "replay_result",
                    "content": {"segmentId": segment["segmentId"], "state": "passed"},
                }
            ],
        }


class VerificationEngineTests(unittest.TestCase):
    def requirement(self, steps=None, checkpoints=None, cleanup=None):
        return {
            "schemaVersion": "solopi.ai.requirement/v1",
            "id": "counter-increment",
            "title": "Counter increments",
            "targetAppPackage": "com.example.counter",
            "targetAppLabel": "SoloPi TDD Counter",
            "acceptanceCriteria": [
                {"id": "AC-1", "text": "One increment shows value 1"}
            ],
            "parameters": {"expected": "1"},
            "reusableFlows": [
                {
                    "id": "reset-counter",
                    "steps": [
                        {
                            "id": "reset",
                            "type": "operation",
                            "action": {
                                "type": "click",
                                "selector": {
                                    "resourceId": "com.example.counter:id/reset_button",
                                    "className": "android.widget.Button",
                                    "packageName": "com.example.counter",
                                },
                            },
                        }
                    ],
                }
            ],
            "scenarios": [
                {
                    "id": "increment-once",
                    "title": "Increment once",
                    "acceptanceCriteria": ["AC-1"],
                    "dependsOn": [],
                    "testData": {"expectedValue": "${expected}"},
                    "steps": steps
                    or [
                        {"use": "reset-counter"},
                        {
                            "id": "increment",
                            "type": "operation",
                            "action": {
                                "type": "click",
                                "selector": {
                                    "resourceId": "com.example.counter:id/increment_button",
                                    "className": "android.widget.Button",
                                    "packageName": "com.example.counter",
                                },
                            },
                        },
                    ],
                    "checkpoints": checkpoints
                    or [
                        {
                            "id": "value-is-one",
                            "afterStep": "increment",
                            "acceptanceCriteria": ["AC-1"],
                            "oracle": {
                                "type": "ui",
                                "selector": selector(
                                    "com.example.counter:id/counter_value"
                                ),
                                "field": "text",
                                "operator": "equals",
                                "expected": "${expectedValue}",
                            },
                        }
                    ],
                    "cleanup": cleanup
                    or [
                        {
                            "id": "cleanup-reset",
                            "action": {
                                "type": "click",
                                "selector": {
                                    "resourceId": "com.example.counter:id/reset_button",
                                    "className": "android.widget.Button",
                                    "packageName": "com.example.counter",
                                },
                            },
                        }
                    ],
                    "budget": {"maxSteps": 10, "maxDurationMs": 60000},
                }
            ],
        }

    def test_normalizer_and_compiler_are_stable_and_bind_reusable_flow(self):
        requirement = self.requirement()
        reordered = json.loads(json.dumps(requirement, sort_keys=True))

        first = verification_engine.compile_verification_plan(requirement)
        second = verification_engine.compile_verification_plan(reordered)

        self.assertEqual(first["planFingerprint"], second["planFingerprint"])
        scenario = first["intent"]["scenarios"][0]
        self.assertEqual("deterministic", scenario["route"])
        self.assertEqual(["reset", "increment"], [step["id"] for step in scenario["steps"]])
        self.assertEqual("1", scenario["checkpoints"][0]["oracle"]["expected"])
        test_segment = next(item for item in scenario["segments"] if item["phase"] == "test")
        action_enums = [
            item["operationMethod"]["actionEnum"]
            for item in test_segment["case"]["operationLog"]["steps"]
        ]
        self.assertEqual(["CLICK", "CLICK", "ASSERT"], action_enums)

    def test_goal_tree_links_requirement_ac_scenario_and_checkpoint(self):
        plan = verification_engine.compile_verification_plan(self.requirement())
        root = plan["goalTree"]

        self.assertEqual("counter-increment", root["id"])
        self.assertEqual("AC-1", root["children"][0]["id"])
        self.assertEqual("increment-once", root["children"][0]["children"][0]["id"])
        self.assertEqual(
            "value-is-one",
            root["children"][0]["children"][0]["children"][0]["id"],
        )

    def test_compiler_routes_dynamic_and_hybrid_without_modelizing_stable_steps(self):
        dynamic_step = {
            "id": "explore-increment",
            "type": "explore",
            "goal": "Increment the counter once",
            "allowedActions": ["click", "wait"],
            "budget": {"maxSteps": 3, "maxDurationMs": 30000},
        }
        dynamic = self.requirement(steps=[dynamic_step])
        dynamic["scenarios"][0]["checkpoints"][0]["afterStep"] = "explore-increment"
        hybrid = self.requirement(steps=[{"use": "reset-counter"}, dynamic_step])
        hybrid["scenarios"][0]["checkpoints"][0]["afterStep"] = "explore-increment"

        dynamic_plan = verification_engine.compile_verification_plan(dynamic)
        hybrid_plan = verification_engine.compile_verification_plan(hybrid)

        self.assertEqual("dynamic", dynamic_plan["intent"]["scenarios"][0]["route"])
        hybrid_scenario = hybrid_plan["intent"]["scenarios"][0]
        self.assertEqual("hybrid", hybrid_scenario["route"])
        self.assertEqual(
            ["deterministic", "dynamic"],
            [segment["route"] for segment in hybrid_scenario["segments"] if segment["phase"] == "test"],
        )
        fixed_steps = hybrid_scenario["segments"][0]["case"]["operationLog"]["steps"]
        self.assertEqual(["CLICK"], [step["operationMethod"]["actionEnum"] for step in fixed_steps])

    def test_static_validator_rejects_model_oracle_unresolved_binding_and_cycles(self):
        model_oracle = self.requirement()
        model_oracle["scenarios"][0]["checkpoints"][0]["oracle"] = {
            "type": "model",
            "prompt": "Did it pass?",
        }
        with self.assertRaises(verification_engine.VerificationError) as model_error:
            verification_engine.compile_verification_plan(model_oracle)
        self.assertEqual("unsupported_oracle", model_error.exception.code)

        unresolved = self.requirement()
        unresolved["scenarios"][0]["checkpoints"][0]["oracle"]["expected"] = "${missing}"
        with self.assertRaises(verification_engine.VerificationError) as binding_error:
            verification_engine.compile_verification_plan(unresolved)
        self.assertEqual("unresolved_binding", binding_error.exception.code)

        cyclic = self.requirement()
        second = copy.deepcopy(cyclic["scenarios"][0])
        second["id"] = "second"
        second["dependsOn"] = ["increment-once"]
        cyclic["scenarios"][0]["dependsOn"] = ["second"]
        cyclic["scenarios"].append(second)
        with self.assertRaises(verification_engine.VerificationError) as cycle_error:
            verification_engine.compile_verification_plan(cyclic)
        self.assertEqual("dependency_cycle", cycle_error.exception.code)

    def test_static_validator_rejects_tampered_compiled_shell_even_with_new_fingerprint(self):
        plan = verification_engine.compile_verification_plan(self.requirement())
        segment = next(
            item for item in plan["intent"]["scenarios"][0]["segments"]
            if item["phase"] == "test"
        )
        segment["case"]["operationLog"]["steps"][0]["operationMethod"] = {
            "actionEnum": "EXECUTE_SHELL",
            "operationParam": {"text": "id"},
            "encrypt": False,
            "safeEncrypt": False,
        }
        unsigned = copy.deepcopy(plan)
        unsigned.pop("planFingerprint")
        plan["planFingerprint"] = verification_engine.canonical_fingerprint(unsigned)

        with self.assertRaises(verification_engine.VerificationError) as error:
            verification_engine.validate_verification_plan(plan)

        self.assertEqual("unsafe_compiled_action", error.exception.code)

    def test_success_report_links_checkpoint_oracle_and_evidence(self):
        plan = verification_engine.compile_verification_plan(self.requirement())
        report = verification_engine.execute_verification_plan(plan, FakeAdapter())

        self.assertEqual("passed", report["status"])
        scenario = report["scenarios"][0]
        checkpoint = scenario["checkpoints"][0]
        self.assertEqual("passed", checkpoint["status"])
        self.assertEqual("ui", checkpoint["oracle"]["type"])
        self.assertTrue(checkpoint["evidenceRefs"])
        self.assertTrue(report["evidence"])

    def test_product_failure_is_attributed_to_deterministic_oracle(self):
        plan = verification_engine.compile_verification_plan(self.requirement())
        scenario = plan["intent"]["scenarios"][0]
        segment = next(item for item in scenario["segments"] if item["phase"] == "test")
        oracle_step = scenario["checkpoints"][0]["oracleStepId"]
        adapter = FakeAdapter(
            {
                segment["segmentId"]: {
                    "state": "failed",
                    "failedStepId": oracle_step,
                    "evidence": [
                        {"type": "replay_result", "content": {"exceptionStepId": oracle_step}}
                    ],
                }
            }
        )

        report = verification_engine.execute_verification_plan(plan, adapter)

        self.assertEqual("failed", report["status"])
        self.assertEqual("oracle_mismatch", report["scenarios"][0]["failure"]["category"])
        self.assertEqual("failed", report["scenarios"][0]["checkpoints"][0]["status"])

    def test_agent_done_only_stops_exploration_and_false_done_fails_oracle(self):
        explore = {
            "id": "explore-increment",
            "type": "explore",
            "goal": "Increment the counter once",
            "allowedActions": ["click"],
            "budget": {"maxSteps": 2, "maxDurationMs": 30000},
        }
        requirement = self.requirement(steps=[explore])
        requirement["scenarios"][0]["checkpoints"][0]["afterStep"] = "explore-increment"
        plan = verification_engine.compile_verification_plan(requirement)
        segment = next(
            item for item in plan["intent"]["scenarios"][0]["segments"]
            if item["phase"] == "test"
        )
        adapter = FakeAdapter(
            {
                segment["segmentId"]: {
                    "state": "done",
                    "agentDone": True,
                    "observation": observation(0),
                    "evidence": [
                        {"type": "agent_observation", "content": observation(0)}
                    ],
                }
            }
        )

        report = verification_engine.execute_verification_plan(
            plan,
            adapter,
            {"increment-once": {"explore-increment": [{"type": "done"}]}},
        )

        self.assertEqual("failed", report["status"])
        self.assertTrue(report["scenarios"][0]["segments"][0]["agentDone"])
        self.assertEqual("failed", report["scenarios"][0]["checkpoints"][0]["status"])

    def test_unreached_checkpoint_is_not_tested_even_when_agent_claims_no_failure(self):
        explore = {
            "id": "explore-increment",
            "type": "explore",
            "goal": "Increment the counter once",
            "allowedActions": ["click"],
            "budget": {"maxSteps": 2, "maxDurationMs": 30000},
        }
        requirement = self.requirement(steps=[explore])
        requirement["scenarios"][0]["checkpoints"][0]["afterStep"] = "explore-increment"
        plan = verification_engine.compile_verification_plan(requirement)
        segment = next(
            item for item in plan["intent"]["scenarios"][0]["segments"]
            if item["phase"] == "test"
        )
        adapter = FakeAdapter(
            {
                segment["segmentId"]: {
                    "state": "not_tested",
                    "reason": "checkpoint_not_reached",
                    "evidence": [
                        {"type": "agent_event", "content": {"type": "blocked"}}
                    ],
                }
            }
        )

        report = verification_engine.execute_verification_plan(plan, adapter)

        self.assertEqual("not_tested", report["status"])
        self.assertEqual("checkpoint_not_reached", report["scenarios"][0]["failure"]["category"])
        self.assertEqual("not_tested", report["scenarios"][0]["checkpoints"][0]["status"])

    def test_required_cleanup_failure_overrides_passed_checkpoints(self):
        cleanup = [
            {
                "id": "cleanup-reset",
                "action": {
                    "type": "click",
                    "selector": {
                        "resourceId": "com.example.counter:id/reset_button",
                        "className": "android.widget.Button",
                        "packageName": "com.example.counter",
                    },
                },
            },
            {
                "id": "cleanup-confirm",
                "oracle": {
                    "type": "ui",
                    "selector": selector("com.example.counter:id/counter_value"),
                    "field": "text",
                    "operator": "equals",
                    "expected": "9",
                },
            },
        ]
        plan = verification_engine.compile_verification_plan(self.requirement(cleanup=cleanup))
        scenario = plan["intent"]["scenarios"][0]
        cleanup_segment = next(item for item in scenario["segments"] if item["phase"] == "cleanup")
        cleanup_oracle_step = next(
            item["stepId"]
            for item in cleanup_segment["case"]["operationLog"]["steps"]
            if item["operationMethod"]["actionEnum"] == "ASSERT"
        )
        adapter = FakeAdapter(
            {
                cleanup_segment["segmentId"]: {
                    "state": "failed",
                    "failedStepId": cleanup_oracle_step,
                    "evidence": [
                        {"type": "cleanup_result", "content": {"state": "failed"}}
                    ],
                }
            }
        )

        report = verification_engine.execute_verification_plan(plan, adapter)

        self.assertEqual("failed", report["status"])
        scenario_result = report["scenarios"][0]
        self.assertEqual("passed", scenario_result["checkpoints"][0]["status"])
        self.assertEqual("cleanup_failure", scenario_result["failure"]["category"])
        self.assertEqual("failed", scenario_result["cleanup"]["status"])

    def test_dependency_failure_skips_consumer_and_outcome_is_reproducible(self):
        requirement = self.requirement()
        dependent = copy.deepcopy(requirement["scenarios"][0])
        dependent["id"] = "dependent"
        dependent["title"] = "Dependent scenario"
        dependent["dependsOn"] = ["increment-once"]
        requirement["scenarios"].append(dependent)
        plan = verification_engine.compile_verification_plan(requirement)
        first_scenario = plan["intent"]["scenarios"][0]
        first_test = next(item for item in first_scenario["segments"] if item["phase"] == "test")
        oracle_step = first_scenario["checkpoints"][0]["oracleStepId"]
        outputs = {
            first_test["segmentId"]: {
                "state": "failed",
                "failedStepId": oracle_step,
                "evidence": [{"type": "replay_result", "content": {"failed": oracle_step}}],
            }
        }

        first = verification_engine.execute_verification_plan(plan, FakeAdapter(outputs), now_ms=1)
        second = verification_engine.execute_verification_plan(plan, FakeAdapter(outputs), now_ms=2)

        self.assertEqual("not_tested", first["scenarios"][1]["status"])
        self.assertEqual("dependency_not_passed", first["scenarios"][1]["failure"]["category"])
        self.assertEqual(first["outcomeFingerprint"], second["outcomeFingerprint"])

    def test_demo_fixtures_compile_to_all_routes_and_requested_outcomes(self):
        fixture_root = REPO_ROOT / "solopi-harness-cli" / "fixtures" / "verification"
        success = json.loads((fixture_root / "counter-success.json").read_text(encoding="utf-8"))
        matrix = json.loads(
            (fixture_root / "counter-outcome-matrix.json").read_text(encoding="utf-8")
        )
        decisions = json.loads(
            (fixture_root / "counter-agent-decisions.json").read_text(encoding="utf-8")
        )

        success_plan = verification_engine.compile_verification_plan(success)
        matrix_plan = verification_engine.compile_verification_plan(matrix)

        self.assertEqual("deterministic", success_plan["intent"]["scenarios"][0]["route"])
        routes = {item["route"] for item in matrix_plan["intent"]["scenarios"]}
        self.assertEqual({"deterministic", "dynamic", "hybrid"}, routes)
        self.assertEqual(
            {
                "hybrid-success",
                "product-failure",
                "agent-false-done",
                "uncovered-checkpoint",
                "cleanup-failure",
            },
            {item["id"] for item in matrix_plan["intent"]["scenarios"]},
        )
        self.assertEqual(
            {"hybrid-success", "agent-false-done", "uncovered-checkpoint"},
            set(decisions),
        )


if __name__ == "__main__":
    unittest.main()
