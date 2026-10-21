import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from solopi_harness import (trustbench, trustbench_stale_page,
                            trustbench_worker_takeover, verification_engine)


ROOT = Path(__file__).resolve().parents[2]
SUITE = ROOT / "solopi-harness-cli" / "trustbench" / "suite-v0.json"
AGENT_TASKS = ROOT / "solopi-harness-cli" / "trustbench" / "agent-tasks-v0.json"


class AgentTaskSetTests(unittest.TestCase):
    def setUp(self):
        self.requirement = json.loads(AGENT_TASKS.read_text(encoding="utf-8"))
        self.plan = verification_engine.compile_verification_plan(self.requirement)

    def test_each_task_resets_and_checks_zero_before_exploration(self):
        self.assertEqual(2, len(self.plan["intent"]["scenarios"]))
        for scenario in self.plan["intent"]["scenarios"]:
            self.assertEqual([], scenario["dependsOn"])
            segments = scenario["segments"]
            self.assertEqual("deterministic", segments[0]["route"])
            self.assertEqual("dynamic", segments[1]["route"])
            self.assertEqual("cleanup", segments[2]["phase"])
            self.assertEqual(
                ["tap-reset", "settle-reset", "oracle-reset-is-zero"],
                [step["stepId"] for step in segments[0]["case"]["operationLog"]["steps"]],
            )
            reset_check = next(item for item in scenario["checkpoints"]
                               if item["id"] == "reset-is-zero")
            self.assertEqual(segments[0]["segmentId"], reset_check["segmentId"])
            target_check = next(item for item in scenario["checkpoints"]
                                if item["id"] != "reset-is-zero")
            self.assertEqual(segments[1]["segmentId"], target_check["segmentId"])

    def test_first_task_failure_does_not_skip_second(self):
        class Adapter:
            def execute(self, segment, scenario, decisions):
                result = {"state": "passed", "evidence": [
                    {"type": "test_execution", "content": {"segmentId": segment["segmentId"]}}
                ]}
                if segment["route"] == "dynamic":
                    if scenario["id"] == "counter-to-one":
                        return {**result, "state": "blocked"}
                    return {**result, "state": "done", "agentDone": True,
                            "observation": PilotAdapter.observation("2")}
                return result

        report = verification_engine.execute_verification_plan(
            self.plan, Adapter(), now_ms=1000
        )
        by_id = {item["scenarioId"]: item for item in report["scenarios"]}
        self.assertNotEqual("passed", by_id["counter-to-one"]["status"])
        self.assertEqual("passed", by_id["counter-to-two"]["status"])

    def test_done_with_failed_target_oracle_is_not_passed(self):
        class Adapter:
            def execute(self, segment, scenario, decisions):
                result = {"state": "passed", "evidence": [
                    {"type": "test_execution", "content": {"segmentId": segment["segmentId"]}}
                ]}
                if segment["route"] == "dynamic":
                    return {**result, "state": "done", "agentDone": True,
                            "observation": PilotAdapter.observation("0")}
                return result

        report = verification_engine.execute_verification_plan(
            self.plan, Adapter(), now_ms=1000
        )
        self.assertTrue(all(item["status"] == "failed" for item in report["scenarios"]))


class WorkerTakeoverProbeTests(unittest.TestCase):
    def setUp(self):
        self.result = trustbench_worker_takeover.run_probe()
        self.assertEqual("passed", self.result["status"], self.result)

    def test_takeover_preserves_only_successor_result(self):
        snapshot = self.result["snapshot"]
        self.assertEqual("passed", trustbench_worker_takeover.evaluate(snapshot)["status"])
        self.assertEqual(2, len(snapshot["report"]["shards"][0]["attempts"]))

    def test_old_result_or_digest_cannot_be_spliced_into_report(self):
        snapshot = copy.deepcopy(self.result["snapshot"])
        old = snapshot["report"]["shards"][0]["attempts"][0]
        old["evidenceDigest"] = trustbench_worker_takeover.OLD_DIGEST
        self.assertEqual("failed", trustbench_worker_takeover.evaluate(snapshot)["status"])
        snapshot = copy.deepcopy(self.result["snapshot"])
        successor = snapshot["report"]["shards"][0]["attempts"][1]
        successor["verificationOutcomeFingerprint"] = trustbench_worker_takeover.OLD_OUTCOME
        self.assertEqual("failed", trustbench_worker_takeover.evaluate(snapshot)["status"])

    def test_unfinished_successor_or_unchanged_generation_fails(self):
        snapshot = copy.deepcopy(self.result["snapshot"])
        snapshot["report"]["shards"][0]["attempts"][1]["status"] = "running"
        self.assertEqual("failed", trustbench_worker_takeover.evaluate(snapshot)["status"])
        snapshot = copy.deepcopy(self.result["snapshot"])
        snapshot["newAssignment"]["ownerGeneration"] = snapshot["oldAssignment"]["ownerGeneration"]
        self.assertEqual("failed", trustbench_worker_takeover.evaluate(snapshot)["status"])

    def test_missing_history_or_accepted_old_write_fails(self):
        snapshot = copy.deepcopy(self.result["snapshot"])
        snapshot["report"]["shards"][0]["attempts"].pop(0)
        self.assertEqual("failed", trustbench_worker_takeover.evaluate(snapshot)["status"])
        snapshot = copy.deepcopy(self.result["snapshot"])
        snapshot["oldWriteCodes"]["complete"] = "accepted"
        self.assertEqual("failed", trustbench_worker_takeover.evaluate(snapshot)["status"])

    def test_store_initialization_error_is_not_a_pass(self):
        with patch.object(trustbench_worker_takeover, "ManagedExecutionStore",
                          side_effect=OSError("unavailable")):
            result = trustbench_worker_takeover.run_probe()
        self.assertEqual("infra_error", result["status"])


