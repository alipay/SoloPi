import copy
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from solopi_harness import native_decision, native_runtime, verification_engine
from test_native_runtime import FakeDriver, requirement


class NativeDecisionTests(unittest.TestCase):
    def plan(self):
        source = requirement()
        source["scenarios"][0]["steps"] = [{"id": "tap", "type": "explore", "goal": "Increment once",
                                             "allowedActions": ["click"], "budget": {"maxSteps": 2}}]
        return verification_engine.compile_verification_plan(source)

    def run_provider(self, provider):
        driver = FakeDriver()
        original = driver.observe
        def observe():
            result = original()
            result["page"]["children"][0]["className"] = "XCUIElementTypeButton"
            return result
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(driver, "observe", side_effect=observe):
            adapter = native_runtime.NativeVerificationAdapter(native_runtime.NativeSession(driver, "org.example.Counter"), Path(directory), provider)
            return verification_engine.execute_verification_plan(self.plan(), adapter), driver

    def test_provider_can_only_select_fresh_candidates_then_judge_verifies(self):
        provider = mock.Mock()
        provider.decide.side_effect = lambda context: ({"type": "act", "candidateId": context["candidates"][0]["candidateId"]}
                                                      if context["completedActionCount"] == 0 else {"type": "done"})
        report, driver = self.run_provider(provider)
        self.assertEqual("passed", report["status"])
        self.assertEqual(1, driver.actions)

    def test_raw_or_invented_actions_are_never_dispatched(self):
        for result in ({"type": "act", "candidateId": "old-observation-0"},
                       {"type": "act", "action": {"type": "click"}}):
            report, driver = self.run_provider(mock.Mock(decide=mock.Mock(return_value=result)))
            self.assertEqual("not_tested", report["status"])
            self.assertEqual(0, driver.actions)

    def test_done_cannot_override_fixed_oracle(self):
        report, driver = self.run_provider(mock.Mock(decide=mock.Mock(return_value={"type": "done"})))
        self.assertEqual("failed", report["status"])
        self.assertEqual(0, driver.actions)

    def test_endpoint_rejects_remote_credentials_and_redirect_target(self):
        for endpoint in ("http://localhost:1234/x", "https://127.0.0.1:1234/x", "http://127.0.0.1.evil:1234/", "http://u:p@127.0.0.1:1234/", "file:///tmp/provider"):
            with self.assertRaises(native_runtime.NativeExecutionError):
                native_decision.NativeCandidateProvider(endpoint)

    def test_frozen_input_only_and_ambiguous_nodes_excluded(self):
        page = {"platform": "ios", "observationId": "obs", "page": {"children": [
            {"accessibilityId": "field", "className": "XCUIElementTypeTextField", "visible": True, "hittable": True},
            {"accessibilityId": "same", "className": "XCUIElementTypeButton", "visible": True, "hittable": True},
            {"accessibilityId": "same", "className": "XCUIElementTypeButton", "visible": True, "hittable": True}]}}
        choices = native_decision.candidates(page, {"input", "click"}, {"query": "frozen"})
        self.assertEqual(["frozen"], [item["action"]["text"] for item in choices])


if __name__ == "__main__":
    unittest.main()
