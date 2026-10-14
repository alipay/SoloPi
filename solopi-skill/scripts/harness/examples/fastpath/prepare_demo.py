#!/usr/bin/env python3
"""Prepare local FastPath demo inputs without connecting to a device or model."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src" / "solopi_harness"))
import fastpath
import verification_engine


PACKAGE = "com.solopi.fastpath.demo"
SCENARIOS = ("baseline", "renamed", "broken", "unknown", "disabled")


def selector(resource: str) -> dict:
    return {"resourceId": PACKAGE + ":id/" + resource, "packageName": PACKAGE}


def oracle(resource: str, expected: str) -> dict:
    return {"type": "ui", "selector": selector(resource), "field": "text", "operator": "equals", "expected": expected}


def demo_policy(scenario: str) -> dict:
    if scenario not in SCENARIOS:
        raise ValueError("Unsupported demo scenario")
    return fastpath.validate_policy({
        "schemaVersion": fastpath.POLICY_SCHEMA,
        "targetPackage": PACKAGE,
        "steps": {"open-order-details": {
            "instructions": "哪个按钮最符合请求的操作？",
            "readyWhen": {"selector": selector("page_state"), "field": "text", "equals": "ORDERS"},
            "stopWhen": {"selector": selector("page_state"), "field": "text", "equals": "DETAIL"},
            "candidateSelectors": [selector("action_primary"), selector("action_secondary"), selector("action_tertiary")],
            "exactText": "查看订单详情",
            "maxCandidates": 3,
        }},
    })


def demo_requirement(scenario: str) -> dict:
    if scenario not in SCENARIOS:
        raise ValueError("Unsupported demo scenario")
    return {
        "schemaVersion": "solopi.ai.requirement/v1",
        "id": "fastpath-" + scenario,
        "title": "FastPath 订单详情验证：" + scenario,
        "targetAppPackage": PACKAGE,
        "targetAppLabel": "SoloPi FastPath Demo",
        "acceptanceCriteria": [{"id": "AC-PAID", "text": "订单详情显示订单已支付。"}],
        "scenarios": [{
            "id": scenario,
            "title": scenario,
            "acceptanceCriteria": ["AC-PAID"],
            "preconditions": [],
            "steps": [
                {"id": "select-scenario", "type": "operation", "stability": "stable",
                 "action": {"type": "click", "selector": selector("scenario_" + scenario)}},
                {"id": "open-order-details", "type": "explore", "goal": "打开订单详情。",
                 "allowedActions": ["click"], "budget": {
                     "maxSteps": 3, "maxDurationMs": 180000, "idleTimeoutMs": 120000,
                     "maxRepeatedActions": 2, "maxNoProgressSteps": 2}},
            ],
            "checkpoints": [{"id": "order-is-paid", "afterStep": "open-order-details",
                             "acceptanceCriteria": ["AC-PAID"], "oracle": oracle("order_status", "已支付")}],
            "cleanup": [
                {"id": "return-to-scenarios", "required": True,
                 "action": {"type": "click", "selector": selector("reset_button")}},
                {"id": "scenario-list-visible", "required": True,
                 "oracle": oracle("page_state", "SCENARIOS")},
            ],
        }],
    }


def prepare(output: Path, scenario: str = "all") -> dict:
    """Create only a new directory, with fixed names beneath the chosen root."""
    names = SCENARIOS if scenario == "all" else (scenario,)
    if any(name not in SCENARIOS for name in names):
        raise ValueError("Unsupported demo scenario")
    # Compile every input before writing so a schema error leaves no partial bundle.
    inputs = []
    for name in names:
        requirement = demo_requirement(name)
        plan = verification_engine.compile_verification_plan(requirement)
        verification_engine.validate_verification_plan(plan)
        inputs.append((name, demo_policy(name), requirement, plan))
    requested = Path(output).expanduser()
    if requested.name in {"", ".", ".."}:
        raise ValueError("A new output directory is required")
    requested.parent.mkdir(parents=True, exist_ok=True)
    root = requested.parent.resolve() / requested.name
    # Code security: local CLI users choose the base; all descendants use fixed
    # names, resolved containment checks and exclusive creation, never overwrites.
    if root.exists() or root.is_symlink():
        raise FileExistsError("Output directory already exists")
    root.mkdir()

    def write(relative: str, value, plain: bool = False) -> str:
        target = (root / relative).resolve()
        target.relative_to(root)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("x", encoding="utf-8") as stream:
            stream.write(value if plain else json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        return str(target)

    manifest = {"schemaVersion": "solopi.ai.fastpath-demo-bundle/v1", "targetPackage": PACKAGE, "scenarios": {}}
    for name, policy, requirement, plan in inputs:
        entry = {
            "policy": write(name + "/policy.json", policy),
            "requirement": write(name + "/requirement.json", requirement),
            "plan": write(name + "/plan.json", plan),
            "planFingerprint": plan["planFingerprint"],
            "cases": [],
        }
        for compiled_scenario in plan["intent"]["scenarios"]:
            for index, segment in enumerate(compiled_scenario["segments"]):
                if isinstance(segment.get("case"), dict):
                    entry["cases"].append(write(name + "/cases/case-%02d.json" % index, segment["case"]))
        manifest["scenarios"][name] = entry
    write("manifest.json", manifest)
    write("README.md", """# FastPath 本地演示输入

本目录只包含冻结策略、需求、编译计划和固定回放段。生成过程未操作设备、未调用模型。
先在 Demo 场景列表页运行对应目录的 plan.json，并将同目录 policy.json 传给 FastPath。
所有场景使用同一个目标、候选白名单、完成条件和确定性 Oracle；预期结果不输入模型或判定器。

| 场景 | Laya 路径预期 | 精确文案 rules 基线预期 |
| --- | --- | --- |
| baseline | passed | passed |
| renamed | passed | not_tested |
| broken | failed | failed |
| unknown | not_tested | not_tested |
| disabled | not_tested | not_tested |

这是待验证的预期，不是运行结果。Laya 选择错误或拒答也可能产生 not_tested。
abstain 只是一个可选答案，不保证在无匹配候选时拒答；不能作为可靠的业务准入判断。
broken 的唯一验收条件仍为“已支付”；界面显示“已取消”时由 Oracle 判 failed。
cleanup 必须点击 reset_button 并验证 page_state=SCENARIOS。
首版没有覆盖 popup、loading、多 App、坐标动作或任意网页。
候选顺序来自当前 UI 树，不能依赖 candidate_0 对应正确按钮。
""", plain=True)
    return manifest


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="必须不存在的本地输出目录")
    parser.add_argument("--scenario", default="all", choices=("all",) + SCENARIOS)
    args = parser.parse_args(argv)
    try:
        manifest = prepare(args.output, args.scenario)
    except (ValueError, OSError, verification_engine.VerificationError) as error:
        # Code security: no caller paths, model contents or raw exceptions in errors.
        parser.exit(2, "无法生成演示输入：输出目录必须为新目录，且输入必须通过验证。\n")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
