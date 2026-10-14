#!/usr/bin/env python3
"""Real model on explicitly synthetic Demo observations; no phone is accessed."""

import argparse
import itertools
import json
import statistics
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src" / "solopi_harness"))
from fastpath import FastPathDecisionProvider, PROMPT_TEMPLATE_VERSION
from fastpath_runtime import LocalMlxPredictor
from prepare_demo import PACKAGE, demo_policy


def context_for(variant, order):
    labels = {"primary": "查看订单详情" if variant == "baseline" else "看看这笔订单",
              "secondary": "查看物流", "tertiary": "联系商家"}
    nodes = [{"nodeId": "state", "packageName": PACKAGE,
              "resourceId": PACKAGE + ":id/page_state", "text": "ORDERS", "visible": True}]
    for kind in order:
        nodes.append({"nodeId": "node-" + kind, "resourceId": PACKAGE + ":id/action_" + kind,
                      "packageName": PACKAGE, "className": "android.widget.Button",
                      "text": labels[kind], "visible": True, "isClickable": True, "isEnabled": True})
    return {"stepId": "open-order-details", "goal": "打开订单详情。", "allowedActions": ["click"],
            "observation": {"observationId": "synthetic-demo-observation", "page": {
                "packageName": PACKAGE, "children": nodes}}}


def evaluate(model_path, output):
    if output.exists():
        raise ValueError("Output must be a new file")
    predictor = LocalMlxPredictor(model_path)
    policy = demo_policy("baseline")  # Share the frozen question instructions with the device demo.
    laya = FastPathDecisionProvider(policy, predictor=predictor, model="laya-multilingual-mlx",
                                    model_version=predictor.model_digest)
    rules = FastPathDecisionProvider(policy, mode="rules")
    rows = []
    for variant in ("baseline", "renamed"):
        for order in itertools.permutations(("primary", "secondary", "tertiary")):
            context = context_for(variant, order)
            for name, provider in (("rules", rules), ("laya", laya)):
                started = time.perf_counter()
                decision = provider.decide(context)
                rows.append({"variant": variant, "order": list(order), "provider": name,
                             "correct": decision.get("action", {}).get("nodeId") == "node-primary",
                             "wallMs": round((time.perf_counter() - started) * 1000, 3),
                             "decision": decision})
    summary = {}
    for name in ("rules", "laya"):
        samples = [row for row in rows if row["provider"] == name]
        summary[name] = {"count": len(samples), "correct": sum(row["correct"] for row in samples),
                         "blocked": sum(row["decision"]["type"] == "blocked" for row in samples),
                         "medianDecisionMs": statistics.median(row["wallMs"] for row in samples)}
    result = {"schemaVersion": "solopi.ai.fastpath-offline-evaluation/v1",
              "promptTemplateVersion": PROMPT_TEMPLATE_VERSION,
              "source": "synthetic observations from Demo UI labels; NOT device-captured observations",
              "scope": "2 label variants x 6 permutations, 12 correlated cases per provider; no task success claim",
              "runtime": predictor.metadata, "policyDigest": laya.policy_digest,
              "summary": summary, "samples": rows}
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
    print(json.dumps({"summary": result["summary"], "runtime": result["runtime"]}, ensure_ascii=False, indent=2))
