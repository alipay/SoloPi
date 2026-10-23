import importlib
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "solopi_harness"))
runtime = importlib.import_module("fastpath_runtime")


class LocalMlxRuntimeTests(unittest.TestCase):
    def test_checkpoint_digest_covers_nested_tokenizer_and_encoder(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "model.safetensors").write_bytes(b"fixture-not-a-real-model")
            (root / "encoder").mkdir()
            (root / "tokenizer").mkdir()
            encoder = root / "encoder" / "config.json"
            tokenizer = root / "tokenizer" / "tokenizer.json"
            encoder.write_text('{"type":"fixture"}', encoding="utf-8")
            tokenizer.write_text('{"version":1}', encoding="utf-8")
            fake = types.SimpleNamespace(load=mock.Mock(return_value=mock.Mock()))
            with mock.patch.dict(sys.modules, {"laya_mlx": fake}), mock.patch.object(
                runtime.importlib.metadata, "version", return_value="test-only"
            ):
                first = runtime.LocalMlxPredictor(root)
                tokenizer.write_text('{"version":2}', encoding="utf-8")
                second = runtime.LocalMlxPredictor(root)
                self.assertNotEqual(first.model_digest, second.model_digest)
                encoder.write_text('{"type":"changed"}', encoding="utf-8")
                third = runtime.LocalMlxPredictor(root)
                self.assertNotEqual(second.model_digest, third.model_digest)

    def test_requires_local_safetensors_before_loading_optional_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            fake = types.SimpleNamespace(load=mock.Mock())
            with mock.patch.dict(sys.modules, {"laya_mlx": fake}):
                with self.assertRaises(runtime.ModelDeploymentError) as error:
                    runtime.LocalMlxPredictor(Path(directory))
            self.assertEqual("fastpath_model_missing", error.exception.code)
            fake.load.assert_not_called()

    def test_sdk_output_is_normalized_without_exposing_model_action(self):
        predictor = runtime.LocalMlxPredictor.__new__(runtime.LocalMlxPredictor)
        predictor.agent = mock.Mock()
        predictor.agent.predict.return_value = {
            "model": "fixture", "usage": {"input_tokens": 10, "output_tokens": 0},
            "answers": {"action": {
                "type": "choice", "choice": "candidate_0",
                "probabilities": {"candidate_0": 0.8, "abstain": 0.2},
                "confidence": 0.2, "action": {"act_probability": 0.99},
            }},
        }
        result = predictor({"state": "fixture", "questions": {"action": {}}})
        self.assertEqual(0.8, result["answers"]["action"]["probs"]["candidate_0"])
        self.assertNotIn("action", result["answers"]["action"])
        predictor.agent.predict.assert_called_once_with("fixture", {"action": {}})


if __name__ == "__main__":
    unittest.main()
