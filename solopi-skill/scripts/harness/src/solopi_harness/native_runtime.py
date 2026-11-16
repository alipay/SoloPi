"""Host-side native device contract for iOS and HarmonyOS NEXT verification."""

from __future__ import annotations

import copy
import hashlib
import json
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Protocol, Sequence

if __package__:
    from . import verification_engine
    from . import timing
else:
    import verification_engine
    import timing


NATIVE_PLATFORMS = frozenset({"ios", "harmony_next"})
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_SCREENSHOT_BYTES = 32 * 1024 * 1024


class NativeExecutionError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def create_driver(platform: str, device_id: str, device_kind: str, wda_port: int = 8100) -> NativeDriver:
    if device_kind not in {"physical", "simulator"}:
        raise NativeExecutionError("invalid_device_kind")
    if platform == "ios":
        if __package__:
            from .ios_wda import IOSPhysicalWDADriver, IOSWDADriver
        else:
            from ios_wda import IOSPhysicalWDADriver, IOSWDADriver
        return (IOSPhysicalWDADriver if device_kind == "physical" else IOSWDADriver)(device_id, wda_port)
    if platform == "harmony_next":
        if __package__:
            from .harmony_hdc import HarmonyHDCDriver
        else:
            from harmony_hdc import HarmonyHDCDriver
        if device_kind != "simulator" or not device_id.startswith("127.0.0.1:"):
            raise NativeExecutionError("physical_harmony_not_validated")
        return HarmonyHDCDriver(device_id)
    raise NativeExecutionError("unsupported_platform")


def native_doctor(platform: str) -> Dict[str, Any]:
    if platform not in NATIVE_PLATFORMS:
        raise NativeExecutionError("unsupported_platform")
    if platform == "harmony_next":
        if __package__:
            from .harmony_hdc import HarmonyHDCDriver, find_hdc
        else:
            from harmony_hdc import HarmonyHDCDriver, find_hdc
        executable = find_hdc()
        devices: list[str] = []
        discovery_error = None
        if executable:
            try:
                result = subprocess.run([executable, "list", "targets"], capture_output=True,
                                        text=True, timeout=10, check=False)
                if result.returncode == 0:
                    devices = [line.strip() for line in result.stdout.splitlines()
                               if line.strip() and line.strip().lower() not in {"empty", "[empty]"}]
                else:
                    discovery_error = "device_discovery_failed"
            except (OSError, subprocess.TimeoutExpired):
                discovery_error = "device_discovery_failed"
        simulators = []
        for device in devices:
            if device.startswith("127.0.0.1:"):
                ready = HarmonyHDCDriver(device, executable).health().get("ready") is True
                simulators.append({"deviceId": device, "driverReady": ready})
        simulator_ready = any(item["driverReady"] for item in simulators)
        return {
            "platform": platform, "discoveryTool": "hdc",
            "discoveryToolAvailable": executable is not None,
            "devices": [device for device in devices if not device.startswith("127.0.0.1:")],
            "simulators": simulators, "runnerReady": simulator_ready,
            "driverReady": simulator_ready,
            "availableActions": sorted(HarmonyHDCDriver.supported_actions) if simulator_ready else [],
            "missing": (["discovery_tool"] if executable is None else [])
                       + ([discovery_error] if discovery_error else [])
                       + ([] if simulator_ready else ["native_driver"]),
        }
    tool = "idevice_id" if platform == "ios" else "hdc"
    executable = shutil.which(tool)
    devices: list[str] = []
    simulators: list[Dict[str, str]] = []
    discovery_error: Optional[str] = None
    if executable:
        command = [executable, "-l"] if platform == "ios" else [executable, "list", "targets"]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=10, check=False)
            if result.returncode == 0:
                devices = [line.strip() for line in result.stdout.splitlines()
                           if line.strip() and line.strip().lower() not in {"empty", "[empty]"}]
            else:
                discovery_error = "device_discovery_failed"
        except (OSError, subprocess.TimeoutExpired):
            discovery_error = "device_discovery_failed"
    if platform == "ios":
        xcrun = shutil.which("xcrun")
        if xcrun:
            try:
                # Code security: fixed executable and argv; simulator output is parsed as data.
                result = subprocess.run(
                    [xcrun, "simctl", "list", "devices", "booted", "--json"],
                    capture_output=True, text=True, timeout=10, check=False,
                )
                if result.returncode == 0:
                    listing = json.loads(result.stdout)
                    for runtime, entries in listing.get("devices", {}).items():
                        for entry in entries:
                            if entry.get("state") == "Booted" and entry.get("isAvailable") is True:
                                simulators.append({
                                    "deviceId": entry["udid"], "name": entry["name"],
                                    "runtime": runtime,
                                })
            except (OSError, subprocess.TimeoutExpired, ValueError, KeyError, TypeError):
                discovery_error = "simulator_discovery_failed"
    simulator_ready = False
    if platform == "ios" and simulators:
        if __package__:
            from .ios_wda import IOSWDADriver
        else:
            from ios_wda import IOSWDADriver
        for simulator in simulators:
            ready = IOSWDADriver(simulator["deviceId"]).health().get("ready") is True
            simulator["driverReady"] = ready
            simulator_ready = simulator_ready or ready
    return {
        "platform": platform,
        "discoveryTool": tool,
        "discoveryToolAvailable": executable is not None,
        "devices": devices,
        "simulators": simulators,
        "runnerReady": simulator_ready,
        "driverReady": simulator_ready,
        "availableActions": sorted(IOSWDADriver.supported_actions) if simulator_ready else [],
        "missing": (["discovery_tool"] if executable is None else [])
                   + ([discovery_error] if discovery_error else [])
                   + (["physical_device"] if not devices else [])
                   + ([] if simulator_ready else ["signed_test_runner", "native_driver"]),
    }


