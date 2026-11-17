"""Loopback WebDriverAgent driver for a single booted iOS Simulator."""

from __future__ import annotations

import base64
import http.client
import json
import os
import re
import shlex
import shutil
import subprocess
from pathlib import Path
import uuid
import xml.etree.ElementTree as ET
from typing import Any, Dict, Mapping, Optional

if __package__:
    from .native_runtime import NativeExecutionError
else:
    from native_runtime import NativeExecutionError


MAX_RESPONSE_BYTES = 32 * 1024 * 1024
ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf"
ELEMENT_ID = re.compile(r"[A-Za-z0-9-]{1,80}\Z")


def run_usb_wda(device_id: str, port: int, project: Path, derived_data: Path, artifacts: Path) -> Dict[str, Any]:
    """Foreground lifecycle for an already built, signed runner and its USB proxy."""
    driver = IOSPhysicalWDADriver(device_id, port)
    if driver.health().get("ready") is True:
        return {"success": True, "state": "already_running", "deviceId": device_id, "port": port}
    import socket
    import time
    if (not project.is_dir() or project.suffix != ".xcodeproj"
            or not derived_data.is_dir() or not list(derived_data.glob("Build/Products/*.xctestrun"))):
        raise NativeExecutionError("signed_wda_build_required")
    iproxy, xcodebuild = shutil.which("iproxy"), shutil.which("xcodebuild")
    if not iproxy or not xcodebuild:
        raise NativeExecutionError("wda_tools_missing")
    # Code security: never take over or kill an unrelated listener.
    with socket.socket() as listener:
        try:
            listener.bind(("127.0.0.1", port))
        except OSError as exc:
            raise NativeExecutionError("wda_port_in_use") from exc
    artifacts.mkdir(parents=True, exist_ok=False)
    processes = []
    try:
        with (artifacts / "proxy.log").open("wb") as proxy_log, (artifacts / "runner.log").open("wb") as runner_log:
            processes.append(subprocess.Popen([iproxy, "--udid", device_id, "--local", "--source", "127.0.0.1", "%d:8100" % port], stdout=proxy_log, stderr=subprocess.STDOUT))
            environment = os.environ.copy()
            environment.update(USE_IP="127.0.0.1", USE_PORT="8100")
            processes.append(subprocess.Popen([xcodebuild, "test-without-building", "-project", str(project.resolve()),
                                               "-scheme", "WebDriverAgentRunner", "-destination", "platform=iOS,id=" + device_id,
                                               "-derivedDataPath", str(derived_data.resolve()), "-quiet"],
                                              env=environment, stdout=runner_log, stderr=subprocess.STDOUT))
            deadline = time.monotonic() + 90
            ready = False
            while all(process.poll() is None for process in processes):
                if not ready:
                    ready = driver.health().get("ready") is True
                    if ready:
                        print(json.dumps({"event": "wda_ready", "deviceId": device_id, "port": port}), flush=True)
                    elif time.monotonic() > deadline:
                        raise NativeExecutionError("wda_start_timeout")
                time.sleep(0.5)
            raise NativeExecutionError("wda_process_exited")
    except KeyboardInterrupt:
        return {"success": True, "state": "stopped", "deviceId": device_id}
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


