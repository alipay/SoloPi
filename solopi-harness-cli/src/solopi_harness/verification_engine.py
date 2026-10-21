#!/usr/bin/env python3
"""确定性需求编译器与基于证据的验证评估器。"""

from __future__ import annotations

import copy
import hashlib
import json
import re
import time
import uuid
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple


REQUIREMENT_SCHEMA = "solopi.ai.requirement/v1"
NORMALIZED_SCHEMA = "solopi.ai.normalized-requirement/v1"
INTENT_SCHEMA = "solopi.ai.test-intent/v1"
PLAN_SCHEMA = "solopi.ai.verification-plan/v1"
REPORT_SCHEMA = "solopi.ai.verification-report/v1"

ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
BINDING_PATTERN = re.compile(r"\$\{([A-Za-z0-9][A-Za-z0-9._-]{0,127})\}")
SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")

DYNAMIC_ACTIONS = frozenset(
    {"click", "longClick", "input", "back", "home", "scroll", "wait"}
)
STABLE_ACTIONS = DYNAMIC_ACTIONS
UI_OPERATORS = frozenset({"equals", "contains", "matches"})
UI_FIELDS = frozenset({"text", "description"})
SELECTOR_FIELDS = ("resourceId", "text", "description", "className", "packageName", "id")
COMPILED_ACTIONS = frozenset(
    {
        "CLICK",
        "LONG_CLICK",
        "INPUT",
        "BACK",
        "HOME",
        "SLEEP",
        "SCROLL_TO_TOP",
        "SCROLL_TO_BOTTOM",
        "SCROLL_TO_LEFT",
        "SCROLL_TO_RIGHT",
        "GLOBAL_SCROLL_TO_TOP",
        "GLOBAL_SCROLL_TO_BOTTOM",
        "GLOBAL_SCROLL_TO_LEFT",
        "GLOBAL_SCROLL_TO_RIGHT",
        "ASSERT",
    }
)

DEFAULT_BUDGET = {
    "maxSteps": 50,
    "maxDurationMs": 300000,
    "idleTimeoutMs": 60000,
    "maxRepeatedActions": 5,
    "maxNoProgressSteps": 3,
}
BUDGET_BOUNDS = {
    "maxSteps": (1, 200),
    "maxDurationMs": (1000, 1800000),
    "idleTimeoutMs": (1000, 300000),
    "maxRepeatedActions": (1, 20),
    "maxNoProgressSteps": (1, 20),
}


class VerificationError(ValueError):
    """类型化的静态验证契约错误。"""

    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.details = details


def canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def canonical_fingerprint(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _mapping(value: Any, label: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise VerificationError("invalid_contract", "%s 必须是对象" % label, field=label)
    return copy.deepcopy(value)


def _list(value: Any, label: str, allow_empty: bool = False) -> List[Any]:
    if not isinstance(value, list) or (not allow_empty and not value):
        requirement = "列表" if allow_empty else "非空列表"
        raise VerificationError(
            "invalid_contract", "%s 必须是%s" % (label, requirement), field=label
        )
    return copy.deepcopy(value)


def _identifier(value: Any, label: str) -> str:
    if not isinstance(value, str) or ID_PATTERN.fullmatch(value.strip()) is None:
        raise VerificationError(
            "invalid_id",
            "%s 必须包含 1 到 128 个标识符字符" % label,
            field=label,
        )
    return value.strip()


def _text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise VerificationError("invalid_contract", "%s 必须是非空文本" % label)
    return value.strip()


def _unique_ids(items: Sequence[Mapping[str, Any]], label: str) -> None:
    seen = set()
    for item in items:
        item_id = item["id"]
        if item_id in seen:
            raise VerificationError("duplicate_id", "%s 包含重复 ID" % label, id=item_id)
        seen.add(item_id)


def _normalize_budget(value: Any, label: str) -> Dict[str, int]:
    source = {} if value is None else _mapping(value, label)
    unknown = sorted(set(source) - set(DEFAULT_BUDGET))
    if unknown:
        raise VerificationError(
            "invalid_budget", "%s 包含未知字段" % label, fields=unknown
        )
    result: Dict[str, int] = {}
    for key, default in DEFAULT_BUDGET.items():
        candidate = source.get(key, default)
        if isinstance(candidate, bool) or not isinstance(candidate, int):
            raise VerificationError("invalid_budget", "%s.%s 必须是整数" % (label, key))
        minimum, maximum = BUDGET_BOUNDS[key]
        if candidate < minimum or candidate > maximum:
            raise VerificationError(
                "invalid_budget",
                "%s.%s 超出支持范围" % (label, key),
                minimum=minimum,
                maximum=maximum,
                actual=candidate,
            )
        result[key] = candidate
    return result


def _normalize_acceptance_criteria(value: Any) -> List[Dict[str, str]]:
    items = _list(value, "acceptanceCriteria")
    result: List[Dict[str, str]] = []
    for index, item in enumerate(items):
        if isinstance(item, str):
            result.append({"id": "AC-%03d" % (index + 1), "text": _text(item, "AC 文本")})
            continue
        source = _mapping(item, "acceptanceCriteria[%d]" % index)
        result.append(
            {
                "id": _identifier(source.get("id", "AC-%03d" % (index + 1)), "AC ID"),
                "text": _text(source.get("text"), "AC 文本"),
            }
        )
    _unique_ids(result, "acceptanceCriteria")
    return result


def normalize_requirement(payload: Any) -> Dict[str, Any]:
    """规范化结构化需求输入，不臆造缺失的测试意图。"""

    source = _mapping(payload, "需求文档")
    declared_schema = source.get("schemaVersion", REQUIREMENT_SCHEMA)
    if declared_schema != REQUIREMENT_SCHEMA:
        raise VerificationError(
            "unsupported_schema", "不支持该需求结构", schemaVersion=declared_schema
        )
    requirement_source = source.get("requirement")
    requirement = (
        _mapping(requirement_source, "requirement")
        if requirement_source is not None
        else source
    )
    requirement_id = _identifier(
        requirement.get("id", requirement.get("requirementId")), "requirement id"
    )
    title = _text(requirement.get("title"), "requirement title")
    description = requirement.get("description", "")
    if not isinstance(description, str):
        raise VerificationError("invalid_contract", "需求描述必须是文本")
    acceptance_criteria = _normalize_acceptance_criteria(
        requirement.get("acceptanceCriteria", source.get("acceptanceCriteria"))
    )

    parameters = source.get("parameters", {})
    if not isinstance(parameters, dict):
        raise VerificationError("invalid_contract", "parameters 必须是对象")

    reusable_flows = _list(source.get("reusableFlows", []), "reusableFlows", allow_empty=True)
    normalized_flows: List[Dict[str, Any]] = []
    for index, item in enumerate(reusable_flows):
        flow = _mapping(item, "reusableFlows[%d]" % index)
        normalized_flows.append(
            {
                "id": _identifier(flow.get("id"), "reusable flow id"),
                "defaults": _mapping(flow.get("defaults", {}), "reusable flow defaults"),
                "steps": _list(flow.get("steps"), "reusable flow steps"),
            }
        )
    _unique_ids(normalized_flows, "reusableFlows")

    scenarios = _list(source.get("scenarios"), "scenarios")
    normalized_scenarios: List[Dict[str, Any]] = []
    for index, item in enumerate(scenarios):
        scenario = _mapping(item, "scenarios[%d]" % index)
        scenario_id = _identifier(scenario.get("id"), "scenario id")
        ac_refs = _list(scenario.get("acceptanceCriteria"), "scenario acceptanceCriteria")
        normalized_scenarios.append(
            {
                "id": scenario_id,
                "title": _text(scenario.get("title", scenario_id), "scenario title"),
                "acceptanceCriteria": [
                    _identifier(item_id, "scenario AC reference") for item_id in ac_refs
                ],
                "dependsOn": [
                    _identifier(item_id, "scenario dependency")
                    for item_id in _list(
                        scenario.get("dependsOn", []), "scenario dependsOn", allow_empty=True
                    )
                ],
                "bindings": _mapping(scenario.get("bindings", {}), "scenario bindings"),
                "testData": _mapping(scenario.get("testData", {}), "scenario testData"),
                "preconditions": _list(
                    scenario.get("preconditions", []), "scenario preconditions", allow_empty=True
                ),
                "steps": _list(scenario.get("steps"), "scenario steps"),
                "checkpoints": _list(scenario.get("checkpoints"), "scenario checkpoints"),
                "cleanup": _list(
                    scenario.get("cleanup", []), "scenario cleanup", allow_empty=True
                ),
                "budget": _normalize_budget(scenario.get("budget"), "scenario budget"),
                "requestedRoute": scenario.get("route", "auto"),
                "targetAppPackage": scenario.get(
                    "targetAppPackage", source.get("targetAppPackage")
                ),
                "targetAppLabel": scenario.get("targetAppLabel", source.get("targetAppLabel")),
            }
        )
    _unique_ids(normalized_scenarios, "scenarios")

    return {
        "schemaVersion": NORMALIZED_SCHEMA,
        "requirement": {
            "id": requirement_id,
            "title": title,
            "description": description,
            "acceptanceCriteria": acceptance_criteria,
        },
        "parameters": copy.deepcopy(parameters),
        "reusableFlows": normalized_flows,
        "scenarios": normalized_scenarios,
    }


def _resolve_value(value: Any, bindings: Mapping[str, Any], location: str) -> Any:
    if isinstance(value, str):
        exact = BINDING_PATTERN.fullmatch(value)
        if exact:
            name = exact.group(1)
            if name not in bindings:
                raise VerificationError(
                    "unresolved_binding",
                    "参数绑定未定义",
                    binding=name,
                    location=location,
                )
            return copy.deepcopy(bindings[name])

        def replace(match: re.Match[str]) -> str:
            name = match.group(1)
            if name not in bindings:
                raise VerificationError(
                    "unresolved_binding",
                    "参数绑定未定义",
                    binding=name,
                    location=location,
                )
            replacement = bindings[name]
            if isinstance(replacement, (dict, list)):
                raise VerificationError(
                    "invalid_binding",
                    "复合参数绑定不能嵌入文本",
                    binding=name,
                    location=location,
                )
            return str(replacement)

        return BINDING_PATTERN.sub(replace, value)
    if isinstance(value, list):
        return [
            _resolve_value(item, bindings, "%s[%d]" % (location, index))
            for index, item in enumerate(value)
        ]
    if isinstance(value, dict):
        return {
            key: _resolve_value(item, bindings, "%s.%s" % (location, key))
            for key, item in value.items()
        }
    return copy.deepcopy(value)


def _resolve_binding_map(
    source: Mapping[str, Any], bindings: Mapping[str, Any], location: str
) -> Dict[str, Any]:
    pending = copy.deepcopy(dict(source))
    resolved: Dict[str, Any] = {}
    for _ in range(len(pending) + 1):
        progressed = False
        available = dict(bindings)
        available.update(resolved)
        for key in list(pending):
            try:
                resolved[key] = _resolve_value(pending[key], available, "%s.%s" % (location, key))
            except VerificationError as exc:
                if exc.code != "unresolved_binding" or exc.details.get("binding") not in pending:
                    raise
                continue
            del pending[key]
            progressed = True
        if not pending:
            return resolved
        if not progressed:
            break
    first = sorted(pending)[0]
    _resolve_value(pending[first], {**bindings, **resolved}, "%s.%s" % (location, first))
    raise AssertionError("unreachable")


def _normalize_selector(value: Any, location: str) -> Dict[str, Any]:
    selector = _mapping(value, location)
    unknown = sorted(set(selector) - set(SELECTOR_FIELDS))
    if unknown:
        raise VerificationError(
            "invalid_selector", "选择器包含不支持的字段", fields=unknown, location=location
        )
    normalized = {
        key: candidate
        for key in SELECTOR_FIELDS
        if (candidate := selector.get(key)) is not None
    }
    if not normalized or not all(isinstance(item, (str, int)) for item in normalized.values()):
        raise VerificationError(
            "invalid_selector", "选择器必须包含已观察到的标量字段", location=location
        )
    return normalized


def _normalize_oracle(value: Any, location: str) -> Dict[str, Any]:
    oracle = _mapping(value, location)
    oracle_type = oracle.get("type")
    if oracle_type != "ui":
        raise VerificationError(
            "unsupported_oracle",
            "当前只支持确定性界面判定器",
            oracleType=oracle_type,
            location=location,
        )
    unknown = sorted(
        set(oracle) - {"type", "selector", "field", "operator", "expected"}
    )
    if unknown:
        raise VerificationError(
            "invalid_oracle", "界面判定器包含未知字段", fields=unknown, location=location
        )
    field = oracle.get("field", "text")
    operator = oracle.get("operator", "equals")
    expected = oracle.get("expected")
    if field not in UI_FIELDS or operator not in UI_OPERATORS or not isinstance(expected, str):
        raise VerificationError("invalid_oracle", "界面判定器契约无效", location=location)
    if operator == "matches":
        try:
            re.compile(expected)
        except re.error as exc:
            raise VerificationError(
                "invalid_oracle", "界面判定器的正则表达式无效", location=location
            ) from exc
    return {
        "type": "ui",
        "selector": _normalize_selector(oracle.get("selector"), "%s.selector" % location),
        "field": field,
        "operator": operator,
        "expected": expected,
    }


def _normalize_action(value: Any, location: str) -> Dict[str, Any]:
    action = _mapping(value, location)
    action_type = action.get("type")
    if action_type not in STABLE_ACTIONS:
        raise VerificationError(
            "unsupported_action", "操作使用了不支持的类型化动作", action=action_type
        )
    allowed_fields = {
        "click": {"type", "selector"},
        "longClick": {"type", "selector", "durationMs"},
        "input": {"type", "selector", "text"},
        "back": {"type"},
        "home": {"type"},
        "scroll": {"type", "selector", "direction", "distance"},
        "wait": {"type", "durationMs"},
    }[action_type]
    unknown = sorted(set(action) - allowed_fields)
    if unknown:
        raise VerificationError(
            "invalid_action", "类型化动作包含未知字段", action=action_type, fields=unknown
        )
    result: Dict[str, Any] = {"type": action_type}
    if action_type in {"click", "longClick", "input"}:
        result["selector"] = _normalize_selector(action.get("selector"), "%s.selector" % location)
    if action_type == "scroll" and action.get("selector") is not None:
        result["selector"] = _normalize_selector(action["selector"], "%s.selector" % location)
    if action_type == "input":
        result["text"] = _text(action.get("text"), "%s.text" % location)
    if action_type in {"longClick", "wait"}:
        duration = action.get("durationMs", 1000)
        if isinstance(duration, bool) or not isinstance(duration, int) or duration < 100 or duration > 5000:
            raise VerificationError("invalid_action", "动作 durationMs 必须在 100 到 5000 之间")
        result["durationMs"] = duration
    if action_type == "scroll":
        direction = action.get("direction")
        distance = action.get("distance", 50)
        if direction not in {"up", "down", "left", "right"}:
            raise VerificationError("invalid_action", "滚动方向无效")
        if isinstance(distance, bool) or not isinstance(distance, int) or distance < 1 or distance > 90:
            raise VerificationError("invalid_action", "滚动距离必须在 1 到 90 之间")
        result.update({"direction": direction, "distance": distance})
    return result


def _topological_order(scenarios: Sequence[Mapping[str, Any]]) -> List[str]:
    positions = {scenario["id"]: index for index, scenario in enumerate(scenarios)}
    dependencies: Dict[str, set[str]] = {}
    consumers: Dict[str, List[str]] = {scenario["id"]: [] for scenario in scenarios}
    for scenario in scenarios:
        scenario_id = scenario["id"]
        deps = set(scenario["dependsOn"])
        if scenario_id in deps:
            raise VerificationError("dependency_cycle", "场景不能依赖自身", scenarioId=scenario_id)
        missing = sorted(deps - set(positions))
        if missing:
            raise VerificationError(
                "unknown_dependency", "场景引用了未知依赖", scenarioId=scenario_id, dependencies=missing
            )
        dependencies[scenario_id] = deps
        for dependency in deps:
            consumers[dependency].append(scenario_id)

    ready = sorted(
        (scenario_id for scenario_id, deps in dependencies.items() if not deps),
        key=positions.get,
    )
    result: List[str] = []
    while ready:
        scenario_id = ready.pop(0)
        result.append(scenario_id)
        for consumer in sorted(consumers[scenario_id], key=positions.get):
            dependencies[consumer].discard(scenario_id)
            if not dependencies[consumer] and consumer not in result and consumer not in ready:
                ready.append(consumer)
                ready.sort(key=positions.get)
    if len(result) != len(scenarios):
        blocked = [scenario_id for scenario_id in positions if scenario_id not in result]
        raise VerificationError("dependency_cycle", "场景依赖图存在环", scenarios=blocked)
    return result


def _expand_steps(
    scenario: Mapping[str, Any],
    flow_by_id: Mapping[str, Mapping[str, Any]],
    bindings: Mapping[str, Any],
) -> List[Dict[str, Any]]:
    expanded: List[Dict[str, Any]] = []
    for index, raw in enumerate(scenario["steps"]):
        step = _mapping(raw, "scenario step")
        if "use" not in step:
            expanded.append(_resolve_value(step, bindings, "steps[%d]" % index))
            continue
        unknown = sorted(set(step) - {"use", "bindings"})
        if unknown:
            raise VerificationError("invalid_flow_use", "复用流程引用包含未知字段", fields=unknown)
        flow_id = _identifier(step.get("use"), "flow reference")
        flow = flow_by_id.get(flow_id)
        if flow is None:
            raise VerificationError("unknown_flow", "场景引用了未知的复用流程", flowId=flow_id)
        call_bindings = dict(bindings)
        defaults = _resolve_binding_map(flow["defaults"], call_bindings, "flow defaults")
        call_bindings.update(defaults)
        supplied = _resolve_binding_map(
            _mapping(step.get("bindings", {}), "flow bindings"), call_bindings, "flow bindings"
        )
        call_bindings.update(supplied)
        for flow_index, flow_step in enumerate(flow["steps"]):
            expanded.append(
                _resolve_value(flow_step, call_bindings, "flow %s steps[%d]" % (flow_id, flow_index))
            )
    return expanded


def _compile_operation_step(
    step_id: str, action: Mapping[str, Any], operation_id: str, index: int
) -> Dict[str, Any]:
    action_type = action["type"]
    params: Dict[str, str] = {}
    node = copy.deepcopy(action.get("selector"))
    if action_type == "click":
        action_enum = "CLICK"
    elif action_type == "longClick":
        action_enum = "LONG_CLICK"
        params["text"] = str(action["durationMs"])
    elif action_type == "input":
        action_enum = "INPUT"
        params["text"] = action["text"]
    elif action_type == "back":
        action_enum = "BACK"
        node = None
    elif action_type == "home":
        action_enum = "HOME"
        node = None
    elif action_type == "wait":
        action_enum = "SLEEP"
        node = None
        params["text"] = str(action["durationMs"])
    else:
        direction = action["direction"]
        prefix = "" if node is not None else "GLOBAL_"
        suffix = {"up": "TOP", "down": "BOTTOM", "left": "LEFT", "right": "RIGHT"}[direction]
        action_enum = "%sSCROLL_TO_%s" % (prefix, suffix)
        params["distance"] = str(action["distance"])
    return {
        "operationNode": node,
        "operationMethod": {
            "actionEnum": action_enum,
            "operationParam": params,
            "encrypt": False,
            "safeEncrypt": False,
        },
        "operationIndex": index,
        "operationId": operation_id,
        "stepId": step_id,
    }


def _oracle_step(
    step_id: str, oracle: Mapping[str, Any], operation_id: str, index: int
) -> Dict[str, Any]:
    mode = {
        "equals": "assert_accurate",
        "contains": "assert_contain",
        "matches": "assert_regular",
    }[oracle["operator"]]
    params = {"assertMode": mode, "assertInputContent": oracle["expected"]}
    if oracle["field"] == "description":
        params["assertTarget"] = "description"
    return {
        "operationNode": copy.deepcopy(oracle["selector"]),
        "operationMethod": {
            "actionEnum": "ASSERT",
            "operationParam": params,
            "encrypt": False,
            "safeEncrypt": False,
        },
        "operationIndex": index,
        "operationId": operation_id,
        "stepId": step_id,
    }


def _safe_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-.")
    return cleaned or "verification"


def _fixed_case(
    requirement_id: str,
    scenario: Mapping[str, Any],
    phase: str,
    ordinal: int,
    steps: List[Dict[str, Any]],
) -> Dict[str, Any]:
    semantic = {
        "requirementId": requirement_id,
        "scenarioId": scenario["id"],
        "phase": phase,
        "ordinal": ordinal,
        "targetAppPackage": scenario["targetAppPackage"],
        "steps": steps,
    }
    suffix = canonical_fingerprint(semantic)[:12]
    name = _safe_name("verify-%s-%s-%s-%02d-%s" % (
        requirement_id, scenario["id"], phase, ordinal, suffix
    ))[:120]
    return {
        "caseName": name,
        "caseDesc": "已编译的验证片段 %s/%s" % (scenario["id"], phase),
        "targetAppPackage": scenario["targetAppPackage"],
        "targetAppLabel": scenario.get("targetAppLabel") or scenario["targetAppPackage"],
        "recordMode": "local",
        "advanceSettings": "",
        "priority": 2,
        "operationLog": {"steps": steps},
    }


def _segment_id(scenario_id: str, phase: str, ordinal: int, semantic: Any) -> str:
    return "segment-%s-%s-%02d-%s" % (
        _safe_name(scenario_id)[:40], phase, ordinal, canonical_fingerprint(semantic)[:12]
    )


def _compile_fixed_segment(
    requirement_id: str,
    scenario: Mapping[str, Any],
    phase: str,
    ordinal: int,
    source_steps: Sequence[Mapping[str, Any]],
    checkpoints_by_step: Optional[Mapping[str, Sequence[Dict[str, Any]]]] = None,
) -> Dict[str, Any]:
    operation_id = _safe_name("verification-%s-%s" % (scenario["id"], phase))[:120]
    compiled_steps: List[Dict[str, Any]] = []
    checkpoint_ids: List[str] = []
    checkpoint_oracle_steps: Dict[str, str] = {}
    for source in source_steps:
        compiled_steps.append(
            _compile_operation_step(
                source["id"], source["action"], operation_id, len(compiled_steps)
            )
        )
        if checkpoints_by_step:
            for checkpoint in checkpoints_by_step.get(source["id"], []):
                oracle_step_id = "oracle-%s" % checkpoint["id"]
                compiled_steps.append(
                    _oracle_step(
                        oracle_step_id,
                        checkpoint["oracle"],
                        operation_id,
                        len(compiled_steps),
                    )
                )
                checkpoint_ids.append(checkpoint["id"])
                checkpoint_oracle_steps[checkpoint["id"]] = oracle_step_id
    case = _fixed_case(requirement_id, scenario, phase, ordinal, compiled_steps)
    semantic = {"phase": phase, "case": case, "checkpoints": checkpoint_ids}
    return {
        "segmentId": _segment_id(scenario["id"], phase, ordinal, semantic),
        "phase": phase,
        "route": "deterministic",
        "sourceStepIds": [step["id"] for step in source_steps],
        "checkpointIds": checkpoint_ids,
        "checkpointOracleSteps": checkpoint_oracle_steps,
        "case": case,
    }


def _compile_oracle_segment(
    requirement_id: str,
    scenario: Mapping[str, Any],
    phase: str,
    oracles: Sequence[Mapping[str, Any]],
) -> Optional[Dict[str, Any]]:
    if not oracles:
        return None
    operation_id = _safe_name("verification-%s-%s" % (scenario["id"], phase))[:120]
    steps = [
        _oracle_step(
            "%s-%s" % (phase, item["id"]), item["oracle"], operation_id, index
        )
        for index, item in enumerate(oracles)
    ]
    case = _fixed_case(requirement_id, scenario, phase, 1, steps)
    semantic = {"phase": phase, "case": case}
    return {
        "segmentId": _segment_id(scenario["id"], phase, 1, semantic),
        "phase": phase,
        "route": "deterministic",
        "sourceStepIds": [],
        "checkpointIds": [],
        "oracleStepIds": [step["stepId"] for step in steps],
        "case": case,
    }


def _compile_cleanup_segment(
    requirement_id: str,
    scenario: Mapping[str, Any],
    cleanup: Sequence[Mapping[str, Any]],
) -> Optional[Dict[str, Any]]:
    if not cleanup:
        return None
    operation_id = _safe_name("verification-%s-cleanup" % scenario["id"])[:120]
    steps: List[Dict[str, Any]] = []
    oracle_step_ids: List[str] = []
    for item in cleanup:
        if "action" in item:
            steps.append(
                _compile_operation_step(item["id"], item["action"], operation_id, len(steps))
            )
        else:
            step_id = "cleanup-oracle-%s" % item["id"]
            steps.append(_oracle_step(step_id, item["oracle"], operation_id, len(steps)))
            oracle_step_ids.append(step_id)
    case = _fixed_case(requirement_id, scenario, "cleanup", 1, steps)
    semantic = {"phase": "cleanup", "case": case}
    return {
        "segmentId": _segment_id(scenario["id"], "cleanup", 1, semantic),
        "phase": "cleanup",
        "route": "deterministic",
        "sourceStepIds": [item["id"] for item in cleanup],
        "checkpointIds": [],
        "oracleStepIds": oracle_step_ids,
        "case": case,
    }


def _normalize_scenario(
    normalized: Mapping[str, Any],
    scenario: Mapping[str, Any],
    flow_by_id: Mapping[str, Mapping[str, Any]],
    ac_ids: set[str],
) -> Dict[str, Any]:
    scenario_id = scenario["id"]
    missing_acs = sorted(set(scenario["acceptanceCriteria"]) - ac_ids)
    if missing_acs:
        raise VerificationError(
            "unknown_acceptance_criterion", "场景引用了未知验收条件",
            scenarioId=scenario_id, acceptanceCriteria=missing_acs
        )
    bindings = _resolve_binding_map(normalized["parameters"], {}, "parameters")
    test_data = _resolve_binding_map(scenario["testData"], bindings, "%s.testData" % scenario_id)
    bindings.update(test_data)
    explicit_bindings = _resolve_binding_map(
        scenario["bindings"], bindings, "%s.bindings" % scenario_id
    )
    bindings.update(explicit_bindings)

    target_package = _resolve_value(
        scenario.get("targetAppPackage"), bindings, "%s.targetAppPackage" % scenario_id
    )
    if not isinstance(target_package, str) or not target_package.strip():
        raise VerificationError(
            "invalid_contract", "场景必须包含 targetAppPackage", scenarioId=scenario_id
        )
    target_label = _resolve_value(
        scenario.get("targetAppLabel"), bindings, "%s.targetAppLabel" % scenario_id
    )
    if target_label is not None and not isinstance(target_label, str):
        raise VerificationError("invalid_contract", "场景 targetAppLabel 必须是文本")

    raw_steps = _expand_steps(scenario, flow_by_id, bindings)
    steps: List[Dict[str, Any]] = []
    for index, raw in enumerate(raw_steps):
        step = _mapping(raw, "steps[%d]" % index)
        step_id = _identifier(step.get("id"), "step id")
        step_type = step.get("type", "operation")
        if step_type == "operation":
            unknown = sorted(set(step) - {"id", "type", "action", "description", "stability"})
            if unknown:
                raise VerificationError("invalid_step", "操作步骤包含未知字段", fields=unknown)
            if step.get("stability", "stable") != "stable":
                raise VerificationError(
                    "invalid_step", "未知工作必须使用 explore 步骤", stepId=step_id
                )
            steps.append(
                {
                    "id": step_id,
                    "type": "operation",
                    "stability": "stable",
                    "action": _normalize_action(step.get("action"), "step %s action" % step_id),
                }
            )
        elif step_type == "explore":
            unknown = sorted(
                set(step) - {"id", "type", "goal", "allowedActions", "budget", "description"}
            )
            if unknown:
                raise VerificationError("invalid_step", "探索步骤包含未知字段", fields=unknown)
            allowed_actions = _list(step.get("allowedActions"), "explore allowedActions")
            allowed = [_text(item, "allowed action") for item in allowed_actions]
            unsupported = sorted(set(allowed) - DYNAMIC_ACTIONS)
            if unsupported:
                raise VerificationError(
                    "unsupported_action", "探索步骤允许了不支持的动作", actions=unsupported
                )
            if len(set(allowed)) != len(allowed):
                raise VerificationError("duplicate_action", "探索步骤的 allowedActions 必须唯一")
            steps.append(
                {
                    "id": step_id,
                    "type": "explore",
                    "stability": "unknown",
                    "goal": _text(step.get("goal"), "explore goal"),
                    "allowedActions": allowed,
                    "budget": _normalize_budget(step.get("budget"), "explore budget"),
                }
            )
        else:
            raise VerificationError("invalid_step", "步骤类型必须是 operation 或 explore", stepId=step_id)
    _unique_ids(steps, "scenario steps")
    step_ids = {step["id"] for step in steps}

    checkpoints: List[Dict[str, Any]] = []
    for index, raw in enumerate(scenario["checkpoints"]):
        checkpoint = _mapping(
            _resolve_value(raw, bindings, "%s.checkpoints[%d]" % (scenario_id, index)),
            "checkpoint",
        )
        checkpoint_id = _identifier(checkpoint.get("id"), "checkpoint id")
        after_step = _identifier(checkpoint.get("afterStep"), "checkpoint afterStep")
        if after_step not in step_ids:
            raise VerificationError(
                "unknown_step", "Checkpoint 引用了未知步骤",
                checkpointId=checkpoint_id, afterStep=after_step
            )
        checkpoint_acs = checkpoint.get("acceptanceCriteria", scenario["acceptanceCriteria"])
        checkpoint_ac_refs = [
            _identifier(item, "checkpoint AC reference")
            for item in _list(checkpoint_acs, "checkpoint acceptanceCriteria")
        ]
        if not set(checkpoint_ac_refs).issubset(set(scenario["acceptanceCriteria"])):
            raise VerificationError(
                "unknown_acceptance_criterion",
                "Checkpoint 引用的验收条件必须属于当前场景",
                checkpointId=checkpoint_id,
            )
        checkpoints.append(
            {
                "id": checkpoint_id,
                "afterStep": after_step,
                "acceptanceCriteria": checkpoint_ac_refs,
                "oracle": _normalize_oracle(
                    checkpoint.get("oracle"), "checkpoint %s oracle" % checkpoint_id
                ),
            }
        )
    _unique_ids(checkpoints, "scenario checkpoints")
    covered_acs = {item for checkpoint in checkpoints for item in checkpoint["acceptanceCriteria"]}
    missing_coverage = sorted(set(scenario["acceptanceCriteria"]) - covered_acs)
    if missing_coverage:
        raise VerificationError(
            "uncovered_acceptance_criterion", "场景验收条件缺少 checkpoint",
            scenarioId=scenario_id, acceptanceCriteria=missing_coverage
        )

    preconditions: List[Dict[str, Any]] = []
    for index, raw in enumerate(scenario["preconditions"]):
        item = _mapping(
            _resolve_value(raw, bindings, "%s.preconditions[%d]" % (scenario_id, index)),
            "precondition",
        )
        precondition_id = _identifier(item.get("id"), "precondition id")
        preconditions.append(
            {
                "id": precondition_id,
                "oracle": _normalize_oracle(
                    item.get("oracle"), "precondition %s oracle" % precondition_id
                ),
            }
        )
    _unique_ids(preconditions, "scenario preconditions")

    cleanup: List[Dict[str, Any]] = []
    for index, raw in enumerate(scenario["cleanup"]):
        item = _mapping(
            _resolve_value(raw, bindings, "%s.cleanup[%d]" % (scenario_id, index)),
            "cleanup",
        )
        cleanup_id = _identifier(item.get("id"), "cleanup id")
        has_action = "action" in item
        has_oracle = "oracle" in item
        if has_action == has_oracle:
            raise VerificationError(
                "invalid_cleanup", "清理项必须只包含一个动作或判定器",
                cleanupId=cleanup_id
            )
        normalized_item: Dict[str, Any] = {"id": cleanup_id, "required": True}
        if has_action:
            normalized_item["action"] = _normalize_action(
                item["action"], "cleanup %s action" % cleanup_id
            )
        else:
            normalized_item["oracle"] = _normalize_oracle(
                item["oracle"], "cleanup %s oracle" % cleanup_id
            )
        cleanup.append(normalized_item)
    _unique_ids(cleanup, "scenario cleanup")

    return {
        "id": scenario_id,
        "title": scenario["title"],
        "acceptanceCriteria": scenario["acceptanceCriteria"],
        "dependsOn": scenario["dependsOn"],
        "bindings": explicit_bindings,
        "testData": test_data,
        "preconditions": preconditions,
        "steps": steps,
        "checkpoints": checkpoints,
        "cleanup": cleanup,
        "budget": scenario["budget"],
        "requestedRoute": scenario["requestedRoute"],
        "targetAppPackage": target_package.strip(),
        "targetAppLabel": target_label,
    }


def _compile_scenario(requirement_id: str, scenario: Dict[str, Any]) -> Dict[str, Any]:
    segments: List[Dict[str, Any]] = []
    precondition_segment = _compile_oracle_segment(
        requirement_id, scenario, "precondition", scenario["preconditions"]
    )
    if precondition_segment:
        segments.append(precondition_segment)

    checkpoints_by_step: Dict[str, List[Dict[str, Any]]] = {}
    for checkpoint in scenario["checkpoints"]:
        checkpoints_by_step.setdefault(checkpoint["afterStep"], []).append(checkpoint)

    test_segments: List[Dict[str, Any]] = []
    stable_group: List[Dict[str, Any]] = []

    def flush_stable() -> None:
        if not stable_group:
            return
        segment = _compile_fixed_segment(
            requirement_id,
            scenario,
            "test",
            len(test_segments) + 1,
            list(stable_group),
            checkpoints_by_step,
        )
        test_segments.append(segment)
        stable_group.clear()

    for step in scenario["steps"]:
        if step["type"] == "operation":
            stable_group.append(step)
            continue
        flush_stable()
        dynamic_checkpoints = [item["id"] for item in checkpoints_by_step.get(step["id"], [])]
        semantic = {"phase": "test", "step": step, "checkpoints": dynamic_checkpoints}
        test_segments.append(
            {
                "segmentId": _segment_id(
                    scenario["id"], "test", len(test_segments) + 1, semantic
                ),
                "phase": "test",
                "route": "dynamic",
                "sourceStepIds": [step["id"]],
                "checkpointIds": dynamic_checkpoints,
                "dynamicStep": copy.deepcopy(step),
            }
        )
    flush_stable()
    segments.extend(test_segments)

    cleanup_segment = _compile_cleanup_segment(
        requirement_id, scenario, scenario["cleanup"]
    )
    if cleanup_segment:
        segments.append(cleanup_segment)

    routes = {segment["route"] for segment in test_segments}
    route = "hybrid" if len(routes) > 1 else next(iter(routes))
    requested = scenario.pop("requestedRoute")
    if requested not in {"auto", "deterministic", "dynamic", "hybrid"}:
        raise VerificationError("invalid_route", "场景路由无效", route=requested)
    if requested != "auto" and requested != route:
        raise VerificationError(
            "route_mismatch", "请求的路由与已编译工作不匹配",
            scenarioId=scenario["id"], requested=requested, compiled=route
        )

    checkpoint_by_id = {item["id"]: item for item in scenario["checkpoints"]}
    for segment in test_segments:
        for checkpoint_id in segment["checkpointIds"]:
            checkpoint = checkpoint_by_id[checkpoint_id]
            checkpoint["segmentId"] = segment["segmentId"]
            if segment["route"] == "deterministic":
                checkpoint["oracleStepId"] = segment["checkpointOracleSteps"][checkpoint_id]

    result = copy.deepcopy(scenario)
    result["route"] = route
    result["segments"] = segments
    return result


def build_goal_tree(normalized: Mapping[str, Any]) -> Dict[str, Any]:
    requirement = normalized["requirement"]
    scenarios = normalized["scenarios"]
    children = []
    for acceptance_criterion in requirement["acceptanceCriteria"]:
        scenario_nodes = []
        for scenario in scenarios:
            if acceptance_criterion["id"] not in scenario["acceptanceCriteria"]:
                continue
            checkpoint_nodes = [
                {
                    "id": checkpoint["id"],
                    "type": "checkpoint",
                    "afterStep": checkpoint["afterStep"],
                }
                for checkpoint in scenario["checkpoints"]
                if acceptance_criterion["id"]
                in checkpoint.get("acceptanceCriteria", scenario["acceptanceCriteria"])
            ]
            scenario_nodes.append(
                {
                    "id": scenario["id"],
                    "type": "scenario",
                    "dependsOn": copy.deepcopy(scenario["dependsOn"]),
                    "children": checkpoint_nodes,
                }
            )
        children.append(
            {
                "id": acceptance_criterion["id"],
                "type": "acceptance_criterion",
                "text": acceptance_criterion["text"],
                "children": scenario_nodes,
            }
        )
    return {
        "id": requirement["id"],
        "type": "requirement",
        "title": requirement["title"],
        "children": children,
    }


def compile_verification_plan(payload: Any) -> Dict[str, Any]:
    normalized = normalize_requirement(payload)
    ac_ids = {item["id"] for item in normalized["requirement"]["acceptanceCriteria"]}
    flow_by_id = {item["id"]: item for item in normalized["reusableFlows"]}
    resolved_scenarios = [
        _normalize_scenario(normalized, scenario, flow_by_id, ac_ids)
        for scenario in normalized["scenarios"]
    ]
    execution_order = _topological_order(resolved_scenarios)
    compiled_by_id = {
        scenario["id"]: _compile_scenario(normalized["requirement"]["id"], scenario)
        for scenario in resolved_scenarios
    }
    compiled_scenarios = [compiled_by_id[scenario_id] for scenario_id in execution_order]
    intent = {
        "schemaVersion": INTENT_SCHEMA,
        "requirement": copy.deepcopy(normalized["requirement"]),
        "parameters": copy.deepcopy(normalized["parameters"]),
        "executionOrder": execution_order,
        "scenarios": compiled_scenarios,
    }
    goal_tree_source = copy.deepcopy(normalized)
    goal_tree_source["scenarios"] = compiled_scenarios
    plan: Dict[str, Any] = {
        "schemaVersion": PLAN_SCHEMA,
        "sourceFingerprint": canonical_fingerprint(normalized),
        "goalTree": build_goal_tree(goal_tree_source),
        "intent": intent,
    }
    plan["planFingerprint"] = canonical_fingerprint(plan)
    validate_verification_plan(plan)
    return plan


def validate_verification_plan(plan: Any) -> Dict[str, Any]:
    source = _mapping(plan, "verification plan")
    if source.get("schemaVersion") != PLAN_SCHEMA:
        raise VerificationError("unsupported_schema", "不支持该验证计划结构")
    fingerprint = source.get("planFingerprint")
    if not isinstance(fingerprint, str) or SHA256_PATTERN.fullmatch(fingerprint) is None:
        raise VerificationError("invalid_fingerprint", "计划指纹缺失或无效")
    unsigned = copy.deepcopy(source)
    unsigned.pop("planFingerprint", None)
    actual_fingerprint = canonical_fingerprint(unsigned)
    if fingerprint != actual_fingerprint:
        raise VerificationError(
            "fingerprint_mismatch", "验证计划内容与其指纹不匹配"
        )
    intent = _mapping(source.get("intent"), "intent")
    if intent.get("schemaVersion") != INTENT_SCHEMA:
        raise VerificationError("unsupported_schema", "不支持该测试意图 IR 结构")
    scenarios = _list(intent.get("scenarios"), "intent scenarios")
    _unique_ids(scenarios, "intent scenarios")
    order = _list(intent.get("executionOrder"), "executionOrder")
    if order != [scenario["id"] for scenario in scenarios]:
        raise VerificationError("invalid_execution_order", "场景顺序与已编译 DAG 不匹配")
    _topological_order(scenarios)
    ac_ids = {
        item["id"]
        for item in _list(intent.get("requirement", {}).get("acceptanceCriteria"), "plan ACs")
    }
    covered = set()
    segment_count = 0
    checkpoint_count = 0
    for scenario in scenarios:
        segments = _list(scenario.get("segments"), "scenario segments")
        segment_ids = set()
        test_routes = set()
        for segment in segments:
            segment_id = _identifier(segment.get("segmentId"), "segment id")
            if segment_id in segment_ids:
                raise VerificationError("duplicate_id", "场景包含重复片段 ID")
            segment_ids.add(segment_id)
            if segment.get("phase") == "test":
                test_routes.add(segment.get("route"))
            if segment.get("route") == "dynamic":
                dynamic_step = _mapping(segment.get("dynamicStep"), "dynamic step")
                if not dynamic_step.get("allowedActions") or not dynamic_step.get("budget"):
                    raise VerificationError("invalid_step", "动态片段必须保持有界")
            elif segment.get("route") != "deterministic":
                raise VerificationError("invalid_route", "片段路由无效")
            else:
                case = _mapping(segment.get("case"), "compiled SoloPi case")
                if case.get("targetAppPackage") != scenario.get("targetAppPackage"):
                    raise VerificationError(
                        "compiled_case_mismatch",
                        "已编译用例的目标与所属场景不匹配",
                        segmentId=segment_id,
                    )
                operation_log = _mapping(case.get("operationLog"), "compiled operationLog")
                compiled_steps = _list(operation_log.get("steps"), "compiled case steps")
                compiled_step_ids = set()
                for step_index, step in enumerate(compiled_steps):
                    compiled_step = _mapping(step, "compiled case step")
                    if compiled_step.get("operationIndex") != step_index:
                        raise VerificationError(
                            "compiled_case_mismatch",
                            "已编译用例的操作索引必须连续",
                            segmentId=segment_id,
                            stepIndex=step_index,
                        )
                    compiled_step_id = _identifier(
                        compiled_step.get("stepId"), "compiled case stepId"
                    )
                    if compiled_step_id in compiled_step_ids:
                        raise VerificationError(
                            "compiled_case_mismatch",
                            "已编译用例的 stepId 必须唯一",
                            segmentId=segment_id,
                            stepId=compiled_step_id,
                        )
                    compiled_step_ids.add(compiled_step_id)
                    method = _mapping(
                        compiled_step.get("operationMethod"), "compiled operation method"
                    )
                    action_enum = method.get("actionEnum")
                    if action_enum not in COMPILED_ACTIONS:
                        raise VerificationError(
                            "unsafe_compiled_action",
                            "已编译验证用例包含不允许的动作",
                            segmentId=segment_id,
                            stepId=compiled_step_id,
                            actionEnum=action_enum,
                        )
                for checkpoint_id, oracle_step_id in segment.get(
                    "checkpointOracleSteps", {}
                ).items():
                    oracle_steps = [
                        step
                        for step in compiled_steps
                        if step.get("stepId") == oracle_step_id
                    ]
                    if (
                        len(oracle_steps) != 1
                        or oracle_steps[0].get("operationMethod", {}).get("actionEnum")
                        != "ASSERT"
                    ):
                        raise VerificationError(
                            "compiled_case_mismatch",
                            "Checkpoint 必须映射到一个已编译 ASSERT 步骤",
                            segmentId=segment_id,
                            checkpointId=checkpoint_id,
                        )
            segment_count += 1
        expected_route = "hybrid" if len(test_routes) > 1 else next(iter(test_routes))
        if scenario.get("route") != expected_route:
            raise VerificationError("route_mismatch", "场景路由与其片段不匹配")
        for checkpoint in _list(scenario.get("checkpoints"), "scenario checkpoints"):
            _normalize_oracle(checkpoint.get("oracle"), "compiled checkpoint oracle")
            if checkpoint.get("segmentId") not in segment_ids:
                raise VerificationError("unknown_segment", "Checkpoint 引用了未知片段")
            refs = set(checkpoint.get("acceptanceCriteria", []))
            if not refs or not refs.issubset(ac_ids):
                raise VerificationError("unknown_acceptance_criterion", "Checkpoint 的验收条件映射无效")
            covered.update(refs)
            checkpoint_count += 1
    missing = sorted(ac_ids - covered)
    if missing:
        raise VerificationError(
            "uncovered_acceptance_criterion", "计划验收条件缺少 checkpoint",
            acceptanceCriteria=missing
        )
    return {
        "valid": True,
        "planFingerprint": fingerprint,
        "scenarioCount": len(scenarios),
        "segmentCount": segment_count,
        "checkpointCount": checkpoint_count,
    }


def _walk_nodes(root: Any) -> Iterable[Mapping[str, Any]]:
    if isinstance(root, dict):
        yield root
        children = root.get("children", [])
        if isinstance(children, list):
            for child in children:
                yield from _walk_nodes(child)


def _evaluate_ui_oracle(oracle: Mapping[str, Any], observation: Any) -> Tuple[str, str, Any]:
    if not isinstance(observation, dict) or not isinstance(observation.get("page"), dict):
        return "not_tested", "missing_observation", None
    selector = oracle["selector"]
    matching = [
        node
        for node in _walk_nodes(observation["page"])
        if all(node.get(key) == value for key, value in selector.items())
    ]
    if not matching:
        return "failed", "selector_not_found", None
    if len(matching) != 1:
        return "not_tested", "ambiguous_selector", None
    actual = matching[0].get(oracle["field"], "")
    if not isinstance(actual, str):
        actual = str(actual)
    expected = oracle["expected"]
    operator = oracle["operator"]
    passed = (
        actual == expected
        if operator == "equals"
        else expected in actual
        if operator == "contains"
        else re.search(expected, actual) is not None
    )
    return ("passed", "matched", actual) if passed else ("failed", "oracle_mismatch", actual)


def _evidence_entry(raw: Any) -> Dict[str, Any]:
    item = _mapping(raw, "execution evidence")
    evidence_type = item.get("type")
    if not isinstance(evidence_type, str) or not evidence_type:
        raise VerificationError("invalid_evidence", "必须提供证据类型")
    digest_source = copy.deepcopy(item)
    digest_source.pop("id", None)
    supplied_sha = item.get("sha256")
    if supplied_sha is not None and (
        not isinstance(supplied_sha, str) or SHA256_PATTERN.fullmatch(supplied_sha) is None
    ):
        raise VerificationError("invalid_evidence", "证据 sha256 无效")
    digest = supplied_sha or canonical_fingerprint(digest_source)
    result = copy.deepcopy(item)
    result["id"] = "evidence-%s" % digest[:20]
    result["sha256"] = digest
    return result


def _failed_step(result: Mapping[str, Any]) -> Optional[str]:
    direct = result.get("failedStepId")
    if isinstance(direct, str) and direct:
        return direct
    replay = result.get("run")
    if isinstance(replay, dict):
        summaries = replay.get("results")
        if isinstance(summaries, list):
            for summary in summaries:
                if isinstance(summary, dict) and isinstance(summary.get("exceptionStepId"), str):
                    return summary["exceptionStepId"]
    return None


def _checkpoint_result(
    checkpoint: Mapping[str, Any],
    segment: Mapping[str, Any],
    execution: Mapping[str, Any],
    evidence_refs: Sequence[str],
) -> Dict[str, Any]:
    base = {
        "checkpointId": checkpoint["id"],
        "acceptanceCriteria": copy.deepcopy(checkpoint["acceptanceCriteria"]),
        "oracle": copy.deepcopy(checkpoint["oracle"]),
        "evidenceRefs": list(evidence_refs),
    }
    if not evidence_refs:
        return {**base, "status": "not_tested", "reason": "missing_evidence"}
    if segment["route"] == "dynamic":
        if execution.get("state") not in {"done", "passed"}:
            return {
                **base,
                "status": "not_tested",
                "reason": execution.get("reason", "checkpoint_not_reached"),
            }
        status, reason, actual = _evaluate_ui_oracle(
            checkpoint["oracle"], execution.get("observation")
        )
        return {**base, "status": status, "reason": reason, "actual": actual}

    state = execution.get("state")
    if state == "passed":
        return {**base, "status": "passed", "reason": "compiled_oracle_passed"}
    if state != "failed":
        return {
            **base,
            "status": "not_tested",
            "reason": execution.get("reason", "checkpoint_not_reached"),
        }
    failed_step_id = _failed_step(execution)
    oracle_step_id = checkpoint.get("oracleStepId")
    if failed_step_id is None or oracle_step_id is None:
        return {**base, "status": "not_tested", "reason": "unattributed_replay_failure"}
    ordered_steps = [step["stepId"] for step in segment["case"]["operationLog"]["steps"]]
    if failed_step_id not in ordered_steps or oracle_step_id not in ordered_steps:
        return {**base, "status": "not_tested", "reason": "unattributed_replay_failure"}
    failed_index = ordered_steps.index(failed_step_id)
    oracle_index = ordered_steps.index(oracle_step_id)
    if failed_index == oracle_index:
        return {**base, "status": "failed", "reason": "oracle_mismatch"}
    if failed_index > oracle_index:
        return {**base, "status": "passed", "reason": "compiled_oracle_passed"}
    return {**base, "status": "not_tested", "reason": "checkpoint_not_reached"}


def execute_verification_plan(
    plan: Any,
    adapter: Any,
    decisions: Optional[Mapping[str, Any]] = None,
    now_ms: Optional[int] = None,
) -> Dict[str, Any]:
    """通过适配器执行已编译路由，并保留确定性结论的判定权。"""

    validate_verification_plan(plan)
    source = copy.deepcopy(plan)
    decision_manifest = {} if decisions is None else _mapping(decisions, "agent decisions")
    started_at = int(time.time() * 1000) if now_ms is None else now_ms
    evidence: List[Dict[str, Any]] = []
    evidence_by_id: Dict[str, Dict[str, Any]] = {}

    def register(raw_items: Any) -> List[str]:
        items = raw_items if isinstance(raw_items, list) else []
        refs: List[str] = []
        for raw in items:
            entry = _evidence_entry(raw)
            evidence_by_id.setdefault(entry["id"], entry)
            refs.append(entry["id"])
        return refs

    def engine_evidence(event_type: str, content: Mapping[str, Any]) -> List[str]:
        return register([{"type": event_type, "content": copy.deepcopy(content)}])

    scenario_results: List[Dict[str, Any]] = []
    status_by_scenario: Dict[str, str] = {}
    scenario_by_id = {item["id"]: item for item in source["intent"]["scenarios"]}

    for scenario_id in source["intent"]["executionOrder"]:
        scenario = scenario_by_id[scenario_id]
        checkpoint_results: Dict[str, Dict[str, Any]] = {}
        segment_reports: List[Dict[str, Any]] = []
        failed_dependencies = [
            dependency
            for dependency in scenario["dependsOn"]
            if status_by_scenario.get(dependency) != "passed"
        ]
        if failed_dependencies:
            refs = engine_evidence(
                "dependency_result",
                {"scenarioId": scenario_id, "dependencies": failed_dependencies},
            )
            for checkpoint in scenario["checkpoints"]:
                checkpoint_results[checkpoint["id"]] = {
                    "checkpointId": checkpoint["id"],
                    "acceptanceCriteria": copy.deepcopy(checkpoint["acceptanceCriteria"]),
                    "oracle": copy.deepcopy(checkpoint["oracle"]),
                    "status": "not_tested",
                    "reason": "dependency_not_passed",
                    "evidenceRefs": refs,
                }
            scenario_result = {
                "scenarioId": scenario_id,
                "route": scenario["route"],
                "status": "not_tested",
                "failure": {
                    "category": "dependency_not_passed",
                    "dependencies": failed_dependencies,
                },
                "segments": [],
                "preconditions": {"status": "not_tested", "evidenceRefs": refs},
                "checkpoints": list(checkpoint_results.values()),
                "cleanup": {"status": "not_required", "evidenceRefs": []},
            }
            scenario_results.append(scenario_result)
            status_by_scenario[scenario_id] = "not_tested"
            continue

        precondition_segments = [item for item in scenario["segments"] if item["phase"] == "precondition"]
        test_segments = [item for item in scenario["segments"] if item["phase"] == "test"]
        cleanup_segments = [item for item in scenario["segments"] if item["phase"] == "cleanup"]
        precondition_status = "passed"
        precondition_refs: List[str] = []
        test_started = False
        execution_failure_reason: Optional[str] = None

        for segment in precondition_segments:
            try:
                result = adapter.execute(segment, scenario, [])
            except Exception as exc:
                result = {"state": "not_tested", "reason": "adapter_error", "error": str(exc)}
            refs = register(result.get("evidence"))
            if not refs:
                refs = engine_evidence(
                    "missing_evidence", {"segmentId": segment["segmentId"], "phase": "precondition"}
                )
                result["state"] = "not_tested"
            precondition_refs.extend(refs)
            segment_reports.append(
                {
                    "segmentId": segment["segmentId"],
                    "phase": "precondition",
                    "route": "deterministic",
                    "state": result.get("state", "not_tested"),
                    "evidenceRefs": refs,
                }
            )
            if result.get("state") != "passed":
                precondition_status = "not_tested"
                execution_failure_reason = "precondition_failed"
                break

        if precondition_status == "passed":
            for segment in test_segments:
                test_started = True
                dynamic_step = segment.get("dynamicStep", {})
                scenario_decisions = decision_manifest.get(scenario_id, {})
                if not isinstance(scenario_decisions, dict):
                    raise VerificationError(
                        "invalid_decisions", "场景决策清单必须是对象",
                        scenarioId=scenario_id
                    )
                segment_decisions = scenario_decisions.get(dynamic_step.get("id"), [])
                if segment["route"] == "dynamic" and not isinstance(segment_decisions, list):
                    raise VerificationError(
                        "invalid_decisions", "动态步骤决策必须是列表",
                        scenarioId=scenario_id, stepId=dynamic_step.get("id")
                    )
                try:
                    result = adapter.execute(segment, scenario, segment_decisions)
                except Exception as exc:
                    result = {"state": "not_tested", "reason": "adapter_error", "error": str(exc)}
                refs = register(result.get("evidence"))
                if not refs:
                    refs = engine_evidence(
                        "missing_evidence", {"segmentId": segment["segmentId"], "phase": "test"}
                    )
                    result["state"] = "not_tested"
                segment_reports.append(
                    {
                        "segmentId": segment["segmentId"],
                        "phase": "test",
                        "route": segment["route"],
                        "state": result.get("state", "not_tested"),
                        "agentDone": bool(result.get("agentDone")),
                        "reason": result.get("reason"),
                        "evidenceRefs": refs,
                    }
                )
                for checkpoint_id in segment["checkpointIds"]:
                    checkpoint = next(
                        item for item in scenario["checkpoints"] if item["id"] == checkpoint_id
                    )
                    checkpoint_results[checkpoint_id] = _checkpoint_result(
                        checkpoint, segment, result, refs
                    )
                if result.get("state") not in {"passed", "done"}:
                    execution_failure_reason = result.get("reason", "execution_failed_before_checkpoint")
                    break

        for checkpoint in scenario["checkpoints"]:
            if checkpoint["id"] not in checkpoint_results:
                refs = engine_evidence(
                    "checkpoint_unreached",
                    {
                        "scenarioId": scenario_id,
                        "checkpointId": checkpoint["id"],
                        "reason": execution_failure_reason or "checkpoint_not_reached",
                    },
                )
                checkpoint_results[checkpoint["id"]] = {
                    "checkpointId": checkpoint["id"],
                    "acceptanceCriteria": copy.deepcopy(checkpoint["acceptanceCriteria"]),
                    "oracle": copy.deepcopy(checkpoint["oracle"]),
                    "status": "not_tested",
                    "reason": execution_failure_reason or "checkpoint_not_reached",
                    "evidenceRefs": refs,
                }

        cleanup_status = "not_required" if not cleanup_segments else "passed"
        cleanup_refs: List[str] = []
        if cleanup_segments and (test_started or precondition_segments):
            for segment in cleanup_segments:
                try:
                    result = adapter.execute(segment, scenario, [])
                except Exception as exc:
                    result = {"state": "failed", "reason": "adapter_error", "error": str(exc)}
                refs = register(result.get("evidence"))
                if not refs:
                    refs = engine_evidence(
                        "missing_evidence", {"segmentId": segment["segmentId"], "phase": "cleanup"}
                    )
                    result["state"] = "failed"
                cleanup_refs.extend(refs)
                state = result.get("state")
                segment_reports.append(
                    {
                        "segmentId": segment["segmentId"],
                        "phase": "cleanup",
                        "route": "deterministic",
                        "state": state,
                        "evidenceRefs": refs,
                    }
                )
                if state != "passed":
                    cleanup_status = "failed"
        elif cleanup_segments:
            cleanup_status = "not_required"

        ordered_checkpoint_results = [
            checkpoint_results[item["id"]] for item in scenario["checkpoints"]
        ]
        failed_checkpoints = [
            item for item in ordered_checkpoint_results if item["status"] == "failed"
        ]
        untested_checkpoints = [
            item for item in ordered_checkpoint_results if item["status"] == "not_tested"
        ]
        if cleanup_status == "failed":
            scenario_status = "failed"
            failure = {"category": "cleanup_failure"}
        elif failed_checkpoints:
            scenario_status = "failed"
            failure = {
                "category": "oracle_mismatch",
                "checkpointId": failed_checkpoints[0]["checkpointId"],
            }
        elif untested_checkpoints:
            scenario_status = "not_tested"
            first_reason = untested_checkpoints[0].get("reason", "checkpoint_not_reached")
            category = (
                first_reason
                if first_reason in {"dependency_not_passed", "precondition_failed", "checkpoint_not_reached"}
                else "checkpoint_not_reached"
            )
            failure = {
                "category": category,
                "checkpointId": untested_checkpoints[0]["checkpointId"],
                "reason": first_reason,
            }
        else:
            scenario_status = "passed"
            failure = None
        scenario_result = {
            "scenarioId": scenario_id,
            "route": scenario["route"],
            "status": scenario_status,
            "failure": failure,
            "segments": segment_reports,
            "preconditions": {
                "status": precondition_status if precondition_segments else "not_required",
                "evidenceRefs": precondition_refs,
            },
            "checkpoints": ordered_checkpoint_results,
            "cleanup": {"status": cleanup_status, "evidenceRefs": cleanup_refs},
        }
        scenario_results.append(scenario_result)
        status_by_scenario[scenario_id] = scenario_status

    acceptance_results: List[Dict[str, Any]] = []
    for acceptance_criterion in source["intent"]["requirement"]["acceptanceCriteria"]:
        checkpoint_refs = []
        statuses = []
        for scenario_result in scenario_results:
            for checkpoint in scenario_result["checkpoints"]:
                if acceptance_criterion["id"] in checkpoint["acceptanceCriteria"]:
                    checkpoint_refs.append(
                        "%s/%s" % (scenario_result["scenarioId"], checkpoint["checkpointId"])
                    )
                    statuses.append(checkpoint["status"])
        status = "failed" if "failed" in statuses else "not_tested" if "not_tested" in statuses else "passed"
        acceptance_results.append(
            {
                "acceptanceCriterionId": acceptance_criterion["id"],
                "status": status,
                "checkpointRefs": checkpoint_refs,
            }
        )

    overall = (
        "failed"
        if any(item["status"] == "failed" for item in scenario_results)
        else "not_tested"
        if any(item["status"] == "not_tested" for item in scenario_results)
        else "passed"
    )
    evidence.extend(evidence_by_id.values())
    outcome_contract = {
        "planFingerprint": source["planFingerprint"],
        "status": overall,
        "scenarios": [
            {
                "scenarioId": item["scenarioId"],
                "status": item["status"],
                "failureCategory": item["failure"]["category"] if item["failure"] else None,
                "checkpoints": [
                    {"checkpointId": cp["checkpointId"], "status": cp["status"], "reason": cp["reason"]}
                    for cp in item["checkpoints"]
                ],
                "cleanup": item["cleanup"]["status"],
            }
            for item in scenario_results
        ],
    }
    finished_at = int(time.time() * 1000) if now_ms is None else now_ms
    return {
        "schemaVersion": REPORT_SCHEMA,
        "reportId": "verification-run-%s" % uuid.uuid4().hex,
        "requirementId": source["intent"]["requirement"]["id"],
        "planFingerprint": source["planFingerprint"],
        "outcomeFingerprint": canonical_fingerprint(outcome_contract),
        "status": overall,
        "startedAt": started_at,
        "finishedAt": finished_at,
        "acceptanceCriteria": acceptance_results,
        "scenarios": scenario_results,
        "evidence": evidence,
    }


__all__ = [
    "VerificationError",
    "build_goal_tree",
    "canonical_fingerprint",
    "compile_verification_plan",
    "execute_verification_plan",
    "normalize_requirement",
    "validate_verification_plan",
]
