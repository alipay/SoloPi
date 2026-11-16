import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from solopi_harness import ios_wda


class IOSWDATests(unittest.TestCase):
    def test_wda_helper_reuses_verified_listener_without_starting_processes(self):
        with mock.patch.object(ios_wda.IOSPhysicalWDADriver, "health", return_value={"ready": True}), \
             mock.patch.object(ios_wda.subprocess, "Popen") as launch:
            result = ios_wda.run_usb_wda("phone-1", 18100, Path("unused.xcodeproj"), Path("unused"), Path("unused"))
        self.assertEqual("already_running", result["state"])
        launch.assert_not_called()

    def test_wda_helper_refuses_missing_signed_build(self):
        with mock.patch.object(ios_wda.IOSPhysicalWDADriver, "health", return_value={"ready": False}), \
             mock.patch.object(ios_wda.subprocess, "Popen") as launch:
            with self.assertRaises(ios_wda.NativeExecutionError) as caught:
                ios_wda.run_usb_wda("phone-1", 18100, Path("unused.xcodeproj"), Path("unused"), Path("unused"))
        self.assertEqual("signed_wda_build_required", caught.exception.code)
        launch.assert_not_called()

    def test_wda_helper_interrupt_stops_only_created_processes(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project = root / "WebDriverAgent.xcodeproj"
            project.mkdir()
            products = root / "derived/Build/Products"
            products.mkdir(parents=True)
            (products / "signed.xctestrun").write_text("test")
            proxy, runner = mock.Mock(), mock.Mock()
            proxy.poll.return_value = runner.poll.return_value = None
            with mock.patch.object(ios_wda.IOSPhysicalWDADriver, "health", side_effect=[{"ready": False}, {"ready": True}]), \
                 mock.patch.object(ios_wda.shutil, "which", side_effect=lambda name: "/tools/" + name), \
                 mock.patch.object(ios_wda.subprocess, "Popen", side_effect=[proxy, runner]) as launch, \
                 mock.patch("socket.socket"), mock.patch("time.sleep", side_effect=KeyboardInterrupt):
                result = ios_wda.run_usb_wda("phone-1", 18100, project, root / "derived", root / "logs")
            self.assertEqual("stopped", result["state"])
            self.assertEqual(["/tools/iproxy", "--udid", "phone-1", "--local", "--source", "127.0.0.1", "18100:8100"], launch.call_args_list[0].args[0])
            proxy.terminate.assert_called_once()
            runner.terminate.assert_called_once()

    def test_element_refuses_displayed_but_occluded_target(self):
        driver = ios_wda.IOSWDADriver("sim-1")
        driver.session_id = "session-1"
        driver.app_id = "org.example.Test"
        with mock.patch.object(driver, "_verify_app"), mock.patch.object(driver, "_request", side_effect=[
            [{ios_wda.ELEMENT_KEY: "element-1"}], "XCUIElementTypeButton", {"x": 1, "y": 2, "width": 3, "height": 4}, True, True, False,
        ]):
            with self.assertRaises(ios_wda.NativeExecutionError) as caught:
                driver._element({"accessibilityId": "Tap", "className": "XCUIElementTypeButton", "bounds": [1, 2, 3, 4]})
        self.assertEqual("target_changed", caught.exception.code)

    def test_back_ignores_same_named_content_button(self):
        driver = ios_wda.IOSWDADriver("sim-1")
        page = {"children": [{"className": "XCUIElementTypeButton", "accessibilityId": "Back", "hittable": True}]}
        with mock.patch.object(driver, "observe", return_value={"page": page}), \
             mock.patch.object(driver, "_element") as lookup:
            with self.assertRaises(ios_wda.NativeExecutionError) as caught:
                driver.perform({"type": "back"}, None)
        self.assertEqual("back_unavailable", caught.exception.code)
        lookup.assert_not_called()

    def test_source_preserves_accessible_identity(self):
        xml = (
            '<XCUIElementTypeApplication bundleId="org.example.Test" '
            'type="XCUIElementTypeApplication" visible="true" enabled="true">'
            '<XCUIElementTypeButton name="Continue" label="Continue" '
            'accessible="true" visible="true" enabled="true" '
            'x="1" y="2" width="30" height="40"/>'
            '</XCUIElementTypeApplication>'
        )
        driver = ios_wda.IOSWDADriver("sim-1")
        driver.session_id = "session-1"
        driver.app_id = "org.example.Test"
        with mock.patch.object(driver, "_request", side_effect=[
            {"bundleId": "org.example.Test"}, None, xml,
        ]):
            observed = driver.observe()
        button = observed["page"]["children"][0]
        self.assertEqual("Continue", button["accessibilityId"])
        self.assertEqual([1, 2, 30, 40], button["bounds"])

    def test_health_requires_loopback_listener_owned_by_selected_simulator(self):
        listing = {"devices": {"ios": [{"udid": "sim-1", "state": "Booted"}]}}
        driver = ios_wda.IOSWDADriver("sim-1")

        def probe(listener):
            outputs = [
                mock.Mock(returncode=0, stdout=json.dumps(listing)),
                mock.Mock(returncode=0, stdout=listener),
                mock.Mock(returncode=0, stdout=(
                    "PID\tStatus\tLabel\n123\t0\t"
                    "UIKitApplication:com.facebook.WebDriverAgentRunner.xctrunner[1]"
                )),
            ]
            with mock.patch.object(ios_wda.subprocess, "run", side_effect=outputs), \
                 mock.patch.object(driver, "_request", return_value={"ready": True, "device": "iphone"}):
                return driver.health()

        self.assertFalse(probe("p123\nu%d\nn*:8100\n" % os.getuid())["ready"])
        self.assertFalse(probe("p123\nu0\nn127.0.0.1:8100\n")["ready"])
        self.assertTrue(probe("p123\nu%d\nn127.0.0.1:8100\n" % os.getuid())["ready"])

    def test_physical_driver_requires_exact_usb_proxy_device_and_loopback(self):
        device = "00008120-0018485E2112201E"
        driver = ios_wda.IOSPhysicalWDADriver(device, 18100)
        good = "iproxy --udid %s --local --source 127.0.0.1 18100:8100" % device

        def probe(command, address="127.0.0.1:18100"):
            outputs = [
                mock.Mock(returncode=0, stdout=device + "\n"),
                mock.Mock(returncode=0, stdout="p123\nu%d\nn%s\n" % (os.getuid(), address)),
                mock.Mock(returncode=0, stdout=command),
            ]
            with mock.patch.object(ios_wda.shutil, "which", side_effect=lambda name: "/bin/" + name), \
                 mock.patch.object(ios_wda.subprocess, "run", side_effect=outputs), \
                 mock.patch.object(driver, "_request", return_value={"ready": True, "device": "iphone"}):
                return driver.health()["ready"]

        self.assertTrue(probe(good))
        self.assertFalse(probe(good.replace(device, "other-phone")))
        self.assertFalse(probe(good.replace("--local", "--network")))
        self.assertFalse(probe(good, "*:18100"))
        self.assertFalse(probe("python3 fake-wda.py"))

    def test_physical_driver_rejects_modal_alert_before_observing_targets(self):
        driver = ios_wda.IOSPhysicalWDADriver("phone-1", 18100)
        driver.session_id = "session-1"
        driver.app_id = "org.example.Test"
        with mock.patch.object(driver, "_request", side_effect=[
            {"bundleId": driver.app_id}, "Allow network access?",
        ]):
            with self.assertRaises(ios_wda.NativeExecutionError) as caught:
                driver.observe()
        self.assertEqual("unexpected_alert", caught.exception.code)


if __name__ == "__main__":
    unittest.main()
