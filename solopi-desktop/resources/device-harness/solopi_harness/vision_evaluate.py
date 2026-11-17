"""Evaluate frozen GoalPath choices through an explicitly configured vision API.

This is an offline choice experiment: no device actions, completion oracle or
business benefit is inferred. Expected answers stay in the local judge. Run
``python -m solopi_harness.vision_evaluate --help`` for the explicit API entry.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import struct
import sys
from typing import Optional

try:
    from . import vision_benchmark as benchmark
    from .goalpath_vision import GoalPathVisionPredictor, MAX_IMAGE_BYTES, PNG_SIGNATURE, VISUAL_FIELDS, VISUAL_SCHEMA, _png_bytes, _semantic_request
    from .goalpath import MAX_REQUEST_BYTES
except ImportError:
    import vision_benchmark as benchmark
    from goalpath_vision import GoalPathVisionPredictor, MAX_IMAGE_BYTES, PNG_SIGNATURE, VISUAL_FIELDS, VISUAL_SCHEMA, _png_bytes, _semantic_request
    from goalpath import MAX_REQUEST_BYTES


SCHEMA = "solopi.ai.vision-offline-evaluation/v1"
ROW_SCHEMA = "solopi.ai.vision-offline-evaluation-row/v1"
MAX_SAMPLES = 10000
CONDITIONS = (("text-forward", False, False), ("text-reverse", False, True),
              ("vision-forward", True, False), ("vision-reverse", True, True))
PROTOCOL = {"schemaVersion": "solopi.ai.vision-offline-protocol/v1",
    "conditions": [item[0] for item in CONDITIONS], "responseContract": "current-candidate-or-abstain",
    "candidateOrder": "forward-or-full-reverse-renumbered-and-mapped-to-original",
    "judge": "exact-original-choice-equality", "retries": 0,
    "expectedAnswersExposedToModel": False, "deviceActions": False,
    "scope": "offline-choice-only-no-device-or-business-benefit-claim"}


class EvaluationError(ValueError):
    """Fixed error codes with no paths, credentials or raw dataset/API content."""


def _require(condition, code):
    if not condition:
        raise EvaluationError(code)


def _write_json(path, value, *, exclusive=False):
    # Code security: output filenames are fixed by the evaluator, never derived
    # from sample/model text. Existing output directories are never reused.
    with path.open("x" if exclusive else "w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())


def _load_samples(manifest_path):
    path = Path(manifest_path).expanduser().resolve(strict=True)
    accounting = benchmark.validate_dataset(path)
    raw = benchmark._read(path)
    _require(hashlib.sha256(raw).hexdigest() == accounting["manifestSha256"], "manifest_changed")
    manifest = benchmark._decode(raw)
    _require(1 <= len(manifest["samples"]) <= MAX_SAMPLES, "invalid_sample_count")
    groups = {group["groupId"]: group for group in manifest["groups"]}
    loaded = []
    for sample in manifest["samples"]:
        # Code security: benchmark confines every relative reference after
        # resolving symlinks, checks bytes/SHA256 and rejects duplicate JSON keys.
        image = benchmark._artifact(path.parent, sample["screenshot"])
        _require(len(image) <= MAX_IMAGE_BYTES and image.startswith(PNG_SIGNATURE) and len(image) >= 24,
                 "evaluation_requires_png")
        request_raw = benchmark._artifact(path.parent, sample.get("request"))
        _require(len(request_raw) <= MAX_REQUEST_BYTES + 8192, "request_too_large")
        request = benchmark._decode(request_raw)
        expected = benchmark._decode(benchmark._artifact(path.parent, sample["expected"]))
        _require(isinstance(request, dict), "invalid_choice_request")
        _require(isinstance(expected, dict) and set(expected) == {"choice"}
                 and isinstance(expected["choice"], str), "invalid_expected_choice")
        width, height = struct.unpack(">II", image[16:24])
        image_path = (path.parent / sample["screenshot"]["path"]).resolve(strict=True)
        captured = request.get("visual")
        if captured is not None:
            _require(isinstance(captured, dict) and set(captured) == VISUAL_FIELDS,
                     "invalid_frozen_visual_evidence")
            _require(captured["sha256"] == sample["screenshot"]["sha256"]
                     and captured["width"] == width and captured["height"] == height,
                     "frozen_visual_evidence_mismatch")
            visual = {**copy.deepcopy(captured), "imagePath": str(image_path)}
            evidence_origin = "frozen-capture-metadata"
        else:
            # Code security: derive only local offline frame evidence. This
            # digest identifies frozen semantic input; it does not claim a live
            # device-tree/screenshot binding or replace capture validation.
            visual = {"schemaVersion": VISUAL_SCHEMA, "observationId": "offline-" + sample["sampleId"],
                "imagePath": str(image_path), "sha256": sample["screenshot"]["sha256"],
                "width": width, "height": height, "treeFingerprint": hashlib.sha256(request_raw).hexdigest(), "attempts": 1}
            evidence_origin = "frozen-request-derived"
        request["visual"] = visual
        # Full image decode and semantic allowlist validation happen for every
        # sample (including unselected splits) before any model can be called.
        _png_bytes(visual)
        _semantic_request(request)
        _require(expected["choice"] in set(request["candidates"]) | {"abstain"}, "expected_choice_outside_candidates")
        loaded.append({"sampleId": sample["sampleId"], "taskId": sample["taskId"], "groupId": sample["groupId"],
            "split": groups[sample["groupId"]]["split"], "provenance": sample["provenance"], "request": request,
            "expectedChoice": expected["choice"], "requestSha256": sample["request"]["sha256"],
            "screenshotSha256": sample["screenshot"]["sha256"], "expectedSha256": sample["expected"]["sha256"],
            "evidenceOrigin": evidence_origin})
    _require(hashlib.sha256(benchmark._read(path)).hexdigest() == accounting["manifestSha256"], "manifest_changed")
    return accounting, loaded


def _ordered_request(request, reverse):
    result = copy.deepcopy(request)
    original = list(request["candidates"])
    ordered = original[::-1] if reverse else original
    mapping = {"candidate_%d" % index: key for index, key in enumerate(ordered)}
    result["candidates"] = {key: copy.deepcopy(request["candidates"][value]) for key, value in mapping.items()}
    mapping["abstain"] = "abstain"
    return result, mapping


def _summary(rows, selected_counts):
    result = {"schemaVersion": SCHEMA, "scope": PROTOCOL["scope"], "sampleCounts": selected_counts,
        "rows": len(rows), "conditions": {}, "expectedAnswersExposedToModel": False,
        "realDeviceBenefitEvaluated": False}
    for condition, _, _ in CONDITIONS:
        part = [row for row in rows if row["condition"] == condition]
        completed = [row for row in part if row["status"] == "completed"]
        counts = {"rows": len(part), "completed": len(completed), "failures": len(part) - len(completed),
                  "correct": sum(row.get("correct") is True for row in completed),
                  "abstentions": sum(row.get("choice") == "abstain" for row in completed),
                  "wrongActionSuggestions": sum(row.get("choice") != "abstain" and row.get("correct") is False for row in completed)}
        counts["accuracyAmongCompleted"] = counts["correct"] / len(completed) if completed else None
        counts["accuracyAcrossAllRows"] = counts["correct"] / len(part) if part else None
        result["conditions"][condition] = counts
    return result


def evaluate(manifest_path, endpoint, model, output_dir, *, api_key_env="OPENAI_API_KEY",
             allowed_hosts=("api.openai.com",), split="dev", limit: Optional[int] = None,
             max_output_tokens: int = 128):
    """Run four fixed conditions on each frozen sample; preserve failed rows.

    All artifacts and all judge choices are validated before API dispatch.
    A limit is accepted only for dev. The caller explicitly selects a new output
    directory. A failed completion is recorded once and is never retried.
    """
    _require(split in {"dev", "holdout"}, "invalid_split")
    _require(limit is None or split == "dev" and isinstance(limit, int) and not isinstance(limit, bool)
             and 1 <= limit <= MAX_SAMPLES, "limit_requires_dev")
    # Code security: bound caller-controlled generation cost before reading data
    # or dispatching any request; bool is not an integer budget.
    _require(isinstance(max_output_tokens, int) and not isinstance(max_output_tokens, bool)
             and 1 <= max_output_tokens <= 4096, "invalid_max_output_tokens")
    try:
        accounting, all_samples = _load_samples(manifest_path)
        selected = [sample for sample in all_samples if sample["split"] == split]
        _require(bool(selected), "empty_split")
        if limit is not None:
            selected = selected[:limit]
        text_predictor = GoalPathVisionPredictor(endpoint, model, api_key_env=api_key_env,
                                                allowed_hosts=allowed_hosts, include_image=False,
                                                max_output_tokens=max_output_tokens)
        vision_predictor = GoalPathVisionPredictor(endpoint, model, api_key_env=api_key_env,
                                                  allowed_hosts=allowed_hosts, include_image=True,
                                                  max_output_tokens=max_output_tokens)
        output = Path(output_dir).expanduser().resolve()
        output.mkdir(parents=True, exist_ok=False)
    except EvaluationError:
        raise
    except Exception:
        raise EvaluationError("evaluation_preflight_failed") from None
    config = {"model": model, "endpointSha256": hashlib.sha256(text_predictor.endpoint.encode()).hexdigest(),
              "allowedHosts": list(allowed_hosts), "apiKeyEnv": api_key_env, "split": split, "limit": limit,
              "temperature": 0, "maxTokens": max_output_tokens, "imageTransform": "identity", "retryPolicy": "none"}
    counts = {name: sum(sample["split"] == name for sample in selected) for name in ("dev", "holdout")}
    metadata = {"schemaVersion": SCHEMA, "datasetId": accounting["datasetId"], "manifestSha256": accounting["manifestSha256"],
        "protocolSha256": benchmark._digest(PROTOCOL), "configIdentity": benchmark._digest(config), "configuration": config,
        "datasetCounts": accounting["counts"], "selectedCounts": counts, "expectedRows": len(selected) * len(CONDITIONS),
        "automaticTestFixtures": accounting["automaticTestFixtures"], "expectedAnswersExposedToModel": False,
        "realDeviceBenefitEvaluated": False, "runStatus": "running"}
    _write_json(output / "protocol.json", PROTOCOL, exclusive=True)
    _write_json(output / "metadata.json", metadata, exclusive=True)
    rows = []
    try:
        with (output / "rows.jsonl").open("x", encoding="utf-8") as stream:
            for sample in selected:
                for condition, include_image, reverse in CONDITIONS:
                    request, mapping = _ordered_request(sample["request"], reverse)
                    predictor = vision_predictor if include_image else text_predictor
                    row = {"schemaVersion": ROW_SCHEMA, "sampleId": sample["sampleId"], "taskId": sample["taskId"],
                        "groupId": sample["groupId"], "split": sample["split"], "condition": condition,
                        "provenance": sample["provenance"], "evidenceOrigin": sample["evidenceOrigin"],
                        "model": model, "manifestSha256": accounting["manifestSha256"],
                        "requestSha256": sample["requestSha256"], "screenshotSha256": sample["screenshotSha256"],
                        "expectedSha256": sample["expectedSha256"], "expectedChoice": sample["expectedChoice"],
                        "status": "failed", "failureCategory": "transport_unavailable_or_invalid_response"}
                    try:
                        answer = predictor(request)
                        _require(isinstance(answer, dict) and set(answer) == {"choice"}
                                 and isinstance(answer["choice"], str) and answer["choice"] in mapping,
                                 "invalid_predictor_answer")
                        row.update(status="completed", choice=mapping[answer["choice"]],
                                   correct=mapping[answer["choice"]] == sample["expectedChoice"])
                        del row["failureCategory"]
                    except Exception:
                        # Code security: API errors, raw responses and credentials
                        # never enter persisted rows. Failed calls do not retry.
                        pass
                    row["inference"] = copy.deepcopy(predictor.last_metadata)
                    stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False, sort_keys=True) + "\n")
                    stream.flush()
                    os.fsync(stream.fileno())
                    rows.append(row)
        metadata["runStatus"] = "completed"
    finally:
        if metadata["runStatus"] != "completed":
            metadata["runStatus"] = "interrupted"
        summary = _summary(rows, counts)
        summary.update(manifestSha256=accounting["manifestSha256"], protocolSha256=metadata["protocolSha256"],
                       configIdentity=metadata["configIdentity"], runStatus=metadata["runStatus"])
        _write_json(output / "summary.json", summary)
        _write_json(output / "metadata.json", metadata)
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description="Run a frozen offline choice evaluation; no device actions.")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--api-key-env", default="OPENAI_API_KEY")
    parser.add_argument("--allowed-host", action="append")
    parser.add_argument("--output", required=True)
    parser.add_argument("--split", choices=("dev", "holdout"), default="dev")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--max-output-tokens", type=int, default=128,
                        help="Output token budget shared by all four conditions (1-4096; default: 128).")
    args = parser.parse_args(argv)
    try:
        result = evaluate(args.manifest, args.endpoint, args.model, args.output,
            api_key_env=args.api_key_env, allowed_hosts=tuple(args.allowed_host or ["api.openai.com"]),
            split=args.split, limit=args.limit, max_output_tokens=args.max_output_tokens)
    except KeyboardInterrupt:
        print('{"error":"vision_evaluation_interrupted"}', file=sys.stderr)
        return 130
    except Exception:
        print('{"error":"vision_evaluation_failed"}', file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
