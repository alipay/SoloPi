import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest import mock


sys.dont_write_bytecode = True
HARNESS_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HARNESS_ROOT / "src" / "solopi_harness"))
import fastpath
import solopi_ai

SPEC = importlib.util.spec_from_file_location("prepare_fastpath_demo", HARNESS_ROOT / "examples" / "fastpath" / "prepare_demo.py")
prepare_demo = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare_demo)


def observed(scenario, settled=False):
    package = prepare_demo.PACKAGE

    def node(identity, resource, text, clickable=False, enabled=True):
        return {"nodeId": identity, "resourceId": package + ":id/" + resource,
                "packageName": package, "text": text, "visible": True,
                "isEnabled": enabled, "isClickable": clickable, "children": []}

    state = "DETAIL" if settled else "UNKNOWN" if scenario == "unknown" else "ORDERS"
    status = "已取消" if scenario == "broken" else "已支付"
    children = [node("state", "page_state", state)]
    if settled:
        children.append(node("status", "order_status", status))
    else:
        # The target is in the middle of this observation, not candidate_0.
        children.extend([node("cancel", "action_secondary", "取消订单", True),
                         node("details", "action_primary", "查看这笔订单" if scenario == "renamed" else "查看订单详情",
                              True, scenario != "disabled"),
                         node("support", "action_tertiary", "联系客服", True)])
    return {"observationId": "settled-1" if settled else "observed-1",
            "page": {"nodeId": "root", "packageName": package, "children": children}}


def mock_prediction(request):
    labels = request["questions"]["action"]["criteria"]
    target = next(key for key, text in labels.items() if text in {"查看订单详情", "查看这笔订单"})
    probabilities = {key: 0.0 for key in labels}
    probabilities[target] = 1.0
    return {"model": "test-fixture", "answers": {"action": {
        "type": "choice", "choice": target, "probabilities": probabilities,
        "confidence": 1.0, "action": {"act_probability": 1.0}}}, "usage": {}}


class FastPathCliTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="solopi-fastpath-cli-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bundle = prepare_demo.prepare(self.root / "inputs", "all")

    def args(self, scenario="baseline", backend="rules", extras=None):
        paths = self.bundle["scenarios"][scenario]
        return solopi_ai.build_parser().parse_args([
            "verify-run", "--plan", paths["plan"], "--artifacts", str(self.root / (scenario + "-" + backend + "-results")),
            "--decision-provider", "fastpath", "--fastpath-policy", paths["policy"],
            "--fastpath-backend", backend] + (extras or []))

    def mocked_device(self, scenario):
        stack = ExitStack()
        self.addCleanup(stack.close)
        adb = mock.Mock()
        adb.resolve_launcher_component.return_value = prepare_demo.PACKAGE + "/.MainActivity"
        adb.restore_foreground.return_value = True
        imported = stack.enter_context(mock.patch.object(solopi_ai, "command_case_import",
            return_value=({"success": True, "requestId": "import-1"}, 0)))
        replay = stack.enter_context(mock.patch.object(solopi_ai, "command_run",
            return_value=({"success": True, "state": "passed", "runId": "run-1"}, 0)))
        started = stack.enter_context(mock.patch.object(solopi_ai, "command_agent_session_start",
            return_value=({"success": True, "session": {"sessionId": "session-1", "state": "active"},
                           "observation": observed(scenario)}, 0)))
        acted = stack.enter_context(mock.patch.object(solopi_ai, "command_agent_act",
            return_value=({"success": True, "receipt": {"status": "succeeded", "settledObservation": observed(scenario, True)}}, 0)))
        stack.enter_context(mock.patch.object(solopi_ai, "command_agent_query", return_value=({"success": True, "events": []}, 0)))
        ended = stack.enter_context(mock.patch.object(solopi_ai, "command_agent_mutation",
            side_effect=lambda args, adb, kind: ({"success": True, "session": {
                "state": "ended" if kind == "end" else "cancelled"}}, 0)))
        return adb, imported, replay, started, acted, ended

    def test_generator_compiles_all_five_scenarios_and_refuses_overwrite(self):
        self.assertEqual(set(prepare_demo.SCENARIOS), set(self.bundle["scenarios"]))
        for name, paths in self.bundle["scenarios"].items():
            requirement = json.loads(Path(paths["requirement"]).read_text())
            plan = json.loads(Path(paths["plan"]).read_text())
            solopi_ai.verification_engine.validate_verification_plan(plan)
            self.assertEqual("hybrid", plan["intent"]["scenarios"][0]["route"])
            self.assertEqual("已支付", requirement["scenarios"][0]["checkpoints"][0]["oracle"]["expected"])
            self.assertEqual(2, len(paths["cases"]))
            self.assertTrue(all(Path(path).is_file() for path in paths["cases"]))
        sentinel = self.root / "inputs" / "sentinel.txt"
        sentinel.write_text("keep")
        with self.assertRaises(FileExistsError):
            prepare_demo.prepare(self.root / "inputs")
        self.assertEqual("keep", sentinel.read_text())
        with self.assertRaises(ValueError):
            prepare_demo.prepare(self.root / "invalid", "../outside")
        self.assertFalse((self.root / "invalid").exists())

    def test_factory_rules_http_and_mlx_arguments_are_validated_without_device_operations(self):
        adb = mock.Mock()
        rules = solopi_ai.decision_provider_from_args(self.args(), adb)
        self.assertEqual("rules", rules.mode)
        http = solopi_ai.decision_provider_from_args(self.args(backend="http", extras=[
            "--fastpath-endpoint", "http://127.0.0.1:8000/v1/systemone", "--fastpath-model-version", "test-v1"]), adb)
        self.assertIsInstance(http.predictor, fastpath.LoopbackLayaPredictor)
        self.assertEqual("test-v1", http.model_version)
        import fastpath_runtime
        local = mock.Mock(model_digest="a" * 64, metadata={"backend": "mlx"})
        with mock.patch.object(fastpath_runtime, "LocalMlxPredictor", return_value=local) as loader:
            mlx = solopi_ai.decision_provider_from_args(self.args(backend="mlx", extras=["--fastpath-model", "/local/checkpoint"]), adb)
        loader.assert_called_once_with(Path("/local/checkpoint"))
        self.assertIs(local, mlx.predictor)
        self.assertEqual("a" * 64, mlx.model_version)
        for args in [self.args(backend="http"), self.args(backend="mlx"),
                     self.args(extras=["--fastpath-endpoint", "http://127.0.0.1:8000/"]),
                     self.args(extras=["--cloud-fallback-endpoint", "https://example.com"]),
                     self.args(extras=["--agent-decisions", "decisions.json"])]:
            with self.subTest(args=args), self.assertRaises(solopi_ai.CliError):
                solopi_ai.decision_provider_from_args(args, adb)
        self.assertEqual([], adb.mock_calls)

    def test_rules_execution_keeps_three_state_judge_and_required_cleanup(self):
        expected = {"baseline": "passed", "renamed": "not_tested", "broken": "failed", "unknown": "not_tested", "disabled": "not_tested"}
        for scenario, status in expected.items():
            with self.subTest(scenario=scenario):
                adb, imported, replay, started, acted, ended = self.mocked_device(scenario)
                payload, code = solopi_ai.command_verify_run(self.args(scenario), adb)
                report = json.loads(Path(payload["report"]).read_text())
                self.assertEqual(status, report["status"])
                self.assertEqual(0 if status == "passed" else 2, code)
                self.assertEqual("passed", report["scenarios"][0]["cleanup"]["status"])
                self.assertEqual(2, imported.call_count)
                self.assertEqual(2, replay.call_count)
                ended.assert_called_once()
                self.assertEqual(status != "not_tested", acted.called)
                if scenario == "broken":
                    self.assertEqual("oracle_mismatch", report["scenarios"][0]["failure"]["category"])

    def test_model_choice_on_renamed_ui_uses_real_adapter_then_oracle(self):
        scenario = "renamed"
        adb, _, _, _, acted, _ = self.mocked_device(scenario)
        policy = prepare_demo.demo_policy(scenario)
        predictor = mock.Mock(side_effect=mock_prediction)
        predictor.metadata = {}
        provider = fastpath.FastPathDecisionProvider(policy, predictor=predictor, model_version="test-fixture")
        with mock.patch.object(solopi_ai, "decision_provider_from_args", return_value=provider):
            payload, code = solopi_ai.command_verify_run(self.args(scenario, backend="http"), adb)
        self.assertEqual("passed", payload["status"])
        self.assertEqual(0, code)
        predictor.assert_called_once()
        self.assertEqual("details", acted.call_args.args[0].node_id)
        report = json.loads(Path(payload["report"]).read_text())
        self.assertEqual("已支付", report["scenarios"][0]["checkpoints"][0]["actual"])

    def test_policy_is_read_once_and_frozen_snapshot_digest_are_reported(self):
        args = self.args()
        policy_path = Path(args.fastpath_policy)
        original = json.loads(policy_path.read_text())
        adb, _, _, _, _, _ = self.mocked_device("baseline")
        load = solopi_ai.load_json_file
        policy_reads = []

        def load_then_replace(path):
            value = load(path)
            if Path(path) == policy_path:
                policy_reads.append(path)
                replacement = copy.deepcopy(value)
                replacement["steps"] = {"wrong-step": replacement["steps"]["open-order-details"]}
                policy_path.write_text(json.dumps(replacement))
            return value

        with mock.patch.object(solopi_ai, "load_json_file", side_effect=load_then_replace):
            payload, _ = solopi_ai.command_verify_run(args, adb)
        self.assertEqual(1, len(policy_reads))
        self.assertEqual("passed", payload["status"])
        report = json.loads(Path(payload["report"]).read_text())
        snapshot = json.loads(Path(report["fastpath"]["policy"]).read_text())
        self.assertEqual(original, snapshot)
        digest = fastpath.FastPathDecisionProvider(original, mode="rules").policy_digest
        self.assertEqual(digest, report["fastpath"]["policyDigest"])
        transcripts = list(Path(args.artifacts).rglob("agent-transcript.json"))
        receipt = next(event["decision"]["modelReceipt"] for event in json.loads(transcripts[0].read_text())["events"] if event["type"] == "act")
        self.assertEqual(digest, receipt["policyDigest"])

    def test_package_and_step_mismatch_are_rejected_before_any_device_operation(self):
        args = self.args()
        original = json.loads(Path(args.fastpath_policy).read_text())
        other_package = json.loads(json.dumps(original).replace(prepare_demo.PACKAGE, "com.other.app"))
        other_step = copy.deepcopy(original)
        other_step["steps"] = {"wrong-step": other_step["steps"]["open-order-details"]}
        for policy in (other_package, other_step):
            Path(args.fastpath_policy).write_text(json.dumps(policy))
            adb = mock.Mock()
            with mock.patch.object(solopi_ai.SoloPiVerificationAdapter, "execute") as execute:
                with self.assertRaises(solopi_ai.CliError):
                    solopi_ai.command_verify_run(args, adb)
            execute.assert_not_called()
            self.assertEqual([], adb.mock_calls)
            self.assertFalse(Path(args.artifacts).exists())

    def test_invalid_policy_field_is_a_cli_error_before_device_operations(self):
        args = self.args()
        policy = json.loads(Path(args.fastpath_policy).read_text())
        policy["steps"]["open-order-details"]["readyWhen"]["field"] = []
        Path(args.fastpath_policy).write_text(json.dumps(policy))
        adb = mock.Mock()
        with self.assertRaises(solopi_ai.CliError) as caught:
            solopi_ai.command_verify_run(args, adb)
        self.assertEqual("invalid_fastpath_policy", caught.exception.details["errorCode"])
        self.assertEqual([], adb.mock_calls)

    def test_negative_end_acknowledgement_cannot_leave_a_passing_result(self):
        outcomes = [
            ({"success": True, "session": {"state": "ended"}}, 2),
            ({"success": False, "errorCode": "session_not_found"}, 2),
            ({"success": True, "session": {"state": "cancelled"}}, 0),
            ({"success": True, "session": {"state": "active"}}, 0),
            ({"success": True}, 0),
        ]
        for index, outcome in enumerate(outcomes):
            with self.subTest(outcome=outcome):
                adb, _, replay, _, acted, ended = self.mocked_device("baseline")
                ended.side_effect = None
                ended.return_value = outcome
                args = self.args()
                args.artifacts = str(self.root / ("negative-end-%d" % index))
                payload, code = solopi_ai.command_verify_run(args, adb)
                self.assertEqual("not_tested", payload["status"])
                self.assertEqual(2, code)
                self.assertEqual("end", ended.call_args.args[2])
                acted.assert_called_once()
                self.assertEqual(2, replay.call_count)
                report = json.loads(Path(payload["report"]).read_text())
                self.assertEqual("agent_cleanup_failed", report["scenarios"][0]["checkpoints"][0]["reason"])
                transcript = json.loads(next(Path(args.artifacts).rglob("agent-transcript.json")).read_text())
                self.assertIn("cleanup_unconfirmed", [event["type"] for event in transcript["events"]])

    def test_cleanup_does_not_swallow_interrupt(self):
        adb, _, _, _, acted, ended = self.mocked_device("baseline")
        acted.side_effect = KeyboardInterrupt()
        ended.side_effect = None
        ended.return_value = ({"success": False}, 2)
        with self.assertRaises(KeyboardInterrupt):
            solopi_ai.command_verify_run(self.args(), adb)
        self.assertEqual("cancel", ended.call_args.args[2])


if __name__ == "__main__":
    unittest.main()
