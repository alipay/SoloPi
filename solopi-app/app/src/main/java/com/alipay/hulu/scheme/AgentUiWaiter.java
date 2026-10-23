package com.alipay.hulu.scheme;

/** Bounded, independently testable UI stability confirmation; never authorizes an action. */
final class AgentUiWaiter<T> {
    static final String LEGACY = "legacy";
    static final String EVENT_STABLE_V1 = "event-stable-v1";
    static final long QUIET_MS = 150L;
    static final long POLL_MS = 100L;

    interface Clock {
        long now();
        void sleep(long durationMs) throws InterruptedException;
    }

    interface Reader<T> {
        Sample<T> read();
    }

    interface Guard {
        void check() throws InterruptedException;
    }

    static final class AbortedException extends RuntimeException {
        AbortedException() {
            super("Agent session is no longer available for UI work");
        }
    }

    static boolean supports(String strategy) {
        return LEGACY.equals(strategy) || EVENT_STABLE_V1.equals(strategy);
    }

    private final Clock clock;
    private final Reader<T> reader;
    private final Guard guard;

    AgentUiWaiter(Clock clock, Reader<T> reader, Guard guard) {
        this.clock = clock;
        this.reader = reader;
        this.guard = guard;
    }

    Result<T> await(long timeoutMs, String baselineSignature) throws InterruptedException {
        long started = clock.now();
        long deadline = started + timeoutMs;
        long stableSince = started;
        Sample<T> previous = null;
        int samples = 0;
        while (true) {
            guard.check();
            Sample<T> current = reader.read();
            samples++;
            guard.check();
            long now = clock.now();
            boolean valid = current != null && current.value != null
                    && current.signature != null && current.eventSourceAvailable
                    && current.eventSequenceBefore == current.eventSequenceAfter;
            boolean same = valid && previous != null
                    && current.signature.equals(previous.signature)
                    && current.eventSequenceAfter == previous.eventSequenceAfter;
            if (!same) {
                stableSince = now;
            }
            boolean stable = same && now - stableSince >= QUIET_MS
                    && now - current.lastEventMs >= QUIET_MS;
            boolean changed = valid && (baselineSignature == null
                    || !baselineSignature.equals(current.signature));
            if (stable && changed) {
                return new Result<>(current.value, now - started, samples, true, false);
            }
            if (now >= deadline) {
                // A no-op may still produce a verified observation for the existing progress guard.
                // An unstable/unknown window cannot be reported as settled even at the deadline.
                return new Result<>(stable ? current.value : null,
                        now - started, samples, false, true);
            }
            previous = valid ? current : null;
            clock.sleep(Math.min(POLL_MS, deadline - now));
        }
    }

    Result<T> awaitWithTransitionGrace(long timeoutMs, long graceMs, String baselineSignature)
            throws InterruptedException {
        Result<T> first = await(timeoutMs, baselineSignature);
        if (first.value != null || graceMs <= 0) return first;
        // A transition may still be loading. Extend observation once, never replay
        // the action or accept an unstable tree. Stable no-ops retain the old budget.
        Result<T> last = await(graceMs, baselineSignature);
        return new Result<>(last.value, first.elapsedMs + last.elapsedMs,
                first.treeSamples + last.treeSamples, last.settled, last.timedOut);
    }

    static final class Sample<T> {
        final T value;
        final String signature;
        final long eventSequenceBefore;
        final long eventSequenceAfter;
        final long lastEventMs;
        final boolean eventSourceAvailable;

        Sample(T value, String signature, long before, long after, long lastEventMs,
               boolean eventSourceAvailable) {
            this.value = value;
            this.signature = signature;
            this.eventSequenceBefore = before;
            this.eventSequenceAfter = after;
            this.lastEventMs = lastEventMs;
            this.eventSourceAvailable = eventSourceAvailable;
        }
    }

    static final class Result<T> {
        final T value;
        final long elapsedMs;
        final int treeSamples;
        final boolean settled;
        final boolean timedOut;

        Result(T value, long elapsedMs, int treeSamples, boolean settled, boolean timedOut) {
            this.value = value;
            this.elapsedMs = elapsedMs;
            this.treeSamples = treeSamples;
            this.settled = settled;
            this.timedOut = timedOut;
        }
    }
}
