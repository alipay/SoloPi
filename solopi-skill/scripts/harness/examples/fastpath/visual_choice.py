#!/usr/bin/env python3
"""Offline SigLIP2 candidate ranking baseline; never operates a device.

Matching scores are uncalibrated similarity scores, not correctness probabilities.
An optional threshold gate is a caller policy, not a learned abstention capability.
"""

import argparse
import hashlib
import importlib.metadata
import io
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import time
import warnings


MODEL_ID = "google/siglip2-base-patch16-224"
MODEL_REVISION = "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2"
MODEL_SHA256 = {
    "config.json": "fe8b5fe6d5734360678fd71c11c21e1ea3364bd8598d34295d9206335973ffd7",
    "model.safetensors": "612923381c76ec5a9bed335d1c48827e3f2e506ac31b044b63b2031fadee6a0b",
    "preprocessor_config.json": "9b36b57ebaf20f09bf4c22100ccc21877ea6bfe5aead0c00c59f8af8ccefacfc",
    "special_tokens_map.json": "baec30ea10906f16adb8c18af7a34023002c1746542612b8b41c9f09e1351351",
    "tokenizer.json": "cb9140fae3ac5122c972d37adf83e1248471a38147ad76f8215c8872c6fd8322",
    "tokenizer.model": "61a7b147390c64585d6c3543dd6fc636906c9af3865a5548f27f31aee1d4c8e2",
    "tokenizer_config.json": "14afe629fe4959b9e0d51e1852b8d9f7ad074f90a1a7125a4fcdd17f06e78fc8",
}
MODEL_FILES = (
    "config.json", "model.safetensors", "preprocessor_config.json",
    "special_tokens_map.json", "tokenizer.json", "tokenizer.model", "tokenizer_config.json",
)
MAX_CANDIDATES = 8
MAX_IMAGE_BYTES = 16 * 1024 * 1024
MAX_IMAGE_PIXELS = 16_000_000
MAX_TOTAL_PIXELS = 48_000_000
MAX_MODEL_BYTES = 2_000_000_000
ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z")


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def bounded_file(root, relative, maximum):
    """Resolve only regular files contained in an explicitly chosen local root."""
    member = Path(relative)
    # Code security: resolve symlinks, reject traversal and external paths before reads.
    if member.is_absolute() or ".." in member.parts:
        raise ValueError("Input must be a relative path inside its root")
    target = (root / member).resolve(strict=True)
    if not target.is_relative_to(root):
        raise ValueError("Input escapes its root")
    info = target.stat()
    if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= maximum:
        raise ValueError("Input must be a nonempty regular file within the size limit")
    return target


def parse_candidates(values, root):
    root = Path(root).resolve(strict=True)
    if not root.is_dir() or not 1 <= len(values) <= MAX_CANDIDATES:
        raise ValueError("Provide an image directory and one to eight candidates")
    result, used = [], set()
    for item in values:
        candidate_id, separator, relative = item.partition("=")
        if not separator or not ID_PATTERN.fullmatch(candidate_id) or candidate_id == "none":
            raise ValueError("Candidate format must be ID=relative-image-path; ID none is reserved")
        if candidate_id in used:
            raise ValueError("Candidate IDs must be unique")
        used.add(candidate_id)
        path = bounded_file(root, relative, MAX_IMAGE_BYTES)
        result.append({"id": candidate_id, "path": path, "relativePath": path.relative_to(root).as_posix()})
    return result


def load_images(candidates):
    from PIL import Image, ImageOps

    images, metadata, total_pixels = [], [], 0
    allowed_formats = {".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP"}
    # Code security: cap both encoded and decoded image sizes before RGB allocation.
    for candidate in candidates:
        path = candidate["path"]
        with path.open("rb") as stream:
            raw = stream.read(MAX_IMAGE_BYTES + 1)
        if len(raw) > MAX_IMAGE_BYTES:
            raise ValueError("Image exceeds the byte limit")
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as image:
                width, height = image.size
                total_pixels += width * height
                if (image.format != allowed_formats.get(path.suffix.lower())
                        or getattr(image, "n_frames", 1) != 1
                        or width <= 0 or height <= 0 or max(width, height) > 8192
                        or width * height > MAX_IMAGE_PIXELS or total_pixels > MAX_TOTAL_PIXELS):
                    raise ValueError("Unsupported image type, animation, or dimensions")
                image.load()
                images.append(ImageOps.exif_transpose(image).convert("RGB"))
        metadata.append({
            "id": candidate["id"], "image": candidate["relativePath"],
            "sha256": hashlib.sha256(raw).hexdigest(), "width": width, "height": height,
        })
    return images, metadata


