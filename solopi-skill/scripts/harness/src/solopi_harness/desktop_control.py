"""Private stdio bridge for SoloPi Desktop. No network listener or shell API.

The Electron owner starts one process and supplies a private artifact directory.
Each observation exposes bounded node handles; selectors stay in this process.
"""
from __future__ import annotations

import argparse
import base64
import copy
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import uuid

from . import native_recording, native_runtime, solopi_ai, verification_engine
from .strict_png import validate_png

Error = native_runtime.NativeExecutionError
PLATFORMS = {"android", "ios", "harmony_next"}
APP_ID = re.compile(r"[A-Za-z][A-Za-z0-9_.-]{0,199}\Z")
DEVICE_ID = re.compile(r"[A-Za-z0-9_.:-]{1,128}\Z")
MAX_LINE = 1024 * 1024


def checked_config(value):
    if not isinstance(value, dict) or set(value) - {
        "platform", "deviceId", "deviceKind", "appId", "wdaPort", "controlPackage", "controlPort",
        "actionValidationStrategy", "fixedChecks"
    }:
        raise Error("invalid_device_config")
    result = dict(value)
    if (result.get("platform") not in PLATFORMS
            or result.get("deviceKind") not in {"physical", "simulator"}
            or not isinstance(result.get("deviceId"), str) or not DEVICE_ID.fullmatch(result["deviceId"])
            or not isinstance(result.get("appId"), str) or not APP_ID.fullmatch(result["appId"])):
        raise Error("invalid_device_config")
    for key, default in (("wdaPort", 8100), ("controlPort", 23342)):
        port = result.setdefault(key, default)
        if type(port) is not int or not 1024 <= port <= 65535:
            raise Error("invalid_port")
    package = result.setdefault("controlPackage", "com.alipay.hulu")
    if not isinstance(package, str) or not APP_ID.fullmatch(package):
        raise Error("invalid_control_package")
    checks = result.get('fixedChecks', [])
    if (not isinstance(checks, list) or len(checks) > 10 or any(
            not isinstance(c, dict) or set(c) != {'selectorKey', 'selectorValue', 'operator', 'expected'}
            or not isinstance(c['selectorKey'], str) or c['selectorKey'] not in {'resourceId', 'text', 'description'}
            or not isinstance(c['operator'], str) or c['operator'] not in {'equals', 'contains'}
            or not isinstance(c['selectorValue'], str) or not c['selectorValue'].strip() or len(c['selectorValue']) > 512
            or not isinstance(c['expected'], str) or len(c['expected']) > 4096 for c in checks)):
        raise Error('invalid_fixed_checks')
    strategy = result.setdefault("actionValidationStrategy", "full-page")
    if not isinstance(strategy, str) or strategy not in {"full-page", "target-context-v1"}:
        raise Error("invalid_action_validation_strategy")
    if result["platform"] == "harmony_next" and (
        result["deviceKind"] != "simulator" or not result["deviceId"].startswith("127.0.0.1:")
    ):
        raise Error("physical_harmony_not_validated")
    return result


def cli_args(config, command):
    # Code security: fixed parser/commands, never construct a shell or accept executable paths over IPC.
    return solopi_ai.build_parser().parse_args([
        "--serial", config["deviceId"], "--package", config["controlPackage"],
        "--device-port", str(config["controlPort"]), *command,
    ])