class NativeDriver(Protocol):
    platform: str
    device_id: str

    def health(self) -> Mapping[str, Any]: ...

    def launch(self, app_id: str) -> None: ...

    def observe(self) -> Mapping[str, Any]: ...

    def perform(self, action: Mapping[str, Any], target: Optional[Mapping[str, Any]]) -> Mapping[str, Any]: ...

    def screenshot(self) -> bytes: ...


def _nodes(root: Any):
    if isinstance(root, dict):
        yield root
        children = root.get("children", [])
        if isinstance(children, list):
            for child in children:
                yield from _nodes(child)


def _match(page: Mapping[str, Any], selector: Mapping[str, Any]) -> Mapping[str, Any]:
    matches = [
        node for node in _nodes(page)
        if all(node.get(key) == value for key, value in selector.items())
    ]
    if len(matches) != 1:
        raise NativeExecutionError("target_missing" if not matches else "ambiguous_target")
    return matches[0]


def _target_identity(node: Mapping[str, Any], observation: Mapping[str, Any]) -> str:
    identity = {
        "selectorIdentity": {key: node.get(key) for key in ("id", "accessibilityId", "className", "appId")},
        "bounds": node.get("bounds"),
        "text": node.get("text"),
        "description": node.get("description"),
        "windowId": observation.get("windowId"),
        "appId": observation.get("appId"),
    }
    return verification_engine.canonical_fingerprint(identity)


