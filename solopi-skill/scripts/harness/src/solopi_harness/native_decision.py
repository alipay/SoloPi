"""Bounded loopback decision bridge. Providers select observation-bound candidates."""

from __future__ import annotations

import http.client
import json
import urllib.parse
from collections import Counter
from typing import Any, Mapping

if __package__:
    from .native_runtime import NativeExecutionError, _nodes
else:
    from native_runtime import NativeExecutionError, _nodes


class NativeCandidateProvider:
    def __init__(self, endpoint: str) -> None:
        url = urllib.parse.urlsplit(endpoint)
        try:
            port = url.port
        except ValueError as exc:
            raise NativeExecutionError("invalid_native_provider_endpoint") from exc
        # Code security: explicit numeric loopback only, no credentials, proxy or redirects.
        if (url.scheme != "http" or url.hostname != "127.0.0.1" or not port
                or url.username or url.password or url.fragment or url.query):
            raise NativeExecutionError("invalid_native_provider_endpoint")
        self.port = port
        self.path = url.path or "/"

    def decide(self, context: Mapping[str, Any]) -> dict[str, Any]:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            data = json.dumps(context, ensure_ascii=False).encode("utf-8")
            if len(data) > 1024 * 1024:
                raise NativeExecutionError("native_provider_context_too_large")
            connection.request("POST", self.path, body=data, headers={"Content-Type": "application/json"})
            response = connection.getresponse()
            raw = response.read(1024 * 1024 + 1)
            if response.status != 200 or len(raw) > 1024 * 1024:
                raise NativeExecutionError("native_provider_failed")
            result = json.loads(raw)
            if not isinstance(result, dict):
                raise NativeExecutionError("invalid_native_decision")
            return result
        except (OSError, ValueError, http.client.HTTPException) as exc:
            raise NativeExecutionError("native_provider_failed") from exc
        finally:
            connection.close()


def candidates(observed: Mapping[str, Any], allowed: set[str], test_data: Mapping[str, Any]) -> list[dict[str, Any]]:
    result = []
    nodes = list(_nodes(observed["page"]))
    key = "accessibilityId" if observed["platform"] == "ios" else "id"
    counts = Counter(n.get(key) for n in nodes if isinstance(n.get(key), str))
    values = sorted({value for value in test_data.values() if isinstance(value, str) and value})
    for node in nodes:
        if node.get("visible") is not True or node.get("hittable") is not True:
            continue
        name = node.get(key)
        if not isinstance(name, str) or not name or counts[name] != 1:
            continue
        selector = {key: name}
        actions = []
        role = node.get("className", "")
        if "click" in allowed and (node.get("clickable") is True or role == "XCUIElementTypeButton"):
            actions.append({"type": "click", "selector": selector})
        if "input" in allowed and role in {"TextInput", "TextArea", "Search", "XCUIElementTypeTextField", "XCUIElementTypeTextView"}:
            actions.extend({"type": "input", "selector": selector, "text": value} for value in values
                           if observed["platform"] == "ios" or (not node.get("text") and len(value) <= 4096
                               and all(c.isalnum() or c in "_-./@" for c in value)))
        if "scroll" in allowed and (node.get("scrollable") is True or role in {"XCUIElementTypeScrollView", "XCUIElementTypeTable", "XCUIElementTypeCollectionView"}):
            actions.extend({"type": "scroll", "selector": selector, "direction": d, "distance": 60} for d in ("up", "down"))
        for action in actions:
            result.append({"candidateId": "%s-%d" % (observed["observationId"], len(result)),
                           "action": action, "text": node.get("text", ""), "role": role})
    for action in ([{"type": "back"}] if "back" in allowed else []) + ([{"type": "wait", "durationMs": 500}] if "wait" in allowed else []):
        result.append({"candidateId": "%s-%d" % (observed["observationId"], len(result)), "action": action})
    if len(result) > 200:
        raise NativeExecutionError("native_candidate_limit")
    return result