class IOSWDADriver:
    platform = "ios"
    supported_actions = frozenset({"click", "input", "longClick", "scroll", "back", "wait"})

    def __init__(self, device_id: str, port: int = 8100) -> None:
        if not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535:
            raise NativeExecutionError("invalid_wda_port")
        if not isinstance(device_id, str) or not ELEMENT_ID.fullmatch(device_id):
            raise NativeExecutionError("invalid_device_identity")
        self.device_id = device_id
        self.port = port
        self.session_id: Optional[str] = None
        self.app_id: Optional[str] = None

    def _request(self, method: str, path: str, body: Optional[Mapping[str, Any]] = None) -> Any:
        # Code security: fixed loopback host, validated path components, no redirects or shell.
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        try:
            payload = json.dumps(body).encode("utf-8") if body is not None else None
            connection.request(method, path, body=payload, headers={"Content-Type": "application/json"})
            response = connection.getresponse()
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise NativeExecutionError("wda_request_failed")
            envelope = json.loads(raw)
            if not isinstance(envelope, dict) or "value" not in envelope:
                raise NativeExecutionError("invalid_wda_response")
            value = envelope["value"]
            if (method == "GET" and path.endswith("/alert/text")
                    and isinstance(value, dict) and value.get("error") == "no such alert"):
                return None
            if response.status != 200:
                raise NativeExecutionError("wda_request_failed")
            if isinstance(value, dict) and value.get("error"):
                raise NativeExecutionError("wda_command_failed")
            return value
        except (OSError, TimeoutError, ValueError, http.client.HTTPException) as exc:
            raise NativeExecutionError("wda_transport_failed") from exc
        finally:
            connection.close()

    def _session_path(self, suffix: str) -> str:
        if not self.session_id or not ELEMENT_ID.fullmatch(self.session_id):
            raise NativeExecutionError("wda_session_missing")
        return "/session/%s%s" % (self.session_id, suffix)

    def health(self) -> Mapping[str, Any]:
        # Code security: bind the loopback listener PID to the selected simulator's runner.
        try:
            result = subprocess.run(
                ["xcrun", "simctl", "list", "devices", "booted", "--json"],
                capture_output=True, text=True, timeout=10, check=False,
            )
            listing = json.loads(result.stdout) if result.returncode == 0 else {}
            booted = any(
                item.get("udid") == self.device_id and item.get("state") == "Booted"
                for entries in listing.get("devices", {}).values() for item in entries
            )
            if not booted:
                return {"ready": False}
            listener = subprocess.run(
                ["lsof", "-nP", "-iTCP:%d" % self.port, "-sTCP:LISTEN", "-Fpun"],
                capture_output=True, text=True, timeout=10, check=False,
            )
            fields = listener.stdout.splitlines() if listener.returncode == 0 else []
            pids = {line[1:] for line in fields if line.startswith("p")}
            owners = {line[1:] for line in fields if line.startswith("u")}
            addresses = {line[1:] for line in fields if line.startswith("n")}
            if (len(pids) != 1 or owners != {str(os.getuid())}
                    or addresses != {"127.0.0.1:%d" % self.port}):
                return {"ready": False}
            jobs = subprocess.run(
                ["xcrun", "simctl", "spawn", self.device_id, "launchctl", "list"],
                capture_output=True, text=True, timeout=10, check=False,
            )
            owned = jobs.returncode == 0 and any(
                line.split("\t", 1)[0] in pids
                and "com.facebook.WebDriverAgentRunner.xctrunner" in line
                for line in jobs.stdout.splitlines()
            )
            status = self._request("GET", "/status") if owned else {}
            return {"ready": bool(status.get("ready") is True and status.get("device") == "iphone")}
        except (OSError, subprocess.TimeoutExpired, ValueError, TypeError, NativeExecutionError):
            return {"ready": False}

    def launch(self, app_id: str) -> None:
        if not isinstance(app_id, str) or not app_id or len(app_id) > 200:
            raise NativeExecutionError("invalid_app_id")
        if self.session_id:
            return
        created = self._request("POST", "/session", {
            "capabilities": {"alwaysMatch": {"bundleId": app_id}}
        })
        session_id = created.get("sessionId") if isinstance(created, dict) else None
        if not isinstance(session_id, str) or not ELEMENT_ID.fullmatch(session_id):
            raise NativeExecutionError("wda_session_missing")
        self.session_id = session_id
        self.app_id = app_id
        self._verify_app()

    def _verify_app(self) -> None:
        info = self._request("GET", self._session_path("/wda/activeAppInfo"))
        if not isinstance(info, dict) or info.get("bundleId") != self.app_id:
            raise NativeExecutionError("observation_identity_mismatch")
        # Code security: applies to simulators as well as USB devices.
        if self._request("GET", self._session_path("/alert/text")) is not None:
            raise NativeExecutionError("unexpected_alert")

    @staticmethod
    def _tree(element: ET.Element, app_id: str) -> Dict[str, Any]:
        attributes = element.attrib
        label = attributes.get("label", "")
        name = attributes.get("name", "")
        value = attributes.get("value", "")
        node: Dict[str, Any] = {
            "className": attributes.get("type", element.tag),
            "appId": app_id,
            "text": value or label or name,
            "description": label,
            "visible": attributes.get("visible") == "true",
            "enabled": attributes.get("enabled") == "true",
            "hittable": attributes.get("visible") == "true" and attributes.get("enabled") == "true",
            "bounds": [int(attributes.get(key, "0")) for key in ("x", "y", "width", "height")],
            "children": [IOSWDADriver._tree(child, app_id) for child in element],
        }
        if name and (attributes.get("accessible") == "true" or node["className"] in {
            "XCUIElementTypeScrollView", "XCUIElementTypeTable", "XCUIElementTypeCollectionView",
        }):
            node["accessibilityId"] = name
        return node

    def observe(self) -> Mapping[str, Any]:
        self._verify_app()
        source = self._request("GET", self._session_path("/source"))
        if not isinstance(source, str) or len(source) > 4 * 1024 * 1024 or "<!DOCTYPE" in source.upper():
            raise NativeExecutionError("invalid_wda_source")
        try:
            root = ET.fromstring(source)
            page = self._tree(root, self.app_id or "")
        except (ET.ParseError, ValueError, TypeError) as exc:
            raise NativeExecutionError("invalid_wda_source") from exc
        if root.attrib.get("bundleId") != self.app_id:
            raise NativeExecutionError("observation_identity_mismatch")
        return {
            "platform": self.platform, "deviceId": self.device_id,
            "appId": self.app_id, "windowId": "main",
            "observationId": uuid.uuid4().hex, "page": page,
        }

    def _element(self, target: Mapping[str, Any]) -> str:
        self._verify_app()
        name = target.get("accessibilityId")
        if not isinstance(name, str) or not name:
            raise NativeExecutionError("unsupported_selector")
        found = self._request("POST", self._session_path("/elements"), {
            "using": "accessibility id", "value": name,
        })
        if not isinstance(found, list) or len(found) > 256:
            raise NativeExecutionError("wda_element_missing")
        matches = []
        for item in found:
            element_id = item.get(ELEMENT_KEY) if isinstance(item, dict) else None
            if not isinstance(element_id, str) or not ELEMENT_ID.fullmatch(element_id):
                raise NativeExecutionError("wda_element_missing")
            role = self._request("GET", self._session_path("/element/" + element_id + "/attribute/type"))
            if role == target.get("className"):
                matches.append(element_id)
        if len(matches) != 1:
            raise NativeExecutionError("wda_element_missing")
        element_id = matches[0]
        base = self._session_path("/element/" + element_id)
        rect = self._request("GET", base + "/rect")
        bounds = target.get("bounds")
        if ([rect.get(key) for key in ("x", "y", "width", "height")] != bounds
                or self._request("GET", base + "/enabled") is not True
                or self._request("GET", base + "/displayed") is not True
                or self._request("GET", base + "/attribute/hittable") is not True):
            raise NativeExecutionError("target_changed")
        return base

    def perform(self, action: Mapping[str, Any], target: Optional[Mapping[str, Any]]) -> Mapping[str, Any]:
        kind = action["type"]
        if kind == "wait":
            import time
            time.sleep(action["durationMs"] / 1000.0)
        elif kind == "back":
            current = self.observe()["page"]
            buttons = []
            def find_back(node: Mapping[str, Any], in_navigation: bool = False) -> None:
                in_navigation = in_navigation or node.get("className") == "XCUIElementTypeNavigationBar"
                if (in_navigation and node.get("className") == "XCUIElementTypeButton"
                        and node.get("accessibilityId") in {"Back", "BackButton"}
                        and node.get("hittable")):
                    buttons.append(node)
                for child in node.get("children", []):
                    find_back(child, in_navigation)
            find_back(current)
            if len(buttons) != 1:
                raise NativeExecutionError("back_unavailable")
            self._request("POST", self._element(buttons[0]) + "/click", {})
        elif kind in {"click", "input", "longClick", "scroll"}:
            if target is None:
                raise NativeExecutionError("missing_selector")
            base = self._element(target)
            if kind == "click":
                self._request("POST", base + "/click", {})
            elif kind == "input":
                self._request("POST", base + "/clear", {})
                self._request("POST", base + "/value", {"text": action["text"]})
            elif kind == "longClick":
                self._request("POST", base.replace("/element/", "/wda/element/") + "/touchAndHold", {
                    "duration": action["durationMs"] / 1000.0,
                })
            else:
                self._request("POST", base.replace("/element/", "/wda/element/") + "/scroll", {
                    "direction": action["direction"], "distance": action["distance"] / 100.0,
                })
        else:
            raise NativeExecutionError("unsupported_action")
        return {"state": "succeeded", "deviceId": self.device_id, "wdaSessionId": self.session_id}

    def screenshot(self) -> bytes:
        encoded = self._request("GET", self._session_path("/screenshot"))
        if not isinstance(encoded, str) or len(encoded) > MAX_RESPONSE_BYTES:
            raise NativeExecutionError("invalid_screenshot")
        try:
            return base64.b64decode(encoded, validate=True)
        except (ValueError, base64.binascii.Error) as exc:
            raise NativeExecutionError("invalid_screenshot") from exc

    def close(self) -> None:
        if self.session_id:
            try:
                self._request("DELETE", self._session_path(""))
            finally:
                self.session_id = None


