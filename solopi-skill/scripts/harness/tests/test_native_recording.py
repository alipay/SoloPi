import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from solopi_harness import native_recording, native_runtime, verification_engine
from test_native_runtime import FakeDriver


class NativeRecordingTests(unittest.TestCase):
    def test_recorded_assertion_survives_compile_and_wrong_replay_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            driver = FakeDriver()
            recorder = native_recording.NativeRecorder(native_runtime.NativeSession(driver, "org.example.Counter"), Path(directory) / "recording")
            observed = recorder.command({"type": "observe"})["observation"]
            recorder.command({"type": "act", "observationId": observed["observationId"], "action": {
                "type": "click", "selector": {"accessibilityId": "increment"}}})
            recorder.command({"type": "assert", "oracle": {"type": "ui", "selector": {
                "accessibilityId": "counter"}, "field": "text", "operator": "equals", "expected": "1"}})
            output = recorder.command({"type": "end"})
            requirement = json.loads(Path(output["requirement"]).read_text())
            plan = verification_engine.compile_verification_plan(requirement)
            wrong = FakeDriver()
            wrong.value = 9
            adapter = native_runtime.NativeVerificationAdapter(native_runtime.NativeSession(wrong, "org.example.Counter"), Path(directory) / "replay")
            report = verification_engine.execute_verification_plan(plan, adapter)
            self.assertEqual("failed", report["status"])
            self.assertEqual("1", requirement["scenarios"][0]["checkpoints"][0]["oracle"]["expected"])

    def test_uncertain_send_is_saved_and_cannot_be_continued(self):
        with tempfile.TemporaryDirectory() as directory:
            driver = FakeDriver()
            driver.fail_after_send = True
            recorder = native_recording.NativeRecorder(native_runtime.NativeSession(driver, "org.example.Counter"), Path(directory) / "recording")
            observed = recorder.command({"type": "observe"})["observation"]
            with self.assertRaises(native_runtime.NativeExecutionError):
                recorder.command({"type": "act", "observationId": observed["observationId"], "action": {
                    "type": "click", "selector": {"accessibilityId": "increment"}}})
            saved = json.loads((recorder.root / "recording.json").read_text())
            self.assertEqual("interrupted", saved["state"])
            self.assertEqual("outcome_unknown", saved["events"][-1]["receipt"]["state"])
            with self.assertRaises(native_runtime.NativeExecutionError):
                recorder.command({"type": "observe"})
            self.assertEqual(1, driver.actions)

    def test_recording_cannot_finish_without_explicit_assertion(self):
        with tempfile.TemporaryDirectory() as directory:
            recorder = native_recording.NativeRecorder(native_runtime.NativeSession(FakeDriver(), "org.example.Counter"), Path(directory) / "recording")
            with self.assertRaises(native_runtime.NativeExecutionError):
                recorder.command({"type": "end"})


if __name__ == "__main__":
    unittest.main()