def validate_model(directory):
    directory = Path(directory).resolve(strict=True)
    if not directory.is_dir():
        raise ValueError("Model must be an explicit local directory")
    # Code security: optional processor/tokenizer configs also affect Auto* loading.
    # Refuse anything outside the hashed files and explicit non-loading metadata.
    metadata_names = {"README.md", "LICENSE", "NOTICE", ".gitattributes", ".cache"}
    if any(path.name not in set(MODEL_FILES) | metadata_names for path in directory.iterdir()):
        raise ValueError("Model directory contains unverified extra files")
    files = {}
    for name in MODEL_FILES:
        maximum = MAX_MODEL_BYTES if name.endswith(".safetensors") else 40 * 1024 * 1024
        path = bounded_file(directory, name, maximum)
        files[name] = {"bytes": path.stat().st_size, "sha256": sha256_file(path)}
        # Code security: verify the full pinned weight/config/tokenizer bytes before loading.
        if files[name]["sha256"] != MODEL_SHA256[name]:
            raise ValueError("Model files do not match the pinned official revision")
    # Code security: this baseline only accepts SigLIP's fixed architecture, with no
    # remote Python, pickle fallback, custom architecture, or user-sized layers.
    config_path = bounded_file(directory, "config.json", 16 * 1024)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    expected_config = {
        "initializer_factor": 1.0, "model_type": "siglip",
        "text_config": {"model_type": "siglip_text_model", "vocab_size": 256000},
        "transformers_version": "4.49.0.dev0",
        "vision_config": {"model_type": "siglip_vision_model"},
    }
    if config != expected_config:
        raise ValueError("Model configuration does not match the pinned official architecture")
    return directory, files


def validate_token_length(tokenizer, query):
    token_count = len(tokenizer(query.lower(), add_special_tokens=True, truncation=False)["input_ids"])
    if not 1 <= token_count <= 64:
        raise ValueError("Query exceeds the model's 64-token limit; shorten it explicitly")
    return token_count


def rank_scores(candidate_ids, logits, min_score=None, min_margin=None, expected_id=None):
    if len(candidate_ids) != len(logits) or not candidate_ids:
        raise ValueError("Candidate and logit counts must match")
    if (min_score is None) != (min_margin is None):
        raise ValueError("Provide both min-score and min-margin, or neither")
    for threshold in (min_score, min_margin):
        if threshold is not None and (not math.isfinite(threshold) or not 0 <= threshold <= 1):
            raise ValueError("Thresholds must be finite numbers in [0, 1]")
    if expected_id is not None and expected_id != "none" and expected_id not in candidate_ids:
        raise ValueError("Expected ID must name a candidate or none")
    rows = []
    for candidate_id, logit in zip(candidate_ids, logits):
        logit = float(logit)
        if not math.isfinite(logit):
            raise ValueError("Model returned a nonfinite logit")
        score = 1 / (1 + math.exp(-logit)) if logit >= 0 else math.exp(logit) / (1 + math.exp(logit))
        rows.append({"id": candidate_id, "logit": logit, "matchingScore": score})
    rows.sort(key=lambda row: row["matchingScore"], reverse=True)
    margin = rows[0]["matchingScore"] - rows[1]["matchingScore"] if len(rows) > 1 else None
    reasons = []
    if min_score is not None:
        if rows[0]["matchingScore"] < min_score:
            reasons.append("below_min_score")
        if margin is None or margin < min_margin:
            reasons.append("insufficient_margin")
    selected = None if reasons else rows[0]["id"]
    result = {
        "ranking": rows, "selectedId": selected, "topMargin": margin,
        "status": "abstained_by_policy" if reasons else "proposed",
        "reasons": reasons,
        "gate": {"minScore": min_score, "minMargin": min_margin, "calibrated": False},
    }
    if expected_id is not None:
        result["evaluation"] = {
            "expectedId": None if expected_id == "none" else expected_id,
            "matchesExpectation": selected == (None if expected_id == "none" else expected_id),
            "expectationWasModelInput": False,
        }
    return result


def output_path(path):
    path = Path(path).absolute()
    parent = path.parent.resolve(strict=True)
    target = parent / path.name
    if target.exists() or target.is_symlink() or not parent.is_dir():
        raise ValueError("Output must be a new file in an existing directory")
    return target


