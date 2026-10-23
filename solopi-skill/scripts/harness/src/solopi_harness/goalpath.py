"""Goal-driven, bounded choices over a current Android observation.

All backends receive the same generic candidates. Models select an index, never
invent an action, node or input. Stopping exploration does not pass an oracle.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
import time
from typing import Any, Callable, Dict, Mapping, Optional

try:
    from .model_deployment import DecisionProvider, ModelDeploymentError
    from .fastpath import _nodes, _matches, _text, _probability, normalize_laya_response, LoopbackLayaPredictor
except ImportError:
    from model_deployment import DecisionProvider, ModelDeploymentError
    from fastpath import _nodes, _matches, _text, _probability, normalize_laya_response, LoopbackLayaPredictor


POLICY_SCHEMA = "solopi.ai.goalpath-policy/v1"
PROMPT_TEMPLATE_VERSION = "goalpath-choice-v3-page-text"
ACTIONS = {"click", "input", "scroll", "back", "wait"}
SELECTOR_FIELDS = {"resourceId", "text", "description", "contentDescription", "className", "packageName"}
CONDITION_FIELDS = SELECTOR_FIELDS | {"value", "selected", "isSelected", "checked", "isChecked"}
STEP_FIELDS = {"instructions", "stopWhen", "readyWhen", "inputData", "maxCandidates",
               "minProbability", "minMargin", "minCompletedActions", "denyLabels", "rules"}
MAX_REQUEST_BYTES = 128 * 1024
MAX_HISTORY = 8
MAX_PAGE_TEXT_ITEMS = 64
MAX_PAGE_TEXT_CHARS = 128


class LayaCapacityError(ValueError):
    """A checked request would lose semantic tokens in the Laya formatter."""

    def __init__(self, metadata):
        super().__init__("Laya request exceeds its verified token budget")
        self.metadata = metadata


def _invalid() -> ModelDeploymentError:
    return ModelDeploymentError("invalid_goalpath_policy", "GoalPath policy or provider configuration is invalid")


def _integer(value: Any, low: int, high: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and low <= value <= high


def _selector(value: Any, package: str) -> None:
    if (not isinstance(value, dict) or not value or set(value) - SELECTOR_FIELDS
            or any(not _text(v, 2048) for v in value.values())
            or value.get("packageName", package) != package):
        raise _invalid()


def _condition(value: Any, package: str, depth: int = 0) -> None:
    if not isinstance(value, dict) or depth > 4:
        raise _invalid()
    if set(value) in ({"all"}, {"any"}):
        items = next(iter(value.values()))
        if not isinstance(items, list) or not 1 <= len(items) <= 8:
            raise _invalid()
        for item in items:
            _condition(item, package, depth + 1)
        return
    if (set(value) != {"selector", "field", "equals"}
            or not isinstance(value["field"], str) or value["field"] not in CONDITION_FIELDS
            or not isinstance(value["equals"], (str, bool))
            or isinstance(value["equals"], str) and len(value["equals"]) > 2048):
        raise _invalid()
    _selector(value["selector"], package)


def validate_policy(policy: Any) -> Dict[str, Any]:
    """Freeze bounds, inputs and completion conditions, never model answers.

    denyLabels is an additional exact-label exclusion, not a business-risk
    classifier. readyWhen should bound permitted pages for sensitive apps.
    """
    if (not isinstance(policy, dict) or set(policy) != {"schemaVersion", "targetPackage", "steps"}
            or policy.get("schemaVersion") != POLICY_SCHEMA
            or not _text(policy.get("targetPackage"), 255)
            or re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+", policy["targetPackage"]) is None
            or not isinstance(policy.get("steps"), dict) or not 1 <= len(policy["steps"]) <= 100):
        raise _invalid()
    package = policy["targetPackage"]
    for step_id, step in policy["steps"].items():
        if (not _text(step_id, 160) or not isinstance(step, dict) or set(step) - STEP_FIELDS
                or not _text(step.get("instructions"), 4096) or "stopWhen" not in step):
            raise _invalid()
        _condition(step["stopWhen"], package)
        if "readyWhen" in step:
            _condition(step["readyWhen"], package)
        data = step.get("inputData", {})
        if (not isinstance(data, dict) or len(data) > 8
                or any(not _text(k, 64) or not _text(v, 1024) for k, v in data.items())):
            raise _invalid()
        if (not _integer(step.get("maxCandidates", 24), 1, 64)
                or not _integer(step.get("minCompletedActions", 0), 0, 200)
                or any(not _probability(step[k]) for k in ("minProbability", "minMargin") if k in step)):
            raise _invalid()
        denied = step.get("denyLabels", [])
        if not isinstance(denied, list) or len(denied) > 100 or any(not _text(x, 512) for x in denied):
            raise _invalid()
        rules = step.get("rules", [])
        if not isinstance(rules, list) or len(rules) > 100:
            raise _invalid()
        for rule in rules:
            if (not isinstance(rule, dict) or set(rule) - {"when", "action", "selector", "ancestorSelector", "inputKey", "direction"}
                    or not isinstance(rule.get("action"), str) or rule["action"] not in ACTIONS):
                raise _invalid()
            if "when" in rule:
                _condition(rule["when"], package)
            action = rule["action"]
            if action in {"click", "input", "scroll"}:
                _selector(rule.get("selector"), package)
                if "ancestorSelector" in rule:
                    _selector(rule["ancestorSelector"], package)
            elif "selector" in rule:
                raise _invalid()
            elif "ancestorSelector" in rule:
                raise _invalid()
            if ((action == "input" and (not isinstance(rule.get("inputKey"), str) or rule["inputKey"] not in data))
                    or (action != "input" and "inputKey" in rule)
                    or (action == "scroll" and (not isinstance(rule.get("direction"), str) or rule["direction"] not in {"up", "down"}))
                    or (action != "scroll" and "direction" in rule)):
                raise _invalid()
    return copy.deepcopy(policy)


def _flag(node: Mapping[str, Any], key: str, alias: str) -> Any:
    return node.get(key, node.get(alias))


def _safe_text(value: Any, limit: int = 256) -> str:
    if not isinstance(value, str):
        return ""
    # Code security: bound page-derived strings; never copy arbitrary nested data.
    return " ".join("".join(c for c in value if ord(c) >= 32).split())[:limit]


def _own_label(node: Mapping[str, Any]) -> str:
    for key in ("description", "contentDescription", "text"):
        value = _safe_text(node.get(key))
        if value:
            return value
    return ""


def _bounds(node):
    bounds = node.get("nodeBound")
    if not isinstance(bounds, dict):
        return None
    values = [bounds.get(key) for key in ("left", "top", "right", "bottom")]
    if any(isinstance(value, bool) or not isinstance(value, (int, float))
           or not math.isfinite(value) or abs(value) > 1_000_000 for value in values):
        return None
    left, top, right, bottom = values
    return tuple(values) if left < right and top < bottom else None


def _in_viewport(node, viewport):
    bounds = _bounds(node)
    if bounds is None:
        return False
    left, top, right, bottom = bounds
    vl, vt, vr, vb = viewport
    # Code security: positive area alone does not mean a tap lies on screen.
    return (max(left, vl) < min(right, vr) and max(top, vt) < min(bottom, vb)
            and vl <= (left + right) / 2 < vr and vt <= (top + bottom) / 2 < vb)


def _eligible_path(node: Mapping[str, Any], parents: Mapping[int, Any], package: str, viewport=None) -> bool:
    current = node
    while current is not None:
        if (current.get("packageName", package) != package or current.get("visible") is False
                or current.get("isVisibleToUser") is False
                or _flag(current, "isEnabled", "enabled") is False
                or _flag(current, "isPassword", "password") is True):
            return False
        current = parents.get(id(current))
    return (node.get("packageName") == package and node.get("visible") is True
            and node.get("isVisibleToUser") is True and (viewport is None or _in_viewport(node, viewport)))


def _related_labels(node, parents, package, viewport):
    child_labels = []
    pending = [(child, 1) for child in node.get("children", [])]
    while pending:
        child, depth = pending.pop(0)
        if not _eligible_path(child, parents, package, viewport) or _flag(child, "isPassword", "password") is True:
            continue
        # A separate interactive descendant owns its own label and candidate.
        if _flag(child, "isClickable", "clickable") is True or child.get("isEditable") is True:
            continue
        label = _own_label(child)
        if label and label not in child_labels and len(child_labels) < 3:
            child_labels.append(label)
        if depth < 2:
            pending.extend((grandchild, depth + 1) for grandchild in child.get("children", []))
    parent_labels = []
    parent = parents.get(id(node))
    for _ in range(2):
        if parent is None or parent.get("packageName", package) != package:
            break
        label = _own_label(parent)
        if label and _flag(parent, "isPassword", "password") is not True:
            parent_labels.append(label)
        parent = parents.get(id(parent))
    return child_labels, parent_labels


def _role(node):
    class_name = _safe_text(node.get("className"), 120).rsplit(".", 1)[-1]
    if node.get("isEditable") is True:
        return "textbox"
    if _flag(node, "isScrollable", "scrollable") is True:
        return "scrollable"
    if class_name:
        return class_name
    return "button" if _flag(node, "isClickable", "clickable") is True else "node"


def _condition_matches(condition, nodes, parents, package):
    if "all" in condition:
        return all(_condition_matches(x, nodes, parents, package) for x in condition["all"])
    if "any" in condition:
        return any(_condition_matches(x, nodes, parents, package) for x in condition["any"])
    matches = [node for node in nodes if _matches(node, condition["selector"])
               and node.get("packageName") == package and node.get("visible") is True
               and node.get("isVisibleToUser") is True and _in_viewport(node, _bounds(nodes[0]))
               and not any(parent.get("visible") is False or parent.get("packageName", package) != package
                           or parent.get("isVisibleToUser") is False
                           for parent in _ancestors(node, parents))]
    # Assertions may read disabled nodes; hidden or ambiguous matches never end work.
    return (len(matches) == 1 and type(matches[0].get(condition["field"])) is type(condition["equals"])
            and matches[0].get(condition["field"]) == condition["equals"])


def _ancestors(node, parents):
    parent = parents.get(id(node))
    while parent is not None:
        yield parent
        parent = parents.get(id(parent))


def _page_text(nodes, parents, package):
    """Bounded visible text in tree order, independent of the task or backend.

    Noninteractive and disabled text may explain loading or errors. It must not
    inherit the actionable-node requirement that would hide those status nodes.
    """
    result, seen, truncated = [], set(), False
    viewport = _bounds(nodes[0])
    for node in nodes:
        if (node.get("packageName") != package or node.get("visible") is not True
                or node.get("isVisibleToUser") is not True or not _in_viewport(node, viewport)
                or _flag(node, "isPassword", "password") is not False):
            continue
        # Code security: exclude password subtrees and unknown editable ancestors;
        # never infer that a text-bearing node is safe merely from its class name.
        if any(parent.get("packageName", package) != package or parent.get("visible") is False
               or parent.get("isVisibleToUser") is False
               or _flag(parent, "isPassword", "password") is True
               or parent.get("isEditable") is True and _flag(parent, "isPassword", "password") is not False
               for parent in _ancestors(node, parents)):
            continue
        for field in ("text", "description", "contentDescription"):
            value = _safe_text(node.get(field), MAX_PAGE_TEXT_CHARS + 1)
            if not value:
                continue
            if len(value) > MAX_PAGE_TEXT_CHARS:
                truncated = True
                value = value[:MAX_PAGE_TEXT_CHARS]
            if value in seen:
                continue
            seen.add(value)
            if len(result) == MAX_PAGE_TEXT_ITEMS:
                truncated = True
            else:
                result.append(value)
    return result, truncated


def _history(raw):
    if not isinstance(raw, list) or len(raw) > 200:
        raise ValueError("Invalid history")
    result = []
    for item in raw:
        if not isinstance(item, dict) or not isinstance(item.get("action"), dict):
            raise ValueError("Invalid history")
        action = item["action"]
        if (not isinstance(action.get("type"), str) or action["type"] not in ACTIONS
                or not isinstance(item.get("status"), str) or item["status"] not in {"succeeded", "rejected", "failed"}):
            raise ValueError("Invalid history")
        entry = {"action": action["type"], "status": item["status"]}
        effect = item.get("effect")
        if effect is not None:
            if not isinstance(effect, str) or effect not in {"UI_CHANGED", "NO_VISIBLE_CHANGE"} or item["status"] != "succeeded":
                raise ValueError("Invalid history effect")
            entry["effect"] = effect
        for key in ("label", "inputKey", "errorCode"):
            if item.get(key) is not None:
                if not _text(item[key], 256):
                    raise ValueError("Invalid history")
                entry[key] = item[key]
        if (action.get("type") == "scroll" and isinstance(action.get("direction"), str)
                and action["direction"] in {"up", "down"}):
            entry["direction"] = action["direction"]
        result.append(entry)
    return result[-MAX_HISTORY:]


def _candidates(nodes, parents, package, step, allowed):
    result = {}
    node_map = {}
    denied = {label.casefold() for label in step.get("denyLabels", [])}
    ids = set()
    viewport = _bounds(nodes[0])
    if viewport is None:
        raise ValueError("viewport_bounds_unavailable")
    for node in nodes:
        node_id = node.get("nodeId")
        if node_id is not None:
            if not _text(node_id, 160) or node_id in ids:
                raise ValueError("ambiguous_node_id")
            ids.add(node_id)

    def add(features, action, node=None):
        choice = "candidate_%d" % len(result)
        result[choice] = {**features, "action": action}
        if node is not None:
            result[choice]["nodeId"] = node["nodeId"]
            node_map[choice] = node

    for node in nodes:
        if (not _eligible_path(node, parents, package, viewport) or not _text(node.get("nodeId"), 160)
                or _flag(node, "isEnabled", "enabled") is not True
                or _flag(node, "isPassword", "password") is True):
            continue
        if ("input" in allowed and step.get("inputData") and node.get("isEditable") is True
                and _flag(node, "isPassword", "password") is not False):
            # Code security: older device trees omit the password property. Unknown
            # is not false; do not send even frozen text to an unclassified field.
            raise ValueError("input_password_state_unavailable")
        child_labels, parent_labels = _related_labels(node, parents, package, viewport)
        label = _own_label(node) or _safe_text(" / ".join(child_labels))
        if not label:
            if node.get("isEditable") is True:
                label = "Editable field"
            elif _flag(node, "isScrollable", "scrollable") is True:
                label = "Scrollable region"
            else:
                continue
        if any(text.casefold() in denied for text in [label] + child_labels + parent_labels):
            continue
        features = {"label": label, "role": _role(node), "value": _safe_text(node.get("text")),
                    "selected": _flag(node, "isSelected", "selected") if isinstance(_flag(node, "isSelected", "selected"), bool) else None,
                    "checked": _flag(node, "isChecked", "checked") if isinstance(_flag(node, "isChecked", "checked"), bool) else None,
                    "children": child_labels, "parents": parent_labels}
        if "click" in allowed and _flag(node, "isClickable", "clickable") is True:
            add(features, {"type": "click", "nodeId": node["nodeId"]}, node)
        if ("input" in allowed and node.get("isEditable") is True
                and _flag(node, "isPassword", "password") is False):
            for key, value in step.get("inputData", {}).items():
                add({**features, "inputKey": key, "inputValue": value},
                    {"type": "input", "nodeId": node["nodeId"], "text": value}, node)
        if "scroll" in allowed and _flag(node, "isScrollable", "scrollable") is True:
            for direction in ("up", "down"):
                add({**features, "direction": direction},
                    {"type": "scroll", "nodeId": node["nodeId"], "direction": direction, "distance": 60}, node)
    if "back" in allowed:
        add({"label": "返回上一页 / Back", "role": "navigation"}, {"type": "back"})
    if "wait" in allowed:
        add({"label": "等待页面加载 / Wait", "role": "synchronization"}, {"type": "wait", "durationMs": 500})
    if len(result) > step.get("maxCandidates", 24):
        raise ValueError("too_many_candidates")
    return result, node_map


def _public_candidates(candidates):
    # Code security: models get semantic data and an index, not executable params,
    # node IDs, resource IDs, coordinates, session tokens, or full observations.
    result = {}
    for key, item in candidates.items():
        semantic = {"label": item["label"], "operation": item["action"]["type"]}
        for field in ("role", "value", "selected", "checked", "parents", "children", "inputKey", "inputValue", "direction"):
            value = item.get(field)
            if value is None or value == "" or value == []:
                continue
            if field == "value" and value == item["label"]:
                continue
            if field in {"parents", "children"}:
                value = list(dict.fromkeys(v for v in value if v != item["label"]))
                if not value:
                    continue
            semantic[field] = value
        result[key] = semantic
    return result


def compact_candidate(candidate):
    """Label/action first, with all nonempty canonical semantics preserved.

    Unlike alphabetically sorted JSON, a short Laya option budget cannot retain
    only a common checked/children prefix. The checked MLX adapter rejects any
    remaining truncation rather than quietly discarding trailing context.
    """
    parts = [candidate["label"], candidate["operation"]]
    for field in ("role", "value", "selected", "checked", "parents", "children", "inputKey", "inputValue", "direction"):
        if field not in candidate:
            continue
        value = candidate[field]
        if isinstance(value, list):
            value = "/".join(value)
        elif isinstance(value, bool):
            value = "true" if value else "false"
        parts.append("%s=%s" % (field, value))
    return " | ".join(parts)


def _rules_choice(request, step, candidates, node_map, nodes, parents, package):
    rules = step.get("rules", [])
    for rule in rules:
        if "when" in rule and not _condition_matches(rule["when"], nodes, parents, package):
            continue
        targets = set()
        if "selector" in rule:
            for source in nodes:
                if not _matches(source, rule["selector"]) or not _eligible_path(source, parents, package, _bounds(nodes[0])):
                    continue
                if ("ancestorSelector" in rule
                        and not any(_matches(parent, rule["ancestorSelector"]) for parent in _ancestors(source, parents))):
                    continue
                target = source
                if rule["action"] == "click":
                    # Code security: stable child IDs may identify a clickable
                    # parent. Stay on this exact observation's nearest eligible path.
                    while target is not None and _flag(target, "isClickable", "clickable") is False:
                        target = parents.get(id(target))
                    if target is None or _flag(target, "isClickable", "clickable") is not True:
                        continue
                if _text(target.get("nodeId"), 160):
                    targets.add(target["nodeId"])
        matches = [key for key, item in candidates.items() if item["action"]["type"] == rule["action"]
                   and ("selector" not in rule or key in node_map and node_map[key]["nodeId"] in targets)
                   and ("inputKey" not in rule or item.get("inputKey") == rule["inputKey"])
                   and ("direction" not in rule or item.get("direction") == rule["direction"])]
        if matches:
            return matches[0] if len(matches) == 1 else "abstain"
    if rules:
        return "abstain"
    # This is deliberately labelled a lexical baseline, not an ID-rule benchmark.
    goal = request["goal"].casefold()
    matches = [key for key, item in candidates.items() if item["action"]["type"] == "click"
               and item["label"].casefold() in goal and item["label"].strip()]
    if len(matches) == 1:
        return matches[0]
    return "abstain"


class GoalPathDecisionProvider(DecisionProvider):
    """A state-free provider: history contains actual receipts, never guesses.

    Probability/margin gates are routing policies, not calibrated correctness.
    Rules selectors are private to the rules backend; they never prune candidates
    or enter model requests. The CLI/device still enforce leases and run budgets.
    """

    def __init__(self, policy: Mapping[str, Any], *, mode: str = "rules",
                 laya_predictor: Optional[Callable] = None, llm_predictor: Optional[Callable] = None,
                 model: str = "laya-multilingual", model_version: str = "unversioned") -> None:
        self._policy = validate_policy(policy)
        if (not isinstance(mode, str) or mode not in {"rules", "laya", "llm", "hybrid"} or not _text(model, 160)
                or not _text(model_version, 160)
                or mode in {"laya", "hybrid"} and not callable(laya_predictor)
                or mode in {"llm", "hybrid"} and not callable(llm_predictor)
                or mode in {"rules", "llm"} and laya_predictor is not None
                or mode in {"rules", "laya"} and llm_predictor is not None):
            raise _invalid()
        self.mode, self.model, self.model_version = mode, model, model_version
        self.laya_predictor, self.llm_predictor = laya_predictor, llm_predictor
        self.llm_model = getattr(llm_predictor, "model", "injected-llm")
        if not _text(self.llm_model, 160):
            raise _invalid()
        self.policy_digest = hashlib.sha256(json.dumps(self._policy, ensure_ascii=False, sort_keys=True,
                                                    separators=(",", ":")).encode("utf-8")).hexdigest()
        self.runtime_metadata = {"provider": "goalpath", "mode": mode,
                                 "candidatePolicy": "generic-visible-actionable-v1",
                                 "promptTemplateVersion": PROMPT_TEMPLATE_VERSION,
                                 "pageTextPolicy": {"order": "observation-tree", "maxItems": MAX_PAGE_TEXT_ITEMS,
                                                    "maxCharsPerItem": MAX_PAGE_TEXT_CHARS,
                                                    "truncation": "explicit-flag", "passwordState": "explicit-false"},
                                 "probabilityInterpretation": "uncalibrated-routing-only",
                                 "requiredObservationFields": {"visibility": "isVisibleToUser:boolean",
                                     "viewport": "page.nodeBound and target.nodeBound; target center inside viewport",
                                     "input": "isEditable:true and isPassword:false"},
                                 "occlusionCheck": "not-inferred-from-visibility"}

    def policy_snapshot(self):
        return copy.deepcopy(self._policy)

    def decide(self, context: Mapping[str, Any]) -> Dict[str, Any]:
        started = time.perf_counter()
        receipt = {"provider": "goalpath", "mode": self.mode,
                   "model": self.llm_model if self.mode == "llm" else self.model if self.mode != "rules" else None,
                   "modelVersion": self.model_version if self.mode in {"laya", "hybrid"} else None, "policyDigest": self.policy_digest,
                   "promptTemplateVersion": PROMPT_TEMPLATE_VERSION, "candidates": {},
                   "selectedChoice": None, "attempts": [], "fallbackUsed": False,
                   "probabilityInterpretation": "uncalibrated-routing-only"}

        def finish(kind, reason, action=None):
            receipt["reason"] = reason
            receipt["elapsedMs"] = round((time.perf_counter() - started) * 1000, 3)
            result = {"type": kind, "modelReceipt": receipt}
            result["action" if kind == "act" else "reason"] = copy.deepcopy(action) if kind == "act" else reason
            return result

        if not isinstance(context, dict):
            return finish("blocked", "invalid_context")
        step = self._policy["steps"].get(context.get("stepId")) if isinstance(context.get("stepId"), str) else None
        if step is None:
            return finish("blocked", "unknown_step")
        observation = context.get("observation")
        if (not isinstance(observation, dict) or not _text(observation.get("observationId"), 160)
                or not isinstance(observation.get("page"), dict)):
            return finish("blocked", "invalid_observation")
        receipt["observationId"] = observation["observationId"]
        package = self._policy["targetPackage"]
        if observation["page"].get("packageName") != package:
            return finish("blocked", "target_package_mismatch")
        if not _text(context.get("goal"), 4096):
            return finish("blocked", "invalid_goal")
        allowed = context.get("allowedActions")
        if (not isinstance(allowed, list) or not allowed or len(allowed) > 8
                or any(not isinstance(x, str) or x not in ACTIONS for x in allowed)):
            return finish("blocked", "action_not_allowed")
        parents = {}
        try:
            nodes = _nodes(observation["page"], parents)
            raw_history = context.get("history", [])
            history = _history(raw_history)
        except ValueError:
            return finish("blocked", "invalid_observation_or_history")
        if any(not isinstance(node.get("isVisibleToUser"), bool) for node in nodes
               if node.get("packageName") == package):
            return finish("blocked", "visibility_metadata_unavailable")
        if observation["page"].get("isVisibleToUser") is not True:
            return finish("blocked", "page_not_visible")
        viewport = _bounds(observation["page"])
        if (viewport is None or viewport[0] < 0 or viewport[1] < 0
                or viewport[2] > 16384 or viewport[3] > 16384):
            return finish("blocked", "viewport_bounds_unavailable")
        history_successes = sum(item["status"] == "succeeded" for item in raw_history)
        completed_count = context.get("completedActionCount", history_successes)
        if not _integer(completed_count, history_successes, 200):
            return finish("blocked", "invalid_completed_action_count")
        receipt["completedActionCount"] = completed_count
        if (completed_count >= step.get("minCompletedActions", 0)
                and _condition_matches(step["stopWhen"], nodes, parents, package)):
            return finish("done", "stop_condition_observed")
        if "readyWhen" in step and not _condition_matches(step["readyWhen"], nodes, parents, package):
            return finish("blocked", "page_not_ready")
        try:
            candidates, node_map = _candidates(nodes, parents, package, step, set(allowed))
        except ValueError as exc:
            return finish("blocked", str(exc))  # Only local, fixed reason codes.
        receipt["candidates"] = copy.deepcopy(candidates)
        if not candidates:
            return finish("blocked", "no_candidates")
        page_text, page_text_truncated = _page_text(nodes, parents, package)
        request = {"schemaVersion": "solopi.ai.goalpath-choice/v1", "goal": context["goal"],
                   "instructions": step["instructions"], "history": history,
                   "pageText": page_text, "pageTextTruncated": page_text_truncated,
                   "candidates": _public_candidates(candidates)}
        serialized = json.dumps(request, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))
        if len(serialized.encode("utf-8")) > MAX_REQUEST_BYTES:
            return finish("blocked", "request_too_large")
        receipt["requestDigest"] = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
        receipt["historyLength"] = len(history)
        receipt["pageTextSummary"] = {"count": len(page_text), "truncated": page_text_truncated}
        if self.mode == "rules":
            selected = _rules_choice(request, step, candidates, node_map, nodes, parents, package)
            receipt["rulesBaseline"] = "configured-selectors" if step.get("rules") else "goal-label-exact-substring"
            receipt["selectedChoice"] = selected
            if selected == "abstain":
                return finish("blocked", "rules_no_unique_match")
            return finish("act", "rules_choice", candidates[selected]["action"])

        if self.mode in {"laya", "hybrid"}:
            selected, reason, details = self._laya(request, step)
            receipt["attempts"].append(details)
            receipt["probabilities"] = details.get("probabilities")
            if selected is not None:
                receipt["selectedChoice"] = selected
                receipt["selectedBackend"] = "laya"
                return finish("act", "model_choice", candidates[selected]["action"])
            if self.mode == "laya":
                return finish("blocked", reason)
            receipt["fallbackUsed"] = True
            receipt["fallbackReason"] = reason
        attempt_start = time.perf_counter()
        try:
            answer = self.llm_predictor(copy.deepcopy(request))
            if (not isinstance(answer, dict) or set(answer) != {"choice"}
                    or not isinstance(answer["choice"], str)
                    or answer["choice"] not in set(candidates) | {"abstain"}):
                reason, selected = "invalid_llm_response", None
            elif answer["choice"] == "abstain":
                reason, selected = "llm_abstained", None
            else:
                reason, selected = "model_choice", answer["choice"]
        except Exception:
            # Code security: suppress URLs, paths, credentials and remote bodies.
            reason, selected = "llm_unavailable", None
        attempt = {"backend": "llm", "model": self.llm_model, "reason": reason,
                   "elapsedMs": round((time.perf_counter() - attempt_start) * 1000, 3)}
        runtime = getattr(self.llm_predictor, "last_metadata", None)
        if isinstance(runtime, dict):
            # Code security: allowlisted diagnostic scalars only, never raw replies.
            for key in ("requestedModel", "reportedModel"):
                if _text(runtime.get(key), 160):
                    attempt[key] = runtime[key]
            usage = runtime.get("usage")
            if isinstance(usage, dict):
                attempt["usage"] = {k: usage[k] for k in ("prompt_tokens", "completion_tokens", "total_tokens")
                                    if isinstance(usage.get(k), int) and not isinstance(usage[k], bool)
                                    and 0 <= usage[k] <= 100_000_000}
        receipt["attempts"].append(attempt)
        receipt["selectedBackend"] = "llm"
        receipt["model"], receipt["modelVersion"] = self.llm_model, None
        receipt["selectedChoice"] = selected
        return finish("act", reason, candidates[selected]["action"]) if selected else finish("blocked", reason)

    def _laya(self, request, step):
        started = time.perf_counter()
        if isinstance(self.laya_predictor, LoopbackLayaPredictor):
            # The existing HTTP protocol does not advertise tokenizer/configuration
            # or truncation evidence. Do not silently accept an unverified budget.
            return None, "laya_capacity_unverified", {
                "backend": "laya", "model": self.model, "reason": "laya_capacity_unverified",
                "inferenceStatus": "not_called", "inferenceCalls": 0, "questionCount": 0,
                "capacity": {"verifiedNoTruncation": False}, "elapsedMs": 0.0}
        criteria = {key: compact_candidate(value) for key, value in request["candidates"].items()}
        criteria["abstain"] = "没有安全且符合目标的动作 / None is suitable or certain"
        state = json.dumps({key: request[key] for key in ("goal", "history", "pageText", "pageTextTruncated")},
                           ensure_ascii=False, separators=(",", ":"))
        payload = {"model": self.model, "state": state,
                   "questions": {"action": {"type": "choice", "instructions": request["instructions"], "criteria": criteria}}}
        details = {"backend": "laya", "model": self.model, "modelVersion": self.model_version,
                   "inferenceStatus": "not_called", "inferenceCalls": 0, "questionCount": 0,
                   "thresholds": {"minProbability": step.get("minProbability", 0),
                                                      "minMargin": step.get("minMargin", 0)}}
        choice, reason = None, "laya_unavailable"
        try:
            details.update(inferenceStatus="failed", inferenceCalls=1, questionCount=1)
            raw_answer = self.laya_predictor(copy.deepcopy(payload))
            details["inferenceStatus"] = "completed"
            answer = normalize_laya_response(raw_answer)["answers"]["action"]
            selected, probabilities = answer["choice"], answer["probs"]
            if (not isinstance(selected, str) or selected not in criteria
                    or not isinstance(probabilities, dict) or set(probabilities) != set(criteria)
                    or any(not _probability(v) for v in probabilities.values())
                    or not math.isclose(sum(probabilities.values()), 1, rel_tol=0, abs_tol=len(criteria) * .00005 + 1e-9)
                    or "confidence" in answer and (not isinstance(answer["confidence"], (int, float))
                        or isinstance(answer["confidence"], bool) or not math.isfinite(answer["confidence"]))):
                reason = "invalid_laya_response"
            else:
                details["probabilities"] = copy.deepcopy(probabilities)
                score = probabilities[selected]
                margin = score - max(v for k, v in probabilities.items() if k != selected)
                details.update({"selectedChoice": selected, "selectedProbability": score, "margin": margin})
                if selected == "abstain":
                    reason = "laya_abstained"
                elif margin <= 0 or score < step.get("minProbability", 0) or margin < step.get("minMargin", 0):
                    reason = "uncertain_laya_choice"
                else:
                    choice, reason = selected, "model_choice"
        except LayaCapacityError:
            reason = "laya_token_budget_exceeded"
            details.update(inferenceStatus="not_called", inferenceCalls=0, questionCount=0)
        except ValueError:
            reason = "invalid_laya_response"
        except Exception:
            pass
        inference = getattr(self.laya_predictor, "last_inference", None)
        if (isinstance(inference, dict)
                and inference.get("inferenceStatus") in {"not_called", "completed", "failed"}
                and _integer(inference.get("inferenceCalls"), 0, 1)
                and _integer(inference.get("questionCount"), 0, 1)
                and (inference["inferenceStatus"] == "not_called") == (inference["inferenceCalls"] == 0)
                and inference["questionCount"] == inference["inferenceCalls"]):
            # Code security: copy only bounded counters/status, never runtime bodies.
            details.update({key: inference[key] for key in ("inferenceStatus", "inferenceCalls", "questionCount")})
        capacity = getattr(self.laya_predictor, "last_capacity", None)
        if isinstance(capacity, dict):
            details["capacity"] = {k: v for k, v in capacity.items()
                                   if k in {"headMaxLen", "maxLen", "optionCount", "maxOptionTokens", "optionTokens", "instructionTokens",
                                            "stateTokens", "sequenceTokens", "headRequiredTokens", "verifiedNoTruncation"}
                                   and (isinstance(v, bool) or _integer(v, 0, 1_000_000))}
        else:
            details["capacity"] = {"verifiedNoTruncation": False}
        details.update({"reason": reason, "elapsedMs": round((time.perf_counter() - started) * 1000, 3)})
        return choice, reason, details
