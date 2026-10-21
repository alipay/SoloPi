"""Local typed DecisionProvider bridge for a TrustBench cloud-model trial."""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Mapping, Optional
from urllib.parse import urlsplit


MAX_BODY = 2 * 1024 * 1024
DEFAULT_MAX_OUTPUT_TOKENS = 1024
MAX_OUTPUT_TOKENS = 8192


class RequestPacer:
    """Process-wide request-start spacing; queue time consumes the call budget."""

    def __init__(self, interval: float, clock=time.monotonic, sleep=time.sleep):
        if not math.isfinite(interval) or not 0 <= interval <= 60:
            raise ValueError("model minimum interval must be between 0 and 60 seconds")
        self.interval = interval
        self.clock = clock
        self.sleep = sleep
        self.lock = threading.Lock()
        self.next_start = 0.0

    def wait(self, budget: float) -> float:
        started = self.clock()
        if not self.lock.acquire(timeout=budget):
            raise TimeoutError("model pacing budget exhausted")
        try:
            delay = max(0.0, self.next_start - self.clock())
            if self.clock() - started + delay >= budget:
                raise TimeoutError("model pacing budget exhausted")
            while delay > 0:
                self.sleep(delay)
                delay = max(0.0, self.next_start - self.clock())
            if self.clock() - started >= budget:
                raise TimeoutError("model pacing budget exhausted")
            self.next_start = self.clock() + self.interval
            return self.clock() - started
        finally:
            self.lock.release()


def output_token_budget(value: str) -> int:
    try:
        budget = int(value)
    except ValueError as exc:
        raise ValueError("model output token budget must be an integer") from exc
    if not 1 <= budget <= MAX_OUTPUT_TOKENS:
        raise ValueError("model output token budget must be between 1 and %d" % MAX_OUTPUT_TOKENS)
    return budget


SYSTEM_PROMPT = (
    "You control a counter test app. Return exactly one JSON object, without markdown. "
    "Use only the given goal, allowed actions, and current visible UI nodes. "
    "Choose one action: {\"type\":\"act\",\"action\":{\"type\":\"click\","
    "\"selector\":{\"resourceId\":\"...\",\"className\":\"...\","
    "\"packageName\":\"...\"}}}, or {\"type\":\"done\",\"reason\":\"...\"} "
    "only after observing the goal state, or {\"type\":\"blocked\",\"reason\":\"...\"}. "
    "Never infer that a click succeeded without observing its result."
)
NOTES_PACKAGE = "com.example.trustnotes"
NOTES_SYSTEM_PROMPT = (
    "You control a notes app. Return exactly one JSON object, without markdown. "
    "Use only the goal, allowed actions, and current visible UI nodes. "
    "For a button, return {\"type\":\"act\",\"action\":{\"type\":\"click\","
    "\"selector\":{\"resourceId\":\"...\",\"className\":\"...\","
    "\"packageName\":\"...\"}}}. "
    "For an editable field, return the same selector with "
    "{\"type\":\"act\",\"action\":{\"type\":\"input\","
    "\"selector\":{\"resourceId\":\"...\",\"className\":\"...\","
    "\"packageName\":\"...\"},\"text\":\"...\"}}. "
    "Return {\"type\":\"done\",\"reason\":\"...\"} only after observing "
    "the saved goal state, or {\"type\":\"blocked\",\"reason\":\"...\"}. "
    "Never infer that an action succeeded without observing its result."
)


def visible_nodes(value: Any, target_package: str = "com.example.counter") -> list[Dict[str, Any]]:
    nodes: list[Dict[str, Any]] = []
    pending = [value]
    while pending:
        item = pending.pop()
        if isinstance(item, list):
            pending.extend(reversed(item))
        elif isinstance(item, dict):
            if (item.get("visible") is True and
                    item.get("packageName") == target_package and
                    str(item.get("resourceId", "")).startswith(target_package + ":id/")):
                fields = ("resourceId", "className", "packageName", "text",
                          "description", "isClickable")
                if target_package == NOTES_PACKAGE:
                    fields += ("isEditable",)
                nodes.append({key: item[key] for key in fields if key in item})
            pending.extend(reversed(item.get("children", [])))
    return nodes


def model_input(context: Mapping[str, Any],
                target_package: str = "com.example.counter") -> Dict[str, Any]:
    if not isinstance(context.get("goal"), str) or not isinstance(context.get("allowedActions"), list):
        raise ValueError("missing goal or allowed actions")
    observation = context.get("observation")
    if not isinstance(observation, dict):
        raise ValueError("missing observation")
    nodes = visible_nodes(observation.get("page"), target_package)
    if not nodes:
        raise ValueError("target page has no visible nodes")
    return {
        "goal": context["goal"],
        "allowedActions": context["allowedActions"],
        "stepIndex": context.get("stepIndex"),
        "visibleNodes": nodes,
    }


