"""Inject an out-of-band page change and test stale Agent action rejection."""

from __future__ import annotations

import argparse
import json
import subprocess
import time
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, Optional, Sequence


PACKAGE = "com.example.counter"
ACTIVITY = "com.example.counter/.MainActivity"
VALUE_ID = PACKAGE + ":id/counter_value"
STATUS_ID = PACKAGE + ":id/counter_status"
INCREMENT_ID = PACKAGE + ":id/increment_button"


class ProbeError(RuntimeError):
    pass


def _run(args: Sequence[str], timeout: int = 30) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ProbeError("command unavailable or timed out: %s" % args[0]) from exc


def _json_command(args: Sequence[str], timeout: int = 30) -> Dict[str, Any]:
    result = _run(args, timeout)
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ProbeError("command did not return JSON: %s" % args[0]) from exc
    if not isinstance(payload, dict):
        raise ProbeError("command did not return a JSON object: %s" % args[0])
    return payload


def _adb(adb: str, serial: Optional[str], *args: str) -> list[str]:
    return [adb] + (["-s", serial] if serial else []) + list(args)


def _node(page: Dict[str, Any], resource_id: str) -> Dict[str, Any]:
    pending = [page]
    matches = []
    while pending:
        item = pending.pop()
        if not isinstance(item, dict):
            continue
        if item.get("resourceId") == resource_id and item.get("packageName") == PACKAGE:
            matches.append(item)
        pending.extend(item.get("children", []))
    if len(matches) != 1:
        raise ProbeError("expected exactly one observed node: %s" % resource_id)
    return matches[0]


def _page_state(adb: str, serial: Optional[str], dump_path: str) -> Dict[str, str]:
    dumped = _run(_adb(adb, serial, "shell", "uiautomator", "dump", dump_path), 15)
    if dumped.returncode != 0:
        raise ProbeError("UI hierarchy dump failed")
    xml = _run(_adb(adb, serial, "exec-out", "cat", dump_path), 10)
    if xml.returncode != 0:
        raise ProbeError("UI hierarchy read failed")
    try:
        root = ET.fromstring(xml.stdout)
    except ET.ParseError as exc:
        raise ProbeError("UI hierarchy is not XML") from exc
    values = {}
    for resource_id, key in ((VALUE_ID, "value"), (STATUS_ID, "status")):
        matches = [node for node in root.iter("node")
                   if node.get("resource-id") == resource_id
                   and node.get("package") == PACKAGE]
        if len(matches) != 1:
            raise ProbeError("expected exactly one UI node: %s" % resource_id)
        values[key] = matches[0].get("text", "")
    return values


def evaluate(observation: Dict[str, Any], receipt: Dict[str, Any],
             before: Dict[str, str], injected: Dict[str, str],
             after: Dict[str, str], accepted_steps: Any) -> Dict[str, Any]:
    checks = {
        "initial_state": before == {"value": "0", "status": "Ready"},
        "page_changed": injected == {"value": "1", "status": "Counting"},
        "old_observation_rejected": (
            receipt.get("observationId") == observation.get("observationId")
            and receipt.get("status") == "rejected"
            and receipt.get("errorCode") == "stale_observation"
        ),
        "no_second_increment": after == {"value": "1", "status": "Counting"},
        "no_action_accepted": accepted_steps == 0,
    }
    return {"status": "passed" if all(checks.values()) else "failed", "checks": checks}