class DesktopReplayAdb(solopi_ai.AdbClient):
    """Retain the internally generated replay identity for bounded cancellation."""
    def __init__(self, config):
        super().__init__(executable=os.environ.get("ADB", "adb"), requested_serial=config["deviceId"],
                         control_package=config["controlPackage"])
        self.config = config
        self.owned_request = None

    def invoke_scheme(self, action, params, timeout=30):
        if action == "replay":
            # The CLI generates this request ID; it is never accepted from IPC.
            self.owned_request = (params["requestId"], params["caseName"])
        return super().invoke_scheme(action, params, timeout)

    def finish(self):
        if self.owned_request is None:
            return {"state": "no_replay_dispatched"}
        try:
            status, code = solopi_ai.command_query(cli_args(self.config, ["status"]), self, "status")
            if code or status.get("success") is not True:
                return {"state": "unconfirmed", "reason": "status_unavailable"}
            # Code security: cancel only the run bound to this private process's
            # request and case. command_cancel rechecks runId before the device RPC.
            if (status.get("requestId"), status.get("caseName")) != self.owned_request:
                return {"state": "unconfirmed", "reason": "replay_identity_mismatch"}
            if status.get("terminal") is True and status.get("active") is False:
                return {"state": "already_terminal", "runId": status.get("runId"),
                        "runState": status.get("state")}
            if status.get("active") is not True or not isinstance(status.get("runId"), str):
                return {"state": "unconfirmed", "reason": "run_identity_unavailable"}
            result, code = solopi_ai.command_cancel(cli_args(self.config, [
                "cancel", "--run-id", status["runId"], "--cancel-timeout", "15",
            ]), self)
            return {"state": "cancelled" if code == 0 else "unconfirmed",
                    "runId": status["runId"], "runState": result.get("state")}
        except (solopi_ai.CliError, OSError, ValueError):
            return {"state": "unconfirmed", "reason": "cancel_unavailable"}


class AndroidSession:
    """Adapt the existing on-device Agent session; retain its receipt and stale-frame gates."""
    platform = "android"
    supported_actions = frozenset({"click", "longClick", "input", "scroll", "back", "wait"})

    def __init__(self, config):
        self.config = config
        self.device_id, self.app_id = config["deviceId"], config["appId"]
        self.driver = self
        self.adb = solopi_ai.AdbClient(requested_serial=self.device_id,
                                      executable=os.environ.get("ADB", "adb"),
                                      control_package=config["controlPackage"])
        self.owner_token = None
        self.session_id = None
        self.current = None
        self.receipt = None

    def _call(self, function, command):
        result, code = function(cli_args(self.config, command), self.adb)
        if code or result.get("success") is not True:
            raise Error(result.get("errorCode", "android_control_failed"))
        return result

    def _identity(self):
        return ["--session-id", self.session_id, "--owner-token", self.owner_token]

    def ensure_ready(self):
        if self.session_id:
            return
        self.adb.connect()
        doctor, code = solopi_ai.command_doctor(cli_args(self.config, ["doctor"]), self.adb)
        if code or doctor.get("success") is not True:
            raise Error("android_setup_required")
        self.adb.launch(self.app_id)
        result = self._call(solopi_ai.command_agent_session_start, [
            "agent-session-start", "--max-steps", "200", "--max-duration-ms", "1800000",
            "--idle-timeout-ms", "300000", "--max-repeated-actions", "20", "--max-no-progress-steps", "20",
            "--action-validation-strategy", self.config["actionValidationStrategy"],
        ])
        self.owner_token = result["ownerToken"]
        self.session_id = result["session"]["sessionId"]

    def observe(self):
        self.ensure_ready()
        result = self._call(solopi_ai.command_agent_observe, ["agent-observe", *self._identity()])
        observation = result["observation"]
        if not any(node.get("packageName") == self.app_id for node in solopi_ai.verification_nodes(observation)):
            raise Error("observation_identity_mismatch")
        self.current = copy.deepcopy(observation)
        return observation

    def act(self, step_id, action, observation):
        if self.current is None or observation != self.current:
            raise Error("stale_observation")
        node_id = solopi_ai.verification_target_node_id(action, observation)
        command = ["agent-act", *self._identity(), "--step-id", step_id,
                   "--observation-id", observation["observationId"], "--action", action["type"]]
        if node_id:
            command += ["--node-id", node_id]
        for field, flag in (("text", "--text"), ("direction", "--direction"),
                            ("durationMs", "--duration-ms"), ("distance", "--distance")):
            if field in action:
                command.append(flag + "=" + str(action[field]))
        self.current = None
        self.receipt = {"state": "outcome_unknown", "stepId": step_id, "sessionId": self.session_id}
        result, code = solopi_ai.command_agent_act(cli_args(self.config, command), self.adb)
        receipt = result.get("receipt")
        # Code security: only a terminal receipt bound to this private request can
        # replace outcome_unknown. A transport error must never become a rejection.
        if (result.get("success") is not True or not isinstance(receipt, dict)
                or receipt.get("stepId") != step_id
                or receipt.get("observationId") != observation["observationId"]
                or not isinstance(receipt.get("status"), str)
                or receipt.get("status") not in solopi_ai.AGENT_RECEIPT_TERMINAL_STATES):
            raise Error("action_outcome_unknown")
        status = receipt["status"]
        if status == "succeeded" and code:
            raise Error("action_outcome_unknown")
        self.receipt = {"state": status, "stepId": step_id, "sessionId": self.session_id,
                        "deviceReceipt": copy.deepcopy(receipt)}
        if status != "succeeded":
            # Return bounded reason codes, not raw device errors or account data.
            reason = receipt.get("errorCode")
            if not isinstance(reason, str) or reason not in {"target_occluded", "target_geometry_unknown", "stale_observation",
                              "target_not_found", "target_changed", "target_not_actionable"}:
                reason = "android_action_" + status
            raise Error(reason)
        return copy.deepcopy(self.receipt)

    def last_receipt(self):
        return copy.deepcopy(self.receipt)

    def screenshot(self):
        return self.adb.screenshot()

    def close(self):
        if self.session_id and self.owner_token:
            try:
                result, code = solopi_ai.command_agent_mutation(
                    cli_args(self.config, ["agent-cancel", *self._identity()]), self.adb, "cancel")
                if code:
                    raise Error("android_cleanup_unconfirmed")
            finally:
                self.session_id = None
                self.owner_token = None


