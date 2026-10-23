import copy
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "solopi_harness"))
import solopi_ai


def host_health():
    return {
        "success": True,
        "appInitialized": True,
        "permissions": {
            "adb": True,
            "accessibility": True,
            "float": False,
            "background": False,
            "powerSave": False,
        },
        "autoStart": False,
        "ready": False,
        "executionProfiles": {
            "host": {
                "replayMode": "headless",
                "requiredPermissions": ["adb", "accessibility"],
                "advisoryPermissions": ["powerSave"],
                "ready": True,
            }
        },
    }


def doctor(health):
    return solopi_ai.doctor_result_from_health(
        "com.alipay.hulu", {"state": "device"}, True, health
    )


class HostExecutionTests(unittest.TestCase):
    def test_warm_control_queries_and_cancel_do_not_launch_solopi(self):
        for command in ("doctor", "capabilities", "status", "result", "cancel"):
            with self.subTest(command=command):
                argv = [command]
                if command in {"result", "cancel"}:
                    argv += ["--run-id", "owned-run"]
                args = solopi_ai.build_parser().parse_args(argv)
                adb = mock.Mock()
                adb.connect.return_value = {"state": "device"}
                adb.package_installed.return_value = True
                adb.forward.return_value = 28432
                http = mock.Mock()

                def get_page(action, params, timeout=None):
                    self.assertEqual("harness", action)
                    if params["type"] == "health":
                        return host_health()
                    if params["type"] == "status":
                        return {"success": True, "active": True, "runId": "owned-run"}
                    if params["type"] == "result":
                        return {"success": True, "terminal": True,
                                "runId": "owned-run", "state": "passed"}
                    self.assertEqual("capabilities", params["type"])
                    return {"success": True}

                http.get.side_effect = get_page
                with mock.patch.object(solopi_ai, "HarnessHttpClient", return_value=http), \
                        mock.patch.object(solopi_ai, "wait_for_terminal_run",
                                          return_value={"state": "cancelled", "runId": "owned-run"}):
                    _, code = solopi_ai.dispatch(args, adb)
                self.assertEqual(0, code)
                adb.launch.assert_not_called()
                adb.restore_foreground.assert_not_called()
                adb.remove_forward.assert_called_once_with(28432)
                if command == "cancel":
                    adb.invoke_scheme.assert_called_once_with(
                        "harness", {"type": "cancel", "runId": "owned-run"}
                    )
                else:
                    adb.invoke_scheme.assert_not_called()

    def test_host_ready_without_overlay_battery_exemption_or_ui_auto_start(self):
        health = host_health()
        result, code = doctor(health)
        self.assertEqual(0, code)
        self.assertTrue(result["success"])
        self.assertEqual("host", result["executionProfile"])
        self.assertEqual("headless", result["replayMode"])
        self.assertEqual([], result["missingPermissions"])
        self.assertEqual([], result["failedChecks"])
        self.assertEqual(["powerSave"], result["advisoryPermissions"])
        self.assertIn("不影响电脑控制", result["warnings"][0])
        self.assertEqual(health, result["health"])

    def test_host_without_missing_advisory_has_no_warning(self):
        health = host_health()
        health["permissions"]["powerSave"] = True
        result, code = doctor(health)
        self.assertEqual(0, code)
        self.assertEqual([], result["warnings"])
        self.assertEqual([], result["advisoryPermissions"])

    def test_host_checks_actual_permissions_even_if_profile_claims_ready(self):
        for permission in ("adb", "accessibility"):
            for value in (False, 1, "true", None):
                with self.subTest(permission=permission, value=value):
                    health = host_health()
                    health["permissions"][permission] = value
                    result, code = doctor(health)
                    self.assertEqual(2, code)
                    self.assertEqual([permission], result["missingPermissions"])

    def test_host_omitted_required_permission_rejects_schema(self):
        health = host_health()
        del health["permissions"]["accessibility"]
        result, code = doctor(health)
        self.assertEqual(2, code)
        self.assertEqual(["accessibility"], result["missingPermissions"])
        self.assertEqual(["permissions"], result["failedChecks"])

    def test_host_checks_initialization_independently(self):
        health = host_health()
        health["appInitialized"] = False
        result, code = doctor(health)
        self.assertEqual(2, code)
        self.assertEqual(["appInitialized"], result["failedChecks"])

    def test_host_false_ready_with_satisfied_requirements_fails(self):
        health = host_health()
        health["executionProfiles"]["host"]["ready"] = False
        result, code = doctor(health)
        self.assertEqual(2, code)
        self.assertEqual(["executionProfiles.host.ready"], result["failedChecks"])

    def test_missing_adb_remains_repairable_without_optional_permissions(self):
        health = host_health()
        health["permissions"]["adb"] = False
        health["executionProfiles"]["host"]["ready"] = False
        result, code = doctor(health)
        self.assertEqual(2, code)
        self.assertEqual(["adb"], result["missingPermissions"])
        # adb-connect requires exactly this gap, with no additional failed checks.
        self.assertEqual([], result["failedChecks"])

    def test_malformed_host_capability_never_falls_back(self):
        malformed = [None, [], {}, {"host": None}, {"host": {}}]
        for key, value in (
            ("replayMode", "interactive"),
            ("requiredPermissions", []),
            ("requiredPermissions", ["adb", "adb"]),
            ("requiredPermissions", ["adb", "accessibility", "float"]),
            ("requiredPermissions", "adb,accessibility"),
            ("requiredPermissions", ["adb", {}]),
            ("advisoryPermissions", []),
            ("advisoryPermissions", ["float"]),
            ("ready", 1),
            ("ready", "true"),
            ("ready", None),
        ):
            profiles = host_health()["executionProfiles"]
            profiles["host"][key] = value
            malformed.append(profiles)
        for profiles in malformed:
            with self.subTest(profiles=profiles):
                health = host_health()
                health["executionProfiles"] = profiles
                result, code = doctor(health)
                self.assertEqual(2, code)
                self.assertFalse(result["success"])
                self.assertEqual("invalid_host_execution_profile", result["errorCode"])
                self.assertEqual(["executionProfiles.host"], result["failedChecks"])
                self.assertNotIn("executionProfile", result)

    def test_old_apk_keeps_legacy_gates_and_explains_upgrade(self):
        health = host_health()
        del health["executionProfiles"]
        result, code = doctor(health)
        self.assertEqual(2, code)
        self.assertEqual("legacy", result["executionProfile"])
        self.assertEqual("interactive", result["replayMode"])
        self.assertEqual(["background", "float", "powerSave"], result["missingPermissions"])
        self.assertEqual(["autoStart"], result["failedChecks"])
        self.assertIn("新版 APK", result["warnings"][0])
        for permission in health["permissions"]:
            health["permissions"][permission] = True
        health.update(ready=True, autoStart=True)
        result, code = doctor(health)
        self.assertEqual(0, code)
        self.assertEqual("interactive", result["replayMode"])

    def run_case(self, health, *options):
        args = solopi_ai.build_parser().parse_args(["run", "--case", "smoke", *options])
        case = {
            "id": 7,
            "caseName": "smoke",
            "caseFingerprint": "a" * 64,
            "targetAppPackage": "com.example.target",
            "operationLog": {
                "steps": [{
                    "operationNode": None,
                    "operationMethod": {
                        "actionEnum": "sleep", "operationParam": {"text": 1000}
                    },
                }]
            },
        }
        session = mock.MagicMock()
        session.__enter__.return_value = session

        def query(kind, params=None):
            if kind == "case":
                return {"success": True, "case": copy.deepcopy(case)}
            if kind == "health":
                return copy.deepcopy(health)
            if kind == "status":
                return {"active": False, "runId": "previous-run"}
            raise AssertionError(kind)

        session.query.side_effect = query
        adb = mock.Mock()
        terminal = {"runId": "new-run", "state": "passed", "terminal": True, "active": False}
        with mock.patch.object(solopi_ai, "session_from_args", return_value=session) as factory, \
                mock.patch.object(solopi_ai, "wait_for_new_run", return_value=terminal):
            try:
                result, code = solopi_ai.command_run(args, adb)
            except solopi_ai.CliError:
                adb.invoke_scheme.assert_not_called()
                raise
        factory.assert_called_once_with(args, adb, preserve_foreground=True)
        return result, code, adb

    def test_run_defaults_to_headless_without_config_mutation(self):
        for options in ((), ("--no-auto-start",)):
            with self.subTest(options=options):
                result, code, adb = self.run_case(host_health(), *options)
                self.assertEqual(0, code)
                self.assertTrue(result["success"])
                self.assertEqual("headless", result["replayMode"])
                self.assertEqual(["powerSave"], result["advisoryPermissions"])
                adb.invoke_scheme.assert_called_once()
                scheme, params = adb.invoke_scheme.call_args.args
                self.assertEqual("replay", scheme)
                self.assertEqual("true", params["headless"])
                self.assertEqual("7", params["caseId"])
                self.assertEqual("a" * 64, params["caseFingerprint"])
                self.assertTrue(params["requestId"].startswith("replay-"))

    def test_run_checks_real_host_prerequisites_before_any_mutation(self):
        for missing in ("adb", "accessibility", "appInitialized", "ready"):
            with self.subTest(missing=missing):
                health = host_health()
                if missing in ("adb", "accessibility"):
                    health["permissions"][missing] = False
                elif missing == "appInitialized":
                    health[missing] = False
                else:
                    health["executionProfiles"]["host"]["ready"] = False
                result, code, adb = self.run_case(health)
                self.assertEqual(2, code)
                self.assertFalse(result["success"])
                adb.invoke_scheme.assert_not_called()

    def test_run_rejects_malformed_profile_without_config_mutation(self):
        health = host_health()
        health["executionProfiles"]["host"]["requiredPermissions"] = []
        with self.assertRaises(solopi_ai.CliError) as error:
            self.run_case(health)
        self.assertEqual("invalid_host_execution_profile", error.exception.details["errorCode"])

    def test_run_old_apk_uses_interactive_config_and_no_headless_flag(self):
        health = host_health()
        del health["executionProfiles"]
        for permission in health["permissions"]:
            health["permissions"][permission] = True
        health.update(ready=True, autoStart=True)
        result, code, adb = self.run_case(health)
        self.assertEqual(0, code)
        self.assertEqual("interactive", result["replayMode"])
        self.assertEqual(2, adb.invoke_scheme.call_count)
        self.assertEqual(
            mock.call("config", {"key": "KEY_REPLAY_AUTO_START", "value": "true"}),
            adb.invoke_scheme.call_args_list[0],
        )
        self.assertNotIn("headless", adb.invoke_scheme.call_args.args[1])


if __name__ == "__main__":
    unittest.main()