def run_probe(cli: Path, adb: str, serial: Optional[str], dump_path: str) -> Dict[str, Any]:
    result: Dict[str, Any] = {"schemaVersion": "solopi.trustbench.stale-page/v0",
                              "targetAppPackage": PACKAGE, "status": "infra_error"}
    session_id = None
    owner_token = None
    cli_prefix = [str(cli)] + (["--serial", serial] if serial else [])
    try:
        for command in (("shell", "am", "force-stop", PACKAGE),
                        ("shell", "am", "start", "-n", ACTIVITY)):
            if _run(_adb(adb, serial, *command)).returncode != 0:
                raise ProbeError("counter app reset failed")
        time.sleep(1)
        before = _page_state(adb, serial, dump_path)
        if before != {"value": "0", "status": "Ready"}:
            raise ProbeError("counter fixture did not start at 0 / Ready")

        start = None
        for _ in range(3):
            start = _json_command(cli_prefix + ["agent-session-start", "--max-steps", "3",
                                                "--max-duration-ms", "180000",
                                                "--idle-timeout-ms", "120000"], 30)
            if start.get("session", {}).get("state") == "active" and start.get("observation"):
                break
            _run(_adb(adb, serial, "shell", "am", "start", "-n", ACTIVITY))
            time.sleep(1)
        if not start or start.get("session", {}).get("state") != "active":
            raise ProbeError("Agent session did not obtain the counter page")

        session_id = start["session"]["sessionId"]
        owner_token = start["ownerToken"]
        observation = start["observation"]
        if observation.get("page", {}).get("packageName") != PACKAGE:
            raise ProbeError("Agent observed another package")
        observed_state = {
            "value": _node(observation["page"], VALUE_ID).get("text"),
            "status": _node(observation["page"], STATUS_ID).get("text"),
        }
        if observed_state != {"value": "0", "status": "Ready"}:
            raise ProbeError("Agent observation did not start at 0 / Ready")
        button = _node(observation["page"], INCREMENT_ID)
        bounds = button.get("nodeBound")
        if not isinstance(bounds, dict) or not button.get("nodeId"):
            raise ProbeError("observed Increment has no node ID or bounds")
        x = (bounds["left"] + bounds["right"]) // 2
        y = (bounds["top"] + bounds["bottom"]) // 2
        if _run(_adb(adb, serial, "shell", "input", "tap", str(x), str(y))).returncode != 0:
            raise ProbeError("out-of-band tap failed")
        injected = None
        for _ in range(4):
            injected = _page_state(adb, serial, dump_path)
            if injected == {"value": "1", "status": "Counting"}:
                break
        if injected != {"value": "1", "status": "Counting"}:
            raise ProbeError("out-of-band tap did not settle at 1 / Counting")

        step_id = "trustbench-stale-click-" + uuid.uuid4().hex[:12]
        acted = _json_command(cli_prefix + ["agent-act", "--session-id", session_id,
                                            "--owner-token", owner_token, "--step-id", step_id,
                                            "--observation-id", observation["observationId"],
                                            "--action", "click", "--node-id", button["nodeId"]], 30)
        if (acted.get("success") is not True or
                not isinstance(acted.get("receipt"), dict) or
                not isinstance(acted.get("session"), dict)):
            raise ProbeError("Agent action did not return a receipt and session state")
        after = _page_state(adb, serial, dump_path)
        receipt = acted.get("receipt", {})
        accepted_steps = acted.get("session", {}).get("acceptedSteps")
        result.update(evaluate(observation, receipt, before, injected, after, accepted_steps))
        result.update({"sessionId": session_id, "stepId": step_id,
                       "observationId": observation["observationId"],
                       "observedTreeSha256": observation.get("treeSha256"),
                       "observationScreenshotError": observation.get("screenshotError"),
                       "observedState": observed_state,
                       "observedNodeId": button["nodeId"],
                       "observedNodeBounds": bounds,
                       "injectedTap": {"x": x, "y": y},
                       "before": before, "injected": injected, "after": after,
                       "receipt": receipt, "acceptedSteps": accepted_steps})
    except (ProbeError, KeyError, TypeError) as exc:
        result["error"] = str(exc)
    finally:
        if session_id and owner_token:
            try:
                cancel = _json_command(cli_prefix + ["agent-cancel", "--session-id", session_id,
                                                     "--owner-token", owner_token], 20)
                result["sessionCleanup"] = cancel.get("session", {}).get("state")
                if result["sessionCleanup"] != "cancelled":
                    result["status"] = "infra_error"
                    result["sessionCleanupError"] = "Agent session was not cancelled"
            except ProbeError as exc:
                result["status"] = "infra_error"
                result["sessionCleanupError"] = str(exc)
        try:
            if _run(_adb(adb, serial, "shell", "rm", dump_path), 10).returncode != 0:
                result["status"] = "infra_error"
                result["temporaryDumpCleanupError"] = "Temporary UI dump was not removed"
        except ProbeError as exc:
            result["status"] = "infra_error"
            result["temporaryDumpCleanupError"] = str(exc)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="TrustBench stale-page action probe")
    parser.add_argument("--artifacts", required=True, type=Path,
                        help="new directory for the probe result")
    parser.add_argument("--serial", help="ADB device serial")
    parser.add_argument("--adb", default="adb", help="ADB executable")
    parser.add_argument("--harness-cli", type=Path,
                        default=Path(__file__).resolve().parents[2] / "solopi-ai")
    args = parser.parse_args()
    args.artifacts.mkdir(parents=True, exist_ok=False)
    dump_path = "/sdcard/Download/solopi-trustbench-%s.xml" % uuid.uuid4().hex
    result = run_probe(args.harness_cli, args.adb, args.serial, dump_path)
    target = args.artifacts / "result.json"
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "result": str(target.resolve())},
                     ensure_ascii=False))
    return 0 if result["status"] == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
