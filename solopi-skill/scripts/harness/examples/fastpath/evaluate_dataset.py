#!/usr/bin/env python3
"""Evaluate a frozen local dataset without connecting to an Android device."""
import argparse
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from solopi_harness.fastpath_evaluation import DatasetError, evaluate_dataset, load_dataset


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--split", choices=("train", "dev", "test"), default="test")
    parser.add_argument("--model", type=Path, help="Existing local MLX checkpoint; omission runs both rules only")
    parser.add_argument("--output", required=True, type=Path, help="New JSON file; never overwritten")
    args = parser.parse_args(argv)
    try:
        # Validate the entire frozen dataset before even loading a local model.
        load_dataset(args.manifest)
        predictor = None
        model_version = "rules-only"
        if args.model is not None:
            from solopi_harness.fastpath_runtime import LocalMlxPredictor
            predictor = LocalMlxPredictor(args.model)
            model_version = predictor.model_digest
        result = evaluate_dataset(args.manifest, predictor=predictor, split=args.split, model_version=model_version)
        if predictor is not None:
            result["runtime"] = predictor.metadata
        # The output is explicitly selected by the local CLI user, not taken from
        # any dataset field; exclusive creation prevents accidental replacement.
        with args.output.expanduser().open("x", encoding="utf-8") as stream:
            json.dump(result, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
        print(json.dumps({"datasetId": result["datasetId"], "sampleCounts": result["sampleCounts"],
                          "summary": result["summary"], "incrementalCoverage": result["incrementalCoverage"]},
                         ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except DatasetError as exc:
        # Code security: DatasetError contains fixed codes only, no UI or path data.
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2
    except Exception:
        # Model/runtime/OS errors may carry local paths or input snippets.
        print('{"error": "evaluation_failed"}', file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
