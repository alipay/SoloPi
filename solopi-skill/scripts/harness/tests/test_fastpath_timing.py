import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "solopi_harness"))
import solopi_ai
import timing
import test_fastpath_cli as cli_fixtures


class ManualClock:
    def __init__(self):
        self.value = 0.0

    def __call__(self):
        return self.value

    def advance(self, seconds):
        self.value += seconds


class FastPathTimingTests(unittest.TestCase):
    def test_nested_totals_have_nonoverlapping_exclusive_accounting(self):
        clock = ManualClock()
        recorder = timing.TimingRecorder(clock=clock)
        with recorder.activate(), timing.span("verification.total"):
            clock.advance(1)
            with timing.span("fixed.replay"):
                clock.advance(2)
                with timing.span("transport.http_roundtrip"):
                    clock.advance(3)
            clock.advance(4)
        summary = recorder.summary()
        self.assertEqual(10000, summary["hostElapsedMs"])
        self.assertEqual(5000, summary["attributedExclusiveMs"])
        self.assertEqual(5000, summary["unattributedMs"])
        aggregates = summary["aggregates"]
        self.assertEqual(5000, aggregates["fixed.replay"]["inclusiveMs"])
        self.assertEqual(2000, aggregates["fixed.replay"]["exclusiveMs"])
        self.assertEqual(3000, aggregates["transport.http_roundtrip"]["exclusiveMs"])
        self.assertEqual([None, 1, 2], [item["parentSequence"] for item in recorder.export()["spans"]])

    def test_detail_bound_keeps_complete_aggregates_and_parent_accounting(self):
        clock = ManualClock()
        recorder = timing.TimingRecorder(clock=clock, max_spans=1)
        with recorder.activate(), timing.span("verification.total"):
            for _ in range(10):
                with timing.span("provider.decide"):
                    clock.advance(0.01)
        exported = recorder.export()
        self.assertEqual(1, len(exported["spans"]))
        self.assertEqual(10, exported["droppedSpanCount"])
        self.assertEqual(10, exported["aggregates"]["provider.decide"]["count"])
        self.assertEqual(100, exported["attributedExclusiveMs"])
        self.assertEqual(0, exported["unattributedMs"])

    def test_exceptions_are_counted_without_recording_arguments_or_error_text(self):
        secret = "owner-secret/private-url\r\nforged-log"

        @timing.measured("provider.decide")
        def fail(payload):
            raise RuntimeError(payload)

        recorder = timing.TimingRecorder()
        with recorder.activate(), timing.span("verification.total"):
            with self.assertRaisesRegex(RuntimeError, "owner-secret"):
                fail(secret)
        self.assertEqual(1, recorder.summary()["aggregates"]["provider.decide"]["exceptionCount"])
        encoded = json.dumps(recorder.export())
        for forbidden in (secret, "private-url", "forged-log", "RuntimeError"):
            self.assertNotIn(forbidden, encoded)
        with self.assertRaises(ValueError):
            timing.measured(secret)

    def test_inactive_instrumentation_preserves_return_value_and_sleep(self):
        sentinel = object()

        @timing.measured("provider.decide")
        def passthrough(payload):
            return payload

        self.assertIs(sentinel, passthrough(sentinel))
        sleeper = mock.Mock()
        timing.poll_sleep(0.25, sleeper)
        sleeper.assert_called_once_with(0.25)

    def test_context_is_reset_after_failure_and_nested_recorders_are_isolated(self):
        outer, inner = timing.TimingRecorder(), timing.TimingRecorder()
        with outer.activate(), timing.span("verification.total"):
            with self.assertRaises(RuntimeError):
                with inner.activate(), timing.span("verification.total"):
                    raise RuntimeError("failure")
            with timing.span("provider.decide"):
                pass
        with timing.span("fixed.import"):
            pass
        self.assertNotIn("fixed.import", outer.aggregates)
        self.assertNotIn("provider.decide", inner.aggregates)
        self.assertEqual(2, outer.sequence)

    def test_http_and_adb_roundtrips_record_no_transport_payload(self):
        recorder = timing.TimingRecorder()
        response = mock.MagicMock()
        response.__enter__.return_value.status = 200
        response.__enter__.return_value.will_close = True
        response.__enter__.return_value.read.return_value = b'{"success":true}'
        connection = mock.Mock()
        connection.getresponse.return_value = response
        with recorder.activate(), timing.span("verification.total"):
            with mock.patch.object(solopi_ai.http.client, "HTTPConnection", return_value=connection):
                result = solopi_ai.HarnessHttpClient(23342).get("agent", {"ownerToken": "secret-value"})
            completed = mock.Mock(returncode=0, stdout=b"private-account", stderr=b"")
            with mock.patch.object(solopi_ai.subprocess, "run", return_value=completed):
                command = solopi_ai.CommandRunner().run(["adb", "-s", "private-device", "version"])
        self.assertTrue(result["success"])
        self.assertEqual("private-account", command.stdout)
        encoded = json.dumps(recorder.export())
        for forbidden in ("secret-value", "private-device", "private-account", "127.0.0.1"):
            self.assertNotIn(forbidden, encoded)
        self.assertEqual(1, recorder.aggregates["transport.http_roundtrip"]["count"])
        self.assertEqual(1, recorder.aggregates["transport.adb_roundtrip"]["count"])

    def test_verify_report_exports_timings_without_changing_oracle_or_cleanup(self):
        for scenario, expected in (("baseline", "passed"), ("broken", "failed")):
            with self.subTest(scenario=scenario):
                fixture = cli_fixtures.FastPathCliTests()
                fixture.setUp()
                try:
                    adb, imported, replayed, _, acted, ended = fixture.mocked_device(scenario)
                    payload, code = solopi_ai.command_verify_run(fixture.args(scenario), adb)
                    report = json.loads(Path(payload["report"]).read_text())
                    measurements = json.loads(Path(payload["timing"]).read_text())
                    self.assertEqual(expected, report["status"])
                    self.assertEqual(0 if expected == "passed" else 2, code)
                    self.assertEqual("exported", payload["timingExportStatus"])
                    self.assertEqual("passed", report["scenarios"][0]["cleanup"]["status"])
                    self.assertEqual(2, imported.call_count)
                    self.assertEqual(2, replayed.call_count)
                    self.assertEqual(1, acted.call_count)
                    ended.assert_called_once()
                    self.assertEqual(report["timing"], {key: value for key, value in measurements.items() if key != "spans"})
                    self.assertIn("segment.cleanup.fixed", measurements["aggregates"])
                    self.assertIn("segment.test.dynamic", measurements["aggregates"])
                    self.assertIn("provider.decide", measurements["aggregates"])
                    self.assertIsNone(measurements["nativeTreeCollectionMs"])
                    self.assertIsNone(measurements["modelKernelMs"])
                    self.assertNotIn("ownerToken", json.dumps(measurements))
                    if expected == "failed":
                        self.assertEqual("oracle_mismatch", report["scenarios"][0]["failure"]["category"])
                finally:
                    fixture.doCleanups()

    def test_stale_refresh_query_counts_one_observation_roundtrip(self):
        recorder = timing.TimingRecorder()
        args = SimpleNamespace(session_id="session-1", owner_token="owner-token-at-least-16")
        session = mock.MagicMock()
        session.__enter__.return_value.agent.return_value = {"success": True, "observation": {}}
        with mock.patch.object(solopi_ai, "session_from_args", return_value=session):
            with recorder.activate(), timing.span("verification.total"):
                result, code = solopi_ai.command_agent_query(args, mock.Mock(), "observe")
        self.assertEqual(0, code)
        self.assertTrue(result["success"])
        self.assertEqual(1, recorder.aggregates["observation.roundtrip"]["count"])
        session.__enter__.return_value.agent.assert_called_once_with("observe", {
            "sessionId": args.session_id, "ownerToken": args.owner_token,
        })

    def test_optional_export_replace_failures_preserve_report_and_original_verdict(self):
        for failed_file in ("timing.json", "report.json"):
            for status, expected_code in (("passed", 0), ("failed", 2)):
                with self.subTest(failed_file=failed_file, status=status), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    report_path = root / "report.json"
                    original = json.dumps({"status": status, "artifacts": {}, "checkpoints": ["unchanged"]}).encode()
                    report_path.write_bytes(original)
                    payload = {"report": str(report_path), "status": status, "success": status == "passed"}
                    actual_replace = solopi_ai.os.replace

                    def replace(source, target):
                        if Path(target).name == failed_file:
                            raise OSError("secret-owner-and-private-path")
                        return actual_replace(source, target)

                    with mock.patch.object(solopi_ai, "_command_verify_run", return_value=(payload, expected_code)), \
                            mock.patch.object(solopi_ai.os, "replace", side_effect=replace):
                        result, code = solopi_ai.command_verify_run(SimpleNamespace(), mock.Mock())
                    self.assertEqual(expected_code, code)
                    self.assertEqual(status, result["status"])
                    self.assertEqual(status == "passed", result["success"])
                    self.assertEqual(original, report_path.read_bytes())
                    self.assertEqual("failed", result["timingExportStatus"])
                    self.assertEqual("timing_export_failed" if failed_file == "timing.json" else "timing_report_attach_failed",
                                     result["timingExportErrorCode"])
                    self.assertNotIn("secret-owner", json.dumps(result))
                    self.assertEqual([], list(root.glob(".timing-*.tmp")))

    def test_partial_temporary_write_cannot_truncate_existing_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / "report.json"
            report.write_text("original report")

            def write_partial(_payload, destination, **_kwargs):
                destination.write("incomplete")
                raise OSError("disk full")

            with mock.patch.object(solopi_ai.json, "dump", side_effect=write_partial), self.assertRaises(OSError):
                solopi_ai._write_timing_json_atomic(report, {})
            self.assertEqual("original report", report.read_text())
            self.assertEqual([], list(root.glob(".timing-*.tmp")))


if __name__ == "__main__":
    unittest.main()
