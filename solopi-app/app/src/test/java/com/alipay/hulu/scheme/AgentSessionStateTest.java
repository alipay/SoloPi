package com.alipay.hulu.scheme;

import org.junit.Before;
import org.junit.Test;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class AgentSessionStateTest {
    private FakeClock clock;
    private FakeLease lease;
    private SequenceIds ids;
    private AgentSessionState state;

    @Before
    public void setUp() {
        clock = new FakeClock(1_000L);
        lease = new FakeLease();
        ids = new SequenceIds();
        state = new AgentSessionState(clock, lease, ids, null);
    }

    @Test
    public void staleAndConsumedObservationsCannotExecute() {
        AgentSessionState.StartResult start = start("owner-token-a-12345", config());
        AgentSessionState.Observation first = observe(start, "tree-a");
        AgentSessionState.Observation second = observe(start, "tree-b");

        AgentSessionState.Action click = AgentSessionState.Action.of(
                "click", singleton("nodeId", "node-1"));
        AgentSessionState.BeginResult stale = state.beginAction(start.sessionId, "owner-token-a-12345",
                "step-stale", first.observationId, "tree-b", click);
        assertFalse(stale.accepted);
        assertEquals("rejected", stale.receipt.status);
        assertEquals("stale_observation", stale.receipt.errorCode);

        AgentSessionState.BeginResult accepted = state.beginAction(start.sessionId, "owner-token-a-12345",
                "step-1", second.observationId, "tree-b", click);
        assertTrue(accepted.accepted);
        state.finishAction(accepted.generation, "step-1", true, null,
                AgentSessionState.ObservationInput.of("tree-c", singleton("page", "c")));

        AgentSessionState.BeginResult consumed = state.beginAction(start.sessionId, "owner-token-a-12345",
                "step-2", second.observationId, "tree-b", click);
        assertFalse(consumed.accepted);
        assertEquals("stale_observation", consumed.receipt.errorCode);
    }

    @Test
    public void exactOwnerIsRequiredForMutationAndCancellation() {
        AgentSessionState.StartResult start = start("owner-token-a-12345", config());
        AgentSessionState.Observation observation = observe(start, "tree-a");

        AgentSessionState.BeginResult wrongOwner = state.beginAction(start.sessionId, "owner-token-b-12345",
                "step-1", observation.observationId, "tree-a",
                AgentSessionState.Action.of("back", Collections.<String, Object>emptyMap()));
        assertFalse(wrongOwner.accepted);
        assertEquals("owner_mismatch", wrongOwner.receipt.errorCode);
        assertEquals("owner_mismatch", state.cancel(start.sessionId, "owner-token-b-12345").errorCode);
        assertTrue(lease.isOwnedBy(start.leaseOwner));

        assertTrue(state.cancel(start.sessionId, "owner-token-a-12345").success);
        assertFalse(lease.isOwnedBy(start.leaseOwner));
        assertEquals(AgentSessionState.STATE_CANCELLED, state.snapshot().get("state"));
    }

    @Test
    public void stepIdIsIdempotentAndDoesNotRepeatExecution() {
        AgentSessionState.StartResult start = start("owner-token-a-12345", config());
        AgentSessionState.Observation observation = observe(start, "tree-a");
        AgentSessionState.Action back = AgentSessionState.Action.of(
                "back", Collections.<String, Object>emptyMap());

        AgentSessionState.BeginResult first = state.beginAction(start.sessionId, "owner-token-a-12345",
                "step-1", observation.observationId, "tree-a", back);
        AgentSessionState.Receipt finished = state.finishAction(first.generation, "step-1", true,
                null, AgentSessionState.ObservationInput.of("tree-b", singleton("page", "b")));
        AgentSessionState.BeginResult retry = state.beginAction(start.sessionId, "owner-token-a-12345",
                "step-1", "different-observation", "different-tree", back);

        assertFalse(retry.accepted);
        assertTrue(retry.duplicate);
        assertEquals(finished, retry.receipt);
        assertEquals(1, state.getAcceptedStepCount());
    }

    @Test
    public void actionFinishesWithSettledObservationAndTraceableTimeline() {
        AgentSessionState.StartResult start = start("owner-token-a-12345", config());
        AgentSessionState.Observation before = observe(start, "tree-a");
        AgentSessionState.BeginResult begin = state.beginAction(start.sessionId, "owner-token-a-12345",
                "step-1", before.observationId, "tree-a",
                AgentSessionState.Action.of("click", singleton("nodeId", "node-1")));

        clock.advance(25L);
        AgentSessionState.Receipt receipt = state.finishAction(begin.generation, "step-1", true,
                null, AgentSessionState.ObservationInput.of("tree-b", singleton("page", "b")));

        assertEquals("succeeded", receipt.status);
        assertNotNull(receipt.settledObservation);
        assertNotEquals(before.observationId, receipt.settledObservation.observationId);
        assertEquals("step-1", receipt.stepId);

        List<Map<String, Object>> timeline = state.timeline(start.sessionId, "owner-token-a-12345").value;
        assertEquals("session_started", timeline.get(0).get("type"));
        long previous = 0L;
        for (Map<String, Object> event : timeline) {
            long sequence = ((Number) event.get("sequence")).longValue();
            assertTrue(sequence > previous);
            previous = sequence;
        }
        assertEquals("action_settled", timeline.get(timeline.size() - 1).get("type"));
    }

    @Test
    public void pauseRejectsActionsUntilExactOwnerResumes() {
        AgentSessionState.StartResult start = start("owner-token-a-12345", config());
        assertTrue(state.pause(start.sessionId, "owner-token-a-12345").success);
        AgentSessionState.Observation observation = observe(start, "tree-a");

        AgentSessionState.BeginResult paused = state.beginAction(start.sessionId, "owner-token-a-12345",
                "step-paused", observation.observationId, "tree-a",
                AgentSessionState.Action.of("home", Collections.<String, Object>emptyMap()));
        assertEquals("session_paused", paused.receipt.errorCode);
        assertEquals("owner_mismatch", state.resume(start.sessionId, "owner-token-b-12345").errorCode);
        assertTrue(state.resume(start.sessionId, "owner-token-a-12345").success);

        AgentSessionState.BeginResult resumed = state.beginAction(start.sessionId, "owner-token-a-12345",
                "step-running", observation.observationId, "tree-a",
                AgentSessionState.Action.of("home", Collections.<String, Object>emptyMap()));
        assertTrue(resumed.accepted);
    }

    @Test
    public void budgetsTimeoutAndLoopDetectionReleaseLease() {
        AgentSessionState.Config oneStep = new AgentSessionState.Config(1, 1_000L,
                500L, 3, 3);
        AgentSessionState.StartResult firstSession = start("owner-token-a-12345", oneStep);
        AgentSessionState.Observation observation = observe(firstSession, "tree-a");
        AgentSessionState.BeginResult first = state.beginAction(firstSession.sessionId, "owner-token-a-12345",
                "step-1", observation.observationId, "tree-a",
                AgentSessionState.Action.of("back", Collections.<String, Object>emptyMap()));
        AgentSessionState.Receipt settled = state.finishAction(first.generation, "step-1", true,
                null, AgentSessionState.ObservationInput.of("tree-b", singleton("page", "b")));
        AgentSessionState.BeginResult overBudget = state.beginAction(firstSession.sessionId, "owner-token-a-12345",
                "step-2", settled.settledObservation.observationId, "tree-b",
                AgentSessionState.Action.of("back", Collections.<String, Object>emptyMap()));
        assertEquals("step_budget_exhausted", overBudget.receipt.errorCode);
        assertFalse(lease.isOwnedBy(firstSession.leaseOwner));

        AgentSessionState.StartResult timed = start("owner-token-b-12345", config());
        clock.advance(501L);
        assertTrue(state.checkTimeouts());
        assertEquals(AgentSessionState.STATE_EXPIRED, state.snapshot().get("state"));
        assertFalse(lease.isOwnedBy(timed.leaseOwner));

        AgentSessionState.Config loopConfig = new AgentSessionState.Config(10, 5_000L,
                1_000L, 1, 5);
        AgentSessionState.StartResult loop = start("owner-token-c-12345", loopConfig);
        AgentSessionState.Observation loopObservation = observe(loop, "same-tree");
        AgentSessionState.Action wait = AgentSessionState.Action.of(
                "wait", singleton("durationMs", 100L));
        AgentSessionState.BeginResult loopOne = state.beginAction(loop.sessionId, "owner-token-c-12345",
                "loop-1", loopObservation.observationId, "same-tree", wait);
        AgentSessionState.Receipt loopReceipt = state.finishAction(loopOne.generation, "loop-1", true,
                null, AgentSessionState.ObservationInput.of("same-tree", singleton("page", "same")));
        AgentSessionState.BeginResult loopTwo = state.beginAction(loop.sessionId, "owner-token-c-12345",
                "loop-2", loopReceipt.settledObservation.observationId, "same-tree", wait);
        assertEquals("loop_detected", loopTwo.receipt.errorCode);
        assertFalse(lease.isOwnedBy(loop.leaseOwner));
    }

    @Test
    public void oldGenerationCallbackCannotMutateNewSession() {
        AgentSessionState.StartResult oldSession = start("owner-token-a-12345", config());
        AgentSessionState.Observation observation = observe(oldSession, "tree-a");
        AgentSessionState.BeginResult oldStep = state.beginAction(oldSession.sessionId, "owner-token-a-12345",
                "step-old", observation.observationId, "tree-a",
                AgentSessionState.Action.of("back", Collections.<String, Object>emptyMap()));
        assertTrue(state.cancel(oldSession.sessionId, "owner-token-a-12345").success);

        AgentSessionState.StartResult newSession = start("owner-token-b-12345", config());
        assertNull(state.finishAction(oldStep.generation, "step-old", true, null,
                AgentSessionState.ObservationInput.of("late", singleton("page", "late"))));
        assertEquals(newSession.sessionId, state.snapshot().get("sessionId"));
        assertEquals(AgentSessionState.STATE_ACTIVE, state.snapshot().get("state"));
        assertTrue(lease.isOwnedBy(newSession.leaseOwner));
    }

    @Test
    public void executionFailureIsTerminalAndReleasesLease() {
        AgentSessionState.StartResult start = start("owner-token-a-12345", config());
        AgentSessionState.Observation observation = observe(start, "tree-a");
        AgentSessionState.BeginResult begin = state.beginAction(start.sessionId, "owner-token-a-12345",
                "step-1", observation.observationId, "tree-a",
                AgentSessionState.Action.of("back", Collections.<String, Object>emptyMap()));

        AgentSessionState.Receipt failed = state.finishAction(begin.generation, "step-1", false,
                "operation failed", null);
        assertEquals("failed", failed.status);
        assertEquals(AgentSessionState.STATE_FAILED, state.snapshot().get("state"));
        assertFalse(lease.isOwnedBy(start.leaseOwner));
    }

    @Test
    public void arbitraryShellAndUnknownFieldsAreRejectedBeforeExecution() {
        AgentSessionState.StartResult start = start("owner-token-a-12345", config());
        AgentSessionState.Observation observation = observe(start, "tree-a");

        AgentSessionState.BeginResult shell = state.beginAction(start.sessionId,
                "owner-token-a-12345", "step-shell", observation.observationId, "tree-a",
                AgentSessionState.Action.of("executeShell", singleton("text", "id")));
        assertFalse(shell.accepted);
        assertEquals("unsupported_action", shell.receipt.errorCode);

        Map<String, Object> unsafeClick = singleton("nodeId", "node-1");
        unsafeClick.put("text", "unexpected");
        AgentSessionState.BeginResult extra = state.beginAction(start.sessionId,
                "owner-token-a-12345", "step-extra", observation.observationId, "tree-a",
                AgentSessionState.Action.of("click", unsafeClick));
        assertFalse(extra.accepted);
        assertEquals("invalid_action", extra.receipt.errorCode);
        assertEquals(0, state.getAcceptedStepCount());
    }

    @Test
    public void noProgressAndOldSessionIdentityCannotAffectReplacement() {
        AgentSessionState.Config noProgress = new AgentSessionState.Config(10, 5_000L,
                1_000L, 10, 1);
        AgentSessionState.StartResult oldSession = start("owner-token-a-12345", noProgress);
        AgentSessionState.Observation observation = observe(oldSession, "same-tree");
        AgentSessionState.BeginResult begin = state.beginAction(oldSession.sessionId,
                "owner-token-a-12345", "step-1", observation.observationId, "same-tree",
                AgentSessionState.Action.of("back", Collections.<String, Object>emptyMap()));
        AgentSessionState.Receipt receipt = state.finishAction(begin.generation, "step-1", true,
                null, AgentSessionState.ObservationInput.of("same-tree", singleton("page", "same")));

        assertEquals("succeeded", receipt.status);
        assertEquals(AgentSessionState.STATE_FAILED, state.snapshot().get("state"));
        assertEquals("no_progress_loop_detected", state.snapshot().get("terminalReason"));
        assertFalse(lease.isOwnedBy(oldSession.leaseOwner));

        AgentSessionState.StartResult replacement = start("owner-token-b-12345", config());
        assertEquals("session_not_found",
                state.cancel(oldSession.sessionId, "owner-token-a-12345").errorCode);
        assertEquals(replacement.sessionId, state.snapshot().get("sessionId"));
        assertTrue(lease.isOwnedBy(replacement.leaseOwner));
    }

    private AgentSessionState.StartResult start(String owner, AgentSessionState.Config config) {
        AgentSessionState.StartResult result = state.start(owner, config);
        assertTrue(result.success);
        return result;
    }

    private AgentSessionState.Observation observe(AgentSessionState.StartResult start,
                                                   String signature) {
        AgentSessionState.Result<AgentSessionState.Observation> result = state.recordObservation(
                start.sessionId, start.ownerToken, signature, singleton("page", signature));
        assertTrue(result.success);
        return result.value;
    }

    private static AgentSessionState.Config config() {
        return new AgentSessionState.Config(10, 5_000L, 500L, 3, 3);
    }

    private static Map<String, Object> singleton(String key, Object value) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put(key, value);
        return result;
    }

    private static final class FakeClock implements AgentSessionState.Clock {
        private long now;

        FakeClock(long now) {
            this.now = now;
        }

        @Override
        public long now() {
            return now;
        }

        void advance(long durationMs) {
            now += durationMs;
        }
    }

    private static final class FakeLease implements AgentSessionState.Lease {
        private String owner;

        @Override
        public boolean acquire(String requestedOwner) {
            if (owner != null) {
                return false;
            }
            owner = requestedOwner;
            return true;
        }

        @Override
        public boolean isOwnedBy(String expectedOwner) {
            return expectedOwner != null && expectedOwner.equals(owner);
        }

        @Override
        public boolean release(String expectedOwner) {
            if (!isOwnedBy(expectedOwner)) {
                return false;
            }
            owner = null;
            return true;
        }
    }

    private static final class SequenceIds implements AgentSessionState.IdGenerator {
        private int value;

        @Override
        public String next(String prefix) {
            return prefix + "-" + (++value);
        }
    }
}