class NativeSession:
    """One device/app lease; actions consume a fresh observation exactly once."""

    def __init__(self, driver: NativeDriver, app_id: str, action_guard: Any = None) -> None:
        if driver.platform not in NATIVE_PLATFORMS or not driver.device_id or not app_id:
            raise NativeExecutionError("invalid_device_identity")
        self.driver = driver
        self.app_id = app_id
        self.session_id = uuid.uuid4().hex
        self._current: Optional[Dict[str, Any]] = None
        self._receipts: Dict[str, Dict[str, Any]] = {}
        self._launched = False
        self.action_guard = action_guard

    def last_receipt(self) -> Optional[Dict[str, Any]]:
        if not self._receipts:
            return None
        return copy.deepcopy(next(reversed(self._receipts.values())))

    def ensure_ready(self) -> None:
        if self.action_guard is not None:
            self.action_guard()
        with timing.span("native.health"):
            health = self.driver.health()
        if not isinstance(health, Mapping) or health.get("ready") is not True:
            raise NativeExecutionError("driver_not_ready")
        if not self._launched:
            with timing.span("native.launch"):
                self.driver.launch(self.app_id)
            self._launched = True

    def observe(self) -> Dict[str, Any]:
        self.ensure_ready()
        with timing.span("native.observe"):
            raw = self.driver.observe()
        if not isinstance(raw, Mapping):
            raise NativeExecutionError("invalid_observation")
        observed = copy.deepcopy(dict(raw))
        if (
            observed.get("platform") != self.driver.platform
            or observed.get("deviceId") != self.driver.device_id
            or observed.get("appId") != self.app_id
            or not isinstance(observed.get("windowId"), str)
            or not observed.get("windowId")
            or not isinstance(observed.get("page"), dict)
            or not isinstance(observed.get("observationId"), str)
            or not observed["observationId"]
        ):
            raise NativeExecutionError("observation_identity_mismatch")
        self._current = observed
        return copy.deepcopy(observed)

    def act(
        self, step_id: str, action: Mapping[str, Any], observation: Mapping[str, Any]
    ) -> Dict[str, Any]:
        if step_id in self._receipts:
            try:
                requested = verification_engine._normalize_action(action, "native action", self.driver.platform)
            except verification_engine.VerificationError as exc:
                raise NativeExecutionError(exc.code) from exc
            if self._receipts[step_id]["actionDigest"] != verification_engine.canonical_fingerprint(requested):
                raise NativeExecutionError("step_identity_conflict")
            return copy.deepcopy(self._receipts[step_id])
        if (not isinstance(observation, Mapping) or not self._current
                or observation.get("observationId") != self._current["observationId"]):
            raise NativeExecutionError("stale_observation")
        if verification_engine.canonical_fingerprint(observation) != verification_engine.canonical_fingerprint(self._current):
            raise NativeExecutionError("observation_changed")
        try:
            checked_action = verification_engine._normalize_action(
                action, "native action", self.driver.platform
            )
        except verification_engine.VerificationError as exc:
            raise NativeExecutionError(exc.code) from exc
        action_type = checked_action["type"]
        selector = checked_action.get("selector")
        supported = getattr(self.driver, "supported_actions", verification_engine.DYNAMIC_ACTIONS)
        if action_type not in supported:
            raise NativeExecutionError("unsupported_action")
        if action_type == "scroll" and selector is None:
            raise NativeExecutionError("missing_selector")
        if action_type in {"click", "longClick", "input"} and not isinstance(selector, dict):
            raise NativeExecutionError("missing_selector")
        before = _match(self._current["page"], selector) if isinstance(selector, dict) else None
        fresh = self.observe()
        target = _match(fresh["page"], selector) if isinstance(selector, dict) else None
        if before is not None and target is not None:
            if _target_identity(before, observation) != _target_identity(target, fresh):
                raise NativeExecutionError("target_changed")
            if target.get("visible") is not True or target.get("hittable") is not True:
                raise NativeExecutionError("target_not_hittable")
        elif observation.get("windowId") != fresh.get("windowId"):
            raise NativeExecutionError("window_changed")
        if self.action_guard is not None:
            self.action_guard()
        self._current = None
        # Code security: a failed transport may already have sent a physical action.
        # Reserve the step before calling the driver, so its identity is never retried.
        self._receipts[step_id] = {
            "sessionId": self.session_id, "stepId": step_id,
            "state": "outcome_unknown", "observationId": fresh["observationId"],
            "actionDigest": verification_engine.canonical_fingerprint(checked_action),
        }
        try:
            with timing.span("native.action"):
                device_receipt = self.driver.perform(checked_action, target)
        except Exception as exc:
            self._receipts[step_id]["driverError"] = (exc.code if isinstance(exc, NativeExecutionError) else "transport_or_driver_error")
            raise NativeExecutionError("action_outcome_unknown") from exc
        if (not isinstance(device_receipt, Mapping)
                or device_receipt.get("state") != "succeeded"
                or device_receipt.get("deviceId") != self.driver.device_id):
            raise NativeExecutionError("action_outcome_unknown")
        receipt = {
            "sessionId": self.session_id, "stepId": step_id,
            "state": "succeeded", "observationId": fresh["observationId"],
            "actionDigest": verification_engine.canonical_fingerprint(checked_action),
            "deviceReceipt": copy.deepcopy(dict(device_receipt)),
        }
        self._receipts[step_id] = receipt
        return copy.deepcopy(receipt)

    def settle(self, timeout_seconds: float = 8.0) -> Dict[str, Any]:
        """Only repeat observations, never physical actions, while the native page moves."""
        deadline = time.monotonic() + timeout_seconds
        previous = self.observe()
        while time.monotonic() < deadline:
            time.sleep(0.15)
            current = self.observe()
            if current["page"] == previous["page"] and current["windowId"] == previous["windowId"]:
                return current
            previous = current
        raise NativeExecutionError("page_not_settled")


