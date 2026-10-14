"""Bounded UI choice adapter: models select observed candidates, never actions."""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, Mapping, Optional

try:
    from .model_deployment import DecisionProvider, ModelDeploymentError
except ImportError:  # The source CLI also supports direct script execution.
    from model_deployment import DecisionProvider, ModelDeploymentError


POLICY_SCHEMA = "solopi.ai.fastpath-policy/v1"
PROMPT_TEMPLATE_VERSION = "compact-choice-v2"
MAX_GOAL_CHARS = 2048
MAX_RESPONSE_BYTES = 64 * 1024
MAX_REQUEST_BYTES = 64 * 1024
SELECTOR_FIELDS = {"resourceId", "text", "description", "contentDescription", "className", "packageName"}
STEP_FIELDS = {"instructions", "readyWhen", "stopWhen", "candidateSelectors", "candidateResolution", "exactText", "maxCandidates", "minProbability", "minMargin"}
ANCESTOR_RESOLUTION = "self-or-clickable-ancestor"


def _invalid() -> ModelDeploymentError:
    return ModelDeploymentError("invalid_fastpath_policy", "FastPath policy or provider configuration is invalid")


def _text(value: Any, maximum: int = 2048) -> bool:
    return isinstance(value, str) and 0 < len(value) <= maximum and not any(ord(c) < 32 for c in value)


def _probability(value: Any) -> bool:
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and 0 <= value <= 1 and math.isfinite(value))


def _validate_selector(selector: Any, package: str) -> None:
    if (not isinstance(selector, dict) or not selector or set(selector) - SELECTOR_FIELDS
            or any(not _text(value) for value in selector.values())
            or selector.get("packageName", package) != package):
        raise _invalid()


def _validate_condition(condition: Any, package: str) -> None:
    if (not isinstance(condition, dict) or set(condition) != {"selector", "field", "equals"}
            or not isinstance(condition.get("field"), str)
            or condition.get("field") not in {"text", "description", "contentDescription"}
            or not isinstance(condition.get("equals"), str)
            or len(condition["equals"]) > 2048):
        raise _invalid()
    _validate_selector(condition["selector"], package)


