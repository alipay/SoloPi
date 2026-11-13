import copy
import base64
import json
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from solopi_harness import native_runtime, verification_engine, solopi_ai


def requirement():
    return {
        "schemaVersion": "solopi.ai.requirement/v1",
        "platform": "ios",
        "targetAppId": "org.example.Counter",
        "id": "native-counter",
        "title": "Counter increments",
        "acceptanceCriteria": [{"id": "AC-1", "text": "counter is one"}],
        "scenarios": [{
            "id": "increment", "title": "Increment", "acceptanceCriteria": ["AC-1"],
            "steps": [{"id": "tap", "type": "operation", "action": {
                "type": "click", "selector": {"accessibilityId": "increment"},
            }}],
            "checkpoints": [{"id": "counter", "afterStep": "tap", "oracle": {
                "type": "ui", "selector": {"accessibilityId": "counter"},
                "field": "text", "operator": "equals", "expected": "1",
            }}],
        }],
    }


class FakeDriver:
    supported_actions = frozenset({"click", "input", "scroll", "back", "wait"})
    platform = "ios"
    device_id = "iphone-test"

    def __init__(self):
        self.value = 0
        self.generation = 0
        self.actions = 0
        self.replace_target = False
        self.hide_target = False
        self.fail_after_send = False

    def health(self):
        return {"ready": True}

    def launch(self, app_id):
        assert app_id == "org.example.Counter"

    def observe(self):
        self.generation += 1
        target = {"accessibilityId": "increment", "id": "button-v2" if self.replace_target else "button-v1",
                  "visible": True, "hittable": not self.hide_target, "bounds": [0, 0, 50, 50]}
        return {"platform": self.platform, "deviceId": self.device_id,
                "appId": "org.example.Counter", "windowId": "main",
                "observationId": "obs-%d" % self.generation,
                "page": {"children": [target, {"accessibilityId": "counter", "text": str(self.value)}]}}

    def perform(self, action, target):
        self.actions += 1
        self.value += 1
        if self.fail_after_send:
            raise ConnectionError("connection lost")
        return {"state": "succeeded", "deviceId": self.device_id}

    def screenshot(self):
        return base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII="
        )


