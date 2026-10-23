import copy
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "solopi_harness"))
import solopi_ai
import test_fastpath_cli as cli_fixtures
# test_solopi_ai reloads the CLI by path during full-suite discovery. Use the same
# module as the fixture so its mocks cannot miss the actual command under test.
solopi_ai = cli_fixtures.solopi_ai


class VerificationTransportTests(unittest.TestCase):
    def setUp(self):
        self.args = solopi_ai.build_parser().parse_args(
            ["verify-run", "--plan", "plan.json", "--artifacts", "evidence"]
        )
        self.adb = solopi_ai.AdbClient(requested_serial="test-device")
        self.adb.connect = mock.Mock(side_effect=self.connect)
        self.adb.package_installed = mock.Mock(return_value=True)
        self.adb.forward = mock.Mock(return_value=28432)
        self.adb.remove_forward = mock.Mock()
        self.adb.launch = mock.Mock()
        self.adb.foreground_component = mock.Mock(return_value="com.example.target/.Detail")
        self.adb.restore_foreground = mock.Mock()
        self.http = mock.Mock()
        self.http.get.return_value = {"success": True}
        patcher = mock.patch.object(solopi_ai, "HarnessHttpClient", return_value=self.http)
        patcher.start()
        self.addCleanup(patcher.stop)

    def connect(self):
        self.adb.device = {"serial": "test-device", "state": "device"}
        return self.adb.device

    def borrow(self, args=None):
        return solopi_ai.session_from_args(args or self.args, self.adb, preserve_foreground=True)

    def test_default_shared_scope_reuses_forward_and_probe_but_not_live_queries(self):
        self.assertEqual("shared", self.args.transport_mode)
        transport = solopi_ai.VerificationTransport(self.args, self.adb)
        self.args._verification_transport = transport
        with transport:
            for _ in range(3):
                with self.borrow(copy.copy(self.args)) as session:
                    session.query("health")
                    session.query("status")
            self.adb.remove_forward.assert_not_called()
        self.adb.connect.assert_called_once()
        self.adb.package_installed.assert_called_once()
        self.adb.forward.assert_called_once_with(0, 23342)
        self.adb.remove_forward.assert_called_once_with(28432)
        self.adb.launch.assert_not_called()
        query_types = [call.args[1]["type"] for call in self.http.get.call_args_list]
        self.assertEqual(1, query_types.count("capabilities"))
        self.assertEqual(3, query_types.count("health"))
        self.assertEqual(3, query_types.count("status"))
        self.assertEqual((3, 1, 1), tuple(transport.summary()[k] for k in ("borrowCount", "openCount", "closeCount")))
        self.assertNotIn("test-device", json.dumps(transport.summary()))
        self.assertTrue(transport.summary()["httpKeepAlive"])
        self.http.close.assert_called_once()

    def test_isolated_commands_keep_per_command_lifecycle(self):
        for _ in range(3):
            with self.borrow():
                pass
        self.assertEqual(3, self.adb.connect.call_count)
        self.assertEqual(3, self.adb.forward.call_count)
        self.assertEqual(3, self.adb.remove_forward.call_count)

    def test_unopened_scope_performs_no_device_work(self):
        with solopi_ai.VerificationTransport(self.args, self.adb) as transport:
            pass
        self.adb.connect.assert_not_called()
        self.adb.remove_forward.assert_not_called()
        self.assertEqual(0, transport.summary()["openCount"])

    def test_cleanup_can_borrow_after_failure_and_scope_closes_once(self):
        with solopi_ai.VerificationTransport(self.args, self.adb) as transport:
            self.args._verification_transport = transport
            with self.assertRaises(solopi_ai.CliError):
                with self.borrow():
                    raise solopi_ai.CliError("action transport failure", 4)
            with self.borrow() as session:
                session.agent("status", {"sessionId": "owned-session", "ownerToken": "owned-token"})
        self.adb.forward.assert_called_once()
        self.adb.remove_forward.assert_called_once()
        self.http.get.assert_called_with("agent", {"type": "status", "sessionId": "owned-session", "ownerToken": "owned-token"}, timeout=None)

    def test_uncaught_exception_and_interrupt_close_without_suppressing(self):
        for failure in (RuntimeError("failure"), KeyboardInterrupt()):
            with self.subTest(failure=type(failure).__name__):
                self.adb.remove_forward.reset_mock()
                with self.assertRaises(type(failure)):
                    with solopi_ai.VerificationTransport(self.args, self.adb) as transport:
                        self.args._verification_transport = transport
                        with self.borrow():
                            raise failure
                self.adb.remove_forward.assert_called_once_with(28432)
                with self.assertRaises(solopi_ai.CliError):
                    with self.borrow():
                        self.fail("closed scope was reused")

    def test_startup_failure_cleans_forward_and_is_not_retried(self):
        self.http.get.side_effect = solopi_ai.CliError("offline", 4)
        self.adb.launch.side_effect = KeyboardInterrupt()
        with solopi_ai.VerificationTransport(self.args, self.adb) as transport:
            self.args._verification_transport = transport
            with self.assertRaises(KeyboardInterrupt):
                with self.borrow():
                    pass
            with self.assertRaises(solopi_ai.CliError):
                with self.borrow():
                    pass
        self.adb.launch.assert_called_once()
        self.adb.remove_forward.assert_called_once()
        self.adb.restore_foreground.assert_called_once_with("com.example.target/.Detail")
        self.http.close.assert_called_once()

    def test_connection_identity_changes_and_foreground_downgrade_are_rejected(self):
        with solopi_ai.VerificationTransport(self.args, self.adb) as transport:
            self.args._verification_transport = transport
            with self.borrow():
                pass
            for field, value in (("package", "com.example.other"), ("device_port", 5555), ("local_port", 23456), ("request_timeout", 0.1), ("startup_timeout", 3), ("http_connection", "close")):
                altered = copy.copy(self.args)
                setattr(altered, field, value)
                with self.subTest(field=field), self.assertRaises(solopi_ai.CliError):
                    with self.borrow(altered):
                        pass
            with self.assertRaises(solopi_ai.CliError):
                with solopi_ai.session_from_args(self.args, self.adb):
                    pass
            other_adb = solopi_ai.AdbClient(requested_serial="test-device")
            with self.assertRaises(solopi_ai.CliError):
                with solopi_ai.session_from_args(self.args, other_adb, preserve_foreground=True):
                    pass
            self.adb.device["serial"] = "another-device"
            with self.assertRaises(solopi_ai.CliError):
                with self.borrow():
                    pass
        self.adb.forward.assert_called_once()
        self.adb.remove_forward.assert_called_once()

    def test_separate_runs_never_share_transport(self):
        for _ in range(2):
            with solopi_ai.VerificationTransport(self.args, self.adb) as transport:
                self.args._verification_transport = transport
                with self.borrow():
                    pass
        self.assertEqual(2, self.adb.forward.call_count)
        self.assertEqual(2, self.adb.remove_forward.call_count)

    def test_explicit_close_is_preserved_and_metrics_survive_scope_close(self):
        self.args.http_connection = "close"
        self.http.summary.return_value = {"mode": "close", "requests": 3, "connectionsOpened": 3,
                                          "reusedRequests": 0, "automaticRetries": 0}
        with solopi_ai.VerificationTransport(self.args, self.adb) as transport:
            self.args._verification_transport = transport
            with self.borrow() as session:
                self.assertEqual("close", session.http_connection)
        self.assertFalse(transport.summary()["httpKeepAlive"])
        self.assertEqual(3, transport.summary()["http"]["connectionsOpened"])
        self.http.close.assert_called_once()

    def test_verify_run_keeps_original_args_and_all_oracles_in_both_modes(self):
        for mode in ("isolated", "shared"):
            for scenario, status in (("baseline", "passed"), ("broken", "failed")):
                with self.subTest(mode=mode, scenario=scenario):
                    fixture = cli_fixtures.FastPathCliTests()
                    fixture.setUp()
                    try:
                        adb, imported, replayed, _, acted, ended = fixture.mocked_device(scenario)
                        args = fixture.args(scenario, extras=["--transport-mode", mode])
                        payload, exit_code = solopi_ai.command_verify_run(args, adb)
                        report = json.loads(Path(payload["report"]).read_text())
                        self.assertEqual(status, report["status"])
                        self.assertEqual(0 if status == "passed" else 2, exit_code)
                        self.assertEqual(mode, report["transport"]["mode"])
                        self.assertEqual(mode == "shared", report["transport"]["httpKeepAlive"])
                        self.assertFalse(hasattr(args, "_verification_transport"))
                        self.assertEqual(2, imported.call_count)
                        self.assertEqual(2, replayed.call_count)
                        self.assertEqual(1, acted.call_count)
                        ended.assert_called_once()
                        self.assertEqual("passed", report["scenarios"][0]["cleanup"]["status"])
                    finally:
                        fixture.doCleanups()


