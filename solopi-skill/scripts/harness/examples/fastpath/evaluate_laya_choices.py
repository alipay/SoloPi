#!/usr/bin/env python3
"""Compare fixed text-decision prompts with an ID-scoped rule baseline, offline.

The protocol contains only public menu labels, not full trees or account data.
No selection produced by this evaluator is sent to a phone.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import statistics
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from solopi_harness.goalpath_runtime import GoalPathMlxPredictor


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", required=True, type=Path)
    parser.add_argument("--model-path", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    protocol = json.loads(args.protocol.read_text())
    os.umask(0o077)
    args.output.mkdir(parents=True, exist_ok=False)
    predictor = GoalPathMlxPredictor(args.model_path)
    metadata = {"runtime": predictor.metadata, "protocolSha256": hashlib.sha256(args.protocol.read_bytes()).hexdigest(),
                "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                "deviceActions": 0, "remoteInferenceCalls": 0}
    (args.output / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2))
    rows = []
    for task in protocol["tasks"]:
        matches = [c["key"] for c in protocol["candidates"] if c["label"] == task["goal"]
                   and c["resourceId"] == protocol["ruleScope"]["resourceId"]
                   and c["parentResourceId"] == protocol["ruleScope"]["parentResourceId"]]
        rule = matches[0] if len(matches) == 1 else "abstain"
        for order in protocol["orders"]:
            candidates = list(protocol["candidates"])
            if order == "reverse":
                candidates.reverse()
            elif order != "forward":
                raise ValueError("Unsupported order")
            options = {c["key"]: c["label"] for c in candidates}
            options["abstain"] = protocol["abstainLabel"]
            for arm in protocol["arms"]:
                state = "任务：" + task["goal"] if arm == "semantic_match" else json.dumps(
                    {"goal": task["goal"], "history": [], "pageText": [c["label"] for c in candidates]},
                    ensure_ascii=False)
                request = {"state": state, "questions": {"action": {"type": "choice",
                    "instructions": protocol["instructions"][arm], "criteria": options}}}
                started = time.perf_counter()
                answer = predictor(request)["answers"]["action"]
                elapsed = (time.perf_counter() - started) * 1000
                probs = answer["probs"]
                ordered = sorted(probs.values(), reverse=True)
                choice = answer["choice"]
                accepted = (choice in options and choice != "abstain"
                            and probs[choice] >= protocol["gate"]["probability"]
                            and ordered[0] - ordered[1] >= protocol["gate"]["margin"])
                gated = choice if accepted else "abstain"
                row = {"id": task["id"], "arm": arm, "order": order, "expected": task["expected"],
                       "rawChoice": choice, "choice": gated, "accepted": accepted,
                       "correct": gated == task["expected"],
                       "wrongAccepted": accepted and gated != task["expected"],
                       "rulesChoice": rule, "rulesCorrect": rule == task["expected"],
                       "latencyMs": elapsed, "answer": answer, "capacity": predictor.last_capacity,
                       "requestSha256": hashlib.sha256(json.dumps(request, ensure_ascii=False,
                            sort_keys=True).encode()).hexdigest()}
                rows.append(row)
                with (args.output / "rows.jsonl").open("a") as stream:
                    stream.write(json.dumps(row, ensure_ascii=False) + "\n")
    summary = {}
    for arm in protocol["arms"]:
        rs = [r for r in rows if r["arm"] == arm]
        summary[arm] = {"evaluations": len(rs), "correct": sum(r["correct"] for r in rs),
                       "positiveEvaluations": sum(r["expected"] != "abstain" for r in rs),
                       "positiveCorrect": sum(r["accepted"] and r["correct"] for r in rs),
                       "wrongAccepted": sum(r["wrongAccepted"] for r in rs),
                       "rulesCorrect": sum(r["rulesCorrect"] for r in rs),
                       "ruleMissedNewCoverage": sum(r["accepted"] and r["correct"] and not r["rulesCorrect"] for r in rs),
                       "medianMs": statistics.median(r["latencyMs"] for r in rs)}
    (args.output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