def parse_decision(raw: str, context: Mapping[str, Any],
                   target_package: str = "com.example.counter") -> Dict[str, Any]:
    decision = json.loads(raw)
    if not isinstance(decision, dict) or decision.get("type") not in {"act", "done", "blocked"}:
        raise ValueError("model response is not a typed decision")
    if decision["type"] == "act":
        action = decision.get("action")
        if not isinstance(action, dict) or action.get("type") not in {"click", "input"}:
            raise ValueError("model action must be click or input")
        action_type = action["type"]
        if action_type not in context["allowedActions"]:
            raise ValueError("model action is not allowed")
        selector = action.get("selector")
        if not isinstance(selector, dict) or set(selector) != {
            "resourceId", "className", "packageName"
        }:
            raise ValueError("model selector is incomplete")
        required_flag = "isClickable" if action_type == "click" else "isEditable"
        if not any(all(node.get(key) == value for key, value in selector.items())
                   and node.get(required_flag) is True
                   for node in model_input(context, target_package)["visibleNodes"]):
            raise ValueError("model selector is not a visible %s node" %
                             ("clickable" if action_type == "click" else "editable"))
        if action_type == "input":
            value = action.get("text")
            if set(action) != {"type", "selector", "text"} or not isinstance(value, str) or not 0 < len(value) <= 200:
                raise ValueError("model input must have text of 1 to 200 characters")
            return {"type": "act", "action": {"type": "input", "selector": selector,
                                               "text": value}}
        if set(action) != {"type", "selector"}:
            raise ValueError("model click has unsupported fields")
        return {"type": "act", "action": {"type": "click", "selector": selector}}
    if set(decision) - {"type", "reason"}:
        raise ValueError("terminal decision has unsupported fields")
    reason = decision.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        raise ValueError("terminal decision needs a reason")
    return {"type": decision["type"], "reason": reason[:200]}


def response_text(payload: Mapping[str, Any]) -> str:
    direct = payload.get("output_text")
    if isinstance(direct, str) and direct:
        return direct
    chunks = []
    for item in payload.get("output", []):
        if not isinstance(item, dict):
            continue
        for part in item.get("content", []):
            if isinstance(part, dict) and part.get("type") == "output_text":
                value = part.get("text")
                if isinstance(value, str):
                    chunks.append(value)
    if not chunks:
        raise ValueError("Responses result has no output text")
    return "".join(chunks)


def call_model(context: Mapping[str, Any], endpoint: str, api_key: str,
               model: str, timeout: float = 90.0,
               sofa_trace_id: Optional[str] = None,
               sofa_rpc_id: Optional[str] = None,
               wire_api: str = "chat_completions",
               target_package: str = "com.example.counter",
               max_output_tokens: int = DEFAULT_MAX_OUTPUT_TOKENS,
               pacer: Optional[RequestPacer] = None) -> Dict[str, Any]:
    target = urlsplit(endpoint)
    if target.scheme != "https" or not target.hostname or not target.path:
        raise ValueError("model endpoint must be an HTTPS API path")
    if wire_api not in {"chat_completions", "responses"}:
        raise ValueError("unsupported model wire API")
    if target_package not in {"com.example.counter", NOTES_PACKAGE}:
        raise ValueError("unsupported target package")
    if (isinstance(max_output_tokens, bool) or not isinstance(max_output_tokens, int) or
            not 1 <= max_output_tokens <= MAX_OUTPUT_TOKENS):
        raise ValueError("invalid model output token budget")
    system_prompt = NOTES_SYSTEM_PROMPT if target_package == NOTES_PACKAGE else SYSTEM_PROMPT
    prompt = json.dumps(model_input(context, target_package), ensure_ascii=False,
                        separators=(",", ":"))
    headers = {"Authorization": "Bearer " + api_key, "Content-Type": "application/json"}
    for name, value in (("SOFA-TraceId", sofa_trace_id), ("SOFA-RpcId", sofa_rpc_id)):
        if value is not None:
            if not value or any(char in value for char in "\r\n"):
                raise ValueError("invalid SOFA request header")
            headers[name] = value
    if wire_api == "responses":
        request_body = {
            "model": model,
            "instructions": system_prompt,
            "input": prompt,
            "store": False,
            "max_output_tokens": max_output_tokens,
        }
    else:
        request_body = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0,
            "max_tokens": max_output_tokens,
        }
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(request_body).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    pacing_wait = pacer.wait(timeout) if pacer is not None else 0.0
    started = time.monotonic()
    with urllib.request.urlopen(request, timeout=timeout - pacing_wait) as response:
        payload = json.loads(response.read(MAX_BODY).decode("utf-8"))
    if wire_api == "responses":
        if payload.get("status") == "incomplete":
            raise ValueError("model_output_truncated")
        content = response_text(payload)
    else:
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices:
            raise ValueError("model response has no choices")
        if choices[0].get("finish_reason") == "length":
            raise ValueError("model_output_truncated")
        content = choices[0].get("message", {}).get("content")
        if not isinstance(content, str):
            raise ValueError("model response has no text content")
    decision = parse_decision(content, context, target_package)
    usage = payload.get("usage") or {}
    decision["modelReceipt"] = {
        "provider": "cloud",
        "modelId": payload.get("model", model),
        "requestId": payload.get("id"),
        "latencyMs": int((time.monotonic() - started) * 1000),
        "promptTokens": usage.get("input_tokens" if wire_api == "responses" else "prompt_tokens"),
        "completionTokens": usage.get("output_tokens" if wire_api == "responses" else "completion_tokens"),
        "maxOutputTokens": max_output_tokens,
        "fallbackUsed": False,
    }
    if pacer is not None:
        decision["modelReceipt"].update({
            "pacingWaitMs": round(pacing_wait * 1000),
            "minRequestIntervalMs": round(pacer.interval * 1000),
        })
    return decision