class SettleStrategyTests(unittest.TestCase):
    def args(self, option=None):
        return solopi_ai.build_parser().parse_args(
            ["agent-session-start", "--owner-token", "test-owner-token-12345678"]
            + (["--settle-strategy", option] if option else [])
        )

    def start(self, args, capabilities, actual_strategy):
        session = mock.MagicMock()
        session.__enter__.return_value = session
        session.capabilities = capabilities
        status = {"sessionId": "owned-session", "state": "active"}
        if actual_strategy is not None:
            status["settleStrategy"] = actual_strategy
        session.agent.return_value = {"success": True, "session": status,
                                      "observation": {"observationId": "observation-1"}}
        with mock.patch.object(solopi_ai, "session_from_args", return_value=session), \
                mock.patch.object(solopi_ai, "invoke_agent_mutation") as invoke, \
                mock.patch.object(solopi_ai, "best_effort_agent_cancel") as cancel:
            try:
                result, code = solopi_ai.command_agent_session_start(args, mock.Mock())
            except solopi_ai.CliError:
                return None, None, invoke, cancel
        return result, code, invoke, cancel

    def test_declared_event_strategy_uses_cached_capabilities_and_requires_echo(self):
        caps = {"success": True, "settleStrategies": ["legacy", "event-stable-v1"],
                "defaultSettleStrategy": "legacy"}
        for explicit in (True, False):
            args = self.args("event-stable-v1" if explicit else None)
            args._prefer_event_settle = True
            result, code, invoke, cancel = self.start(args, caps, "event-stable-v1")
            self.assertEqual(0, code)
            self.assertTrue(result["settle"]["confirmedBySession"])
            self.assertEqual("event-stable-v1", invoke.call_args.args[1]["settleStrategy"])
            cancel.assert_not_called()
        for actual in (None, "legacy", "unknown"):
            result, _, invoke, cancel = self.start(self.args("event-stable-v1"), caps, actual)
            self.assertIsNone(result)
            invoke.assert_called_once()
            cancel.assert_called_once()
            self.assertEqual("owned-session", cancel.call_args.args[1])

    def test_legacy_apk_auto_compatibility_and_explicit_unsupported_rejection(self):
        args = self.args()
        args._prefer_event_settle = True
        result, code, invoke, _ = self.start(args, {"success": True}, None)
        self.assertEqual(0, code)
        self.assertEqual("legacy_apk", result["settle"]["compatibility"])
        self.assertFalse(result["settle"]["confirmedBySession"])
        self.assertEqual("legacy", invoke.call_args.args[1]["settleStrategy"])
        result, _, invoke, cancel = self.start(self.args("event-stable-v1"), {"success": True}, None)
        self.assertIsNone(result)
        invoke.assert_not_called()
        cancel.assert_not_called()

    def test_malformed_advertisement_cannot_enable_or_silently_fallback(self):
        for strategies in (None, [], "event-stable-v1", ["legacy", "legacy"], ["event-stable-v1"], ["legacy", {}]):
            args = self.args()
            args._prefer_event_settle = True
            result, _, invoke, _ = self.start(args, {"success": True,
                "settleStrategies": strategies, "defaultSettleStrategy": "legacy"}, None)
            self.assertIsNone(result)
            invoke.assert_not_called()

    def test_standalone_default_legacy_does_not_introduce_new_parameters(self):
        result, code, invoke, cancel = self.start(self.args(), None, None)
        self.assertEqual(0, code)
        self.assertEqual("legacy", result["settle"]["selected"])
        self.assertNotIn("settleStrategy", invoke.call_args.args[1])
        cancel.assert_not_called()


