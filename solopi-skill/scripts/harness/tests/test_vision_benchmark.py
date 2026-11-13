"""Automatic test fixtures only; never phone captures or model benefit evidence."""
import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from solopi_harness import vision_benchmark as benchmark

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "vision-regression" / "protocol.json"


class VisionBenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="automatic-test-fixture-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.protocol = json.loads(EXAMPLE.read_text(encoding="utf-8"))

    def write(self, name, value):
        raw = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        return {"path": name, "sha256": hashlib.sha256(raw).hexdigest()}

    def dataset(self):
        groups, samples = [], []
        expected = self.write("automatic-test-fixture-expected.json", {"automaticTestFixture": True, "expectedOutcome": "pass"})
        # Header and unique fixture bytes are sufficient for the file-kind and
        # digest contract. These are deliberately not claimed as real captures.
        for index in range(180):
            split = "dev" if index < 60 else "holdout"
            task = self.protocol["tasks"][index % 8]["taskId"]
            group_id = "automatic-test-fixture-group-%d" % index
            groups.append({"groupId": group_id, "sourceGroupId": group_id, "split": split})
            screenshot = self.write("screens/automatic-test-fixture-%d.png" % index,
                                    b"\x89PNG\r\n\x1a\n" + str(index).encode("ascii"))
            samples.append({"sampleId": "automatic-test-fixture-%d" % index, "taskId": task,
                            "groupId": group_id, "screenshot": screenshot, "expected": expected,
                            "provenance": "automatic_test_fixture"})
        return {"schemaVersion": benchmark.DATASET_SCHEMA, "datasetId": "automatic-test-fixture-only",
                "frozenAt": "2026-10-19T00:00:00Z", "groups": groups, "samples": samples}

    def frozen(self):
        self.protocol["state"] = "frozen"
        self.protocol["frozenAt"] = "2026-10-19T01:00:00Z"
        for arm in self.protocol["arms"]:
            arm["runner"]["revision"] = "automatic-test-fixture-runner-v1"
            if arm["kind"] != "rules":
                arm["model"] = {"provider": "automatic-test-fixture-provider", "name": "automatic-test-fixture-model",
                                "version": "automatic-test-fixture-v1"}
                for key, value in arm["config"].items():
                    if isinstance(value, str) and value.startswith("REPLACE_WITH"):
                        arm["config"][key] = "automatic-test-fixture-config-v1"
        evidence = self.write("automatic-test-fixture-discovery.json", {"automaticTestFixture": True})
        for task in self.protocol["tasks"]:
            task["discovery"].update(status="verified", evidence=[evidence])
            if "runnerSupport" in task["discovery"]:
                task["discovery"]["runnerSupport"] = {name: "verified" for name in task["discovery"]["runnerSupport"]}
        self.protocol["baseline"]["declaredAt"] = "2026-10-18T00:00:00Z"
        self.protocol["baseline"]["rules"] = self.write("automatic-test-fixture-rules.json", {
            "schemaVersion": "automatic-test-fixture-rules/v1", "source": "predeclared", "mappings": {}})
        self.manifest = self.dataset()
        self.protocol["dataset"]["manifest"] = self.write("automatic-test-fixture-dataset.json", self.manifest)
        self.save_protocol()
        return benchmark.load_protocol(self.root / "protocol.json")

    def save_protocol(self):
        self.write("protocol.json", self.protocol)

    def save_dataset(self):
        self.protocol["dataset"]["manifest"] = self.write("automatic-test-fixture-dataset.json", self.manifest)
        self.save_protocol()

    def rows(self, loaded):
        return [{**{key: trial[key] for key in ("experimentId", "taskId", "arm", "round", "protocolSha256", "armIdentity", "runnerIdentity")},
                 **({"modelIdentity": trial["modelIdentity"]} if "modelIdentity" in trial else {}),
                 "status": "passed", "elapsedMs": 30, "wrongActions": 0, "falsePasses": 0,
                 "manualInterventions": 0, "phase": "cold" if trial["round"] == 1 else "warm",
                 "sentinelChecked": True, "evidence": ["automatic-test-fixture-evidence"],
                 "automaticTestFixture": True, "stageTimingsMs": {"total": 30, "model": 20, "action": 15}}
                for trial in benchmark.schedule(loaded)["trials"]]

    def test_example_is_draft_with_no_fabricated_schedule_or_benefit(self):
        loaded = benchmark.load_protocol(EXAMPLE)
        with self.assertRaisesRegex(benchmark.BenchmarkError, "frozen_verified_protocol_required"):
            benchmark.schedule(loaded)
        planned = benchmark.schedule(loaded, draft=True)
        self.assertEqual("draft", planned["status"])
        self.assertFalse(planned["executable"])
        self.assertEqual(320, planned["trialCount"])
        result = benchmark.summarize(loaded, [])
        self.assertEqual("incomplete", result["status"])
        self.assertFalse(result["benefitGatePassed"])
        self.assertTrue(all(row["gainPp"] is None for row in result["comparisons"]))

    def test_schedule_is_seeded_balanced_interleaved_and_label_free(self):
        loaded = self.frozen()
        planned = benchmark.schedule(loaded)
        self.assertEqual(planned, benchmark.schedule(loaded))
        primary = [r for r in planned["trials"] if r["experimentId"] == "primary"]
        artemis = [r for r in planned["trials"] if r["experimentId"] == "artemis"]
        self.assertEqual((240, 80), (len(primary), len(artemis)))
        self.assertEqual(320, len({(r["experimentId"], r["taskId"], r["arm"], r["round"]) for r in planned["trials"]}))
        block = primary[:3]
        self.assertEqual(3, len({r["arm"] for r in block}))
        self.assertEqual(1, len({r["trialSeed"] for r in block}))
        serialized = json.dumps(planned)
        for forbidden in ("expected", "difficult", "Sentinel", "sourceGroupId", str(self.root)):
            self.assertNotIn(forbidden, serialized)

    def test_artemis_is_an_independent_runner_on_four_common_real_alipay_flows(self):
        loaded = self.frozen()
        planned = benchmark.schedule(loaded)
        trials = planned["trials"]
        task_categories = {task["taskId"]: task["category"] for task in loaded["tasks"]}
        supplemental = [trial for trial in trials if trial["experimentId"] == "artemis"]
        self.assertEqual(320, len(trials))
        self.assertEqual(80, len(supplemental))
        self.assertEqual({"artemis-flash", "artemis-pro"}, {trial["arm"] for trial in supplemental})
        self.assertEqual({"alipay_read_only"}, {task_categories[trial["taskId"]] for trial in supplemental})
        self.assertEqual(4, len({trial["taskId"] for trial in supplemental}))
        for arm, mode in (("artemis-flash", "flash"), ("artemis-pro", "pro")):
            self.assertEqual(40, sum(trial["arm"] == arm for trial in supplemental))
            self.assertEqual("google/artemis", planned["runners"][arm]["framework"])
            self.assertEqual(mode, planned["runners"][arm]["mode"])
        primary_text = next(trial for trial in trials if trial["arm"] == "same-model-text")
        primary_vision = next(trial for trial in trials if trial["arm"] == "same-model-vision")
        self.assertEqual(primary_text["modelIdentity"], primary_vision["modelIdentity"])
        self.assertEqual(primary_text["runnerIdentity"], primary_vision["runnerIdentity"])
        flash = next(trial for trial in supplemental if trial["arm"] == "artemis-flash")
        pro = next(trial for trial in supplemental if trial["arm"] == "artemis-pro")
        self.assertEqual(flash["modelIdentity"], pro["modelIdentity"])
        self.assertNotEqual(flash["runnerIdentity"], pro["runnerIdentity"])
        result = benchmark.summarize(loaded, self.rows(loaded))
        self.assertEqual("artemis-flash", result["secondaryComparisons"][0]["baseline"])
        self.assertEqual("artemis-pro", result["secondaryComparisons"][0]["candidate"])

    def test_artemis_rejects_controlled_tasks_or_reused_solopi_vision_arm(self):
        wrong_tasks = copy.deepcopy(self.protocol)
        wrong_tasks["experiments"][1]["taskIds"] = [task["taskId"] for task in wrong_tasks["tasks"]
                                                   if task["category"] == "controlled_variant"]
        with self.assertRaisesRegex(benchmark.BenchmarkError, "artemis_requires_real_alipay_flows"):
            benchmark.schedule(wrong_tasks, draft=True)
        reused = copy.deepcopy(self.protocol)
        reused["experiments"][1]["arms"] = ["same-model-vision", "artemis-pro"]
        with self.assertRaisesRegex(benchmark.BenchmarkError, "invalid_artemis_experiment"):
            benchmark.schedule(reused, draft=True)

    def test_runner_and_model_identity_are_validated_separately(self):
        cases = [(lambda p: p["arms"][3]["runner"].update(framework="solopi-goalpath"), "invalid_artemis_runner"),
                 (lambda p: p["arms"][3]["runner"].update(mode="pro"), "invalid_artemis_runner"),
                 (lambda p: p["arms"][3]["runner"].update(revision="different-revision"), "same_artemis_runner_revision_required"),
                 (lambda p: p["arms"][1]["runner"].update(revision="different-revision"), "same_solopi_runner_revision_required"),
                 (lambda p: p["arms"][3]["model"].update(provider="artemis"), "runner_mode_is_not_model"),
                 (lambda p: p["arms"][3]["model"].update(name="flash"), "runner_mode_is_not_model"),
                 (lambda p: p["arms"][3].pop("runner"), "invalid_runner_identity")]
        for mutation, error in cases:
            changed = copy.deepcopy(self.protocol)
            mutation(changed)
            with self.subTest(error=error), self.assertRaisesRegex(benchmark.BenchmarkError, error):
                benchmark.schedule(changed, draft=True)

    def test_frozen_artemis_requires_fixed_revision_and_verified_common_support(self):
        self.frozen()
        original = copy.deepcopy(self.protocol)
        for arm in self.protocol["arms"]:
            if arm["kind"] == "agent":
                arm["runner"]["revision"] = "REPLACE_WITH_FROZEN_ARTEMIS_REVISION"
        self.save_protocol()
        with self.assertRaisesRegex(benchmark.BenchmarkError, "runner_revision_not_frozen"):
            benchmark.load_protocol(self.root / "protocol.json")
        self.protocol = copy.deepcopy(original)
        self.protocol["tasks"][0]["discovery"]["runnerSupport"]["artemis-pro"] = "unverified"
        self.save_protocol()
        with self.assertRaisesRegex(benchmark.BenchmarkError, "artemis_common_flow_unverified"):
            benchmark.load_protocol(self.root / "protocol.json")

    def test_artemis_rows_cannot_mix_flash_and_pro_runner_identity(self):
        loaded = self.frozen()
        rows = self.rows(loaded)
        flash_index = next(i for i, row in enumerate(rows) if row["arm"] == "artemis-flash")
        pro = next(row for row in rows if row["arm"] == "artemis-pro")
        for replacement in (None, pro["runnerIdentity"]):
            changed = copy.deepcopy(rows)
            if replacement is None:
                del changed[flash_index]["runnerIdentity"]
            else:
                changed[flash_index]["runnerIdentity"] = replacement
            result = benchmark.summarize(loaded, changed)
            self.assertEqual("incomplete", result["status"])
            self.assertIn("runner_identity_mismatch", {issue["reason"] for issue in result["issues"]})
            self.assertIsNone(result["secondaryComparisons"][0]["gainPp"])

    def test_mutating_loaded_protocol_downgrades_to_draft(self):
        loaded = self.frozen()
        loaded["seed"] += 1
        with self.assertRaisesRegex(benchmark.BenchmarkError, "frozen_verified_protocol_required"):
            benchmark.schedule(loaded)
        self.assertFalse(benchmark.schedule(loaded, draft=True)["executable"])

    def test_frozen_discovery_baseline_and_model_version_are_required(self):
        loaded = self.frozen()
        for mutation, error in ((lambda p: p["tasks"][0]["discovery"].update(status="unverified"), "discovery_unverified"),
                                (lambda p: p["baseline"].update(source="actual"), "predeclared_baseline_required"),
                                (lambda p: p["baseline"].update(declaredAt="2026-10-20T00:00:00Z"), "baseline_not_predeclared"),
                                (lambda p: p["arms"][3]["model"].update(version="latest"), "model_version_not_frozen")):
            original = copy.deepcopy(self.protocol)
            mutation(self.protocol)
            self.save_protocol()
            with self.subTest(error=error), self.assertRaisesRegex(benchmark.BenchmarkError, error):
                benchmark.load_protocol(self.root / "protocol.json")
            self.protocol = original

    def test_same_model_text_and_vision_must_share_config_and_version(self):
        for field in ("model", "config"):
            changed = copy.deepcopy(self.protocol)
            if field == "model":
                changed["arms"][2][field]["version"] = "different"
            else:
                changed["arms"][2][field]["temperature"] = 0.1
            with self.subTest(field=field), self.assertRaisesRegex(benchmark.BenchmarkError, "same_model_config_required"):
                benchmark.schedule(changed, draft=True)

    def test_all_failures_remain_in_planned_denominator_and_fixtures_never_claim_gain(self):
        loaded = self.frozen()
        rows = self.rows(loaded)
        rows[0]["status"] = "failed"
        result = benchmark.summarize(loaded, rows)
        self.assertEqual("complete", result["status"])
        arm = result["experiments"][rows[0]["experimentId"]]["arms"][rows[0]["arm"]]
        self.assertEqual(1, arm["failed"])
        self.assertEqual(arm["planned"], arm["tested"])
        self.assertEqual((arm["planned"] - 1) / arm["planned"], arm["passRatePlanned"])
        self.assertFalse(result["benefitEvidenceEligible"])
        self.assertFalse(result["benefitGatePassed"])
        self.assertTrue(all(c["gainPp"] is None for c in result["comparisons"]))
        for row in rows:
            del row["automaticTestFixture"]
        self.assertFalse(benchmark.summarize(loaded, rows)["benefitEvidenceEligible"])

    def test_gain_gate_uses_only_same_model_text_and_rules_remains_descriptive(self):
        # Pure arithmetic automatic fixtures; these are not observed trials and
        # never generate an eligible benchmark summary or real benefit evidence.
        arms = {"vision-fixture": {"kind": "vision"}, "text-fixture": {"kind": "text"}, "rules-fixture": {"kind": "rules"}}
        scenarios = [(72, 64, 80, True), (72, 64, 72, True), (72, 64, 64, True),
                     (72, 65, 0, False), (72, 65, 80, False), (72, 63, 80, True)]
        for vision_passes, text_passes, rules_passes, expected_gate in scenarios:
            metrics = {"vision-fixture": {"passRatePlanned": vision_passes / 80},
                       "text-fixture": {"passRatePlanned": text_passes / 80},
                       "rules-fixture": {"passRatePlanned": rules_passes / 80}}
            comparisons, gain_gate = benchmark._primary_comparisons(metrics, arms, "vision-fixture", eligible=True)
            by_baseline = {comparison["baseline"]: comparison for comparison in comparisons}
            with self.subTest(vision=vision_passes, text=text_passes, rules=rules_passes):
                self.assertEqual(expected_gate, gain_gate)
                self.assertTrue(by_baseline["text-fixture"]["controlsPromotion"])
                self.assertEqual(10, by_baseline["text-fixture"]["minimumGainPp"])
                self.assertEqual(expected_gate, by_baseline["text-fixture"]["passed"])
                self.assertFalse(by_baseline["rules-fixture"]["controlsPromotion"])
                self.assertIsNone(by_baseline["rules-fixture"]["minimumGainPp"])
                self.assertIsNone(by_baseline["rules-fixture"]["passed"])
                self.assertAlmostEqual((vision_passes - rules_passes) * 100 / 80, by_baseline["rules-fixture"]["gainPp"])
            suppressed, suppressed_gate = benchmark._primary_comparisons(metrics, arms, "vision-fixture", eligible=False)
            self.assertFalse(suppressed_gate)
            self.assertTrue(all(comparison["gainPp"] is None for comparison in suppressed))

    def test_summary_and_markdown_explicitly_mark_rules_as_comparison_only(self):
        loaded = self.frozen()
        result = benchmark.summarize(loaded, self.rows(loaded))
        comparisons = {comparison["baseline"]: comparison for comparison in result["comparisons"]}
        self.assertTrue(comparisons["same-model-text"]["controlsPromotion"])
        self.assertFalse(comparisons["rules"]["controlsPromotion"])
        self.assertIsNone(comparisons["rules"]["minimumGainPp"])
        self.assertIsNone(comparisons["rules"]["passed"])
        report = self.root / "automatic-test-fixture-report"
        benchmark.write_summary(result, report)
        self.assertIn("| same-model-vision | rules | 不可计算 | 仅比较，不设门槛 |", (report / "summary.md").read_text())
        self.assertFalse(result["benefitEvidenceEligible"])

    def test_missing_duplicate_extra_and_infra_rows_are_incomplete_without_gain(self):
        loaded = self.frozen()
        cases = {}
        rows = self.rows(loaded)
        cases["missing"] = rows[:-1]
        cases["duplicate"] = rows + [copy.deepcopy(rows[0])]
        extra = copy.deepcopy(rows[0])
        extra["taskId"] = "automatic-test-fixture-unknown-task"
        cases["unexpected"] = rows + [extra]
        infra = copy.deepcopy(rows)
        infra[0].update(status="not_tested", failureClass="infrastructure")
        cases["infra"] = infra
        mislabeled = copy.deepcopy(rows)
        mislabeled[0].update(status="failed", failureClass="infrastructure")
        cases["mislabeled-infra"] = mislabeled
        for label, case in cases.items():
            result = benchmark.summarize(loaded, case)
            with self.subTest(case=label):
                self.assertEqual("incomplete", result["status"])
                self.assertFalse(result["benefitGatePassed"])
                self.assertTrue(all(c["gainPp"] is None for c in result["comparisons"]))

    def test_independently_observed_task_refusal_completes_ledger_without_becoming_passed(self):
        loaded = self.frozen()
        rows = self.rows(loaded)
        index = next(i for i, row in enumerate(rows) if row["experimentId"] == "primary"
                     and row["arm"] == "same-model-vision" and row["taskId"] == "controlled-overlay")
        rows[index].update(status="not_tested", failureClass="task", outcomeObserved=True)
        result = benchmark.summarize(loaded, rows)
        arm = result["experiments"]["primary"]["arms"]["same-model-vision"]
        self.assertEqual("complete", result["status"])
        self.assertEqual("not_tested", rows[index]["status"])
        self.assertEqual((80, 80, 79, 79, 0, 1, 0),
                         tuple(arm[key] for key in ("recorded", "evaluated", "tested", "passed", "failed", "notTested", "unevaluatedPlanned")))
        self.assertEqual({"passed": 79, "failed": 0, "not_tested": 1}, arm["evaluatedStatusCounts"])
        self.assertEqual(79 / 80, arm["passRatePlanned"])
        self.assertTrue(result["gates"]["sentinels"])
        self.assertFalse(result["benefitEvidenceEligible"])

    def test_task_refusal_requires_explicit_independent_evidence_and_infrastructure_stays_incomplete(self):
        loaded = self.frozen()
        rows = self.rows(loaded)
        index = next(i for i, row in enumerate(rows) if row["experimentId"] == "primary"
                     and row["arm"] == "same-model-vision" and row["taskId"] == "controlled-icon")
        rows[index].update(status="not_tested", failureClass="task", outcomeObserved=True)
        for field, value in (("failureClass", None), ("failureClass", "infrastructure"), ("failureClass", "none"),
                             ("outcomeObserved", None), ("outcomeObserved", False), ("outcomeObserved", 1),
                             ("evidence", None), ("evidence", []), ("evidence", "not-a-list")):
            changed = copy.deepcopy(rows)
            if value is None:
                changed[index].pop(field, None)
            else:
                changed[index][field] = value
            result = benchmark.summarize(loaded, changed)
            arm = result["experiments"]["primary"]["arms"]["same-model-vision"]
            with self.subTest(field=field, value=value):
                self.assertEqual("incomplete", result["status"])
                self.assertEqual((80, 79, 1), (arm["recorded"], arm["evaluated"], arm["unevaluatedPlanned"]))
                self.assertEqual(1, arm["recordedStatusCounts"]["not_tested"])
                self.assertEqual(0, arm["notTested"])
                self.assertFalse(result["benefitGatePassed"])

    def test_refusal_and_failure_cost_usage_errors_and_latency_are_not_dropped(self):
        loaded = self.frozen()
        rows = self.rows(loaded)
        candidate = [row for row in rows if row["experimentId"] == "primary" and row["arm"] == "same-model-vision"]
        for index, row in enumerate(candidate, 1):
            row.update(elapsedMs=index, phase="cold" if index <= 5 else "warm",
                       cost={"amount": 1, "currency": "USD"}, usage={"inputTokens": 10})
        candidate[-1].update(status="not_tested", failureClass="task", outcomeObserved=True,
                             cost={"amount": 5, "currency": "USD"}, usage={"inputTokens": 50},
                             wrongActions=1, falsePasses=1, manualInterventions=1)
        candidate[-2].update(status="failed", cost={"amount": 3, "currency": "USD"}, usage={"inputTokens": 30})
        result = benchmark.summarize(loaded, rows)
        arm = result["experiments"]["primary"]["arms"]["same-model-vision"]
        self.assertEqual("complete", result["status"])
        self.assertEqual((78, 1, 1, 79, 80), tuple(arm[key] for key in ("passed", "failed", "notTested", "tested", "evaluated")))
        self.assertEqual(86, arm["cost"]["totalsByCurrency"]["USD"])
        self.assertEqual(80, arm["cost"]["recordedRows"])
        self.assertTrue(arm["cost"]["allEvaluatedRowsRecorded"])
        self.assertEqual(860, arm["usage"]["totals"]["inputTokens"])
        self.assertEqual((1, 1, 1), tuple(arm[key] for key in ("wrongActions", "falsePasses", "manualInterventions")))
        self.assertFalse(result["gates"]["falsePasses"])
        self.assertFalse(result["gates"]["manualInterventions"])
        overall = arm["timingOverall"]
        self.assertEqual((80, 0, 80, 40.5, 76), (overall["planned"], overall["unevaluatedPlanned"], overall["elapsed"]["n"],
                                               overall["elapsedMedianMs"], overall["elapsedP95Ms"]))
        cold, warm = arm["timingByPhase"]["cold"], arm["timingByPhase"]["warm"]
        self.assertEqual((5, 5, True), (cold["elapsed"]["n"], cold["elapsedP95Ms"], cold["elapsed"]["smallSample"]))
        self.assertEqual((75, 77, 1), (warm["elapsed"]["n"], warm["elapsedP95Ms"], warm["notTested"]))
        self.assertEqual(78 / 80, arm["passRatePlanned"])

    def test_refusal_keeps_difficult_gate_at_eight_passes_per_ten_evaluated(self):
        loaded = self.frozen()
        rows = self.rows(loaded)
        difficult = {task["taskId"] for task in loaded["tasks"] if task["difficult"]}
        for row in rows:
            if row["experimentId"] == "primary" and row["arm"] == "same-model-vision" and row["taskId"] in difficult and row["round"] >= 9:
                row.update(status="not_tested", failureClass="task", outcomeObserved=True)
        result = benchmark.summarize(loaded, rows)
        self.assertEqual("complete", result["status"])
        self.assertTrue(result["gates"]["difficultTasks"])
        self.assertEqual(sorted(difficult), result["difficultTasksMeetingEightOfTen"])
        for row in rows:
            if row["experimentId"] == "primary" and row["arm"] == "same-model-vision" and row["taskId"] in difficult and row["round"] == 8:
                row.update(status="not_tested", failureClass="task", outcomeObserved=True)
        result = benchmark.summarize(loaded, rows)
        self.assertFalse(result["gates"]["difficultTasks"])
        self.assertEqual([], result["difficultTasksMeetingEightOfTen"])

    def test_recorded_counts_keep_duplicates_and_infrastructure_status_without_evaluating_them(self):
        loaded = self.frozen()
        rows = self.rows(loaded)
        primary = next(row for row in rows if row["experimentId"] == "primary" and row["arm"] == "same-model-vision")
        rows.append(copy.deepcopy(primary))
        result = benchmark.summarize(loaded, rows)
        arm = result["experiments"]["primary"]["arms"]["same-model-vision"]
        self.assertEqual((81, 80, 79, 1), (arm["recorded"], arm["recordedUniqueTrials"], arm["evaluated"], arm["unevaluatedPlanned"]))
        self.assertEqual(81, arm["recordedStatusCounts"]["passed"])
        self.assertEqual("incomplete", result["status"])
        self.assertEqual(0, benchmark._distribution([])["n"])
        self.assertIsNone(benchmark._distribution([])["p95Ms"])

    def test_missing_counts_identity_phase_and_sentinel_evidence_fail_closed(self):
        loaded = self.frozen()
        rows = self.rows(loaded)
        sentinel = next(index for index, row in enumerate(rows) if row["taskId"] == "controlled-overlay")
        model = next(index for index, row in enumerate(rows) if "modelIdentity" in row)
        mutations = [(0, "manualInterventions", None), (0, "wrongActions", True), (0, "round", True),
                     (0, "phase", None), (model, "modelIdentity", "wrong"), (sentinel, "sentinelChecked", None),
                     (sentinel, "evidence", []), (0, "protocolSha256", "wrong")]
        for index, field, value in mutations:
            changed = copy.deepcopy(rows)
            if value is None:
                changed[index].pop(field, None)
            else:
                changed[index][field] = value
            result = benchmark.summarize(loaded, changed)
            with self.subTest(field=field):
                self.assertEqual("incomplete", result["status"])
                self.assertTrue(result["issues"])

    def test_sentinel_wrong_actions_false_pass_and_manual_intervention_block_gates(self):
        loaded = self.frozen()
        rows = self.rows(loaded)
        index = next(i for i, r in enumerate(rows) if r["experimentId"] == "primary"
                     and r["arm"] == "same-model-vision" and r["taskId"] == "controlled-overlay")
        for field, gate in (("wrongActions", "sentinels"), ("falsePasses", "falsePasses"),
                            ("manualInterventions", "manualInterventions")):
            changed = copy.deepcopy(rows)
            changed[index][field] = 1
            result = benchmark.summarize(loaded, changed)
            with self.subTest(field=field):
                self.assertFalse(result["gates"][gate])
                self.assertFalse(result["benefitGatePassed"])

    def test_dataset_checks_groups_duplicate_screens_and_every_hash(self):
        self.frozen()
        original = copy.deepcopy(self.manifest)
        mutations = [(lambda m: m["groups"][60].update(sourceGroupId=m["groups"][0]["sourceGroupId"]), "source_group_split_leakage"),
                     (lambda m: m["samples"][60].update(screenshot=m["samples"][0]["screenshot"]), "screenshot_split_leakage"),
                     (lambda m: m["samples"][179]["screenshot"].update(sha256="0" * 64), "artifact_digest_mismatch")]
        for mutation, error in mutations:
            self.manifest = copy.deepcopy(original)
            mutation(self.manifest)
            self.save_dataset()
            with self.subTest(error=error), self.assertRaisesRegex(benchmark.BenchmarkError, error):
                benchmark.validate_dataset(self.root / "automatic-test-fixture-dataset.json")

    def test_optional_frozen_request_is_hashed_but_not_exposed(self):
        self.frozen()
        request = self.write("automatic-test-fixture-request.json", {"goal": "automatic-test-fixture-semantic-goal"})
        self.manifest["samples"][0]["request"] = request
        self.save_dataset()
        result = benchmark.validate_dataset(self.root / "automatic-test-fixture-dataset.json")
        self.assertNotIn("automatic-test-fixture-semantic-goal", json.dumps(result))
        (self.root / request["path"]).write_text("{}", encoding="utf-8")
        with self.assertRaisesRegex(benchmark.BenchmarkError, "artifact_digest_mismatch"):
            benchmark.validate_dataset(self.root / "automatic-test-fixture-dataset.json")

    def test_at_least_two_difficult_tasks_need_eight_of_ten(self):
        loaded = self.frozen()
        rows = self.rows(loaded)
        difficult = [task["taskId"] for task in loaded["tasks"] if task["difficult"]]
        for row in rows:
            if (row["experimentId"] == "primary" and row["arm"] == "same-model-vision"
                    and row["taskId"] in difficult[:3] and row["round"] > 7):
                row["status"] = "failed"
        result = benchmark.summarize(loaded, rows)
        self.assertFalse(result["gates"]["difficultTasks"])
        for row in rows:
            if (row["experimentId"] == "primary" and row["arm"] == "same-model-vision"
                    and row["taskId"] == difficult[0] and row["round"] == 8):
                row["status"] = "passed"
        self.assertTrue(benchmark.summarize(loaded, rows)["gates"]["difficultTasks"])

    def test_dataset_rejects_absolute_parent_and_symlink_escapes(self):
        self.frozen()
        original = self.manifest["samples"][0]["screenshot"]["path"]
        escape = self.root / "escape"
        escape.symlink_to(self.root.parent, target_is_directory=True)
        for path in ("../automatic-test-fixture.png", str(self.root / original), "escape/automatic-test-fixture.png"):
            self.manifest["samples"][0]["screenshot"]["path"] = path
            self.save_dataset()
            with self.subTest(path=path), self.assertRaisesRegex(benchmark.BenchmarkError, "artifact_outside_root"):
                benchmark.validate_dataset(self.root / "automatic-test-fixture-dataset.json")

    def test_expected_answers_never_in_schedules_or_reports(self):
        loaded = self.frozen()
        result = benchmark.summarize(loaded, self.rows(loaded))
        serialized = json.dumps(benchmark.schedule(loaded)) + json.dumps(result)
        for forbidden in ("expectedOutcome", "automatic-test-fixture-expected.json", str(self.root)):
            self.assertNotIn(forbidden, serialized)

    def test_cold_warm_and_inclusive_stages_are_separate_and_cost_is_optional(self):
        loaded = self.frozen()
        rows = self.rows(loaded)
        for row in rows:
            row.update(cost={"amount": 0.01, "currency": "USD"}, usage={"inputTokens": 50, "outputTokens": 3})
        result = benchmark.summarize(loaded, rows)
        arm = result["experiments"]["primary"]["arms"]["same-model-vision"]
        self.assertEqual(8, arm["timingByPhase"]["cold"]["tested"])
        self.assertEqual(72, arm["timingByPhase"]["warm"]["tested"])
        self.assertEqual(30, arm["timingByPhase"]["warm"]["elapsedMedianMs"])
        self.assertEqual({"total": 30, "model": 20, "action": 15}, arm["timingByPhase"]["warm"]["stageInclusiveMedianMs"])
        self.assertAlmostEqual(0.8, arm["cost"]["totalsByCurrency"]["USD"])
        self.assertEqual(4000, arm["usage"]["totals"]["inputTokens"])

    def test_summary_is_regenerable_and_symlink_output_is_rejected(self):
        loaded = self.frozen()
        result = benchmark.summarize(loaded, self.rows(loaded))
        out = self.root / "output"
        benchmark.write_summary(result, out)
        first = {name: (out / name).read_bytes() for name in ("summary.json", "summary.md")}
        benchmark.write_summary(result, out)
        self.assertEqual(first, {name: (out / name).read_bytes() for name in first})
        self.assertIn("自动测试 fixture 不构成真实模型收益", first["summary.md"].decode("utf-8"))
        (out / "summary.md").unlink()
        (out / "summary.md").symlink_to(self.root / "outside-output.md")
        with self.assertRaisesRegex(benchmark.BenchmarkError, "output_unwritable"):
            benchmark.write_summary(result, out)

    def test_jsonl_duplicate_keys_and_nonfinite_values_are_rejected_without_raw_text(self):
        for raw in (b'{"token":"sensitive-value","token":"duplicate"}\n', b'{"token":"sensitive-value","elapsedMs":NaN}\n'):
            path = self.root / "automatic-test-fixture-rows.jsonl"
            path.write_bytes(raw)
            with self.assertRaises(benchmark.BenchmarkError) as context:
                benchmark.load_rows(path)
            self.assertNotIn("sensitive-value", str(context.exception))

    def test_cli_draft_schedule_and_empty_incomplete_summary(self):
        out = self.root / "schedule.json"
        with mock.patch("sys.stdout"):
            self.assertEqual(0, benchmark.main(["schedule", "--protocol", str(EXAMPLE), "--out", str(out), "--draft"]))
        self.assertEqual(320, json.loads(out.read_text())["trialCount"])
        rows = self.root / "automatic-test-fixture-empty.jsonl"
        rows.write_text("", encoding="utf-8")
        report = self.root / "report"
        with mock.patch("sys.stdout"):
            self.assertEqual(2, benchmark.main(["summarize", "--protocol", str(EXAMPLE), "--rows", str(rows), "--out", str(report)]))
        self.assertEqual("incomplete", json.loads((report / "summary.json").read_text())["status"])


if __name__ == "__main__":
    unittest.main()
