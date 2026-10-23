import copy
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "solopi_harness"))
import solopi_ai
import goalpath
import goalpath_runtime
import test_fastpath_cli as fixtures


class GoalPathCliTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.FastPathCliTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root

    def args(self, mode="rules", scenario="baseline", extras=None):
        source = json.loads(Path(self.fixture.bundle["scenarios"][scenario]["policy"]).read_text())
        step = source["steps"]["open-order-details"]
        policy = {"schemaVersion": goalpath.POLICY_SCHEMA, "targetPackage": source["targetPackage"],
                  "steps": {"open-order-details": {
                      "instructions": "选择完成目标的动作。", "stopWhen": step["stopWhen"],
                      "rules": [{"action": "click", "selector": {"resourceId": fixtures.prepare_demo.PACKAGE + ":id/action_primary"}}]}}}
        path = self.root / (scenario + "-goalpath-policy.json")
        path.write_text(json.dumps(policy))
        return solopi_ai.build_parser().parse_args([
            "verify-run", "--plan", self.fixture.bundle["scenarios"][scenario]["plan"],
            "--artifacts", str(self.root / (scenario + "-" + mode + "-goalpath")),
            "--decision-provider", "goalpath", "--goalpath-policy", str(path),
            "--goalpath-mode", mode] + (extras or []))

    def mocked_device(self, scenario):
        device = self.fixture.mocked_device(scenario)
        started, acted = device[3], device[4]

        def annotate(node, root=False):
            node["isVisibleToUser"] = True
            node["isPassword"] = False
            node["nodeBound"] = ({"left": 0, "top": 0, "right": 1080, "bottom": 1920}
                                 if root else {"left": 20, "top": 40, "right": 900, "bottom": 140})
            for child in node.get("children", []):
                annotate(child)

        annotate(started.return_value[0]["observation"]["page"], True)
        annotate(acted.return_value[0]["receipt"]["settledObservation"]["page"], True)
        return device

    def test_factory_all_four_modes_use_declared_adapters_without_device_operations(self):
        adb = mock.Mock()
        provider = solopi_ai.decision_provider_from_args(self.args(), adb)
        self.assertEqual("rules", provider.mode)
        provider = solopi_ai.decision_provider_from_args(self.args("laya", extras=[
            "--fastpath-backend", "http", "--fastpath-endpoint", "http://127.0.0.1:55111/v1/systemone",
            "--fastpath-model-version", "pinned-source"]), adb)
        self.assertIsInstance(provider.laya_predictor, solopi_ai.fastpath.LoopbackLayaPredictor)
        self.assertEqual("pinned-source", provider.model_version)
        llm_options = ["--goalpath-llm-endpoint", "http://127.0.0.1:55222/v1", "--goalpath-llm-model", "qwen-test-4b"]
        provider = solopi_ai.decision_provider_from_args(self.args("llm", extras=llm_options), adb)
        self.assertIsInstance(provider.llm_predictor, goalpath_runtime.LoopbackOpenAIPredictor)
        self.assertEqual("qwen-test-4b", provider.model)
        self.assertEqual("qwen-test-4b", provider.runtime_metadata["llm"]["model"])
        local = mock.Mock(model_digest="b" * 64, metadata={"backend": "mlx", "deployment": "host-local"})
        with mock.patch.object(goalpath_runtime, "GoalPathMlxPredictor", return_value=local) as load:
            provider = solopi_ai.decision_provider_from_args(self.args("hybrid", extras=llm_options + [
                "--fastpath-model", "/local/pinned-checkpoint"]), adb)
        load.assert_called_once_with(Path("/local/pinned-checkpoint"))
        self.assertIs(local, provider.laya_predictor)
        self.assertEqual("b" * 64, provider.model_version)
        self.assertEqual([], adb.mock_calls)

    def test_omitted_mode_uses_rules_without_loading_or_contacting_models(self):
        configured = self.args()
        args = solopi_ai.build_parser().parse_args([
            "verify-run", "--plan", configured.plan, "--artifacts", configured.artifacts,
            "--decision-provider", "goalpath", "--goalpath-policy", configured.goalpath_policy])
        adb = mock.Mock()
        with mock.patch.object(goalpath_runtime, "GoalPathMlxPredictor") as local, \
                mock.patch.object(goalpath_runtime, "LoopbackOpenAIPredictor") as remote:
            provider = solopi_ai.decision_provider_from_args(args, adb)
        self.assertEqual("rules", provider.mode)
        local.assert_not_called()
        remote.assert_not_called()
        self.assertEqual([], adb.mock_calls)

    def test_malformed_inputs_and_remote_endpoints_fail_before_device_operations(self):
        adb = mock.Mock()
        candidates = [
            self.args("laya"), self.args("llm"),
            self.args("laya", extras=["--fastpath-backend", "rules"]),
            self.args("llm", extras=["--goalpath-llm-endpoint", "https://example.com/v1", "--goalpath-llm-model", "test"]),
            self.args("llm", extras=["--goalpath-llm-endpoint", "http://127.0.0.1:55222/v1", "--goalpath-llm-model", "test", "--goalpath-llm-timeout", "121"]),
            self.args(extras=["--agent-decisions", "decisions.json"]),
            self.args(extras=["--cloud-fallback-endpoint", "https://example.com"]),
        ]
        missing = self.args()
        missing.goalpath_policy = None
        candidates.append(missing)
        for args in candidates:
            with self.subTest(mode=args.goalpath_mode), self.assertRaises(solopi_ai.CliError):
                solopi_ai.decision_provider_from_args(args, adb)
        self.assertEqual([], adb.mock_calls)

    def test_goalpath_plan_contract_is_checked_before_any_device_work(self):
        for mismatch in ("package", "step"):
            args = self.args()
            policy = json.loads(Path(args.goalpath_policy).read_text())
            if mismatch == "package":
                policy = json.loads(json.dumps(policy).replace(fixtures.prepare_demo.PACKAGE, "com.other.app"))
            else:
                policy["steps"] = {"different-step": policy["steps"]["open-order-details"]}
            Path(args.goalpath_policy).write_text(json.dumps(policy))
            adb = mock.Mock()
            with self.assertRaises(solopi_ai.CliError):
                solopi_ai.command_verify_run(args, adb)
            self.assertEqual([], adb.mock_calls)
            self.assertFalse(Path(args.artifacts).exists())

    def test_goalpath_snapshot_and_independent_oracles_are_retained(self):
        for scenario, expected in (("baseline", "passed"), ("broken", "failed")):
            adb, imported, replay, _, acted, ended = self.mocked_device(scenario)
            args = self.args(scenario=scenario)
            frozen = json.loads(Path(args.goalpath_policy).read_text())
            payload, code = solopi_ai.command_verify_run(args, adb)
            report = json.loads(Path(payload["report"]).read_text())
            self.assertEqual(expected, report["status"])
            self.assertEqual(0 if expected == "passed" else 2, code)
            self.assertEqual("rules", report["goalpath"]["mode"])
            self.assertEqual(frozen, json.loads(Path(report["goalpath"]["policy"]).read_text()))
            self.assertEqual(goalpath.GoalPathDecisionProvider(frozen).policy_digest, report["goalpath"]["policyDigest"])
            self.assertEqual(1, acted.call_count)
            self.assertEqual(2, imported.call_count)
            self.assertEqual(2, replay.call_count)
            ended.assert_called_once()
            self.assertEqual("passed", report["scenarios"][0]["cleanup"]["status"])

    def test_history_uses_real_receipt_and_is_bounded_semantic_data(self):
        adb, _, _, _, acted, _ = self.mocked_device("baseline")
        args = self.args()
        contexts = []
        original = goalpath.GoalPathDecisionProvider.decide

        def decide(provider, context):
            contexts.append(copy.deepcopy(context))
            return original(provider, context)

        with mock.patch.object(goalpath.GoalPathDecisionProvider, "decide", decide):
            payload, code = solopi_ai.command_verify_run(args, adb)
        self.assertEqual(0, code)
        self.assertEqual([], contexts[0]["history"])
        self.assertEqual(0, contexts[0]["completedActionCount"])
        self.assertEqual(1, contexts[1]["completedActionCount"])
        self.assertEqual([{"action": {"type": "click"}, "status": "succeeded", "label": "查看订单详情"}], contexts[1]["history"])
        encoded = json.dumps(contexts[1]["history"])
        for forbidden in ("nodeId", "ownerToken", "observationId", "settledObservation", "receipt"):
            self.assertNotIn(forbidden, encoded)
        acted.assert_called_once()


if __name__ == "__main__":
    unittest.main()