def validate_policy(policy: Any) -> Dict[str, Any]:
    """Validate local configuration and detach it from caller mutations."""
    if (not isinstance(policy, dict)
            or set(policy) != {"schemaVersion", "targetPackage", "steps"}
            or policy.get("schemaVersion") != POLICY_SCHEMA
            or not isinstance(policy.get("targetPackage"), str)
            or len(policy["targetPackage"]) > 255
            or re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+", policy["targetPackage"]) is None):
        raise _invalid()
    package = policy["targetPackage"]
    steps = policy["steps"]
    if not isinstance(steps, dict) or not 1 <= len(steps) <= 100:
        raise _invalid()
    for step_id, step in steps.items():
        if (not _text(step_id, 160) or not isinstance(step, dict)
                or set(step) - STEP_FIELDS or not _text(step.get("instructions"))
                or not {"stopWhen", "candidateSelectors"}.issubset(step)):
            raise _invalid()
        _validate_condition(step["stopWhen"], package)
        if "readyWhen" in step:
            _validate_condition(step["readyWhen"], package)
        selectors = step["candidateSelectors"]
        if not isinstance(selectors, list) or not 1 <= len(selectors) <= 8:
            raise _invalid()
        for selector in selectors:
            _validate_selector(selector, package)
        resolution = step.get("candidateResolution", "self")
        if not isinstance(resolution, str) or resolution not in {"self", ANCESTOR_RESOLUTION}:
            raise _invalid()
        maximum = step.get("maxCandidates", 8)
        if isinstance(maximum, bool) or not isinstance(maximum, int) or not 1 <= maximum <= 8:
            raise _invalid()
        if "exactText" in step and not _text(step["exactText"]):
            raise _invalid()
        if any(not _probability(step[key]) for key in ("minProbability", "minMargin") if key in step):
            raise _invalid()
    return copy.deepcopy(policy)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Code security: the explicitly configured loopback destination cannot redirect.
        raise urllib.error.URLError("FastPath redirects are disabled")


def _json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field")
        result[key] = value
    return result


def _reject_constant(value):
    raise ValueError("Non-finite JSON value")


def normalize_laya_response(response: Any) -> Dict[str, Any]:
    """Remove only documented non-action metadata from a Laya answer.

    Unknown fields remain invalid. Metadata can never introduce a node/action or
    override the locally configured model identity and current candidate map.
    """
    if (not isinstance(response, dict) or not {"answers"}.issubset(response)
            or set(response) - {"answers", "model", "usage", "routing"}
            or not isinstance(response["answers"], dict) or set(response["answers"]) != {"action"}):
        raise ValueError("Invalid Laya response")
    answer = response["answers"]["action"]
    if (not isinstance(answer, dict)
            or set(answer) - {"type", "choice", "probs", "probabilities", "confidence", "action"}
            or "choice" not in answer or ("probs" in answer) == ("probabilities" in answer)
            or ("type" in answer and answer["type"] != "choice")):
        raise ValueError("Invalid Laya answer")
    if "action" in answer:
        gate = answer["action"]
        if (not isinstance(gate, dict) or set(gate) != {"act_probability"}
                or not _probability(gate["act_probability"])):
            raise ValueError("Invalid Laya action metadata")
    # Laya's action gate is model metadata, not authority to execute a device action.
    normalized = {"choice": copy.deepcopy(answer["choice"]),
                  "probs": copy.deepcopy(answer.get("probabilities", answer.get("probs")))}
    if "confidence" in answer:
        normalized["confidence"] = copy.deepcopy(answer["confidence"])
    return {"answers": {"action": normalized}}


class LoopbackLayaPredictor:
    """Call a user-selected local inference endpoint; never starts a server."""

    def __init__(self, endpoint: str, timeout: float = 15.0) -> None:
        try:
            parsed = urllib.parse.urlsplit(endpoint)
            valid = (isinstance(endpoint, str) and not any(ord(c) <= 32 for c in endpoint)
                     and parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "::1"}
                     and parsed.username is None and parsed.password is None
                     and parsed.port is not None and 1 <= parsed.port <= 65535
                     and not parsed.query and not parsed.fragment)
        except (AttributeError, TypeError, ValueError):
            valid = False
        if (not valid or isinstance(timeout, bool) or not isinstance(timeout, (int, float))
                or not 0 < timeout <= 60 or not math.isfinite(timeout)):
            raise _invalid()
        self.endpoint = endpoint
        self.timeout = timeout
        # Code security: first implementation following SSRF guidance; literal loopback
        # IPs eliminate DNS rebinding, and proxies/redirects cannot escape the host.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())

    def __call__(self, request: Mapping[str, Any]) -> Dict[str, Any]:
        raw = json.dumps(request, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(raw) > MAX_REQUEST_BYTES:
            raise ValueError("FastPath request too large")
        message = urllib.request.Request(self.endpoint, data=raw,
                                         headers={"Content-Type": "application/json"}, method="POST")
        with self.opener.open(message, timeout=self.timeout) as response:
            if response.status != 200:
                raise ValueError("FastPath endpoint did not return success")
            raw_response = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw_response) > MAX_RESPONSE_BYTES:
            raise ValueError("FastPath response too large")
        # Code security: JSON only, with bounded bytes; no object deserialization.
        return normalize_laya_response(json.loads(raw_response.decode("utf-8"), object_pairs_hook=_json_object,
                                                  parse_constant=_reject_constant))


def _nodes(page: Mapping[str, Any], parents=None):
    pending = [(page, 0, None)]
    result = []
    identities = set()
    while pending:
        node, depth, parent = pending.pop()
        if not isinstance(node, dict) or id(node) in identities or depth > 64 or len(result) >= 2000:
            raise ValueError("Invalid observation tree")
        identities.add(id(node))
        result.append(node)
        if parents is not None:
            parents[id(node)] = parent
        children = node.get("children", [])
        if not isinstance(children, list) or len(children) > 2000:
            raise ValueError("Invalid observation tree")
        pending.extend((child, depth + 1, node) for child in reversed(children))
    return result


def _matches(node: Mapping[str, Any], selector: Mapping[str, Any]) -> bool:
    return all(node.get(key) == value for key, value in selector.items())


