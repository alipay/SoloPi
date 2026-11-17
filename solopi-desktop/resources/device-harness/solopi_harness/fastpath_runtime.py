"""Optional local MLX runtime. The core CLI remains usable without ML packages."""

from __future__ import annotations

import hashlib
import importlib.metadata
import time
from pathlib import Path
from typing import Any, Mapping

try:
    from .model_deployment import ModelDeploymentError
    from .fastpath import normalize_laya_response
except ImportError:
    from model_deployment import ModelDeploymentError
    from fastpath import normalize_laya_response


class LocalMlxPredictor:
    """Load an explicitly selected local safetensors checkpoint once per run."""

    def __init__(self, model_path: Path) -> None:
        directory = model_path.expanduser().resolve()
        if not directory.is_dir() or not (directory / "model.safetensors").is_file():
            raise ModelDeploymentError("fastpath_model_missing", "请提供含 model.safetensors 的本地 MLX 模型目录")
        # Code security: only local JSON/tokenizer/safetensors data is consumed;
        # this adapter never downloads weights or imports code from model files.
        checkpoint_files = sorted(p for p in directory.rglob("*")
                                  if p.is_file() and p.suffix in {".json", ".safetensors", ".txt"})
        digest = hashlib.sha256()
        for source in checkpoint_files:
            digest.update(source.relative_to(directory).as_posix().encode("utf-8") + b"\0")
            digest.update(str(source.stat().st_size).encode("ascii") + b"\0")
            with source.open("rb") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
        self.model_digest = digest.hexdigest()
        try:
            import laya_mlx
        except ImportError as exc:
            raise ModelDeploymentError("fastpath_runtime_missing", "当前 Python 环境未安装可选依赖 laya-mlx") from exc
        started = time.perf_counter()
        try:
            self.agent = laya_mlx.load(str(directory))
        except Exception as exc:
            # Code security: avoid copying local paths or arbitrary loader output to evidence.
            raise ModelDeploymentError("fastpath_model_load_failed", "本地 MLX 模型加载失败") from exc
        self.metadata = {
            "backend": "mlx",
            "runtimeVersion": importlib.metadata.version("laya-mlx"),
            "mlxVersion": importlib.metadata.version("mlx"),
            "checkpointDigest": self.model_digest,
            "modelLoadMs": round((time.perf_counter() - started) * 1000, 3),
            "deployment": "host-local",
        }

    def __call__(self, request: Mapping[str, Any]) -> dict:
        result = self.agent.predict(request["state"], request["questions"])
        return normalize_laya_response(result)
