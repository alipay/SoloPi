import base64
import copy
from contextlib import ExitStack
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/solopi_harness"))
import solopi_ai
import workflows
import test_fastpath_cli as fixtures


PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1cAAAAASUVORK5CYII=")
CAPABILITIES = {"success": True, "settleStrategies": ["legacy", "event-stable-v1"],
                "actionValidationStrategies": ["full-page", "target-context-v1"]}


def capture(args, adb):
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(PNG)
    return {"success": True, "screenshot": str(path)}, 0


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.adb = mock.Mock()
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.doctor = stack.enter_context(mock.patch.object(solopi_ai, "command_doctor", return_value=({"success": True}, 0)))
        self.query = stack.enter_context(mock.patch.object(solopi_ai, "command_query", return_value=(CAPABILITIES, 0)))
        self.capture = stack.enter_context(mock.patch.object(solopi_ai, "command_screenshot", side_effect=capture))
        self.verify = stack.enter_context(mock.patch.object(solopi_ai, "command_verify_run", side_effect=self.verification))
        self.status = "passed"
        self.missing_shot = False
        self.omit_shot = False
        self.receipt_code = None

    def args(self, template="alipay-more-services", extras=()):
        return solopi_ai.build_parser().parse_args(["--serial", "fixture-device", "workflow-run",
            "--template", template, "--artifacts", str(self.root / "run")] + list(extras))

    def verification(self, args, adb):
        root = Path(args.artifacts)
        root.mkdir()
        screenshot = root / "screenshots/001.png"
        shot_args = copy.copy(args)
        shot_args.output = str(screenshot)
        capture(shot_args, adb)
        plan = json.loads(Path(args.plan).read_text())
        scenario = plan["intent"]["scenarios"][0]
        report = {"reportId": "fixture-report", "planFingerprint": plan["planFingerprint"],
                  "status": self.status, "screenshots": [{"phase": "test", "segmentId": "fixture-segment",
                    "status": "failed" if self.missing_shot else "captured", "path": str(screenshot)}],
                  "scenarios": [{"scenarioId": scenario["id"], "status": self.status,
                    "segments": [{"phase": "test", "segmentId": "fixture-segment"}],
                    "cleanup": {"status": "passed"},
                    "failure": {"category": "oracle_mismatch"} if self.status == "failed" else None,
                    "checkpoints": [{"checkpointId": item["id"], "status": self.status}
                                    for item in scenario["checkpoints"]]}]}
        if self.omit_shot:
            report["screenshots"] = []
        (root / "report.json").write_text(json.dumps(report))
        code = self.receipt_code if self.receipt_code is not None else (0 if self.status == "passed" else 2)
        return {"reportId": report["reportId"], "status": self.status, "success": self.status == "passed"}, code

    def test_catalog_and_report_do_not_connect_to_device(self):
        args = solopi_ai.build_parser().parse_args(["workflow-list"])
        payload, code = solopi_ai.dispatch(args, self.adb)
        self.assertEqual(0, code)
        self.assertEqual(3, len(payload["templates"]))
        self.assertEqual("rules", payload["defaultMode"])
        self.assertEqual([], self.adb.mock_calls)
        self.doctor.assert_not_called()

    def test_packaged_templates_compile_and_bind_matching_optional_providers(self):
        for name, template in workflows.TEMPLATES.items():
            with self.subTest(template=name):
                requirement = solopi_ai.load_json_file(workflows.RESOURCE_ROOT / name / "requirement.json")
                policy = solopi_ai.load_json_file(workflows.RESOURCE_ROOT / name / "policy.json")
                plan = solopi_ai.verification_engine.compile_verification_plan(requirement)
                solopi_ai.verification_engine.validate_verification_plan(plan)
                getattr(solopi_ai, template["provider"]).validate_policy(policy)
                scenario = plan["intent"]["scenarios"][0]
                self.assertTrue(scenario["preconditions"])
                self.assertTrue(scenario["cleanup"])
                self.assertEqual({step["id"] for step in scenario["steps"] if step["type"] == "explore"}, set(policy["steps"]))
                self.assertEqual(scenario["targetAppPackage"], policy["targetPackage"])

    def test_rules_run_preserves_inputs_serial_and_full_png_without_loading_model(self):
        with mock.patch.object(workflows.importlib.util, "find_spec", side_effect=AssertionError("must not load models")):
            payload, code = solopi_ai.dispatch(self.args(), self.adb)
        self.assertEqual((True, 0), (payload["success"], code))
        call = self.verify.call_args.args[0]
        self.assertEqual("fixture-device", call.serial)
        self.assertEqual("rules", call.fastpath_backend)
        self.assertEqual("shared", call.transport_mode)
        self.assertTrue(call.segment_screenshots)
        self.assertFalse(call.restart_app)
        self.assertEqual("event-stable-v1", call.settle_strategy)
        self.assertEqual("target-context-v1", call.action_validation_strategy)
        self.assertEqual(3, len(payload["screenshots"]))
        self.assertTrue(all(Path(path).read_bytes() == PNG for path in payload["screenshots"]))
        self.assertEqual(0o700, Path(payload["artifacts"]).stat().st_mode & 0o777)
        self.assertEqual(0o600, Path(payload["manifest"]).stat().st_mode & 0o777)
        source = workflows.RESOURCE_ROOT / "alipay-more-services/requirement.json"
        self.assertEqual(json.loads(source.read_text()), json.loads((self.root / "run/requirement.json").read_text()))
        self.doctor.reset_mock()
        self.query.reset_mock()
        read_args = solopi_ai.build_parser().parse_args(["workflow-report", "--artifacts", payload["artifacts"]])
        read, read_code = solopi_ai.dispatch(read_args, self.adb)
        self.assertEqual(("verified", 0), (read["evidenceIntegrity"], read_code))
        self.doctor.assert_not_called()
        self.query.assert_not_called()
        self.assertEqual([], self.adb.mock_calls)

    def test_failed_and_not_tested_remain_distinct(self):
        for status in ("failed", "not_tested"):
            self.status = status
            args = self.args()
            args.artifacts = str(self.root / status)
            payload, code = solopi_ai.dispatch(args, self.adb)
            self.assertEqual((status, "completed", False, 2), (payload["status"], payload["state"], payload["success"], code))
            self.assertEqual("passed", payload["scenarios"][0]["cleanup"])

    def test_laya_requires_local_model_and_runtime_before_device_use(self):
        with self.assertRaises(solopi_ai.CliError):
            solopi_ai.dispatch(self.args(extras=["--mode", "laya"]), self.adb)
        model = self.root / "model"
        model.mkdir()
        (model / "model.safetensors").write_bytes(b"fixture")
        with mock.patch.object(workflows.importlib.util, "find_spec", return_value=None), self.assertRaises(solopi_ai.CliError):
            solopi_ai.dispatch(self.args(extras=["--mode", "laya", "--model", str(model)]), self.adb)
        with self.assertRaises(solopi_ai.CliError):
            solopi_ai.dispatch(self.args(extras=["--model", str(model)]), self.adb)
        self.doctor.assert_not_called()
        self.verify.assert_not_called()
        self.assertFalse((self.root / "run").exists())

    def test_explicit_laya_goalpath_uses_host_model_and_baseline_profile(self):
        model = self.root / "model"
        model.mkdir()
        (model / "model.safetensors").write_bytes(b"fixture")
        with mock.patch.object(workflows.importlib.util, "find_spec", return_value=object()):
            solopi_ai.dispatch(self.args("alipay-education", ["--mode", "laya", "--model", str(model), "--profile", "baseline"]), self.adb)
        args = self.verify.call_args.args[0]
        self.assertEqual("goalpath", args.decision_provider)
        self.assertEqual("laya", args.goalpath_mode)
        self.assertEqual(str(model.resolve()), args.fastpath_model)
        self.assertEqual("legacy", args.settle_strategy)
        self.assertEqual("full-page", args.action_validation_strategy)

    def test_preflight_failure_returns_actionable_report_without_executing(self):
        self.doctor.return_value = ({"success": False, "missingPermissions": ["accessibility"]}, 2)
        payload, code = solopi_ai.dispatch(self.args(), self.adb)
        self.assertEqual(("not_tested", "stopped", 2), (payload["status"], payload["state"], code))
        self.assertIn("accessibility", Path(payload["report"]).read_text())
        self.verify.assert_not_called()
        self.capture.assert_not_called()

    def test_unsupported_profile_stops_before_screenshots_and_run(self):
        self.query.return_value = ({"success": True, "settleStrategies": ["legacy"]}, 0)
        payload, _ = solopi_ai.dispatch(self.args(), self.adb)
        self.assertEqual("workflow_profile_unsupported", payload["errorCode"])
        self.verify.assert_not_called()
        self.capture.assert_not_called()

    def test_missing_screenshot_or_inconsistent_receipt_does_not_claim_complete(self):
        for problem in ("missing", "omitted", "receipt"):
            self.missing_shot = problem == "missing"
            self.omit_shot = problem == "omitted"
            self.receipt_code = 2 if problem == "receipt" else None
            args = self.args()
            args.artifacts = str(self.root / problem)
            payload, code = solopi_ai.dispatch(args, self.adb)
            self.assertEqual(("passed", "stopped", False, 4), (payload["status"], payload["state"], payload["success"], code))
            self.assertEqual("workflow_report_mismatch" if problem == "receipt" else "workflow_screenshot_failed", payload["errorCode"])
            self.assertTrue(Path(payload["verificationReport"]).is_file())

    def test_interrupted_run_is_saved_and_never_retried(self):
        self.verify.side_effect = KeyboardInterrupt
        payload, code = solopi_ai.dispatch(self.args(), self.adb)
        self.assertEqual(("interrupted", "not_tested", 130), (payload["state"], payload["status"], code))
        self.assertTrue(Path(payload["report"]).is_file())
        self.assertEqual(1, self.verify.call_count)

    def test_existing_directory_is_not_overwritten(self):
        output = self.root / "run"
        output.mkdir()
        sentinel = output / "sentinel"
        sentinel.write_text("keep")
        with self.assertRaises(solopi_ai.CliError):
            solopi_ai.dispatch(self.args(), self.adb)
        self.assertEqual("keep", sentinel.read_text())
        self.doctor.assert_not_called()

    def test_report_rejects_changed_evidence_and_symlink_escape(self):
        payload, _ = solopi_ai.dispatch(self.args(), self.adb)
        args = solopi_ai.build_parser().parse_args(["workflow-report", "--artifacts", payload["artifacts"]])
        shot = Path(payload["screenshots"][0])
        shot.write_bytes(b"changed")
        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.dispatch(args, self.adb)
        self.assertEqual("workflow_evidence_changed", error.exception.details["errorCode"])
        outside = self.root / "outside.png"
        outside.write_bytes(PNG)
        shot.unlink()
        shot.symlink_to(outside)
        with self.assertRaises(solopi_ai.CliError) as error:
            solopi_ai.dispatch(args, self.adb)
        self.assertEqual("workflow_path_escape", error.exception.details["errorCode"])

    def test_report_rejects_traversal_invalid_and_forged_pass(self):
        payload, _ = solopi_ai.dispatch(self.args(), self.adb)
        args = solopi_ai.build_parser().parse_args(["workflow-report", "--artifacts", payload["artifacts"]])
        manifest = Path(payload["manifest"])
        original = json.loads(manifest.read_text())
        bad_path = copy.deepcopy(original)
        bad_path["filesSha256"]["../outside"] = "0" * 64
        invalid = copy.deepcopy(original)
        invalid["screenshots"] = [None]
        forged = copy.deepcopy(original)
        forged.pop("reportId")
        changed_summary = copy.deepcopy(original)
        changed_summary["scenarios"][0]["cleanup"] = "failed"
        for changed in (bad_path, invalid, forged, changed_summary):
            manifest.write_text(json.dumps(changed))
            with self.assertRaises(solopi_ai.CliError):
                solopi_ai.dispatch(args, self.adb)


class SegmentScreenshotTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.FastPathCliTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)

    def test_capture_keeps_independent_oracle_failure_and_required_cleanup(self):
        adb, _, replay, _, _, ended = self.fixture.mocked_device("broken")
        args = self.fixture.args("broken", extras=["--segment-screenshots"])
        with mock.patch.object(solopi_ai, "command_screenshot", side_effect=capture):
            payload, code = solopi_ai.command_verify_run(args, adb)
        report = json.loads(Path(payload["report"]).read_text())
        self.assertEqual(("failed", 2), (report["status"], code))
        self.assertEqual("oracle_mismatch", report["scenarios"][0]["failure"]["category"])
        self.assertEqual("passed", report["scenarios"][0]["cleanup"]["status"])
        self.assertEqual(2, replay.call_count)
        ended.assert_called_once()
        self.assertEqual(3, len(report["screenshots"]))
        self.assertTrue(all(item["status"] == "captured" for item in report["screenshots"]))
        self.assertEqual(3, report["timing"]["aggregates"]["verification.screenshot"]["count"])
        # The existing evidence registry deduplicates identical bytes, while the
        # screenshot index must still retain each segment's actual file.
        self.assertEqual(1, sum(item["type"] == "segment_screenshot" for item in report["evidence"]))
        self.assertTrue(all(Path(item["path"]).read_bytes() == PNG for item in report["screenshots"]))

    def test_capture_error_records_incomplete_evidence_without_skipping_cleanup(self):
        adb, _, replay, _, _, _ = self.fixture.mocked_device("baseline")
        with mock.patch.object(solopi_ai, "command_screenshot", side_effect=solopi_ai.CliError("secret error body", 4)):
            payload, code = solopi_ai.command_verify_run(self.fixture.args(extras=["--segment-screenshots"]), adb)
        report = json.loads(Path(payload["report"]).read_text())
        self.assertEqual(("passed", 0), (report["status"], code))
        self.assertEqual(2, replay.call_count)
        self.assertTrue(all(item["status"] == "failed" for item in report["screenshots"]))
        self.assertNotIn("secret error body", json.dumps(report))

    def test_screenshots_are_opt_in_for_existing_verify_users(self):
        adb, *_ = self.fixture.mocked_device("baseline")
        with mock.patch.object(solopi_ai, "command_screenshot") as screenshot:
            payload, _ = solopi_ai.command_verify_run(self.fixture.args(), adb)
        screenshot.assert_not_called()
        self.assertNotIn("screenshots", json.loads(Path(payload["report"]).read_text()))


if __name__ == "__main__":
    unittest.main()