class FastPathDecisionProvider(DecisionProvider):
    """Frozen allowlist + observed UI candidates + an optional abstain choice.

    A stop condition only ends exploration. SoloPi's existing oracle retains the
    authority to mark the test passed or failed. The rules mode is an exact-text
    baseline; it never represents model inference.
    An abstain option does not guarantee rejection when no candidate matches.
    """

    def __init__(self, policy: Mapping[str, Any], *, mode: str = "laya",
                 predictor: Optional[Callable[[Mapping[str, Any]], Dict[str, Any]]] = None,
                 endpoint: Optional[str] = None, model: str = "multilingual",
                 model_version: str = "unversioned", timeout: float = 15.0) -> None:
        self._policy = validate_policy(policy)
        canonical_policy = json.dumps(self._policy, ensure_ascii=False, allow_nan=False,
                                      sort_keys=True, separators=(",", ":")).encode("utf-8")
        self.policy_digest = hashlib.sha256(canonical_policy).hexdigest()
        if (mode not in {"laya", "rules"} or not _text(model, 160) or not _text(model_version, 160)
                or (mode == "laya" and (predictor is None) == (endpoint is None))
                or (mode == "rules" and (predictor is not None or endpoint is not None))
                or (predictor is not None and not callable(predictor))):
            raise _invalid()
        self.mode = mode
        self.model = model
        self.model_version = model_version
        self.predictor = LoopbackLayaPredictor(endpoint, timeout) if endpoint is not None else predictor

    def policy_snapshot(self) -> Dict[str, Any]:
        return copy.deepcopy(self._policy)

    def decide(self, context: Mapping[str, Any]) -> Dict[str, Any]:
        started = time.perf_counter()
        receipt = {"provider": "fastpath", "mode": self.mode, "model": self.model if self.mode == "laya" else None,
                   "modelVersion": self.model_version if self.mode == "laya" else None,
                   "candidates": {}, "selectedChoice": None, "probabilities": None,
                   "policyDigest": self.policy_digest, "promptTemplateVersion": PROMPT_TEMPLATE_VERSION,
                   "fallbackUsed": False}

        def finish(kind, reason, action=None):
            receipt["reason"] = reason
            receipt["elapsedMs"] = round((time.perf_counter() - started) * 1000, 3)
            result = {"type": kind, "modelReceipt": receipt}
            if kind == "act":
                result["action"] = action
            else:
                result["reason"] = reason
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
        package = self._policy["targetPackage"]
        page = observation["page"]
        if page.get("packageName") != package:
            return finish("blocked", "target_package_mismatch")
        parents = {}
        try:
            nodes = _nodes(page, parents)
        except (ValueError, TypeError):
            return finish("blocked", "invalid_observation")

        def condition_matches(condition):
            matches = [node for node in nodes if _matches(node, condition["selector"])]
            if len(matches) > 1 or any(node.get("packageName") != package for node in matches):
                raise ValueError("Ambiguous condition")
            return len(matches) == 1 and matches[0].get(condition["field"]) == condition["equals"]

        try:
            if condition_matches(step["stopWhen"]):
                return finish("done", "stop_condition_observed")
            if "readyWhen" in step and not condition_matches(step["readyWhen"]):
                return finish("blocked", "unsupported_page")
        except ValueError:
            return finish("blocked", "ambiguous_condition")
        actions = context.get("allowedActions")
        if not isinstance(actions, list) or "click" not in actions:
            return finish("blocked", "action_not_allowed")
        if not _text(context.get("goal"), MAX_GOAL_CHARS):
            return finish("blocked", "invalid_goal")

        candidates = {}
        selected_nodes = set()
        resolution = step.get("candidateResolution", "self")
        resolve_ancestor = resolution == ANCESTOR_RESOLUTION
        if resolve_ancestor:
            receipt["observationId"] = observation["observationId"]
        node_counts = {}
        for node in nodes:
            node_id = node.get("nodeId")
            if isinstance(node_id, str):
                node_counts[node_id] = node_counts.get(node_id, 0) + 1
        for selector in step["candidateSelectors"]:
            matches = [node for node in nodes if _matches(node, selector)]
            if len(matches) > 1:
                return finish("blocked", "ambiguous_candidate")
            if not matches:
                continue
            node = matches[0]
            source_node = node
            node_id = node.get("nodeId")
            if node.get("packageName") != package:
                return finish("blocked", "candidate_package_mismatch")
            if not _text(node_id, 160) or node_counts.get(node_id) != 1 or node_id in selected_nodes:
                return finish("blocked", "ambiguous_node_id")
            distance = 0
            if resolve_ancestor:
                # Code security: derive the path only from this observation's tree.
                # Never skip a disabled, hidden, foreign, or unknown nearer node.
                while True:
                    node_id = node.get("nodeId")
                    if node.get("packageName") != package:
                        return finish("blocked", "candidate_package_mismatch")
                    if not _text(node_id, 160) or node_counts.get(node_id) != 1:
                        return finish("blocked", "ambiguous_node_id")
                    if (node.get("isEnabled", node.get("enabled")) is not True
                            or node.get("visible") is not True):
                        return finish("blocked", "candidate_not_actionable")
                    clickable = node.get("isClickable", node.get("clickable"))
                    if clickable is True:
                        break
                    if clickable is not False:
                        return finish("blocked", "candidate_not_actionable")
                    node = parents.get(id(node))
                    if node is None:
                        return finish("blocked", "candidate_not_actionable")
                    distance += 1
                if node_id in selected_nodes:
                    return finish("blocked", "ambiguous_node_id")
            # Code security: unknown/disabled nodes are never actionable. The source
            # observation, not model output, supplies every action parameter.
            if (node.get("isEnabled", node.get("enabled")) is not True
                    or node.get("isClickable", node.get("clickable")) is not True
                    or node.get("visible") is not True):
                return finish("blocked", "candidate_not_actionable")
            label_fields = ("description", "contentDescription", "text") if resolve_ancestor else (
                "text", "description", "contentDescription")
            label_field = next((field for field in label_fields if source_node.get(field)), None)
            label = source_node.get(label_field) if label_field is not None else None
            if not _text(label, 512):
                return finish("blocked", "candidate_label_invalid")
            choice = "candidate_%d" % len(candidates)
            candidates[choice] = {"nodeId": node_id, "label": label,
                                  "action": {"type": "click", "nodeId": node_id}}
            if resolve_ancestor:
                candidates[choice].update({"sourceNodeId": source_node["nodeId"],
                                           "sourceSelector": copy.deepcopy(selector),
                                           "labelField": label_field,
                                           "resolution": resolution,
                                           "ancestorDistance": distance})
            selected_nodes.add(node_id)
        # The frozen policy defines eligibility, not option order. Follow this
        # observation's UI tree order so model choices cannot rely on policy index.
        positions = {node.get("nodeId"): index for index, node in enumerate(nodes)
                     if isinstance(node.get("nodeId"), str)}
        candidates = {"candidate_%d" % index: candidate for index, candidate in enumerate(
            sorted(candidates.values(), key=lambda item: positions[item["nodeId"]]))}
        receipt["candidates"] = copy.deepcopy(candidates)
        if not candidates:
            return finish("blocked", "no_candidates")
        if len(candidates) > step.get("maxCandidates", 8):
            return finish("blocked", "too_many_candidates")
        if self.mode == "rules":
            matching = [key for key, candidate in candidates.items() if candidate["label"] == step.get("exactText")]
            if len(matching) != 1:
                return finish("blocked", "exact_text_not_unique")
            receipt["selectedChoice"] = matching[0]
            return finish("act", "exact_text_match", candidates[matching[0]]["action"])

        criteria = {key: candidate["label"] for key, candidate in candidates.items()}
        criteria["abstain"] = "没有按钮符合请求的操作"
        request = {"model": self.model,
                   "state": context["goal"],
                   "questions": {"action": {"type": "choice", "instructions": step["instructions"], "criteria": criteria}}}
        try:
            response = self.predictor(copy.deepcopy(request))
        except Exception:
            # Code security: never expose endpoint URLs, credentials or remote error bodies.
            return finish("blocked", "predictor_unavailable")
        try:
            response = normalize_laya_response(response)
        except ValueError:
            return finish("blocked", "invalid_response")
        answer = response["answers"]["action"]
        if (not isinstance(answer, dict) or set(answer) - {"choice", "probs", "confidence"}
                or not {"choice", "probs"}.issubset(answer)
                or not isinstance(answer["choice"], str) or answer["choice"] not in criteria):
            return finish("blocked", "invalid_choice")
        probabilities = answer["probs"]
        if (not isinstance(probabilities, dict) or set(probabilities) != set(criteria)
                or any(not _probability(value) for value in probabilities.values())
                # Laya rounds each entry to four decimals. Permit only the summed
                # rounding error; retain the original numbers rather than renormalizing.
                or not math.isclose(sum(probabilities.values()), 1.0, rel_tol=0,
                                    abs_tol=len(criteria) * 0.00005 + 1e-9)
                or ("confidence" in answer and (isinstance(answer["confidence"], bool)
                    or not isinstance(answer["confidence"], (int, float))
                    or not -1e9 <= answer["confidence"] <= 1e9
                    or not math.isfinite(answer["confidence"])))):
            return finish("blocked", "invalid_probabilities")
        selected = answer["choice"]
        receipt["selectedChoice"] = selected
        receipt["probabilities"] = copy.deepcopy(probabilities)
        score = probabilities[selected]
        margin = score - max(value for key, value in probabilities.items() if key != selected)
        receipt["selectedProbability"] = score
        receipt["margin"] = margin
        receipt["thresholds"] = {"minProbability": step.get("minProbability", 0), "minMargin": step.get("minMargin", 0)}
        if selected == "abstain":
            return finish("blocked", "model_abstained")
        if margin <= 0 or score < step.get("minProbability", 0) or margin < step.get("minMargin", 0):
            return finish("blocked", "uncertain_choice")
        return finish("act", "model_choice", candidates[selected]["action"])