class PilotAdapter:
    def __init__(self, plan, fail_cleanup_test=False):
        self.plan = plan
        self.fail_cleanup_test = fail_cleanup_test

    def execute(self, segment, scenario, decisions):
        scenario_id = scenario["id"]
        result = {
            "state": "passed",
            "evidence": [{"type": "pilot_result", "content": {"segmentId": segment["segmentId"]}}],
        }
        if segment["phase"] == "test" and segment["route"] == "dynamic":
            if scenario_id == "hybrid-success":
                result.update({"state": "done", "observation": self.observation("1")})
            elif scenario_id == "agent-false-done":
                result.update({"state": "done", "agentDone": True,
                               "observation": self.observation("0")})
            elif scenario_id == "uncovered-checkpoint":
                result.update({"state": "blocked", "reason": "blocked_by_pilot"})
        if segment["phase"] == "test" and scenario_id == "product-failure":
            result.update({"state": "failed", "failedStepId":
                           scenario["checkpoints"][0]["oracleStepId"]})
        if (self.fail_cleanup_test and segment["phase"] == "test" and
                scenario_id == "cleanup-failure"):
            result.update({"state": "failed", "failedStepId":
                           scenario["checkpoints"][0]["oracleStepId"]})
        if segment["phase"] == "cleanup" and scenario_id == "cleanup-failure":
            oracle_step = next(
                item["stepId"] for item in segment["case"]["operationLog"]["steps"]
                if item["operationMethod"]["actionEnum"] == "ASSERT"
            )
            result.update({"state": "failed", "failedStepId": oracle_step})
        return result

    @staticmethod
    def observation(value):
        return {
            "observationId": "pilot-%s" % value,
            "page": {"children": [{
                "resourceId": "com.example.counter:id/counter_value",
                "className": "android.widget.TextView",
                "packageName": "com.example.counter",
                "text": value,
                "children": [],
            }]},
        }


