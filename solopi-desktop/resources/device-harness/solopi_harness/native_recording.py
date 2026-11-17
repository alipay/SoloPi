"""Computer-controlled native recording; explicit assertions survive replay unchanged."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any, Mapping

if __package__:
    from . import native_runtime, verification_engine
else:
    import native_runtime
    import verification_engine


class NativeRecorder:
    """One live process owns the session. Interrupted recordings cannot auto-resume."""

    def __init__(self, session: native_runtime.NativeSession, artifacts: Path) -> None:
        self.session = session
        self.root = Path(artifacts).resolve()
        # Code security: never overwrite another recording or follow an existing directory.
        self.root.mkdir(parents=True, exist_ok=False)
        self.adapter = native_runtime.NativeVerificationAdapter(session, self.root)
        self.steps: list[dict[str, Any]] = []
        self.checkpoints: list[dict[str, Any]] = []
        self.events: list[dict[str, Any]] = []
        self.current = None
        self.state = "recording"
        self._save()

    def _save(self) -> None:
        payload = {"schemaVersion": "solopi.ai.native-recording/v1", "state": self.state,
                   "platform": self.session.driver.platform, "deviceId": self.session.driver.device_id,
                   "sessionId": self.session.session_id, "appId": self.session.app_id,
                   "steps": self.steps, "checkpoints": self.checkpoints, "events": self.events}
        # A fixed generated filename, replaced atomically within the new recording directory.
        temporary = self.root / ".recording.tmp"
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(self.root / "recording.json")

    def command(self, command: Mapping[str, Any]) -> dict[str, Any]:
        if self.state != "recording":
            raise native_runtime.NativeExecutionError("recording_closed")
        kind = command.get("type")
        if kind == "observe":
            self.current = self.session.observe()
            evidence = self.adapter._evidence(self.current)
            self.events.append({"type": "observe", "evidence": evidence})
            self._save()
            return {"observation": self.current, "evidence": evidence}
        if kind == "act":
            if self.current is None or command.get("observationId") != self.current["observationId"]:
                raise native_runtime.NativeExecutionError("stale_observation")
            action = verification_engine._normalize_action(command.get("action"), "recorded action", self.session.driver.platform)
            # Rejected requests remain in the transcript and must not reuse the
            # device's idempotency key when the user explicitly tries a new action.
            step_id = "recorded-%d" % (sum(event.get("type") == "act" for event in self.events) + 1)
            # Persist pending intent before any physical send. A crash cannot silently lose a gesture.
            event = {"type": "act", "stepId": step_id, "action": action, "state": "outcome_unknown"}
            self.events.append(event)
            self._save()
            try:
                receipt = self.session.act(step_id, action, self.current)
                self.current = None
                self.steps.append({"id": step_id, "type": "operation", "action": action})
                event.update(state=receipt["state"], receipt=receipt)
                observed = self.session.observe()
                event["evidence"] = self.adapter._evidence(observed, receipt)
                self._save()
                return {"receipt": receipt, "evidence": event["evidence"]}
            except Exception:
                event["receipt"] = self.session.last_receipt()
                bound_receipt = (isinstance(event["receipt"], dict)
                                 and event["receipt"].get("stepId") == step_id)
                if bound_receipt and event["receipt"].get("state") in {
                    "succeeded", "failed", "rejected"
                }:
                    event["state"] = event["receipt"]["state"]
                try:
                    event["evidence"] = [self.adapter._capture()]
                except native_runtime.NativeExecutionError:
                    pass
                self.current = None
                # A definitive rejection did not execute the requested action.
                # Keep the recording, but require a new observation and explicit
                # user action. Unknown or failed outcomes still interrupt it.
                self.state = "recording" if bound_receipt and event["state"] == "rejected" else "interrupted"
                self._save()
                raise
        if kind == "assert":
            if not self.steps:
                raise native_runtime.NativeExecutionError("checkpoint_requires_action")
            oracle = verification_engine._normalize_oracle(command.get("oracle"), "recorded assertion", self.session.driver.platform)
            observed = self.session.observe()
            status, reason, actual = verification_engine._evaluate_ui_oracle(oracle, observed)
            checkpoint = {"id": "checkpoint-%d" % (len(self.checkpoints) + 1),
                          "afterStep": self.steps[-1]["id"], "oracle": oracle}
            self.checkpoints.append(checkpoint)
            event = {"type": "assert", "checkpoint": checkpoint, "status": status,
                     "reason": reason, "actual": actual, "evidence": self.adapter._evidence(observed)}
            self.events.append(event)
            self.current = None
            self._save()
            return copy.deepcopy(event)
        if kind == "end":
            requirement = self.requirement()
            verification_engine.compile_verification_plan(requirement)
            output = self.root / "requirement.json"
            output.write_text(json.dumps(requirement, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            self.state = "completed"
            self._save()
            return {"requirement": str(output), "state": self.state}
        raise native_runtime.NativeExecutionError("unsupported_recording_command")

    def requirement(self) -> dict[str, Any]:
        if not self.steps or not self.checkpoints:
            raise native_runtime.NativeExecutionError("recording_requires_fixed_assertion")
        return {"schemaVersion": verification_engine.REQUIREMENT_SCHEMA,
                "platform": self.session.driver.platform, "targetAppId": self.session.app_id,
                "id": "native-recording", "title": "Computer-controlled native regression",
                "acceptanceCriteria": [{"id": "AC-1", "text": "Explicit recorded assertions hold"}],
                "scenarios": [{"id": "recorded-flow", "title": "Recorded flow", "acceptanceCriteria": ["AC-1"],
                               "steps": copy.deepcopy(self.steps), "checkpoints": copy.deepcopy(self.checkpoints)}]}

    def interrupt(self) -> None:
        if self.state == "recording":
            self.state = "interrupted"
            self._save()
