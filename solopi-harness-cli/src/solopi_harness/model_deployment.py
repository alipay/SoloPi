#!/usr/bin/env python3
"""SoloPi AI 的签名模型生命周期与决策提供方契约。"""

from __future__ import annotations

import abc
import copy
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Mapping, Optional, Sequence, Set


MANIFEST_SCHEMA = "solopi.ai.model-manifest/v1"
BENCHMARK_SCHEMA = "solopi.ai.model-benchmark/v1"
EVALUATION_SCHEMA = "solopi.ai.model-evaluation/v1"
SUPPORTED_RUNTIME = "executorch"
SUPPORTED_RUNTIME_VERSION = "1.4.0"
SUPPORTED_BACKEND = "xnnpack"
SIGNATURE_ALGORITHM = "SHA256withRSA"
MODEL_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
VERSION_PATTERN = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?")
FILE_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,159}")
SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_SIGNATURE_BYTES = 64 * 1024
MAX_MODEL_BYTES = 8 * 1024 * 1024 * 1024


class ModelDeploymentError(Exception):
    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.details = details

    def as_dict(self) -> Dict[str, Any]:
        return {"success": False, "errorCode": self.code, "error": str(self), **self.details}


class ModelRuntimeError(ModelDeploymentError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        fallback_eligible: bool,
        **details: Any,
    ) -> None:
        super().__init__(code, message, **details)
        self.fallback_eligible = fallback_eligible


@dataclass(frozen=True)
class DeviceProfile:
    api_level: int
    abi: str
    capabilities: Set[str]

    def __post_init__(self) -> None:
        if isinstance(self.api_level, bool) or self.api_level <= 0:
            raise ModelDeploymentError("invalid_device", "设备 API 级别必须大于零")
        if not isinstance(self.abi, str) or not self.abi:
            raise ModelDeploymentError("invalid_device", "设备 ABI 不能为空")
        object.__setattr__(self, "capabilities", frozenset(self.capabilities))


class ModelRuntime(abc.ABC):
    """模型生命周期边界；实现类不得执行 SoloPi 动作。"""

    @abc.abstractmethod
    def health(self) -> Dict[str, Any]:
        raise NotImplementedError

    def install(self, package: Path) -> Dict[str, Any]:
        raise ModelRuntimeError(
            "unsupported_operation", "运行时不支持安装", fallback_eligible=False
        )

    def status(self, model_id: Optional[str] = None) -> Dict[str, Any]:
        raise ModelRuntimeError(
            "unsupported_operation", "运行时未开放模型状态", fallback_eligible=False
        )

    def activate(self, model_id: str, version: str) -> Dict[str, Any]:
        raise ModelRuntimeError(
            "unsupported_operation", "运行时不支持激活", fallback_eligible=False
        )

    def rollback(self, model_id: str) -> Dict[str, Any]:
        raise ModelRuntimeError(
            "unsupported_operation", "运行时不支持回滚", fallback_eligible=False
        )

    @abc.abstractmethod
    def infer(
        self, model_id: str, version: Optional[str], inputs: Sequence[Sequence[float]]
    ) -> Dict[str, Any]:
        raise NotImplementedError


