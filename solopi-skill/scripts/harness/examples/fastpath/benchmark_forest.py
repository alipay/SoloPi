#!/usr/bin/env python3
"""Paired SoloPi runtime benchmark on an already-open Alipay Forest page.

Both arms use the same deterministic choices, checks, screenshots and cleanup.
Raw artifacts contain private UI data. Share an audited summary, not this folder.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

CLI = Path(__file__).resolve().parents[3] / "solopi-ai"
PACKAGE = "com.eg.android.AlipayGphone"
TITLE = "com.alipay.multiplatform.phone.xriver_integration:id/textView_title"
MENU = {"攻略", "分享", "帮助", "设置"}
FLOWS = {
    "menu_roundtrip": [("menu", "menu"), ("back", "forest")],
    "settings_roundtrip": [("menu", "menu"), ("settings", "settings"), ("back", "forest")],
}


def nodes(node, parents=()):
    yield node, parents
    for child in node.get("children", []):
        yield from nodes(child, parents + (node,))


def checkpoint(observation, expected):
    page = observation.get("page", {})
    if page.get("packageName") != PACKAGE:
        return False
    visible = [n for n, _ in nodes(page) if n.get("isVisibleToUser")]
    labels = {n.get("text") for n in visible}
    titles = {n.get("text") for n in visible if n.get("resourceId") == TITLE}
    if expected == "menu":
        return MENU.issubset(labels) and len(visible) <= 30
    if expected == "forest":
        return "蚂蚁森林" in titles and not MENU.issubset(labels)
    if expected == "settings":
        return "设置" in titles and {"能量相关提醒", "接收能量可收取提醒"}.issubset(labels)
    return False


def select(observation, action):
    if action == "back":
        return {"type": "back"}
    hits = []
    for node, parents in nodes(observation["page"]):
        if not node.get("isVisibleToUser") or not node.get("isEnabled"):
            continue
        match = (node.get("description") == "更多" and not node.get("text")
                 and node.get("isClickable")) if action == "menu" else (
                 node.get("text") == "设置" and node.get("resourceId") == "com.alipay.mobile.antui:id/item_name")
        if match:
            target = node if node.get("isClickable") else next(
                (p for p in reversed(parents) if p.get("isClickable")
                 and p.get("isVisibleToUser") and p.get("isEnabled")), None)
            if target and target.get("packageName") == PACKAGE:
                hits.append(target)
    if len(hits) != 1:
        raise ValueError("target_missing_or_ambiguous")
    return {"type": "click", "nodeId": hits[0]["nodeId"]}


class Run:
    def __init__(self, directory, serial):
        self.directory, self.serial = directory, serial
        self.calls = []

    def call(self, tag, args):
        started = time.perf_counter()
        # Code security: fixed executable, typed argument array, no shell or raw Scheme.
        result = subprocess.run([str(CLI), "--serial", self.serial] + args,
                                capture_output=True, text=True, timeout=75, check=False)
        elapsed = (time.perf_counter() - started) * 1000
        (self.directory / (tag + ".json")).write_text(result.stdout)
        self.calls.append({"stage": tag, "wallMs": elapsed, "exitCode": result.returncode})
        return json.loads(result.stdout), result.returncode

    def execute(self, strategy, flow, validation="full-page"):
        started = time.perf_counter()
        identity = []
        row = {"strategy": strategy, "actionValidation": validation,
               "flow": flow, "status": "failed", "checks": [],
               "actions": [], "modelCalls": 0, "interactionMs": None,
               "cleanupSucceeded": False}
        try:
            start, code = self.call("start", ["agent-session-start", "--max-steps", "12",
                "--max-duration-ms", "120000", "--idle-timeout-ms", "30000",
                "--settle-strategy", strategy, "--action-validation-strategy", validation])
            if start.get("ownerToken") and start.get("session", {}).get("sessionId"):
                identity = ["--session-id", start["session"]["sessionId"], "--owner-token", start["ownerToken"]]
            if code or start.get("session", {}).get("state") != "active":
                raise ValueError("session_start_failed")
            observation = start["observation"]
            if not checkpoint(observation, "forest"):
                raise ValueError("initial_forest_precondition_failed")
            interaction_started = time.perf_counter()
            for index, (action, expected) in enumerate(FLOWS[flow]):
                for attempt in range(3):
                    proposal = select(observation, action)
                    args = ["agent-act"] + identity + ["--step-id", "step-" + uuid.uuid4().hex,
                        "--observation-id", observation["observationId"], "--action", proposal["type"]]
                    if "nodeId" in proposal:
                        args += ["--node-id", proposal["nodeId"]]
                    response, code = self.call("action-%d-attempt-%d" % (index, attempt), args)
                    receipt = response.get("receipt", {})
                    if receipt.get("status") != "rejected" or receipt.get("errorCode") != "stale_observation":
                        break
                    row.setdefault("staleRejections", []).append({"step": index, "attempt": attempt,
                        "validation": receipt.get("actionValidation")})
                    if attempt == 2:
                        break
                    # Rejected stale actions did not execute. Observe and choose again;
                    # never retry a failed/uncertain mutation or reuse the old node ID.
                    refresh, refresh_code = self.call("refresh-%d-%d" % (index, attempt), ["agent-observe"] + identity)
                    if refresh_code:
                        raise ValueError("stale_refresh_failed")
                    observation = refresh["observation"]
                observation = receipt.get("settledObservation", {})
                row["actions"].append({"action": action, "status": receipt.get("status"),
                    "validation": receipt.get("actionValidation"),
                    "effect": observation.get("actionEffect"), "settle": observation.get("settleTiming")})
                passed = not code and receipt.get("status") == "succeeded" and checkpoint(observation, expected)
                row["checks"].append({"expected": expected, "passed": passed})
                if not passed:
                    row["interactionTimeToFailureMs"] = (time.perf_counter() - interaction_started) * 1000
                    raise ValueError("action_or_checkpoint_failed")
            row["interactionMs"] = (time.perf_counter() - interaction_started) * 1000
            # Independent fresh observation is outside the interaction clock, inside the session clock.
            fresh, code = self.call("independent-observe", ["agent-observe"] + identity)
            row["independentCheck"] = not code and checkpoint(fresh.get("observation", {}), "forest")
            _, shot_code = self.call("screenshot", ["screenshot", "--output", str(self.directory / "final.png")])
            if not row["independentCheck"] or shot_code:
                raise ValueError("independent_evidence_failed")
            row["status"] = "passed"
        except (ValueError, KeyError, subprocess.TimeoutExpired) as error:
            # Code security: no exception body, command arguments or owner tokens in shareable summaries.
            row["failureClass"] = type(error).__name__
        finally:
            if identity:
                if row["status"] != "passed":
                    fresh, code = self.call("failure-observe", ["agent-observe"] + identity)
                    row["stateRestored"] = not code and checkpoint(fresh.get("observation", {}), "forest")
                terminal, code = self.call("end", ["agent-end"] + identity)
                session = terminal.get("session", {})
                row["cleanupSucceeded"] = not code and session.get("terminal") is True and session.get("leaseHeld") is False
            if not row["cleanupSucceeded"]:
                row["status"] = "failed"
            row["sessionMs"] = (time.perf_counter() - started) * 1000
            row["calls"] = self.calls
            (self.directory / "metrics.json").write_text(json.dumps(row, ensure_ascii=False, indent=2))
        return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--pairs", type=int, default=3)
    parser.add_argument("--comparison", choices=["wait", "scoped"], default="wait",
                        help="wait changes only settling; scoped also opts into guarded native clicks")
    args = parser.parse_args()
    if not 1 <= args.pairs <= 10 or not CLI.is_file():
        parser.error("Invalid pairs or repository skill entry")
    # Raw trees and ownership receipts stay private and existing results are never overwritten.
    os.umask(0o077)
    args.output.mkdir(parents=True, exist_ok=False)
    profiles = [("legacy", "full-page"), ("event-stable-v1",
                "target-context-v1" if args.comparison == "scoped" else "full-page")]
    protocol = {"flows": FLOWS, "pairs": args.pairs, "comparison": args.comparison,
        "profiles": [{"settle": s, "validation": v} for s, v in profiles],
        "selection": "identical deterministic rules; no inference",
        "interactionScope": "first choice through all in-loop checkpoints; includes CLI transport and settling",
        "sessionScope": "session start through fresh independent check, screenshot and end; final metrics write excluded",
        "excludedFromBoth": ["initial launch/navigation to Forest", "model loading", "human preparation"],
        "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "stalePolicy": "at most 3 fresh choices per step; only rejected stale_observation may refresh; all costs included",
        "failurePolicy": "retain every attempt; continue only if independently observed back at initial Forest state and own lease released"}
    (args.output / "protocol.json").write_text(json.dumps(protocol, ensure_ascii=False, indent=2))
    gate = Run(args.output, args.serial)
    doctor, code = gate.call("doctor", ["doctor"])
    if code or doctor.get("success") is not True:
        raise SystemExit("Device not ready; see private doctor receipt")
    capabilities, code = gate.call("capabilities", ["capabilities"])
    if code or not {s for s, _ in profiles}.issubset(capabilities.get("settleStrategies", [])):
        raise SystemExit("Device does not declare both strategies")
    if not {v for _, v in profiles}.issubset(capabilities.get("actionValidationStrategies", [])):
        raise SystemExit("Device does not declare the requested validation profiles")
    rows = []
    for pair in range(args.pairs):
        for flow in FLOWS:
            order = profiles if pair % 2 == 0 else list(reversed(profiles))
            for strategy, validation in order:
                name = "%02d-%s-%s-%s" % (pair + 1, flow, strategy, validation)
                directory = args.output / name
                directory.mkdir()
                row = Run(directory, args.serial).execute(strategy, flow, validation)
                row.update(pair=pair + 1, run=name)
                rows.append(row)
                (args.output / "results.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2))
                print(name, row["status"], "interactionMs", row["interactionMs"], "sessionMs", row["sessionMs"], flush=True)
                if row["status"] != "passed" and not (row.get("stateRestored") and row["cleanupSucceeded"]):
                    raise SystemExit("Attempt retained; inspect and recover before a new experiment")


if __name__ == "__main__":
    main()
