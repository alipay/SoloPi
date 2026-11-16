"""Exercise the existing verifier with a visual provider; no device or API."""

import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest import mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "solopi_harness"))
import goalpath
import solopi_ai
import test_goalpath_cli as fixtures
import test_visual_observation as visual_fixtures


class VisualIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.GoalPathCliTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)

    def provider(self, args):
        return goalpath.GoalPathDecisionProvider(
            json.loads(Path(args.goalpath_policy).read_text()),
            mode="rules", visual_observations=True, include_unlabeled=True)

    def capture(self, before, observe, screenshot, artifacts, package):
        fresh = copy.deepcopy(before)
        fresh["observationId"] += "-fresh"
        path = artifacts / ("capture-" + fresh["observationId"] + ".png")
        path.write_bytes(visual_fixtures.png())
        return fresh, {"schemaVersion": "solopi.ai.visual-observation/v1",
            "observationId": fresh["observationId"], "imagePath": str(path.resolve()),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "width": 1080, "height": 1920,
            "treeFingerprint": "a" * 64, "attempts": 1, "rotation": 0}

    def test_visual_actions_use_new_observation_and_fixed_judge(self):
        for scenario, expected in (("baseline", "passed"), ("broken", "failed")):
            with self.subTest(scenario=scenario):
                args = self.fixture.args(scenario=scenario)
                adb, _, _, _, acted, ended = self.fixture.mocked_device(scenario)
                with mock.patch.object(solopi_ai, "decision_provider_from_args", return_value=self.provider(args)), \
                        mock.patch.object(solopi_ai.visual_observation, "capture_visual_observation", side_effect=self.capture):
                    payload, code = solopi_ai.command_verify_run(args, adb)
                report = json.loads(Path(payload["report"]).read_text())
                self.assertEqual(expected, report["status"])
                self.assertEqual(0 if expected == "passed" else 2, code)
                self.assertEqual("observed-1-fresh", acted.call_args.args[0].observation_id)
                self.assertTrue(Path(payload["html"]).is_file())
                self.assertIn("capture-observed-1-fresh.png", Path(payload["html"]).read_text())
                requests = list(Path(args.artifacts).rglob("decision-*-request.json"))
                self.assertTrue(requests)
                frozen = json.loads(requests[0].read_text())
                self.assertEqual("observed-1-fresh", frozen["visual"]["observationId"])
                self.assertNotIn("rotation", frozen["visual"])
                transcript_path = next(Path(args.artifacts).rglob("agent-transcript.json"))
                transcript = json.loads(transcript_path.read_text())
                action_event = next(event for event in transcript["events"] if event["type"] == "act")
                self.assertEqual("result_received", action_event["state"])
                self.assertEqual("observed-1-fresh", action_event["observationId"])
                self.assertEqual("open-order-details-001", action_event["stepId"])
                self.assertEqual("succeeded", action_event["result"]["receipt"]["status"])
                ended.assert_called_once()

    def test_unstable_capture_cancels_and_never_sends_action(self):
        args = self.fixture.args()
        adb, _, _, _, acted, ended = self.fixture.mocked_device("baseline")
        with mock.patch.object(solopi_ai, "decision_provider_from_args", return_value=self.provider(args)), \
                mock.patch.object(solopi_ai.visual_observation, "capture_visual_observation",
                    side_effect=solopi_ai.visual_observation.VisualObservationError("visual_observation_unstable")):
            payload, code = solopi_ai.command_verify_run(args, adb)
        self.assertEqual(2, code)
        self.assertEqual("not_tested", payload["status"])
        acted.assert_not_called()
        self.assertEqual("cancel", ended.call_args.args[2])
        text = (Path(args.artifacts) / "report.html").read_text()
        self.assertIn("not_tested", text)

    def test_inference_past_duration_never_dispatches_its_chosen_action(self):
        args = self.fixture.args()
        adb, _, _, _, acted, ended = self.fixture.mocked_device("baseline")
        provider = self.provider(args)
        clock = [0.0]
        decide = provider.decide

        def slow_decide(context):
            result = decide(context)
            clock[0] = 1_000_000.0
            return result

        with mock.patch.object(solopi_ai, "decision_provider_from_args", return_value=provider), \
                mock.patch.object(solopi_ai.visual_observation, "capture_visual_observation", side_effect=self.capture), \
                mock.patch.object(provider, "decide", side_effect=slow_decide), \
                mock.patch.object(solopi_ai.time, "monotonic", side_effect=lambda: clock[0]):
            payload, code = solopi_ai.command_verify_run(args, adb)
        self.assertEqual(("not_tested", 2), (payload["status"], code))
        acted.assert_not_called()
        self.assertEqual("cancel", ended.call_args.args[2])

    def test_uncertain_action_timeout_is_never_replayed(self):
        args = self.fixture.args()
        adb, _, _, _, acted, ended = self.fixture.mocked_device("baseline")
        acted.return_value = ({"success": False, "errorCode": "timeout"}, 4)
        with mock.patch.object(solopi_ai, "decision_provider_from_args", return_value=self.provider(args)), \
                mock.patch.object(solopi_ai.visual_observation, "capture_visual_observation", side_effect=self.capture):
            payload, code = solopi_ai.command_verify_run(args, adb)
        self.assertEqual(("not_tested", 2), (payload["status"], code))
        acted.assert_called_once()
        self.assertEqual("cancel", ended.call_args.args[2])

    def test_receipt_transport_failure_retains_submitted_decision_before_dispatch(self):
        args = self.fixture.args("llm")
        adb, _, _, _, acted, ended = self.fixture.mocked_device("baseline")
        api_secret = "synthetic-credential-must-stay-in-predictor"
        predictor = mock.Mock(model="test-api", return_value={"choice": "candidate_1"})
        predictor.last_metadata = {"usage": {"prompt_tokens": 32, "completion_tokens": 4, "total_tokens": 36},
            "requestCount": 1, "apiKey": api_secret, "authorization": "Bearer " + api_secret}
        provider = goalpath.GoalPathDecisionProvider(json.loads(Path(args.goalpath_policy).read_text()),
            mode="llm", llm_predictor=predictor, visual_observations=True)
        decide = provider.decide

        def decision_with_unowned_id(context):
            decision = decide(context)
            decision["stepId"] = "provider-reused-id"
            return decision

        def receipt_transport_failed(current, unused_adb):
            path = next(Path(args.artifacts).rglob("agent-transcript.json"))
            persisted = path.read_text()
            transcript = json.loads(persisted)
            events = [event for event in transcript["events"] if event["type"] == "act"]
            self.assertEqual(1, len(events))
            event = events[0]
            self.assertEqual("submitted", event["state"])
            self.assertNotIn("result", event)
            self.assertEqual(current.step_id, event["stepId"])
            self.assertEqual("open-order-details-001", event["stepId"])
            self.assertEqual("provider-reused-id", event["decision"]["stepId"])
            self.assertEqual(current.observation_id, event["observationId"])
            self.assertEqual("observed-1-fresh", event["observationId"])
            self.assertEqual(36, event["decision"]["modelReceipt"]["attempts"][0]["usage"]["total_tokens"])
            self.assertNotIn(current.owner_token, persisted)
            self.assertNotIn(api_secret, persisted)
            raise solopi_ai.CliError("无法连接 SoloPi 控制服务", 4)

        acted.side_effect = receipt_transport_failed
        with mock.patch.object(solopi_ai, "decision_provider_from_args", return_value=provider), \
                mock.patch.object(solopi_ai.visual_observation, "capture_visual_observation", side_effect=self.capture), \
                mock.patch.object(provider, "decide", side_effect=decision_with_unowned_id):
            payload, code = solopi_ai.command_verify_run(args, adb)
        self.assertEqual(("not_tested", 2), (payload["status"], code))
        predictor.assert_called_once()
        acted.assert_called_once()
        ended.assert_called_once()
        self.assertEqual("cancel", ended.call_args.args[2])
        report = json.loads(Path(payload["report"]).read_text())
        transcript_ref = next(item for item in report["evidence"] if item["type"] == "agent_transcript")
        transcript_path = Path(transcript_ref["path"])
        self.assertEqual(transcript_ref["sha256"], hashlib.sha256(transcript_path.read_bytes()).hexdigest())
        transcript = json.loads(transcript_path.read_text())
        action_events = [event for event in transcript["events"] if event["type"] == "act"]
        self.assertEqual(1, len(action_events))
        self.assertEqual("submitted", action_events[0]["state"])
        self.assertNotIn("result", action_events[0])
        self.assertIn("error", [event["type"] for event in transcript["events"]])
        for path in Path(args.artifacts).rglob("*.json"):
            self.assertNotIn(api_secret, path.read_text())

    def test_collected_submitted_decision_stays_unlabeled_and_unevaluable(self):
        import test_vision_collect as collection_fixtures
        fixture = collection_fixtures.CollectionTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        event = fixture.transcript["events"][-1]
        event.pop("result")
        event.update(state="submitted", stepId="open-001", observationId=fixture.observation["observationId"])
        fixture.save()
        bundle = fixture.collect()
        self.assertFalse(bundle["evaluationReady"])
        self.assertFalse(bundle["realDeviceBenefitEvaluated"])
        self.assertEqual(1, len(bundle["samples"]))
        self.assertEqual("unlabeled", bundle["samples"][0]["labelStatus"])
        self.assertNotIn("result", bundle["samples"][0])
        self.assertNotIn("executed", bundle["samples"][0])
        pending = json.loads((fixture.output / "pending-labels.json").read_text())
        self.assertIsNone(pending["labels"][0]["expectedChoice"])

    def test_action_limit_final_check_uses_no_extra_model_request(self):
        args = self.fixture.args()
        plan = json.loads(Path(args.plan).read_text())
        requirement = json.loads(Path(self.fixture.fixture.bundle["scenarios"]["baseline"]["requirement"]).read_text())
        for step in requirement["scenarios"][0]["steps"]:
            if step["type"] == "explore":
                step["budget"]["maxSteps"] = 1
        plan = solopi_ai.verification_engine.compile_verification_plan(requirement)
        solopi_ai.write_json_file(Path(args.plan), plan)
        adb, _, _, started, acted, ended = self.fixture.mocked_device("baseline")
        # The click succeeds but does not establish the fixed stop condition.
        acted.return_value[0]["receipt"]["settledObservation"] = copy.deepcopy(started.return_value[0]["observation"])
        predictor = mock.Mock(model="test-api", return_value={"choice": "candidate_1"})
        provider = goalpath.GoalPathDecisionProvider(json.loads(Path(args.goalpath_policy).read_text()),
            mode="llm", llm_predictor=predictor, visual_observations=True)
        with mock.patch.object(solopi_ai, "decision_provider_from_args", return_value=provider), \
                mock.patch.object(solopi_ai.visual_observation, "capture_visual_observation", side_effect=self.capture):
            payload, code = solopi_ai.command_verify_run(args, adb)
        self.assertEqual(("not_tested", 2), (payload["status"], code))
        predictor.assert_called_once()
        acted.assert_called_once()
        self.assertEqual("cancel", ended.call_args.args[2])

    def test_missing_binding_never_calls_predictor(self):
        import test_goalpath as unit
        predictor = mock.Mock(model="test-api")
        provider = goalpath.GoalPathDecisionProvider(unit.policy(), mode="llm", llm_predictor=predictor,
                                                   visual_observations=True, include_unlabeled=True)
        context = unit.context([unit.node("icon", ""), unit.node("cancel", "取消")])
        self.assertEqual("visual_observation_unavailable", provider.decide(context)["reason"])
        predictor.assert_not_called()
        path = self.fixture.root / "fixture.png"
        path.write_bytes(visual_fixtures.png())
        context["visual"] = {"schemaVersion": "solopi.ai.visual-observation/v1", "observationId": "old",
            "imagePath": str(path), "sha256": "a" * 64, "width": 1080, "height": 2400,
            "treeFingerprint": "b" * 64, "attempts": 1}
        self.assertEqual("visual_observation_unavailable", provider.decide(context)["reason"])
        predictor.assert_not_called()
        context["visual"]["observationId"] = context["observation"]["observationId"]
        predictor.return_value = {"choice": "candidate_0"}
        self.assertEqual("act", provider.decide(context)["type"])
        request = predictor.call_args.args[0]
        self.assertEqual("Unlabeled control", request["candidates"]["candidate_0"]["label"])
        self.assertEqual([10, 10, 110, 80], request["candidates"]["candidate_0"]["visualBounds"])
        self.assertNotIn("nodeId", request["candidates"]["candidate_0"])
        snapshot = provider.last_request_snapshot()
        snapshot["goal"] = "changed"
        self.assertNotEqual("changed", provider.last_request_snapshot()["goal"])
        context["terminalOnly"] = True
        predictor.reset_mock()
        self.assertEqual("agent_decision_budget_exhausted", provider.decide(context)["reason"])
        self.assertIsNone(provider.last_request_snapshot())
        predictor.assert_not_called()

    def test_partial_candidate_image_region_clipped_without_changing_node_identity(self):
        import test_goalpath as unit
        predictor = mock.Mock(model="test-api", return_value={"choice": "candidate_0"})
        provider = goalpath.GoalPathDecisionProvider(unit.policy(), mode="llm", llm_predictor=predictor,
                                                   visual_observations=True, include_unlabeled=True)
        icon = unit.node("icon", "")
        icon["nodeBound"] = {"left": -10, "top": 10, "right": 110, "bottom": 80}
        context = unit.context([icon])
        context["visual"] = {"schemaVersion": "solopi.ai.visual-observation/v1",
            "observationId": context["observation"]["observationId"], "imagePath": "/tmp/fixture.png",
            "sha256": "a" * 64, "width": 1080, "height": 2400,
            "treeFingerprint": "b" * 64, "attempts": 1}
        result = provider.decide(context)
        self.assertEqual("icon", result["action"]["nodeId"])
        self.assertEqual([0, 10, 110, 80], predictor.call_args.args[0]["candidates"]["candidate_0"]["visualBounds"])

    def test_visual_factory_and_invalid_combinations(self):
        import goalpath_vision
        args = self.fixture.args("llm", extras=["--goalpath-visual-input", "image",
            "--goalpath-candidate-pool", "expanded", "--goalpath-llm-endpoint", "https://api.openai.com/v1",
            "--goalpath-llm-model", "example-vlm"])
        provider = solopi_ai.decision_provider_from_args(args, mock.Mock())
        self.assertTrue(provider.requires_visual_observation)
        self.assertIsInstance(provider.llm_predictor, goalpath_vision.GoalPathVisionPredictor)
        self.assertTrue(provider.llm_predictor.include_image)
        self.assertEqual(128, provider.llm_predictor.max_output_tokens)
        args.goalpath_max_output_tokens = 2048
        self.assertEqual(2048, solopi_ai.decision_provider_from_args(args, mock.Mock()).llm_predictor.max_output_tokens)
        args.goalpath_visual_input = "text"
        self.assertFalse(solopi_ai.decision_provider_from_args(args, mock.Mock()).llm_predictor.include_image)
        for mode, image, pool in (("hybrid", "image", "semantic"), ("rules", "none", "expanded")):
            args.goalpath_mode, args.goalpath_visual_input, args.goalpath_candidate_pool = mode, image, pool
            with self.assertRaises(solopi_ai.CliError):
                solopi_ai.decision_provider_from_args(args, mock.Mock())

    def test_wrong_solopi_copy_on_port_is_rejected_before_any_command(self):
        adb = mock.Mock()
        session = solopi_ai.HarnessSession(adb, "com.alipay.hulu.fastpath", 23343, 0, 5, 10,
                                          preserve_foreground=True)
        wrong = {"success": True, "packageName": "com.alipay.hulu.trustbench"}
        with self.assertRaises(solopi_ai.CliError) as error:
            session.validate_control_identity(wrong)
        self.assertEqual("control_identity_mismatch", error.exception.details["errorCode"])
        self.assertFalse(adb.mock_calls)
        session.validate_control_identity({"success": True, "packageName": "com.alipay.hulu.fastpath"})

    def test_native_plan_cannot_silently_ignore_android_visual_flags(self):
        import test_native_runtime as native
        plan = solopi_ai.verification_engine.compile_verification_plan(native.requirement())
        path = self.fixture.root / "native-plan.json"
        solopi_ai.write_json_file(path, plan)
        args = solopi_ai.build_parser().parse_args(["verify-run", "--plan", str(path),
            "--artifacts", str(self.fixture.root / "native-out"), "--native-device", "simulator",
            "--goalpath-visual-input", "image"])
        adb = mock.Mock()
        with mock.patch.object(solopi_ai.native_runtime, "create_driver") as create:
            with self.assertRaises(solopi_ai.CliError):
                solopi_ai.command_verify_run(args, adb)
        create.assert_not_called()
        self.assertFalse(adb.mock_calls)

    def test_port_migration_is_typed_and_confirmed_on_exact_new_identity(self):
        args = solopi_ai.build_parser().parse_args(["--package", "com.alipay.hulu.fastpath",
                                                    "control-port-set", "--port", "23344", "--confirm-idle"])
        adb = mock.Mock()
        adb.control_package = args.package
        session = mock.Mock(capabilities={"packageName": args.package, "devicePort": args.port})
        session.config.return_value = {"success": True, "config": {
            "key": "KEY_CONTROL_PORT", "value": 23344, "type": "int", "writable": False}}
        session.resolver_get.return_value = {"success": True, "requestId": "control-port-test-id",
            "action": "control-port-set", "packageName": args.package, "devicePort": 23344,
            "terminal": True, "state": "completed", "previousPort": 23343}
        with mock.patch.object(solopi_ai.uuid, "uuid4", return_value=mock.Mock(hex="test-id")), \
                mock.patch.object(solopi_ai, "session_from_args") as factory:
            factory.return_value.__enter__.return_value = session
            payload, code = solopi_ai.command_control_port_set(args, adb)
        self.assertEqual(0, code)
        self.assertTrue(payload["success"])
        self.assertEqual(23344, factory.call_args.args[0].device_port)
        self.assertEqual("control-port-test-id", payload["requestId"])
        self.assertEqual(session.resolver_get.return_value, payload["receipt"])
        adb.invoke_scheme.assert_called_once_with("config", {
            "action": "control-port-set", "port": "23344", "confirmIdle": "true",
            "requestId": "control-port-test-id"})
        for identity in ({"packageName": "com.alipay.hulu.trustbench", "devicePort": 23344},
                         {"packageName": args.package, "devicePort": 23343}, {}):
            session.capabilities = identity
            with mock.patch.object(solopi_ai, "session_from_args") as factory:
                factory.return_value.__enter__.return_value = session
                with self.assertRaises(solopi_ai.CliError):
                    solopi_ai.command_control_port_set(args, adb)
        adb.reset_mock()
        args.port = 80
        with self.assertRaises(solopi_ai.CliError):
            solopi_ai.command_control_port_set(args, adb)
        self.assertFalse(adb.mock_calls)

    def port_migration_fixture(self):
        args = solopi_ai.build_parser().parse_args(["--package", "com.alipay.hulu.fastpath",
            "control-port-set", "--port", "23344", "--confirm-idle"])
        adb = mock.Mock(control_package=args.package)
        session = mock.Mock(capabilities={"packageName": args.package, "devicePort": 23344})
        session.config.return_value = {"success": True, "config": {
            "key": "KEY_CONTROL_PORT", "value": 23344, "type": "int", "writable": False}}
        session.resolver_get.return_value = {"success": True, "requestId": "control-port-test-id",
            "action": "control-port-set", "packageName": args.package, "devicePort": 23344,
            "terminal": True, "state": "completed"}
        return args, adb, session

    def test_port_migration_rejects_missing_idle_or_different_adb_target_before_transport(self):
        args, adb, _ = self.port_migration_fixture()
        args.confirm_idle = False
        with self.assertRaises(solopi_ai.CliError):
            solopi_ai.command_control_port_set(args, adb)
        self.assertFalse(adb.mock_calls)
        args.confirm_idle = True
        adb.control_package = "com.alipay.hulu.trustbench"
        with self.assertRaises(solopi_ai.CliError):
            solopi_ai.command_control_port_set(args, adb)
        self.assertFalse(adb.mock_calls)

    def test_matching_port_config_cannot_substitute_for_migration_receipt(self):
        for changed in ({"requestId": "another-request"}, {"success": False},
                        {"state": "failed"}, {"terminal": False}, {"devicePort": 23343},
                        {"action": "set"}, {"packageName": "com.alipay.hulu.trustbench"}):
            with self.subTest(changed=changed):
                args, adb, session = self.port_migration_fixture()
                session.resolver_get.return_value.update(changed)
                with mock.patch.object(solopi_ai.uuid, "uuid4", return_value=mock.Mock(hex="test-id")), \
                        mock.patch.object(solopi_ai, "session_from_args") as factory:
                    factory.return_value.__enter__.return_value = session
                    with self.assertRaises(solopi_ai.CliError) as caught:
                        solopi_ai.command_control_port_set(args, adb)
                self.assertEqual("control_port_unconfirmed", caught.exception.details["errorCode"])
                self.assertEqual("control-port-test-id", caught.exception.details["requestId"])
                session.config.assert_not_called()
                adb.invoke_scheme.assert_called_once()

    def test_port_migration_requires_typed_config_and_never_replays_uncertain_mutation(self):
        for config in ({"value": "23344"}, {"value": True}, {"value": 23343}, {"type": "string"}):
            args, adb, session = self.port_migration_fixture()
            session.config.return_value["config"].update(config)
            with mock.patch.object(solopi_ai.uuid, "uuid4", return_value=mock.Mock(hex="test-id")), \
                    mock.patch.object(solopi_ai, "session_from_args") as factory:
                factory.return_value.__enter__.return_value = session
                with self.assertRaises(solopi_ai.CliError):
                    solopi_ai.command_control_port_set(args, adb)
            adb.invoke_scheme.assert_called_once()
        args, adb, _ = self.port_migration_fixture()
        with mock.patch.object(solopi_ai, "session_from_args") as factory:
            factory.return_value.__enter__.side_effect = solopi_ai.CliError("timeout", 4)
            with self.assertRaises(solopi_ai.CliError) as caught:
                solopi_ai.command_control_port_set(args, adb)
        self.assertEqual("control_port_unconfirmed", caught.exception.details["errorCode"])
        self.assertTrue(caught.exception.details["requestId"].startswith("control-port-"))
        adb.invoke_scheme.assert_called_once()
        args, adb, _ = self.port_migration_fixture()
        adb.invoke_scheme.side_effect = solopi_ai.CliError("transport timeout", 4)
        with mock.patch.object(solopi_ai, "session_from_args") as factory:
            with self.assertRaises(solopi_ai.CliError) as caught:
                solopi_ai.command_control_port_set(args, adb)
        self.assertEqual("control_port_unconfirmed", caught.exception.details["errorCode"])
        self.assertTrue(caught.exception.details["requestId"].startswith("control-port-"))
        factory.assert_not_called()
        adb.invoke_scheme.assert_called_once()


if __name__ == "__main__":
    unittest.main()