class DecisionProvider(abc.ABC):
    @abc.abstractmethod
    def decide(self, context: Mapping[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError


def _mapping(value: Any, label: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ModelDeploymentError("invalid_manifest", "%s 必须是对象" % label)
    return value


def _text(value: Any, label: str, pattern: Optional[re.Pattern[str]] = None) -> str:
    if not isinstance(value, str) or not value:
        raise ModelDeploymentError("invalid_manifest", "%s 不能为空" % label)
    if pattern is not None and pattern.fullmatch(value) is None:
        raise ModelDeploymentError("invalid_manifest", "%s 格式无效" % label)
    return value


def _integer(value: Any, label: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ModelDeploymentError(
            "invalid_manifest", "%s 必须在 %d 到 %d 之间" % (label, minimum, maximum)
        )
    return value


def _number(value: Any, label: str, minimum: float = 0.0) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ModelDeploymentError("invalid_manifest", "%s 必须是数字" % label)
    result = float(value)
    if not math.isfinite(result) or result < minimum:
        raise ModelDeploymentError("invalid_manifest", "%s 超出有效范围" % label)
    return result


def _safe_child(root: Path, raw_name: Any, label: str) -> Path:
    name = _text(raw_name, label, FILE_PATTERN)
    candidate = root / name
    if candidate.parent.resolve() != root.resolve() or candidate.is_symlink():
        raise ModelDeploymentError("unsafe_package", "%s 位于模型包之外" % label)
    return candidate


def _read_bounded(path: Path, maximum: int, label: str) -> bytes:
    try:
        stat = path.stat()
    except OSError as exc:
        raise ModelDeploymentError("missing_file", "缺少%s" % label, file=str(path)) from exc
    if not path.is_file() or stat.st_size <= 0 or stat.st_size > maximum:
        raise ModelDeploymentError(
            "invalid_file", "%s 大小无效" % label, file=str(path), size=stat.st_size
        )
    return path.read_bytes()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def verify_rsa_signature(manifest: Path, signature: Path, public_key: Path) -> bool:
    """使用系统 OpenSSL 校验分离式 SHA-256/RSA 签名。"""

    try:
        result = subprocess.run(
            [
                "openssl",
                "dgst",
                "-sha256",
                "-verify",
                str(public_key),
                "-signature",
                str(signature),
                str(manifest),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ModelDeploymentError(
            "signature_verifier_unavailable", "无法运行可信签名校验器"
        ) from exc
    return result.returncode == 0 and "Verified OK" in result.stdout


def _validate_manifest(manifest: Dict[str, Any]) -> Dict[str, Any]:
    allowed = {
        "schemaVersion",
        "modelId",
        "version",
        "runtime",
        "artifact",
        "signature",
        "compatibility",
        "contract",
        "releaseGates",
        "metadata",
    }
    unknown = sorted(set(manifest) - allowed)
    if unknown:
        raise ModelDeploymentError("invalid_manifest", "模型清单包含未知字段", fields=unknown)
    if manifest.get("schemaVersion") != MANIFEST_SCHEMA:
        raise ModelDeploymentError("invalid_manifest", "不支持该模型清单结构")
    _text(manifest.get("modelId"), "modelId", MODEL_ID_PATTERN)
    _text(manifest.get("version"), "version", VERSION_PATTERN)

    runtime = _mapping(manifest.get("runtime"), "runtime")
    if runtime.get("name") != SUPPORTED_RUNTIME:
        raise ModelDeploymentError("unsupported_runtime", "当前只支持生产化的 ExecuTorch")
    if runtime.get("version") != SUPPORTED_RUNTIME_VERSION:
        raise ModelDeploymentError("unsupported_runtime", "ExecuTorch 版本未固定")
    if runtime.get("backend") != SUPPORTED_BACKEND:
        raise ModelDeploymentError("unsupported_backend", "当前只批准 XNNPACK 基线后端")

    artifact = _mapping(manifest.get("artifact"), "artifact")
    _text(artifact.get("file"), "artifact.file", FILE_PATTERN)
    _integer(artifact.get("sizeBytes"), "artifact.sizeBytes", 1, MAX_MODEL_BYTES)
    _text(artifact.get("sha256"), "artifact.sha256", SHA256_PATTERN)

    signature = _mapping(manifest.get("signature"), "signature")
    if signature.get("algorithm") != SIGNATURE_ALGORITHM:
        raise ModelDeploymentError("invalid_manifest", "不支持该签名算法")
    _text(signature.get("keyId"), "signature.keyId", MODEL_ID_PATTERN)
    _text(signature.get("file"), "signature.file", FILE_PATTERN)

    compatibility = _mapping(manifest.get("compatibility"), "compatibility")
    min_sdk = _integer(compatibility.get("minSdk"), "compatibility.minSdk", 1, 1000)
    max_sdk = _integer(compatibility.get("maxSdk"), "compatibility.maxSdk", min_sdk, 1000)
    abis = compatibility.get("abis")
    capabilities = compatibility.get("requiredCapabilities")
    if not isinstance(abis, list) or not abis or not all(isinstance(item, str) and item for item in abis):
        raise ModelDeploymentError("invalid_manifest", "compatibility.abis 不能为空")
    if not isinstance(capabilities, list) or not all(
        isinstance(item, str) and item for item in capabilities
    ):
        raise ModelDeploymentError(
            "invalid_manifest", "compatibility.requiredCapabilities 必须是列表"
        )

    contract = _mapping(manifest.get("contract"), "contract")
    if contract.get("kind") != "discrete-policy/v1":
        raise ModelDeploymentError("invalid_manifest", "不支持该决策契约")
    _mapping(contract.get("stateSelector"), "contract.stateSelector")
    _number(contract.get("goal"), "contract.goal")
    actions = _mapping(contract.get("actions"), "contract.actions")
    if not actions:
        raise ModelDeploymentError("invalid_manifest", "contract.actions 不能为空")

    gates = _mapping(manifest.get("releaseGates"), "releaseGates")
    for key in (
        "maxColdStartMs",
        "maxFirstDecisionMs",
        "maxP50StepMs",
        "maxP95StepMs",
        "maxMemoryMb",
        "maxPowerMah",
        "minDecisionAccuracy",
        "minTaskSuccessRate",
    ):
        _number(gates.get(key), "releaseGates.%s" % key)
    if not isinstance(gates.get("powerRequired"), bool):
        raise ModelDeploymentError("invalid_manifest", "releaseGates.powerRequired 必须是布尔值")
    for key in ("minDecisionAccuracy", "minTaskSuccessRate"):
        if float(gates[key]) > 1.0:
            raise ModelDeploymentError("invalid_manifest", "%s 不能大于 1" % key)
    return manifest


def _check_compatibility(manifest: Mapping[str, Any], device: DeviceProfile) -> None:
    compatibility = manifest["compatibility"]
    missing = sorted(set(compatibility["requiredCapabilities"]) - set(device.capabilities))
    compatible = (
        compatibility["minSdk"] <= device.api_level <= compatibility["maxSdk"]
        and device.abi in compatibility["abis"]
        and not missing
    )
    if not compatible:
        raise ModelDeploymentError(
            "incompatible_device",
            "模型与目标设备不兼容",
            apiLevel=device.api_level,
            abi=device.abi,
            missingCapabilities=missing,
        )


def verify_model_package(
    package: Path,
    trusted_keys: Mapping[str, Path],
    device: Optional[DeviceProfile] = None,
    signature_verifier: Callable[[Path, Path, Path], bool] = verify_rsa_signature,
) -> Dict[str, Any]:
    package = Path(package)
    if not package.is_dir() or package.is_symlink():
        raise ModelDeploymentError("invalid_package", "模型包必须是目录")
    manifest_path = package / "manifest.json"
    manifest_bytes = _read_bounded(manifest_path, MAX_MANIFEST_BYTES, "manifest")
    try:
        manifest = json.loads(manifest_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ModelDeploymentError("invalid_manifest", "模型清单不是有效的 UTF-8 JSON") from exc
    manifest = _validate_manifest(_mapping(manifest, "manifest"))
    artifact_path = _safe_child(package, manifest["artifact"]["file"], "artifact.file")
    signature_path = _safe_child(package, manifest["signature"]["file"], "signature.file")
    artifact_size = artifact_path.stat().st_size if artifact_path.exists() else -1
    if artifact_size != manifest["artifact"]["sizeBytes"]:
        raise ModelDeploymentError(
            "size_mismatch",
            "模型大小与签名清单不匹配",
            expected=manifest["artifact"]["sizeBytes"],
            actual=artifact_size,
        )
    if _sha256(artifact_path) != manifest["artifact"]["sha256"]:
        raise ModelDeploymentError("checksum_mismatch", "模型校验和与清单不匹配")
    _read_bounded(signature_path, MAX_SIGNATURE_BYTES, "signature")
    key_id = manifest["signature"]["keyId"]
    public_key = trusted_keys.get(key_id)
    if public_key is None:
        raise ModelDeploymentError("untrusted_key", "模型签名密钥不受信任", keyId=key_id)
    if not signature_verifier(manifest_path, signature_path, Path(public_key)):
        raise ModelDeploymentError("invalid_signature", "模型包签名无效")
    if device is not None:
        _check_compatibility(manifest, device)
    package_digest = hashlib.sha256(
        manifest_bytes + signature_path.read_bytes() + bytes.fromhex(manifest["artifact"]["sha256"])
    ).hexdigest()
    result = {
        "success": True,
        "manifest": copy.deepcopy(manifest),
        "manifestPath": str(manifest_path.resolve()),
        "artifactPath": str(artifact_path.resolve()),
        "signaturePath": str(signature_path.resolve()),
        "packageDigest": package_digest,
    }
    if device is not None:
        result["deviceProfile"] = {
            "apiLevel": device.api_level,
            "abi": device.abi,
            "capabilities": sorted(device.capabilities),
        }
    return result


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


class LocalModelRegistry:
    """供打包测试和非 Android 概念验证使用的崩溃安全单机注册表。"""

    def __init__(
        self,
        root: Path,
        trusted_keys: Mapping[str, Path],
        device: DeviceProfile,
        signature_verifier: Callable[[Path, Path, Path], bool] = verify_rsa_signature,
    ) -> None:
        self.root = Path(root)
        self.trusted_keys = trusted_keys
        self.device = device
        self.signature_verifier = signature_verifier
        self.models = self.root / "models"
        self.registry_path = self.root / "registry.json"
        self.models.mkdir(parents=True, exist_ok=True)

    def _registry(self) -> Dict[str, Any]:
        if not self.registry_path.exists():
            return {"schemaVersion": 1, "models": {}}
        try:
            value = json.loads(self.registry_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ModelDeploymentError("registry_corrupt", "模型注册表已损坏") from exc
        if not isinstance(value, dict) or not isinstance(value.get("models"), dict):
            raise ModelDeploymentError("registry_corrupt", "模型注册表结构无效")
        return value

    def _write_registry(self, registry: Mapping[str, Any]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        temporary = self.root / ("registry.json.tmp-%s" % uuid.uuid4().hex)
        data = json.dumps(registry, sort_keys=True, separators=(",", ":")).encode("utf-8")
        try:
            with temporary.open("xb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.registry_path)
            _fsync_directory(self.root)
        finally:
            if temporary.exists():
                temporary.unlink()

    def install(self, package: Path) -> Dict[str, Any]:
        verified = verify_model_package(
            package, self.trusted_keys, self.device, self.signature_verifier
        )
        manifest = verified["manifest"]
        model_root = self.models / manifest["modelId"]
        destination = model_root / manifest["version"]
        model_root.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            existing = verify_model_package(
                destination, self.trusted_keys, self.device, self.signature_verifier
            )
            if existing["packageDigest"] != verified["packageDigest"]:
                raise ModelDeploymentError(
                    "version_conflict", "已安装版本包含不同的签名内容"
                )
            return {**existing, "installed": False, "idempotent": True}
        staging = model_root / (".install.tmp-%s" % uuid.uuid4().hex)
        try:
            shutil.copytree(Path(package), staging, symlinks=False)
            verify_model_package(
                staging, self.trusted_keys, self.device, self.signature_verifier
            )
            os.replace(staging, destination)
            _fsync_directory(model_root)
        finally:
            if staging.exists():
                shutil.rmtree(staging)
        registry = self._registry()
        record = registry["models"].setdefault(
            manifest["modelId"], {"activeVersion": None, "previousVersion": None, "versions": {}}
        )
        record["versions"][manifest["version"]] = {
            "packageDigest": verified["packageDigest"],
            "installedAtMs": int(time.time() * 1000),
        }
        self._write_registry(registry)
        return {
            **verified,
            "installed": True,
            "idempotent": False,
            "installPath": str(destination.resolve()),
        }

    def activate(self, model_id: str, version: str) -> Dict[str, Any]:
        _text(model_id, "modelId", MODEL_ID_PATTERN)
        _text(version, "version", VERSION_PATTERN)
        registry = self._registry()
        record = registry["models"].get(model_id)
        if not isinstance(record, dict) or version not in record.get("versions", {}):
            raise ModelDeploymentError("model_not_installed", "未安装指定的模型版本")
        verify_model_package(
            self.models / model_id / version,
            self.trusted_keys,
            self.device,
            self.signature_verifier,
        )
        old = record.get("activeVersion")
        if old != version:
            record["previousVersion"] = old
            record["activeVersion"] = version
            self._write_registry(registry)
        return {
            "success": True,
            "modelId": model_id,
            "activeVersion": version,
            "previousVersion": record.get("previousVersion"),
            "changed": old != version,
        }

    def rollback(self, model_id: str) -> Dict[str, Any]:
        _text(model_id, "modelId", MODEL_ID_PATTERN)
        registry = self._registry()
        record = registry["models"].get(model_id)
        previous = record.get("previousVersion") if isinstance(record, dict) else None
        if not isinstance(previous, str) or previous not in record.get("versions", {}):
            raise ModelDeploymentError("rollback_unavailable", "不存在有效的上一版本")
        current = record.get("activeVersion")
        verify_model_package(
            self.models / model_id / previous,
            self.trusted_keys,
            self.device,
            self.signature_verifier,
        )
        record["activeVersion"] = previous
        record["previousVersion"] = current
        self._write_registry(registry)
        return {
            "success": True,
            "modelId": model_id,
            "activeVersion": previous,
            "previousVersion": current,
        }

    def status(self, model_id: Optional[str] = None) -> Dict[str, Any]:
        registry = self._registry()
        if model_id is None:
            return {"success": True, **copy.deepcopy(registry)}
        _text(model_id, "modelId", MODEL_ID_PATTERN)
        record = registry["models"].get(model_id)
        if not isinstance(record, dict):
            raise ModelDeploymentError("model_not_found", "模型未安装")
        return {"success": True, "modelId": model_id, **copy.deepcopy(record)}


def _observation_nodes(value: Any) -> Iterable[Mapping[str, Any]]:
    if isinstance(value, dict):
        if isinstance(value.get("nodeId"), str):
            yield value
        for key in ("nodes", "children", "roots", "windows", "hierarchy", "tree", "page"):
            if key in value:
                yield from _observation_nodes(value[key])
    elif isinstance(value, list):
        for item in value:
            yield from _observation_nodes(item)


def _matches_selector(node: Mapping[str, Any], selector: Mapping[str, Any]) -> bool:
    return bool(selector) and all(node.get(key) == expected for key, expected in selector.items())


class OnDeviceDecisionProvider(DecisionProvider):
    def __init__(
        self,
        runtime: ModelRuntime,
        model_id: str,
        version: Optional[str],
        contract: Mapping[str, Any],
    ) -> None:
        self.runtime = runtime
        self.model_id = _text(model_id, "modelId", MODEL_ID_PATTERN)
        self.version = version
        self.contract = copy.deepcopy(_mapping(dict(contract), "contract"))
        if self.contract.get("kind") != "discrete-policy/v1":
            raise ModelDeploymentError("invalid_contract", "不支持该端侧策略契约")

    def decide(self, context: Mapping[str, Any]) -> Dict[str, Any]:
        observation = context.get("observation")
        selector = _mapping(self.contract.get("stateSelector"), "contract.stateSelector")
        matches = [node for node in _observation_nodes(observation) if _matches_selector(node, selector)]
        if len(matches) != 1:
            raise ModelDeploymentError(
                "feature_not_found",
                "状态选择器必须准确匹配一个已观察节点",
                matchCount=len(matches),
            )
        raw_state = matches[0].get("text")
        try:
            state = float(raw_state)
        except (TypeError, ValueError) as exc:
            raise ModelDeploymentError("invalid_feature", "观察状态不是数字") from exc
        goal = _number(self.contract.get("goal"), "contract.goal")
        receipt = self.runtime.infer(self.model_id, self.version, [[state], [goal]])
        outputs = receipt.get("outputs")
        if not isinstance(outputs, list) or not outputs:
            raise ModelRuntimeError(
                "invalid_runtime_output", "运行时缺少策略输出", fallback_eligible=False
            )
        try:
            raw_code = float(outputs[0])
        except (TypeError, ValueError) as exc:
            raise ModelRuntimeError(
                "invalid_runtime_output", "运行时策略输出不是数字", fallback_eligible=False
            ) from exc
        code = str(int(round(raw_code)))
        template = self.contract.get("actions", {}).get(code)
        if not isinstance(template, dict):
            raise ModelDeploymentError(
                "invalid_decision", "策略输出没有对应的类型化动作", output=raw_code
            )
        decision = copy.deepcopy(template)
        decision["modelReceipt"] = {
            "provider": "on-device",
            "runtime": receipt.get("runtime", SUPPORTED_RUNTIME),
            "modelId": receipt.get("modelId", self.model_id),
            "version": receipt.get("version", self.version),
            "backend": receipt.get("backend"),
            "loadMs": receipt.get("loadMs"),
            "inferenceMs": receipt.get("inferenceMs"),
            "memoryMb": receipt.get("memoryMb"),
            "outputCode": raw_code,
            "fallbackUsed": False,
        }
        return decision


class CloudDecisionProvider(DecisionProvider):
    """轻量类型化 HTTP/回调适配器，不直接拥有设备操作权限。"""

    def __init__(
        self,
        endpoint: Optional[str] = None,
        callback: Optional[Callable[[Mapping[str, Any]], Dict[str, Any]]] = None,
        timeout: float = 30.0,
    ) -> None:
        if not endpoint and callback is None:
            raise ModelDeploymentError("invalid_provider", "云端提供方需要端点或回调")
        self.endpoint = endpoint
        self.callback = callback
        self.timeout = timeout

    def decide(self, context: Mapping[str, Any]) -> Dict[str, Any]:
        if self.callback is not None:
            result = self.callback(context)
        else:
            request = urllib.request.Request(
                str(self.endpoint),
                data=json.dumps(context, separators=(",", ":")).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    result = json.loads(response.read(MAX_MANIFEST_BYTES).decode("utf-8"))
            except Exception as exc:
                raise ModelRuntimeError(
                    "cloud_unavailable", "云端决策提供方不可用", fallback_eligible=True
                ) from exc
        if not isinstance(result, dict):
            raise ModelDeploymentError("invalid_decision", "云端决策必须是对象")
        return copy.deepcopy(result)


class FallbackDecisionProvider(DecisionProvider):
    def __init__(self, primary: DecisionProvider, fallback: DecisionProvider) -> None:
        self.primary = primary
        self.fallback = fallback

    def decide(self, context: Mapping[str, Any]) -> Dict[str, Any]:
        try:
            return self.primary.decide(context)
        except ModelRuntimeError as exc:
            if not exc.fallback_eligible:
                raise
            result = self.fallback.decide(context)
            result["fallback"] = {
                "used": True,
                "reason": exc.code,
                "primaryError": str(exc),
            }
            return result


GATE_METRICS = (
    ("maxColdStartMs", "coldStartMs", "max"),
    ("maxFirstDecisionMs", "firstDecisionMs", "max"),
    ("maxP50StepMs", "p50StepMs", "max"),
    ("maxP95StepMs", "p95StepMs", "max"),
    ("maxMemoryMb", "memoryMb", "max"),
    ("maxPowerMah", "powerMah", "max"),
    ("minDecisionAccuracy", "decisionAccuracy", "min"),
    ("minTaskSuccessRate", "taskSuccessRate", "min"),
)


def validate_release_evidence(
    manifest: Mapping[str, Any],
    package_digest: str,
    benchmark: Mapping[str, Any],
    evaluation: Mapping[str, Any],
) -> Dict[str, Any]:
    """把性能与质量证据绑定到同一签名包和测试语料。"""

    _validate_manifest(copy.deepcopy(_mapping(dict(manifest), "manifest")))
    if SHA256_PATTERN.fullmatch(package_digest) is None:
        raise ModelDeploymentError(
            "invalid_release_evidence", "已校验模型包的摘要格式无效"
        )
    reports = {"benchmark": benchmark, "evaluation": evaluation}
    schemas = {"benchmark": BENCHMARK_SCHEMA, "evaluation": EVALUATION_SCHEMA}
    for label, report in reports.items():
        if not isinstance(report, dict):
            raise ModelDeploymentError(
                "invalid_release_evidence", "%s 报告必须是对象" % label
            )
        if report.get("schemaVersion") != schemas[label] or report.get("success") is not True:
            raise ModelDeploymentError(
                "invalid_release_evidence", "%s 报告不是成功且受支持的报告" % label
            )
        expected_identity = {
            "modelId": manifest["modelId"],
            "version": manifest["version"],
            "packageDigest": package_digest,
        }
        for field, expected in expected_identity.items():
            if report.get(field) != expected:
                raise ModelDeploymentError(
                    "release_evidence_mismatch",
                    "%s 报告与签名包不匹配" % label,
                    report=label,
                    field=field,
                    expected=expected,
                    actual=report.get(field),
                )

    runtime = manifest["runtime"]
    for field, expected in {
        "runtime": runtime["name"],
        "runtimeVersion": runtime["version"],
        "backend": runtime["backend"],
    }.items():
        if benchmark.get(field) != expected:
            raise ModelDeploymentError(
                "release_evidence_mismatch",
                "基准测试运行时与签名包不匹配",
                report="benchmark",
                field=field,
                expected=expected,
                actual=benchmark.get(field),
            )

    raw_profile = benchmark.get("deviceProfile")
    if not isinstance(raw_profile, dict):
        raise ModelDeploymentError(
            "invalid_release_evidence", "基准测试必须包含 deviceProfile"
        )
    capabilities = raw_profile.get("capabilities")
    if not isinstance(capabilities, list) or not all(
        isinstance(item, str) and item for item in capabilities
    ):
        raise ModelDeploymentError(
            "invalid_release_evidence", "基准测试设备能力必须是列表"
        )
    try:
        device = DeviceProfile(
            api_level=raw_profile.get("apiLevel"),
            abi=raw_profile.get("abi"),
            capabilities=set(capabilities),
        )
    except (TypeError, ModelDeploymentError) as exc:
        raise ModelDeploymentError(
            "invalid_release_evidence", "基准测试 deviceProfile 无效"
        ) from exc
    _check_compatibility(manifest, device)

    test_set_digest = evaluation.get("testSetDigest")
    if not isinstance(test_set_digest, str) or SHA256_PATTERN.fullmatch(test_set_digest) is None:
        raise ModelDeploymentError(
            "invalid_release_evidence", "评估必须标识测试集 SHA-256"
        )
    providers = evaluation.get("providers")
    if (
        not isinstance(providers, list)
        or not all(isinstance(item, str) for item in providers)
        or sorted(providers) != ["cloud", "on-device"]
    ):
        raise ModelDeploymentError(
            "invalid_release_evidence",
            "评估必须使用云端和端侧提供方运行同一测试集",
        )

    metrics: Dict[str, Any] = {}
    for _, metric, _ in GATE_METRICS:
        source = evaluation if metric in {"decisionAccuracy", "taskSuccessRate"} else benchmark
        if metric in source:
            metrics[metric] = source[metric]
    return {
        "metrics": metrics,
        "deviceProfile": {
            "apiLevel": device.api_level,
            "abi": device.abi,
            "capabilities": sorted(device.capabilities),
        },
        "testSetDigest": test_set_digest,
        "providers": list(providers),
    }


def evaluate_release_gates(
    manifest: Mapping[str, Any], metrics: Mapping[str, Any]
) -> Dict[str, Any]:
    _validate_manifest(copy.deepcopy(_mapping(dict(manifest), "manifest")))
    gates = manifest["releaseGates"]
    results = []
    failures = []
    for gate, metric, direction in GATE_METRICS:
        required = not (metric == "powerMah" and gates.get("powerRequired") is False)
        raw_value = metrics.get(metric)
        if raw_value is None:
            item = {
                "gate": gate,
                "metric": metric,
                "threshold": gates[gate],
                "passed": not required,
                "reason": "missing_metric" if required else "optional_metric_unavailable",
            }
        else:
            try:
                value = _number(raw_value, metric)
            except ModelDeploymentError:
                value = None
            threshold = float(gates[gate])
            passed = value is not None and (
                value <= threshold if direction == "max" else value >= threshold
            )
            item = {
                "gate": gate,
                "metric": metric,
                "threshold": threshold,
                "actual": value,
                "passed": passed,
                "reason": None if passed else "threshold_failed",
            }
        results.append(item)
        if not item["passed"]:
            failures.append(item)
    return {
        "success": not failures,
        "status": "approved" if not failures else "blocked",
        "modelId": manifest["modelId"],
        "version": manifest["version"],
        "gates": results,
        "failedGates": failures,
    }


def _nearest_rank(values: Sequence[float], percentile: float) -> float:
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(percentile * len(ordered)) - 1))
    return ordered[index]


def benchmark_runtime(
    runtime: ModelRuntime,
    model_id: str,
    version: Optional[str],
    inputs: Sequence[Sequence[float]],
    *,
    warmup: int = 2,
    iterations: int = 20,
) -> Dict[str, Any]:
    if isinstance(warmup, bool) or not 0 <= warmup <= 100:
        raise ModelDeploymentError("invalid_benchmark", "warmup 必须在 0 到 100 之间")
    if isinstance(iterations, bool) or not 1 <= iterations <= 1000:
        raise ModelDeploymentError("invalid_benchmark", "iterations 必须在 1 到 1000 之间")
    for _ in range(warmup):
        runtime.infer(model_id, version, inputs)
    samples = []
    receipts = []
    for _ in range(iterations):
        started = time.perf_counter()
        receipt = runtime.infer(model_id, version, inputs)
        samples.append(round((time.perf_counter() - started) * 1000.0, 6))
        receipts.append(receipt)
    memory_values = [
        float(receipt["memoryMb"])
        for receipt in receipts
        if isinstance(receipt.get("memoryMb"), (int, float))
    ]
    load_values = [
        float(receipt["loadMs"])
        for receipt in receipts
        if isinstance(receipt.get("loadMs"), (int, float))
    ]
    result: Dict[str, Any] = {
        "success": True,
        "modelId": model_id,
        "version": version,
        "samples": iterations,
        "warmup": warmup,
        "coldStartMs": load_values[0] if load_values else samples[0],
        "firstDecisionMs": samples[0],
        "p50StepMs": _nearest_rank(samples, 0.50),
        "p95StepMs": _nearest_rank(samples, 0.95),
        "memoryMb": max(memory_values) if memory_values else None,
        "powerMah": None,
        "latencySamplesMs": samples,
    }
    return result
