"""Local synthetic evidence checks only; no device, API or real sample labels."""
import contextlib
import copy
import hashlib
import io
import json
from pathlib import Path
import stat
import struct
import sys
import tempfile
import unittest
import zlib

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from solopi_harness import goalpath, verification_engine as engine, vision_benchmark, vision_collect as collector, visual_observation


PACKAGE = "com.example.collect"


def png():
    def chunk(kind, raw):
        return struct.pack(">I", len(raw)) + kind + raw + struct.pack(">I", zlib.crc32(kind + raw) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 12, 20, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress((b"\0" + b"\x20\x40\x60" * 12) * 20)) + chunk(b"IEND", b""))


def bounds(left=0, top=0, right=12, bottom=20):
    return {"left": left, "top": top, "right": right, "bottom": bottom}


def observation():
    return {"observationId": "fixture-observation-01", "page": {
        "nodeId": "root", "packageName": PACKAGE, "nodeBound": bounds(),
        "isEnabled": True, "visible": True, "isVisibleToUser": True, "isClickable": False,
        "children": [{"nodeId": "button", "packageName": PACKAGE, "nodeBound": bounds(1, 1, 11, 8),
            "text": "Search", "className": "android.widget.Button", "isEnabled": True, "visible": True,
            "isVisibleToUser": True, "isClickable": True, "isPassword": False}]},
        "visualContext": {"screenWidth": 12, "screenHeight": 20, "rotation": 0, "windowId": 7,
            "foregroundPackage": PACKAGE, "windows": [{"id": 7, "type": 1, "layer": 0, "active": True,
            "focused": True, "packageName": PACKAGE, "bounds": bounds()}]}}


def encode(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2) + "\n").encode()


class CollectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.run = self.root / "run"
        self.run.mkdir()
        self.output = self.root / "output" / "pilot"
        self.requirement = {"schemaVersion": engine.REQUIREMENT_SCHEMA, "id": "fixture-collect",
            "title": "Fixture input", "targetAppPackage": PACKAGE, "targetAppLabel": "Fixture",
            "acceptanceCriteria": [{"id": "AC-1", "text": "Search is visible"}],
            "scenarios": [{"id": "search", "title": "Search", "acceptanceCriteria": ["AC-1"],
                "steps": [{"id": "open", "type": "explore", "goal": "Open Search", "allowedActions": ["click"],
                    "budget": {"maxSteps": 3, "maxDurationMs": 180000, "idleTimeoutMs": 120000,
                               "maxRepeatedActions": 2, "maxNoProgressSteps": 2}}],
                "checkpoints": [{"id": "visible", "afterStep": "open", "acceptanceCriteria": ["AC-1"],
                    "oracle": {"type": "ui", "selector": {"text": "Search", "packageName": PACKAGE},
                               "field": "text", "operator": "equals", "expected": "Search"}}]}]}
        self.plan = engine.compile_verification_plan(self.requirement)
        self.plan_path = self.run / "plan.json"
        self.plan_path.write_bytes(encode(self.plan))
        self.segment = self.plan["intent"]["scenarios"][0]["segments"][0]
        self.segment_root = self.run / "segments" / "dynamic"
        self.segment_root.mkdir(parents=True)
        self.image_path = self.segment_root / "capture.png"
        self.image_path.write_bytes(png())
        self.observation = observation()
        snap = visual_observation._snapshot(self.observation, PACKAGE)
        self.visual = {"schemaVersion": "solopi.ai.visual-observation/v1", "observationId": self.observation["observationId"],
            "imagePath": str(self.image_path), "sha256": hashlib.sha256(png()).hexdigest(), "width": 12, "height": 20,
            "treeFingerprint": snap[0], "attempts": 1, "rotation": 0}
        policy = {"schemaVersion": goalpath.POLICY_SCHEMA, "targetPackage": PACKAGE, "steps": {"open": {
            "instructions": "Choose Search", "stopWhen": {"selector": {"text": "Done"}, "field": "text", "equals": "Done"}}}}
        provider = goalpath.GoalPathDecisionProvider(policy, mode="rules", visual_observations=True)
        self.decision = provider.decide({"stepId": "open", "goal": "Open Search", "allowedActions": ["click"],
                                        "observation": self.observation, "visual": self.visual})
        self.request = provider.last_request_snapshot()
        self.request_path = self.segment_root / "decision-000-request.json"
        self.request_path.write_bytes(encode(self.request))
        self.transcript_path = self.segment_root / "agent-transcript.json"
        self.transcript = {"scenarioId": "search", "stepId": "open", "goal": "Open Search", "allowedActions": ["click"],
            "events": [{"type": "visual_observation", "visual": self.visual, "observation": self.observation},
                       {"type": "act", "decision": self.decision, "result": {"receipt": {"status": "succeeded"}}}]}
        self.save()

    def ref(self, path, kind):
        raw = path.read_bytes()
        return {"type": kind, "path": str(path), "sha256": hashlib.sha256(raw).hexdigest(), "size": len(raw)}

    def save(self, with_request=True, extra_evidence=()):
        self.request_path.write_bytes(encode(self.request))
        request_ref = self.ref(self.request_path, "decision_request")
        if with_request:
            self.decision["modelReceipt"]["requestEvidence"] = request_ref
            self.decision["modelReceipt"]["requestDigest"] = vision_benchmark._digest(self.request)
        self.transcript_path.write_bytes(encode(self.transcript))
        evidence = [self.ref(self.image_path, "decision_screenshot"), self.ref(self.transcript_path, "agent_transcript"),
                    {"type": "automatic_test_fixture", "content": {"fixture": True}}]
        if with_request:
            evidence.append(request_ref)
        evidence.extend(extra_evidence)

        class Adapter:
            def execute(inner, segment, scenario, decisions):
                return {"state": "done", "agentDone": True, "observation": self.observation, "evidence": evidence}

        self.report = engine.execute_verification_plan(self.plan, Adapter(), now_ms=0)
        self.report["artifacts"] = {"plan": str(self.plan_path)}
        self.write_report()

    def write_report(self):
        (self.run / "report.json").write_bytes(encode(self.report))

    def shared_replay_screenshot(self):
        # Match the runner's real content-derived deduplication: preparation
        # registers identical pixels first; the dynamic segment references the
        # same ID but its own capture lives at a different exact path.
        dynamic_evidence = copy.deepcopy(self.report["evidence"])
        self.requirement["scenarios"][0]["preconditions"] = [{"id": "ready", "oracle": {
            "type": "ui", "selector": {"text": "Search", "packageName": PACKAGE},
            "field": "text", "operator": "equals", "expected": "Search"}}]
        self.plan = engine.compile_verification_plan(self.requirement)
        self.plan_path.write_bytes(encode(self.plan))
        self.segment = next(segment for segment in self.plan["intent"]["scenarios"][0]["segments"]
                            if segment["route"] == "dynamic")
        replay = self.run / "segments" / "preparation" / "replay" / "screen.png"
        replay.parent.mkdir(parents=True)
        replay.write_bytes(png())
        replay_ref = self.ref(replay, "replay_screenshot")

        class Adapter:
            def execute(inner, segment, scenario, decisions):
                if segment["phase"] == "precondition":
                    return {"state": "passed", "evidence": [replay_ref]}
                return {"state": "done", "agentDone": True, "observation": self.observation,
                        "evidence": dynamic_evidence}

        self.report = engine.execute_verification_plan(self.plan, Adapter(), now_ms=0)
        self.report["artifacts"] = {"plan": str(self.plan_path)}
        self.write_report()
        return replay

    def collect(self, **extra):
        return collector.collect(self.run, self.output, task_id="task-search", source_group_id="base-scene-01",
                                 group_id="group-scene-01", split="dev", **extra)

    def reject(self):
        with self.assertRaises(collector.CollectionError):
            self.collect()
        self.assertFalse(self.output.exists())

    def test_copies_exact_request_and_png_as_unlabeled_bundle_without_expected_or_rows(self):
        result = self.collect()
        self.assertEqual(collector.SCHEMA, result["schemaVersion"])
        self.assertFalse(result["evaluationReady"])
        self.assertFalse(result["realDeviceBenefitEvaluated"])
        self.assertFalse(result["sourceOriginAuthenticated"])
        self.assertTrue(result["automaticTestFixture"])
        self.assertEqual(1, len(result["samples"]))
        sample = result["samples"][0]
        self.assertEqual("dev", sample["split"])
        self.assertEqual("base-scene-01", sample["sourceGroupId"])
        self.assertEqual("unlabeled", sample["labelStatus"])
        self.assertNotIn("expected", sample)
        self.assertEqual(self.request_path.read_bytes(), (self.output / sample["request"]["path"]).read_bytes())
        self.assertEqual(png(), (self.output / sample["screenshot"]["path"]).read_bytes())
        pending = json.loads((self.output / "pending-labels.json").read_text())
        self.assertIsNone(pending["labels"][0]["expectedChoice"])
        self.assertEqual([], pending["labels"][0]["independentEvidence"])
        self.assertFalse(any("expected" in path.name or path.suffix == ".jsonl" for path in self.output.rglob("*")))
        self.assertEqual(0o700, stat.S_IMODE(self.output.stat().st_mode))
        self.assertTrue(all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in self.output.rglob("*") if path.is_file()))
        with self.assertRaises(vision_benchmark.BenchmarkError):
            vision_benchmark.validate_dataset(self.output / "bundle.json")

    def test_no_request_early_exit_preserves_capture_and_exclusions_without_fabricating_sample(self):
        self.transcript["events"][1] = {"type": "blocked", "reason": "no_candidates",
            "decision": {"type": "blocked", "modelReceipt": {"reason": "no_candidates"}}}
        self.save(with_request=False)
        result = self.collect()
        self.assertEqual([], result["samples"])
        self.assertEqual(1, len(result["captures"]))
        self.assertFalse(result["captures"][0]["usedByRequest"])
        self.assertEqual({"decision_without_choice_request", "capture_without_choice_request"},
                         {item["reason"] for item in result["exclusions"]})
        self.assertEqual(png(), (self.output / result["captures"][0]["screenshot"]["path"]).read_bytes())

    def test_same_segment_image_ref_survives_first_replay_type_and_path_deduplication(self):
        replay = self.shared_replay_screenshot()
        image_id = "evidence-" + self.visual["sha256"][:20]
        retained = next(entry for entry in self.report["evidence"] if entry["id"] == image_id)
        self.assertEqual("replay_screenshot", retained["type"])
        self.assertEqual(str(replay), retained["path"])
        self.assertNotEqual(retained["path"], self.visual["imagePath"])
        dynamic = next(segment for segment in self.report["scenarios"][0]["segments"] if segment["route"] == "dynamic")
        self.assertIn(image_id, dynamic["evidenceRefs"])
        self.assertEqual(1, sum(entry["sha256"] == self.visual["sha256"] for entry in self.report["evidence"]))
        result = self.collect()
        self.assertEqual(1, len(result["samples"]))
        sample = result["samples"][0]
        self.assertEqual(self.image_path.relative_to(self.run).as_posix(), sample["sourceScreenshotPath"])
        self.assertEqual(self.visual["sha256"], sample["screenshot"]["sha256"])
        self.assertEqual(self.request_path.read_bytes(), (self.output / sample["request"]["path"]).read_bytes())
        self.assertEqual(png(), (self.output / sample["screenshot"]["path"]).read_bytes())

    def test_identical_image_only_referenced_by_other_segment_cannot_supply_decision_capture(self):
        self.shared_replay_screenshot()
        image_id = "evidence-" + self.visual["sha256"][:20]
        segments = self.report["scenarios"][0]["segments"]
        self.assertIn(image_id, next(item for item in segments if item["phase"] == "precondition")["evidenceRefs"])
        dynamic = next(item for item in segments if item["route"] == "dynamic")
        dynamic["evidenceRefs"].remove(image_id)
        self.write_report()
        with self.assertRaisesRegex(collector.CollectionError, "^visual_not_in_segment_evidence$"):
            self.collect()
        self.assertFalse(self.output.exists())

    def test_shared_replay_reference_and_exact_capture_are_both_independently_verified(self):
        replay = self.shared_replay_screenshot()
        for path, code in ((replay, "evidence_digest_mismatch"), (self.image_path, "visual_digest_mismatch")):
            with self.subTest(path=path.name):
                original = path.read_bytes()
                path.write_bytes(original + b"changed")
                with self.assertRaisesRegex(collector.CollectionError, "^" + code + "$"):
                    self.collect()
                self.assertFalse(self.output.exists())
                path.write_bytes(original)

    def test_non_image_evidence_cannot_replace_shared_screenshot_despite_matching_hash(self):
        self.shared_replay_screenshot()
        retained = next(entry for entry in self.report["evidence"] if entry["sha256"] == self.visual["sha256"])
        retained["type"] = "replay_result"
        self.write_report()
        with self.assertRaisesRegex(collector.CollectionError, "^visual_not_in_segment_evidence$"):
            self.collect()
        self.assertFalse(self.output.exists())

    def test_transcript_without_events_and_missing_transcript_are_exclusions(self):
        self.transcript.pop("events")
        self.save(with_request=False)
        self.assertEqual("no_choice_request", self.collect()["exclusions"][0]["reason"])
        self.output = self.root / "another-output"
        self.report["scenarios"][0]["segments"][0]["evidenceRefs"] = []
        self.write_report()
        self.assertEqual("dynamic_transcript_unavailable", self.collect()["exclusions"][0]["reason"])

    def test_hash_change_in_transcript_request_or_png_fails_before_output(self):
        for path in (self.transcript_path, self.request_path, self.image_path):
            with self.subTest(path=path.name):
                saved = path.read_bytes()
                path.write_bytes(saved + b" ")
                self.reject()
                path.write_bytes(saved)

    def test_request_visual_observation_and_tree_mismatches_are_rejected(self):
        original_request, original_transcript = copy.deepcopy(self.request), copy.deepcopy(self.transcript)
        for mutation in (lambda: self.request["visual"].update(observationId="other"),
                         lambda: self.request["visual"].update(sha256="a" * 64),
                         lambda: self.transcript["events"][0]["observation"]["page"].update(text="Changed"),
                         lambda: self.transcript["events"][0]["visual"].update(width=13),
                         lambda: self.transcript.update(scenarioId="other")):
            self.request, self.transcript = copy.deepcopy(original_request), copy.deepcopy(original_transcript)
            self.decision = self.transcript["events"][1]["decision"]
            mutation()
            self.save()
            self.reject()

    def test_candidate_request_cannot_change_label_node_or_geometry_despite_new_request_hash(self):
        original_request, original_decision = copy.deepcopy(self.request), copy.deepcopy(self.decision)
        for mutation in (lambda: self.request["candidates"]["candidate_0"].update(label="Different"),
                         lambda: self.request["candidates"]["candidate_0"].update(visualBounds=[0, 0, 8, 6]),
                         lambda: self.decision["modelReceipt"]["candidates"]["candidate_0"].update(nodeId="missing")):
            self.request, self.decision = copy.deepcopy(original_request), copy.deepcopy(original_decision)
            self.transcript["events"][1]["decision"] = self.decision
            mutation()
            self.save()
            self.reject()

    def test_terminal_capture_with_same_pixels_and_no_request_remains_excluded(self):
        terminal_image = self.segment_root / "terminal.png"
        terminal_image.write_bytes(png())
        terminal_observation = copy.deepcopy(self.observation)
        terminal_observation["observationId"] = "fixture-terminal-02"
        terminal_visual = {**self.visual, "observationId": terminal_observation["observationId"],
                           "imagePath": str(terminal_image)}
        self.transcript["events"].extend([
            {"type": "visual_observation", "visual": terminal_visual, "observation": terminal_observation},
            {"type": "done", "decision": {"type": "done", "modelReceipt": {
                "observationId": terminal_observation["observationId"], "reason": "stop_condition_observed"}}}])
        self.save(extra_evidence=[self.ref(terminal_image, "decision_screenshot")])
        result = self.collect()
        self.assertEqual(1, len(result["samples"]))
        self.assertEqual(2, len(result["captures"]))
        self.assertEqual([True, False], [item["usedByRequest"] for item in result["captures"]])
        self.assertIn("capture_without_choice_request", {item["reason"] for item in result["exclusions"]})

    def test_stale_request_digest_or_missing_request_evidence_is_rejected(self):
        self.decision["modelReceipt"].update(requestDigest="f" * 64)
        self.transcript_path.write_bytes(encode(self.transcript))
        evidence = next(item for item in self.report["evidence"] if item["type"] == "agent_transcript")
        evidence.update(self.ref(self.transcript_path, "agent_transcript"))
        self.write_report()
        self.reject()
        self.decision["modelReceipt"].pop("requestEvidence")
        self.save(with_request=False)
        self.reject()

    def test_traversal_absolute_external_and_symlink_evidence_are_rejected(self):
        outside = self.root / "outside.json"
        outside.write_bytes(self.transcript_path.read_bytes())
        original = copy.deepcopy(self.report)
        for name in ("../outside.json", str(outside), str(self.run) + "-other/agent-transcript.json"):
            self.report = copy.deepcopy(original)
            next(item for item in self.report["evidence"] if item["type"] == "agent_transcript")["path"] = name
            self.write_report()
            self.reject()
        self.report = copy.deepcopy(original)
        saved = self.transcript_path.read_bytes()
        self.transcript_path.unlink()
        self.transcript_path.symlink_to(outside)
        self.write_report()
        self.reject()
        self.transcript_path.unlink()
        self.transcript_path.write_bytes(saved)
        folder = self.segment_root.parent
        folder.rename(self.run / "saved-segments")
        folder.symlink_to(self.run / "saved-segments", target_is_directory=True)
        self.reject()

    def test_plan_report_and_outcome_identity_mismatches_are_rejected(self):
        original = copy.deepcopy(self.report)
        for field, value in (("planFingerprint", "0" * 64), ("outcomeFingerprint", "0" * 64),
                             ("requirementId", "other"), ("status", "not_tested")):
            self.report = copy.deepcopy(original)
            self.report[field] = value
            self.write_report()
            self.reject()

    def test_invalid_png_semantic_request_and_duplicate_json_keys_are_rejected(self):
        self.image_path.write_bytes(png()[:-6])
        self.visual["sha256"] = hashlib.sha256(self.image_path.read_bytes()).hexdigest()
        self.request["visual"]["sha256"] = self.visual["sha256"]
        self.decision["modelReceipt"]["visual"]["sha256"] = self.visual["sha256"]
        self.save()
        self.reject()
        self.image_path.write_bytes(png())
        self.visual["sha256"] = hashlib.sha256(png()).hexdigest()
        self.request["visual"]["sha256"] = self.visual["sha256"]
        self.decision["modelReceipt"]["visual"]["sha256"] = self.visual["sha256"]
        self.request["candidates"] = {}
        self.save()
        self.reject()
        (self.run / "report.json").write_bytes(b'{"secret":"do-not-print","secret":2}')
        self.reject()

    def test_output_existing_symlink_and_nested_source_are_rejected_without_overwrite(self):
        self.collect()
        saved = (self.output / "bundle.json").read_bytes()
        with self.assertRaises(collector.CollectionError):
            self.collect()
        self.assertEqual(saved, (self.output / "bundle.json").read_bytes())
        self.output = self.root / "linked-output"
        self.output.symlink_to(self.root / "not-created")
        with self.assertRaises(collector.CollectionError):
            self.collect()
        self.assertFalse((self.root / "not-created").exists())
        self.output = self.run / "nested"
        self.reject()

    def test_cli_reports_only_safe_counts_and_fixed_error(self):
        args = ["--artifacts", str(self.run), "--output", str(self.output), "--task-id", "task-search",
                "--source-group-id", "scene-01", "--group-id", "scene-01", "--split", "dev"]
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            self.assertEqual(0, collector.main(args))
        self.assertEqual(1, json.loads(stdout.getvalue())["samples"])
        self.assertNotIn("Search", stdout.getvalue())
        self.assertNotIn(str(self.run), stdout.getvalue())
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr), self.assertRaises(SystemExit) as failure:
            collector.main(args)
        self.assertEqual(2, failure.exception.code)
        self.assertIn("output_already_exists", stderr.getvalue())
        self.assertNotIn(str(self.root), stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
