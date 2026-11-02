"""Constrained HarmonyOS NEXT emulator driver using the bundled HDC uitest CLI."""

from __future__ import annotations

import json
import re
import shlex
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any, Mapping, Optional

if __package__:
    from .native_runtime import NativeExecutionError
else:
    from native_runtime import NativeExecutionError


DEVICE_ID = re.compile(r"[A-Za-z0-9._:-]{1,100}\Z")
APP_ID = re.compile(r"[A-Za-z0-9_.]{1,200}\Z")
BOUNDS = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\Z")
MAX_LAYOUT_BYTES = 8 * 1024 * 1024
MAX_IMAGE_BYTES = 32 * 1024 * 1024


def find_hdc() -> Optional[str]:
    executable = shutil.which("hdc")
    if executable:
        return executable
    sdk = Path.home() / "Library" / "Huawei"
    matches = sorted(sdk.glob("command-line-tools-*/sdk/default/openharmony/toolchains/hdc"))
    return str(matches[-1]) if matches else None


class HarmonyHDCDriver:
    platform = "harmony_next"
    supported_actions = frozenset({"click", "input", "scroll", "back", "wait"})

    def __init__(self, device_id: str, hdc: Optional[str] = None) -> None:
        if not isinstance(device_id, str) or not DEVICE_ID.fullmatch(device_id):
            raise NativeExecutionError("invalid_device_identity")
        executable = hdc or find_hdc()
        if not executable or not Path(executable).is_file():
            raise NativeExecutionError("hdc_unavailable")
        self.device_id = device_id
        self.hdc = executable
        self.app_id: Optional[str] = None
        self._last_window: Optional[str] = None

    def _run(self, *args: str, timeout: int = 15) -> str:
        # Code security: fixed HDC executable and argument vector; no host shell.
        # HDC shell has its own argument handling. Send one shell command with
        # every argument quoted exactly once, rather than double-quoting text argv.
        device_args = ["shell", shlex.join(args[1:])] if args and args[0] == "shell" else list(args)
        try:
            result = subprocess.run(
                [self.hdc, "-t", self.device_id, *device_args],
                capture_output=True, text=True, timeout=timeout, check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise NativeExecutionError("hdc_transport_failed") from exc
        if result.returncode != 0 or "error:" in result.stdout.lower():
            raise NativeExecutionError("hdc_command_failed")
        return result.stdout

    def health(self) -> Mapping[str, Any]:
        try:
            result = subprocess.run(
                [self.hdc, "list", "targets"], capture_output=True,
                text=True, timeout=10, check=False,
            )
            ready = result.returncode == 0 and self.device_id in result.stdout.splitlines()
            return {"ready": ready}
        except (OSError, subprocess.TimeoutExpired):
            return {"ready": False}

    def launch(self, app_id: str) -> None:
        if not isinstance(app_id, str) or not APP_ID.fullmatch(app_id):
            raise NativeExecutionError("invalid_app_id")
        output = self._run("shell", "aa", "start", "-a", "EntryAbility", "-b", app_id)
        if "successfully" not in output:
            raise NativeExecutionError("app_launch_failed")
        self.app_id = app_id

    def _receive(self, command: tuple[str, ...], suffix: str, limit: int) -> bytes:
        remote = "/data/local/tmp/solopi-%s.%s" % (uuid.uuid4().hex, suffix)
        with tempfile.TemporaryDirectory(prefix="solopi-harmony-") as directory:
            local = Path(directory) / ("capture." + suffix)
            try:
                self._run("shell", "uitest", *command, "-p", remote)
                self._run("file", "recv", remote, str(local))
                if local.stat().st_size > limit:
                    raise NativeExecutionError("capture_too_large")
                return local.read_bytes()
            except OSError as exc:
                raise NativeExecutionError("capture_failed") from exc
            finally:
                try:
                    self._run("shell", "rm", "-f", remote)
                except NativeExecutionError:
                    pass

    @staticmethod
    def _bounds(value: Any) -> list[int]:
        match = BOUNDS.fullmatch(value) if isinstance(value, str) else None
        if not match:
            raise NativeExecutionError("invalid_layout")
        x1, y1, x2, y2 = (int(part) for part in match.groups())
        if x2 < x1 or y2 < y1:
            raise NativeExecutionError("invalid_layout")
        return [x1, y1, x2 - x1, y2 - y1]

    @classmethod
    def _tree(cls, source: Mapping[str, Any], app_id: str) -> dict[str, Any]:
        attributes = source.get("attributes")
        children = source.get("children")
        if not isinstance(attributes, dict) or not isinstance(children, list):
            raise NativeExecutionError("invalid_layout")
        node = {
            "appId": app_id, "id": attributes.get("id", ""),
            "accessibilityId": attributes.get("accessibilityId", ""),
            "className": attributes.get("type", ""),
            "text": attributes.get("text", ""),
            "description": attributes.get("description", ""),
            "bounds": cls._bounds(attributes.get("bounds")),
            "visible": attributes.get("visible") == "true",
            "enabled": attributes.get("enabled") == "true",
            "clickable": attributes.get("clickable") == "true",
            "scrollable": attributes.get("scrollable") == "true",
            "hittable": all(attributes.get(key) == "true" for key in
                            ("visible", "enabled")),
            "children": [cls._tree(child, app_id) for child in children],
        }
        return node

    def observe(self) -> Mapping[str, Any]:
        if not self.app_id:
            raise NativeExecutionError("app_not_launched")
        raw = self._receive(("dumpLayout",), "json", MAX_LAYOUT_BYTES)
        try:
            layout = json.loads(raw)
            roots = layout["children"]
            app_roots = [root for root in roots
                         if root["attributes"].get("bundleName") == self.app_id]
            if len(app_roots) != 1:
                raise NativeExecutionError("observation_identity_mismatch")
            attributes = app_roots[0]["attributes"]
            if attributes.get("focused") != "true" or attributes.get("visible") != "true":
                raise NativeExecutionError("app_not_foreground")
            window = attributes.get("hostWindowId")
            if not isinstance(window, str) or not window:
                raise NativeExecutionError("invalid_layout")
            page = self._tree(app_roots[0], self.app_id)
            blockers = [self._bounds(root["attributes"].get("bounds")) for root in roots
                        if root is not app_roots[0] and root["attributes"].get("visible") == "true"]
        except (ValueError, TypeError, KeyError, RecursionError) as exc:
            raise NativeExecutionError("invalid_layout") from exc
        self._last_window = window
        return {
            "platform": self.platform, "deviceId": self.device_id,
            "appId": self.app_id, "windowId": window,
            "observationId": uuid.uuid4().hex, "page": page,
            "blockingWindows": blockers,
        }

    def perform(self, action: Mapping[str, Any], target: Optional[Mapping[str, Any]]) -> Mapping[str, Any]:
        kind = action["type"]
        if kind == "wait":
            import time
            time.sleep(action["durationMs"] / 1000.0)
        elif kind == "back":
            # Recheck the foreground app; never send a global Back from a stale page.
            self.observe()
            self._run("shell", "uitest", "uiInput", "keyEvent", "Back")
        elif kind in {"click", "input", "scroll"} and target is not None:
            node_id = target.get("id")
            if not isinstance(node_id, str) or not node_id:
                raise NativeExecutionError("unsupported_selector")
            expected_window = self._last_window
            fresh = self.observe()
            if fresh["windowId"] != expected_window:
                raise NativeExecutionError("window_changed")
            matches = []
            def collect(node: Mapping[str, Any]) -> None:
                if node.get("id") == node_id:
                    matches.append(node)
                for child in node.get("children", []):
                    collect(child)
            collect(fresh["page"])
            if (len(matches) != 1 or matches[0]["bounds"] != target.get("bounds")
                    or any(matches[0].get(key) != target.get(key)
                           for key in ("text", "className", "accessibilityId"))
                    or matches[0]["hittable"] is not True):
                raise NativeExecutionError("target_changed")
            x, y, width, height = matches[0]["bounds"]
            node = matches[0]
            cx, cy = x + width // 2, y + height // 2
            if width <= 0 or height <= 0 or any(
                bx <= cx < bx + bw and by <= cy < by + bh
                for bx, by, bw, bh in fresh["blockingWindows"]
            ):
                raise NativeExecutionError("target_occluded")
            if kind == "click":
                if not node["clickable"]:
                    raise NativeExecutionError("target_not_clickable")
                self._run("shell", "uitest", "uiInput", kind, str(cx), str(cy))
            elif kind == "input":
                if node["className"] not in {"TextInput", "TextArea", "Search"}:
                    raise NativeExecutionError("target_not_editable")
                if node["text"]:
                    raise NativeExecutionError("input_replace_unavailable")
                text = action["text"]
                # uitest uiInput has an additional tokenizer: shell quoting alone
                # does not preserve spaces/quotes on all SDKs. Reject rather than truncate.
                if (not text or len(text) > 4096
                        or not all(c.isalnum() or c in "_-./@" for c in text)):
                    raise NativeExecutionError("unsupported_input_text")
                # Code security: HDC joins device-shell argv. Quote for that shell too.
                self._run("shell", "uitest", "uiInput", "inputText",
                          str(cx), str(cy), text)
            else:
                if not node["scrollable"]:
                    raise NativeExecutionError("target_not_scrollable")
                distance = action["distance"] / 100.0
                dx = int(width * distance / 2) if action["direction"] in {"left", "right"} else 0
                dy = int(height * distance / 2) if action["direction"] in {"up", "down"} else 0
                if action["direction"] in {"right", "down"}:
                    dx, dy = -dx, -dy
                start, end = (cx + dx, cy + dy), (cx - dx, cy - dy)
                # Reject any window intersecting the whole gesture, including its endpoints.
                if any(max(min(start[0], end[0]), bx) <= min(max(start[0], end[0]), bx + bw)
                       and max(min(start[1], end[1]), by) <= min(max(start[1], end[1]), by + bh)
                       for bx, by, bw, bh in fresh["blockingWindows"]):
                    raise NativeExecutionError("target_occluded")
                if start == end:
                    raise NativeExecutionError("invalid_scroll_distance")
                self._run("shell", "uitest", "uiInput", "swipe",
                          *(str(v) for v in (*start, *end)))
        else:
            raise NativeExecutionError("unsupported_action")
        return {"state": "succeeded", "deviceId": self.device_id}

    def screenshot(self) -> bytes:
        return self._receive(("screenCap",), "png", MAX_IMAGE_BYTES)

    def close(self) -> None:
        self.app_id = None