class DesktopRecorder(native_recording.NativeRecorder):
    def requirement(self):
        result = super().requirement()
        if self.session.driver.platform == "android":
            result["targetAppPackage"] = self.session.app_id
        result["title"] = "SoloPi Desktop recorded regression"
        # Recorded actions await a receipt/observation; fixed Android replay can
        # acknowledge a click before the next layout is visible. Make the wait
        # explicit in the editable requirement, including checkpoint placement.
        for scenario in result["scenarios"]:
            steps, settled = [], {}
            for step in scenario["steps"]:
                steps.append(step)
                if step["action"]["type"] != "wait":
                    wait_id = "settle-" + step["id"]
                    steps.append({"id": wait_id, "type": "operation",
                                  "action": {"type": "wait", "durationMs": 1200}})
                    settled[step["id"]] = wait_id
            scenario["steps"] = steps
            for checkpoint in scenario["checkpoints"]:
                checkpoint["afterStep"] = settled.get(checkpoint["afterStep"], checkpoint["afterStep"])
        return result


def selector_for(node, nodes, platform):
    # NEXT accessibilityId is a runtime tree number, not an app-owned identifier.
    keys = (["resourceId", "description", "text"] if platform == "android"
            else ["id", "text", "description"] if platform == "harmony_next"
            else ["accessibilityId", "id", "text", "description"])
    for key in keys:
        value = node.get(key)
        if not isinstance(value, str) or not value:
            continue
        selector = {key: value}
        if sum(all(n.get(k) == v for k, v in selector.items()) for n in nodes) == 1:
            return selector
        if node.get("className"):
            selector["className"] = node["className"]
            if sum(all(n.get(k) == v for k, v in selector.items()) for n in nodes) == 1:
                return selector
    return None