class IOSPhysicalWDADriver(IOSWDADriver):
    """WDA through an explicitly device-bound, current-user USB iproxy listener."""

    def health(self) -> Mapping[str, Any]:
        try:
            idevice_id = shutil.which("idevice_id")
            iproxy = shutil.which("iproxy")
            if not idevice_id or not iproxy:
                return {"ready": False}
            devices = subprocess.run([idevice_id, "-l"], capture_output=True, text=True,
                                     timeout=10, check=False)
            if devices.returncode != 0 or self.device_id not in devices.stdout.splitlines():
                return {"ready": False}
            listener = subprocess.run(
                ["lsof", "-nP", "-iTCP:%d" % self.port, "-sTCP:LISTEN", "-Fpun"],
                capture_output=True, text=True, timeout=10, check=False,
            )
            fields = listener.stdout.splitlines() if listener.returncode == 0 else []
            pids = {line[1:] for line in fields if line.startswith("p")}
            owners = {line[1:] for line in fields if line.startswith("u")}
            addresses = {line[1:] for line in fields if line.startswith("n")}
            if (len(pids) != 1 or owners != {str(os.getuid())}
                    or addresses != {"127.0.0.1:%d" % self.port}):
                return {"ready": False}
            process = subprocess.run(["ps", "-p", next(iter(pids)), "-o", "command="],
                                     capture_output=True, text=True, timeout=10, check=False)
            # Code security: accept only this exact USB-only proxy invocation for the selected UDID.
            expected = ["--udid", self.device_id, "--local", "--source", "127.0.0.1",
                        "%d:8100" % self.port]
            argv = shlex.split(process.stdout)
            if (process.returncode != 0 or not argv or argv[1:] != expected
                    or argv[0] not in {"iproxy", iproxy}):
                return {"ready": False}
            status = self._request("GET", "/status")
            return {"ready": status.get("ready") is True and status.get("device") == "iphone"}
        except (OSError, subprocess.TimeoutExpired, ValueError, TypeError, NativeExecutionError):
            return {"ready": False}
