import json
import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from solopi_harness import harmony_hdc, native_runtime


def layout(text="Increment", bounds="[10,20][110,80]", window="40"):
    return {
        "children": [{"attributes": {
            "bundleName": "org.example.Counter", "hostWindowId": window,
            "focused": "true", "visible": "true", "bounds": "[0,0][200,300]",
            "type": "root", "id": "", "text": "", "description": "",
        }, "children": [{"attributes": {
            "id": "increment", "accessibilityId": "3", "type": "Button",
            "text": text, "description": "", "bounds": bounds,
            "visible": "true", "enabled": "true", "clickable": "true",
        }, "children": []}]}]
    }


class HarmonyHDCTests(unittest.TestCase):
    def test_input_quotes_device_shell_and_refuses_implicit_replacement(self):
        driver = self.driver()
        data = layout(text="")
        data["children"][0]["children"][0]["attributes"]["type"] = "TextInput"
        target = driver._tree(data["children"][0]["children"][0], driver.app_id)
        text = "a'; $(touch /data/local/tmp/injected)"
        with mock.patch.object(driver, "_receive", return_value=json.dumps(data).encode()), \
             mock.patch.object(driver, "_run") as command:
            with self.assertRaises(native_runtime.NativeExecutionError) as caught:
                driver.perform({"type": "input", "text": text}, target)
            self.assertEqual("unsupported_input_text", caught.exception.code)
            command.assert_not_called()
            driver.perform({"type": "input", "text": "SoloPi"}, target)
        import shlex
        self.assertEqual("SoloPi", command.call_args.args[-1])
        with mock.patch.object(harmony_hdc.subprocess, "run", return_value=mock.Mock(returncode=0, stdout="No Error")) as process:
            driver._run("shell", "uitest", "uiInput", "inputText", "60", "50", text)
        self.assertEqual(["uitest", "uiInput", "inputText", "60", "50", text], shlex.split(process.call_args.args[0][-1]))
        data["children"][0]["children"][0]["attributes"]["text"] = "existing"
        target = driver._tree(data["children"][0]["children"][0], driver.app_id)
        with mock.patch.object(driver, "_receive", return_value=json.dumps(data).encode()), \
             mock.patch.object(driver, "_run") as command:
            with self.assertRaises(native_runtime.NativeExecutionError) as caught:
                driver.perform({"type": "input", "text": "new"}, target)
        self.assertEqual("input_replace_unavailable", caught.exception.code)
        command.assert_not_called()

    def test_scroll_refuses_occluded_gesture_endpoint(self):
        driver = self.driver()
        data = layout()
        data["children"][0]["children"][0]["attributes"]["scrollable"] = "true"
        target = driver._tree(data["children"][0]["children"][0], driver.app_id)
        data["children"].append({"attributes": {"visible": "true", "bounds": "[0,25][200,35]"}, "children": []})
        with mock.patch.object(driver, "_receive", return_value=json.dumps(data).encode()), \
             mock.patch.object(driver, "_run") as command:
            with self.assertRaises(native_runtime.NativeExecutionError) as caught:
                driver.perform({"type": "scroll", "direction": "up", "distance": 90}, target)
        self.assertEqual("target_occluded", caught.exception.code)
        command.assert_not_called()

    def test_back_requires_foreground_app(self):
        driver = self.driver()
        with mock.patch.object(driver, "observe", side_effect=native_runtime.NativeExecutionError("app_not_foreground")), \
             mock.patch.object(driver, "_run") as command:
            with self.assertRaises(native_runtime.NativeExecutionError):
                driver.perform({"type": "back"}, None)
        command.assert_not_called()

    def driver(self):
        driver = harmony_hdc.HarmonyHDCDriver("127.0.0.1:5555", sys.executable)
        driver.app_id = "org.example.Counter"
        driver._last_window = "40"
        return driver

    def test_observe_maps_native_identity_and_bounds(self):
        driver = self.driver()
        with mock.patch.object(driver, "_receive", return_value=json.dumps(layout()).encode()):
            observed = driver.observe()
        self.assertEqual("40", observed["windowId"])
        button = observed["page"]["children"][0]
        self.assertEqual("increment", button["id"])
        self.assertEqual([10, 20, 100, 60], button["bounds"])
        self.assertTrue(button["hittable"])

    def test_rejects_replaced_target_before_click(self):
        driver = self.driver()
        target = driver._tree(layout()["children"][0]["children"][0], driver.app_id)
        with mock.patch.object(driver, "_receive", return_value=json.dumps(layout(text="Changed")).encode()), \
             mock.patch.object(driver, "_run") as command:
            with self.assertRaises(native_runtime.NativeExecutionError) as caught:
                driver.perform({"type": "click"}, target)
        self.assertEqual("target_changed", caught.exception.code)
        command.assert_not_called()

    def test_rejects_other_window_covering_target(self):
        driver = self.driver()
        target = driver._tree(layout()["children"][0]["children"][0], driver.app_id)
        covered = layout()
        covered["children"].append({"attributes": {
            "bundleName": "org.example.Dialog", "visible": "true",
            "bounds": "[0,0][200,300]",
        }, "children": []})
        with mock.patch.object(driver, "_receive", return_value=json.dumps(covered).encode()), \
             mock.patch.object(driver, "_run") as command:
            with self.assertRaises(native_runtime.NativeExecutionError) as caught:
                driver.perform({"type": "click"}, target)
        self.assertEqual("target_occluded", caught.exception.code)
        command.assert_not_called()

    def test_rejects_window_replacement_before_click(self):
        driver = self.driver()
        target = driver._tree(layout()["children"][0]["children"][0], driver.app_id)
        driver._last_window = "40"
        with mock.patch.object(driver, "_receive", return_value=json.dumps(layout(window="41")).encode()), \
             mock.patch.object(driver, "_run") as command:
            with self.assertRaises(native_runtime.NativeExecutionError) as caught:
                driver.perform({"type": "click"}, target)
        self.assertEqual("window_changed", caught.exception.code)
        command.assert_not_called()


if __name__ == "__main__":
    unittest.main()
