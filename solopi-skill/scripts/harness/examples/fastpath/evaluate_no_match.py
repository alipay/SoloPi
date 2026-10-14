#!/usr/bin/env python3
"""Real provider on six permutations of one synthetic no-match scenario; no phone access."""

import argparse
import hashlib
import itertools
import json
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src" / "solopi_harness"))
import fastpath
from evaluate_offline import context_for
from fastpath import FastPathDecisionProvider
from fastpath_runtime import LocalMlxPredictor
from prepare_demo import demo_policy


def evaluate(model_path, output):
    if output.exists() or output.is_symlink():
        raise ValueError("Output must be a new file")
    predictor = LocalMlxPredictor(model_path)
    provider = FastPathDecisionProvider(
        demo_policy("baseline"), predictor=predictor, model="laya-multilingual-mlx",
        model_version=predictor.model_digest,
    )
    labels = {"primary": "查看物流", "secondary": "联系商家", "tertiary": "申请退款"}
    rows = []
    for order in itertools.permutations(("primary", "secondary", "tertiary")):
        context = context_for("baseline", order)
        # Change visible text only. Keep the same allowed IDs, packages and action types.
        for node in context["observation"]["page"]["children"]:
            for kind, label in labels.items():
                if node.get("nodeId") == "node-" + kind:
                    node["text"] = label
                    break
        started = time.perf_counter()
        decision = provider.decide(context)
        elapsed_ms = (time.perf_counter() - started) * 1000
        outcome = decision.get("type")
        # Human semantic expectation is recorded after inference, never sent to the provider.
        # Every proposed action is wrong here even if its node/action schema is valid.
        rows.append({
            "order": list(order), "candidateLabels": [labels[kind] for kind in order],
            "context": context, "expectedDecision": "blocked",
            "wrongAction": outcome == "act", "blocked": outcome == "blocked",
            "modelAbstained": outcome == "blocked" and decision.get("reason") == "model_abstained",
            "wallMs": round(elapsed_ms, 3), "decision": decision,
        })
    blocked_reasons = Counter(
        row["decision"].get("reason", "unspecified") for row in rows if row["blocked"]
    )
    summary = {
        "count": len(rows),
        "wrongActions": sum(row["wrongAction"] for row in rows),
        "blocked": sum(row["blocked"] for row in rows),
        "modelAbstentions": sum(row["modelAbstained"] for row in rows),
        "otherOutcomes": sum(not row["wrongAction"] and not row["blocked"] for row in rows),
        "blockedReasons": dict(blocked_reasons),
        "medianDecisionMs": statistics.median(row["wallMs"] for row in rows),
    }
    result = {
        "schemaVersion": "solopi.ai.fastpath-no-match-evaluation/v1",
        "source": "Synthetic Demo observations; NOT device-captured observations; no actions executed",
        "scope": "One semantic no-match scenario x 6 permutations; six correlated samples, not six independent scenarios or a production accuracy estimate",
        "humanExpectation": "All decisions should be blocked: none of the three buttons opens order details. A well-formed allowed action is still semantically wrong",
        "interpretation": "Blocked results may include runtime/validation failures; inspect blockedReasons and modelAbstentions rather than equating every block with model abstention",
        "configuration": "Current FastPathDecisionProvider and unmodified baseline demo_policy; no prompt, threshold or model tuning in this script",
        "runtime": predictor.metadata,
        "providerSourceSha256": hashlib.sha256(Path(fastpath.__file__).read_bytes()).hexdigest(),
        "policyDigest": provider.policy_digest,
        "summary": summary, "samples": rows,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    result = evaluate(args.model, args.output)
    print(json.dumps({"summary": result["summary"], "runtime": result["runtime"]},
                     ensure_ascii=False, indent=2))
