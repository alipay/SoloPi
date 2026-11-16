import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest import mock
import urllib.error
import zlib

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from solopi_harness import goalpath_vision, vision_benchmark, vision_evaluate as evaluator


def png_bytes(color):
    def chunk(name, data):
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data) & 0xFFFFFFFF)
    return (goalpath_vision.PNG_SIGNATURE + chunk(b"IHDR", struct.pack(">IIBBBBB", 16, 12, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress((b"\0" + bytes(color) * 16) * 12)) + chunk(b"IEND", b""))


class VisionEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.output = self.root / "new-results"
        self.env = mock.patch.dict(os.environ, {"OFFLINE_TEST_KEY": "private-offline-key"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.manifest = {"schemaVersion": vision_benchmark.DATASET_SCHEMA, "datasetId": "offline-test",
            "frozenAt": "2026-10-19T12:00:00+08:00",
            "groups": [{"groupId": "dev-group", "sourceGroupId": "dev-source", "split": "dev"},
                       {"groupId": "holdout-group", "sourceGroupId": "holdout-source", "split": "holdout"}], "samples": []}
        for index, split in enumerate(("dev", "dev", "holdout")):
            request = {"schemaVersion": "solopi.ai.goalpath-choice/v1", "goal": "Open Search", "instructions": "Choose safely",
                "history": [], "pageText": ["Search", "Cancel"], "pageTextTruncated": False,
                "candidates": {"candidate_0": {"label": "Search", "operation": "click", "visualBounds": [0, 0, 8, 6]},
                               "candidate_1": {"label": "Cancel", "operation": "click", "visualBounds": [8, 6, 16, 12]}}}
            sample = {"sampleId": "sample-%d" % index, "taskId": "task-search", "groupId": split + "-group",
                "screenshot": self.artifact("screen-%d.png" % index, png_bytes((10 + index, 30, 50))),
                "request": self.artifact("request-%d.json" % index, request),
                "expected": self.artifact("private-answer-%d.json" % index, {"choice": "candidate_0"}),
                "provenance": "automatic_test_fixture"}
            self.manifest["samples"].append(sample)
        self.path = self.root / "manifest.json"
        self.save_manifest()
        self.messages = []
        self.predictors = []
        self.progress_counts = []

    def artifact(self, name, value):
        raw = value if isinstance(value, bytes) else json.dumps(value).encode("utf-8")
        (self.root / name).write_bytes(raw)
        return {"path": name, "sha256": hashlib.sha256(raw).hexdigest()}

    def save_manifest(self):
        self.path.write_text(json.dumps(self.manifest), encoding="utf-8")

    def factory(self, endpoint, model, **kwargs):
        predictor = goalpath_vision.GoalPathVisionPredictor(endpoint, model, **kwargs)
        predictor.opener = mock.Mock()
        predictor.opener.open.side_effect = self.open_request
        self.predictors.append(predictor)
        return predictor

    def open_request(self, request, **kwargs):
        self.messages.append(request)
        rows = self.output / "rows.jsonl"
        self.progress_counts.append(len(rows.read_text().splitlines()) if rows.exists() else 0)
        body = json.loads(request.data)
        semantic = json.loads(body["messages"][1]["content"][0]["text"])
        choice = next(key for key, item in semantic["candidates"].items() if item["label"] == "Search")
        raw = {"choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": json.dumps({"choice": choice})}}],
               "usage": {"prompt_tokens": 20, "completion_tokens": 6, "total_tokens": 26}}
        response = io.BytesIO(json.dumps(raw).encode("utf-8"))
        response.status = 200
        return response

    def run_evaluation(self, **kwargs):
        with mock.patch.object(evaluator, "GoalPathVisionPredictor", side_effect=self.factory):
            return evaluator.evaluate(self.path, "https://api.openai.com/v1", "fixed-test-model", self.output,
                                      api_key_env="OFFLINE_TEST_KEY", **kwargs)

    def rows(self):
        return [json.loads(line) for line in (self.output / "rows.jsonl").read_text().splitlines()]

    def test_four_conditions_make_real_transport_requests_and_reverse_maps_to_original(self):
        summary = self.run_evaluation()
        rows = self.rows()
        self.assertEqual(8, len(self.messages))
        self.assertEqual(list(range(8)), self.progress_counts)
        self.assertEqual(["text-forward", "text-reverse", "vision-forward", "vision-reverse"] * 2,
                         [row["condition"] for row in rows])
        self.assertTrue(all(row["choice"] == "candidate_0" and row["correct"] for row in rows))
        for index in range(0, len(self.messages), 4):
            bodies = [json.loads(message.data) for message in self.messages[index:index + 4]]
            self.assertEqual(["fixed-test-model"] * 4, [body["model"] for body in bodies])
            self.assertEqual([128] * 4, [body["max_tokens"] for body in bodies])
            self.assertEqual([1, 1, 2, 2], [len(body["messages"][1]["content"]) for body in bodies])
            contexts = [json.loads(body["messages"][1]["content"][0]["text"]) for body in bodies]
            self.assertEqual(contexts[0], contexts[2])
            self.assertEqual(contexts[1], contexts[3])
            self.assertEqual("Cancel", contexts[1]["candidates"]["candidate_0"]["label"])
            self.assertEqual([0, 0, 8, 6], contexts[1]["candidates"]["candidate_1"]["visualBounds"])
            for body in bodies:
                serialized = json.dumps(body)
                for forbidden in ("private-answer", "expectedChoice", "private-offline-key", "sample-0", "imagePath"):
                    self.assertNotIn(forbidden, serialized)
        self.assertEqual({"dev": 2, "holdout": 0}, summary["sampleCounts"])
        self.assertFalse(summary["realDeviceBenefitEvaluated"])
        self.assertFalse(summary["expectedAnswersExposedToModel"])
        for condition in summary["conditions"].values():
            self.assertEqual(2, condition["correct"])
            self.assertEqual(0, condition["failures"])
            self.assertEqual(1.0, condition["accuracyAcrossAllRows"])
        meta = json.loads((self.output / "metadata.json").read_text())
        self.assertEqual({"dev": 2, "holdout": 1}, meta["datasetCounts"])
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(), meta["manifestSha256"])
        self.assertEqual(64, len(meta["protocolSha256"]))
        self.assertEqual(64, len(meta["configIdentity"]))
        self.assertEqual(128, meta["configuration"]["maxTokens"])
        self.assertEqual("completed", meta["runStatus"])
        self.assertTrue((self.output / "protocol.json").exists())
        for path in self.output.iterdir():
            self.assertNotIn("private-offline-key", path.read_text())

    def test_custom_output_budget_is_identical_in_all_conditions_and_config_identity(self):
        self.run_evaluation(limit=1, max_output_tokens=2048)
        self.assertEqual([2048] * 4, [json.loads(message.data)["max_tokens"] for message in self.messages])
        self.assertEqual([2048] * 2, [predictor.max_output_tokens for predictor in self.predictors])
        self.assertEqual([2048] * 2, [predictor.metadata["maxOutputTokens"] for predictor in self.predictors])
        self.assertEqual([2048] * 4, [row["inference"]["maxOutputTokens"] for row in self.rows()])
        meta = json.loads((self.output / "metadata.json").read_text())
        self.assertEqual(2048, meta["configuration"]["maxTokens"])
        self.assertEqual(vision_benchmark._digest(meta["configuration"]), meta["configIdentity"])
        other = dict(meta["configuration"], maxTokens=128)
        self.assertNotEqual(vision_benchmark._digest(other), meta["configIdentity"])

    def test_invalid_output_budget_is_rejected_before_preflight_or_calls(self):
        for budget in (True, False, 0, -1, 4097, 1.0, "128", None, float("inf")):
            with self.subTest(budget=budget), mock.patch.object(evaluator, "_load_samples") as load, \
                    mock.patch.object(evaluator, "GoalPathVisionPredictor") as factory:
                with self.assertRaisesRegex(evaluator.EvaluationError, "invalid_max_output_tokens"):
                    evaluator.evaluate(self.path, "https://api.openai.com/v1", "m", self.output, max_output_tokens=budget)
                load.assert_not_called()
                factory.assert_not_called()
        self.assertFalse(self.output.exists())
        self.assertEqual([], self.messages)

    def test_dev_limit_is_allowed_but_holdout_limit_rejected_before_calls(self):
        self.assertEqual(4, self.run_evaluation(limit=1)["rows"])
        self.assertEqual(4, len(self.messages))
        for limit in (1, 0, True, -1):
            with mock.patch.object(evaluator, "GoalPathVisionPredictor") as factory:
                with self.assertRaises(evaluator.EvaluationError):
                    evaluator.evaluate(self.path, "https://api.openai.com/v1", "m", self.root / "holdout-results", split="holdout", limit=limit)
                factory.assert_not_called()

    def test_holdout_has_four_conditions_without_dev_samples(self):
        result = self.run_evaluation(split="holdout")
        self.assertEqual({"dev": 0, "holdout": 1}, result["sampleCounts"])
        self.assertEqual(["sample-2"] * 4, [row["sampleId"] for row in self.rows()])

    def test_all_splits_and_all_requests_preflight_before_first_api_call(self):
        self.manifest["samples"][2]["expected"] = self.artifact("private-answer-2.json", {"choice": "candidate_9"})
        self.save_manifest()
        with mock.patch.object(evaluator, "GoalPathVisionPredictor") as factory:
            with self.assertRaises(evaluator.EvaluationError):
                self.run_evaluation(limit=1)
            factory.assert_not_called()
        self.assertFalse(self.output.exists())
        self.assertEqual([], self.messages)

    def test_hash_mismatch_traversal_and_duplicate_request_json_fail_before_calls(self):
        original = copy.deepcopy(self.manifest)
        variants = []
        changed = copy.deepcopy(original)
        changed["samples"][0]["request"]["sha256"] = "0" * 64
        variants.append(changed)
        changed = copy.deepcopy(original)
        changed["samples"][0]["request"]["path"] = "../outside.json"
        variants.append(changed)
        changed = copy.deepcopy(original)
        changed["samples"][0]["request"] = self.artifact("duplicate.json", b'{"goal":"a","goal":"b"}')
        variants.append(changed)
        changed = copy.deepcopy(original)
        changed["samples"][0].pop("request")
        variants.append(changed)
        for changed in variants:
            self.manifest = changed
            self.save_manifest()
            with self.subTest(changed=changed["samples"][0]["sampleId"]), self.assertRaises(evaluator.EvaluationError):
                self.run_evaluation()
            self.assertFalse(self.output.exists())
            self.assertEqual([], self.messages)

    def test_frozen_capture_visual_keeps_evidence_but_replaces_old_local_path(self):
        sample = self.manifest["samples"][0]
        request = json.loads((self.root / sample["request"]["path"]).read_text())
        request["visual"] = {"schemaVersion": goalpath_vision.VISUAL_SCHEMA, "observationId": "private-captured-observation",
            "imagePath": "/old/capture/not-present.png", "sha256": sample["screenshot"]["sha256"], "width": 16, "height": 12,
            "treeFingerprint": "a" * 64, "attempts": 2}
        sample["request"] = self.artifact("request-0.json", request)
        self.save_manifest()
        self.run_evaluation(limit=1)
        self.assertEqual(["frozen-capture-metadata"] * 4, [row["evidenceOrigin"] for row in self.rows()])
        self.assertTrue(all(b"/old/capture" not in message.data and b"private-captured-observation" not in message.data for message in self.messages))

    def test_api_failure_is_one_row_without_retry_and_remaining_calls_continue(self):
        original = self.open_request
        count = 0
        def fail_once(request, **kwargs):
            nonlocal count
            count += 1
            if count == 2:
                raise urllib.error.URLError("private-offline-key remote raw payload")
            return original(request, **kwargs)
        self.open_request = fail_once
        result = self.run_evaluation(limit=1)
        rows = self.rows()
        self.assertEqual(4, count)
        self.assertEqual(["completed", "failed", "completed", "completed"], [row["status"] for row in rows])
        self.assertEqual("transport_unavailable_or_invalid_response", rows[1]["failureCategory"])
        self.assertNotIn("choice", rows[1])
        self.assertEqual(1, result["conditions"]["text-reverse"]["failures"])
        self.assertEqual(0.0, result["conditions"]["text-reverse"]["accuracyAcrossAllRows"])
        self.assertNotIn("private-offline-key", (self.output / "rows.jsonl").read_text())

    def test_interruption_retains_flushed_rows_and_partial_summary(self):
        original = self.open_request
        count = 0
        def interrupt(request, **kwargs):
            nonlocal count
            count += 1
            if count == 3:
                raise KeyboardInterrupt()
            return original(request, **kwargs)
        self.open_request = interrupt
        with self.assertRaises(KeyboardInterrupt):
            self.run_evaluation(limit=1)
        self.assertEqual(2, len(self.rows()))
        self.assertEqual("interrupted", json.loads((self.output / "metadata.json").read_text())["runStatus"])
        self.assertEqual(2, json.loads((self.output / "summary.json").read_text())["rows"])

    def test_expected_answer_never_overrides_output_and_existing_output_is_not_reused(self):
        sample = self.manifest["samples"][0]
        sample["expected"] = self.artifact("private-answer-0.json", {"choice": "abstain"})
        self.save_manifest()
        result = self.run_evaluation(limit=1)
        self.assertTrue(all(row["choice"] == "candidate_0" and row["correct"] is False for row in self.rows()))
        self.assertTrue(all(part["wrongActionSuggestions"] == 1 for part in result["conditions"].values()))
        before = (self.output / "rows.jsonl").read_bytes()
        with self.assertRaises(evaluator.EvaluationError):
            self.run_evaluation(limit=1)
        self.assertEqual(before, (self.output / "rows.jsonl").read_bytes())

    def test_summary_distinguishes_abstentions_failures_and_wrong_action_suggestions(self):
        rows = [{"condition": "text-forward", "status": "completed", "choice": "abstain", "correct": True},
                {"condition": "text-forward", "status": "completed", "choice": "abstain", "correct": False},
                {"condition": "text-forward", "status": "completed", "choice": "candidate_0", "correct": False},
                {"condition": "text-forward", "status": "failed"}]
        result = evaluator._summary(rows, {"dev": 1, "holdout": 0})["conditions"]["text-forward"]
        self.assertEqual((1, 2, 1, 1), (result["correct"], result["abstentions"], result["wrongActionSuggestions"], result["failures"]))
        self.assertEqual(0.25, result["accuracyAcrossAllRows"])

    def test_cli_uses_explicit_options_and_redacts_failures(self):
        argv = ["--manifest", str(self.path), "--endpoint", "https://api.openai.com/v1", "--model", "fixed-test-model",
                "--api-key-env", "OFFLINE_TEST_KEY", "--allowed-host", "api.openai.com", "--output", str(self.output),
                "--limit", "1", "--max-output-tokens", "2048"]
        output, errors = io.StringIO(), io.StringIO()
        with mock.patch.object(evaluator, "GoalPathVisionPredictor", side_effect=self.factory), \
                contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            self.assertEqual(0, evaluator.main(argv))
        self.assertEqual(4, json.loads(output.getvalue())["rows"])
        self.assertEqual([2048] * 4, [json.loads(message.data)["max_tokens"] for message in self.messages])
        self.assertEqual(2048, json.loads((self.output / "metadata.json").read_text())["configuration"]["maxTokens"])
        self.assertEqual("", errors.getvalue())
        output, errors = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            self.assertEqual(2, evaluator.main(argv))
        self.assertEqual({"error": "vision_evaluation_failed"}, json.loads(errors.getvalue()))
        self.assertNotIn(str(self.path), errors.getvalue())
        self.assertNotIn("private-offline-key", errors.getvalue())


if __name__ == "__main__":
    unittest.main()