def write_result(path, result):
    # Code security: O_EXCL prevents overwrite, including a raced-in symlink.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")


def evaluate(args):
    started = time.perf_counter()
    destination = output_path(args.output)
    if not 0 < len(args.query.strip()) <= 256 or any(ord(char) < 32 for char in args.query):
        raise ValueError("Query must contain 1 to 256 characters without control characters")
    candidates = parse_candidates(args.candidate, args.images_root)
    ids = [candidate["id"] for candidate in candidates]
    # Validate all decision-policy and evaluation inputs before loading any weights.
    rank_scores(ids, [0] * len(ids), args.min_score, args.min_margin, args.expected_id)
    images, image_metadata = load_images(candidates)
    directory, model_files = validate_model(args.model)
    validation_ms = (time.perf_counter() - started) * 1000

    # Code security: inference is explicitly offline and never loads remote code or pickle.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    import torch
    from transformers import AutoModel, AutoProcessor

    device = "mps" if args.device == "auto" and torch.backends.mps.is_available() else args.device
    if device == "auto":
        device = "cpu"
    load_started = time.perf_counter()
    processor = AutoProcessor.from_pretrained(directory, local_files_only=True, trust_remote_code=False)
    token_count = validate_token_length(processor.tokenizer, args.query)
    model = AutoModel.from_pretrained(
        directory, local_files_only=True, trust_remote_code=False, use_safetensors=True,
        attn_implementation="eager",
    ).eval().to(device)
    if device == "mps":
        torch.mps.synchronize()
    load_ms = (time.perf_counter() - load_started) * 1000
    inference_started = time.perf_counter()
    inputs = processor(
        text=[args.query.lower()], images=images, padding="max_length", max_length=64,
        truncation=False, return_tensors="pt",
    ).to(device)
    with torch.inference_mode():
        logits = model(**inputs).logits_per_image[:, 0].float().cpu().tolist()
    if device == "mps":
        torch.mps.synchronize()
    inference_ms = (time.perf_counter() - inference_started) * 1000
    result = rank_scores(ids, logits, args.min_score, args.min_margin, args.expected_id)
    result.update({
        "schemaVersion": "solopi.visual-choice-baseline/v1", "query": args.query,
        "queryTokens": token_count, "queryTruncated": False,
        "scope": "Offline image-text similarity baseline; no training and no device actions",
        "scoreMeaning": "sigmoid of SigLIP2 logits; uncalibrated matching score, not correctness probability",
        "abstentionMeaning": "Optional caller thresholds; not a learned or calibrated rejection capability",
        "images": image_metadata,
        "model": {"id": MODEL_ID, "verifiedRevision": MODEL_REVISION, "files": model_files,
                  "device": device, "dtype": str(next(model.parameters()).dtype)},
        "versions": {name: importlib.metadata.version(name)
                     for name in ("torch", "transformers", "Pillow", "safetensors", "tokenizers")},
        "timingMs": {"validationAndHashing": validation_ms, "modelLoad": load_ms,
                     "preprocessAndInference": inference_ms,
                     "totalBeforeWrite": (time.perf_counter() - started) * 1000},
    })
    write_result(destination, result)
    return result


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path, help="Pinned local SigLIP2 model directory")
    parser.add_argument("--images-root", required=True, type=Path)
    parser.add_argument("--candidate", required=True, action="append", help="ID=relative-image-path; repeat up to 8 times")
    parser.add_argument("--query", required=True)
    parser.add_argument("--output", required=True, type=Path, help="New JSON file; parent must exist")
    parser.add_argument("--device", choices=("auto", "cpu", "mps"), default="auto")
    parser.add_argument("--min-score", type=float, help="Experimental uncalibrated matching-score gate")
    parser.add_argument("--min-margin", type=float, help="Experimental uncalibrated top-two score gap")
    parser.add_argument("--expected-id", help="Offline evaluation only: a candidate ID or none for no match")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        result = evaluate(args)
    except Exception as error:
        # Code security: emit a bounded structured error type, never image payloads or paths.
        print(json.dumps({"error": "visual_choice_failed", "errorType": type(error).__name__}), file=sys.stderr)
        return 2
    print(json.dumps({"status": result["status"], "selectedId": result["selectedId"],
                      "ranking": result["ranking"], "timingMs": result["timingMs"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