class NativeRuntimeTests(unittest.TestCase):
    def test_native_doctor_reports_missing_driver_separately_from_discovery(self):
        with mock.patch("solopi_harness.harmony_hdc.find_hdc", return_value=None):
            result = native_runtime.native_doctor("harmony_next")
        self.assertFalse(result["driverReady"])
        self.assertIn("discovery_tool", result["missing"])
        self.assertIn("native_driver", result["missing"])

    def test_native_doctor_distinguishes_simulator_from_physical_device(self):
        listing = {"devices": {"runtime-ios": [{
            "udid": "sim-1", "name": "iPhone", "state": "Booted", "isAvailable": True,
        }]}}
        result = mock.Mock(returncode=0, stdout=json.dumps(listing))
        with mock.patch.object(native_runtime.shutil, "which", side_effect=lambda name: "/bin/" + name), \
             mock.patch.object(native_runtime.subprocess, "run", side_effect=[
                 mock.Mock(returncode=0, stdout=""), result,
             ]), mock.patch("solopi_harness.ios_wda.IOSWDADriver.health", return_value={"ready": False}):
            doctor = native_runtime.native_doctor("ios")
        self.assertEqual([], doctor["devices"])
        self.assertEqual("sim-1", doctor["simulators"][0]["deviceId"])
        self.assertFalse(doctor["driverReady"])
        self.assertIn("physical_device", doctor["missing"])

    def test_native_plan_cannot_enter_android_verify_run(self):
        plan = verification_engine.compile_verification_plan(requirement())
        with tempfile.TemporaryDirectory() as directory:
            plan_path = Path(directory) / "plan.json"
            artifacts = Path(directory) / "artifacts"
            solopi_ai.write_json_file(plan_path, plan)
            args = solopi_ai.build_parser().parse_args(
                ["verify-run", "--plan", str(plan_path), "--artifacts", str(artifacts)]
            )
            with self.assertRaises(solopi_ai.CliError) as caught:
                solopi_ai._command_verify_run(args, mock.Mock())
            self.assertEqual("native_driver_unavailable", caught.exception.details["errorCode"])
            self.assertFalse(artifacts.exists())

    def test_ios_verify_run_rejects_invalid_simulator_before_artifacts(self):
        plan = verification_engine.compile_verification_plan(requirement())
        with tempfile.TemporaryDirectory() as directory:
            artifacts = Path(directory) / "artifacts"
            args = solopi_ai.build_parser().parse_args([
                "verify-run", "--plan", "unused.json", "--artifacts", str(artifacts),
                "--ios-simulator", "../../other-device",
            ])
            with self.assertRaises(solopi_ai.CliError) as caught:
                solopi_ai._command_verify_run_ios(args, plan)
            self.assertEqual("invalid_device_identity", caught.exception.details["errorCode"])
            self.assertFalse(artifacts.exists())

    def test_native_plan_has_platform_and_no_android_case(self):
        plan = verification_engine.compile_verification_plan(requirement())
        self.assertEqual("ios", plan["platform"])
        self.assertEqual("org.example.Counter", plan["intent"]["scenarios"][0]["targetAppId"])
        self.assertNotIn("case", plan["intent"]["scenarios"][0]["segments"][0])
        self.assertTrue(verification_engine.validate_verification_plan(plan)["valid"])

    def test_native_selector_rejects_android_resource_id(self):
        source = requirement()
        source["scenarios"][0]["steps"][0]["action"]["selector"] = {"resourceId": "counter"}
        with self.assertRaises(verification_engine.VerificationError):
            verification_engine.compile_verification_plan(source)

    def test_fixed_oracle_is_independent_of_action_success(self):
        plan = verification_engine.compile_verification_plan(requirement())
        driver = FakeDriver()
        with tempfile.TemporaryDirectory() as directory:
            adapter = native_runtime.NativeVerificationAdapter(
                native_runtime.NativeSession(driver, "org.example.Counter"), Path(directory)
            )
            report = verification_engine.execute_verification_plan(plan, adapter)
            self.assertEqual("passed", report["status"])
            self.assertEqual(1, driver.actions)
            self.assertEqual(1, len(list(Path(directory).glob("*.png"))))

        driver = FakeDriver()
        driver.value = -1
        with tempfile.TemporaryDirectory() as directory:
            adapter = native_runtime.NativeVerificationAdapter(
                native_runtime.NativeSession(driver, "org.example.Counter"), Path(directory)
            )
            report = verification_engine.execute_verification_plan(plan, adapter)
            self.assertEqual("failed", report["status"])
            self.assertEqual("oracle_mismatch", report["scenarios"][0]["failure"]["category"])

    def test_changed_target_and_occlusion_are_rejected_before_touch(self):
        action = {"type": "click", "selector": {"accessibilityId": "increment"}}
        for field in ("replace_target", "hide_target"):
            driver = FakeDriver()
            session = native_runtime.NativeSession(driver, "org.example.Counter")
            observed = session.observe()
            setattr(driver, field, True)
            with self.assertRaises(native_runtime.NativeExecutionError):
                session.act("step-1", action, observed)
            self.assertEqual(0, driver.actions)

    def test_transport_loss_never_repeats_physical_action(self):
        driver = FakeDriver()
        driver.fail_after_send = True
        session = native_runtime.NativeSession(driver, "org.example.Counter")
        observed = session.observe()
        action = {"type": "click", "selector": {"accessibilityId": "increment"}}
        with self.assertRaises(native_runtime.NativeExecutionError):
            session.act("step-1", action, observed)
        receipt = session.act("step-1", action, observed)
        self.assertEqual("outcome_unknown", receipt["state"])
        self.assertEqual(1, driver.actions)

    def test_uncertain_action_is_not_passed_and_keeps_receipt(self):
        plan = verification_engine.compile_verification_plan(requirement())
        driver = FakeDriver()
        driver.fail_after_send = True
        with tempfile.TemporaryDirectory() as directory:
            adapter = native_runtime.NativeVerificationAdapter(
                native_runtime.NativeSession(driver, "org.example.Counter"), Path(directory)
            )
            report = verification_engine.execute_verification_plan(plan, adapter)
        self.assertEqual("not_tested", report["status"])
        self.assertEqual(1, driver.actions)
        self.assertTrue(any(
            item["type"] == "native_action_receipt"
            and item["content"]["state"] == "outcome_unknown"
            for item in report["evidence"]
        ))

    def test_interrupted_post_action_observation_keeps_receipt_and_screenshot(self):
        driver = FakeDriver()
        original = driver.observe

        def observe():
            if driver.actions:
                raise native_runtime.NativeExecutionError("unexpected_alert")
            return original()

        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.object(driver, "observe", side_effect=observe):
            adapter = native_runtime.NativeVerificationAdapter(
                native_runtime.NativeSession(driver, "org.example.Counter"), Path(directory)
            )
            report = verification_engine.execute_verification_plan(
                verification_engine.compile_verification_plan(requirement()), adapter
            )
            self.assertEqual("not_tested", report["status"])
            self.assertTrue(any(item["type"] == "screenshot" for item in report["evidence"]))
            self.assertTrue(any(
                item["type"] == "native_action_receipt"
                and item["content"]["state"] == "succeeded"
                for item in report["evidence"]
            ))

    def test_stale_observation_is_rejected(self):
        driver = FakeDriver()
        session = native_runtime.NativeSession(driver, "org.example.Counter")
        old = session.observe()
        session.observe()
        with self.assertRaises(native_runtime.NativeExecutionError):
            session.act("step-1", {"type": "click", "selector": {"accessibilityId": "increment"}}, old)
        self.assertEqual(0, driver.actions)

    def test_step_identity_cannot_be_reused_for_a_different_action(self):
        driver = FakeDriver()
        session = native_runtime.NativeSession(driver, "org.example.Counter")
        observed = session.observe()
        action = {"type": "click", "selector": {"accessibilityId": "increment"}}
        session.act("once", action, observed)
        with self.assertRaises(native_runtime.NativeExecutionError) as caught:
            session.act("once", {"type": "back"}, observed)
        self.assertEqual("step_identity_conflict", caught.exception.code)
        self.assertEqual(1, driver.actions)

    def test_two_scenarios_with_same_step_name_execute_independently(self):
        source = requirement()
        second = copy.deepcopy(source["scenarios"][0])
        second["id"] = "increment-again"
        second["checkpoints"][0]["oracle"]["expected"] = "2"
        source["scenarios"].append(second)
        driver = FakeDriver()
        with tempfile.TemporaryDirectory() as directory:
            adapter = native_runtime.NativeVerificationAdapter(native_runtime.NativeSession(driver, "org.example.Counter"), Path(directory))
            report = verification_engine.execute_verification_plan(verification_engine.compile_verification_plan(source), adapter)
        self.assertEqual("passed", report["status"])
        self.assertEqual(2, driver.actions)

    def test_native_actions_work_inside_real_timing_recorder(self):
        driver = FakeDriver()
        with tempfile.TemporaryDirectory() as directory:
            recorder = native_runtime.timing.TimingRecorder()
            with recorder.activate():
                adapter = native_runtime.NativeVerificationAdapter(native_runtime.NativeSession(driver, "org.example.Counter"), Path(directory))
                report = verification_engine.execute_verification_plan(verification_engine.compile_verification_plan(requirement()), adapter)
        self.assertEqual("passed", report["status"])
        self.assertIn("native.action", recorder.export()["aggregates"])

    def test_native_visibility_oracle_does_not_accept_hidden_tree_node(self):
        source = requirement()
        source["scenarios"][0]["checkpoints"][0]["oracle"] = {
            "type": "ui", "selector": {"accessibilityId": "increment"}, "field": "visible",
            "operator": "equals", "expected": "True"}
        plan = verification_engine.compile_verification_plan(source)
        oracle = plan["intent"]["scenarios"][0]["checkpoints"][0]["oracle"]
        observed = FakeDriver().observe()
        observed["page"]["children"][0]["visible"] = False
        self.assertEqual("failed", verification_engine._evaluate_ui_oracle(oracle, observed)[0])


if __name__ == "__main__":
    unittest.main()
