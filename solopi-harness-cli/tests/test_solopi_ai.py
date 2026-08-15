import importlib.util
import copy
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
import zipfile
import xml.etree.ElementTree as ElementTree
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = (
    REPO_ROOT / "solopi-harness-cli" / "src" / "solopi_harness" / "solopi_ai.py"
)
SKILL_CLI = REPO_ROOT / "solopi-skill" / "scripts" / "solopi-ai"
TOOLS_CLI = REPO_ROOT / "tools" / "solopi-ai" / "solopi-ai"
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("solopi_ai", MODULE_PATH)
solopi_ai = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = solopi_ai
SPEC.loader.exec_module(solopi_ai)


class SoloPiAiTests(unittest.TestCase):
    def test_agent_harness_session_restores_foreground_after_control_startup(self):
        adb = mock.Mock()
        adb.package_installed.return_value = True
        adb.foreground_component.return_value = "com.example.counter/.MainActivity"
        adb.forward.return_value = 28432
        session = solopi_ai.HarnessSession(
            adb, "com.alipay.hulu", 23342, 0, 5, 10, preserve_foreground=True
        )

        with mock.patch.object(session, "wait_until_available"):
            with session:
                pass

        adb.launch.assert_called_once_with("com.alipay.hulu")
        adb.restore_foreground.assert_called_once_with("com.example.counter/.MainActivity")

    def test_agent_mutation_restores_exact_foreground_component(self):
        adb = mock.Mock()
        adb.foreground_component.return_value = "com.example.counter/.MainActivity"
        adb.invoke_scheme.return_value = "solopi://startaction/agent"

        result = solopi_ai.invoke_agent_mutation(
            adb, {"type": "pause", "sessionId": "agent-session-1"}, timeout=7
        )

        self.assertEqual("solopi://startaction/agent", result)
        adb.invoke_scheme.assert_called_once_with(
            "agent", {"type": "pause", "sessionId": "agent-session-1"}, timeout=7
        )
        adb.restore_foreground.assert_called_once_with("com.example.counter/.MainActivity")

    def test_adb_foreground_component_accepts_only_parsed_current_focus(self):
        runner = mock.Mock()
        runner.run.return_value = solopi_ai.CommandResult(
            0,
            stdout=(
                "mCurrentFocus=Window{25527e5 u0 "
                "com.example.counter/com.example.counter.MainActivity}\n"
            ),
        )
        adb = solopi_ai.AdbClient(runner=runner)
        adb.device = {"serial": "serial-1", "state": "device"}

        self.assertEqual(
            "com.example.counter/com.example.counter.MainActivity",
            adb.foreground_component(),
        )

    def test_agent_parser_exposes_only_typed_action_allowlist(self):
        parser = solopi_ai.build_parser()
        parsed = parser.parse_args(
            [
                "agent-act",
                "--session-id", "agent-session-1",
                "--owner-token", "a" * 32,
                "--step-id", "step-1",
                "--observation-id", "observation-1",
                "--action", "click",
                "--node-id", "node-7",
            ]
        )
        self.assertEqual("click", parsed.action)
        with self.assertRaises(SystemExit):
            parser.parse_args(
                [
                    "agent-act",
                    "--session-id", "agent-session-1",
                    "--owner-token", "a" * 32,
                    "--step-id", "step-1",
                    "--observation-id", "observation-1",
                    "--action", "executeShell",
                ]
            )

    def test_agent_session_start_uses_adb_then_waits_for_owned_observation(self):
        args = solopi_ai.build_parser().parse_args(
            ["agent-session-start", "--owner-token", "a" * 32]
        )
        adb = mock.Mock()

        class FakeSession:
            request_timeout = 5

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def agent(self, query_type, params=None, timeout=None):
                self.last_call = (query_type, params, timeout)
                return {
                    "success": True,
                    "session": {
                        "sessionId": "agent-session-1",
                        "state": "active",
                        "terminal": False,
                    },
                    "observation": {"observationId": "observation-1"},
                    "timelinePath": "/sdcard/solopi/agent-sessions/agent-session-1/timeline.jsonl",
                }

        session = FakeSession()
        with mock.patch.object(solopi_ai, "session_from_args", return_value=session):
            result, exit_code = solopi_ai.command_agent_session_start(args, adb)

        self.assertEqual(0, exit_code)
        self.assertEqual("a" * 32, result["ownerToken"])
        self.assertEqual("observation-1", result["observation"]["observationId"])
        adb.invoke_scheme.assert_called_once()
        action, params = adb.invoke_scheme.call_args.args[:2]
        self.assertEqual("agent", action)
        self.assertEqual("start", params["type"])
        self.assertEqual("a" * 32, params["ownerToken"])
        self.assertEqual(("start-status", {"ownerToken": "a" * 32}, 5), session.last_call)

    def test_agent_observe_is_read_only_and_agent_act_polls_typed_receipt(self):
        observe_args = solopi_ai.build_parser().parse_args(
            [
                "agent-observe", "--session-id", "agent-session-1",
                "--owner-token", "a" * 32,
            ]
        )
        act_args = solopi_ai.build_parser().parse_args(
            [
                "agent-act", "--session-id", "agent-session-1",
                "--owner-token", "a" * 32,
                "--step-id", "step-1", "--observation-id", "observation-1",
                "--action", "input", "--node-id", "node-2", "--text", "hello",
            ]
        )
        adb = mock.Mock()

        class FakeSession:
            request_timeout = 5

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def agent(self, query_type, params=None, timeout=None):
                if query_type == "observe":
                    return {"success": True, "observation": {"observationId": "observation-2"}}
                return {
                    "success": True,
                    "receipt": {
                        "stepId": "step-1",
                        "status": "succeeded",
                        "settledObservation": {"observationId": "observation-2"},
                    },
                }

        session = FakeSession()
        with mock.patch.object(solopi_ai, "session_from_args", return_value=session):
            observed, observe_exit = solopi_ai.command_agent_observe(observe_args, adb)
            acted, act_exit = solopi_ai.command_agent_act(act_args, adb)

        self.assertEqual(0, observe_exit)
        self.assertEqual("observation-2", observed["observation"]["observationId"])
        self.assertEqual(0, act_exit)
        self.assertEqual("succeeded", acted["receipt"]["status"])
        action, params = adb.invoke_scheme.call_args.args[:2]
        self.assertEqual("agent", action)
        self.assertEqual("act", params["type"])
        self.assertEqual("input", params["action"])
        self.assertEqual("node-2", params["nodeId"])
        self.assertEqual("hello", params["text"])

    def test_agent_act_interrupt_attempts_exact_session_cleanup(self):
        args = solopi_ai.build_parser().parse_args(
            [
                "agent-act", "--session-id", "agent-session-1",
                "--owner-token", "a" * 32,
                "--step-id", "step-1", "--observation-id", "observation-1",
                "--action", "back",
            ]
        )
        adb = mock.Mock()

        class FakeSession:
            request_timeout = 5

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def agent(self, query_type, params=None, timeout=None):
                raise KeyboardInterrupt()

        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()):
            with self.assertRaises(KeyboardInterrupt):
                solopi_ai.command_agent_act(args, adb)

        calls = adb.invoke_scheme.call_args_list
        self.assertEqual("act", calls[0].args[1]["type"])
        self.assertEqual("cancel", calls[-1].args[1]["type"])
        self.assertEqual("agent-session-1", calls[-1].args[1]["sessionId"])
        self.assertEqual("a" * 32, calls[-1].args[1]["ownerToken"])

    def test_app_feature_inventory_covers_manifest_activities_and_config_specs(self):
        inventory = (
            REPO_ROOT
            / "solopi-skill"
            / "references"
            / "app-feature-inventory.md"
        ).read_text(encoding="utf-8")
        android_name = "{http://schemas.android.com/apk/res/android}name"
        manifest_paths = (
            REPO_ROOT / "solopi-app" / "app" / "src" / "main" / "AndroidManifest.xml",
            REPO_ROOT / "solopi-app" / "common" / "src" / "main" / "AndroidManifest.xml",
        )
        activity_names = set()
        for manifest_path in manifest_paths:
            root = ElementTree.parse(manifest_path).getroot()
            for activity in root.findall("./application/activity"):
                declared_name = activity.attrib[android_name]
                activity_names.add(declared_name.rsplit(".", 1)[-1])

        self.assertGreaterEqual(len(activity_names), 20)
        for activity_name in sorted(activity_names):
            self.assertIn("`%s`" % activity_name, inventory, activity_name)

        config_source = (
            REPO_ROOT
            / "solopi-app"
            / "app"
            / "src"
            / "main"
            / "java"
            / "com"
            / "alipay"
            / "hulu"
            / "scheme"
            / "ConfigSchemeResolver.java"
        ).read_text(encoding="utf-8")
        config_keys = set(
            re.findall(r"add\(result,\s*(KEY_[A-Z0-9_]+)", config_source)
        )
        self.assertEqual(25, len(config_keys))
        for config_key in sorted(config_keys):
            self.assertIn("`%s`" % config_key, inventory, config_key)

    def test_skill_cli_resolves_sibling_cli_from_any_working_directory(self):
        with tempfile.TemporaryDirectory(prefix="solopi skill ") as temporary_dir:
            temporary_path = Path(temporary_dir)
            copied_root = temporary_path / "installed monorepo"
            copied_skill = copied_root / "solopi-skill"
            shutil.copytree(REPO_ROOT / "solopi-skill", copied_skill)
            shutil.copytree(
                REPO_ROOT / "solopi-harness-cli",
                copied_root / "solopi-harness-cli",
            )
            caller_directory = temporary_path / "caller workspace"
            caller_directory.mkdir()

            result = subprocess.run(
                [
                    str(copied_skill / "scripts" / "solopi-ai"),
                    "case-template",
                    "--name",
                    "sibling-cli",
                    "--target-package",
                    "com.example.app",
                ],
                cwd=caller_directory,
                capture_output=True,
                text=True,
                timeout=10,
            )

            self.assertEqual(0, result.returncode, result.stderr)
            payload = json.loads(result.stdout)
            self.assertTrue(payload["success"])
            self.assertEqual("sibling-cli", payload["case"]["caseName"])

    def test_tools_cli_forwards_to_skill_cli(self):
        arguments = [
            "case-template",
            "--name",
            "compatibility",
            "--target-package",
            "com.example.app",
        ]
        skill_result = subprocess.run(
            [str(SKILL_CLI), *arguments],
            capture_output=True,
            text=True,
            timeout=10,
        )
        tools_result = subprocess.run(
            [str(TOOLS_CLI), *arguments],
            capture_output=True,
            text=True,
            timeout=10,
        )

        self.assertEqual(0, skill_result.returncode, skill_result.stderr)
        self.assertEqual(0, tools_result.returncode, tools_result.stderr)
        self.assertEqual(skill_result.returncode, tools_result.returncode)
        self.assertEqual(json.loads(skill_result.stdout), json.loads(tools_result.stdout))

    def sample_case(self, action="sleep", operation_node=None):
        return {
            "id": 7,
            "caseName": "payment-smoke",
            "caseFingerprint": "a" * 64,
            "targetAppPackage": "com.example.pay",
            "operationLog": {
                "steps": [
                    {
                        "operationNode": operation_node,
                        "operationMethod": {
                            "actionEnum": action,
                            "operationParam": {"text": 1000},
                        },
                    }
                ]
            },
        }

    def case_steps_from_file(self, path):
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        operation_log = payload["operationLog"]
        if isinstance(operation_log, str):
            operation_log = json.loads(operation_log)
        return payload, operation_log["steps"]

    def plugin_list_payload(self, import_files=None, plugins=None, import_path=None):
        plugin_items = [] if plugins is None else plugins
        return {
            "success": True,
            "plugins": plugin_items,
            "total": len(plugin_items),
            "importDirectory": "patch",
            "importPath": import_path or "/sdcard/solopi/patch",
            "pathAvailable": True,
            "importFiles": [] if import_files is None else import_files,
            "importFilesTruncated": False,
            "mutationTransport": "adb",
        }

    def plugin_summary(self):
        return {
            "id": "plugin-" + "a" * 64,
            "name": "sample_plugin",
            "version": 2.0,
            "status": "loaded",
            "source": "managed_patch_store",
            "core": False,
            "removable": True,
            "runtimeLoaded": True,
            "hasCode": True,
            "hasNativeLibraries": False,
            "hasAssets": False,
            "filter": "com.example",
            "dependencies": [],
            "catalogAvailable": False,
        }

    def record_status(self, state, session_id="record-1", cancelled=False):
        idle = state == "idle"
        started = state in {"recording", "stopping"} or (
            state == "stopped" and not cancelled
        )
        terminal = state in {"stopped", "failed"}
        return {
            "success": True,
            "kind": "recording",
            "sessionId": None if idle else session_id,
            "state": state,
            "recording": state == "recording",
            "active": state in {"starting", "recording", "stopping"},
            "terminal": terminal,
            "caseName": None if idle else "smoke",
            "caseId": 7 if state == "stopped" and not cancelled else None,
            "cancelledBeforeStart": cancelled,
            "targetPackage": None if idle else "com.example",
            "startedAt": 10 if started else None,
            "finishedAt": 20 if terminal else None,
            "durationMs": 10 if started and terminal else (1 if started else None),
            "error": "recording failed" if state == "failed" else None,
        }

    def screen_record_status(
        self,
        state,
        session_id="screen-1",
        cancelled=False,
        file_size=128,
        output_path=None,
    ):
        idle = state == "idle"
        active = state in {
            "pending-user-confirmation",
            "starting",
            "recording",
            "stopping",
        }
        terminal = state in {"stopped", "failed"}
        started = state in {"recording", "stopping"} or (
            state == "stopped" and not cancelled
        )
        captures_root = "/storage/emulated/0/solopi/ScreenCaptures"
        if output_path is None and (
            state in {"recording", "stopping"} or (state == "stopped" and not cancelled)
        ):
            output_path = captures_root + "/Screen-20260807-120000-720x480.mp4"
        has_output = output_path is not None
        pending = state == "pending-user-confirmation"
        return {
            "success": True,
            "kind": "screen-recording",
            "sessionId": None if idle else session_id,
            "state": state,
            "recording": state == "recording",
            "active": active,
            "terminal": terminal,
            "userActionRequired": pending,
            "requiredUserAction": (
                solopi_ai.SCREEN_RECORD_REQUIRED_USER_ACTION if pending else None
            ),
            "resolution": None if idle else "720x480",
            "width": None if idle else 720,
            "height": None if idle else 480,
            "bitrateKbps": None if idle else 2500,
            "frameRate": None if idle else 30,
            "durationSec": None if idle else 300,
            "requestedAt": None if idle else 5,
            "startedAt": 10 if started else None,
            "finishedAt": 20 if terminal else None,
            "durationMs": 10 if started and terminal else (1 if started else None),
            "capturesRoot": None if idle else captures_root,
            "outputPath": None if idle or cancelled else output_path,
            "fileSize": file_size if has_output and not cancelled else None,
            "autoStopped": False,
            "cancelledBeforeStart": cancelled,
            "error": "screen recording failed" if state == "failed" else None,
        }

    def scan_status(
        self,
        state,
        session_id="scan-1",
        content="solopi://startaction/config?action=set",
        manual=False,
    ):
        idle = state == "idle"
        active = state in {"starting", "pending-camera-permission", "scanning"}
        terminal = state in {"completed", "cancelled", "failed"}
        started = state in {"scanning", "completed"}
        user_action = solopi_ai.SCAN_REQUIRED_USER_ACTIONS.get(state)
        return {
            "success": True,
            "kind": "scan",
            "sessionId": None if idle else session_id,
            "state": state,
            "active": active,
            "terminal": terminal,
            "scanning": state == "scanning",
            "userActionRequired": user_action is not None,
            "requiredUserAction": user_action,
            "manualScanActive": manual,
            "protocolActivityAttached": active and state != "starting",
            "content": content if state == "completed" else None,
            "format": "QR_CODE" if state == "completed" else None,
            "codeType": "QR CODE" if state == "completed" else None,
            "contentExecuted": False,
            "requestedAt": None if idle else 5,
            "startedAt": 10 if started else None,
            "finishedAt": 20 if terminal else None,
            "durationMs": 10 if started and terminal else None,
            "error": "camera failed" if state == "failed" else None,
        }

    def performance_display_status(
        self,
        state,
        session_id="display-1",
        stop_retryable=False,
    ):
        idle = state == "idle"
        active = state in {"starting", "running", "stopping"}
        terminal = state in {"stopped", "failed"}
        started = state in {"running", "stopping", "stopped"}
        owned = ["CPU"] if state in {"running", "stopping"} else []
        return {
            "success": True,
            "kind": "performance-display",
            "sessionId": None if idle else session_id,
            "state": state,
            "running": state == "running",
            "active": active,
            "terminal": terminal,
            "stopRetryable": stop_retryable,
            "targetPackage": None if idle else "com.example",
            "items": [] if idle else ["CPU"],
            "ownedDisplayNames": owned,
            "runningItems": owned,
            "sampledAt": 100,
            "values": {"CPU": "12%"} if state == "running" else {},
            "startedAt": 10 if started else None,
            "finishedAt": 20 if terminal else None,
            "durationMs": 10 if started else None,
            "error": "display failed" if state == "failed" else (
                "cleanup incomplete" if stop_retryable else None
            ),
        }

    def video_analysis_receipt(
        self,
        state="analyzing",
        request_id="video-request-1",
        response_time=321,
    ):
        terminal = state in {"completed", "failed"}
        result = {
            "success": state != "failed",
            "requestId": request_id,
            "state": state,
            "terminal": terminal,
            "videoFileName": "Screen-demo.mp4",
            "videoPath": "/sdcard/solopi/ScreenCaptures/Screen-demo.mp4",
            "sizeBytes": 1024,
            "actionOffsetMs": 250,
            "differenceThreshold": 0.2,
            "startedAt": 1000,
        }
        if terminal:
            result["completedAt"] = 1200
        if state == "completed":
            result["visualResponseTimeMs"] = response_time
            result["measurement"] = "SoloPi screen-recording video difference"
        elif state == "failed":
            result["errorCode"] = "analysis_failed"
            result["error"] = "video analyzer failed"
        return result

    def test_parse_and_select_single_device(self):
        output = (
            "List of devices attached\n"
            "emulator-5554 device product:sdk model:Pixel_6 transport_id:1\n"
            "offline-1 offline transport_id:2\n"
        )
        devices = solopi_ai.parse_devices(output)
        selected = solopi_ai.select_device(devices, None)
        self.assertEqual("emulator-5554", selected["serial"])
        self.assertEqual("Pixel_6", selected["model"])

    def test_multiple_devices_require_serial(self):
        devices = [
            {"serial": "a", "state": "device"},
            {"serial": "b", "state": "device"},
        ]
        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.select_device(devices, None)
        self.assertEqual(3, error.exception.exit_code)

    def test_explicit_serial_uses_direct_state_check(self):
        runner = mock.Mock()
        runner.run.return_value = solopi_ai.CommandResult(0, stdout="device\n")
        adb = solopi_ai.AdbClient(requested_serial="cloud:5900", runner=runner)

        self.assertEqual(
            {"serial": "cloud:5900", "state": "device"},
            adb.connect(),
        )
        runner.run.assert_called_once_with(
            ["adb", "-s", "cloud:5900", "get-state"],
            timeout=10,
        )

    def test_doctor_reports_structured_setup_gaps(self):
        args = mock.Mock(package="com.alipay.hulu")
        adb = mock.Mock()
        adb.connect.return_value = {"serial": "pixel-8", "state": "device"}
        adb.package_installed.return_value = True
        health = {
            "success": True,
            "appInitialized": True,
            "permissions": {
                "adb": False,
                "float": True,
                "background": True,
                "powerSave": True,
                "accessibility": False,
            },
            "autoStart": False,
            "ready": False,
        }
        session = mock.MagicMock()
        session.__enter__.return_value = session
        session.query.return_value = health

        with mock.patch.object(solopi_ai, "session_from_args", return_value=session):
            result, exit_code = solopi_ai.command_doctor(args, adb)

        self.assertEqual(2, exit_code)
        self.assertFalse(result["success"])
        self.assertEqual(["accessibility", "adb"], result["missingPermissions"])
        self.assertEqual(["autoStart"], result["failedChecks"])
        self.assertEqual(health, result["health"])

    def test_doctor_returns_empty_gap_lists_when_ready(self):
        args = mock.Mock(package="com.alipay.hulu")
        adb = mock.Mock()
        adb.connect.return_value = {"serial": "pixel-8", "state": "device"}
        adb.package_installed.return_value = True
        health = {
            "success": True,
            "appInitialized": True,
            "permissions": {
                "adb": True,
                "float": True,
                "background": True,
                "powerSave": True,
                "accessibility": True,
            },
            "autoStart": True,
            "ready": True,
        }
        session = mock.MagicMock()
        session.__enter__.return_value = session
        session.query.return_value = health

        with mock.patch.object(solopi_ai, "session_from_args", return_value=session):
            result, exit_code = solopi_ai.command_doctor(args, adb)

        self.assertEqual(0, exit_code)
        self.assertTrue(result["success"])
        self.assertEqual([], result["missingPermissions"])
        self.assertEqual([], result["failedChecks"])

    def test_doctor_rejects_inconsistent_ready_health(self):
        args = mock.Mock(package="com.alipay.hulu")
        adb = mock.Mock()
        adb.connect.return_value = {"serial": "pixel-8", "state": "device"}
        adb.package_installed.return_value = True
        health = {
            "success": True,
            "appInitialized": True,
            "permissions": {
                "adb": True,
                "float": True,
                "background": True,
                "powerSave": True,
                "accessibility": True,
            },
            "autoStart": False,
            "ready": True,
        }
        session = mock.MagicMock()
        session.__enter__.return_value = session
        session.query.return_value = health

        with mock.patch.object(solopi_ai, "session_from_args", return_value=session):
            result, exit_code = solopi_ai.command_doctor(args, adb)

        self.assertEqual(2, exit_code)
        self.assertFalse(result["success"])
        self.assertEqual([], result["missingPermissions"])
        self.assertEqual(["autoStart"], result["failedChecks"])

    def test_doctor_rejects_health_that_omits_a_required_permission(self):
        health = {
            "success": True,
            "appInitialized": True,
            "permissions": {
                "adb": True,
                "float": True,
                "background": True,
                "accessibility": True,
            },
            "autoStart": True,
            "ready": True,
        }

        result, exit_code = solopi_ai.doctor_result_from_health(
            "com.alipay.hulu",
            {"serial": "pixel-8", "state": "device"},
            True,
            health,
        )

        self.assertEqual(2, exit_code)
        self.assertEqual(["powerSave"], result["missingPermissions"])
        self.assertEqual(["permissions"], result["failedChecks"])

    def test_adb_connect_parser_uses_bounded_defaults(self):
        args = solopi_ai.build_parser().parse_args(["adb-connect"])

        self.assertEqual("adb-connect", args.command)
        self.assertEqual(20, args.connect_timeout)
        self.assertEqual(5, args.ready_timeout)
        self.assertEqual(0.25, args.poll_interval)

    def test_adb_connect_invokes_protected_scheme_and_requires_ready_doctor(self):
        request_id = "adb-request-1"
        missing_adb = {
            "success": True,
            "appInitialized": True,
            "permissions": {
                "adb": False,
                "float": True,
                "background": True,
                "powerSave": True,
                "accessibility": True,
            },
            "autoStart": True,
            "ready": False,
        }
        ready = copy.deepcopy(missing_adb)
        ready["permissions"]["adb"] = True
        ready["ready"] = True
        statuses = [
            {
                "success": True,
                "requestId": request_id,
                "state": "connecting",
                "connected": False,
                "terminal": False,
                "userActionRequired": False,
                "requiredUserAction": None,
            },
            {
                "success": True,
                "requestId": request_id,
                "state": "connected",
                "connected": True,
                "terminal": True,
                "userActionRequired": False,
                "requiredUserAction": None,
            },
        ]

        class FakeSession:
            request_timeout = 5

            def __init__(self):
                self.health = [missing_adb, ready]
                self.statuses = list(statuses)

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def query(self, query_type, params=None, timeout=None):
                self.assert_unused = (params, timeout)
                self_test.assertEqual("health", query_type)
                return self.health.pop(0)

            def adb_connect_status(self, actual_request_id, timeout=None):
                self_test.assertEqual(request_id, actual_request_id)
                self_test.assertGreater(timeout, 0)
                return self.statuses.pop(0)

        self_test = self
        session = FakeSession()
        adb = mock.Mock()
        adb.connect.return_value = {"serial": "pixel-8", "state": "device"}
        adb.package_installed.return_value = True
        args = solopi_ai.build_parser().parse_args(["adb-connect"])
        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=session
        ), mock.patch.object(solopi_ai.uuid, "uuid4", return_value=request_id), mock.patch.object(
            solopi_ai.time, "sleep", return_value=None
        ):
            result, exit_code = solopi_ai.command_adb_connect(args, adb)

        self.assertEqual(0, exit_code)
        self.assertTrue(result["success"])
        self.assertTrue(result["connected"])
        self.assertTrue(result["doctor"]["health"]["ready"])
        self.assertFalse(result["alreadyConnected"])
        adb.invoke_scheme.assert_called_once_with(
            "harness", {"type": "adb-connect", "requestId": request_id}
        )

    def test_adb_connect_preserves_user_action_on_connection_failure(self):
        request_id = "adb-request-failed"
        health = {
            "success": True,
            "appInitialized": True,
            "permissions": {
                "adb": False,
                "float": True,
                "background": True,
                "powerSave": True,
                "accessibility": True,
            },
            "autoStart": True,
            "ready": False,
        }
        failed = {
            "success": False,
            "requestId": request_id,
            "state": "failed",
            "connected": False,
            "terminal": True,
            "userActionRequired": True,
            "requiredUserAction": solopi_ai.ADB_CONNECT_REQUIRED_USER_ACTION,
            "errorCode": "adb_connection_failed",
            "error": "SoloPi internal ADB connection failed",
        }
        session = mock.MagicMock()
        session.__enter__.return_value = session
        session.query.side_effect = [health, health]
        session.adb_connect_status.return_value = failed
        session.request_timeout = 5
        adb = mock.Mock()
        adb.connect.return_value = {"serial": "pixel-8", "state": "device"}
        adb.package_installed.return_value = True
        args = solopi_ai.build_parser().parse_args(["adb-connect"])

        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=session
        ), mock.patch.object(solopi_ai.uuid, "uuid4", return_value=request_id):
            result, exit_code = solopi_ai.command_adb_connect(args, adb)

        self.assertEqual(2, exit_code)
        self.assertFalse(result["success"])
        self.assertFalse(result["connected"])
        self.assertTrue(result["userActionRequired"])
        self.assertEqual(
            solopi_ai.ADB_CONNECT_REQUIRED_USER_ACTION,
            result["requiredUserAction"],
        )
        self.assertFalse(result["doctor"]["health"]["permissions"]["adb"])

    def test_adb_connect_rejects_other_doctor_gaps_without_mutation(self):
        health = {
            "success": True,
            "appInitialized": True,
            "permissions": {
                "adb": False,
                "float": True,
                "background": True,
                "powerSave": True,
                "accessibility": False,
            },
            "autoStart": True,
            "ready": False,
        }
        session = mock.MagicMock()
        session.__enter__.return_value = session
        session.query.return_value = health
        adb = mock.Mock()
        adb.connect.return_value = {"serial": "pixel-8", "state": "device"}
        adb.package_installed.return_value = True
        args = solopi_ai.build_parser().parse_args(["adb-connect"])

        with mock.patch.object(solopi_ai, "session_from_args", return_value=session):
            result, exit_code = solopi_ai.command_adb_connect(args, adb)

        self.assertEqual(2, exit_code)
        self.assertEqual("adb_connect_precondition_failed", result["errorCode"])
        self.assertEqual(["accessibility", "adb"], result["doctor"]["missingPermissions"])
        adb.invoke_scheme.assert_not_called()
        session.adb_connect_status.assert_not_called()

    def test_adb_connect_status_rejects_inconsistent_terminal_flags(self):
        response = {
            "success": True,
            "requestId": "adb-request-1",
            "state": "connected",
            "connected": False,
            "terminal": True,
            "userActionRequired": False,
            "requiredUserAction": None,
        }

        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.validate_adb_connect_status(response, "adb-request-1")

        self.assertEqual(4, error.exception.exit_code)

    def test_scheme_uri_encodes_case_name(self):
        uri = solopi_ai.build_scheme_uri(
            "replay", {"replayMode": "normal", "caseName": "支付 & 退款"}
        )
        self.assertIn("caseName=%E6%94%AF%E4%BB%98+%26+%E9%80%80%E6%AC%BE", uri)
        self.assertNotIn(" & ", uri)

    def test_http_client_requires_json_object(self):
        payload = {"success": True, "protocolVersion": "1.0"}

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                body = json.dumps(payload).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format, *args):
                return

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever)
        thread.daemon = True
        thread.start()
        try:
            client = solopi_ai.HarnessHttpClient(server.server_port, timeout=1)
            self.assertEqual(payload, client.get("harness", {"type": "capabilities"}))
        finally:
            server.shutdown()
            thread.join(timeout=2)
            server.server_close()

    def test_parser_defaults_to_waiting_for_run(self):
        args = solopi_ai.build_parser().parse_args(["run", "--case", "smoke"])
        self.assertTrue(args.wait)
        self.assertEqual(600, args.run_timeout)

    def test_replay_override_options_are_typed_for_single_and_sequence_runs(self):
        default = solopi_ai.build_parser().parse_args(["run", "--case", "smoke"])
        single = solopi_ai.build_parser().parse_args(
            [
                "run",
                "--case",
                "smoke",
                "--target-package",
                "com.example.override",
                "--no-restart-app",
            ]
        )
        repeat = solopi_ai.build_parser().parse_args(
            [
                "run-repeat",
                "--case",
                "smoke",
                "--times",
                "2",
                "--target-package",
                "com.example.override",
                "--restart-app",
            ]
        )
        batch = solopi_ai.build_parser().parse_args(
            [
                "run-batch",
                "--case",
                "one",
                "--case",
                "two",
                "--target-package",
                "com.example.override",
                "--no-restart-app",
            ]
        )

        self.assertIsNone(default.target_package)
        self.assertIsNone(default.restart_app)
        self.assertEqual("com.example.override", single.target_package)
        self.assertFalse(single.restart_app)
        self.assertTrue(repeat.restart_app)
        self.assertFalse(batch.restart_app)

    def test_video_analysis_parser_uses_bounded_typed_options(self):
        start = solopi_ai.build_parser().parse_args(
            [
                "video-analysis-start",
                "--video-path",
                "/sdcard/solopi/ScreenCaptures/Screen-demo.mp4",
                "--action-offset-ms",
                "250",
                "--difference-threshold",
                "0.2",
            ]
        )
        status = solopi_ai.build_parser().parse_args(
            ["video-analysis-status", "--request-id", "video-request-1"]
        )

        self.assertTrue(start.wait)
        self.assertEqual(15, start.ack_timeout)
        self.assertEqual(120, start.analysis_timeout)
        self.assertEqual(0.5, start.poll_interval)
        self.assertEqual(250, start.action_offset_ms)
        self.assertEqual(0.2, start.difference_threshold)
        self.assertEqual("video-request-1", status.request_id)
        with self.assertRaises(solopi_ai.argparse.ArgumentTypeError):
            solopi_ai.video_action_offset_ms("3600001")
        with self.assertRaises(solopi_ai.argparse.ArgumentTypeError):
            solopi_ai.video_difference_threshold("0")

    def test_numeric_argument_errors_are_chinese(self):
        with self.assertRaises(solopi_ai.argparse.ArgumentTypeError) as float_error:
            solopi_ai.positive_float("not-a-number")
        with self.assertRaises(solopi_ai.argparse.ArgumentTypeError) as int_error:
            solopi_ai.positive_int("0")

        self.assertEqual("必须是数字", str(float_error.exception))
        self.assertEqual("必须大于零", str(int_error.exception))

    def test_parser_exposes_performance_commands(self):
        start = solopi_ai.build_parser().parse_args(
            [
                "perf-start",
                "--target-package",
                "com.example",
                "--items",
                "CPU,Memory",
            ]
        )
        stop = solopi_ai.build_parser().parse_args(
            ["perf-stop", "--session-id", "perf-1"]
        )
        global_start = solopi_ai.build_parser().parse_args(
            ["perf-start", "--global", "--items", "Battery,Temperature"]
        )

        self.assertEqual(30, start.ack_timeout)
        self.assertEqual(0.5, start.poll_interval)
        self.assertEqual(60, stop.stop_timeout)
        self.assertEqual(0.5, stop.poll_interval)
        self.assertTrue(global_start.global_target)
        self.assertIsNone(global_start.target_package)

    def test_parser_exposes_performance_display_commands(self):
        start = solopi_ai.build_parser().parse_args(
            [
                "perf-display-start",
                "--target-package",
                "com.example",
                "--items",
                "CPU,Memory",
            ]
        )
        status = solopi_ai.build_parser().parse_args(
            ["perf-display-status", "--session-id", "display-1"]
        )
        stop = solopi_ai.build_parser().parse_args(
            ["perf-display-stop", "--session-id", "display-1"]
        )
        global_start = solopi_ai.build_parser().parse_args(
            ["perf-display-start", "--global", "--items", "Battery,Temperature"]
        )

        self.assertEqual(30, start.ack_timeout)
        self.assertEqual(0.5, start.poll_interval)
        self.assertEqual("display-1", status.session_id)
        self.assertEqual(60, stop.stop_timeout)
        self.assertEqual(0.5, stop.poll_interval)
        self.assertTrue(global_start.global_target)
        self.assertIsNone(global_start.target_package)

    def test_parser_exposes_startup_time_with_bounded_defaults(self):
        args = solopi_ai.build_parser().parse_args(
            ["startup-time", "--target-package", "com.example.app"]
        )
        zero_interval = solopi_ai.build_parser().parse_args(
            [
                "startup-time",
                "--target-package",
                "com.example.app",
                "--mode",
                "warm",
                "--iterations",
                "3",
                "--interval",
                "0",
                "--launch-timeout",
                "12",
            ]
        )

        self.assertEqual("cold", args.mode)
        self.assertEqual(5, args.iterations)
        self.assertEqual(1.0, args.interval)
        self.assertEqual(30.0, args.launch_timeout)
        self.assertEqual("warm", zero_interval.mode)
        self.assertEqual(3, zero_interval.iterations)
        self.assertEqual(0, zero_interval.interval)
        self.assertEqual(12, zero_interval.launch_timeout)

    def test_resolve_launcher_component_uses_package_manager(self):
        adb = solopi_ai.AdbClient()
        adb.device = {"serial": "device-1", "state": "device"}
        adb.shell = mock.Mock(
            return_value=solopi_ai.CommandResult(
                0,
                stdout="priority=0 preferredOrder=0\ncom.example.app/.MainActivity\n",
            )
        )

        component = adb.resolve_launcher_component("com.example.app")

        self.assertEqual("com.example.app/.MainActivity", component)
        adb.shell.assert_called_once_with(
            [
                "cmd",
                "package",
                "resolve-activity",
                "--brief",
                "-a",
                "android.intent.action.MAIN",
                "-c",
                "android.intent.category.LAUNCHER",
                "com.example.app",
            ],
            timeout=15,
        )

    def test_parse_startup_time_output_requires_complete_strict_fields(self):
        output = """Starting: Intent { cmp=com.example.app/.MainActivity }
Status: ok
LaunchState: COLD
Activity: com.example.app/.MainActivity
ThisTime: 120
TotalTime: 150
WaitTime: 160
Complete
"""
        parsed = solopi_ai.parse_startup_time_output(output, "com.example.app")
        self.assertEqual(
            {
                "LaunchState": "COLD",
                "Activity": "com.example.app/.MainActivity",
                "ThisTime": 120,
                "TotalTime": 150,
                "WaitTime": 160,
            },
            parsed,
        )

        invalid_outputs = (
            output.replace("TotalTime: 150\n", ""),
            output.replace("Status: ok", "Status: timeout"),
            output.replace("Complete\n", ""),
            output.replace("ThisTime: 120", "ThisTime: 120\nThisTime: 121"),
            output.replace("WaitTime: 160", "WaitTime: 100"),
            output.replace("com.example.app/.MainActivity", "com.other/.MainActivity"),
        )
        for invalid_output in invalid_outputs:
            with self.subTest(output=invalid_output), self.assertRaises(solopi_ai.CliError):
                solopi_ai.parse_startup_time_output(invalid_output, "com.example.app")

        without_this_time = solopi_ai.parse_startup_time_output(
            output.replace("ThisTime: 120\n", ""), "com.example.app"
        )
        self.assertIsNone(without_this_time["ThisTime"])

    def test_measure_startup_time_uses_activity_manager_mode(self):
        output = """Status: ok
LaunchState: COLD
Activity: com.example.app/.MainActivity
ThisTime: 100
TotalTime: 120
WaitTime: 125
Complete
"""
        adb = solopi_ai.AdbClient()
        adb.device = {"serial": "device-1", "state": "device"}
        adb.shell = mock.Mock(return_value=solopi_ai.CommandResult(0, stdout=output))

        result = adb.measure_startup_time(
            "com.example.app/.MainActivity",
            "com.example.app",
            "cold",
            9,
        )

        self.assertEqual(100, result["ThisTime"])
        adb.shell.assert_called_once_with(
            [
                "am",
                "start",
                "-W",
                "-S",
                "-n",
                "com.example.app/.MainActivity",
            ],
            timeout=9,
        )

        warm_output = output + output.replace("LaunchState: COLD", "LaunchState: WARM")
        adb.shell.reset_mock()
        adb.shell.return_value = solopi_ai.CommandResult(0, stdout=warm_output)
        warm_result = adb.measure_startup_time(
            "com.example.app/.MainActivity",
            "com.example.app",
            "warm",
            7,
        )
        self.assertEqual("WARM", warm_result["LaunchState"])
        adb.shell.assert_called_once_with(
            [
                "am",
                "start",
                "-W",
                "-R",
                "2",
                "-n",
                "com.example.app/.MainActivity",
            ],
            timeout=7,
        )

    def test_warm_startup_time_requires_two_complete_results(self):
        output = """Status: ok
LaunchState: COLD
Activity: com.example.app/.MainActivity
TotalTime: 120
WaitTime: 125
Complete
"""
        adb = solopi_ai.AdbClient()
        adb.device = {"serial": "device-1", "state": "device"}
        adb.shell = mock.Mock(return_value=solopi_ai.CommandResult(0, stdout=output))

        with self.assertRaises(solopi_ai.CliError) as error:
            adb.measure_startup_time(
                "com.example.app/.MainActivity",
                "com.example.app",
                "warm",
                20,
            )

        self.assertEqual(4, error.exception.exit_code)
        self.assertEqual(1, error.exception.details["resultCount"])
        adb.shell.assert_called_once_with(
            [
                "am",
                "start",
                "-W",
                "-R",
                "2",
                "-n",
                "com.example.app/.MainActivity",
            ],
            timeout=20,
        )

    def test_startup_time_outputs_samples_and_statistics(self):
        samples = [
            {
                "LaunchState": "COLD",
                "Activity": "com.example.app/.MainActivity",
                "ThisTime": 100,
                "TotalTime": 150,
                "WaitTime": 160,
            },
            {
                "LaunchState": "COLD",
                "Activity": "com.example.app/.MainActivity",
                "ThisTime": 80,
                "TotalTime": 110,
                "WaitTime": 120,
            },
            {
                "LaunchState": "COLD",
                "Activity": "com.example.app/.MainActivity",
                "ThisTime": 120,
                "TotalTime": 170,
                "WaitTime": 180,
            },
        ]
        adb = mock.Mock()
        adb.resolve_launcher_component.return_value = "com.example.app/.MainActivity"
        adb.measure_startup_time.side_effect = samples
        args = solopi_ai.build_parser().parse_args(
            [
                "startup-time",
                "--target-package",
                "com.example.app",
                "--iterations",
                "3",
                "--interval",
                "0.25",
            ]
        )

        with mock.patch.object(solopi_ai.time, "sleep") as sleep:
            result, exit_code = solopi_ai.command_startup_time(args, adb)

        self.assertEqual(0, exit_code)
        self.assertEqual(3, result["validSampleCount"])
        self.assertFalse(result["measurement"]["visualCompletion"])
        self.assertEqual([1, 2, 3], [item["iteration"] for item in result["samples"]])
        self.assertEqual(
            {
                "available": True,
                "sampleCount": 3,
                "min": 80,
                "max": 120,
                "mean": 100.0,
                "median": 100.0,
                "p90": 120,
            },
            result["statistics"]["ThisTime"],
        )
        self.assertEqual(143.333, result["statistics"]["TotalTime"]["mean"])
        self.assertEqual([mock.call(0.25), mock.call(0.25)], sleep.call_args_list)
        self.assertEqual(3, adb.measure_startup_time.call_count)

    def test_startup_time_statistics_marks_missing_android_field_unavailable(self):
        samples = [
            {"ThisTime": None, "TotalTime": 100, "WaitTime": 105},
            {"ThisTime": None, "TotalTime": 120, "WaitTime": 125},
        ]

        result = solopi_ai.startup_time_statistics(samples)

        self.assertEqual(
            {
                "available": False,
                "sampleCount": 0,
                "min": None,
                "max": None,
                "mean": None,
                "median": None,
                "p90": None,
            },
            result["ThisTime"],
        )
        self.assertEqual(2, result["TotalTime"]["sampleCount"])

    def test_startup_time_failed_round_is_not_summarized(self):
        first_sample = {
            "LaunchState": "WARM",
            "Activity": "com.example.app/.MainActivity",
            "ThisTime": 40,
            "TotalTime": 60,
            "WaitTime": 65,
        }
        adb = mock.Mock()
        adb.resolve_launcher_component.return_value = "com.example.app/.MainActivity"
        adb.measure_startup_time.side_effect = [
            first_sample,
            solopi_ai.CliError("第二轮启动失败", 4),
        ]
        args = solopi_ai.build_parser().parse_args(
            [
                "startup-time",
                "--target-package",
                "com.example.app",
                "--mode",
                "warm",
                "--iterations",
                "3",
                "--interval",
                "0",
            ]
        )

        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.command_startup_time(args, adb)

        self.assertEqual(2, error.exception.details["iteration"])
        self.assertEqual(1, error.exception.details["validSampleCount"])
        self.assertEqual(1, len(error.exception.details["completedSamples"]))
        self.assertNotIn("statistics", error.exception.details)

    def test_normalize_performance_items_deduplicates_in_order(self):
        self.assertEqual(
            ["CPU", "Memory", "FPS"],
            solopi_ai.normalize_performance_items(" CPU,Memory,CPU,,FPS "),
        )
        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.normalize_performance_items(" , ")
        self.assertEqual(3, error.exception.exit_code)

    def test_scheme_invocation_rejects_activity_error_from_stderr(self):
        runner = mock.Mock()
        runner.run.return_value = solopi_ai.CommandResult(
            0,
            stdout="Starting: Intent { act=android.intent.action.VIEW }",
            stderr="Error: Activity not started, unable to resolve Intent",
        )
        adb = solopi_ai.AdbClient(runner=runner)
        adb.device = {"serial": "device-1", "state": "device"}

        with self.assertRaises(solopi_ai.CliError) as error:
            adb.invoke_scheme("harness", {"type": "cancel"})

        self.assertEqual(4, error.exception.exit_code)
        self.assertIn("Activity not started", error.exception.details["stderr"])

    def test_scheme_invocation_uses_requested_timeout(self):
        runner = mock.Mock()
        runner.run.return_value = solopi_ai.CommandResult(0)
        adb = solopi_ai.AdbClient(runner=runner)
        adb.device = {"serial": "device-1", "state": "device"}

        adb.invoke_scheme("harness", {"type": "cancel"}, timeout=1.25)

        runner.run.assert_called_once_with(mock.ANY, timeout=1.25)
        remote_command = runner.run.call_args.args[0][-1]
        self.assertIn(
            "-n com.alipay.hulu/com.alipay.hulu.common.scheme.AdbSchemeActivity",
            remote_command,
        )

    def test_mutations_use_dump_protected_adb_activity(self):
        manifest = (
            REPO_ROOT / "solopi-app" / "common" / "src" / "main" / "AndroidManifest.xml"
        ).read_text(encoding="utf-8")
        self.assertIn('android:name=".scheme.AdbSchemeActivity"', manifest)
        self.assertIn('android:permission="android.permission.DUMP"', manifest)
        self.assertIn('android:exported="true"', manifest)

        resolver_names = (
            "ConfigSchemeResolver.java",
            "HarnessSchemeResolver.java",
            "HistorySchemeResolver.java",
            "PerformanceDisplaySchemeResolver.java",
            "PerformanceSchemeResolver.java",
            "PluginSchemeResolver.java",
            "RecordSchemeResolver.java",
            "ReplaySchemeResolver.java",
            "ScanSchemeResolver.java",
            "ScreenRecordSchemeResolver.java",
            "StressSchemeResolver.java",
            "VideoAnalysisSchemeResolver.java",
        )
        scheme_root = (
            REPO_ROOT
            / "solopi-app"
            / "app"
            / "src"
            / "main"
            / "java"
            / "com"
            / "alipay"
            / "hulu"
            / "scheme"
        )
        for resolver_name in resolver_names:
            source = (scheme_root / resolver_name).read_text(encoding="utf-8")
            self.assertIn("instanceof AdbSchemeActivity", source, resolver_name)
            self.assertNotIn("instanceof Activity", source, resolver_name)

    def test_internal_adb_connection_is_protected_async_and_queryable(self):
        source = (
            REPO_ROOT
            / "solopi-app"
            / "app"
            / "src"
            / "main"
            / "java"
            / "com"
            / "alipay"
            / "hulu"
            / "scheme"
            / "HarnessSchemeResolver.java"
        ).read_text(encoding="utf-8")

        method = source.index("private Map<String, Object> adbConnect(")
        guard = source.index("instanceof AdbSchemeActivity", method)
        schedule = source.index("BackgroundExecutor.execute", method)
        generate = source.index("CmdTools.generateConnection()", schedule)
        method_end = source.index(
            "private Map<String, Object> adbConnectStatus", generate
        )
        self.assertLess(guard, schedule)
        self.assertLess(schedule, generate)
        self.assertLess(generate, method_end)
        self.assertIn('case "adb-connect":', source)
        self.assertIn('case "adb-connect-status":', source)
        self.assertIn('"adb-connect-status"));', source)
        self.assertIn('"history", "plugin", "scan", "adb-connect"));', source)
        self.assertNotIn("adb tcpip", source)

    def test_performance_display_registers_app_info_before_acquiring_lease(self):
        source = (
            REPO_ROOT
            / "solopi-app"
            / "app"
            / "src"
            / "main"
            / "java"
            / "com"
            / "alipay"
            / "hulu"
            / "scheme"
            / "PerformanceDisplaySchemeResolver.java"
        ).read_text(encoding="utf-8")

        refresh = source.index("refreshAppInfoProvider(")
        acquire = source.index("provider.startDisplaySessionIfIdle(items)")
        self.assertLess(refresh, acquire)

    def test_performance_metric_adb_commands_have_finite_timeouts(self):
        item_root = (
            REPO_ROOT
            / "solopi-app"
            / "shared"
            / "src"
            / "main"
            / "java"
            / "com"
            / "alipay"
            / "hulu"
            / "shared"
            / "display"
            / "items"
        )
        sources = {
            name: (item_root / name).read_text(encoding="utf-8")
            for name in ("CPUTools.java", "MemoryTools.java", "TemperatureTools.java")
        }

        self.assertNotIn("execAdbCmd(cmd.toString(), 0)", sources["CPUTools.java"])
        self.assertNotIn('execAdbCmd("cat /proc/stat", 0)', sources["CPUTools.java"])
        for name, source in sources.items():
            self.assertIn("PERFORMANCE_ADB_TIMEOUT_MS", source, name)
        self.assertNotIn(
            'execHighPrivilegeCmd("dumpsys meminfo " + processInfo.getPid() + " | grep TOTAL")',
            sources["MemoryTools.java"],
        )
        self.assertNotRegex(
            sources["TemperatureTools.java"],
            r"CmdTools\.execHighPrivilegeCmd\([^,;]+\);",
        )

    def test_internal_adb_command_interrupt_closes_and_untracks_stream(self):
        source = (
            REPO_ROOT
            / "solopi-app"
            / "common"
            / "src"
            / "main"
            / "java"
            / "com"
            / "alipay"
            / "hulu"
            / "common"
            / "tools"
            / "CmdTools.java"
        ).read_text(encoding="utf-8")

        self.assertIn(
            "ConcurrentLinkedQueue<AdbStream> streams",
            source,
        )
        method_start = source.index("public static String _execAdbCmd")
        method_end = source.index("public static CmdLine openAdbStream", method_start)
        method = source[method_start:method_end]
        self.assertIn("finally", method)
        self.assertIn("catch (InterruptedException e)", method)
        self.assertIn("Thread.currentThread().interrupt()", method)
        self.assertIn("stream.close()", method)
        self.assertIn("streams.remove(stream)", method)

    def test_replay_execution_paths_do_not_download_remote_plugins(self):
        record_source = (
            REPO_ROOT
            / "solopi-app/app/src/main/java/com/alipay/hulu/actions/RecordScreenActionProvider.java"
        ).read_text(encoding="utf-8")
        recorder_source = (
            REPO_ROOT
            / "solopi-app/app/src/main/java/com/alipay/hulu/screenRecord/SimpleRecordService.java"
        ).read_text(encoding="utf-8")
        screen_record_resolver = (
            REPO_ROOT
            / "solopi-app/app/src/main/java/com/alipay/hulu/scheme/ScreenRecordSchemeResolver.java"
        ).read_text(encoding="utf-8")
        image_source = (
            REPO_ROOT
            / "solopi-app/app/src/main/java/com/alipay/hulu/actions/ImageCompareActionProvider.java"
        ).read_text(encoding="utf-8")
        locator_source = (
            REPO_ROOT
            / "solopi-app/shared/src/main/java/com/alipay/hulu/shared/node/locater/OperationNodeLocator.java"
        ).read_text(encoding="utf-8")

        record_execution = record_source[
            record_source.index("public boolean processAction") :
            record_source.index("public Map<String, String> provideActions")
        ]
        image_execution = image_source[
            image_source.index("public boolean processAction") :
            image_source.index("public Map<String, String> provideActions")
        ]
        capture_locator = locator_source[
            locator_source.index("public static AbstractNodeTree findNodeByCapture") :
            locator_source.index("private static Rect findTargetRect")
        ]
        for source in (record_execution, image_execution, capture_locator):
            self.assertNotIn("loadPatchFromServer", source)

        plugin_check = record_execution.index(
            "ClassUtil.getPatchInfo(VideoAnalyzer.SCREEN_RECORD_PATCH)"
        )
        binder_check = record_execution.index("if (activeBinder == null)")
        start_record = record_execution.index(
            "activeBinder.startRecord(targetIntent, recordOwner)"
        )
        pending_owner = record_execution.index("pendingRecordOwner = recordOwner")
        start_confirmed = record_execution.index(
            "awaitRecorderStarted(activeBinder, recordOwner)"
        )
        file_state = record_execution.index("currentRecordFile = startedRecordFile")
        owner_state = record_execution.index("currentRecordOwner = recordOwner")
        target_diff_state = record_execution.index("targetDiff = requestedTargetDiff")
        click_mode = record_execution.index("useSendEventClickMode()")
        recording_state = record_execution.index("isRecording = true")
        self.assertLess(plugin_check, click_mode)
        self.assertLess(binder_check, click_mode)
        self.assertLess(pending_owner, start_record)
        self.assertLess(start_record, click_mode)
        self.assertLess(start_confirmed, click_mode)
        self.assertLess(file_state, recording_state)
        self.assertLess(owner_state, recording_state)
        self.assertLess(target_diff_state, recording_state)
        self.assertLess(click_mode, recording_state)
        self.assertIn("if (destroyed || binder != activeBinder", record_execution)
        self.assertIn("activeBinder.isRecording(recordOwner)", record_execution)
        self.assertIn("activeBinder.isRecorderActive(recordOwner)", record_source)
        self.assertNotIn("activeBinder.isRecording()", record_execution)
        self.assertNotIn("boolean recorderOwned", record_execution)
        self.assertNotIn("boolean recorderRunning", record_execution)
        self.assertIn(
            "!StringUtil.equals(pendingRecordOwner, recordOwner)", record_execution
        )
        self.assertIn("finally {", record_execution)
        self.assertIn("DISMISS_LOADING_DIALOG", record_execution)

        intent_start = record_source.index("private Intent genRecordIntent")
        intent_end = record_source.index("public Map<String, String> provideActions", intent_start)
        intent_builder = record_source[intent_start:intent_end]
        self.assertIn("double requestedTargetDiff = Double.parseDouble(", intent_builder)
        self.assertNotIn("targetDiff = Double.parseDouble(", intent_builder)

        self.assertIn("private synchronized boolean isRecorderRecording(String owner)", recorder_source)
        self.assertIn("public boolean isRecording(String owner)", recorder_source)
        self.assertIn("public boolean isRecorderActive(String owner)", recorder_source)
        self.assertIn("binder.isRecording(expectedOwner)", screen_record_resolver)
        self.assertIn("binder.isRecorderActive(expectedOwner)", screen_record_resolver)
        self.assertNotIn("binder.isRecording()", screen_record_resolver)

        destroy_start = record_source.index("public void onDestroy(Context context)")
        destroy_end = record_source.index("@Subscriber", destroy_start)
        destroy_method = record_source[destroy_start:destroy_end]
        destroyed_state = destroy_method.index("destroyed = true")
        binder_cleared = destroy_method.index("binder = null")
        recording_cleared = destroy_method.index("clearRecordingStateLocked()")
        self.assertLess(destroyed_state, recording_cleared)
        self.assertLess(binder_cleared, recording_cleared)
        self.assertIn("if (shouldUnbind && connection != null)", destroy_method)
        self.assertIn("unbindServiceQuietly(applicationContext, connection)", destroy_method)
        self.assertIn("pendingRecordOwner : currentRecordOwner", destroy_method)
        self.assertIn("ownedEventService.stopTrackTouch(this)", destroy_method)
        self.assertIn("registeredInjector.unregister(this)", destroy_method)

        event_service = (
            REPO_ROOT
            / "solopi-app/shared/src/main/java/com/alipay/hulu/shared/event/EventService.java"
        ).read_text(encoding="utf-8")
        self.assertIn("IdentityHashMap<Object, Boolean>", event_service)
        self.assertIn("touchTrackerOwners.add(owner)", event_service)
        self.assertIn("if (!touchTrackerOwners.remove(owner))", event_service)
        self.assertIn("if (!touchTrackerOwners.isEmpty())", event_service)
        for source_path in (
            "solopi-app/app/src/main/java/com/alipay/hulu/actions/RecordScreenActionProvider.java",
            "solopi-app/app/src/main/java/com/alipay/hulu/service/CaseRecordManager.java",
            "solopi-app/app/src/main/java/com/alipay/hulu/screenRecord/RecordService.java",
        ):
            owner_source = (REPO_ROOT / source_path).read_text(encoding="utf-8")
            self.assertIn("startTrackTouch(this)", owner_source)
            self.assertIn("stopTrackTouch(this)", owner_source)

        patch_request = (
            REPO_ROOT
            / "solopi-app/app/src/main/java/com/alipay/hulu/upgrade/PatchRequest.java"
        ).read_text(encoding="utf-8")
        settings = (
            REPO_ROOT
            / "solopi-app/app/src/main/java/com/alipay/hulu/activity/SettingsActivity.java"
        ).read_text(encoding="utf-8")
        self.assertNotIn("raw.githubusercontent.com/alipay/SoloPi", patch_request)
        self.assertNotIn("raw.githubusercontent.com/alipay/SoloPi", settings)
        empty_source = patch_request[
            patch_request.index("if (StringUtil.isEmpty(storedUrl))") :
            patch_request.index("String cpuAbi")
        ]
        self.assertIn("callback.onFailed()", empty_source)

    def test_doctor_checks_power_save_and_settings_editors_use_correct_fields(self):
        permission_source = (
            REPO_ROOT
            / "solopi-app/common/src/main/java/com/alipay/hulu/common/utils/PermissionUtil.java"
        ).read_text(encoding="utf-8")
        harness_source = (
            REPO_ROOT
            / "solopi-app/app/src/main/java/com/alipay/hulu/scheme/HarnessSchemeResolver.java"
        ).read_text(encoding="utf-8")
        settings_source = (
            REPO_ROOT
            / "solopi-app/app/src/main/java/com/alipay/hulu/activity/SettingsActivity.java"
        ).read_text(encoding="utf-8")

        self.assertIn('"powerSave".equals(permission)', permission_source)
        self.assertIn("isIgnoringBatteryOptimizations", permission_source)
        self.assertIn('permissions.put("powerSave"', harness_source)
        self.assertIn(
            "SPService.getInt(SPService.KEY_MAX_SCROLL_FIND_COUNT, 2)",
            settings_source,
        )
        self.assertIn("mMaxScrollFindSettingInfo.setText(data.get(0))", settings_source)
        resolution_start = settings_source.index(
            "mResolutionSettingWrapper.setOnClickListener"
        )
        resolution_end = settings_source.index(
            "mHightlightSettingWrapper.setOnClickListener", resolution_start
        )
        self.assertIn("if (data.size() != 1)", settings_source[resolution_start:resolution_end])

    def test_replay_scheme_binds_execution_to_validated_case_snapshot(self):
        replay_source = (
            REPO_ROOT
            / "solopi-app/app/src/main/java/com/alipay/hulu/scheme/ReplaySchemeResolver.java"
        ).read_text(encoding="utf-8")
        harness_source = (
            REPO_ROOT
            / "solopi-app/app/src/main/java/com/alipay/hulu/scheme/HarnessSchemeResolver.java"
        ).read_text(encoding="utf-8")

        self.assertIn('public static final String CASE_ID = "caseId"', replay_source)
        self.assertIn(
            'public static final String CASE_FINGERPRINT = "caseFingerprint"',
            replay_source,
        )
        self.assertIn(
            ".where(RecordCaseInfoDao.Properties.Id.eq(expectedCaseId))",
            replay_source,
        )
        self.assertIn(
            "expectedFingerprint, caseFingerprint(caseInfo)", replay_source
        )
        self.assertIn("caseInfo = snapshotCase(caseInfos.get(0))", replay_source)
        self.assertIn("operationLog.setStorePath(null)", replay_source)
        self.assertIn('snapshot.put("requestId", requestId)', (
            REPO_ROOT
            / "solopi-app/app/src/main/java/com/alipay/hulu/scheme/HarnessState.java"
        ).read_text(encoding="utf-8"))
        self.assertIn(
            'casePayload.put("caseFingerprint", ReplaySchemeResolver.caseFingerprint(caseInfo))',
            harness_source,
        )
        self.assertNotIn("replayManager.isRunning()", replay_source)

    def test_cancel_binds_scheme_request_to_observed_run_id(self):
        args = solopi_ai.build_parser().parse_args(
            ["cancel", "--run-id", "run-current"]
        )

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def query(self, query_type):
                self.assert_query = query_type
                return {"active": True, "runId": "run-current", "state": "running"}

        session = FakeSession()
        adb = mock.Mock()
        terminal = {"active": False, "runId": "run-current", "state": "cancelled"}
        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=session
        ), mock.patch.object(
            solopi_ai, "wait_for_terminal_run", return_value=terminal
        ) as wait:
            result, exit_code = solopi_ai.command_cancel(args, adb)

        self.assertEqual(0, exit_code)
        self.assertEqual(terminal, result)
        self.assertEqual("status", session.assert_query)
        adb.invoke_scheme.assert_called_once_with(
            "harness", {"type": "cancel", "runId": "run-current"}
        )
        wait.assert_called_once_with(
            session, "run-current", args.cancel_timeout, args.poll_interval
        )

    def test_cancel_rejects_active_status_without_run_id(self):
        args = solopi_ai.build_parser().parse_args(
            ["cancel", "--run-id", "run-owned"]
        )

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def query(self, query_type):
                return {"active": True, "runId": None, "state": "running"}

        adb = mock.Mock()
        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=FakeSession()
        ), self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.command_cancel(args, adb)

        self.assertEqual(4, error.exception.exit_code)
        adb.invoke_scheme.assert_not_called()

    def test_cancel_rejects_a_different_active_run_without_mutation(self):
        args = solopi_ai.build_parser().parse_args(
            ["cancel", "--run-id", "run-owned"]
        )

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def query(self, query_type):
                return {"active": True, "runId": "run-other", "state": "running"}

        adb = mock.Mock()
        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=FakeSession()
        ):
            result, exit_code = solopi_ai.command_cancel(args, adb)

        self.assertEqual(2, exit_code)
        self.assertFalse(result["success"])
        self.assertEqual("run-owned", result["expectedRunId"])
        self.assertEqual("run-other", result["activeRun"]["runId"])
        adb.invoke_scheme.assert_not_called()

        with mock.patch("sys.stderr"), self.assertRaises(SystemExit):
            solopi_ai.build_parser().parse_args(["cancel"])

    def test_no_auto_start_rejects_disabled_device_configuration(self):
        args = solopi_ai.build_parser().parse_args(
            ["run", "--case", "smoke", "--no-auto-start"]
        )
        case_payload = self.sample_case()
        case_payload["caseName"] = "smoke"
        health = {
            "success": True,
            "ready": False,
            "autoStart": False,
            "permissions": {
                "adb": True,
                "float": True,
                "background": True,
                "accessibility": True,
            },
        }

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def query(self, query_type, params=None):
                self_query_type = query_type
                if self_query_type == "case":
                    return {"success": True, "case": copy.deepcopy(case_payload)}
                if self_query_type != "health":
                    raise AssertionError("unexpected query: %s" % self_query_type)
                return health

        adb = mock.Mock()
        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()):
            result, exit_code = solopi_ai.command_run(args, adb)

        self.assertEqual(2, exit_code)
        self.assertFalse(result["success"])
        self.assertIn("自动启动已禁用", result["error"])
        adb.invoke_scheme.assert_not_called()

    def test_run_sends_target_override_and_explicit_restart_policy(self):
        args = solopi_ai.build_parser().parse_args(
            [
                "run",
                "--case",
                "smoke",
                "--target-package",
                "com.example.override",
                "--no-restart-app",
            ]
        )
        case_payload = self.sample_case()
        case_payload["caseName"] = "smoke"

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def query(self, query_type, params=None):
                if query_type == "case":
                    return {"success": True, "case": copy.deepcopy(case_payload)}
                if query_type == "health":
                    return {
                        "success": True,
                        "autoStart": True,
                        "permissions": {
                            "adb": True,
                            "float": True,
                            "background": True,
                            "powerSave": True,
                            "accessibility": True,
                        },
                    }
                if query_type == "status":
                    return {"success": True, "active": False, "runId": "old-run"}
                raise AssertionError("unexpected query: %s" % query_type)

        adb = mock.Mock()
        terminal = {
            "success": True,
            "active": False,
            "terminal": True,
            "state": "passed",
            "runId": "run-1",
            "caseName": "smoke",
            "results": [{"success": True}],
        }
        replay_request_id = "replay-" + "b" * 32
        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=FakeSession()
        ), mock.patch.object(
            solopi_ai, "wait_for_new_run", return_value=terminal
        ) as wait, mock.patch.object(
            solopi_ai.uuid, "uuid4", return_value=mock.Mock(hex="b" * 32)
        ):
            result, exit_code = solopi_ai.command_run(args, adb)

        self.assertEqual(0, exit_code)
        self.assertTrue(result["success"])
        self.assertEqual(
            mock.call(
                "replay",
                {
                    "replayMode": "normal",
                    "caseName": "smoke",
                    "caseId": "7",
                    "caseFingerprint": "a" * 64,
                    "requestId": replay_request_id,
                    "targetApp": "com.example.override",
                    "restartApp": "false",
                },
            ),
            adb.invoke_scheme.call_args_list[-1],
        )
        wait.assert_called_once_with(
            mock.ANY,
            replay_request_id,
            "old-run",
            "smoke",
            args.ack_timeout,
            args.poll_interval,
        )

    def test_wait_for_new_run_rejects_another_clients_same_name_replay(self):
        session = mock.Mock()
        session.query.return_value = {
            "success": True,
            "active": True,
            "runId": "run-other",
            "requestId": "replay-other",
            "caseName": "smoke",
            "state": "running",
        }

        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.wait_for_new_run(
                session,
                "replay-mine",
                "run-before",
                "smoke",
                1,
                0.1,
                clock=lambda: 0,
                sleep=lambda _: None,
            )

        self.assertEqual(2, error.exception.exit_code)
        self.assertEqual("replay-mine", error.exception.details["requestId"])
        self.assertEqual(
            "replay-other",
            error.exception.details["activeRun"]["requestId"],
        )

    def test_run_preflight_rejects_shell_provider_upload_and_unconfirmed_risk(self):
        shell_case = self.sample_case(action="executeShell")
        shell_case["caseName"] = "unsafe"
        shell_case["operationLog"]["steps"][0]["operationMethod"]["operationParam"] = {
            "text": "id"
        }
        clear_data_case = self.sample_case(action="clearData")
        clear_data_case["caseName"] = "unsafe"
        permission_case = self.sample_case(action="permissionAlert")
        permission_case["caseName"] = "unsafe"
        input_method_case = self.sample_case(action="inputMethod")
        input_method_case["caseName"] = "unsafe"
        provider_case = self.sample_case(action="startRecord")
        provider_case["caseName"] = "unsafe"
        provider_start = provider_case["operationLog"]["steps"][0]
        provider_start["operationMethod"]["operationParam"] = {
            "checkList": "CPU",
            "url": "https://example.invalid/upload",
        }
        provider_stop = copy.deepcopy(provider_start)
        provider_stop["operationMethod"] = {
            "actionEnum": "stopRecord",
            "operationParam": {},
        }
        provider_case["operationLog"]["steps"].append(provider_stop)

        for case_payload, confirm_high_risk, expected_action in (
            (shell_case, True, "EXECUTE_SHELL"),
            (clear_data_case, False, "CLEAR_DATA"),
            (permission_case, True, "HANDLE_PERMISSION_ALERT"),
            (input_method_case, True, "HIDE_INPUT_METHOD"),
            (provider_case, False, "OTHER_GLOBAL"),
        ):
            argv = ["run", "--case", "unsafe"]
            if confirm_high_risk:
                argv.append("--confirm-high-risk")
            args = solopi_ai.build_parser().parse_args(argv)

            class FakeSession:
                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, traceback):
                    return None

                def query(self, query_type, params=None):
                    if query_type == "case":
                        return {"success": True, "case": copy.deepcopy(case_payload)}
                    if query_type == "health":
                        return {
                            "success": True,
                            "autoStart": True,
                            "permissions": {
                                "adb": True,
                                "float": True,
                                "background": True,
                                "powerSave": True,
                                "accessibility": True,
                            },
                        }
                    if query_type == "status":
                        return {"success": True, "active": False, "runId": "old-run"}
                    raise AssertionError("unexpected query: %s" % query_type)

            adb = mock.Mock()
            with self.subTest(action=expected_action), mock.patch.object(
                solopi_ai, "session_from_args", return_value=FakeSession()
            ), mock.patch.object(
                solopi_ai,
                "wait_for_new_run",
                return_value={
                    "success": True,
                    "active": False,
                    "terminal": True,
                    "state": "passed",
                    "runId": "run-1",
                    "caseName": "unsafe",
                    "results": [{"success": True}],
                },
            ), self.assertRaises(solopi_ai.CliError) as error:
                solopi_ai.command_run(args, adb)

            self.assertEqual(expected_action, error.exception.details["actionEnum"])
            adb.invoke_scheme.assert_not_called()

        for command in ("run", "run-repeat", "run-batch"):
            argv = [command, "--case", "safe", "--confirm-high-risk"]
            if command == "run-repeat":
                argv.extend(["--times", "2"])
            parsed = solopi_ai.build_parser().parse_args(argv)
            self.assertTrue(parsed.confirm_high_risk)

        plugin_case = self.sample_case(
            action="clickByScreenshot",
            operation_node={"resourceId": "anchor"},
        )
        plugin_case["caseName"] = "plugin-case"
        plugin_case["operationLog"]["steps"][0]["operationMethod"]["operationParam"] = {
            "targetImage": "aGVsbG8=",
            "originSize": "1080,2400",
        }
        plugin_payload = self.plugin_list_payload()

        class MissingPluginSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def query(self, query_type, params=None):
                if query_type == "case":
                    return {"success": True, "case": copy.deepcopy(plugin_case)}
                raise AssertionError("unexpected query: %s" % query_type)

            def plugin(self, action, params=None, timeout=None):
                self.plugin_call = (action, params, timeout)
                return plugin_payload

        plugin_session = MissingPluginSession()
        plugin_args = solopi_ai.build_parser().parse_args(
            ["run", "--case", "plugin-case"]
        )
        plugin_adb = mock.Mock()
        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=plugin_session
        ):
            result, exit_code = solopi_ai.command_run(plugin_args, plugin_adb)

        self.assertEqual(2, exit_code)
        self.assertFalse(result["success"])
        self.assertEqual("hulu_imageCompare", result["unavailablePlugins"][0]["name"])
        self.assertEqual(("list", None, None), plugin_session.plugin_call)
        plugin_adb.invoke_scheme.assert_not_called()

    def test_run_rejects_blank_or_invalid_override_before_device_access(self):
        invalid_arguments = (
            ["run", "--case", "smoke", "--target-package", ""],
            ["run", "--case", "smoke", "--target-package", "not-a-package"],
            ["run", "--case", "   "],
        )
        for argv in invalid_arguments:
            args = solopi_ai.build_parser().parse_args(argv)
            with self.subTest(argv=argv), mock.patch.object(
                solopi_ai, "session_from_args"
            ) as session, self.assertRaises(solopi_ai.CliError):
                solopi_ai.command_run(args, mock.Mock())
            session.assert_not_called()

        args = solopi_ai.build_parser().parse_args(["run", "--case", "smoke"])
        args.restart_app = "true"
        with mock.patch.object(solopi_ai, "session_from_args") as session, self.assertRaises(
            solopi_ai.CliError
        ):
            solopi_ai.command_run(args, mock.Mock())
        session.assert_not_called()

    def test_run_rejects_unbound_case_snapshot_before_replay_mutation(self):
        for invalid_field, invalid_value in (
            ("id", None),
            ("id", 0),
            ("caseFingerprint", None),
            ("caseFingerprint", "not-a-digest"),
        ):
            case_payload = self.sample_case()
            case_payload["caseName"] = "smoke"
            case_payload[invalid_field] = invalid_value

            class FakeSession:
                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, traceback):
                    return None

                def query(self, query_type, params=None):
                    self_query = (query_type, params)
                    self.last_query = self_query
                    return {"success": True, "case": copy.deepcopy(case_payload)}

            args = solopi_ai.build_parser().parse_args(["run", "--case", "smoke"])
            adb = mock.Mock()
            with self.subTest(field=invalid_field, value=invalid_value), mock.patch.object(
                solopi_ai, "session_from_args", return_value=FakeSession()
            ), self.assertRaises(solopi_ai.CliError):
                solopi_ai.command_run(args, adb)
            adb.invoke_scheme.assert_not_called()

    def test_normalize_case_accepts_authoring_object_and_action_code(self):
        normalized = solopi_ai.normalize_case(self.sample_case())
        operation_log = json.loads(normalized["operationLog"])
        step = operation_log["steps"][0]

        self.assertEqual("SLEEP", step["operationMethod"]["actionEnum"])
        self.assertEqual("1000", step["operationMethod"]["operationParam"]["text"])
        self.assertFalse(step["operationMethod"]["encrypt"])
        self.assertEqual(0, step["operationIndex"])
        self.assertEqual("ai-step-001", step["stepId"])
        self.assertEqual("local", normalized["recordMode"])

    def test_normalize_case_rejects_node_action_without_grounded_selector(self):
        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.normalize_case(self.sample_case(action="click", operation_node={}))

        self.assertIn("从 inspect 或 case-get 复制", str(error.exception))
        self.assertEqual(0, error.exception.details["stepIndex"])

    def test_normalize_case_accepts_encoded_operation_log(self):
        case = self.sample_case()
        case["operationLog"] = json.dumps(case["operationLog"])

        normalized = solopi_ai.normalize_case(case)

        self.assertIsInstance(normalized["operationLog"], str)
        self.assertEqual(1, len(json.loads(normalized["operationLog"])["steps"]))

    def test_parser_keeps_existing_commands_and_exposes_model_lifecycle(self):
        parser = solopi_ai.build_parser()
        command_action = next(action for action in parser._actions if action.dest == "command")

        self.assertEqual(100, len(command_action.choices))
        self.assertTrue(
            {
                "agent-session-start", "agent-observe", "agent-act", "agent-status",
                "agent-timeline", "agent-pause", "agent-resume", "agent-end", "agent-cancel",
                "verify-normalize", "verify-compile", "verify-validate", "verify-run",
                "managed-init", "managed-health", "managed-device-register",
                "managed-device-probe", "managed-device-list", "managed-submit",
                "managed-status", "managed-events", "managed-report", "managed-cancel",
                "managed-recover", "managed-worker-once", "managed-worker-loop",
                "managed-serve",
                "model-verify", "model-health", "model-install", "model-status",
                "model-activate", "model-rollback", "model-infer", "model-benchmark",
                "model-release-check",
            }.issubset(command_action.choices)
        )
        params_args = parser.parse_args(
            ["case-validate", "--file", "case.json", "--running-params-file", "params.json"]
        )
        clear_args = parser.parse_args(
            ["case-validate", "--file", "case.json", "--clear-running-params"]
        )
        self.assertEqual("params.json", params_args.running_params_file)
        self.assertFalse(params_args.clear_running_params)
        self.assertIsNone(clear_args.running_params_file)

        provider_args = parser.parse_args(
            [
                "verify-run", "--plan", "plan.json", "--artifacts", "artifacts",
                "--decision-provider", "on-device", "--model-package", "model-package",
            ]
        )
        self.assertEqual("on-device", provider_args.decision_provider)
        self.assertEqual("model-package", provider_args.model_package)
        benchmark_args = parser.parse_args(
            [
                "model-benchmark", "--package", "model-package", "--model-id", "counter",
                "--model-version", "1.0.0", "--inputs", "[[0],[1]]",
            ]
        )
        self.assertEqual("model-package", benchmark_args.package)
        self.assertTrue(clear_args.clear_running_params)
        with mock.patch("sys.stderr"), self.assertRaises(SystemExit):
            parser.parse_args(
                [
                    "case-validate",
                    "--file",
                    "case.json",
                    "--running-params-file",
                    "params.json",
                    "--clear-running-params",
                ]
            )

        with mock.patch("sys.stderr"), self.assertRaises(SystemExit):
            parser.parse_args(
                ["model-benchmark", "--model-id", "counter", "--inputs", "[[0],[1]]"]
            )

    def test_model_provider_response_requires_typed_json_bundle(self):
        parsed = solopi_ai.parse_model_provider_response(
            'Bundle[{json={"success":true,"outputs":[1.0]}}]'
        )
        self.assertEqual([1.0], parsed["outputs"])

        with self.assertRaises(solopi_ai.model_deployment.ModelRuntimeError):
            solopi_ai.parse_model_provider_response("Bundle[{other=value}]")

    def test_android_model_runtime_exposes_only_fixed_provider_methods(self):
        runtime = solopi_ai.AndroidExecuTorchRuntime(mock.Mock())
        with self.assertRaises(solopi_ai.model_deployment.ModelRuntimeError) as caught:
            runtime._call("shell", {"command": "id"})
        self.assertEqual("unsupported_operation", caught.exception.code)

    def test_model_benchmark_binds_receipt_to_signed_package_and_device(self):
        args = solopi_ai.build_parser().parse_args(
            [
                "model-benchmark", "--package", "model-package", "--model-id", "counter",
                "--model-version", "1.0.0", "--inputs", "[[0],[1]]",
            ]
        )
        runtime = mock.Mock()
        runtime.verify_package.return_value = {
            "manifest": {
                "modelId": "counter",
                "version": "1.0.0",
                "runtime": {
                    "name": "executorch",
                    "version": "1.4.0",
                    "backend": "xnnpack",
                },
            },
            "packageDigest": "a" * 64,
            "deviceProfile": {
                "apiLevel": 35,
                "abi": "arm64-v8a",
                "capabilities": ["cpu"],
            },
        }
        runtime.health.return_value = {
            "success": True,
            "runtime": "executorch",
            "runtimeVersion": "1.4.0",
            "backends": ["xnnpack"],
        }
        runtime.benchmark_device.return_value = {
            "success": True,
            "modelId": "counter",
            "version": "1.0.0",
            "backend": "xnnpack",
            "coldStartMs": 10,
        }

        with mock.patch.object(solopi_ai, "model_runtime_from_args", return_value=runtime):
            result, exit_code = solopi_ai.command_model_benchmark(args, mock.Mock())

        self.assertEqual(0, exit_code)
        self.assertEqual(solopi_ai.model_deployment.BENCHMARK_SCHEMA, result["schemaVersion"])
        self.assertEqual("a" * 64, result["packageDigest"])
        self.assertEqual(35, result["deviceProfile"]["apiLevel"])
        runtime.benchmark_device.assert_called_once_with(
            "counter", "1.0.0", [[0.0], [1.0]], 2, 20
        )

    def test_live_provider_cannot_be_combined_with_static_decisions(self):
        args = solopi_ai.build_parser().parse_args(
            [
                "verify-run", "--plan", "plan.json", "--artifacts", "artifacts",
                "--agent-decisions", "decisions.json", "--decision-provider", "on-device",
                "--model-package", "model-package",
            ]
        )
        with self.assertRaises(solopi_ai.CliError):
            solopi_ai.decision_provider_from_args(args, mock.Mock())

    def test_verification_local_commands_normalize_compile_and_validate_without_adb(self):
        requirement = {
            "schemaVersion": "solopi.ai.requirement/v1",
            "id": "counter-local",
            "title": "Counter local compile",
            "targetAppPackage": "com.example.counter",
            "acceptanceCriteria": [{"id": "AC-1", "text": "Counter is zero"}],
            "scenarios": [
                {
                    "id": "initial",
                    "title": "Initial",
                    "acceptanceCriteria": ["AC-1"],
                    "steps": [
                        {
                            "id": "wait",
                            "type": "operation",
                            "action": {"type": "wait", "durationMs": 100},
                        }
                    ],
                    "checkpoints": [
                        {
                            "id": "zero",
                            "afterStep": "wait",
                            "oracle": {
                                "type": "ui",
                                "selector": {
                                    "resourceId": "com.example.counter:id/counter_value"
                                },
                                "field": "text",
                                "operator": "equals",
                                "expected": "0",
                            },
                        }
                    ],
                }
            ],
        }
        adb = mock.Mock()
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            source = root / "requirement.json"
            normalized_path = root / "normalized.json"
            plan_path = root / "plan.json"
            case_root = root / "cases"
            source.write_text(json.dumps(requirement), encoding="utf-8")

            normalize_args = solopi_ai.build_parser().parse_args(
                ["verify-normalize", "--file", str(source), "--output", str(normalized_path)]
            )
            compile_args = solopi_ai.build_parser().parse_args(
                [
                    "verify-compile", "--file", str(source), "--output", str(plan_path),
                    "--cases-dir", str(case_root),
                ]
            )
            normalized, normalize_exit = solopi_ai.dispatch(normalize_args, adb)
            compiled, compile_exit = solopi_ai.dispatch(compile_args, adb)
            validate_args = solopi_ai.build_parser().parse_args(
                ["verify-validate", "--plan", str(plan_path)]
            )
            validated, validate_exit = solopi_ai.dispatch(validate_args, adb)

        self.assertEqual(0, normalize_exit)
        self.assertEqual("solopi.ai.normalized-requirement/v1", normalized["schemaVersion"])
        self.assertEqual(0, compile_exit)
        self.assertEqual(1, compiled["caseCount"])
        self.assertEqual(0, validate_exit)
        self.assertTrue(validated["valid"])
        adb.assert_not_called()

    def test_verification_adapter_reuses_case_import_and_run(self):
        plan = self.compiled_verification_plan()
        scenario = plan["intent"]["scenarios"][0]
        segment = next(item for item in scenario["segments"] if item["phase"] == "test")
        args = solopi_ai.build_parser().parse_args(
            ["verify-run", "--plan", "plan.json", "--artifacts", "artifacts"]
        )
        adb = mock.Mock()
        with tempfile.TemporaryDirectory() as temporary_dir, mock.patch.object(
            solopi_ai,
            "command_case_import",
            return_value=({"success": True, "requestId": "import-1"}, 0),
        ) as imported, mock.patch.object(
            solopi_ai,
            "command_run",
            return_value=(
                {
                    "success": True,
                    "state": "passed",
                    "runId": "run-1",
                    "results": [{"status": "passed"}],
                },
                0,
            ),
        ) as ran:
            adapter = solopi_ai.SoloPiVerificationAdapter(
                args, adb, Path(temporary_dir), Path(temporary_dir) / "events.jsonl"
            )
            result = adapter.execute(segment, scenario, [])

        self.assertEqual("passed", result["state"])
        self.assertTrue(result["evidence"])
        imported.assert_called_once()
        ran.assert_called_once()
        self.assertEqual(segment["case"]["caseName"], ran.call_args.args[0].case)

    def test_fixed_verification_redacts_prior_agent_owner_token_from_logcat(self):
        plan = self.compiled_verification_plan()
        scenario = plan["intent"]["scenarios"][0]
        segment = next(item for item in scenario["segments"] if item["phase"] == "test")
        args = solopi_ai.build_parser().parse_args(
            ["verify-run", "--plan", "plan.json", "--artifacts", "artifacts"]
        )
        owner_token = "verification-1234567890abcdef1234567890abcdef"

        with tempfile.TemporaryDirectory() as temporary_dir:
            logcat_path = Path(temporary_dir) / "logcat.txt"
            logcat_path.write_text(
                "request ownerToken=%s\n" % owner_token,
                encoding="utf-8",
            )
            run_result = {
                "success": True,
                "state": "passed",
                "runId": "run-1",
                "results": [{"status": "passed"}],
                "artifacts": {"logcat": str(logcat_path)},
            }
            with mock.patch.object(
                solopi_ai,
                "command_case_import",
                return_value=({"success": True, "requestId": "import-1"}, 0),
            ), mock.patch.object(
                solopi_ai,
                "command_run",
                return_value=(run_result, 0),
            ):
                adapter = solopi_ai.SoloPiVerificationAdapter(
                    args,
                    mock.Mock(),
                    Path(temporary_dir) / "artifacts",
                    Path(temporary_dir) / "events.jsonl",
                )
                adapter._verification_secrets.add(owner_token)
                result = adapter.execute(segment, scenario, [])
                sanitized_log = logcat_path.read_text(encoding="utf-8")

        self.assertEqual("passed", result["state"])
        self.assertNotIn(owner_token, sanitized_log)
        self.assertIn("ownerToken=[redacted]", sanitized_log)

    def test_dynamic_verification_done_preserves_oracle_authority_and_hides_owner_token(self):
        plan = self.compiled_verification_plan(dynamic=True)
        scenario = plan["intent"]["scenarios"][0]
        segment = next(item for item in scenario["segments"] if item["phase"] == "test")
        args = solopi_ai.build_parser().parse_args(
            ["verify-run", "--plan", "plan.json", "--artifacts", "artifacts"]
        )
        initial = {
            "observationId": "observation-1",
            "page": {
                "resourceId": "root",
                "children": [
                    {
                        "nodeId": "node-1",
                        "resourceId": "com.example.counter:id/counter_value",
                        "text": "0",
                        "children": [],
                    }
                ],
            },
        }
        adb = mock.Mock()
        adb.resolve_launcher_component.return_value = "com.example.counter/.MainActivity"
        adb.restore_foreground.return_value = True
        with tempfile.TemporaryDirectory() as temporary_dir, mock.patch.object(
            solopi_ai,
            "command_agent_session_start",
            return_value=(
                {
                    "success": True,
                    "ownerToken": "secret-owner-token-123456",
                    "session": {"sessionId": "agent-session-1", "state": "active"},
                    "observation": initial,
                },
                0,
            ),
        ), mock.patch.object(
            solopi_ai,
            "command_agent_query",
            return_value=(
                {"success": True, "events": [{"sequence": 1, "type": "session_started"}]},
                0,
            ),
        ), mock.patch.object(
            solopi_ai,
            "command_agent_mutation",
            return_value=({"success": True, "session": {"state": "ended"}}, 0),
        ) as ended:
            adapter = solopi_ai.SoloPiVerificationAdapter(
                args, adb, Path(temporary_dir), Path(temporary_dir) / "events.jsonl"
            )
            result = adapter.execute(segment, scenario, [{"type": "done", "reason": "looks done"}])
            evidence_text = "\n".join(
                Path(item["path"]).read_text(encoding="utf-8")
                for item in result["evidence"]
                if item.get("path") and Path(item["path"]).suffix in {".json", ".jsonl"}
            )

        self.assertEqual("done", result["state"])
        self.assertTrue(result["agentDone"])
        self.assertEqual("0", result["observation"]["page"]["children"][0]["text"])
        self.assertNotIn("secret-owner-token-123456", evidence_text)
        adb.resolve_launcher_component.assert_called_once_with("com.example.counter")
        adb.restore_foreground.assert_called_once_with("com.example.counter/.MainActivity")
        ended.assert_called_once()

    def test_dynamic_verification_restore_failure_skips_agent_and_hashes_final_transcript(self):
        plan = self.compiled_verification_plan(dynamic=True)
        scenario = plan["intent"]["scenarios"][0]
        segment = next(item for item in scenario["segments"] if item["phase"] == "test")
        args = solopi_ai.build_parser().parse_args(
            ["verify-run", "--plan", "plan.json", "--artifacts", "artifacts"]
        )
        adb = mock.Mock()
        adb.resolve_launcher_component.return_value = "com.example.counter/.MainActivity"
        adb.restore_foreground.return_value = False

        with tempfile.TemporaryDirectory() as temporary_dir, mock.patch.object(
            solopi_ai, "command_agent_session_start"
        ) as started:
            adapter = solopi_ai.SoloPiVerificationAdapter(
                args, adb, Path(temporary_dir), Path(temporary_dir) / "events.jsonl"
            )
            result = adapter.execute(segment, scenario, [{"type": "done"}])
            transcript_evidence = next(
                item for item in result["evidence"] if item["type"] == "agent_transcript"
            )
            transcript_path = Path(transcript_evidence["path"])
            actual_sha = hashlib.sha256(transcript_path.read_bytes()).hexdigest()
            transcript = json.loads(transcript_path.read_text(encoding="utf-8"))

        self.assertEqual("not_tested", result["state"])
        self.assertEqual("target_app_restore_failed", result["reason"])
        self.assertEqual(transcript_evidence["sha256"], actual_sha)
        self.assertEqual("target_app_restore_failed", transcript["events"][-1]["type"])
        adb.resolve_launcher_component.assert_called_once_with("com.example.counter")
        adb.restore_foreground.assert_called_once_with("com.example.counter/.MainActivity")
        started.assert_not_called()

    def test_dynamic_verification_rejects_unknown_action_fields_before_agent_call(self):
        current = {
            "observationId": "observation-1",
            "page": {
                "nodeId": "node-root",
                "children": [
                    {
                        "nodeId": "node-1",
                        "resourceId": "com.example.counter:id/increment_button",
                        "children": [],
                    }
                ],
            },
        }

        with self.assertRaises(solopi_ai.CliError):
            solopi_ai.verification_target_node_id(
                {
                    "type": "click",
                    "selector": {"resourceId": "com.example.counter:id/increment_button"},
                    "shell": "id",
                },
                current,
            )

    def test_verify_run_writes_unified_report_and_event_timeline(self):
        plan = self.compiled_verification_plan()
        adb = mock.Mock()
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            plan_path = root / "plan.json"
            artifacts = root / "verification-artifacts"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            args = solopi_ai.build_parser().parse_args(
                ["verify-run", "--plan", str(plan_path), "--artifacts", str(artifacts)]
            )
            with mock.patch.object(solopi_ai.SoloPiVerificationAdapter, "execute") as execute:
                execute.return_value = {
                    "state": "passed",
                    "evidence": [
                        {"type": "replay_result", "content": {"state": "passed"}}
                    ],
                }
                result, exit_code = solopi_ai.command_verify_run(args, adb)
            report = json.loads((artifacts / "report.json").read_text(encoding="utf-8"))
            events = [
                json.loads(line)
                for line in (artifacts / "events.jsonl").read_text(encoding="utf-8").splitlines()
            ]

        self.assertEqual(0, exit_code)
        self.assertEqual("passed", report["status"])
        self.assertEqual(result["report"], str((artifacts / "report.json").resolve()))
        self.assertEqual([1, 2], [item["sequence"] for item in events])
        self.assertEqual(["verification_started", "verification_finished"], [item["type"] for item in events])

    def compiled_verification_plan(self, dynamic=False):
        step = (
            {
                "id": "explore",
                "type": "explore",
                "goal": "Inspect counter",
                "allowedActions": ["click"],
                "budget": {"maxSteps": 2, "maxDurationMs": 30000},
            }
            if dynamic
            else {"id": "wait", "type": "operation", "action": {"type": "wait", "durationMs": 100}}
        )
        requirement = {
            "schemaVersion": "solopi.ai.requirement/v1",
            "id": "counter-adapter",
            "title": "Counter adapter",
            "targetAppPackage": "com.example.counter",
            "acceptanceCriteria": [{"id": "AC-1", "text": "Counter is zero"}],
            "scenarios": [
                {
                    "id": "counter",
                    "title": "Counter",
                    "acceptanceCriteria": ["AC-1"],
                    "steps": [step],
                    "checkpoints": [
                        {
                            "id": "zero",
                            "afterStep": step["id"],
                            "oracle": {
                                "type": "ui",
                                "selector": {"resourceId": "com.example.counter:id/counter_value"},
                                "field": "text",
                                "operator": "equals",
                                "expected": "0",
                            },
                        }
                    ],
                }
            ],
        }
        return solopi_ai.verification_engine.compile_verification_plan(requirement)

    def test_case_step_add_update_and_list_normalize_without_adb(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            source = root / "source.json"
            added_output = root / "added.json"
            updated_output = root / "updated.json"
            add_step = root / "add-step.json"
            update_step = root / "update-step.json"
            source.write_text(json.dumps(self.sample_case()), encoding="utf-8")
            add_step.write_text(
                json.dumps(
                    {
                        "operationNode": {"resourceId": "login"},
                        "operationMethod": {
                            "actionEnum": "input",
                            "operationParam": {"text": "alice"},
                        },
                    }
                ),
                encoding="utf-8",
            )
            update_step.write_text(
                json.dumps(
                    {
                        "operationNode": None,
                        "operationMethod": {
                            "actionEnum": "back",
                            "operationParam": {},
                        },
                    }
                ),
                encoding="utf-8",
            )
            adb = mock.Mock()

            add_args = solopi_ai.build_parser().parse_args(
                [
                    "case-step-add",
                    "--file",
                    str(source),
                    "--step-file",
                    str(add_step),
                    "--at",
                    "0",
                    "--output",
                    str(added_output),
                ]
            )
            add_result, add_exit = solopi_ai.dispatch(add_args, adb)

            self.assertEqual(0, add_exit)
            self.assertEqual("add", add_result["operation"])
            self.assertEqual(2, add_result["stepCount"])
            _, added_steps = self.case_steps_from_file(added_output)
            self.assertEqual(
                ["INPUT", "SLEEP"],
                [step["operationMethod"]["actionEnum"] for step in added_steps],
            )
            self.assertEqual([0, 1], [step["operationIndex"] for step in added_steps])
            self.assertEqual(2, len({step["stepId"] for step in added_steps}))
            self.assertEqual("sleep", self.sample_case()["operationLog"]["steps"][0]["operationMethod"]["actionEnum"])

            list_args = solopi_ai.build_parser().parse_args(
                ["case-step-list", "--file", str(added_output), "--index", "0"]
            )
            list_result, list_exit = solopi_ai.dispatch(list_args, adb)
            self.assertEqual(0, list_exit)
            self.assertEqual(2, list_result["stepCount"])
            self.assertEqual(1, len(list_result["steps"]))
            self.assertEqual("INPUT", list_result["steps"][0]["actionEnum"])
            self.assertTrue(list_result["steps"][0]["requiresNode"])
            self.assertIn("step", list_result["steps"][0])

            original_step_id = added_steps[0]["stepId"]
            update_args = solopi_ai.build_parser().parse_args(
                [
                    "case-step-update",
                    "--file",
                    str(added_output),
                    "--index",
                    "0",
                    "--step-file",
                    str(update_step),
                    "--output",
                    str(updated_output),
                ]
            )
            update_result, update_exit = solopi_ai.dispatch(update_args, adb)
            self.assertEqual(0, update_exit)
            self.assertEqual("update", update_result["operation"])
            _, updated_steps = self.case_steps_from_file(updated_output)
            self.assertEqual("BACK", updated_steps[0]["operationMethod"]["actionEnum"])
            self.assertEqual(original_step_id, updated_steps[0]["stepId"])
            self.assertEqual([], adb.method_calls)

    def test_case_step_copy_move_delete_keep_unique_ids_and_indexes(self):
        case = self.sample_case()
        case["operationLog"]["steps"] = [
            {
                "stepId": "alpha",
                "operationNode": None,
                "operationMethod": {"actionEnum": "sleep", "operationParam": {"text": "1"}},
            },
            {
                "stepId": "beta",
                "operationNode": None,
                "operationMethod": {"actionEnum": "back", "operationParam": {}},
            },
            {
                "stepId": "gamma",
                "operationNode": None,
                "operationMethod": {
                    "actionEnum": "screenshot",
                    "operationParam": {"text": "after"},
                },
            },
        ]
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            source = root / "source.json"
            copied = root / "copied.json"
            moved = root / "moved.json"
            deleted = root / "deleted.json"
            source.write_text(json.dumps(case), encoding="utf-8")

            copy_args = solopi_ai.build_parser().parse_args(
                [
                    "case-step-copy",
                    "--file",
                    str(source),
                    "--index",
                    "0",
                    "--to-index",
                    "3",
                    "--output",
                    str(copied),
                ]
            )
            copy_result, copy_exit = solopi_ai.command_case_step_copy(copy_args, mock.Mock())
            self.assertEqual(0, copy_exit)
            self.assertEqual(3, copy_result["affectedIndex"])
            _, copied_steps = self.case_steps_from_file(copied)
            copied_id = copied_steps[3]["stepId"]
            self.assertNotEqual("alpha", copied_id)
            self.assertEqual(4, len({step["stepId"] for step in copied_steps}))

            move_args = solopi_ai.build_parser().parse_args(
                [
                    "case-step-move",
                    "--file",
                    str(copied),
                    "--from-index",
                    "3",
                    "--to-index",
                    "0",
                    "--output",
                    str(moved),
                ]
            )
            move_result, move_exit = solopi_ai.command_case_step_move(move_args, mock.Mock())
            self.assertEqual(0, move_exit)
            self.assertEqual(0, move_result["affectedIndex"])
            _, moved_steps = self.case_steps_from_file(moved)
            self.assertEqual(copied_id, moved_steps[0]["stepId"])
            self.assertEqual(list(range(4)), [step["operationIndex"] for step in moved_steps])

            delete_args = solopi_ai.build_parser().parse_args(
                [
                    "case-step-delete",
                    "--file",
                    str(moved),
                    "--index",
                    "1",
                    "--output",
                    str(deleted),
                ]
            )
            delete_result, delete_exit = solopi_ai.command_case_step_delete(delete_args, mock.Mock())
            self.assertEqual(0, delete_exit)
            self.assertEqual("alpha", delete_result["removedStepId"])
            _, deleted_steps = self.case_steps_from_file(deleted)
            self.assertEqual(list(range(3)), [step["operationIndex"] for step in deleted_steps])

    def test_case_step_edit_refuses_existing_output_and_source_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            source = root / "source.json"
            step_file = root / "step.json"
            output = root / "output.json"
            source.write_text(json.dumps(self.sample_case()), encoding="utf-8")
            step_file.write_text(
                json.dumps(
                    {
                        "operationNode": None,
                        "operationMethod": {"actionEnum": "back", "operationParam": {}},
                    }
                ),
                encoding="utf-8",
            )
            output.write_text("keep", encoding="utf-8")

            base = [
                "case-step-add",
                "--file",
                str(source),
                "--step-file",
                str(step_file),
                "--output",
                str(output),
            ]
            with self.assertRaises(solopi_ai.CliError):
                solopi_ai.command_case_step_add(
                    solopi_ai.build_parser().parse_args(base), mock.Mock()
                )
            self.assertEqual("keep", output.read_text(encoding="utf-8"))

            overwrite_args = solopi_ai.build_parser().parse_args([*base, "--overwrite"])
            _, overwrite_exit = solopi_ai.command_case_step_add(overwrite_args, mock.Mock())
            self.assertEqual(0, overwrite_exit)
            self.assertTrue(json.loads(output.read_text(encoding="utf-8")))

            same_path_args = solopi_ai.build_parser().parse_args(
                [
                    "case-step-add",
                    "--file",
                    str(source),
                    "--step-file",
                    str(step_file),
                    "--output",
                    str(source),
                    "--overwrite",
                ]
            )
            with self.assertRaises(solopi_ai.CliError):
                solopi_ai.command_case_step_add(same_path_args, mock.Mock())

    def test_case_step_edit_reuses_node_index_and_provider_validation(self):
        provider_case = self.sample_case()
        provider_case["operationLog"]["steps"] = [
            {
                "operationNode": None,
                "operationMethod": {
                    "actionEnum": "otherGlobal",
                    "operationParam": {"targetAction": "startRecord", "checkList": "CPU"},
                },
            },
            {
                "operationNode": None,
                "operationMethod": {
                    "actionEnum": "otherGlobal",
                    "operationParam": {"targetAction": "stopRecord"},
                },
            },
        ]
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            source = root / "source.json"
            provider_source = root / "provider.json"
            bad_click = root / "click.json"
            source.write_text(json.dumps(self.sample_case()), encoding="utf-8")
            provider_source.write_text(json.dumps(provider_case), encoding="utf-8")
            bad_click.write_text(
                json.dumps(
                    {
                        "operationNode": None,
                        "operationMethod": {"actionEnum": "click", "operationParam": {}},
                    }
                ),
                encoding="utf-8",
            )

            invalid_commands = (
                [
                    "case-step-add",
                    "--file",
                    str(source),
                    "--step-file",
                    str(bad_click),
                    "--output",
                    str(root / "bad-node.json"),
                ],
                [
                    "case-step-add",
                    "--file",
                    str(source),
                    "--step-file",
                    str(bad_click),
                    "--at",
                    "2",
                    "--output",
                    str(root / "bad-index.json"),
                ],
                [
                    "case-step-delete",
                    "--file",
                    str(source),
                    "--index",
                    "0",
                    "--output",
                    str(root / "empty.json"),
                ],
                [
                    "case-step-delete",
                    "--file",
                    str(provider_source),
                    "--index",
                    "1",
                    "--output",
                    str(root / "unpaired.json"),
                ],
            )
            for argv in invalid_commands:
                with self.subTest(command=argv[0]), self.assertRaises(solopi_ai.CliError):
                    args = solopi_ai.build_parser().parse_args(argv)
                    solopi_ai.dispatch(args, mock.Mock())
                self.assertFalse(Path(argv[-1]).exists())

    def test_case_step_edit_requires_high_risk_confirmation_and_rejects_shell(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            source = root / "source.json"
            clear_data = root / "clear.json"
            execute_shell = root / "shell.json"
            source.write_text(json.dumps(self.sample_case()), encoding="utf-8")
            clear_data.write_text(
                json.dumps(
                    {
                        "operationNode": None,
                        "operationMethod": {"actionEnum": "clearData", "operationParam": {}},
                    }
                ),
                encoding="utf-8",
            )
            execute_shell.write_text(
                json.dumps(
                    {
                        "operationNode": None,
                        "operationMethod": {
                            "actionEnum": "executeShell",
                            "operationParam": {"text": "id"},
                        },
                    }
                ),
                encoding="utf-8",
            )
            base = [
                "case-step-add",
                "--file",
                str(source),
                "--step-file",
                str(clear_data),
                "--output",
                str(root / "clear-output.json"),
            ]
            with self.assertRaises(solopi_ai.CliError) as confirmation_error:
                solopi_ai.command_case_step_add(
                    solopi_ai.build_parser().parse_args(base), mock.Mock()
                )
            self.assertEqual("CLEAR_DATA", confirmation_error.exception.details["actionEnum"])

            confirmed = solopi_ai.build_parser().parse_args([*base, "--confirm-high-risk"])
            confirmed_result, confirmed_exit = solopi_ai.command_case_step_add(confirmed, mock.Mock())
            self.assertEqual(0, confirmed_exit)
            self.assertTrue(confirmed_result["highRiskConfirmed"])

            shell_args = solopi_ai.build_parser().parse_args(
                [
                    "case-step-add",
                    "--file",
                    str(source),
                    "--step-file",
                    str(execute_shell),
                    "--output",
                    str(root / "shell-output.json"),
                    "--confirm-high-risk",
                ]
            )
            with self.assertRaises(solopi_ai.CliError) as shell_error:
                solopi_ai.command_case_step_add(shell_args, mock.Mock())
            self.assertEqual("EXECUTE_SHELL", shell_error.exception.details["actionEnum"])

    def test_case_step_list_marks_and_edits_reject_historical_shell(self):
        case = self.sample_case(action="executeShell")
        case["operationLog"]["steps"][0]["operationMethod"]["operationParam"] = {"text": "id"}
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            source = root / "source.json"
            source.write_text(json.dumps(case), encoding="utf-8")

            list_args = solopi_ai.build_parser().parse_args(
                ["case-step-list", "--file", str(source)]
            )
            listed, list_exit = solopi_ai.command_case_step_list(list_args, mock.Mock())
            self.assertEqual(0, list_exit)
            self.assertTrue(listed["steps"][0]["highRisk"])
            self.assertFalse(listed["steps"][0]["authoringAllowed"])

            copy_args = solopi_ai.build_parser().parse_args(
                [
                    "case-step-copy",
                    "--file",
                    str(source),
                    "--index",
                    "0",
                    "--to-index",
                    "1",
                    "--output",
                    str(root / "copy.json"),
                    "--confirm-high-risk",
                ]
            )
            with self.assertRaises(solopi_ai.CliError):
                solopi_ai.command_case_step_copy(copy_args, mock.Mock())

            move_output = root / "move.json"
            move_args = solopi_ai.build_parser().parse_args(
                [
                    "case-step-move",
                    "--file",
                    str(source),
                    "--from-index",
                    "0",
                    "--to-index",
                    "0",
                    "--output",
                    str(move_output),
                    "--confirm-high-risk",
                ]
            )
            with self.assertRaises(solopi_ai.CliError):
                solopi_ai.command_case_step_move(move_args, mock.Mock())
            self.assertFalse(move_output.exists())

    def test_case_validate_and_import_enforce_authoring_safety_policy(self):
        shell_case = self.sample_case(action="executeShell")
        shell_case["operationLog"]["steps"][0]["operationMethod"]["operationParam"] = {
            "text": "id"
        }
        clear_data_case = self.sample_case(action="clearData")
        permission_case = self.sample_case(action="permissionAlert")
        input_method_case = self.sample_case(action="inputMethod")
        provider_case = self.sample_case(action="startRecord")
        provider_start = provider_case["operationLog"]["steps"][0]
        provider_start["operationMethod"]["operationParam"] = {
            "checkList": "CPU",
            "url": "https://example.invalid/upload",
        }
        provider_stop = copy.deepcopy(provider_start)
        provider_stop["operationMethod"] = {
            "actionEnum": "stopRecord",
            "operationParam": {},
        }
        provider_case["operationLog"]["steps"].append(provider_stop)

        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            shell_file = root / "shell.json"
            permission_file = root / "permission-alert.json"
            input_method_file = root / "input-method.json"
            clear_data_file = root / "clear-data.json"
            provider_file = root / "provider-url.json"
            shell_file.write_text(json.dumps(shell_case), encoding="utf-8")
            permission_file.write_text(json.dumps(permission_case), encoding="utf-8")
            input_method_file.write_text(json.dumps(input_method_case), encoding="utf-8")
            clear_data_file.write_text(json.dumps(clear_data_case), encoding="utf-8")
            provider_file.write_text(json.dumps(provider_case), encoding="utf-8")

            preserve_only_cases = (
                (shell_file, "EXECUTE_SHELL"),
                (permission_file, "HANDLE_PERMISSION_ALERT"),
                (input_method_file, "HIDE_INPUT_METHOD"),
            )
            for command in ("case-validate", "case-import"):
                for case_file, expected_action in preserve_only_cases:
                    with self.subTest(command=command, action=expected_action):
                        args = solopi_ai.build_parser().parse_args(
                            [command, "--file", str(case_file), "--confirm-high-risk"]
                        )
                        adb = mock.Mock()
                        with self.assertRaises(solopi_ai.CliError) as error:
                            solopi_ai.dispatch(args, adb)
                        self.assertEqual(
                            expected_action, error.exception.details["actionEnum"]
                        )
                        adb.make_directory.assert_not_called()
                        adb.push.assert_not_called()
                        adb.invoke_scheme.assert_not_called()

            unconfirmed_args = solopi_ai.build_parser().parse_args(
                ["case-validate", "--file", str(clear_data_file)]
            )
            with self.assertRaises(solopi_ai.CliError) as error:
                solopi_ai.command_case_validate(unconfirmed_args, mock.Mock())
            self.assertEqual("CLEAR_DATA", error.exception.details["actionEnum"])

            confirmed_args = solopi_ai.build_parser().parse_args(
                [
                    "case-validate",
                    "--file",
                    str(clear_data_file),
                    "--confirm-high-risk",
                ]
            )
            confirmed_result, confirmed_exit = solopi_ai.command_case_validate(
                confirmed_args, mock.Mock()
            )
            self.assertEqual(0, confirmed_exit)
            self.assertTrue(confirmed_result["highRiskConfirmed"])

            provider_args = solopi_ai.build_parser().parse_args(
                ["case-validate", "--file", str(provider_file)]
            )
            with self.assertRaises(solopi_ai.CliError) as error:
                solopi_ai.command_case_validate(provider_args, mock.Mock())
            self.assertEqual("startRecord", error.exception.details["targetAction"])

    def test_perf_analyze_reports_utf8_statistics_and_skipped_columns(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            evidence = Path(temporary_dir) / "evidence"
            evidence.mkdir()
            (evidence / "CPU.csv").write_text(
                "RecordTime,CPU(%),extra,SimpleTime\n"
                "1000,1,前台,0\n"
                "2000,2,前台,1\n"
                "3000,3,后台,2\n"
                "4000,100,后台,3\n",
                encoding="utf-8",
            )
            args = solopi_ai.build_parser().parse_args(
                ["perf-analyze", "--input", str(evidence)]
            )

            result, exit_code = solopi_ai.dispatch(args, mock.Mock())

        self.assertEqual(0, exit_code)
        self.assertTrue(result["success"])
        self.assertEqual("descriptive-only", result["analysisMode"])
        self.assertFalse(result["assessment"]["performed"])
        self.assertEqual(1, result["summary"]["fileCount"])
        self.assertEqual("utf-8", result["files"][0]["encoding"])
        columns = {column["name"]: column for column in result["files"][0]["columns"]}
        self.assertEqual(4, columns["CPU(%)"]["sampleCount"])
        self.assertEqual(1.0, columns["CPU(%)"]["min"])
        self.assertEqual(100.0, columns["CPU(%)"]["max"])
        self.assertEqual(26.5, columns["CPU(%)"]["mean"])
        self.assertEqual(2.5, columns["CPU(%)"]["median"])
        self.assertEqual(100.0, columns["CPU(%)"]["p90"])
        self.assertEqual("skipped", columns["extra"]["kind"])
        self.assertEqual("contains_non_numeric_values", columns["extra"]["reason"])

    def test_perf_analyze_reads_gbk_nested_csv_and_missing_values(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            evidence = Path(temporary_dir) / "evidence"
            nested = evidence / "session"
            nested.mkdir(parents=True)
            csv_text = (
                "RecordTime,内存(MB),CPU,备注\n"
                "1000,10,1,正常\n"
                "2000,,bad,缺失\n"
                "3000,30,3,正常\n"
            )
            (nested / "Memory.csv").write_bytes(csv_text.encode("gbk"))
            args = solopi_ai.build_parser().parse_args(
                ["perf-analyze", "--input", str(evidence)]
            )

            result, exit_code = solopi_ai.command_perf_analyze(args, mock.Mock())

        self.assertEqual(0, exit_code)
        self.assertEqual("session/Memory.csv", result["files"][0]["path"])
        self.assertEqual("gbk", result["files"][0]["encoding"])
        columns = {column["name"]: column for column in result["files"][0]["columns"]}
        self.assertEqual("numeric", columns["内存(MB)"]["kind"])
        self.assertEqual(2, columns["内存(MB)"]["sampleCount"])
        self.assertEqual(1, columns["内存(MB)"]["missingCount"])
        self.assertEqual("skipped", columns["CPU"]["kind"])
        self.assertEqual(1, columns["CPU"]["nonNumericCount"])
        self.assertEqual(2, result["summary"]["skippedColumnCount"])

    def test_perf_analyze_keeps_extreme_finite_statistics_json_safe(self):
        column = solopi_ai.descriptive_numeric_column(
            "CPU", 0, ["1e308", "1e308"]
        )

        self.assertEqual(1e308, column["mean"])
        self.assertEqual(1e308, column["median"])
        json.dumps(column, allow_nan=False)

    def test_perf_analyze_rejects_empty_malformed_and_undecodable_evidence(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            empty = root / "empty"
            empty.mkdir()
            with self.assertRaises(solopi_ai.CliError):
                solopi_ai.command_perf_analyze(
                    solopi_ai.build_parser().parse_args(
                        ["perf-analyze", "--input", str(empty)]
                    ),
                    mock.Mock(),
                )

            malformed = root / "malformed"
            malformed.mkdir()
            (malformed / "bad.csv").write_text("CPU,CPU\n1,2\n", encoding="utf-8")
            with self.assertRaises(solopi_ai.CliError) as duplicate_error:
                solopi_ai.command_perf_analyze(
                    solopi_ai.build_parser().parse_args(
                        ["perf-analyze", "--input", str(malformed)]
                    ),
                    mock.Mock(),
                )
            self.assertIn("重复", str(duplicate_error.exception))

            undecodable = root / "undecodable"
            undecodable.mkdir()
            (undecodable / "bad.csv").write_bytes(b"CPU\n\x81")
            with self.assertRaises(solopi_ai.CliError) as encoding_error:
                solopi_ai.command_perf_analyze(
                    solopi_ai.build_parser().parse_args(
                        ["perf-analyze", "--input", str(undecodable)]
                    ),
                    mock.Mock(),
                )
            self.assertIn("编码", str(encoding_error.exception))

    def test_perf_analyze_cli_is_local_and_does_not_claim_compliance(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            evidence = Path(temporary_dir) / "evidence"
            evidence.mkdir()
            (evidence / "FPS.csv").write_text(
                "RecordTime,FPS\n1000,60\n2000,58\n",
                encoding="utf-8",
            )
            result = subprocess.run(
                [str(SKILL_CLI), "--pretty", "perf-analyze", "--input", str(evidence)],
                capture_output=True,
                text=True,
                timeout=10,
            )

        self.assertEqual(0, result.returncode, result.stderr)
        payload = json.loads(result.stdout)
        self.assertFalse(payload["assessment"]["performed"])
        self.assertNotIn("passed", payload)
        self.assertNotIn("compliant", payload)

    def test_case_validate_sets_running_params_and_preserves_advance_settings(self):
        case = self.sample_case()
        case["advanceSettings"] = json.dumps(
            {
                "descriptorMode": "accessibilityId",
                "version": 3,
                "custom": {"enabled": True},
                "runningParam": {
                    "mode": "SEPARATE",
                    "paramList": [{"account": "one,two"}],
                },
            }
        )
        running_params = {
            "mode": "UNION",
            "paramList": [
                {"account": "alice", "region": "cn"},
                {"account": "bob", "region": "us"},
            ],
        }

        with tempfile.TemporaryDirectory() as temporary_dir:
            case_file = Path(temporary_dir) / "case.json"
            params_file = Path(temporary_dir) / "params.json"
            case_file.write_text(json.dumps(case), encoding="utf-8")
            params_file.write_text(json.dumps(running_params), encoding="utf-8")
            args = solopi_ai.build_parser().parse_args(
                [
                    "case-validate",
                    "--file",
                    str(case_file),
                    "--running-params-file",
                    str(params_file),
                ]
            )

            result, exit_code = solopi_ai.command_case_validate(args, mock.Mock())

        self.assertEqual(0, exit_code)
        settings_text = result["case"]["advanceSettings"]
        settings = json.loads(settings_text)
        self.assertEqual("accessibilityId", settings["descriptorMode"])
        self.assertEqual(3, settings["version"])
        self.assertEqual({"enabled": True}, settings["custom"])
        self.assertEqual(running_params, settings["runningParam"])
        self.assertEqual(
            {"configured": True, "mode": "UNION", "itemCount": 2},
            result["runningParams"],
        )
        self.assertEqual(
            json.dumps(settings, ensure_ascii=False, separators=(",", ":")),
            settings_text,
        )

    def test_case_validate_clears_only_running_params(self):
        case = self.sample_case()
        case["advanceSettings"] = json.dumps(
            {
                "version": 2,
                "overrideApp": "com.example.override",
                "runningParam": {
                    "mode": "UNION",
                    "paramList": [{"account": "alice"}],
                },
            }
        )
        with tempfile.TemporaryDirectory() as temporary_dir:
            case_file = Path(temporary_dir) / "case.json"
            case_file.write_text(json.dumps(case), encoding="utf-8")
            args = solopi_ai.build_parser().parse_args(
                ["case-validate", "--file", str(case_file), "--clear-running-params"]
            )

            result, exit_code = solopi_ai.command_case_validate(args, mock.Mock())

        self.assertEqual(0, exit_code)
        self.assertEqual(
            '{"version":2,"overrideApp":"com.example.override"}',
            result["case"]["advanceSettings"],
        )
        self.assertEqual(
            {"configured": False, "mode": None, "itemCount": 0},
            result["runningParams"],
        )

    def test_normalize_case_validates_and_compacts_existing_running_params(self):
        valid_running_params = (
            {
                "mode": "SEPARATE",
                "paramList": [{"account": "alice,bob"}, {"region": "cn,us"}],
            },
            {
                "mode": "UNION",
                "paramList": [
                    {"account": "alice", "region": "cn"},
                    {"region": "us", "account": "bob"},
                ],
            },
        )
        for running_params in valid_running_params:
            with self.subTest(mode=running_params["mode"]):
                case = self.sample_case()
                case["advanceSettings"] = json.dumps(
                    {"version": 4, "runningParam": running_params}, indent=2
                )

                normalized = solopi_ai.normalize_case(case)

                self.assertEqual(
                    json.dumps(
                        {"version": 4, "runningParam": running_params},
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                    normalized["advanceSettings"],
                )

    def test_normalize_case_rejects_invalid_running_params(self):
        invalid_running_params = (
            {},
            {"mode": "separate", "paramList": [{"account": "alice"}]},
            {"mode": [], "paramList": [{"account": "alice"}]},
            {"mode": "UNKNOWN", "paramList": [{"account": "alice"}]},
            {"mode": "SEPARATE"},
            {"mode": "SEPARATE", "paramList": []},
            {"mode": "SEPARATE", "paramList": ["account=alice"]},
            {"mode": "SEPARATE", "paramList": [{"account": "alice", "region": "cn"}]},
            {"mode": "SEPARATE", "paramList": [{" ": "alice"}]},
            {"mode": "SEPARATE", "paramList": [{" account ": "alice"}]},
            {"mode": "SEPARATE", "paramList": [{"account": 1}]},
            {"mode": "SEPARATE", "paramList": [{"account": " "}]},
            {"mode": "SEPARATE", "paramList": [{"account": ","}]},
            {"mode": "SEPARATE", "paramList": [{"account": "alice,,bob"}]},
            {
                "mode": "SEPARATE",
                "paramList": [{"account": "alice"}, {"account": "bob"}],
            },
            {"mode": "UNION", "paramList": [{}]},
            {"mode": "UNION", "paramList": [{"account": 1}]},
            {"mode": "UNION", "paramList": [{"account": ""}]},
            {
                "mode": "UNION",
                "paramList": [{"account": "alice"}, {"account": "bob", "region": "us"}],
            },
            {
                "mode": "UNION",
                "paramList": [{"account": "alice"}],
                "unexpected": True,
            },
        )
        for running_params in invalid_running_params:
            with self.subTest(running_params=running_params):
                case = self.sample_case()
                case["advanceSettings"] = json.dumps({"runningParam": running_params})

                with self.assertRaises(solopi_ai.CliError):
                    solopi_ai.normalize_case(case)

    def test_normalize_case_rejects_non_object_advance_settings(self):
        for advance_settings in ("not-json", "[]", "null"):
            with self.subTest(advance_settings=advance_settings):
                case = self.sample_case()
                case["advanceSettings"] = advance_settings
                with self.assertRaises(solopi_ai.CliError):
                    solopi_ai.normalize_case(case)

    def test_case_import_rejects_invalid_existing_running_params_before_adb(self):
        args = solopi_ai.build_parser().parse_args(["case-import", "--file", "case.json"])
        case = self.sample_case()
        case["advanceSettings"] = json.dumps(
            {
                "runningParam": {
                    "mode": "UNION",
                    "paramList": [{"account": "alice"}, {"account": 2}],
                }
            }
        )
        adb = mock.Mock()

        with mock.patch.object(solopi_ai, "load_json_file", return_value=case), self.assertRaises(
            solopi_ai.CliError
        ):
            solopi_ai.command_case_import(args, adb)

        adb.make_directory.assert_not_called()
        adb.push.assert_not_called()
        adb.invoke_scheme.assert_not_called()

    def test_normalize_case_rejects_empty_steps(self):
        case = self.sample_case()
        case["operationLog"]["steps"] = []

        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.normalize_case(case)

        self.assertIn("非空数组", str(error.exception))

    def test_normalize_case_rejects_missing_action_parameters(self):
        case = self.sample_case(action="input", operation_node={"resourceId": "login"})
        case["operationLog"]["steps"][0]["operationMethod"]["operationParam"] = {}

        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.normalize_case(case)

        self.assertEqual(["text"], error.exception.details["missingParams"])

    def test_normalize_case_rejects_duplicate_step_ids(self):
        case = self.sample_case()
        first = case["operationLog"]["steps"][0]
        first["stepId"] = "duplicate"
        second = json.loads(json.dumps(first))
        case["operationLog"]["steps"].append(second)

        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.normalize_case(case)

        self.assertIn("必须唯一", str(error.exception))

    def test_case_template_is_author_friendly_and_valid(self):
        template = solopi_ai.build_case_template("smoke", "com.example", "Example")

        self.assertIsInstance(template["operationLog"], dict)
        normalized = solopi_ai.normalize_case(template)
        self.assertEqual("smoke", normalized["caseName"])

    def test_result_rejects_run_id_mismatch(self):
        args = solopi_ai.build_parser().parse_args(["result", "--run-id", "expected"])

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def query(self, query_type):
                self_query_type = query_type
                if self_query_type != "result":
                    raise AssertionError("unexpected query")
                return {"success": True, "runId": "newer", "state": "passed", "terminal": True}

        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()):
            result, exit_code = solopi_ai.command_result(args, mock.Mock())

        self.assertEqual(2, exit_code)
        self.assertEqual("expected", result["expectedRunId"])
        self.assertEqual("newer", result["latestRun"]["runId"])

    def test_case_import_pushes_normalized_file_and_requests_replace(self):
        args = solopi_ai.build_parser().parse_args(
            ["case-import", "--file", "unused.json", "--replace"]
        )
        request_ids = []

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def query(self, query_type, params=None):
                self_query_type = query_type
                if self_query_type != "case-import-status":
                    raise AssertionError("unexpected query")
                request_ids.append(params["requestId"])
                return {
                    "success": True,
                    "requestId": params["requestId"],
                    "imported": True,
                    "replaced": 1,
                }

        adb = mock.Mock()
        with mock.patch.object(solopi_ai, "load_json_file", return_value=self.sample_case()), mock.patch.object(
            solopi_ai, "session_from_args", return_value=FakeSession()
        ):
            result, exit_code = solopi_ai.command_case_import(args, adb)

        self.assertEqual(0, exit_code)
        self.assertTrue(result["imported"])
        adb.make_directory.assert_called_once()
        adb.push.assert_called_once()
        scheme_params = adb.invoke_scheme.call_args.args[1]
        self.assertEqual("case-import", scheme_params["type"])
        self.assertEqual("true", scheme_params["replace"])
        self.assertEqual(request_ids[0], scheme_params["requestId"])

    def test_perf_start_rejects_unknown_item_before_scheme(self):
        args = solopi_ai.build_parser().parse_args(
            [
                "perf-start",
                "--target-package",
                "com.example",
                "--items",
                "CPU,Unknown",
            ]
        )

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def performance(self, mode, timeout=None):
                self_mode = mode
                if self_mode != "listItems":
                    raise AssertionError("unexpected mode: %s" % self_mode)
                return {
                    "success": True,
                    "items": [{"key": "CPU"}, {"key": "Memory"}],
                }

        adb = mock.Mock()
        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()):
            result, exit_code = solopi_ai.command_perf_start(args, adb)

        self.assertEqual(2, exit_code)
        self.assertEqual(["Unknown"], result["unsupportedItems"])
        adb.invoke_scheme.assert_not_called()

    def test_perf_display_start_supports_global_owned_session(self):
        args = solopi_ai.build_parser().parse_args(
            [
                "perf-display-start",
                "--global",
                "--items",
                "CPU,Memory",
            ]
        )
        test_case = self

        class FakeSession:
            request_timeout = 5

            def __init__(self):
                self.display_statuses = [
                    test_case.performance_display_status("idle"),
                    {
                        **test_case.performance_display_status(
                            "running", session_id="display-1"
                        ),
                        "targetPackage": "-",
                        "items": ["CPU", "Memory"],
                        "ownedDisplayNames": ["CPU", "Memory"],
                        "runningItems": ["CPU", "Memory"],
                        "values": {"CPU": "12%", "Memory": "128 MB"},
                    },
                ]

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def performance(self, mode, timeout=None):
                if mode == "listItems":
                    return {
                        "success": True,
                        "items": [{"key": "CPU"}, {"key": "Memory"}],
                    }
                if mode == "status":
                    return {
                        "success": True,
                        "state": "idle",
                        "active": False,
                        "terminal": False,
                        "recording": False,
                        "sessionId": None,
                    }
                raise AssertionError("unexpected mode: %s" % mode)

            def performance_display(self, timeout=None):
                return self.display_statuses.pop(0)

        adb = mock.Mock()
        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=FakeSession()
        ), mock.patch.object(solopi_ai.uuid, "uuid4", return_value="display-1"):
            result, exit_code = solopi_ai.command_perf_display_start(args, adb)

        self.assertEqual(0, exit_code)
        self.assertTrue(result["success"])
        self.assertEqual({"CPU": "12%", "Memory": "128 MB"}, result["values"])
        adb.invoke_scheme.assert_called_once_with(
            "performance",
            {
                "mode": "display",
                "action": "start",
                "targetApp": "-",
                "items": "CPU,Memory",
                "sessionId": "display-1",
            },
        )

    def test_perf_display_status_rejects_session_mismatch(self):
        args = solopi_ai.build_parser().parse_args(
            ["perf-display-status", "--session-id", "expected"]
        )
        response = self.performance_display_status("running", session_id="newer")

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def performance_display(self, timeout=None):
                return response

        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=FakeSession()
        ):
            result, exit_code = solopi_ai.command_perf_display_status(args, mock.Mock())

        self.assertEqual(2, exit_code)
        self.assertEqual("expected", result["expectedSessionId"])
        self.assertEqual("newer", result["latestPerformanceDisplay"]["sessionId"])

    def test_performance_display_status_rejects_values_outside_lease(self):
        response = self.performance_display_status("running")
        response["values"] = {"Memory": "128 MB"}

        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.validate_performance_display_status(response)

        self.assertEqual(4, error.exception.exit_code)

    def test_perf_display_stop_retries_device_declared_cleanup(self):
        args = solopi_ai.build_parser().parse_args(
            [
                "perf-display-stop",
                "--session-id",
                "display-1",
                "--poll-interval",
                "0.001",
            ]
        )
        test_case = self

        class FakeSession:
            request_timeout = 5

            def __init__(self):
                self.statuses = [
                    test_case.performance_display_status("running"),
                    test_case.performance_display_status(
                        "stopping", stop_retryable=True
                    ),
                    test_case.performance_display_status("stopped"),
                ]

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def performance_display(self, timeout=None):
                return self.statuses.pop(0)

        adb = mock.Mock()
        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=FakeSession()
        ):
            result, exit_code = solopi_ai.command_perf_display_stop(args, adb)

        self.assertEqual(0, exit_code)
        self.assertTrue(result["success"])
        self.assertEqual(2, adb.invoke_scheme.call_count)
        for invocation in adb.invoke_scheme.call_args_list:
            self.assertEqual("performance", invocation.args[0])
            self.assertEqual("display", invocation.args[1]["mode"])
            self.assertEqual("stop", invocation.args[1]["action"])
            self.assertEqual("display-1", invocation.args[1]["sessionId"])

    def test_perf_start_waits_for_matching_recording_session(self):
        args = solopi_ai.build_parser().parse_args(
            [
                "perf-start",
                "--target-package",
                "com.example",
                "--items",
                "CPU,Memory",
            ]
        )

        class FakeSession:
            def __init__(self):
                self.statuses = [
                    {
                        "success": True,
                        "state": "idle",
                        "active": False,
                        "terminal": False,
                        "recording": False,
                        "sessionId": None,
                    },
                    {
                        "success": True,
                        "state": "recording",
                        "active": True,
                        "terminal": False,
                        "recording": True,
                        "sessionId": "perf-1",
                    },
                ]

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def performance(self, mode, timeout=None):
                if mode == "listItems":
                    return {
                        "success": True,
                        "items": [{"key": "CPU"}, {"key": "Memory"}],
                    }
                if mode == "status":
                    return self.statuses.pop(0)
                raise AssertionError("unexpected mode: %s" % mode)

        adb = mock.Mock()
        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()), mock.patch.object(
            solopi_ai.uuid, "uuid4", return_value="perf-1"
        ):
            result, exit_code = solopi_ai.command_perf_start(args, adb)

        self.assertEqual(0, exit_code)
        self.assertTrue(result["success"])
        scheme_params = adb.invoke_scheme.call_args.args[1]
        self.assertEqual("perf-1", scheme_params["sessionId"])
        self.assertEqual("CPU,Memory", scheme_params["items"])
        self.assertEqual("com.example", scheme_params["targetApp"])

    def test_perf_start_transport_error_preserves_session_id(self):
        args = solopi_ai.build_parser().parse_args(
            [
                "perf-start",
                "--target-package",
                "com.example",
                "--items",
                "CPU",
            ]
        )

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def performance(self, mode, timeout=None):
                if mode == "listItems":
                    return {"success": True, "items": [{"key": "CPU"}]}
                return {
                    "success": True,
                    "state": "idle",
                    "active": False,
                    "terminal": False,
                    "recording": False,
                    "sessionId": None,
                }

        adb = mock.Mock()
        adb.invoke_scheme.side_effect = solopi_ai.CliError("scheme failed", 4)
        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()), mock.patch.object(
            solopi_ai.uuid, "uuid4", return_value="perf-recover"
        ), self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.command_perf_start(args, adb)

        self.assertEqual("perf-recover", error.exception.details["sessionId"])
        self.assertEqual("performance-start", error.exception.details["phase"])

    def test_perf_status_rejects_session_mismatch(self):
        args = solopi_ai.build_parser().parse_args(
            ["perf-status", "--session-id", "expected"]
        )

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def performance(self, mode, timeout=None):
                self.assert_mode = mode
                return {
                    "success": True,
                    "sessionId": "newer",
                    "state": "recording",
                    "active": True,
                    "terminal": False,
                    "recording": True,
                }

        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()):
            result, exit_code = solopi_ai.command_perf_status(args, mock.Mock())

        self.assertEqual(2, exit_code)
        self.assertEqual("expected", result["expectedSessionId"])
        self.assertEqual("newer", result["latestPerformance"]["sessionId"])

    def test_perf_status_rejects_malformed_success_response(self):
        args = solopi_ai.build_parser().parse_args(["perf-status"])

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def performance(self, mode, timeout=None):
                return {"success": True}

        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()), self.assertRaises(
            solopi_ai.CliError
        ) as error:
            solopi_ai.command_perf_status(args, mock.Mock())

        self.assertEqual(4, error.exception.exit_code)

    def test_perf_status_and_stop_reject_blank_optional_values(self):
        status_args = solopi_ai.build_parser().parse_args(
            ["perf-status", "--session-id", "  "]
        )
        stop_args = solopi_ai.build_parser().parse_args(
            ["perf-stop", "--session-id", "perf-1", "--output", "  "]
        )

        with self.assertRaises(solopi_ai.CliError) as status_error:
            solopi_ai.command_perf_status(status_args, mock.Mock())
        with self.assertRaises(solopi_ai.CliError) as stop_error:
            solopi_ai.command_perf_stop(stop_args, mock.Mock())

        self.assertEqual(3, status_error.exception.exit_code)
        self.assertEqual(3, stop_error.exception.exit_code)

    def test_wait_for_performance_state_rejects_terminal_replacement(self):
        class FakeSession:
            request_timeout = 5

            def performance(self, mode, timeout=None):
                return {
                    "success": True,
                    "sessionId": "other",
                    "state": "stopped",
                    "active": False,
                    "terminal": True,
                    "recording": False,
                }

        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.wait_for_performance_state(
                FakeSession(),
                "expected",
                {"stopped", "failed"},
                1,
                0.5,
                "stop",
            )

        self.assertEqual(2, error.exception.exit_code)
        self.assertEqual("other", error.exception.details["latestPerformance"]["sessionId"])

    def test_performance_wait_clamps_sleep_to_remaining_timeout(self):
        class FakeClock:
            def __init__(self):
                self.value = 0.0
                self.sleeps = []

            def now(self):
                return self.value

            def sleep(self, duration):
                self.sleeps.append(duration)
                self.value += duration

        class FakeSession:
            request_timeout = 5

            def performance(self, mode, timeout=None):
                return {
                    "success": True,
                    "sessionId": "perf-1",
                    "state": "recording",
                    "active": True,
                    "terminal": False,
                    "recording": True,
                }

        fake_clock = FakeClock()
        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.wait_for_performance_state(
                FakeSession(),
                "perf-1",
                {"stopped"},
                1,
                60,
                "stop",
                clock=fake_clock.now,
                sleep=fake_clock.sleep,
            )

        self.assertEqual(124, error.exception.exit_code)
        self.assertEqual([1.0], fake_clock.sleeps)

    def test_performance_timeout_rejects_non_finite_values(self):
        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.require_positive_finite(float("nan"), "Performance timeout")
        self.assertEqual(3, error.exception.exit_code)

    def test_perf_stop_waits_for_save_and_pulls_output(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            output = Path(temporary_dir) / "performance"
            args = solopi_ai.build_parser().parse_args(
                [
                    "perf-stop",
                    "--session-id",
                    "perf-1",
                    "--output",
                    str(output),
                ]
            )

            class FakeSession:
                def __init__(self):
                    self.statuses = [
                        {
                            "success": True,
                            "sessionId": "perf-1",
                            "state": "recording",
                            "active": True,
                            "terminal": False,
                            "recording": True,
                        },
                        {
                            "success": True,
                            "sessionId": "perf-1",
                            "state": "stopped",
                            "active": False,
                            "terminal": True,
                            "recording": False,
                            "recordsRoot": "/sdcard/solopi/records",
                            "outputPath": "/sdcard/solopi/records/performance-perf-1",
                        },
                    ]

                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, traceback):
                    return None

                def performance(self, mode, timeout=None):
                    if mode != "status":
                        raise AssertionError("unexpected mode: %s" % mode)
                    return self.statuses.pop(0)

            adb = mock.Mock()
            def create_pulled_output(remote_path, local_path):
                local_path.mkdir()
                (local_path / "CPU.csv").write_text("RecordTime,CPU\n", encoding="utf-8")

            adb.pull.side_effect = create_pulled_output
            with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()):
                result, exit_code = solopi_ai.command_perf_stop(args, adb)

            self.assertEqual(0, exit_code)
            self.assertTrue(result["success"])
            adb.invoke_scheme.assert_called_once_with(
                "performance",
                {"mode": "normal", "action": "stop", "sessionId": "perf-1"},
                timeout=mock.ANY,
            )
            adb.pull.assert_called_once_with(
                "/sdcard/solopi/records/performance-perf-1",
                output,
            )
            self.assertEqual(str(output.resolve()), result["artifacts"]["performance"])

    def test_perf_stop_recovers_with_exact_session_when_preflight_is_unreachable(self):
        args = solopi_ai.build_parser().parse_args(
            [
                "perf-stop",
                "--session-id",
                "perf-recover",
                "--poll-interval",
                "0.001",
            ]
        )

        class FakeSession:
            request_timeout = 5

            def __init__(self):
                self.status_calls = 0

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def performance(self, mode, timeout=None):
                if mode != "status":
                    raise AssertionError("unexpected mode: %s" % mode)
                self.status_calls += 1
                if self.status_calls <= 2:
                    raise solopi_ai.CliError(
                        "Unable to reach SoloPi control server",
                        4,
                        url="http://127.0.0.1/scheme/performance?mode=status",
                    )
                return {
                    "success": True,
                    "sessionId": "perf-recover",
                    "state": "stopped",
                    "active": False,
                    "terminal": True,
                    "recording": False,
                }

        adb = mock.Mock()
        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=FakeSession()
        ):
            result, exit_code = solopi_ai.command_perf_stop(args, adb)

        self.assertEqual(0, exit_code)
        self.assertTrue(result["success"])
        self.assertTrue(result["recoveredWithoutPreflight"])
        adb.invoke_scheme.assert_called_once_with(
            "performance",
            {
                "mode": "normal",
                "action": "stop",
                "sessionId": "perf-recover",
            },
            timeout=mock.ANY,
        )

    def test_perf_stop_does_not_recover_from_invalid_preflight_response(self):
        args = solopi_ai.build_parser().parse_args(
            ["perf-stop", "--session-id", "perf-recover"]
        )

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def performance(self, mode, timeout=None):
                raise solopi_ai.CliError(
                    "SoloPi returned invalid JSON",
                    4,
                    url="http://127.0.0.1/scheme/performance?mode=status",
                )

        adb = mock.Mock()
        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=FakeSession()
        ), self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.command_perf_stop(args, adb)

        self.assertEqual("SoloPi returned invalid JSON", str(error.exception))
        adb.invoke_scheme.assert_not_called()

    def test_perf_stop_cancels_a_starting_session(self):
        args = solopi_ai.build_parser().parse_args(
            [
                "perf-stop",
                "--session-id",
                "perf-starting",
                "--poll-interval",
                "0.001",
            ]
        )

        class FakeSession:
            def __init__(self):
                self.statuses = [
                    {
                        "success": True,
                        "sessionId": "perf-starting",
                        "state": "starting",
                        "active": True,
                        "terminal": False,
                        "recording": False,
                    },
                    {
                        "success": True,
                        "sessionId": "perf-starting",
                        "state": "stopping",
                        "active": True,
                        "terminal": False,
                        "recording": False,
                        "error": "Performance start cancellation is waiting for the permission request",
                    },
                    {
                        "success": True,
                        "sessionId": "perf-starting",
                        "state": "failed",
                        "active": False,
                        "terminal": True,
                        "recording": False,
                        "error": "Performance start was cancelled before recording",
                    },
                ]

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def performance(self, mode, timeout=None):
                if mode != "status":
                    raise AssertionError("unexpected mode: %s" % mode)
                return self.statuses.pop(0)

        adb = mock.Mock()
        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()):
            result, exit_code = solopi_ai.command_perf_stop(args, adb)

        self.assertEqual(2, exit_code)
        self.assertFalse(result["success"])
        self.assertEqual("failed", result["state"])
        adb.invoke_scheme.assert_called_once_with(
            "performance",
            {"mode": "normal", "action": "stop", "sessionId": "perf-starting"},
            timeout=mock.ANY,
        )

    def test_perf_stop_retries_device_declared_incomplete_cleanup(self):
        args = solopi_ai.build_parser().parse_args(
            [
                "perf-stop",
                "--session-id",
                "perf-retry",
                "--poll-interval",
                "0.001",
            ]
        )

        class FakeSession:
            def __init__(self):
                self.statuses = [
                    {
                        "success": True,
                        "sessionId": "perf-retry",
                        "state": "recording",
                        "active": True,
                        "terminal": False,
                        "recording": True,
                    },
                    {
                        "success": True,
                        "sessionId": "perf-retry",
                        "state": "stopping",
                        "active": True,
                        "terminal": False,
                        "recording": False,
                        "stopRetryable": True,
                        "error": "Performance cleanup is incomplete",
                    },
                    {
                        "success": True,
                        "sessionId": "perf-retry",
                        "state": "stopped",
                        "active": False,
                        "terminal": True,
                        "recording": False,
                    },
                ]

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def performance(self, mode, timeout=None):
                if mode != "status":
                    raise AssertionError("unexpected mode: %s" % mode)
                return self.statuses.pop(0)

        adb = mock.Mock()
        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()):
            result, exit_code = solopi_ai.command_perf_stop(args, adb)

        self.assertEqual(0, exit_code)
        self.assertTrue(result["success"])
        self.assertEqual(
            [
                mock.call(
                    "performance",
                    {"mode": "normal", "action": "stop", "sessionId": "perf-retry"},
                    timeout=mock.ANY,
                ),
                mock.call(
                    "performance",
                    {"mode": "normal", "action": "stop", "sessionId": "perf-retry"},
                    timeout=mock.ANY,
                ),
            ],
            adb.invoke_scheme.call_args_list,
        )

    def test_perf_stop_bounds_device_declared_cleanup_retries(self):
        args = solopi_ai.build_parser().parse_args(
            [
                "perf-stop",
                "--session-id",
                "perf-retry-limit",
                "--poll-interval",
                "0.001",
            ]
        )

        recording = {
            "success": True,
            "sessionId": "perf-retry-limit",
            "state": "recording",
            "active": True,
            "terminal": False,
            "recording": True,
        }
        retryable = {
            "success": True,
            "sessionId": "perf-retry-limit",
            "state": "stopping",
            "active": True,
            "terminal": False,
            "recording": False,
            "stopRetryable": True,
            "error": "Performance cleanup is incomplete",
        }

        class FakeSession:
            def __init__(self):
                self.statuses = [recording] + [retryable.copy() for _ in range(4)]

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def performance(self, mode, timeout=None):
                if mode != "status":
                    raise AssertionError("unexpected mode: %s" % mode)
                return self.statuses.pop(0)

        adb = mock.Mock()
        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=FakeSession()
        ), self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.command_perf_stop(args, adb)

        self.assertEqual(2, error.exception.exit_code)
        self.assertEqual(3, error.exception.details["cleanupRetries"])
        self.assertEqual(4, adb.invoke_scheme.call_count)

    def test_perf_stop_shares_timeout_budget_across_stop_poll_and_cleanup_retry(self):
        args = solopi_ai.build_parser().parse_args(
            [
                "perf-stop",
                "--session-id",
                "perf-budget",
                "--stop-timeout",
                "1",
                "--poll-interval",
                "0.25",
            ]
        )

        class FakeClock:
            def __init__(self):
                self.value = 0.0

            def now(self):
                return self.value

            def sleep(self, duration):
                self.value += duration

        class FakeSession:
            def __init__(self):
                self.request_timeouts = []
                self.statuses = [
                    {
                        "success": True,
                        "sessionId": "perf-budget",
                        "state": "recording",
                        "active": True,
                        "terminal": False,
                        "recording": True,
                    },
                    {
                        "success": True,
                        "sessionId": "perf-budget",
                        "state": "stopping",
                        "active": True,
                        "terminal": False,
                        "recording": False,
                        "stopRetryable": True,
                    },
                ]

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def performance(self, mode, timeout=None):
                if mode != "status":
                    raise AssertionError("unexpected mode: %s" % mode)
                self.request_timeouts.append(timeout)
                return self.statuses.pop(0)

        fake_clock = FakeClock()
        fake_session = FakeSession()
        scheme_timeouts = []

        def invoke_scheme(action, params, timeout=None):
            scheme_timeouts.append(timeout)
            if len(scheme_timeouts) == 1:
                fake_clock.value += 0.4
                return "solopi://startaction/performance"
            fake_clock.value += timeout
            return "solopi://startaction/performance"

        adb = mock.Mock()
        adb.invoke_scheme.side_effect = invoke_scheme
        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=fake_session
        ), self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.command_perf_stop(
                args,
                adb,
                clock=fake_clock.now,
                sleep=fake_clock.sleep,
            )

        self.assertEqual(124, error.exception.exit_code)
        self.assertEqual("perf-budget", error.exception.details["sessionId"])
        self.assertEqual("performance-stop", error.exception.details["phase"])
        self.assertEqual("stopping", error.exception.details["performance"]["state"])
        self.assertIsNone(fake_session.request_timeouts[0])
        self.assertAlmostEqual(0.6, fake_session.request_timeouts[1])
        self.assertAlmostEqual(1.0, scheme_timeouts[0])
        self.assertAlmostEqual(0.6, scheme_timeouts[1])
        self.assertAlmostEqual(1.0, fake_clock.value)

    def test_perf_stop_bounds_initial_retryable_cleanup_by_timeout(self):
        args = solopi_ai.build_parser().parse_args(
            [
                "perf-stop",
                "--session-id",
                "perf-stopping",
                "--stop-timeout",
                "1",
            ]
        )

        class FakeClock:
            def __init__(self):
                self.value = 0.0

            def now(self):
                return self.value

            def sleep(self, duration):
                self.value += duration

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def performance(self, mode, timeout=None):
                return {
                    "success": True,
                    "sessionId": "perf-stopping",
                    "state": "stopping",
                    "active": True,
                    "terminal": False,
                    "recording": False,
                    "stopRetryable": True,
                }

        fake_clock = FakeClock()

        def invoke_scheme(action, params, timeout=None):
            fake_clock.value += timeout
            return "solopi://startaction/performance"

        adb = mock.Mock()
        adb.invoke_scheme.side_effect = invoke_scheme
        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=FakeSession()
        ), self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.command_perf_stop(
                args,
                adb,
                clock=fake_clock.now,
                sleep=fake_clock.sleep,
            )

        self.assertEqual(124, error.exception.exit_code)
        self.assertEqual("perf-stopping", error.exception.details["sessionId"])
        self.assertEqual("performance-stop", error.exception.details["phase"])
        self.assertEqual("stopping", error.exception.details["performance"]["state"])
        self.assertEqual(1, adb.invoke_scheme.call_count)
        self.assertAlmostEqual(1.0, adb.invoke_scheme.call_args.kwargs["timeout"])
        self.assertAlmostEqual(1.0, fake_clock.value)

    def test_performance_status_rejects_retryable_flag_outside_stopping(self):
        status = {
            "success": True,
            "sessionId": "perf-invalid-retry",
            "state": "recording",
            "active": True,
            "terminal": False,
            "recording": True,
            "stopRetryable": True,
        }

        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.validate_performance_status(status)

        self.assertEqual(4, error.exception.exit_code)

    def test_pull_performance_output_refuses_existing_local_path(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            output = Path(temporary_dir) / "existing"
            output.mkdir()
            adb = mock.Mock()

            with self.assertRaises(solopi_ai.CliError) as error:
                solopi_ai.pull_performance_output(
                    adb,
                    "/sdcard/solopi/records/performance-perf-1",
                    "/sdcard/solopi/records",
                    output,
                )

            self.assertEqual(3, error.exception.exit_code)
            adb.pull.assert_not_called()

    def test_pull_performance_output_requires_pulled_csv(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            output = Path(temporary_dir) / "empty"
            adb = mock.Mock()
            adb.pull.side_effect = lambda remote_path, local_path: local_path.mkdir()

            with self.assertRaises(solopi_ai.CliError) as error:
                solopi_ai.pull_performance_output(
                    adb,
                    "/sdcard/solopi/records/performance-perf-1",
                    "/sdcard/solopi/records",
                    output,
                )

            self.assertEqual(4, error.exception.exit_code)

    def test_pull_performance_output_rejects_unsafe_device_path(self):
        adb = mock.Mock()
        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.pull_performance_output(
                adb,
                "/data/data/com.example/secrets",
                "/sdcard/solopi/records",
                Path("unused"),
            )
        self.assertEqual(4, error.exception.exit_code)
        adb.pull.assert_not_called()

    def test_pull_performance_output_rejects_path_outside_published_root(self):
        adb = mock.Mock()
        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.pull_performance_output(
                adb,
                "/sdcard/DCIM/performance-perf-1",
                "/sdcard/solopi/records",
                Path("unused"),
            )
        self.assertEqual(4, error.exception.exit_code)
        adb.pull.assert_not_called()

    def test_perf_pull_error_preserves_stopped_session_context(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            output = Path(temporary_dir) / "performance"
            args = solopi_ai.build_parser().parse_args(
                [
                    "perf-stop",
                    "--session-id",
                    "perf-1",
                    "--output",
                    str(output),
                ]
            )

            class FakeSession:
                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, traceback):
                    return None

                def performance(self, mode, timeout=None):
                    return {
                        "success": True,
                        "sessionId": "perf-1",
                        "state": "stopped",
                        "active": False,
                        "terminal": True,
                        "recording": False,
                        "recordsRoot": "/sdcard/solopi/records",
                        "outputPath": "/sdcard/solopi/records/performance-perf-1",
                    }

            adb = mock.Mock()
            adb.pull.side_effect = solopi_ai.CliError("pull failed", 124)
            with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()), self.assertRaises(
                solopi_ai.CliError
            ) as error:
                solopi_ai.command_perf_stop(args, adb)

            self.assertEqual(124, error.exception.exit_code)
            self.assertEqual("perf-1", error.exception.details["sessionId"])
            self.assertEqual("performance-artifact-pull", error.exception.details["phase"])
            self.assertEqual("stopped", error.exception.details["performance"]["state"])

    def test_parser_exposes_full_app_command_surface(self):
        record = solopi_ai.build_parser().parse_args(
            ["record-start", "--name", "smoke", "--target-package", "com.example"]
        )
        stress = solopi_ai.build_parser().parse_args(
            ["stress-start", "--cpu-count", "2", "--cpu-percent", "50"]
        )
        repeat = solopi_ai.build_parser().parse_args(
            ["run-repeat", "--case", "smoke", "--times", "3"]
        )
        batch = solopi_ai.build_parser().parse_args(
            ["run-batch", "--case", "one", "--case", "two", "--continue-on-failure"]
        )

        self.assertEqual("smoke", record.name)
        self.assertEqual(60, stress.duration)
        self.assertEqual(3, repeat.times)
        self.assertEqual(["one", "two"], batch.case)
        self.assertTrue(batch.continue_on_failure)
        for command in (
            "apps",
            "app-info",
            "app-status",
            "actions",
            "config-list",
            "perf-current",
            "record-status",
            "stress-status",
        ):
            self.assertEqual(command, solopi_ai.build_parser().parse_args([command]).command)

    def test_actions_lists_all_enum_and_provider_descriptors(self):
        result, exit_code = solopi_ai.command_actions(mock.Mock(), mock.Mock())

        self.assertEqual(0, exit_code)
        self.assertEqual(66, result["counts"]["enumActions"])
        self.assertEqual(6, result["counts"]["providerActions"])
        self.assertEqual(
            55,
            sum(item["supportedInCaseStep"] for item in result["enumActions"]),
        )
        self.assertEqual(
            52,
            sum(item["authoringAllowed"] for item in result["enumActions"]),
        )
        enums = {item["actionEnum"]: item for item in result["enumActions"]}
        self.assertEqual("runtime-only", enums["FINISH"]["authoring"])
        self.assertFalse(enums["FINISH"]["supportedInCaseStep"])
        self.assertTrue(enums["EXECUTE_SHELL"]["supportedInCaseStep"])
        self.assertFalse(enums["EXECUTE_SHELL"]["authoringAllowed"])
        self.assertFalse(enums["HANDLE_PERMISSION_ALERT"]["authoringAllowed"])
        self.assertFalse(enums["HIDE_INPUT_METHOD"]["authoringAllowed"])
        self.assertEqual("case-context", enums["WHILE"]["authoring"])
        self.assertTrue(enums["WHILE"]["requiresCaseContext"])
        self.assertEqual("case-only", enums["DELETE_CASE"]["authoring"])
        providers = {item["code"]: item for item in result["providerActions"]}
        self.assertEqual("OTHER_NODE", providers["clickByScreenshot"]["actionEnum"])
        self.assertTrue(providers["clickByScreenshot"]["requiresNode"])
        self.assertEqual(
            ["targetAction", "targetImage"],
            providers["clickByScreenshot"]["requiredParams"],
        )
        self.assertIn("originSize", providers["clickByScreenshot"]["optionalParams"])
        self.assertIn("checkList", providers["startRecord"]["requiredParams"])
        self.assertIn("resolution", providers["startRecordScreen"]["requiredParams"])
        self.assertEqual("startRecord", providers["stopRecord"]["requiresPriorAction"])
        self.assertTrue(providers["startRecordScreen"]["runtimeAvailabilityUnknown"])

    def test_action_documentation_matches_authoring_boundaries(self):
        inventory = (
            REPO_ROOT
            / "solopi-skill"
            / "references"
            / "app-feature-inventory.md"
        ).read_text(encoding="utf-8")
        capability_matrix = (
            REPO_ROOT
            / "solopi-skill"
            / "references"
            / "capability-matrix.md"
        ).read_text(encoding="utf-8")

        self.assertIn("52 个可编写普通动作", inventory)
        self.assertIn("55 个枚举在步骤结构上可出现", inventory)
        self.assertIn("52 个可编写普通回放动作", capability_matrix)
        self.assertIn("55 个枚举在步骤结构上可出现", capability_matrix)
        self.assertNotIn("55 个普通动作", inventory)
        self.assertNotIn("55 个普通回放动作", capability_matrix)

    def test_normalize_case_rejects_runtime_only_step(self):
        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.normalize_case(self.sample_case(action="finish"))

        self.assertIn("运行时专用", str(error.exception))

    def test_normalize_case_expands_dynamic_provider_shorthand(self):
        case = self.sample_case(
            action="clickByScreenshot",
            operation_node={"resourceId": "screen-anchor"},
        )
        case["operationLog"]["steps"][0]["operationMethod"]["operationParam"] = {
            "targetImage": "aGVsbG8=",
            "originSize": "1080,2400",
        }
        normalized = solopi_ai.normalize_case(case)
        method = json.loads(normalized["operationLog"])["steps"][0]["operationMethod"]

        self.assertEqual("OTHER_NODE", method["actionEnum"])
        self.assertEqual("clickByScreenshot", method["operationParam"]["targetAction"])

        del case["operationLog"]["steps"][0]["operationMethod"]["operationParam"]["originSize"]
        without_origin = solopi_ai.normalize_case(case)
        without_origin_method = json.loads(without_origin["operationLog"])["steps"][0][
            "operationMethod"
        ]
        self.assertNotIn("originSize", without_origin_method["operationParam"])

    def test_normalize_case_requires_dynamic_provider_target(self):
        case = self.sample_case(action="OTHER_GLOBAL")
        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.normalize_case(case)

        self.assertEqual(["targetAction"], error.exception.details["missingParams"])

    def test_normalize_case_validates_provider_specific_fields_and_pairing(self):
        case = self.sample_case(action="startRecord")
        start = case["operationLog"]["steps"][0]
        start["operationMethod"]["operationParam"] = {"checkList": "CPU,Memory"}
        stop = json.loads(json.dumps(start))
        stop["operationMethod"] = {
            "actionEnum": "stopRecord",
            "operationParam": {},
        }
        case["operationLog"]["steps"].append(stop)

        normalized = solopi_ai.normalize_case(case)
        methods = [
            step["operationMethod"]
            for step in json.loads(normalized["operationLog"])["steps"]
        ]
        self.assertEqual("startRecord", methods[0]["operationParam"]["targetAction"])
        self.assertEqual("stopRecord", methods[1]["operationParam"]["targetAction"])

        stop_only = self.sample_case(action="stopRecord")
        stop_only["operationLog"]["steps"][0]["operationMethod"]["operationParam"] = {}
        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.normalize_case(stop_only)
        self.assertEqual("startRecord", error.exception.details["requiresPriorAction"])

    def test_normalize_case_uses_real_screen_record_provider_fields(self):
        case = self.sample_case(action="startRecordScreen")
        start = case["operationLog"]["steps"][0]
        start["operationMethod"]["operationParam"] = {
            "resolution": "720x480",
            "INTENT_VIDEO_BITRATE": "2500",
            "INTENT_FRAME_RATE": "60",
            "INTENT_EXCEPT_DIFF": "0.2",
        }
        stop = json.loads(json.dumps(start))
        stop["operationMethod"] = {
            "actionEnum": "stopRecordScreen",
            "operationParam": {},
        }
        case["operationLog"]["steps"].append(stop)

        normalized = solopi_ai.normalize_case(case)
        steps = json.loads(normalized["operationLog"])["steps"]
        self.assertEqual("OTHER_GLOBAL", steps[0]["operationMethod"]["actionEnum"])
        self.assertEqual(
            "startRecordScreen",
            steps[0]["operationMethod"]["operationParam"]["targetAction"],
        )

        start["operationMethod"]["operationParam"].pop("INTENT_FRAME_RATE")
        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.normalize_case(case)
        self.assertIn("INTENT_FRAME_RATE", error.exception.details["missingParams"])

    def test_apps_and_app_info_use_harness_queries(self):
        seen = []

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def query(self, query_type):
                seen.append(query_type)
                return {"success": True, "type": query_type}

        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()):
            apps, apps_exit = solopi_ai.dispatch(
                solopi_ai.build_parser().parse_args(["apps"]), mock.Mock()
            )
            info, info_exit = solopi_ai.dispatch(
                solopi_ai.build_parser().parse_args(["app-info"]), mock.Mock()
            )

        self.assertEqual(["apps", "info"], seen)
        self.assertEqual((0, 0), (apps_exit, info_exit))
        self.assertEqual("apps", apps["type"])
        self.assertEqual("info", info["type"])

    def test_app_status_uses_general_status_resolver(self):
        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def resolver_get(self, action, params):
                self.action = action
                self.params = params
                return {"status": "recording"}

        session = FakeSession()
        args = solopi_ai.build_parser().parse_args(["app-status"])
        with mock.patch.object(solopi_ai, "session_from_args", return_value=session):
            result, exit_code = solopi_ai.command_app_status(args, mock.Mock())

        self.assertEqual(0, exit_code)
        self.assertTrue(result["success"])
        self.assertEqual("status", session.action)
        self.assertEqual({"type": "status"}, session.params)

    def test_perf_current_validates_and_returns_sampled_values(self):
        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def performance(self, mode, timeout=None):
                self.mode = mode
                return {
                    "success": True,
                    "state": "recording",
                    "active": True,
                    "terminal": False,
                    "recording": True,
                    "sessionId": "perf-1",
                    "sampledAt": 123456,
                    "values": {"CPU": "20%", "Battery": "80%"},
                }

        session = FakeSession()
        args = solopi_ai.build_parser().parse_args(["perf-current"])
        with mock.patch.object(solopi_ai, "session_from_args", return_value=session):
            result, exit_code = solopi_ai.command_perf_current(args, mock.Mock())

        self.assertEqual(0, exit_code)
        self.assertEqual("current", session.mode)
        self.assertEqual("80%", result["values"]["Battery"])

    def test_config_set_checks_writable_and_verifies_typed_value(self):
        args = solopi_ai.build_parser().parse_args(
            ["config-set", "--key", "KEY_REPLAY_AUTO_START", "--value", "TRUE"]
        )

        class FakeSession:
            request_timeout = 5

            def __init__(self):
                self.responses = [
                    {
                        "success": True,
                        "config": {
                            "key": "KEY_REPLAY_AUTO_START",
                            "type": "boolean",
                            "writable": True,
                            "value": False,
                        },
                    },
                    {
                        "success": True,
                        "config": {
                            "key": "KEY_REPLAY_AUTO_START",
                            "type": "boolean",
                            "writable": True,
                            "value": True,
                        },
                    },
                ]

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def config(self, action, key=None, timeout=None):
                self.last_call = (action, key, timeout)
                return self.responses.pop(0)

        adb = mock.Mock()
        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()):
            result, exit_code = solopi_ai.command_config_set(args, adb)

        self.assertEqual(0, exit_code)
        self.assertTrue(result["config"]["value"])
        adb.invoke_scheme.assert_called_once_with(
            "config",
            {"action": "set", "key": "KEY_REPLAY_AUTO_START", "value": "TRUE"},
        )

    def test_config_get_accepts_only_fully_redacted_sensitive_value(self):
        args = solopi_ai.build_parser().parse_args(
            ["config-get", "--key", "KEY_AES_KEY"]
        )

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def config(self, action, key=None, timeout=None):
                return {
                    "success": True,
                    "config": {
                        "key": "KEY_AES_KEY",
                        "type": "string",
                        "writable": False,
                        "sensitive": True,
                        "redacted": True,
                    },
                }

        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()):
            result, exit_code = solopi_ai.command_config_get(args, mock.Mock())

        self.assertEqual(0, exit_code)
        self.assertTrue(result["config"]["redacted"])
        self.assertNotIn("value", result["config"])

    def test_config_get_rejects_unredacted_sensitive_value(self):
        for config in (
            {
                "key": "KEY_AES_KEY",
                "type": "string",
                "sensitive": True,
                "redacted": False,
                "value": "secret",
            },
            {
                "key": "KEY_GLOBAL_SETTINGS",
                "type": "json",
                "sensitive": False,
                "redacted": True,
            },
        ):
            with self.subTest(config=config):
                with self.assertRaises(solopi_ai.CliError) as raised:
                    solopi_ai.validate_config_response(
                        {"success": True, "config": config}, config["key"]
                    )
                self.assertEqual(4, raised.exception.exit_code)

    def test_config_set_rejects_ui_migration_and_control_port(self):
        def run(key, writable, sensitive=False):
            args = solopi_ai.build_parser().parse_args(
                ["config-set", "--key", key, "--value", "value"]
            )

            class FakeSession:
                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, traceback):
                    return None

                def config(self, action, query_key=None, timeout=None):
                    return {
                        "success": True,
                        "config": {
                            "key": key,
                            "type": "string" if key != "KEY_CONTROL_PORT" else "int",
                            "writable": writable,
                            "sensitive": sensitive,
                            "redacted": sensitive,
                            **({} if sensitive else {"value": "old"}),
                        },
                    }

            adb = mock.Mock()
            with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()):
                result, exit_code = solopi_ai.command_config_set(args, adb)
            adb.invoke_scheme.assert_not_called()
            return result, exit_code

        migration, migration_exit = run("KEY_AES_KEY", False, True)
        port, port_exit = run("KEY_CONTROL_PORT", False)

        self.assertEqual(2, migration_exit)
        self.assertEqual("sensitive_config_ui_required", migration["errorCode"])
        self.assertEqual(2, port_exit)
        self.assertEqual("new_session_required", port["errorCode"])

    def test_config_set_never_writes_upload_patch_or_adb_targets(self):
        for key in (
            "KEY_PERFORMANCE_UPLOAD",
            "KEY_RECORD_SCREEN_UPLOAD",
            "KEY_PATCH_URL",
            "KEY_ADB_SERVER",
        ):
            with self.subTest(key=key):
                args = solopi_ai.build_parser().parse_args(
                    ["config-set", "--key", key, "--value", "https://example.invalid"]
                )
                adb = mock.Mock()
                with mock.patch.object(solopi_ai, "session_from_args") as session:
                    result, exit_code = solopi_ai.command_config_set(args, adb)

                self.assertEqual(2, exit_code)
                self.assertFalse(result["success"])
                self.assertEqual("ui_confirmation_required", result["errorCode"])
                session.assert_not_called()
                adb.invoke_scheme.assert_not_called()

        config_source = (
            REPO_ROOT
            / "solopi-app/app/src/main/java/com/alipay/hulu/scheme/ConfigSchemeResolver.java"
        ).read_text(encoding="utf-8")
        for key in solopi_ai.CLI_UI_ONLY_CONFIG_REASONS:
            self.assertRegex(
                config_source,
                rf"add\(result, {key}, [^\n]+, false, null, null\);",
            )

    def test_case_delete_waits_for_matching_receipt(self):
        args = solopi_ai.build_parser().parse_args(["case-delete", "--case", "smoke"])

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def query(self, query_type, params=None):
                self.query_type = query_type
                return {
                    "success": True,
                    "requestId": params["requestId"],
                    "caseName": "smoke",
                    "deleted": 1,
                }

        adb = mock.Mock()
        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()), mock.patch.object(
            solopi_ai.uuid, "uuid4", return_value="delete-1"
        ):
            result, exit_code = solopi_ai.command_case_delete(args, adb)

        self.assertEqual(0, exit_code)
        self.assertEqual("delete-1", result["requestId"])
        adb.invoke_scheme.assert_called_once_with(
            "harness",
            {
                "type": "case-delete",
                "caseName": "smoke",
                "confirmCaseName": "smoke",
                "requestId": "delete-1",
            },
        )

    def test_record_start_waits_for_owned_recording_session(self):
        args = solopi_ai.build_parser().parse_args(
            [
                "record-start",
                "--name",
                "smoke",
                "--target-package",
                "com.example",
                "--description",
                "case description",
            ]
        )

        statuses = [self.record_status("idle", session_id=None), self.record_status("recording")]

        class FakeSession:
            request_timeout = 5

            def __init__(self):
                self.statuses = list(statuses)

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def record(self, mode, timeout=None):
                return self.statuses.pop(0)

        adb = mock.Mock()
        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()), mock.patch.object(
            solopi_ai.uuid, "uuid4", return_value="record-1"
        ):
            result, exit_code = solopi_ai.command_record_start(args, adb)

        self.assertEqual(0, exit_code)
        self.assertEqual("record-1", result["sessionId"])
        adb.invoke_scheme.assert_called_once_with(
            "record",
            {
                "recordMode": "normal",
                "targetApp": "com.example",
                "caseName": "smoke",
                "sessionId": "record-1",
                "caseDesc": "case description",
            },
        )

    def test_record_status_and_stop_enforce_session_ownership(self):
        status_args = solopi_ai.build_parser().parse_args(
            ["record-status", "--session-id", "expected"]
        )

        mismatched_status = self.record_status("recording", session_id="other")

        class MismatchSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def record(self, mode, timeout=None):
                return mismatched_status

        with mock.patch.object(solopi_ai, "session_from_args", return_value=MismatchSession()):
            mismatch, mismatch_exit = solopi_ai.command_record_status(status_args, mock.Mock())

        self.assertEqual(2, mismatch_exit)
        self.assertEqual("expected", mismatch["expectedSessionId"])

        stop_args = solopi_ai.build_parser().parse_args(
            ["record-stop", "--session-id", "record-1"]
        )

        stop_statuses = [self.record_status("recording"), self.record_status("stopped")]

        class StopSession:
            request_timeout = 5

            def __init__(self):
                self.statuses = list(stop_statuses)

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def record(self, mode, timeout=None):
                return self.statuses.pop(0)

        adb = mock.Mock()
        with mock.patch.object(solopi_ai, "session_from_args", return_value=StopSession()):
            stopped, stopped_exit = solopi_ai.command_record_stop(stop_args, adb)

        self.assertEqual(0, stopped_exit)
        self.assertEqual("stopped", stopped["state"])
        adb.invoke_scheme.assert_called_once_with(
            "record", {"recordMode": "stop", "sessionId": "record-1"}
        )

    def test_stress_request_enforces_pair_and_device_limits(self):
        adb = mock.Mock()
        adb.processor_count.return_value = 8
        cases = [
            (["stress-start", "--cpu-count", "2"], "同时提供"),
            (
                ["stress-start", "--cpu-count", "9", "--cpu-percent", "50"],
                "设备限制",
            ),
            (["stress-start", "--memory", "2049"], "安全限制"),
            (["stress-start", "--memory", "1", "--duration", "3601"], "安全限制"),
        ]
        for argv, message in cases:
            with self.subTest(argv=argv), self.assertRaises(solopi_ai.CliError) as error:
                solopi_ai.validate_stress_request(solopi_ai.build_parser().parse_args(argv), adb)
            self.assertIn(message, str(error.exception))

    def test_stress_start_passes_bounds_duration_and_session_id(self):
        args = solopi_ai.build_parser().parse_args(
            [
                "stress-start",
                "--cpu-count",
                "2",
                "--cpu-percent",
                "50",
                "--memory",
                "128",
                "--duration",
                "90",
            ]
        )

        def stress_status(state, active, terminal, session_id, **extra):
            payload = {
                "success": True,
                "state": state,
                "active": active,
                "terminal": terminal,
                "sessionId": session_id,
                "cpuCount": 0,
                "cpuPercent": 0,
                "memory": 0,
                "durationSec": 0,
                "error": None,
            }
            payload.update(extra)
            return payload

        class FakeSession:
            request_timeout = 5

            def __init__(self):
                self.statuses = [
                    stress_status("idle", False, False, None),
                    stress_status(
                        "running",
                        True,
                        False,
                        "stress-1",
                        cpuCount=2,
                        cpuPercent=50,
                        memory=128,
                        durationSec=90,
                    ),
                ]

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def stress(self, action, timeout=None):
                return self.statuses.pop(0)

        adb = mock.Mock()
        adb.processor_count.return_value = 8
        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()), mock.patch.object(
            solopi_ai.uuid, "uuid4", return_value="stress-1"
        ):
            result, exit_code = solopi_ai.command_stress_start(args, adb)

        self.assertEqual(0, exit_code)
        self.assertEqual("running", result["state"])
        adb.invoke_scheme.assert_called_once_with(
            "stress",
            {
                "action": "start",
                "sessionId": "stress-1",
                "cpuCount": "2",
                "cpuPercent": "50",
                "memory": "128",
                "durationSec": "90",
            },
        )

    def test_stress_stop_waits_for_owned_terminal_state(self):
        args = solopi_ai.build_parser().parse_args(
            ["stress-stop", "--session-id", "stress-1"]
        )

        class FakeSession:
            request_timeout = 5

            def __init__(self):
                self.statuses = [
                    {
                        "success": True,
                        "state": "running",
                        "active": True,
                        "terminal": False,
                        "sessionId": "stress-1",
                        "cpuCount": 2,
                        "cpuPercent": 50,
                        "memory": 0,
                        "durationSec": 60,
                        "error": None,
                    },
                    {
                        "success": True,
                        "state": "stopped",
                        "active": False,
                        "terminal": True,
                        "sessionId": "stress-1",
                        "cpuCount": 2,
                        "cpuPercent": 50,
                        "memory": 0,
                        "durationSec": 60,
                        "error": None,
                    },
                ]

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def stress(self, action, timeout=None):
                return self.statuses.pop(0)

        adb = mock.Mock()
        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()):
            result, exit_code = solopi_ai.command_stress_stop(args, adb)

        self.assertEqual(0, exit_code)
        self.assertEqual("stopped", result["state"])
        adb.invoke_scheme.assert_called_once_with(
            "stress", {"action": "stop", "sessionId": "stress-1"}
        )

    def test_run_repeat_assigns_batch_and_unique_artifact_directories(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            args = solopi_ai.build_parser().parse_args(
                [
                    "run-repeat",
                    "--case",
                    "payment / smoke",
                    "--times",
                    "2",
                    "--artifacts",
                    temporary_dir,
                ]
            )
            child_artifacts = []

            def fake_run(child_args, adb):
                child_artifacts.append(child_args.artifacts)
                return {
                    "success": True,
                    "state": "passed",
                    "runId": "run-%d" % len(child_artifacts),
                }, 0

            with mock.patch.object(solopi_ai.uuid, "uuid4", return_value="batch-1"), mock.patch.object(
                solopi_ai, "command_run", side_effect=fake_run
            ):
                result, exit_code = solopi_ai.command_run_repeat(args, mock.Mock())

        self.assertEqual(0, exit_code)
        self.assertEqual("batch-1", result["batchId"])
        self.assertEqual(2, result["completedRuns"])
        self.assertNotEqual(child_artifacts[0], child_artifacts[1])
        self.assertIn("batch-batch-1", child_artifacts[0])
        self.assertTrue(child_artifacts[0].endswith("001-payment-smoke"))
        self.assertTrue(child_artifacts[1].endswith("002-payment-smoke"))

    def test_run_sequences_forward_target_override_and_restart_policy(self):
        commands = (
            [
                "run-repeat",
                "--case",
                "smoke",
                "--times",
                "2",
                "--target-package",
                "com.example.override",
                "--restart-app",
            ],
            [
                "run-batch",
                "--case",
                "one",
                "--case",
                "two",
                "--target-package",
                "com.example.override",
                "--restart-app",
            ],
        )
        for argv in commands:
            forwarded = []

            def fake_run(child_args, adb):
                forwarded.append(
                    (child_args.case, child_args.target_package, child_args.restart_app)
                )
                return {"success": True, "state": "passed", "runId": child_args.case}, 0

            args = solopi_ai.build_parser().parse_args(argv)
            with self.subTest(command=argv[0]), mock.patch.object(
                solopi_ai.uuid, "uuid4", return_value="batch-options"
            ), mock.patch.object(solopi_ai, "command_run", side_effect=fake_run):
                result, exit_code = solopi_ai.dispatch(args, mock.Mock())

            self.assertEqual(0, exit_code)
            self.assertTrue(result["success"])
            self.assertEqual(2, len(forwarded))
            self.assertTrue(all(item[1:] == ("com.example.override", True) for item in forwarded))

    def test_run_batch_stops_or_continues_after_exact_child_failure(self):
        def run(continue_on_failure):
            argv = ["run-batch", "--case", "one", "--case", "two"]
            if continue_on_failure:
                argv.append("--continue-on-failure")
            args = solopi_ai.build_parser().parse_args(argv)
            calls = []

            def fake_run(child_args, adb):
                calls.append(child_args.case)
                if child_args.case == "one":
                    return {"success": False, "state": "failed", "runId": "run-1"}, 2
                return {"success": True, "state": "passed", "runId": "run-2"}, 0

            with mock.patch.object(solopi_ai.uuid, "uuid4", return_value="batch-2"), mock.patch.object(
                solopi_ai, "command_run", side_effect=fake_run
            ):
                result, exit_code = solopi_ai.command_run_batch(args, mock.Mock())
            return result, exit_code, calls

        stopped, stopped_exit, stopped_calls = run(False)
        continued, continued_exit, continued_calls = run(True)

        self.assertEqual(2, stopped_exit)
        self.assertEqual(["one"], stopped_calls)
        self.assertTrue(stopped["stoppedEarly"])
        self.assertEqual(2, continued_exit)
        self.assertEqual(["one", "two"], continued_calls)
        self.assertFalse(continued["stoppedEarly"])
        self.assertEqual("run-2", continued["results"][1]["run"]["runId"])

    def test_action_catalog_matches_perform_action_method_maps(self):
        result, _ = solopi_ai.command_actions(mock.Mock(), mock.Mock())
        actions = {item["actionEnum"]: item for item in result["enumActions"]}

        for action in (
            "SCROLL_TO_BOTTOM",
            "SCROLL_TO_TOP",
            "SCROLL_TO_RIGHT",
            "SCROLL_TO_LEFT",
        ):
            self.assertEqual(["text"], actions[action]["requiredParams"])
        self.assertEqual(
            ["allocKey", "allocType", "allocValue"],
            actions["LET"]["requiredParams"],
        )
        self.assertEqual(actions["LET"]["requiredParams"], actions["LET_NODE"]["requiredParams"])
        self.assertEqual(["appUrl"], actions["LOAD_PARAM"]["requiredParams"])
        self.assertEqual(["descriptorMode"], actions["CHANGE_MODE"]["requiredParams"])
        for action in ("CHECK", "CHECK_NODE", "IF", "WHILE"):
            self.assertEqual(["check"], actions[action]["requiredParams"])
        self.assertEqual(["text"], actions["CLICK_AND_INPUT"]["requiredParams"])
        self.assertEqual(["text"], actions["KEYBOARD_INPUT"]["requiredParams"])

    def test_case_validate_enforces_perform_action_method_maps(self):
        cases = [
            ("clickAndInput", {"resourceId": "input"}, ["text"]),
            ("keyboardInput", None, ["text"]),
            ("scrollToBottom", {"resourceId": "list"}, ["text"]),
            ("let", None, ["allocKey", "allocType", "allocValue"]),
            ("letNode", {"resourceId": "value"}, ["allocKey", "allocType", "allocValue"]),
            ("load", None, ["appUrl"]),
            ("changeMode", None, ["descriptorMode"]),
            ("check", None, ["check"]),
            ("checkNode", {"resourceId": "value"}, ["check"]),
            ("if", None, ["check"]),
            ("while", None, ["check"]),
        ]
        for action, node, missing in cases:
            case = self.sample_case(action=action, operation_node=node)
            case["operationLog"]["steps"][0]["operationMethod"]["operationParam"] = {}
            with self.subTest(action=action), self.assertRaises(solopi_ai.CliError) as error:
                solopi_ai.normalize_case(case)
            self.assertEqual(missing, error.exception.details["missingParams"])

    def test_parser_exposes_six_history_commands_with_bounded_defaults(self):
        for prefix in ("replay", "perf"):
            listed = solopi_ai.build_parser().parse_args([prefix + "-history-list"])
            self.assertEqual(100, listed.limit)
            got = solopi_ai.build_parser().parse_args(
                [prefix + "-history-get", "--id", prefix + "-id"]
            )
            deleted = solopi_ai.build_parser().parse_args(
                [prefix + "-history-delete", "--id", prefix + "-id"]
            )
            self.assertEqual(prefix + "-id", got.id)
            self.assertEqual(30, deleted.delete_timeout)

    def test_history_list_validates_limit_and_response_contract(self):
        replay_id = "replay-" + "a" * 64
        args = solopi_ai.build_parser().parse_args(
            ["replay-history-list", "--limit", "1"]
        )

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def history(self, action, params=None, timeout=None):
                self.call = (action, params)
                return {
                    "success": True,
                    "kind": "replay",
                    "records": [{"id": replay_id, "kind": "replay"}],
                    "total": 2,
                    "returned": 1,
                    "truncated": True,
                }

        session = FakeSession()
        with mock.patch.object(solopi_ai, "session_from_args", return_value=session):
            result, exit_code = solopi_ai.command_history_list(args, mock.Mock(), "replay")

        self.assertEqual(0, exit_code)
        self.assertTrue(result["truncated"])
        self.assertEqual(("listReplay", {"limit": "1"}), session.call)
        for invalid_limit in (0, 501):
            invalid = solopi_ai.build_parser().parse_args(
                ["replay-history-list", "--limit", str(invalid_limit)]
            )
            with self.assertRaises(solopi_ai.CliError) as error:
                solopi_ai.command_history_list(invalid, mock.Mock(), "replay")
            self.assertEqual(3, error.exception.exit_code)

    def test_history_list_rejects_inconsistent_server_counts(self):
        args = solopi_ai.build_parser().parse_args(["perf-history-list"])

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def history(self, action, params=None, timeout=None):
                return {
                    "success": True,
                    "kind": "performance",
                    "records": [],
                    "total": 1,
                    "returned": 1,
                    "truncated": False,
                }

        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()), self.assertRaises(
            solopi_ai.CliError
        ) as error:
            solopi_ai.command_history_list(args, mock.Mock(), "performance")
        self.assertEqual(4, error.exception.exit_code)

    def test_history_get_uses_opaque_id_and_rejects_paths(self):
        replay_id = "replay-" + "b" * 64
        args = solopi_ai.build_parser().parse_args(
            ["replay-history-get", "--id", replay_id]
        )

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def history(self, action, params=None, timeout=None):
                self.call = (action, params)
                return {"success": True, "kind": "replay", "id": replay_id, "files": []}

        session = FakeSession()
        with mock.patch.object(solopi_ai, "session_from_args", return_value=session):
            result, exit_code = solopi_ai.command_history_get(args, mock.Mock(), "replay")

        self.assertEqual(0, exit_code)
        self.assertEqual(replay_id, result["id"])
        self.assertEqual(("getReplay", {"id": replay_id}), session.call)

        path_args = solopi_ai.build_parser().parse_args(
            ["replay-history-get", "--id", "/sdcard/solopi/replay/item"]
        )
        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.command_history_get(path_args, mock.Mock(), "replay")
        self.assertEqual(3, error.exception.exit_code)

    def test_history_delete_uses_confirmation_and_exact_receipt(self):
        performance_id = "performance-" + "c" * 64
        args = solopi_ai.build_parser().parse_args(
            [
                "perf-history-delete",
                "--id",
                performance_id,
                "--poll-interval",
                "0.001",
            ]
        )

        class FakeSession:
            request_timeout = 5

            def __init__(self):
                self.responses = [
                    {
                        "success": False,
                        "errorCode": "receipt_not_found",
                        "error": "not ready",
                    },
                    {
                        "success": True,
                        "requestId": "delete-history-1",
                        "state": "completed",
                        "mutation": {
                            "success": True,
                            "requestId": "delete-history-1",
                            "action": "deletePerformance",
                            "kind": "performance",
                            "id": performance_id,
                            "state": "completed",
                            "deleted": True,
                            "deletedFiles": 2,
                        },
                    },
                ]

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def history(self, action, params=None, timeout=None):
                self.calls = getattr(self, "calls", []) + [(action, params)]
                return self.responses.pop(0)

        session = FakeSession()
        adb = mock.Mock()
        with mock.patch.object(solopi_ai, "session_from_args", return_value=session), mock.patch.object(
            solopi_ai.uuid, "uuid4", return_value="delete-history-1"
        ):
            result, exit_code = solopi_ai.command_history_delete(
                args, adb, "performance"
            )

        self.assertEqual(0, exit_code)
        self.assertTrue(result["mutation"]["deleted"])
        adb.invoke_scheme.assert_called_once_with(
            "history",
            {
                "action": "deletePerformance",
                "requestId": "delete-history-1",
                "id": performance_id,
                "confirmId": performance_id,
            },
        )
        self.assertEqual(2, len(session.calls))
        self.assertTrue(all(call[1] == {"requestId": "delete-history-1"} for call in session.calls))

    def test_history_delete_returns_strict_failed_receipt(self):
        replay_id = "replay-" + "d" * 64
        args = solopi_ai.build_parser().parse_args(
            ["replay-history-delete", "--id", replay_id]
        )

        class FakeSession:
            request_timeout = 5

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def history(self, action, params=None, timeout=None):
                return {
                    "success": True,
                    "requestId": "delete-history-2",
                    "state": "failed",
                    "mutation": {
                        "success": False,
                        "requestId": "delete-history-2",
                        "action": "deleteReplay",
                        "kind": "replay",
                        "id": replay_id,
                        "state": "failed",
                        "deleted": False,
                        "errorCode": "replay_active",
                        "error": "active",
                    },
                }

        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()), mock.patch.object(
            solopi_ai.uuid, "uuid4", return_value="delete-history-2"
        ):
            result, exit_code = solopi_ai.command_history_delete(
                args, mock.Mock(), "replay"
            )

        self.assertEqual(2, exit_code)
        self.assertEqual("replay_active", result["mutation"]["errorCode"])

    def test_parser_exposes_plugin_commands_with_bounded_defaults(self):
        listed = solopi_ai.build_parser().parse_args(["plugin-list"])
        installed = solopi_ai.build_parser().parse_args(
            ["plugin-install", "--file", "sample.zip"]
        )
        removed = solopi_ai.build_parser().parse_args(
            ["plugin-remove", "--id", "plugin-" + "a" * 64]
        )

        self.assertEqual("plugin-list", listed.command)
        self.assertEqual("sample.zip", installed.file)
        self.assertEqual(120, installed.install_timeout)
        self.assertEqual(0.5, installed.poll_interval)
        self.assertEqual(30, removed.remove_timeout)
        self.assertEqual(0.5, removed.poll_interval)

    def test_plugin_list_validates_and_exposes_canonical_import_path(self):
        payload = self.plugin_list_payload(plugins=[self.plugin_summary()])

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def plugin(self, action, params=None, timeout=None):
                self.call = (action, params, timeout)
                return payload

        session = FakeSession()
        args = solopi_ai.build_parser().parse_args(["plugin-list"])
        with mock.patch.object(solopi_ai, "session_from_args", return_value=session):
            result, exit_code = solopi_ai.command_plugin_list(args, mock.Mock())

        self.assertEqual(0, exit_code)
        self.assertEqual("/sdcard/solopi/patch", result["importPath"])
        self.assertTrue(result["pathAvailable"])
        self.assertEqual(("list", None, None), session.call)

        unsafe = self.plugin_list_payload(import_path="/sdcard/solopi/../patch")
        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.validate_plugin_list(unsafe)
        self.assertEqual(4, error.exception.exit_code)

    def test_plugin_archive_requires_regular_bounded_zip(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            destination = root / "snapshot.zip"

            invalid = root / "invalid.zip"
            invalid.write_text("not a zip", encoding="utf-8")
            with self.assertRaises(solopi_ai.CliError):
                solopi_ai.snapshot_plugin_archive(str(invalid), destination)

            source = root / "source.zip"
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("desc.json", "{}")
            link = root / "linked.zip"
            link.symlink_to(source)
            with self.assertRaises(solopi_ai.CliError) as symlink_error:
                solopi_ai.snapshot_plugin_archive(str(link), destination)
            self.assertIn("符号链接", str(symlink_error.exception))

            oversized = root / "oversized.zip"
            with oversized.open("wb") as stream:
                stream.truncate(solopi_ai.PLUGIN_MAX_ARCHIVE_BYTES + 1)
            with self.assertRaises(solopi_ai.CliError) as size_error:
                solopi_ai.snapshot_plugin_archive(str(oversized), destination)
            self.assertEqual(3, size_error.exception.exit_code)

    def test_plugin_cleanup_whitelist_deletes_only_exact_generated_child(self):
        runner = mock.Mock()
        runner.run.return_value = solopi_ai.CommandResult(0)
        adb = solopi_ai.AdbClient(runner=runner)
        adb.device = {"serial": "device-1", "state": "device"}
        import_path = "/sdcard/solopi/patch"
        file_name = "solopi-plugin-%s.zip" % ("b" * 32)

        with self.assertRaises(solopi_ai.CliError):
            adb._remove_whitelisted_plugin_import(import_path, file_name)
        runner.run.assert_not_called()

        with tempfile.TemporaryDirectory() as temporary_dir:
            local_file = Path(temporary_dir) / "plugin.zip"
            local_file.write_bytes(b"zip")
            adb._push_plugin_import(local_file, import_path, file_name)
            evidence = adb._remove_whitelisted_plugin_import(import_path, file_name)

        self.assertTrue(evidence["success"])
        self.assertTrue(evidence["removed"])
        commands = [call.args[0] for call in runner.run.call_args_list]
        remote_file = import_path + "/" + file_name
        self.assertEqual(
            ["adb", "-s", "device-1", "push", str(local_file), remote_file],
            commands[0],
        )
        self.assertEqual(
            ["adb", "-s", "device-1", "shell", "rm -f -- " + remote_file],
            commands[1],
        )
        self.assertEqual(
            ["adb", "-s", "device-1", "shell", "test '!' -e " + remote_file],
            commands[2],
        )
        with self.assertRaises(solopi_ai.CliError):
            adb._remove_whitelisted_plugin_import(import_path, file_name)

    def test_plugin_install_hashes_pushes_enumerates_and_cleans_exact_file(self):
        request_id = "install-request-1"
        generated_name = solopi_ai.generated_plugin_file_name(request_id)
        source_file_id = "plugin-import-" + "b" * 64

        with tempfile.TemporaryDirectory() as temporary_dir:
            plugin_file = Path(temporary_dir) / "sample.zip"
            with zipfile.ZipFile(plugin_file, "w") as archive:
                archive.writestr("desc.json", '{"name":"sample_plugin"}')
            package_bytes = plugin_file.read_bytes()
            expected_sha256 = hashlib.sha256(package_bytes).hexdigest()
            expected_size = len(package_bytes)

            completed = {
                "success": True,
                "requestId": request_id,
                "state": "completed_restart_required",
                "mutation": {
                    "success": True,
                    "accepted": True,
                    "requestId": request_id,
                    "action": "import",
                    "subject": source_file_id + ":" + expected_sha256,
                    "state": "completed_restart_required",
                    "requestedAt": 10,
                    "completedAt": 11,
                    "plugin": self.plugin_summary(),
                    "sha256": expected_sha256,
                    "sizeBytes": expected_size,
                    "sourceFileId": source_file_id,
                    "sourceFileRetained": True,
                    "restartRequired": True,
                    "activation": "restart_required_for_full_activation",
                },
            }

            class FakeSession:
                request_timeout = 5

                def __init__(self, owner):
                    self.responses = [
                        owner.plugin_list_payload(),
                        owner.plugin_list_payload(
                            import_files=[
                                {
                                    "fileId": source_file_id,
                                    "fileName": generated_name,
                                    "sizeBytes": expected_size,
                                    "modifiedAt": 12,
                                    "sha256Required": True,
                                }
                            ]
                        ),
                        {
                            "success": False,
                            "errorCode": "receipt_not_found",
                            "error": "not ready",
                        },
                        completed,
                    ]
                    self.calls = []

                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, traceback):
                    return None

                def plugin(self, action, params=None, timeout=None):
                    self.calls.append((action, params))
                    return self.responses.pop(0)

            session = FakeSession(self)
            cleanup = {
                "attempted": True,
                "success": True,
                "removed": True,
                "fileName": generated_name,
            }
            adb = mock.Mock()
            adb._remove_whitelisted_plugin_import.return_value = cleanup
            args = solopi_ai.build_parser().parse_args(
                ["plugin-install", "--file", str(plugin_file), "--poll-interval", "0.001"]
            )
            with mock.patch.object(solopi_ai, "session_from_args", return_value=session), mock.patch.object(
                solopi_ai.uuid, "uuid4", return_value=request_id
            ):
                result, exit_code = solopi_ai.command_plugin_install(args, adb)

        self.assertEqual(0, exit_code)
        self.assertEqual("completed_restart_required", result["state"])
        self.assertEqual(cleanup, result["cleanup"])
        pushed = adb._push_plugin_import.call_args.args
        self.assertEqual("/sdcard/solopi/patch", pushed[1])
        self.assertEqual(generated_name, pushed[2])
        adb.invoke_scheme.assert_called_once_with(
            "plugin",
            {
                "action": "import",
                "requestId": request_id,
                "sha256": expected_sha256,
                "fileId": source_file_id,
            },
        )
        adb._remove_whitelisted_plugin_import.assert_called_once_with(
            "/sdcard/solopi/patch", generated_name
        )
        self.assertEqual(["list", "list", "mutationStatus", "mutationStatus"], [call[0] for call in session.calls])

    def test_plugin_install_timeout_retains_remote_file_and_reports_cleanup(self):
        request_id = "install-timeout-1"
        generated_name = solopi_ai.generated_plugin_file_name(request_id)
        source_file_id = "plugin-import-" + "c" * 64
        with tempfile.TemporaryDirectory() as temporary_dir:
            plugin_file = Path(temporary_dir) / "sample.zip"
            with zipfile.ZipFile(plugin_file, "w") as archive:
                archive.writestr("desc.json", "{}")
            size_bytes = plugin_file.stat().st_size

            class FakeSession:
                request_timeout = 5

                def __init__(self, owner):
                    self.responses = [
                        owner.plugin_list_payload(),
                        owner.plugin_list_payload(
                            import_files=[
                                {
                                    "fileId": source_file_id,
                                    "fileName": generated_name,
                                    "sizeBytes": size_bytes,
                                    "modifiedAt": 1,
                                    "sha256Required": True,
                                }
                            ]
                        ),
                    ]

                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, traceback):
                    return None

                def plugin(self, action, params=None, timeout=None):
                    return self.responses.pop(0)

            adb = mock.Mock()
            args = solopi_ai.build_parser().parse_args(
                ["plugin-install", "--file", str(plugin_file)]
            )
            timeout = solopi_ai.CliError("timed out", 124)
            with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession(self)), mock.patch.object(
                solopi_ai.uuid, "uuid4", return_value=request_id
            ), mock.patch.object(solopi_ai, "wait_for_plugin_mutation", side_effect=timeout):
                with self.assertRaises(solopi_ai.CliError) as error:
                    solopi_ai.command_plugin_install(args, adb)

        self.assertEqual(124, error.exception.exit_code)
        self.assertEqual("mutation_not_terminal", error.exception.details["cleanup"]["reason"])
        adb._remove_whitelisted_plugin_import.assert_not_called()

    def test_plugin_remove_uses_stable_id_confirmation_and_exact_receipt(self):
        stable_id = "plugin-" + "d" * 64
        request_id = "remove-plugin-1"
        receipt = {
            "success": True,
            "requestId": request_id,
            "state": "completed_restart_required",
            "mutation": {
                "success": True,
                "accepted": True,
                "requestId": request_id,
                "action": "remove",
                "subject": stable_id,
                "state": "completed_restart_required",
                "requestedAt": 20,
                "completedAt": 21,
                "pluginId": stable_id,
                "name": "sample_plugin",
                "version": 2.0,
                "removedFromRegistry": True,
                "filesRetained": True,
                "restartRequired": True,
                "runtimeEffect": "restart_required_for_full_removal",
            },
        }

        class FakeSession:
            request_timeout = 5

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def plugin(self, action, params=None, timeout=None):
                self.call = (action, params)
                return receipt

        args = solopi_ai.build_parser().parse_args(
            ["plugin-remove", "--id", stable_id]
        )
        adb = mock.Mock()
        session = FakeSession()
        with mock.patch.object(solopi_ai, "session_from_args", return_value=session), mock.patch.object(
            solopi_ai.uuid, "uuid4", return_value=request_id
        ):
            result, exit_code = solopi_ai.command_plugin_remove(args, adb)

        self.assertEqual(0, exit_code)
        self.assertEqual("completed_restart_required", result["state"])
        adb.invoke_scheme.assert_called_once_with(
            "plugin",
            {
                "action": "remove",
                "requestId": request_id,
                "pluginId": stable_id,
                "confirmId": stable_id,
            },
        )
        self.assertEqual(("mutationStatus", {"requestId": request_id}), session.call)

        invalid = solopi_ai.build_parser().parse_args(
            ["plugin-remove", "--id", "/sdcard/solopi/patch/plugin.zip"]
        )
        with self.assertRaises(solopi_ai.CliError) as invalid_error:
            solopi_ai.command_plugin_remove(invalid, adb)
        self.assertEqual(3, invalid_error.exception.exit_code)

    def test_plugin_mutation_rejects_mismatched_terminal_receipt(self):
        stable_id = "plugin-" + "e" * 64
        response = {
            "success": True,
            "requestId": "remove-2",
            "state": "completed_restart_required",
            "mutation": {
                "success": True,
                "accepted": True,
                "requestId": "remove-2",
                "action": "remove",
                "subject": stable_id,
                "state": "completed_restart_required",
                "requestedAt": 1,
                "completedAt": 2,
                "pluginId": "plugin-" + "f" * 64,
                "name": "wrong",
                "version": 1.0,
                "removedFromRegistry": True,
                "filesRetained": True,
                "restartRequired": True,
                "runtimeEffect": "restart_required_for_full_removal",
            },
        }
        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.validate_plugin_mutation_status(
                response,
                "remove-2",
                "remove",
                stable_id,
                expected_plugin_id=stable_id,
            )
        self.assertEqual(4, error.exception.exit_code)

    def test_parser_exposes_scan_commands_and_safe_defaults(self):
        status = solopi_ai.build_parser().parse_args(
            ["scan-status", "--session-id", "scan-1"]
        )
        start = solopi_ai.build_parser().parse_args(["scan-start"])
        cancel = solopi_ai.build_parser().parse_args(
            ["scan-cancel", "--session-id", "scan-1"]
        )

        self.assertEqual("scan-status", status.command)
        self.assertEqual("scan-1", status.session_id)
        self.assertEqual(30, start.ack_timeout)
        self.assertEqual(0.5, start.poll_interval)
        self.assertEqual(15, cancel.cancel_timeout)

    def test_scan_status_schema_never_accepts_executed_content(self):
        for state in (
            "idle",
            "starting",
            "pending-camera-permission",
            "scanning",
            "completed",
            "cancelled",
            "failed",
        ):
            with self.subTest(state=state):
                solopi_ai.validate_scan_status(self.scan_status(state))

        executed = self.scan_status("completed")
        executed["contentExecuted"] = True
        wrong_code_type = self.scan_status("completed")
        wrong_code_type["codeType"] = "CODE 128"
        premature_content = self.scan_status("scanning")
        premature_content["content"] = "https://example.test"
        overlapping_manual = self.scan_status("scanning", manual=True)
        overlapping_activities = self.scan_status("idle", manual=True)
        overlapping_activities["protocolActivityAttached"] = True
        missing_user_action = self.scan_status("pending-camera-permission")
        missing_user_action["requiredUserAction"] = None
        for payload in (
            executed,
            wrong_code_type,
            premature_content,
            overlapping_manual,
            overlapping_activities,
            missing_user_action,
        ):
            with self.subTest(payload=payload), self.assertRaises(solopi_ai.CliError):
                solopi_ai.validate_scan_status(payload)

    def test_scan_start_returns_user_action_and_exact_session(self):
        session_id = "scan-session-1"
        statuses = [
            self.scan_status("idle", session_id=None),
            self.scan_status("pending-camera-permission", session_id=session_id),
        ]

        class FakeSession:
            request_timeout = 5

            def __init__(self):
                self.statuses = list(statuses)

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def scan(self, timeout=None):
                return self.statuses.pop(0)

        adb = mock.Mock()
        args = solopi_ai.build_parser().parse_args(["scan-start"])
        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=FakeSession()
        ), mock.patch.object(solopi_ai.uuid, "uuid4", return_value=session_id):
            result, exit_code = solopi_ai.command_scan_start(args, adb)

        self.assertEqual(0, exit_code)
        self.assertEqual("pending-camera-permission", result["state"])
        self.assertTrue(result["userActionRequired"])
        self.assertFalse(result["contentExecuted"])
        adb.invoke_scheme.assert_called_once_with(
            "scan", {"action": "start", "sessionId": session_id}
        )

    def test_scan_start_timeout_cancels_only_the_created_session(self):
        session_id = "scan-timeout-1"
        before = self.scan_status("idle", session_id=None)
        starting = self.scan_status("starting", session_id=session_id)
        cancelled = self.scan_status("cancelled", session_id=session_id)

        class FakeSession:
            request_timeout = 5

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def scan(self, timeout=None):
                return before

        timeout = solopi_ai.CliError(
            "scan start timed out",
            124,
            sessionId=session_id,
            lastStatus=starting,
        )
        adb = mock.Mock()
        args = solopi_ai.build_parser().parse_args(["scan-start"])
        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=FakeSession()
        ), mock.patch.object(
            solopi_ai.uuid, "uuid4", return_value=session_id
        ), mock.patch.object(
            solopi_ai, "wait_for_scan_state", side_effect=[timeout, cancelled]
        ):
            with self.assertRaises(solopi_ai.CliError) as error:
                solopi_ai.command_scan_start(args, adb)

        self.assertEqual(124, error.exception.exit_code)
        self.assertTrue(error.exception.details["cleanup"]["success"])
        self.assertEqual(
            ["start", "cancel"],
            [call.args[1]["action"] for call in adb.invoke_scheme.call_args_list],
        )
        self.assertTrue(
            all(
                call.args[1]["sessionId"] == session_id
                for call in adb.invoke_scheme.call_args_list
            )
        )

    def test_scan_cancel_requires_exact_active_session(self):
        expected = "scan-owned-1"
        statuses = [
            self.scan_status("scanning", session_id=expected),
            self.scan_status("cancelled", session_id=expected),
        ]

        class FakeSession:
            request_timeout = 5

            def __init__(self, values):
                self.values = list(values)

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def scan(self, timeout=None):
                return self.values.pop(0)

        adb = mock.Mock()
        args = solopi_ai.build_parser().parse_args(
            ["scan-cancel", "--session-id", expected]
        )
        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=FakeSession(statuses)
        ):
            result, exit_code = solopi_ai.command_scan_cancel(args, adb)

        self.assertEqual(0, exit_code)
        self.assertEqual("cancelled", result["state"])
        adb.invoke_scheme.assert_called_once_with(
            "scan", {"action": "cancel", "sessionId": expected}
        )

        mismatched_adb = mock.Mock()
        with mock.patch.object(
            solopi_ai,
            "session_from_args",
            return_value=FakeSession(
                [self.scan_status("scanning", session_id="scan-other")]
            ),
        ):
            mismatch, mismatch_exit = solopi_ai.command_scan_cancel(args, mismatched_adb)
        self.assertEqual(2, mismatch_exit)
        self.assertEqual(expected, mismatch["expectedSessionId"])
        mismatched_adb.invoke_scheme.assert_not_called()

    def test_protocol_scan_returns_content_before_manual_execution_branches(self):
        activity_source = (
            REPO_ROOT
            / "solopi-app"
            / "app"
            / "src"
            / "main"
            / "java"
            / "com"
            / "alipay"
            / "hulu"
            / "activity"
            / "QRScanActivity.java"
        ).read_text(encoding="utf-8")
        resolver_source = (
            REPO_ROOT
            / "solopi-app"
            / "app"
            / "src"
            / "main"
            / "java"
            / "com"
            / "alipay"
            / "hulu"
            / "scheme"
            / "ScanSchemeResolver.java"
        ).read_text(encoding="utf-8")

        protocol_branch = activity_source.index("if (protocolSession) {", activity_source.index("onCodeRead"))
        manual_url_execution = activity_source.index("Intent.ACTION_VIEW", protocol_branch)
        manual_scheme_execution = activity_source.index("SchemeActivity.class", protocol_branch)
        self.assertLess(protocol_branch, manual_url_execution)
        self.assertLess(protocol_branch, manual_scheme_execution)
        self.assertIn('result.put("contentExecuted", false)', resolver_source)

    def test_parser_exposes_screen_record_commands_and_safe_defaults(self):
        status = solopi_ai.build_parser().parse_args(["screen-record-status"])
        start = solopi_ai.build_parser().parse_args(["screen-record-start"])
        stop = solopi_ai.build_parser().parse_args(
            ["screen-record-stop", "--session-id", "screen-1"]
        )

        self.assertEqual("screen-record-status", status.command)
        self.assertEqual("720x480", start.resolution)
        self.assertEqual(2500, start.bitrate_kbps)
        self.assertEqual(30, start.frame_rate)
        self.assertEqual(300, start.duration)
        self.assertEqual(120, start.ack_timeout)
        self.assertEqual(60, stop.stop_timeout)
        self.assertIsNone(stop.output)

        invalid = solopi_ai.build_parser().parse_args(
            ["screen-record-start", "--resolution", "721x480"]
        )
        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.validate_screen_record_config(invalid)
        self.assertEqual(3, error.exception.exit_code)

    def test_screen_record_status_schema_enforces_flags_user_action_and_output(self):
        for state, cancelled in (
            ("idle", False),
            ("pending-user-confirmation", False),
            ("starting", False),
            ("recording", False),
            ("stopping", False),
            ("stopped", False),
            ("stopped", True),
            ("failed", False),
        ):
            with self.subTest(state=state, cancelled=cancelled):
                solopi_ai.validate_screen_record_status(
                    self.screen_record_status(state, cancelled=cancelled)
                )

        inconsistent_recording = self.screen_record_status("starting")
        inconsistent_recording["recording"] = True
        missing_user_action = self.screen_record_status("pending-user-confirmation")
        missing_user_action["requiredUserAction"] = None
        outside_output = self.screen_record_status("stopped")
        outside_output["outputPath"] = "/storage/emulated/0/other/capture.mp4"
        failed_without_error = self.screen_record_status("failed")
        failed_without_error["error"] = None
        empty_stopped = self.screen_record_status("stopped")
        empty_stopped["fileSize"] = 0
        for payload in (
            inconsistent_recording,
            missing_user_action,
            outside_output,
            failed_without_error,
            empty_stopped,
        ):
            with self.subTest(payload=payload), self.assertRaises(solopi_ai.CliError):
                solopi_ai.validate_screen_record_status(payload)

    def test_screen_record_start_polls_user_confirmation_and_exact_session(self):
        session_id = "screen-session-1"
        statuses = [
            self.screen_record_status("idle", session_id=None),
            self.screen_record_status("pending-user-confirmation", session_id=session_id),
            self.screen_record_status("starting", session_id=session_id),
            self.screen_record_status("recording", session_id=session_id),
        ]

        class FakeSession:
            request_timeout = 5

            def __init__(self):
                self.statuses = list(statuses)
                self.calls = []

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def screen_record(self, action, timeout=None):
                self.calls.append((action, timeout))
                return self.statuses.pop(0)

        session = FakeSession()
        adb = mock.Mock()
        args = solopi_ai.build_parser().parse_args(["screen-record-start"])
        with mock.patch.object(solopi_ai, "session_from_args", return_value=session), mock.patch.object(
            solopi_ai.uuid, "uuid4", return_value=session_id
        ):
            result, exit_code = solopi_ai.command_screen_record_start(args, adb)

        self.assertEqual(0, exit_code)
        self.assertEqual("recording", result["state"])
        self.assertFalse(result["userActionRequired"])
        adb.invoke_scheme.assert_called_once_with(
            "screen-record",
            {
                "action": "start",
                "sessionId": session_id,
                "resolution": "720x480",
                "bitrateKbps": "2500",
                "frameRate": "30",
                "durationSec": "300",
            },
        )
        self.assertEqual(4, len(session.calls))

    def test_screen_record_start_timeout_stops_same_session_with_bounded_cleanup(self):
        session_id = "screen-timeout-1"
        before = self.screen_record_status("idle", session_id=None)
        pending = self.screen_record_status(
            "pending-user-confirmation", session_id=session_id
        )
        cancelled = self.screen_record_status(
            "stopped", session_id=session_id, cancelled=True
        )

        class FakeSession:
            request_timeout = 5

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def screen_record(self, action, timeout=None):
                return before

        timeout = solopi_ai.CliError(
            "start timed out",
            124,
            sessionId=session_id,
            lastStatus=pending,
            userActionRequired=True,
            requiredUserAction=solopi_ai.SCREEN_RECORD_REQUIRED_USER_ACTION,
        )
        adb = mock.Mock()
        args = solopi_ai.build_parser().parse_args(["screen-record-start"])
        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()), mock.patch.object(
            solopi_ai.uuid, "uuid4", return_value=session_id
        ), mock.patch.object(
            solopi_ai,
            "wait_for_screen_record_state",
            side_effect=[timeout, cancelled],
        ):
            with self.assertRaises(solopi_ai.CliError) as error:
                solopi_ai.command_screen_record_start(args, adb)

        self.assertEqual(124, error.exception.exit_code)
        self.assertTrue(error.exception.details["cleanup"]["success"])
        self.assertTrue(error.exception.details["cleanup"]["cancelledBeforeStart"])
        self.assertEqual(
            ["start", "stop"],
            [call.args[1]["action"] for call in adb.invoke_scheme.call_args_list],
        )
        self.assertTrue(
            all(
                call.args[1]["sessionId"] == session_id
                for call in adb.invoke_scheme.call_args_list
            )
        )

    def test_screen_record_stop_cancels_pending_and_starting_without_artifact(self):
        for initial_state in ("pending-user-confirmation", "starting"):
            session_id = "screen-cancel-" + initial_state.replace("-", "_")
            statuses = [
                self.screen_record_status(initial_state, session_id=session_id),
                self.screen_record_status("stopped", session_id=session_id, cancelled=True),
            ]

            class FakeSession:
                request_timeout = 5

                def __init__(self):
                    self.statuses = list(statuses)

                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, traceback):
                    return None

                def screen_record(self, action, timeout=None):
                    return self.statuses.pop(0)

            with tempfile.TemporaryDirectory() as temporary_dir, self.subTest(state=initial_state):
                output = Path(temporary_dir) / "cancelled.mp4"
                args = solopi_ai.build_parser().parse_args(
                    [
                        "screen-record-stop",
                        "--session-id",
                        session_id,
                        "--output",
                        str(output),
                    ]
                )
                adb = mock.Mock()
                with mock.patch.object(
                    solopi_ai, "session_from_args", return_value=FakeSession()
                ):
                    result, exit_code = solopi_ai.command_screen_record_stop(args, adb)

                self.assertEqual(0, exit_code)
                self.assertTrue(result["cancelledBeforeStart"])
                self.assertFalse(output.exists())
                adb.invoke_scheme.assert_called_once_with(
                    "screen-record",
                    {"action": "stop", "sessionId": session_id},
                )
                adb.pull.assert_not_called()

    def test_screen_record_stop_pulls_exact_nonempty_direct_child_without_overwrite(self):
        session_id = "screen-output-1"
        video = b"valid mp4 bytes"
        statuses = [
            self.screen_record_status("recording", session_id=session_id, file_size=len(video)),
            self.screen_record_status("stopped", session_id=session_id, file_size=len(video)),
        ]

        class FakeSession:
            request_timeout = 5

            def __init__(self):
                self.statuses = list(statuses)

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def screen_record(self, action, timeout=None):
                return self.statuses.pop(0)

        adb = mock.Mock()
        adb._screen_recording_file_size.return_value = len(video)
        adb.pull.side_effect = lambda remote, local: local.write_bytes(video)
        with tempfile.TemporaryDirectory() as temporary_dir:
            output = Path(temporary_dir) / "evidence" / "capture.mp4"
            args = solopi_ai.build_parser().parse_args(
                [
                    "screen-record-stop",
                    "--session-id",
                    session_id,
                    "--output",
                    str(output),
                ]
            )
            with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()):
                result, exit_code = solopi_ai.command_screen_record_stop(args, adb)

            self.assertEqual(video, output.read_bytes())
            self.assertEqual(str(output.resolve()), result["artifacts"]["screenRecording"])

        self.assertEqual(0, exit_code)
        terminal = statuses[1]
        adb._screen_recording_file_size.assert_called_once_with(
            terminal["outputPath"], terminal["capturesRoot"]
        )
        adb.pull.assert_called_once()

    def test_screen_record_output_rejects_outside_root_size_mismatch_and_existing_target(self):
        root = "/storage/emulated/0/solopi/ScreenCaptures"
        remote = root + "/Screen-20260807-120000-720x480.mp4"
        adb = mock.Mock()
        with tempfile.TemporaryDirectory() as temporary_dir:
            output = Path(temporary_dir) / "capture.mp4"
            with self.assertRaises(solopi_ai.CliError):
                solopi_ai.pull_screen_record_output(
                    adb,
                    "/storage/emulated/0/other/capture.mp4",
                    root,
                    10,
                    output,
                )
            adb._screen_recording_file_size.return_value = 11
            with self.assertRaises(solopi_ai.CliError) as mismatch:
                solopi_ai.pull_screen_record_output(adb, remote, root, 10, output)
            self.assertEqual(4, mismatch.exception.exit_code)
            adb.pull.assert_not_called()

            output.write_bytes(b"existing")
            with self.assertRaises(solopi_ai.CliError) as exists:
                solopi_ai.pull_screen_record_output(adb, remote, root, 11, output)
            self.assertEqual(3, exists.exception.exit_code)

    def test_record_status_contract_and_starting_stop_cancellation(self):
        bad_recording_flag = self.record_status("starting")
        bad_recording_flag["recording"] = True
        stopped_without_case = self.record_status("stopped")
        stopped_without_case["caseId"] = None
        failed_without_error = self.record_status("failed")
        failed_without_error["error"] = None
        for payload in (bad_recording_flag, stopped_without_case, failed_without_error):
            with self.subTest(payload=payload), self.assertRaises(solopi_ai.CliError):
                solopi_ai.validate_record_status(payload)

        session_id = "record-cancel-1"
        statuses = [
            self.record_status("starting", session_id=session_id),
            self.record_status("stopped", session_id=session_id, cancelled=True),
        ]

        class FakeSession:
            request_timeout = 5

            def __init__(self):
                self.statuses = list(statuses)

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def record(self, mode, timeout=None):
                return self.statuses.pop(0)

        args = solopi_ai.build_parser().parse_args(
            ["record-stop", "--session-id", session_id]
        )
        adb = mock.Mock()
        with mock.patch.object(solopi_ai, "session_from_args", return_value=FakeSession()):
            result, exit_code = solopi_ai.command_record_stop(args, adb)

        self.assertEqual(0, exit_code)
        self.assertTrue(result["cancelledBeforeStart"])
        self.assertIsNone(result["caseId"])
        adb.invoke_scheme.assert_called_once_with(
            "record", {"recordMode": "stop", "sessionId": session_id}
        )

    def test_video_analysis_device_path_accepts_only_android_capture_children(self):
        valid_paths = (
            "/sdcard/solopi/ScreenCaptures/Screen-demo.mp4",
            "/storage/emulated/0/solopi/ScreenCaptures/Screen-demo.mp4",
        )
        for path in valid_paths:
            with self.subTest(path=path):
                self.assertEqual(path, solopi_ai.validate_video_analysis_device_path(path))

        invalid_paths = (
            "/Users/demo/ScreenCaptures/Screen-demo.mp4",
            "/sdcard/solopi/ScreenCaptures/nested/Screen-demo.mp4",
            "/sdcard/solopi/ScreenCaptures/.hidden.mp4",
            "/sdcard/solopi/ScreenCaptures/Screen-demo.txt",
            "Screen-demo.mp4",
            " /sdcard/solopi/ScreenCaptures/Screen-demo.mp4",
        )
        for path in invalid_paths:
            with self.subTest(path=path), self.assertRaises(solopi_ai.CliError):
                solopi_ai.validate_video_analysis_device_path(path)

    def test_video_analysis_response_contract_rejects_inconsistent_states(self):
        request_id = "video-request-1"
        for state in ("analyzing", "completed", "failed"):
            with self.subTest(state=state):
                solopi_ai.validate_video_analysis_response(
                    self.video_analysis_receipt(state, request_id=request_id), request_id
                )

        invalid = []
        wrong_terminal = self.video_analysis_receipt("analyzing")
        wrong_terminal["terminal"] = True
        invalid.append(wrong_terminal)
        missing_result = self.video_analysis_receipt("completed")
        missing_result.pop("visualResponseTimeMs")
        invalid.append(missing_result)
        mismatched = self.video_analysis_receipt("completed", request_id="other-request")
        invalid.append(mismatched)
        failed_success = self.video_analysis_receipt("failed")
        failed_success["success"] = True
        invalid.append(failed_success)
        premature_error = self.video_analysis_receipt("analyzing")
        premature_error["error"] = "unexpected"
        invalid.append(premature_error)
        for payload in invalid:
            with self.subTest(payload=payload), self.assertRaises(solopi_ai.CliError):
                solopi_ai.validate_video_analysis_response(payload, request_id)

        solopi_ai.validate_video_analysis_response(
            {
                "success": False,
                "errorCode": "analysis_not_found",
                "error": "Video analysis request was not found",
            },
            request_id,
        )
        with self.assertRaises(solopi_ai.CliError):
            solopi_ai.validate_video_analysis_response(
                {"success": False, "error": "missing code"}, request_id
            )

    def test_video_analysis_status_queries_exact_request_id(self):
        request_id = "video-request-1"

        class FakeSession:
            def __init__(self, response):
                self.response = response
                self.calls = []

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def video_analysis(self, requested_id, timeout=None):
                self.calls.append((requested_id, timeout))
                return self.response

        for state, expected_exit in (("analyzing", 0), ("completed", 0), ("failed", 2)):
            session = FakeSession(self.video_analysis_receipt(state, request_id=request_id))
            args = solopi_ai.build_parser().parse_args(
                ["video-analysis-status", "--request-id", request_id]
            )
            with self.subTest(state=state), mock.patch.object(
                solopi_ai, "session_from_args", return_value=session
            ):
                result, exit_code = solopi_ai.command_video_analysis_status(args, mock.Mock())
            self.assertEqual(expected_exit, exit_code)
            self.assertEqual(state, result["state"])
            self.assertEqual([(request_id, None)], session.calls)

    def test_video_analysis_start_no_wait_sends_exact_scheme_and_confirms_receipt(self):
        request_id = "video-request-1"
        video_path = "/sdcard/solopi/ScreenCaptures/Screen-demo.mp4"
        args = solopi_ai.build_parser().parse_args(
            [
                "video-analysis-start",
                "--video-path",
                video_path,
                "--action-offset-ms",
                "250",
                "--difference-threshold",
                "0.2",
                "--no-wait",
            ]
        )

        class FakeSession:
            request_timeout = 5

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def video_analysis(self, requested_id, timeout=None):
                return self_response

        self_response = self.video_analysis_receipt("analyzing", request_id=request_id)
        adb = mock.Mock()
        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=FakeSession()
        ), mock.patch.object(solopi_ai.uuid, "uuid4", return_value=request_id):
            result, exit_code = solopi_ai.command_video_analysis_start(args, adb)

        self.assertEqual(0, exit_code)
        self.assertEqual("analyzing", result["state"])
        adb.invoke_scheme.assert_called_once_with(
            "video-analysis",
            {
                "action": "start",
                "requestId": request_id,
                "videoPath": video_path,
                "actionOffsetMs": "250",
                "differenceThreshold": "0.2",
            },
        )

    def test_video_analysis_start_waits_for_completed_or_failed_terminal(self):
        request_id = "video-request-1"
        arguments = [
            "video-analysis-start",
            "--video-path",
            "/sdcard/solopi/ScreenCaptures/Screen-demo.mp4",
            "--action-offset-ms",
            "250",
            "--difference-threshold",
            "0.2",
        ]

        class FakeSession:
            request_timeout = 5

            def __init__(self, statuses):
                self.statuses = list(statuses)

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def video_analysis(self, requested_id, timeout=None):
                return self.statuses.pop(0)

        for terminal_state, expected_exit in (("completed", 0), ("failed", 2)):
            statuses = [
                self.video_analysis_receipt("analyzing", request_id=request_id),
                self.video_analysis_receipt(terminal_state, request_id=request_id),
            ]
            args = solopi_ai.build_parser().parse_args(arguments)
            with self.subTest(state=terminal_state), mock.patch.object(
                solopi_ai, "session_from_args", return_value=FakeSession(statuses)
            ), mock.patch.object(solopi_ai.uuid, "uuid4", return_value=request_id):
                result, exit_code = solopi_ai.command_video_analysis_start(args, mock.Mock())
            self.assertEqual(expected_exit, exit_code)
            self.assertEqual(terminal_state, result["state"])
            if terminal_state == "completed":
                self.assertEqual(321, result["visualResponseTimeMs"])

    def test_video_analysis_start_compares_normalized_threshold_receipt(self):
        request_id = "video-request-precision"
        raw_threshold = "0.12345678901234567"
        normalized_threshold = format(float(raw_threshold), ".15g")
        args = solopi_ai.build_parser().parse_args(
            [
                "video-analysis-start",
                "--video-path",
                "/sdcard/solopi/ScreenCaptures/Screen-demo.mp4",
                "--action-offset-ms",
                "250",
                "--difference-threshold",
                raw_threshold,
                "--no-wait",
            ]
        )
        response = self.video_analysis_receipt("analyzing", request_id=request_id)
        response["differenceThreshold"] = float(normalized_threshold)

        class FakeSession:
            request_timeout = 5

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

            def video_analysis(self, requested_id, timeout=None):
                return response

        adb = mock.Mock()
        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=FakeSession()
        ), mock.patch.object(solopi_ai.uuid, "uuid4", return_value=request_id):
            result, exit_code = solopi_ai.command_video_analysis_start(args, adb)

        self.assertEqual(0, exit_code)
        self.assertEqual(float(normalized_threshold), result["differenceThreshold"])
        self.assertEqual(
            normalized_threshold,
            adb.invoke_scheme.call_args.args[1]["differenceThreshold"],
        )

    def test_video_analysis_start_rejects_local_path_and_preserves_transport_context(self):
        invalid_args = solopi_ai.build_parser().parse_args(
            [
                "video-analysis-start",
                "--video-path",
                "/Users/demo/ScreenCaptures/Screen-demo.mp4",
                "--action-offset-ms",
                "0",
                "--difference-threshold",
                "0.2",
            ]
        )
        with mock.patch.object(solopi_ai, "session_from_args") as session, self.assertRaises(
            solopi_ai.CliError
        ):
            solopi_ai.command_video_analysis_start(invalid_args, mock.Mock())
        session.assert_not_called()

        valid_args = solopi_ai.build_parser().parse_args(
            [
                "video-analysis-start",
                "--video-path",
                "/sdcard/solopi/ScreenCaptures/Screen-demo.mp4",
                "--action-offset-ms",
                "0",
                "--difference-threshold",
                "0.2",
            ]
        )

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return None

        adb = mock.Mock()
        adb.invoke_scheme.side_effect = solopi_ai.CliError("transport failed", 4)
        with mock.patch.object(
            solopi_ai, "session_from_args", return_value=FakeSession()
        ), mock.patch.object(solopi_ai.uuid, "uuid4", return_value="video-request-1"), self.assertRaises(
            solopi_ai.CliError
        ) as error:
            solopi_ai.command_video_analysis_start(valid_args, adb)

        self.assertEqual("video-request-1", error.exception.details["requestId"])
        self.assertEqual("video-analysis-start", error.exception.details["phase"])

    def test_managed_parser_exposes_control_plane_without_shell_surface(self):
        parser = solopi_ai.build_parser()
        with tempfile.TemporaryDirectory() as directory:
            database = str(Path(directory) / "managed.sqlite")
            parsed = parser.parse_args(
                [
                    "managed-device-register",
                    "--database", database,
                    "--device-id", "pixel-8",
                    "--device-serial", "SERIAL-1",
                    "--api-level", "35",
                    "--capability", "verification",
                    "--label", "tier=physical",
                ]
            )
        self.assertEqual("managed-device-register", parsed.command)
        self.assertFalse(hasattr(parsed, "shell"))
        for command in (
            "managed-init",
            "managed-health",
            "managed-device-list",
            "managed-recover",
        ):
            self.assertEqual(command, parser.parse_args([command]).command)

    def test_managed_worker_commits_existing_verification_report_with_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "managed.sqlite"
            artifacts = root / "artifacts"
            store = solopi_ai.managed_execution.ManagedExecutionStore(database)
            store.register_device(
                "pixel-8", "SERIAL-1", "android", 35,
                ["verification"], {"tier": "physical"}
            )
            task = store.submit_task(
                {
                    "schemaVersion": "solopi.ai.verification-plan/v1",
                    "planFingerprint": "a" * 64,
                    "intent": {"requirement": {"id": "counter"}},
                },
                [{"id": "main", "selector": {"platform": "android"}}],
                "worker-success",
                owner_token="worker-owner-token-1234567890",
            )
            args = solopi_ai.build_parser().parse_args(
                [
                    "managed-worker-once",
                    "--database", str(database),
                    "--worker-id", "worker-1",
                    "--artifacts-root", str(artifacts),
                ]
            )

            def fake_verify(verify_args, adb):
                self.assertEqual("SERIAL-1", adb.requested_serial)
                output = Path(verify_args.artifacts)
                output.mkdir(parents=True)
                report_path = output / "report.json"
                report_path.write_text(
                    json.dumps(
                        {
                            "status": "passed",
                            "outcomeFingerprint": "b" * 64,
                            "scenarios": [],
                        }
                    ),
                    encoding="utf-8",
                )
                (output / "events.jsonl").write_text("{}\n", encoding="utf-8")
                return {
                    "success": True,
                    "status": "passed",
                    "report": str(report_path),
                    "events": str(output / "events.jsonl"),
                }, 0

            with mock.patch.object(solopi_ai, "command_verify_run", side_effect=fake_verify):
                result, exit_code = solopi_ai.command_managed_worker_once(args, mock.Mock())

            self.assertEqual(0, exit_code)
            self.assertTrue(result["claimed"])
            report = store.task_report(task["taskId"])
            self.assertEqual("passed", report["status"])
            attempt = report["shards"][0]["attempts"][0]
            self.assertRegex(attempt["evidenceDigest"], r"^[0-9a-f]{64}$")
            self.assertEqual(1, attempt["ownerGeneration"])

    def test_managed_worker_routes_network_interruption_to_bounded_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "managed.sqlite"
            store = solopi_ai.managed_execution.ManagedExecutionStore(database)
            store.register_device(
                "pixel-8", "SERIAL-1", "android", 35,
                ["verification"], {}
            )
            task = store.submit_task(
                {
                    "schemaVersion": "solopi.ai.verification-plan/v1",
                    "planFingerprint": "c" * 64,
                    "intent": {"requirement": {"id": "counter"}},
                },
                [{"id": "main", "selector": {"platform": "android"}}],
                "worker-network-failure",
                owner_token="worker-owner-token-1234567890",
                max_retries=1,
            )
            args = solopi_ai.build_parser().parse_args(
                [
                    "managed-worker-once",
                    "--database", str(database),
                    "--worker-id", "worker-1",
                    "--artifacts-root", str(root / "artifacts"),
                ]
            )
            with mock.patch.object(
                solopi_ai,
                "command_verify_run",
                side_effect=solopi_ai.CliError("ADB connection interrupted", 4),
            ), self.assertRaises(solopi_ai.CliError) as error:
                solopi_ai.command_managed_worker_once(args, mock.Mock())

            self.assertEqual(4, error.exception.exit_code)
            self.assertEqual("queued", store.task_status(task["taskId"])["status"])
            report = store.task_report(task["taskId"])
            self.assertEqual("retryable_failed", report["shards"][0]["attempts"][0]["status"])
            self.assertEqual("transport_error", report["shards"][0]["attempts"][0]["failureCategory"])


if __name__ == "__main__":
    unittest.main()