class TrustBenchTests(unittest.TestCase):
    def setUp(self):
        self.suite, self.plan = trustbench.validate_suite(SUITE, ROOT)

    def report(self, fail_cleanup_test=False):
        return verification_engine.execute_verification_plan(
            self.plan, PilotAdapter(self.plan, fail_cleanup_test), now_ms=1000
        )

    def test_frozen_suite_compiles_and_scores_expected_outcomes(self):
        result = trustbench.score_report(self.suite, self.plan, self.report())
        self.assertEqual(5, result["matched"])
        self.assertEqual(5, result["total"])
        self.assertEqual("oracle_contract_pilot", result["evaluationTrack"])
        self.assertIs(result["agentPerformanceEligible"], False)

    def test_cleanup_business_oracle_follows_settle_wait(self):
        scenario = next(
            item for item in self.plan["intent"]["scenarios"]
            if item["id"] == "cleanup-failure"
        )
        segment = next(
            item for item in scenario["segments"] if item["phase"] == "test"
        )
        steps = segment["case"]["operationLog"]["steps"]
        self.assertEqual(
            ["tap-reset", "tap-increment", "settle-counter-value", "oracle-test-value-one"],
            [step["stepId"] for step in steps],
        )
        self.assertEqual("SLEEP", steps[2]["operationMethod"]["actionEnum"])
        self.assertEqual("1500", steps[2]["operationMethod"]["operationParam"]["text"])

    def test_fixture_digest_change_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "requirement.json"
            fixture.write_text(json.dumps({"changed": True}), encoding="utf-8")
            suite = copy.deepcopy(self.suite)
            suite["requirement"] = {
                "path": "requirement.json",
                "sha256": hashlib.sha256(b"original").hexdigest(),
            }
            suite["decisions"] = {
                "path": "decisions.json",
                "sha256": hashlib.sha256(b"{}").hexdigest(),
            }
            (root / "decisions.json").write_text("{}", encoding="utf-8")
            path = root / "suite.json"
            path.write_text(json.dumps(suite), encoding="utf-8")
            with self.assertRaisesRegex(trustbench.TrustBenchError, "digest mismatch"):
                trustbench.validate_suite(path, root)

    def test_other_plan_and_broken_evidence_are_rejected(self):
        report = self.report()
        report["planFingerprint"] = "0" * 64
        with self.assertRaisesRegex(trustbench.TrustBenchError, "another plan"):
            trustbench.score_report(self.suite, self.plan, report)

        report = self.report()
        report["scenarios"][0]["checkpoints"][0]["evidenceRefs"] = ["missing"]
        with self.assertRaisesRegex(trustbench.TrustBenchError, "unresolved evidence"):
            trustbench.score_report(self.suite, self.plan, report)

    def test_missing_checkpoint_is_rejected(self):
        report = self.report()
        report["scenarios"][0]["checkpoints"] = []
        with self.assertRaisesRegex(trustbench.TrustBenchError, "checkpoint set"):
            trustbench.score_report(self.suite, self.plan, report)

    def test_rewritten_outcome_is_rejected(self):
        report = self.report()
        report["status"] = "passed"
        with self.assertRaisesRegex(trustbench.TrustBenchError, "outcome fingerprint"):
            trustbench.score_report(self.suite, self.plan, report)

    def test_cleanup_probe_requires_passing_business_checkpoint(self):
        result = trustbench.score_report(
            self.suite, self.plan, self.report(fail_cleanup_test=True)
        )
        self.assertEqual(4, result["matched"])
        cleanup_probe = next(
            item for item in result["probes"] if item["dimension"] == "cleanup_verification"
        )
        self.assertFalse(cleanup_probe["matched"])
        self.assertEqual("failed", cleanup_probe["observedCheckpointStatuses"]["test-value-one"])
        self.assertEqual("failed", cleanup_probe["observedCleanupStatus"])

    def test_evidence_audit_rejects_cross_run_and_cross_segment_splicing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "run-a"
            entries = []
            segments = []
            for segment_id in ("segment-a", "segment-b"):
                path = root / "segments" / segment_id / "result.json"
                path.parent.mkdir(parents=True)
                content = segment_id.encode("ascii")
                path.write_bytes(content)
                digest = hashlib.sha256(content).hexdigest()
                evidence_id = "evidence-%s" % digest[:20]
                entries.append({"id": evidence_id, "type": "replay_result",
                                "path": str(path), "sha256": digest, "size": len(content)})
                segments.append({"segmentId": segment_id,
                                 "phase": "test" if segment_id == "segment-a" else "cleanup",
                                 "evidenceRefs": [evidence_id]})
            report = {"evidence": entries, "scenarios": [{
                "scenarioId": "scenario-a", "segments": segments,
                "checkpoints": [{"evidenceRefs": [entries[0]["id"]]}],
                "preconditions": {"evidenceRefs": []},
                "cleanup": {"evidenceRefs": [entries[1]["id"]]},
            }]}
            self.assertEqual(
                {"verifiedFiles": 2, "verifiedSegments": 2},
                trustbench.audit_evidence_bundle(report, root),
            )
            archived_stats = {str(Path(entry["path"]).resolve()): (entry["size"], entry["sha256"])
                              for entry in entries}
            self.assertEqual({"verifiedFiles": 2, "verifiedSegments": 2},
                             trustbench.audit_evidence_bundle(report, root, archived_stats))
            archived_stats[str(Path(entries[0]["path"]).resolve())] = (1, "0" * 64)
            with self.assertRaisesRegex(trustbench.TrustBenchError, "digest or size mismatch"):
                trustbench.audit_evidence_bundle(report, root, archived_stats)

            other_path = Path(directory) / "run-b" / "segments" / "segment-a" / "result.json"
            other_path.parent.mkdir(parents=True)
            other_path.write_bytes(b"segment-a")
            cross_run = copy.deepcopy(report)
            cross_run["evidence"][0]["path"] = str(other_path)
            with self.assertRaisesRegex(trustbench.TrustBenchError, "another run"):
                trustbench.audit_evidence_bundle(cross_run, root)

            cross_segment = copy.deepcopy(report)
            cross_segment["scenarios"][0]["segments"][0]["evidenceRefs"] = [entries[1]["id"]]
            with self.assertRaisesRegex(trustbench.TrustBenchError, "another segment"):
                trustbench.audit_evidence_bundle(cross_segment, root)

            cross_phase = copy.deepcopy(report)
            cross_phase["scenarios"][0]["checkpoints"][0]["evidenceRefs"] = [entries[1]["id"]]
            with self.assertRaisesRegex(trustbench.TrustBenchError, "another phase or scenario"):
                trustbench.audit_evidence_bundle(cross_phase, root)

            cross_scenario = copy.deepcopy(report)
            cross_scenario["scenarios"] = [
                {"scenarioId": "scenario-a", "segments": [segments[0]],
                 "checkpoints": [{"evidenceRefs": [entries[1]["id"]]}],
                 "preconditions": {"evidenceRefs": []}, "cleanup": {"evidenceRefs": []}},
                {"scenarioId": "scenario-b", "segments": [
                    dict(segments[1], phase="test")],
                 "checkpoints": [{"evidenceRefs": [entries[1]["id"]]}],
                 "preconditions": {"evidenceRefs": []}, "cleanup": {"evidenceRefs": []}},
            ]
            with self.assertRaisesRegex(trustbench.TrustBenchError, "another phase or scenario"):
                trustbench.audit_evidence_bundle(cross_scenario, root)

            (root / "segments" / "segment-a" / "result.json").write_bytes(b"tampered")
            with self.assertRaisesRegex(trustbench.TrustBenchError, "digest or size mismatch"):
                trustbench.audit_evidence_bundle(report, root)

    def test_evidence_audit_accepts_valid_unreached_checkpoint_and_rejects_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "segments" / "segment-a" / "result.json"
            path.parent.mkdir(parents=True)
            path.write_bytes(b"result")
            file_hash = hashlib.sha256(b"result").hexdigest()
            inline = {"type": "checkpoint_unreached", "content": {
                "scenarioId": "scenario-a", "checkpointId": "goal", "reason": "checkpoint_not_reached"}}
            inline_hash = verification_engine.canonical_fingerprint(inline)
            report = {"evidence": [
                {"id": "evidence-" + file_hash[:20], "type": "replay_result", "path": str(path),
                 "sha256": file_hash, "size": 6},
                {**inline, "id": "evidence-" + inline_hash[:20], "sha256": inline_hash},
            ], "scenarios": [{"scenarioId": "scenario-a", "segments": [
                {"segmentId": "segment-a", "phase": "test", "evidenceRefs": ["evidence-" + file_hash[:20]]}],
                "checkpoints": [{"checkpointId": "goal", "status": "not_tested",
                                 "evidenceRefs": ["evidence-" + inline_hash[:20]]}],
                "preconditions": {"evidenceRefs": []}, "cleanup": {"evidenceRefs": []}}]}
            self.assertEqual(1, trustbench.audit_evidence_bundle(report, root)["verifiedInline"])
            tampered = copy.deepcopy(report)
            tampered["evidence"][1]["content"]["checkpointId"] = "other"
            with self.assertRaisesRegex(trustbench.TrustBenchError, "invalid inline"):
                trustbench.audit_evidence_bundle(tampered, root)