class ActionValidationStrategyTests(unittest.TestCase):
    CAPS = {"success": True, "actionValidationStrategies": ["full-page", "target-context-v1"],
            "defaultActionValidationStrategy": "full-page"}

    def start(self, option=None, capabilities=None, actual=None):
        args = solopi_ai.build_parser().parse_args(
            ["agent-session-start", "--owner-token", "test-owner-token-12345678"]
            + (["--action-validation-strategy", option] if option else []))
        session = mock.MagicMock()
        session.__enter__.return_value = session
        session.capabilities = capabilities
        status = {"sessionId": "owned-session", "state": "active"}
        if actual is not None:
            status["actionValidationStrategy"] = actual
        session.agent.return_value = {"success": True, "session": status,
                                      "observation": {"observationId": "observation-1"}}
        with mock.patch.object(solopi_ai, "session_from_args", return_value=session), \
                mock.patch.object(solopi_ai, "invoke_agent_mutation") as invoke, \
                mock.patch.object(solopi_ai, "best_effort_agent_cancel") as cancel:
            try:
                result, code = solopi_ai.command_agent_session_start(args, mock.Mock())
            except solopi_ai.CliError:
                result, code = None, None
        return result, code, invoke, cancel

    def test_default_and_explicit_full_page_keep_old_apk_compatible(self):
        for option in (None, "full-page"):
            result, code, invoke, cancel = self.start(option, {"success": True})
            self.assertEqual(0, code)
            self.assertEqual("full-page", result["actionValidation"]["selected"])
            self.assertFalse(result["actionValidation"]["confirmedBySession"])
            self.assertEqual(option, invoke.call_args.args[1].get("actionValidationStrategy"))
            cancel.assert_not_called()

    def test_opt_in_requires_declared_support_and_exact_echo(self):
        result, code, invoke, cancel = self.start("target-context-v1", self.CAPS, "target-context-v1")
        self.assertEqual(0, code)
        self.assertTrue(result["actionValidation"]["confirmedBySession"])
        self.assertEqual("target-context-v1", invoke.call_args.args[1]["actionValidationStrategy"])
        cancel.assert_not_called()
        for actual in (None, "full-page", "unknown"):
            result, _, invoke, cancel = self.start("target-context-v1", self.CAPS, actual)
            self.assertIsNone(result)
            invoke.assert_called_once()
            cancel.assert_called_once()
            self.assertEqual("owned-session", cancel.call_args.args[1])

    def test_unsupported_and_malformed_caps_fail_before_any_mutation(self):
        caps_list = [{"success": True}, {**self.CAPS, "success": False},
                     {**self.CAPS, "actionValidationStrategies": ["full-page"]}]
        for value in (None, [], "target-context-v1", ["full-page", "full-page"],
                      ["target-context-v1"], ["full-page", {}]):
            caps_list.append({**self.CAPS, "actionValidationStrategies": value})
        caps_list.append({**self.CAPS, "defaultActionValidationStrategy": "unknown"})
        for caps in caps_list:
            with self.subTest(caps=caps):
                result, _, invoke, cancel = self.start("target-context-v1", caps)
                self.assertIsNone(result)
                invoke.assert_not_called()
                cancel.assert_not_called()

    def test_default_rejects_unrequested_new_strategy_echo(self):
        result, _, invoke, cancel = self.start(None, self.CAPS, "target-context-v1")
        self.assertIsNone(result)
        invoke.assert_called_once()
        cancel.assert_called_once()


if __name__ == "__main__":
    unittest.main()
