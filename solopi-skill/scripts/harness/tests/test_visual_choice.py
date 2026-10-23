"""Safety/decision contract tests; no model download, network, or device access."""

import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest


_SCRIPT = Path(__file__).resolve().parents[1] / "examples" / "fastpath" / "visual_choice.py"
_SPEC = importlib.util.spec_from_file_location("visual_choice", _SCRIPT)
visual_choice = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(visual_choice)


class VisualChoiceContractTests(unittest.TestCase):
    def test_query_longer_than_model_context_is_rejected_not_truncated(self):
        class Tokenizer:
            def __call__(self, query, **kwargs):
                self.kwargs = kwargs
                return {"input_ids": list(range(len(query)))}
        tokenizer = Tokenizer()
        self.assertEqual(visual_choice.validate_token_length(tokenizer, "目标"), 2)
        self.assertFalse(tokenizer.kwargs["truncation"])
        with self.assertRaises(ValueError):
            visual_choice.validate_token_length(tokenizer, "a" * 65)

    def test_modified_model_files_are_rejected_before_loading(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "config.json").write_text("{}")
            with self.assertRaisesRegex(ValueError, "pinned official revision"):
                visual_choice.validate_model(root)

    def test_unhashed_optional_processor_config_is_rejected_before_loading(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "processor_config.json").write_text('{"processor_class": "DifferentProcessor"}')
            with self.assertRaisesRegex(ValueError, "unverified extra files"):
                visual_choice.validate_model(root)

    def test_highest_logit_is_selected_without_a_claim_of_calibration(self):
        result = visual_choice.rank_scores(["first", "second"], [-3.0, 1.0])
        self.assertEqual(result["selectedId"], "second")
        self.assertEqual(result["status"], "proposed")
        self.assertFalse(result["gate"]["calibrated"])
        self.assertAlmostEqual(result["ranking"][0]["matchingScore"], 1 / (1 + math.exp(-1)))

    def test_no_match_evaluation_cannot_change_the_proposal(self):
        result = visual_choice.rank_scores(["a", "b"], [1, 0], expected_id="none")
        self.assertEqual(result["selectedId"], "a")
        self.assertFalse(result["evaluation"]["matchesExpectation"])
        self.assertFalse(result["evaluation"]["expectationWasModelInput"])

    def test_absence_is_rejected_only_by_an_explicit_gate(self):
        result = visual_choice.rank_scores(["a", "b"], [-8, -9], 0.1, 0.01, "none")
        self.assertIsNone(result["selectedId"])
        self.assertEqual(result["status"], "abstained_by_policy")
        self.assertTrue(result["evaluation"]["matchesExpectation"])

    def test_close_candidates_and_single_candidate_do_not_pass_margin_gate(self):
        for ids, values in [(["a", "b"], [1, 1]), (["a"], [1000])]:
            with self.subTest(ids=ids):
                result = visual_choice.rank_scores(ids, values, 0, 0.01)
                self.assertIsNone(result["selectedId"])
                self.assertIn("insufficient_margin", result["reasons"])

    def test_invalid_numbers_and_partial_thresholds_are_rejected(self):
        for logits, minimum, margin in [([float("nan")], None, None),
                                       ([float("inf")], None, None),
                                       ([1], 0.2, None), ([1], -1, 0.1),
                                       ([1], 0.1, float("nan"))]:
            with self.subTest(logits=logits, minimum=minimum, margin=margin):
                with self.assertRaises(ValueError):
                    visual_choice.rank_scores(["a"], logits, minimum, margin)

    def test_extreme_logits_do_not_overflow(self):
        result = visual_choice.rank_scores(["a", "b"], [10000, -10000])
        self.assertEqual([row["matchingScore"] for row in result["ranking"]], [1.0, 0.0])

    def test_candidate_paths_cannot_escape_the_explicit_image_root(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            root = base / "images"
            root.mkdir()
            outside = base / "outside.png"
            outside.write_bytes(b"content")
            (root / "escape.png").symlink_to(outside)
            for item in ("a=../outside.png", "a=" + str(outside), "a=escape.png"):
                with self.subTest(item=item), self.assertRaises(ValueError):
                    visual_choice.parse_candidates([item], root)

    def test_duplicate_and_reserved_ids_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "one.png").write_bytes(b"content")
            for candidates in (["a=one.png", "a=one.png"], ["none=one.png"], ["a\n=one.png"]):
                with self.subTest(candidates=candidates), self.assertRaises(ValueError):
                    visual_choice.parse_candidates(candidates, root)

    def test_existing_output_and_symlink_are_not_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            existing = Path(folder) / "result.json"
            existing.write_text("original")
            symlink = Path(folder) / "link.json"
            symlink.symlink_to(existing)
            for path in (existing, symlink):
                with self.subTest(path=path), self.assertRaises(ValueError):
                    visual_choice.output_path(path)
            with self.assertRaises(FileExistsError):
                visual_choice.write_result(existing, {})
            self.assertEqual(existing.read_text(), "original")

    def test_result_json_is_exclusive_and_round_trips(self):
        with tempfile.TemporaryDirectory() as folder:
            destination = visual_choice.output_path(Path(folder) / "new.json")
            visual_choice.write_result(destination, {"query": "红色图标"})
            self.assertEqual(json.loads(destination.read_text()), {"query": "红色图标"})
            with self.assertRaises(FileExistsError):
                visual_choice.write_result(destination, {})

    @unittest.skipUnless(importlib.util.find_spec("PIL"), "Optional visual runtime is not installed")
    def test_image_content_and_decoded_dimensions_are_checked(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            Image.new("RGB", (32, 32), "red").save(root / "valid.png")
            candidates = visual_choice.parse_candidates(["red=valid.png"], root)
            images, metadata = visual_choice.load_images(candidates)
            self.assertEqual(images[0].size, (32, 32))
            self.assertEqual(metadata[0]["id"], "red")
            (root / "wrong.jpg").write_bytes((root / "valid.png").read_bytes())
            with self.assertRaises(ValueError):
                visual_choice.load_images(visual_choice.parse_candidates(["a=wrong.jpg"], root))
            Image.new("RGB", (8193, 1)).save(root / "wide.png")
            with self.assertRaises(ValueError):
                visual_choice.load_images(visual_choice.parse_candidates(["a=wide.png"], root))


if __name__ == "__main__":
    unittest.main()