class StalePageProbeTests(unittest.TestCase):
    def test_only_rejection_without_a_second_increment_passes(self):
        observation = {"observationId": "observation-1"}
        receipt = {"observationId": "observation-1", "status": "rejected",
                   "errorCode": "stale_observation"}
        before = {"value": "0", "status": "Ready"}
        changed = {"value": "1", "status": "Counting"}
        passed = trustbench_stale_page.evaluate(
            observation, receipt, before, changed, changed, 0
        )
        self.assertEqual("passed", passed["status"])

        second_click = trustbench_stale_page.evaluate(
            observation, receipt, before, changed,
            {"value": "2", "status": "Counting"}, 0
        )
        self.assertEqual("failed", second_click["status"])
        self.assertFalse(second_click["checks"]["no_second_increment"])

        no_injection = trustbench_stale_page.evaluate(
            observation, receipt, before, before, before, 0
        )
        self.assertEqual("failed", no_injection["status"])
        self.assertFalse(no_injection["checks"]["page_changed"])

    def test_observed_button_must_belong_to_counter_page(self):
        page = {"children": [
            {"resourceId": trustbench_stale_page.INCREMENT_ID,
             "packageName": trustbench_stale_page.PACKAGE, "nodeId": "node-7"},
            {"resourceId": trustbench_stale_page.INCREMENT_ID,
             "packageName": "another.app", "nodeId": "node-8"},
        ]}
        self.assertEqual("node-7", trustbench_stale_page._node(
            page, trustbench_stale_page.INCREMENT_ID
        )["nodeId"])
        page["children"][1]["packageName"] = trustbench_stale_page.PACKAGE
        with self.assertRaisesRegex(trustbench_stale_page.ProbeError, "exactly one"):
            trustbench_stale_page._node(page, trustbench_stale_page.INCREMENT_ID)


if __name__ == "__main__":
    unittest.main()
