"""Bounded, payload-free host timings for a synchronous verification run."""

from __future__ import annotations

import contextvars
import functools
import time
from contextlib import contextmanager
from typing import Any, Callable, Iterator


# Code security: only code-owned labels are exported; never capture call arguments,
# response bodies, exception text, URLs, device identifiers, or owner credentials.
LABELS = frozenset({
    "verification.total", "verification.plan", "verification.screenshot", "provider.initialize", "provider.decide",
    "segment.test.fixed", "segment.test.dynamic", "segment.cleanup.fixed",
    "segment.cleanup.dynamic", "fixed.import", "fixed.prepare", "fixed.replay", "fixed.ack_wait",
    "fixed.terminal_wait", "fixed.import_wait", "connection.open", "connection.close",
    "transport.adb_roundtrip", "transport.http_roundtrip", "observation.roundtrip",
    "observation.initial_wait",
    "dynamic.start", "dynamic.action_and_settle", "dynamic.finalize",
    "evidence.export", "evidence.json", "host.poll_sleep",
})

_active: contextvars.ContextVar[Any] = contextvars.ContextVar("verification_timing", default=None)
_stack: contextvars.ContextVar[tuple] = contextvars.ContextVar("verification_timing_stack", default=())


class TimingRecorder:
    def __init__(self, clock: Callable[[], float] = time.perf_counter, max_spans: int = 10000):
        if isinstance(max_spans, bool) or not isinstance(max_spans, int) or max_spans < 0:
            raise ValueError("max_spans must be a nonnegative integer")
        self.clock = clock
        self.max_spans = max_spans
        self.started = clock()
        self.finished = None
        self.spans: list[dict[str, Any]] = []
        self.aggregates: dict[str, dict[str, Any]] = {}
        self.sequence = 0
        self.dropped = 0

    @contextmanager
    def activate(self) -> Iterator["TimingRecorder"]:
        active_token = _active.set(self)
        stack_token = _stack.set(())
        try:
            yield self
        finally:
            self.finished = self.clock()
            _stack.reset(stack_token)
            _active.reset(active_token)

    @contextmanager
    def span(self, label: str) -> Iterator[None]:
        if label not in LABELS:
            raise ValueError("unknown timing label")
        stack = _stack.get()
        self.sequence += 1
        current = {"sequence": self.sequence, "childrenSeconds": 0.0}
        parent = stack[-1] if stack else None
        token = _stack.set(stack + (current,))
        started = self.clock()
        failed = False
        try:
            yield
        except BaseException:
            failed = True
            raise
        finally:
            ended = self.clock()
            duration = max(0.0, ended - started)
            exclusive = max(0.0, duration - current["childrenSeconds"])
            if parent is not None:
                parent["childrenSeconds"] += duration
            _stack.reset(token)
            stats = self.aggregates.setdefault(label, {
                "count": 0, "exceptionCount": 0, "inclusiveMs": 0.0,
                "exclusiveMs": 0.0, "maxInclusiveMs": 0.0,
            })
            stats["count"] += 1
            stats["exceptionCount"] += int(failed)
            stats["inclusiveMs"] += duration * 1000
            stats["exclusiveMs"] += exclusive * 1000
            stats["maxInclusiveMs"] = max(stats["maxInclusiveMs"], duration * 1000)
            if current["sequence"] <= self.max_spans:
                self.spans.append({
                    "sequence": current["sequence"],
                    "parentSequence": parent["sequence"] if parent else None,
                    "label": label,
                    "startedAfterMs": round(max(0.0, started - self.started) * 1000, 3),
                    "durationMs": round(duration * 1000, 3),
                    "exclusiveMs": round(exclusive * 1000, 3),
                    "raised": failed,
                })
            else:
                self.dropped += 1

    def summary(self) -> dict[str, Any]:
        elapsed = max(0.0, (self.finished if self.finished is not None else self.clock()) - self.started) * 1000
        root = self.aggregates.get("verification.total", {})
        attributed = sum(value["exclusiveMs"] for key, value in self.aggregates.items()
                         if key != "verification.total")
        return {
            "schemaVersion": 1,
            "clock": "host_monotonic_perf_counter",
            "scope": "verify-run entry through initial report export; final timing serialization excluded",
            "measurement": "host wall time; roundtrips include device processing and transfer",
            "definitions": {
                "verification.screenshot": "optional full-screen PNG export after an execution segment; included in verification total",
                "observation.initial_wait": "polling until the initial observation is available; includes transport and host sleeps",
                "observation.roundtrip": "explicit observation command including connection and response handling",
                "dynamic.action_and_settle": "action submission and polling through settled receipt; includes device action and observation work",
                "fixed.prepare": "existing case identity, policy, plugin, permissions and availability checks before replay submission",
                "provider.initialize": "provider setup including local model load and checkpoint digest when applicable",
                "provider.decide": "complete provider call including input preparation and output validation; not model kernel time",
                "exceptionCount": "Python exceptions crossing this span; an ordinary failed verification is not an exception",
            },
            "nativeTreeCollectionMs": None,
            "modelKernelMs": None,
            "accounting": "inclusive spans overlap; exclusive spans subtract direct children; never sum inclusive totals",
            "hostElapsedMs": round(elapsed, 3),
            "rootInclusiveMs": round(root.get("inclusiveMs", 0.0), 3),
            "attributedExclusiveMs": round(attributed, 3),
            "unattributedMs": round(max(0.0, elapsed - attributed), 3),
            "spanCount": self.sequence,
            "retainedSpanCount": len(self.spans),
            "droppedSpanCount": self.dropped,
            "aggregates": {key: {field: round(value, 3) if isinstance(value, float) else value
                                  for field, value in stats.items()}
                           for key, stats in sorted(self.aggregates.items())},
        }

    def export(self) -> dict[str, Any]:
        return {**self.summary(), "spans": sorted(self.spans, key=lambda item: item["sequence"])}


@contextmanager
def span(label: str) -> Iterator[None]:
    recorder = _active.get()
    if recorder is None:
        yield
    else:
        with recorder.span(label):
            yield


def measured(label: str) -> Callable:
    if label not in LABELS:
        raise ValueError("unknown timing label")

    def decorate(function: Callable) -> Callable:
        @functools.wraps(function)
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            with span(label):
                return function(*args, **kwargs)
        return wrapped
    return decorate


def poll_sleep(seconds: float, sleeper: Callable[[float], None] = time.sleep) -> None:
    with span("host.poll_sleep"):
        sleeper(seconds)