def main() -> int:
    parser = argparse.ArgumentParser(description="Local TrustBench model decision bridge")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    endpoint = os.environ.get("TRUSTBENCH_MODEL_ENDPOINT")
    api_key = os.environ.get("TRUSTBENCH_MODEL_API_KEY")
    model = os.environ.get("TRUSTBENCH_MODEL_ID")
    wire_api = os.environ.get("TRUSTBENCH_MODEL_WIRE_API", "chat_completions")
    sofa_trace_id = os.environ.get("TRUSTBENCH_SOFA_TRACE_ID")
    sofa_rpc_id = os.environ.get("TRUSTBENCH_SOFA_RPC_ID")
    target_package = os.environ.get("TRUSTBENCH_TARGET_PACKAGE", "com.example.counter")
    try:
        pacer = RequestPacer(float(os.environ.get("TRUSTBENCH_MODEL_MIN_INTERVAL_SECONDS", "60")))
        max_output_tokens = output_token_budget(
            os.environ.get("TRUSTBENCH_MODEL_MAX_OUTPUT_TOKENS", str(DEFAULT_MAX_OUTPUT_TOKENS)))
    except ValueError as exc:
        parser.error(str(exc))
    if not endpoint or not api_key or not model:
        parser.error("TRUSTBENCH_MODEL_ENDPOINT, TRUSTBENCH_MODEL_API_KEY and TRUSTBENCH_MODEL_ID are required")
    target = urlsplit(endpoint)
    if target.scheme != "https" or not target.hostname or not target.path:
        parser.error("TRUSTBENCH_MODEL_ENDPOINT must be an HTTPS API path")
    if wire_api not in {"chat_completions", "responses"}:
        parser.error("TRUSTBENCH_MODEL_WIRE_API must be chat_completions or responses")
    if target_package not in {"com.example.counter", NOTES_PACKAGE}:
        parser.error("TRUSTBENCH_TARGET_PACKAGE is not a supported fixture package")

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            if self.path != "/decide":
                self.send_error(404)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_BODY:
                    raise ValueError("invalid request size")
                context = json.loads(self.rfile.read(length))
                if not isinstance(context, dict):
                    raise ValueError("decision context must be an object")
                decision = call_model(context, endpoint, api_key, model,
                                      sofa_trace_id=sofa_trace_id,
                                      sofa_rpc_id=sofa_rpc_id,
                                      wire_api=wire_api,
                                      target_package=target_package,
                                      max_output_tokens=max_output_tokens,
                                      pacer=pacer)
                body = json.dumps(decision, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
            except (ValueError, KeyError, TypeError, OSError, urllib.error.URLError,
                    json.JSONDecodeError) as exc:
                print(json.dumps({"errorType": type(exc).__name__,
                                  "errorCode": "model_output_truncated"
                                  if str(exc) == "model_output_truncated" else None,
                                  "httpStatus": getattr(exc, "code", None)}),
                      file=sys.stderr, flush=True)
                body = b'{"error":"model_decision_unavailable"}'
                self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: Any) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(json.dumps({"status": "listening", "host": "127.0.0.1", "port": args.port,
                      "model": model, "maxOutputTokens": max_output_tokens,
                      "minRequestIntervalMs": round(pacer.interval * 1000)}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
