import copy
import hashlib
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from solopi_harness import trustbench_agent_ledger, verification_engine
from solopi_harness.trustbench import TrustBenchError
from solopi_harness.trustbench_notes_storage import (
    REVISIT_PLAN_FINGERPRINT, REVISIT_SOURCE_FINGERPRINT,
    V3_PLAN_FINGERPRINT, V3_SOURCE_FINGERPRINT,
)


class AgentLedgerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.run = Path(self.temporary.name) / "model-run"
        self.run.mkdir()
        self.plan = {"planFingerprint": V3_PLAN_FINGERPRINT,
                     "sourceFingerprint": V3_SOURCE_FINGERPRINT,
                     "intent": {"scenarios": [{"segments": [
                         {"segmentId": "reset", "route": "deterministic"},
                         {"segmentId": "agent", "route": "dynamic"},
                     ]}]}}
        self.scenario = {
            "scenarioId": "create-review-note", "status": "passed", "failure": None,
            "segments": [{"segmentId": "reset", "route": "deterministic", "state": "passed"},
                         {"segmentId": "agent", "route": "dynamic", "state": "done", "agentDone": True}],
            "checkpoints": [
                {"checkpointId": "list-is-empty", "status": "passed", "reason": "compiled_oracle_passed"},
                {"checkpointId": "saved-title-matches", "status": "passed", "reason": "matched",
                 "actual": "Quarterly review"},
                {"checkpointId": "saved-body-matches", "status": "passed", "reason": "matched",
                 "actual": "Check totals before Friday"},
            ],
            "cleanup": {"status": "not_required"},
        }
        self.report = {"schemaVersion": verification_engine.REPORT_SCHEMA,
                       "planFingerprint": V3_PLAN_FINGERPRINT, "reportId": "run-1",
                       "status": "passed", "scenarios": [self.scenario]}
        self.write_report()
        (self.run / "plan.json").write_text(json.dumps(self.plan))
        (self.run / "events.jsonl").write_text('{"event": "started"}\n')
        transcript = self.run / "segments" / "agent" / "agent-transcript.json"
        transcript.parent.mkdir(parents=True)
        transcript.write_text(json.dumps({"events": [
            {"type": "act", "decision": {"modelReceipt": {
                "modelId": "Kimi-K3", "requestId": "request-1", "fallbackUsed": False}}},
            {"type": "done"},
        ]}))
        self.receipt = {"status": "passed", "runId": "model-run",
                        "planFingerprint": V3_PLAN_FINGERPRINT,
                        "observed": {"title": "Quarterly review", "body": "Check totals before Friday"},
                        "apkSha256": "a" * 64, "serial": "device-1"}
        self.write_receipt()

    def write_report(self):
        self.report["outcomeFingerprint"] = verification_engine.canonical_fingerprint({
            "planFingerprint": self.plan["planFingerprint"],
            "status": self.report["status"],
            "scenarios": [{"scenarioId": self.scenario["scenarioId"],
                           "status": self.scenario["status"],
                           "failureCategory": None,
                           "checkpoints": [{"checkpointId": c["checkpointId"],
                                            "status": c["status"], "reason": c["reason"]}
                                           for c in self.scenario["checkpoints"]],
                           "cleanup": "not_required"}],
        })
        (self.run / "report.json").write_text(json.dumps(self.report))

    def write_receipt(self):
        (self.run / "storage-readback.json").write_text(json.dumps(self.receipt))

    def evaluate(self):
        with patch.object(trustbench_agent_ledger, "audit_evidence_bundle",
                          return_value={"verifiedFiles": 1, "verifiedSegments": 1}):
            return trustbench_agent_ledger.evaluate_attempt(self.run, "model", "Kimi-K3")

    def test_pass_requires_storage_and_model_receipt(self):
        result = self.evaluate()
        self.assertEqual("passed", result["outcome"])
        self.assertEqual("device-1", result["deviceSerial"])
        self.assertEqual("a" * 64, result["apkSha256"])
        self.assertEqual(hashlib.sha256(b'{"event": "started"}\n').hexdigest(),
                         result["eventsSha256"])
        self.assertEqual(64, len(result["transcriptSha256"]))
        self.receipt["observed"]["title"] = "Trip checklist"
        self.write_receipt()
        with self.assertRaisesRegex(TrustBenchError, "storage receipt"):
            self.evaluate()

    def test_tampered_report_status_is_rejected(self):
        self.report["status"] = "failed"
        (self.run / "report.json").write_text(json.dumps(self.report))
        with self.assertRaisesRegex(TrustBenchError, "outcome fingerprint"):
            self.evaluate()

    def test_model_fallback_is_rejected(self):
        transcript = self.run / "segments" / "agent" / "agent-transcript.json"
        content = json.loads(transcript.read_text())
        content["events"][0]["decision"]["modelReceipt"]["fallbackUsed"] = True
        transcript.write_text(json.dumps(content))
        with self.assertRaisesRegex(TrustBenchError, "fallback mismatch"):
            self.evaluate()

    def test_mixed_output_budgets_are_rejected(self):
        transcript = self.run / "segments" / "agent" / "agent-transcript.json"
        content = json.loads(transcript.read_text())
        content["events"][0]["decision"]["modelReceipt"]["maxOutputTokens"] = 4096
        content["events"][1]["decision"] = {"modelReceipt": {
            "modelId": "Kimi-K3", "requestId": "request-2", "fallbackUsed": False,
            "maxOutputTokens": 1024}}
        transcript.write_text(json.dumps(content))
        with self.assertRaisesRegex(TrustBenchError, "mixed or missing model output budgets"):
            self.evaluate()

    def test_output_budget_is_extracted_from_receipts(self):
        transcript = self.run / "segments" / "agent" / "agent-transcript.json"
        content = json.loads(transcript.read_text())
        content["events"][0]["decision"]["modelReceipt"]["maxOutputTokens"] = 4096
        transcript.write_text(json.dumps(content))
        self.assertEqual(4096, self.evaluate()["modelMaxOutputTokens"])

    def test_invalid_output_budget_is_rejected(self):
        transcript = self.run / "segments" / "agent" / "agent-transcript.json"
        for budget in ([], {}, True, 0, "4096"):
            with self.subTest(budget=budget):
                content = json.loads(transcript.read_text())
                content["events"][0]["decision"]["modelReceipt"]["maxOutputTokens"] = budget
                transcript.write_text(json.dumps(content))
                with self.assertRaisesRegex(TrustBenchError, "invalid model output token budget"):
                    self.evaluate()

    def test_non_object_model_receipt_is_rejected(self):
        transcript = self.run / "segments" / "agent" / "agent-transcript.json"
        content = json.loads(transcript.read_text())
        content["events"][0]["decision"]["modelReceipt"] = ["unexpected"]
        transcript.write_text(json.dumps(content))
        with self.assertRaisesRegex(TrustBenchError, "invalid model decision receipt"):
            self.evaluate()

    def test_partial_output_budget_is_rejected(self):
        transcript = self.run / "segments" / "agent" / "agent-transcript.json"
        content = json.loads(transcript.read_text())
        content["events"][0]["decision"]["modelReceipt"]["maxOutputTokens"] = 4096
        content["events"][1]["decision"] = {"modelReceipt": {
            "modelId": "Kimi-K3", "requestId": "request-2", "fallbackUsed": False}}
        transcript.write_text(json.dumps(content))
        with self.assertRaisesRegex(TrustBenchError, "mixed or missing model output budgets"):
            self.evaluate()

    def test_policy_groups_keep_unknown_identity_and_budgets_separate(self):
        manifest = Path(self.temporary.name) / "manifest.json"
        manifest.write_text(json.dumps({"schemaVersion":
            "solopi.trustbench.agent-ledger-manifest/v1", "attempts": [
                {"runDir": str(Path(self.temporary.name) / name), "track": "model",
                 "modelId": "Kimi-K3"} for name in ("a", "b", "c", "d")]}))
        base = self.evaluate()
        rows = []
        for name, budget, device, outcome in (
                ("a", None, None, "provider_not_tested"),
                ("b", 300, None, "provider_not_tested"),
                ("c", 1024, None, "provider_not_tested"),
                ("d", 4096, "device-1", "passed")):
            row = {**base, "runId": name, "modelMaxOutputTokens": budget,
                   "deviceSerial": device, "apkSha256": "a" * 64 if device else None,
                   "outcome": outcome}
            rows.append(row)
        with patch.object(trustbench_agent_ledger, "evaluate_attempt", side_effect=rows):
            result = trustbench_agent_ledger.evaluate_manifest(manifest)
        self.assertEqual(4, len(result["policyGroups"]))
        self.assertEqual({None, 300, 1024, 4096},
                         {group["modelMaxOutputTokens"] for group in result["policyGroups"]})
        unknown = result["policyGroups"][0]
        self.assertIsNone(unknown["deviceSerial"])
        self.assertIsNone(unknown["apkSha256"])
        self.assertEqual({"a"}, set(unknown["runIds"]))

    def test_failed_overwritten_receipt_is_not_a_pass(self):
        self.receipt = {"status": "failed", "runId": "model-run",
                        "reason": "persisted_values_mismatch"}
        self.write_receipt()
        self.assertEqual("evidence_invalid", self.evaluate()["outcome"])

    def test_action_error_is_retained_in_not_tested_row(self):
        self.scenario["status"] = "not_tested"
        self.scenario["segments"][1]["state"] = "not_tested"
        self.scenario["segments"][1]["reason"] = "agent_action_failed"
        self.report["status"] = "not_tested"
        self.write_report()
        transcript = self.run / "segments" / "agent" / "agent-transcript.json"
        transcript.write_text(json.dumps({"events": [{"type": "act", "result": {
            "receipt": {"status": "rejected", "errorCode": "stale_observation"}}}]}))
        result = self.evaluate()
        self.assertEqual("not_tested", result["outcome"])
        self.assertEqual("agent_action_failed", result["failureReason"])
        self.assertEqual("stale_observation", result["actionErrorCode"])

    def test_revisit_pass_requires_all_three_segments_and_intermediate_oracles(self):
        self.plan["planFingerprint"] = REVISIT_PLAN_FINGERPRINT
        self.plan["sourceFingerprint"] = REVISIT_SOURCE_FINGERPRINT
        self.plan["intent"]["scenarios"][0]["segments"].extend([
            {"segmentId": "return", "route": "dynamic"},
            {"segmentId": "reopen", "route": "dynamic"},
        ])
        (self.run / "plan.json").write_text(json.dumps(self.plan))
        self.report["planFingerprint"] = REVISIT_PLAN_FINGERPRINT
        self.scenario["scenarioId"] = "revisit-budget-note"
        self.scenario["segments"].extend([
            {"segmentId": "return", "route": "dynamic", "state": "done", "agentDone": True},
            {"segmentId": "reopen", "route": "dynamic", "state": "done", "agentDone": True},
        ])
        self.scenario["checkpoints"] = [
            {"checkpointId": checkpoint, "status": "passed", "reason": "matched", "actual": actual}
            for checkpoint, actual in (
                ("list-is-empty", None), ("initial-title-matches", "Budget review"),
                ("initial-body-matches", "Reconcile 3 invoices"),
                ("list-has-one-note", "1"), ("list-title-matches", "Budget review"),
                ("reopened-title-matches", "Budget review"),
                ("reopened-body-matches", "Reconcile 3 invoices"),
            )
        ]
        self.receipt["planFingerprint"] = REVISIT_PLAN_FINGERPRINT
        self.receipt["observed"] = {"title": "Budget review", "body": "Reconcile 3 invoices"}
        self.write_receipt()
        for segment in ("return", "reopen"):
            transcript = self.run / "segments" / segment / "agent-transcript.json"
            transcript.parent.mkdir()
            transcript.write_text(json.dumps({"events": [{"type": "done", "decision": {
                "modelReceipt": {"modelId": "Kimi-K3", "requestId": segment,
                                 "fallbackUsed": False}}}]}))
        self.write_report()
        result = self.evaluate()
        self.assertEqual("passed", result["outcome"])
        self.assertEqual(3, result["modelDecisionCount"])
        self.assertEqual(3, len(result["transcriptSha256s"]))

        self.scenario["checkpoints"][3]["actual"] = "0"
        self.write_report()
        with self.assertRaisesRegex(TrustBenchError, "mismatched UI checkpoint"):
            self.evaluate()
        self.scenario["checkpoints"][3]["actual"] = "1"
        self.scenario["segments"].pop()
        self.write_report()
        with self.assertRaisesRegex(TrustBenchError, "lacks Agent done"):
            self.evaluate()

    def test_later_segment_model_failure_is_provider_not_tested(self):
        self.plan["intent"]["scenarios"][0]["segments"].append(
            {"segmentId": "return", "route": "dynamic"})
        (self.run / "plan.json").write_text(json.dumps(self.plan))
        self.scenario["segments"].append(
            {"segmentId": "return", "route": "dynamic", "state": "not_tested",
             "reason": "model_decision_failed", "agentDone": False})
        self.scenario["status"] = "not_tested"
        self.report["status"] = "not_tested"
        self.write_report()
        transcript = self.run / "segments" / "return" / "agent-transcript.json"
        transcript.parent.mkdir()
        transcript.write_text(json.dumps({"events": [{"type": "act", "decision": {
            "modelReceipt": {"modelId": "Kimi-K3", "requestId": "return-1",
                             "fallbackUsed": False}}}]}))
        result = self.evaluate()
        self.assertEqual("provider_not_tested", result["outcome"])
        self.assertEqual("model_decision_failed", result["failureReason"])

    def archive(self, entries):
        archive = Path(self.temporary.name) / "model-run.tar.gz"
        with tarfile.open(archive, "w:gz") as stream:
            for name, data in entries:
                info = tarfile.TarInfo(name)
                info.size = len(data)
                stream.addfile(info, io.BytesIO(data))
        return archive

    def test_archive_stream_reads_files_and_ignores_appledouble(self):
        data = b'{"status": "passed"}'
        archive = self.archive([("._model-run", b"metadata"),
                                ("model-run/report.json", data)])
        source = trustbench_agent_ledger.RunSource(self.run, archive)
        self.assertEqual({"status": "passed"}, source.read_json("report.json"))
        self.assertEqual(hashlib.sha256(data).hexdigest(), source.sha256("report.json"))
        with self.assertRaisesRegex(TrustBenchError, "missing archived file"):
            source.sha256("plan.json")

    def test_archive_rejects_escape_and_duplicate_members(self):
        for entries, message in [
            ([("model-run/../outside", b"bad")], "escapes run"),
            ([("model-run/report.json", b"1"),
              ("model-run/report.json", b"2")], "duplicate archive member"),
        ]:
            with self.subTest(message=message):
                archive = self.archive(entries)
                with self.assertRaisesRegex(TrustBenchError, message):
                    trustbench_agent_ledger.RunSource(self.run, archive)


if __name__ == "__main__":
    unittest.main()