class DesktopControl:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.recorder = None
        self.config = None
        self.handles = {}
        self.virtual = None

    def discover(self):
        devices, diagnostics = [], []
        try:
            result = subprocess.run([os.environ.get("ADB", "adb"), "devices", "-l"],
                                    capture_output=True, text=True, timeout=10, check=True)
            for item in solopi_ai.parse_devices(result.stdout):
                devices.append({"platform": "android", "deviceId": item["serial"],
                                "deviceKind": "simulator" if item["serial"].startswith("emulator-") else "physical",
                                "name": item.get("model", item["serial"]), "state": item["state"]})
        except (OSError, subprocess.SubprocessError):
            diagnostics.append({"platform": "android", "missing": ["adb_unavailable"]})
        for platform in ("ios", "harmony_next"):
            try:
                report = native_runtime.native_doctor(platform)
                diagnostics.append(report)
                for device in report.get("devices", []):
                    devices.append({"platform": platform, "deviceId": device, "deviceKind": "physical",
                                    "name": device, "state": "discovered"})
                for item in report.get("simulators", []):
                    devices.append({"platform": platform, "deviceId": item["deviceId"], "deviceKind": "simulator",
                                    "name": item.get("name", item["deviceId"]),
                                    "state": "ready" if item.get("driverReady") else "runner_required"})
            except (Error, OSError, ValueError):
                diagnostics.append({"platform": platform, "missing": ["discovery_failed"]})
        return {"devices": devices, "diagnostics": diagnostics}

    def apps(self, value):
        if self.recorder is not None or self.virtual is not None:
            raise Error("device_session_busy")
        config = checked_config(value)
        if config["platform"] != "android":
            raise Error("unsupported_platform")
        # Code security: use the fixed read-only apps query and validated device identity.
        adb = solopi_ai.AdbClient(executable=os.environ.get("ADB", "adb"),
                                  requested_serial=config["deviceId"],
                                  control_package=config["controlPackage"])
        result, code = solopi_ai.command_query(cli_args(config, ["apps"]), adb, "apps")
        if code or result.get("success") is not True or not isinstance(result.get("apps"), list):
            raise Error("apps_unavailable")
        return {"apps": [{"packageName": app["packageName"], "label": app.get("label", "")}
                         for app in result["apps"] if isinstance(app, dict)
                         and isinstance(app.get("packageName"), str)
                         and APP_ID.fullmatch(app["packageName"])
                         and isinstance(app.get("label", ""), str)]}

    def connect(self, value):
        if self.recorder is not None or self.virtual is not None:
            raise Error("device_session_busy")
        config = checked_config(value)
        session = None
        try:
            if config["platform"] == "android":
                session = AndroidSession(config)
            else:
                driver = native_runtime.create_driver(config["platform"], config["deviceId"],
                                                      config["deviceKind"], config["wdaPort"])
                session = native_runtime.NativeSession(driver, config["appId"])
            session.ensure_ready()
            self.config = config
            self.recorder = DesktopRecorder(session, self.root / ("record-" + uuid.uuid4().hex))
            return self.observe()
        except BaseException:
            if self.recorder:
                self.close()
            elif session:
                session.driver.close()
            raise

    def frame(self, result):
        observed = result["observation"]
        nodes = list(solopi_ai.verification_nodes(observed))
        self.handles = {}
        elements = []
        platform = self.config["platform"]
        for index, node in enumerate(nodes[:5000]):
            if platform == "android" and node.get("packageName") != self.config["appId"]:
                continue
            selector = selector_for(node, nodes, platform)
            if selector is None:
                continue
            handle = str(index)
            self.handles[handle] = selector
            hittable = (node.get("visible") is True and node.get("hittable") is True
                        if platform != "android" else node.get("enabled", True) is not False
                        and node.get("visibleToUser", node.get("visible", True)) is not False)
            elements.append({"handle": handle, "selector": selector, "text": node.get("text", ""),
                             "description": node.get("description", ""), "role": node.get("className", ""),
                             "bounds": node.get("bounds"), "hittable": hittable})
        image = next(item["content"] for item in result["evidence"] if item["type"] == "screenshot")
        image_path = Path(image["path"]).resolve()
        # Code security: only current-run screenshots generated by the recorder are readable.
        image_path.relative_to(self.recorder.root)
        raw = image_path.read_bytes()
        validate_png(raw)
        return {"observationId": observed["observationId"], "elements": elements,
                "screenshotDataUrl": "data:image/png;base64," + base64.b64encode(raw).decode("ascii"),
                "sessionId": self.recorder.session.session_id, "state": self.recorder.state,
                "actions": sorted(self.recorder.session.driver.supported_actions),
                "stepCount": len(self.recorder.steps), "checkpointCount": len(self.recorder.checkpoints)}

    def observe(self):
        if self.recorder is None:
            raise Error("no_device_session")
        return self.frame(self.recorder.command({"type": "observe"}))

    def command(self, value):
        if not isinstance(value, dict) or self.recorder is None:
            raise Error("no_device_session")
        kind = value.get("type")
        if kind == "observe":
            return self.observe()
        if kind == "end":
            result = self.recorder.command({"type": "end"})
            requirement = self.recorder.requirement()
            root = str(self.recorder.root)
            self.close()
            return {"state": result["state"], "requirement": requirement, "artifacts": root}
        if kind not in {"act", "assert"}:
            raise Error("unsupported_desktop_command")
        if (self.recorder.current is None
                or value.get("observationId") != self.recorder.current["observationId"]):
            raise Error("stale_observation")
        selector = self.handles.get(value.get("handle"))
        if kind == "assert":
            if selector is None or not isinstance(value.get("expected"), str) or len(value["expected"]) > 4096:
                raise Error("invalid_assertion")
            # Expected values are explicitly entered by the user, never copied from actual results.
            result = self.recorder.command({"type": "assert", "oracle": {
                "type": "ui", "selector": selector, "field": "text", "operator": "equals", "expected": value["expected"]}})
            return {"assertion": {key: result[key] for key in ("status", "reason", "actual")}, **self.observe()}
        action_type = value.get("action")
        if action_type not in self.recorder.session.driver.supported_actions:
            raise Error("unsupported_action")
        action = {"type": action_type}
        if action_type in {"click", "longClick", "input", "scroll"}:
            if selector is None:
                raise Error("unknown_node_handle")
            action["selector"] = selector
        for field in ("text", "direction", "distance", "durationMs"):
            if field in value:
                action[field] = value[field]
        try:
            result = self.recorder.command({"type": "act", "observationId": value["observationId"], "action": action})
        except Error as exc:
            receipt = self.recorder.session.last_receipt()
            if (self.recorder.state != "recording" or not isinstance(receipt, dict)
                    or receipt.get("state") != "rejected"):
                raise
            # Observation only: never replay a rejected or uncertain gesture.
            return {"receipt": receipt, "actionError": exc.code, **self.observe()}
        return {"receipt": result["receipt"], **self.observe()}

    def replay(self, value):
        if self.recorder is not None or self.virtual is not None:
            raise Error("disconnect_before_replay")
        config = checked_config(value.get("config"))
        requirement = value.get("requirement")
        plan = verification_engine.compile_verification_plan(requirement)
        for scenario in plan["intent"]["scenarios"]:
            if scenario["platform"] != config["platform"] or scenario["targetAppId"] != config["appId"]:
                raise Error("device_binding_mismatch")
            if any(step.get("type") != "operation" for step in scenario["steps"]):
                raise Error("desktop_replay_fixed_steps_only")
        root = self.root / ("replay-" + uuid.uuid4().hex)
        root.mkdir(mode=0o700)
        plan_path = root / "plan.json"
        plan_path.write_text(json.dumps(plan, ensure_ascii=False), encoding="utf-8")
        command = ["verify-run", "--plan", str(plan_path), "--artifacts", str(root / "result"), "--segment-screenshots"]
        if config["platform"] != "android":
            command += ["--native-device", config["deviceId"], "--device-kind", config["deviceKind"],
                        "--wda-port", str(config["wdaPort"])]
        args = cli_args(config, command)
        adb = DesktopReplayAdb(config)
        try:
            result, code = solopi_ai.command_verify_run(args, adb)
        finally:
            if config["platform"] == "android":
                cleanup = adb.finish()
                (root / "desktop-cleanup.json").write_text(json.dumps(cleanup), encoding="utf-8")
        if config["platform"] == "android":
            result["desktopCleanup"] = cleanup
        if config["platform"] == "android":
            from .visual_report import export_report
            # Evidence presentation must not replace the runner's verdict, including
            # infrastructure failures that return before a report can be written.
            if isinstance(result.get("report"), str):
                try:
                    report = json.loads(Path(result["report"]).read_text(encoding="utf-8"))
                    result["htmlReport"] = str(export_report(report, root / "result", title="SoloPi Desktop 回归证据"))
                except (OSError, ValueError):
                    result["htmlExportError"] = "report_export_failed"
            else:
                result["htmlExportError"] = "report_unavailable"
        # A completed request is not a passed test. Keep the independent Judge's result.
        return {"exitCode": code, "result": result, "artifacts": str(root)}

    def close(self):
        if self.virtual is not None:
            result = self.virtual.close()
            self.virtual = None
            return result
        recorder, self.recorder = self.recorder, None
        self.handles = {}
        if recorder is not None:
            try:
                recorder.interrupt()
            finally:
                recorder.session.driver.close()
        return {"state": "disconnected"}

    def virtual_start(self, value):
        if self.recorder is not None or self.virtual is not None:
            raise Error("device_session_busy")
        if not isinstance(value, dict): raise Error("invalid_device_config")
        value = dict(value)
        owner_token = value.pop('_desktopOwnerToken', None)
        if owner_token is not None and (not isinstance(owner_token, str) or not re.fullmatch(r'[0-9a-f]{64}', owner_token)):
            raise Error('invalid_virtual_owner')
        config = checked_config(value)
        if config["platform"] != "android": raise Error("virtual_android_only")
        from .virtual_desktop import VirtualDesktopSession
        self.virtual = VirtualDesktopSession(config, self.root / ("virtual-" + uuid.uuid4().hex), cli_args, owner_token)
        try:
            return self.virtual.start()
        except BaseException:
            try:
                self.virtual.close()
                self.virtual = None
            except Exception:
                # Keep the owner alive so explicit cleanup can be retried.
                pass
            raise

    def virtual_recover(self, value):
        """Recover cleanup only with the capability retained by the same desktop owner."""
        # Code security: the local stdio bridge has no authenticated web principal;
        # device-side owner-token checks bind this cleanup to the original session.
        if self.recorder is not None or self.virtual is not None: raise Error('device_session_busy')
        if not isinstance(value, dict) or set(value) != {'config', 'ownerToken'}:
            raise Error('invalid_virtual_recovery')
        token = value['ownerToken']
        if not isinstance(token, str) or not re.fullmatch(r'[0-9a-f]{64}', token):
            raise Error('invalid_virtual_owner')
        config = checked_config(value['config'])
        if config['platform'] != 'android': raise Error('virtual_android_only')
        adb = solopi_ai.AdbClient(requested_serial=config['deviceId'], control_package=config['controlPackage'],
                                  executable=os.environ.get('ADB', 'adb'))
        adb.connect()
        args = cli_args(config, ['agent-session-start'])
        with solopi_ai.session_from_args(args, adb, preserve_foreground=True) as session:
            lookup = session.agent('start-status', {'ownerToken': token})
        state = lookup.get('session') if isinstance(lookup, dict) and lookup.get('success') is True else None
        if (not isinstance(state, dict) or not isinstance(state.get('sessionId'), str)
                or state.get('screenMode') != 'virtual' or state.get('targetPackage') != config['appId']):
            raise Error('virtual_cleanup_unconfirmed')
        identity = ['--session-id', state['sessionId'], '--owner-token', token]
        if state.get('state') in {'active', 'paused', 'acting'}:
            result, code = solopi_ai.command_agent_mutation(cli_args(config, ['agent-cancel', *identity]), adb, 'cancel')
        elif state.get('state') not in solopi_ai.AGENT_TERMINAL_STATES:
            raise Error('virtual_cleanup_unconfirmed')
        elif state.get('cleanupPending') is True:
            result, code = solopi_ai.command_agent_mutation(cli_args(config, ['agent-cleanup', *identity]), adb, 'cleanup')
        else:
            result, code = solopi_ai.command_agent_query(cli_args(config, ['agent-status', *identity]), adb, 'status')
        state = result.get('session') if isinstance(result, dict) and result.get('success') is True else None
        if (code or not isinstance(state, dict) or state.get('sessionId') != identity[1]
                or state.get('screenMode') != 'virtual' or state.get('targetPackage') != config['appId']
                or state.get('state') not in solopi_ai.AGENT_TERMINAL_STATES
                or state.get('leaseHeld') is not False or state.get('cleanupPending') is not False):
            raise Error('virtual_cleanup_unconfirmed')
        return {'state': 'closed', 'cleanupConfirmed': True, 'recovered': True}

    def virtual_observe(self, _value):
        if self.virtual is None: raise Error("no_virtual_session")
        return self.virtual.observe()

    def virtual_act(self, value):
        if self.virtual is None: raise Error("no_virtual_session")
        return self.virtual.act(value)

    def virtual_preview(self, _value):
        if self.virtual is None: raise Error("no_virtual_session")
        return self.virtual.preview()

    def virtual_end(self, value):
        if self.virtual is None: raise Error("no_virtual_session")
        if not isinstance(value, dict) or set(value) - {'completed'} or type(value.get('completed', False)) is not bool:
            raise Error('invalid_virtual_end')
        result = self.virtual.close(completed=value.get('completed', False))
        self.virtual = None
        return result

    def dispatch(self, operation, payload):
        operations = {"discover": lambda _: self.discover(), "apps": self.apps, "connect": self.connect,
                      "command": self.command, "disconnect": lambda _: self.close(), "replay": self.replay,
                      "virtual_start": self.virtual_start, "virtual_observe": self.virtual_observe,
                      "virtual_act": self.virtual_act, "virtual_end": self.virtual_end,
                      "virtual_preview": self.virtual_preview, "virtual_recover": self.virtual_recover}
        if operation not in operations:
            raise Error("unsupported_desktop_operation")
        return operations[operation](payload)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts", required=True)
    args = parser.parse_args()
    control = DesktopControl(args.artifacts)
    def interrupt(_signal, _frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupt)
    try:
        while True:
            line = sys.stdin.buffer.readline(MAX_LINE + 1)
            if not line:
                break
            request = {}
            try:
                if len(line) > MAX_LINE:
                    raise Error("desktop_request_too_large")
                request = json.loads(line)
                if not isinstance(request, dict):
                    raise Error("invalid_desktop_request")
                result = control.dispatch(request.get("operation"), request.get("payload", {}))
                response = {"id": request.get("id"), "success": True, "data": result}
            except (Error, solopi_ai.CliError, verification_engine.VerificationError, ValueError, OSError) as exc:
                code = getattr(exc, "code", None)
                if not isinstance(code, str):
                    code = getattr(exc, "details", {}).get("errorCode", "desktop_operation_failed")
                response = {"id": request.get("id") if isinstance(request, dict) else None,
                            "success": False, "error": code}
                if control.virtual is not None:
                    response["cleanupPending"] = True
                elif isinstance(request, dict) and request.get("operation") == "virtual_start" and control.recorder is None:
                    # Code security: the start handler clears its owner only after close confirmed release.
                    response["cleanupConfirmed"] = True
                if control.recorder is not None and control.recorder.state == "interrupted":
                    control.close()
                    response["disconnected"] = True
            print(json.dumps(response, ensure_ascii=False), flush=True)
            if len(line) > MAX_LINE:
                break
    except KeyboardInterrupt:
        pass
    finally:
        control.close()


if __name__ == "__main__":
    main()