class NativeVerificationAdapter:
    """Maps compiled segments to a native session; the Result Judge owns verdicts."""

    def __init__(self, session: NativeSession, artifacts: Path, decision_provider: Any = None) -> None:
        self.session = session
        self.artifacts = Path(artifacts).resolve()
        self.artifacts.mkdir(parents=True, exist_ok=True)
        self._capture_index = 0
        self.decision_provider = decision_provider

    def _capture(self) -> Dict[str, Any]:
        with timing.span("native.screenshot"):
            image = self.session.driver.screenshot()
        if (not isinstance(image, bytes) or len(image) < 24
                or not image.startswith(PNG_SIGNATURE)
                or image[12:16] != b"IHDR"
                or len(image) > MAX_SCREENSHOT_BYTES):
            raise NativeExecutionError("invalid_screenshot")
        self._capture_index += 1
        digest = hashlib.sha256(image).hexdigest()
        path = self.artifacts / ("screen-%04d-%s.png" % (self._capture_index, digest[:12]))
        # Code security: the filename is generated locally and cannot traverse the artifact root.
        path.write_bytes(image)
        return {"type": "screenshot", "content": {"path": str(path), "sha256": digest}}

    def _evidence(self, observation: Mapping[str, Any], receipt: Optional[Mapping[str, Any]] = None) -> list[Dict[str, Any]]:
        items = [{"type": "native_observation", "content": copy.deepcopy(dict(observation))}]
        if receipt is not None:
            items.append({"type": "native_action_receipt", "content": copy.deepcopy(dict(receipt))})
        items.append(self._capture())
        return items

    def execute(self, segment: Mapping[str, Any], scenario: Mapping[str, Any], decisions: Sequence[Mapping[str, Any]]) -> Dict[str, Any]:
        if scenario.get("platform") != self.session.driver.platform or scenario.get("targetAppId") != self.session.app_id:
            return {"state": "not_tested", "reason": "device_binding_mismatch"}
        evidence: list[Dict[str, Any]] = []
        checkpoint_observations: Dict[str, Any] = {}
        try:
            if segment["phase"] == "precondition":
                observed = self.session.observe()
                evidence.extend(self._evidence(observed))
                for item in scenario["preconditions"]:
                    status, _, _ = verification_engine._evaluate_ui_oracle(item["oracle"], observed)
                    if status != "passed":
                        return {"state": "not_tested", "reason": "precondition_failed", "evidence": evidence}
                return {"state": "passed", "evidence": evidence}

            if segment["route"] == "dynamic":
                if __package__:
                    from .native_decision import candidates
                else:
                    from native_decision import candidates
                allowed = set(segment["dynamicStep"]["allowedActions"])
                limits = segment["dynamicStep"]["budget"]
                budget = limits["maxSteps"]
                started = time.monotonic()
                last_progress = started
                history: list[Dict[str, Any]] = []
                repeated = no_progress = 0
                previous_action = None
                for index in range(budget + 1 if self.decision_provider is not None else len(decisions)):
                    if (time.monotonic() - started) * 1000 > limits["maxDurationMs"]:
                        return {"state": "not_tested", "reason": "decision_duration_budget", "evidence": evidence}
                    observed = self.session.observe()
                    if self.decision_provider is not None:
                        options = candidates(observed, allowed & set(self.session.driver.supported_actions), scenario.get("testData", {}))
                        with timing.span("provider.decide"):
                            decision = self.decision_provider.decide({
                                "scenarioId": scenario["id"], "segmentId": segment["segmentId"],
                                "goal": segment["dynamicStep"]["goal"], "observation": observed,
                                "allowedActions": sorted(allowed), "candidates": options,
                                "history": copy.deepcopy(history[-8:]), "completedActionCount": index,
                            })
                        if not isinstance(decision, dict):
                            raise NativeExecutionError("invalid_native_decision")
                        evidence.append({"type": "native_decision", "content": {
                            "observationId": observed["observationId"], "decision": copy.deepcopy(decision),
                            "candidates": options}})
                        if decision.get("type") == "act":
                            if set(decision) - {"type", "candidateId", "reason"}:
                                raise NativeExecutionError("invalid_native_decision")
                            chosen = [item for item in options if item["candidateId"] == decision.get("candidateId")]
                            if len(chosen) != 1:
                                raise NativeExecutionError("invalid_native_candidate")
                            decision = {"type": "act", "action": chosen[0]["action"]}
                    else:
                        decision = decisions[index]
                    now = time.monotonic()
                    if (now - started) * 1000 > limits["maxDurationMs"]:
                        raise NativeExecutionError("decision_duration_budget")
                    if (now - last_progress) * 1000 > limits["idleTimeoutMs"]:
                        raise NativeExecutionError("decision_idle_budget")
                    if decision.get("type") == "blocked":
                        return {"state": "not_tested", "reason": "provider_blocked", "evidence": evidence}
                    if decision.get("type") == "done":
                        observed = self.session.observe()
                        evidence.extend(self._evidence(observed))
                        for checkpoint_id in segment["checkpointIds"]:
                            checkpoint_observations[checkpoint_id] = observed
                        return {"state": "done", "agentDone": True, "observation": observed,
                                "checkpointObservations": checkpoint_observations, "evidence": evidence}
                    if decision.get("type") != "act" or index >= budget:
                        return {"state": "not_tested", "reason": "decision_budget_or_type", "evidence": evidence}
                    action = decision.get("action")
                    if not isinstance(action, dict) or action.get("type") not in allowed:
                        return {"state": "not_tested", "reason": "action_not_allowed", "evidence": evidence}
                    action = verification_engine._normalize_action(action, "native decision", scenario["platform"])
                    if (time.monotonic() - started) * 1000 > limits["maxDurationMs"]:
                        raise NativeExecutionError("decision_duration_budget")
                    action_digest = verification_engine.canonical_fingerprint(action)
                    repeated = repeated + 1 if action_digest == previous_action else 1
                    previous_action = action_digest
                    if repeated > limits["maxRepeatedActions"]:
                        raise NativeExecutionError("repeated_action_budget")
                    receipt = self.session.act("%s-%d" % (segment["segmentId"], index), action, observed)
                    settled = self.session.settle()
                    no_progress = no_progress + 1 if settled["page"] == observed["page"] else 0
                    if settled["page"] != observed["page"]:
                        last_progress = time.monotonic()
                    evidence.extend(self._evidence(settled, receipt))
                    history.append({"action": action, "receipt": receipt})
                    if no_progress > limits["maxNoProgressSteps"]:
                        raise NativeExecutionError("no_progress_budget")
                return {"state": "not_tested", "reason": "missing_done", "evidence": evidence}

            if segment["phase"] == "cleanup":
                items = {item["id"]: item for item in scenario["cleanup"]}
            else:
                items = {item["id"]: item for item in scenario["steps"]}
            checkpoints_by_step: Dict[str, list[Mapping[str, Any]]] = {}
            for checkpoint in scenario["checkpoints"]:
                if checkpoint["id"] in segment["checkpointIds"]:
                    checkpoints_by_step.setdefault(checkpoint["afterStep"], []).append(checkpoint)
            for step_id in segment["sourceStepIds"]:
                item = items[step_id]
                observed = self.session.observe()
                if "oracle" in item:
                    status, _, _ = verification_engine._evaluate_ui_oracle(item["oracle"], observed)
                    evidence.extend(self._evidence(observed))
                    if status != "passed":
                        return {"state": "failed", "reason": "cleanup_oracle_mismatch", "evidence": evidence}
                    continue
                receipt = self.session.act(segment["segmentId"] + ":" + step_id, item["action"], observed)
                settled = self.session.settle()
                evidence.extend(self._evidence(settled, receipt))
                for checkpoint in checkpoints_by_step.get(step_id, []):
                    checkpoint_observations[checkpoint["id"]] = settled
            if not evidence:
                observed = self.session.observe()
                evidence.extend(self._evidence(observed))
            return {"state": "passed", "checkpointObservations": checkpoint_observations,
                    "evidence": evidence}
        except (NativeExecutionError, verification_engine.VerificationError) as exc:
            receipt = self.session.last_receipt()
            if receipt is not None:
                evidence.append({"type": "native_action_receipt", "content": receipt})
            try:
                evidence.append(self._capture())
            except NativeExecutionError:
                pass
            return {"state": "not_tested", "reason": getattr(exc, "code", "invalid_contract"),
                    "evidence": evidence}
