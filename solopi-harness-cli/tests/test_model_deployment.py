import hashlib
import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = (
    REPO_ROOT
    / "solopi-harness-cli"
    / "src"
    / "solopi_harness"
    / "model_deployment.py"
)
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("model_deployment", MODULE_PATH)
model_deployment = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = model_deployment
SPEC.loader.exec_module(model_deployment)


class FakeRuntime(model_deployment.ModelRuntime):
    def __init__(self, outputs=None, error=None):
        self.outputs = list(outputs or [1.0])
        self.error = error
        self.calls = []

    def health(self):
        return {"success": True, "runtime": "fake", "backends": ["xnnpack"]}

    def infer(self, model_id, version, inputs):
        self.calls.append((model_id, version, inputs))
        if self.error:
            raise self.error
        return {
            "success": True,
            "modelId": model_id,
            "version": version,
            "backend": "xnnpack",
            "outputs": self.outputs,
            "loadMs": 4.0,
            "inferenceMs": 2.0,
            "memoryMb": 8.0,
        }


class ModelDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(tempfile.mkdtemp(prefix="solopi-model-test-"))

    def tearDown(self):
        shutil.rmtree(self.directory)

    def package(self, version="1.0.0", model_bytes=b"model", **overrides):
        package = self.directory / ("package-" + version)
        package.mkdir()
        model_path = package / "model.pte"
        model_path.write_bytes(model_bytes)
        manifest = {
            "schemaVersion": "solopi.ai.model-manifest/v1",
            "modelId": "counter-policy",
            "version": version,
            "runtime": {
                "name": "executorch",
                "version": "1.4.0",
                "backend": "xnnpack",
            },
            "artifact": {
                "file": "model.pte",
                "sizeBytes": len(model_bytes),
                "sha256": hashlib.sha256(model_bytes).hexdigest(),
            },
            "signature": {
                "algorithm": "SHA256withRSA",
                "keyId": "test-key",
                "file": "manifest.sig",
            },
            "compatibility": {
                "minSdk": 23,
                "maxSdk": 99,
                "abis": ["arm64-v8a"],
                "requiredCapabilities": ["cpu"],
            },
            "contract": {
                "kind": "discrete-policy/v1",
                "stateSelector": {"resourceId": "counter_value"},
                "goal": 1.0,
                "actions": {
                    "1": {
                        "type": "act",
                        "action": {
                            "type": "click",
                            "selector": {"resourceId": "counter_increment"},
                        },
                    },
                    "2": {"type": "done", "reason": "goal_reached"},
                },
            },
            "releaseGates": {
                "maxColdStartMs": 100,
                "maxFirstDecisionMs": 120,
                "maxP50StepMs": 20,
                "maxP95StepMs": 30,
                "maxMemoryMb": 64,
                "maxPowerMah": 1.0,
                "powerRequired": True,
                "minDecisionAccuracy": 0.95,
                "minTaskSuccessRate": 0.90,
            },
        }
        manifest.update(overrides)
        (package / "manifest.json").write_text(
            json.dumps(manifest, sort_keys=True, separators=(",", ":")),
            encoding="utf-8",
        )
        (package / "manifest.sig").write_bytes(b"signed")
        return package

    def profile(self, **overrides):
        values = {"api_level": 35, "abi": "arm64-v8a", "capabilities": {"cpu"}}
        values.update(overrides)
        return model_deployment.DeviceProfile(**values)

    def verify(self, package, profile=None):
        return model_deployment.verify_model_package(
            package,
            {"test-key": self.directory / "unused.pem"},
            profile or self.profile(),
            signature_verifier=lambda manifest, signature, key: True,
        )

    def test_package_verification_rejects_corruption_without_installing(self):
        package = self.package()
        (package / "model.pte").write_bytes(b"bad!!")

        with self.assertRaises(model_deployment.ModelDeploymentError) as caught:
            self.verify(package)

        self.assertEqual("checksum_mismatch", caught.exception.code)

    def test_package_verification_rejects_untrusted_or_invalid_signature(self):
        package = self.package()
        with self.assertRaises(model_deployment.ModelDeploymentError) as untrusted:
            model_deployment.verify_model_package(package, {}, self.profile())
        self.assertEqual("untrusted_key", untrusted.exception.code)

        with self.assertRaises(model_deployment.ModelDeploymentError) as invalid:
            model_deployment.verify_model_package(
                package,
                {"test-key": self.directory / "unused.pem"},
                self.profile(),
                signature_verifier=lambda manifest, signature, key: False,
            )
        self.assertEqual("invalid_signature", invalid.exception.code)

    def test_package_verification_rejects_incompatible_device(self):
        package = self.package()
        with self.assertRaises(model_deployment.ModelDeploymentError) as caught:
            self.verify(package, self.profile(api_level=22))
        self.assertEqual("incompatible_device", caught.exception.code)

    def test_registry_install_activate_and_rollback_are_atomic(self):
        registry = model_deployment.LocalModelRegistry(
            self.directory / "registry",
            {"test-key": self.directory / "unused.pem"},
            self.profile(),
            signature_verifier=lambda manifest, signature, key: True,
        )
        registry.install(self.package("1.0.0"))
        registry.activate("counter-policy", "1.0.0")
        registry.install(self.package("1.1.0", model_bytes=b"model-v2"))
        registry.activate("counter-policy", "1.1.0")

        result = registry.rollback("counter-policy")

        self.assertEqual("1.0.0", result["activeVersion"])
        self.assertEqual("1.1.0", result["previousVersion"])
        self.assertEqual("1.0.0", registry.status("counter-policy")["activeVersion"])
        self.assertFalse(any(self.directory.glob("registry/**/*.tmp-*")))

    def test_failed_install_preserves_last_known_good_active_version(self):
        registry = model_deployment.LocalModelRegistry(
            self.directory / "registry",
            {"test-key": self.directory / "unused.pem"},
            self.profile(),
            signature_verifier=lambda manifest, signature, key: True,
        )
        registry.install(self.package("1.0.0"))
        registry.activate("counter-policy", "1.0.0")
        broken = self.package("1.1.0", model_bytes=b"broken")
        (broken / "model.pte").write_bytes(b"changed-after-signing")

        with self.assertRaises(model_deployment.ModelDeploymentError):
            registry.install(broken)

        self.assertEqual("1.0.0", registry.status("counter-policy")["activeVersion"])

    def test_release_gates_fail_closed_for_slow_and_missing_metrics(self):
        manifest = self.verify(self.package())["manifest"]
        metrics = {
            "coldStartMs": 80,
            "firstDecisionMs": 90,
            "p50StepMs": 10,
            "p95StepMs": 40,
            "memoryMb": 16,
            "powerMah": 0.2,
            "decisionAccuracy": 1.0,
            "taskSuccessRate": 1.0,
        }

        slow = model_deployment.evaluate_release_gates(manifest, metrics)
        missing = dict(metrics)
        del missing["powerMah"]
        absent = model_deployment.evaluate_release_gates(manifest, missing)

        self.assertEqual("blocked", slow["status"])
        self.assertEqual("maxP95StepMs", slow["failedGates"][0]["gate"])
        self.assertEqual("blocked", absent["status"])
        self.assertTrue(any(item["reason"] == "missing_metric" for item in absent["failedGates"]))

    def test_release_gates_accept_all_required_metrics_at_boundaries(self):
        manifest = self.verify(self.package())["manifest"]
        result = model_deployment.evaluate_release_gates(
            manifest,
            {
                "coldStartMs": 100,
                "firstDecisionMs": 120,
                "p50StepMs": 20,
                "p95StepMs": 30,
                "memoryMb": 64,
                "powerMah": 1.0,
                "decisionAccuracy": 0.95,
                "taskSuccessRate": 0.90,
            },
        )
        self.assertEqual("approved", result["status"])

    def test_release_evidence_binds_package_runtime_device_and_shared_corpus(self):
        verified = self.verify(self.package())
        manifest = verified["manifest"]
        digest = verified["packageDigest"]
        benchmark = {
            "schemaVersion": model_deployment.BENCHMARK_SCHEMA,
            "success": True,
            "modelId": "counter-policy",
            "version": "1.0.0",
            "packageDigest": digest,
            "runtime": "executorch",
            "runtimeVersion": "1.4.0",
            "backend": "xnnpack",
            "deviceProfile": {
                "apiLevel": 35,
                "abi": "arm64-v8a",
                "capabilities": ["cpu"],
            },
            "coldStartMs": 80,
            "firstDecisionMs": 90,
            "p50StepMs": 10,
            "p95StepMs": 20,
            "memoryMb": 16,
            "powerMah": 0.2,
        }
        evaluation = {
            "schemaVersion": model_deployment.EVALUATION_SCHEMA,
            "success": True,
            "modelId": "counter-policy",
            "version": "1.0.0",
            "packageDigest": digest,
            "testSetDigest": "a" * 64,
            "providers": ["on-device", "cloud"],
            "decisionAccuracy": 1.0,
            "taskSuccessRate": 1.0,
        }

        evidence = model_deployment.validate_release_evidence(
            manifest, digest, benchmark, evaluation
        )
        self.assertEqual(1.0, evidence["metrics"]["decisionAccuracy"])
        self.assertEqual("a" * 64, evidence["testSetDigest"])

        for report, field, value, error_code in (
            (benchmark, "packageDigest", "b" * 64, "release_evidence_mismatch"),
            (benchmark["deviceProfile"], "apiLevel", 22, "incompatible_device"),
            (evaluation, "providers", ["on-device"], "invalid_release_evidence"),
        ):
            original = report[field]
            report[field] = value
            with self.assertRaises(model_deployment.ModelDeploymentError) as caught:
                model_deployment.validate_release_evidence(
                    manifest, digest, benchmark, evaluation
                )
            self.assertEqual(error_code, caught.exception.code)
            report[field] = original

    def test_on_device_provider_maps_current_observation_to_typed_decision(self):
        runtime = FakeRuntime([1.0])
        provider = model_deployment.OnDeviceDecisionProvider(
            runtime,
            "counter-policy",
            "1.0.0",
            self.verify(self.package())["manifest"]["contract"],
        )
        observation = {
            "observationId": "observation-1",
            "nodes": [
                {"nodeId": "node-value", "resourceId": "counter_value", "text": "0"},
                {"nodeId": "node-add", "resourceId": "counter_increment", "text": "+"},
            ],
        }

        decision = provider.decide({"observation": observation, "stepIndex": 0})

        self.assertEqual("act", decision["type"])
        self.assertEqual("click", decision["action"]["type"])
        self.assertEqual({"resourceId": "counter_increment"}, decision["action"]["selector"])
        self.assertEqual(("counter-policy", "1.0.0", [[0.0], [1.0]]), runtime.calls[0])
        self.assertEqual("executorch", decision["modelReceipt"]["runtime"])

    def test_fallback_only_handles_runtime_infrastructure_failures(self):
        fallback = mock.Mock()
        fallback.decide.return_value = {"type": "done", "reason": "cloud"}
        runtime = FakeRuntime(
            error=model_deployment.ModelRuntimeError(
                "runtime_unavailable", "offline runtime unavailable", fallback_eligible=True
            )
        )
        primary = mock.Mock()
        primary.decide.side_effect = runtime.error
        provider = model_deployment.FallbackDecisionProvider(primary, fallback)

        result = provider.decide({"observation": {}})

        self.assertEqual("cloud", result["reason"])
        self.assertTrue(result["fallback"]["used"])
        fallback.decide.assert_called_once()

        primary.decide.side_effect = model_deployment.ModelDeploymentError(
            "invalid_decision", "product decision is invalid"
        )
        with self.assertRaises(model_deployment.ModelDeploymentError):
            provider.decide({"observation": {}})

    def test_fallback_does_not_mask_malformed_model_output(self):
        contract = self.verify(self.package())["manifest"]["contract"]
        primary = model_deployment.OnDeviceDecisionProvider(
            FakeRuntime(["not-a-number"]), "counter-policy", "1.0.0", contract
        )
        fallback = mock.Mock()
        provider = model_deployment.FallbackDecisionProvider(primary, fallback)
        context = {
            "observation": {
                "nodes": [
                    {"nodeId": "value", "resourceId": "counter_value", "text": "0"}
                ]
            }
        }

        with self.assertRaises(model_deployment.ModelRuntimeError) as caught:
            provider.decide(context)

        self.assertEqual("invalid_runtime_output", caught.exception.code)
        self.assertFalse(caught.exception.fallback_eligible)
        fallback.decide.assert_not_called()

    def test_benchmark_reports_percentiles_and_first_decision(self):
        runtime = FakeRuntime([2.0])
        clock = iter([0.000, 0.010, 0.020, 0.032, 0.040, 0.055])
        with mock.patch.object(model_deployment.time, "perf_counter", side_effect=clock):
            result = model_deployment.benchmark_runtime(
                runtime,
                "counter-policy",
                "1.0.0",
                [[1.0], [1.0]],
                warmup=0,
                iterations=3,
            )
        self.assertEqual(3, result["samples"])
        self.assertEqual(10.0, result["firstDecisionMs"])
        self.assertEqual(12.0, result["p50StepMs"])
        self.assertEqual(15.0, result["p95StepMs"])

    def test_on_device_and_cloud_providers_share_the_same_decision_cases(self):
        contract = self.verify(self.package())["manifest"]["contract"]

        class AddingRuntime(FakeRuntime):
            def infer(self, model_id, version, inputs):
                self.outputs = [inputs[0][0] + inputs[1][0]]
                return super().infer(model_id, version, inputs)

        on_device = model_deployment.OnDeviceDecisionProvider(
            AddingRuntime(), "counter-policy", "1.0.0", contract
        )

        def cloud_callback(context):
            state = int(context["observation"]["nodes"][0]["text"])
            if state == 0:
                return contract["actions"]["1"]
            return contract["actions"]["2"]

        cloud = model_deployment.CloudDecisionProvider(callback=cloud_callback)
        corpus = [
            ({"observation": {"nodes": [{"nodeId": "value", "resourceId": "counter_value", "text": "0"}]}}, "act"),
            ({"observation": {"nodes": [{"nodeId": "value", "resourceId": "counter_value", "text": "1"}]}}, "done"),
        ]

        for context, expected_type in corpus:
            self.assertEqual(expected_type, on_device.decide(context)["type"])
            self.assertEqual(expected_type, cloud.decide(context)["type"])


if __name__ == "__main__":
    unittest.main()
