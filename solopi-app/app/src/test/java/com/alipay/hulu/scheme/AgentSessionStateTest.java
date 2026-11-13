package com.alipay.hulu.scheme;

import com.alibaba.fastjson.JSONObject;

import org.junit.Before;
import org.junit.Test;

import java.util.Collections;
import java.util.ArrayList;
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
    public void strategyIsFrozenPerSessionAndLegacyConstructorRemainsCompatible() {
        AgentSessionState.StartResult first = start("owner-token-a-12345", config());
        assertEquals("legacy", first.session.get("settleStrategy"));
        assertEquals("main", first.session.get("screenMode"));
        state.end(first.sessionId, first.ownerToken);
        AgentSessionState.Config optimized = new AgentSessionState.Config(10, 60_000L, 5_000L,
                3, 3, "event-stable-v1");
        AgentSessionState.StartResult second = start("owner-token-b-12345", optimized);
        assertEquals("event-stable-v1", second.session.get("settleStrategy"));
        assertEquals("event-stable-v1", state.workConfig(second.sessionId, second.ownerToken)
                .value.settleStrategy);
        assertFalse(state.workConfig(first.sessionId, first.ownerToken).success);
    }

    @Test
    public void screenModeAndTargetAreFrozenForEachSession() {
        AgentSessionState.Config virtual = new AgentSessionState.Config(10, 60000L, 5000L, 3, 3,
                "legacy", "full-page", "virtual", "com.example.demo");
        AgentSessionState.StartResult started = start("owner-token-a-12345", virtual);
        assertEquals("virtual", started.session.get("screenMode"));
        assertEquals("com.example.demo", started.session.get("targetPackage"));
        assertEquals("virtual", state.workConfig(started.sessionId, started.ownerToken).value.screenMode);
        state.end(started.sessionId, started.ownerToken);
        AgentSessionState.StartResult main = start("owner-token-b-12345", config());
        assertEquals("main", main.session.get("screenMode"));
        assertNull(main.session.get("targetPackage"));
    }

    @Test
    public void virtualSessionRejectsInvalidPackageAndUnknownMode() {
        for (String pkg : new String[] {null, "", "com.example;id", "bad"}) {
            try {
                new AgentSessionState.Config(10, 60000L, 5000L, 3, 3, "legacy", "full-page", "virtual", pkg);
                org.junit.Assert.fail("invalid target accepted");
            } catch (IllegalArgumentException expected) { }
        }
        try {
            new AgentSessionState.Config(10, 60000L, 5000L, 3, 3, "legacy", "full-page", "other", null);
            org.junit.Assert.fail("unknown mode accepted");
        } catch (IllegalArgumentException expected) { }
    }

    @Test
    public void failedResourceCleanupKeepsLeaseVisibleAndBlocksNewSession() {
        AgentSessionState.StartResult started = start("owner-token-a-12345", config());
        lease.failRelease = true;
        assertTrue(state.end(started.sessionId, started.ownerToken).success);
        assertEquals(Boolean.TRUE, state.snapshot().get("leaseHeld"));
        assertFalse(state.start("owner-token-b-12345", config()).success);
        assertFalse(state.retryCleanup(started.sessionId, "wrong-owner-token").success);
        assertEquals("cleanup_unconfirmed", state.retryCleanup(started.sessionId, started.ownerToken).errorCode);
        lease.failRelease = false;
        assertTrue(state.retryCleanup(started.sessionId, started.ownerToken).success);
        assertTrue(state.retryCleanup(started.sessionId, started.ownerToken).success);
        assertEquals(Boolean.FALSE, state.snapshot().get("leaseHeld"));
        assertTrue(state.start("owner-token-b-12345", config()).success);
    }

    @Test
    public void cleanupCannotTerminateLiveSession() {
        AgentSessionState.StartResult started = start("owner-token-a-12345", config());
        assertEquals("session_not_terminal", state.retryCleanup(started.sessionId, started.ownerToken).errorCode);
        assertTrue(lease.isOwnedBy(started.leaseOwner));
    }

    @Test public void rejectedVirtualActionIsRecordedOnceForTheOwner() {
        AgentSessionState.StartResult started = start("owner-token-a-12345", config());
        AgentSessionState.Action action = AgentSessionState.Action.of("home", Collections.<String, Object>emptyMap());
        AgentSessionState.Receipt wrong = state.rejectAction(started.sessionId, "owner-token-b-12345",
                "step-1", "obs-1", action, "virtual_action_unsupported", "unsupported");
        assertEquals("owner_mismatch", wrong.errorCode);
        assertFalse(state.receipt(started.sessionId, started.ownerToken, "step-1").success);
        AgentSessionState.Receipt rejected = state.rejectAction(started.sessionId, started.ownerToken,
                "step-1", "obs-1", action, "virtual_action_unsupported", "unsupported");
        assertEquals("virtual_action_unsupported", rejected.errorCode);
        assertEquals(rejected.errorCode, state.rejectAction(started.sessionId, started.ownerToken,
                "step-1", "obs-1", action, "other", "other").errorCode);
        assertEquals(0, state.getAcceptedStepCount());
    }

    @Test public void fixturePreDispatchRejectionRequiresOwnerAndPreservesExistingReceipt() {
        AgentSessionState.StartResult started = start("owner-token-a-12345", config());
        String step = "fixture-0123456789abcdef0123456789abcdef";
        state.rejectFixturePipeBeforeDispatch(started.sessionId, "wrong-owner", step, "obs-1");
        assertFalse(state.receipt(started.sessionId, started.ownerToken, step).success);
        state.rejectFixturePipeBeforeDispatch(started.sessionId, started.ownerToken, "arbitrary-step", "obs-1");
        assertFalse(state.receipt(started.sessionId, started.ownerToken, "arbitrary-step").success);
        state.rejectFixturePipeBeforeDispatch(started.sessionId, started.ownerToken, step, "obs-1");
        AgentSessionState.Receipt rejected = state.receipt(started.sessionId, started.ownerToken, step).value;
        assertEquals("rejected", rejected.status);
        assertEquals("fixture_pre_dispatch_rejected", rejected.errorCode);
        assertEquals("obs-1", rejected.observationId);
        state.rejectAction(started.sessionId, started.ownerToken, step, "obs-2",
                AgentSessionState.Action.of("home", Collections.<String, Object>emptyMap()), "other", "other");
        assertEquals("fixture_pre_dispatch_rejected", state.receipt(started.sessionId, started.ownerToken, step).value.errorCode);
        assertEquals(0, state.getAcceptedStepCount());
    }

    @Test public void fixturePreDispatchRejectionDoesNotReplaceAcceptedAction() {
        AgentSessionState.StartResult started = start("owner-token-a-12345", config());
        AgentSessionState.Observation observation = state.recordObservation(started.sessionId, started.ownerToken,
                "tree", Collections.<String, Object>emptyMap()).value;
        String step = "fixture-0123456789abcdef0123456789abcdef";
        AgentSessionState.BeginResult accepted = state.beginAction(started.sessionId, started.ownerToken, step,
                observation.observationId, "tree", AgentSessionState.Action.of("wait", singleton("durationMs", 100L)));
        assertTrue(accepted.accepted);
        state.rejectFixturePipeBeforeDispatch(started.sessionId, started.ownerToken, step, observation.observationId);
        assertEquals("accepted", state.receipt(started.sessionId, started.ownerToken, step).value.status);
        assertNotNull(state.finishAction(accepted.generation, step, true, null,
                AgentSessionState.ObservationInput.of("new-tree", Collections.<String, Object>emptyMap())));
        assertEquals("succeeded", state.receipt(started.sessionId, started.ownerToken, step).value.status);
    }

    @Test public void verifiedVisualProgressPreventsFalseNoProgressFailure() {
        AgentSessionState.Config bounds = new AgentSessionState.Config(10, 60000L, 5000L, 3, 1);
        AgentSessionState.StartResult started = start("owner-token-a-12345", bounds);
        AgentSessionState.Observation first = state.recordObservation(started.sessionId, started.ownerToken,
                "same-tree", singleton("progressSignature", "before")).value;
        AgentSessionState.BeginResult action = state.beginAction(started.sessionId, started.ownerToken, "step-1",
                first.observationId, "same-tree", AgentSessionState.Action.of("wait", singleton("durationMs", 100L)));
        assertTrue(action.accepted);
        state.finishAction(action.generation, "step-1", true, null,
                AgentSessionState.ObservationInput.of("same-tree", singleton("progressSignature", "after")));
        assertEquals(AgentSessionState.STATE_ACTIVE, state.snapshot().get("state"));
    }

    @Test public void dispatchEvidenceOnlyBelongsToAcceptedCurrentAction() {
        AgentSessionState.StartResult started = start("owner-token-a-12345", config());
        AgentSessionState.Observation observed = state.recordObservation(started.sessionId, started.ownerToken,
                "same-tree", Collections.<String, Object>emptyMap()).value;
        AgentSessionState.BeginResult action = state.beginAction(started.sessionId, started.ownerToken, "step-1",
                observed.observationId, "same-tree", AgentSessionState.Action.of("wait", singleton("durationMs", 100L)));
        assertTrue(action.accepted);
        state.noteVirtualDispatch(action.generation + 1, "step-1");
        state.noteVirtualDispatch(action.generation, "unknown-step");
        state.noteVirtualDispatch(action.generation, "step-1");
        List<Map<String, Object>> events = state.timeline(started.sessionId, started.ownerToken).value;
        int count = 0;
        for (Map<String, Object> event : events) if ("action_dispatched".equals(event.get("type"))) count++;
        assertEquals(1, count);
    }

    @Test
    public void lostVirtualLeaseDoesNotDiscardUnconfirmedCleanupIdentity() {
        AgentSessionState.Config virtual = new AgentSessionState.Config(10, 60000L, 5000L, 3, 3,
                "legacy", "full-page", "virtual", "com.example.demo");
        AgentSessionState.StartResult started = start("owner-token-a-12345", virtual);
        assertTrue(lease.release(started.leaseOwner));
        assertEquals("lease_lost", state.workConfig(started.sessionId, started.ownerToken).errorCode);
        assertEquals(Boolean.FALSE, state.snapshot().get("leaseHeld"));
        assertEquals(Boolean.TRUE, state.snapshot().get("cleanupPending"));
        assertEquals("cleanup_unconfirmed", state.start("owner-token-b-12345", config()).errorCode);
        assertEquals("lease_lost", state.retryCleanup(started.sessionId, started.ownerToken).errorCode);
    }

    @Test
    public void uiWorkGuardRejectsWrongOwnerCancellationLeaseLossAndExpiry() {
        AgentSessionState.StartResult first = start("owner-token-a-12345", config());
        assertFalse(state.workConfig(first.sessionId, "owner-token-b-12345").success);
        assertTrue(state.workConfig(first.sessionId, first.ownerToken).success);
        assertFalse(state.workLeaseOwner(first.sessionId, "owner-token-b-12345").success);
        assertEquals(first.leaseOwner, state.workLeaseOwner(first.sessionId, first.ownerToken).value);
        state.cancel(first.sessionId, first.ownerToken);
        assertFalse(state.workConfig(first.sessionId, first.ownerToken).success);
        assertFalse(state.workLeaseOwner(first.sessionId, first.ownerToken).success);

        AgentSessionState.StartResult second = start("owner-token-b-12345", config());
        lease.release(second.leaseOwner);
        assertEquals("lease_lost", state.workConfig(second.sessionId, second.ownerToken).errorCode);
        assertEquals(AgentSessionState.STATE_FAILED, state.snapshot().get("state"));

        AgentSessionState.StartResult third = start("owner-token-c-12345", config());
        clock.advance(60_000L);
        assertFalse(state.workConfig(third.sessionId, third.ownerToken).success);
        assertEquals(AgentSessionState.STATE_EXPIRED, state.snapshot().get("state"));
    }

    @Test
    public void uiWorkPollingDoesNotExtendIdleDeadline() {
        AgentSessionState.StartResult started = start("owner-token-a-12345", config());
        Object lastActivity = state.snapshot().get("lastActivityAt");
        clock.advance(10L);
        assertTrue(state.workConfig(started.sessionId, started.ownerToken).success);
        assertEquals(lastActivity, state.snapshot().get("lastActivityAt"));
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
    public void stalePageDiagnosticPreservesRejectionAndPersistsOnceWithoutOwnerToken() {
        final List<Map<String, Object>> persisted = new ArrayList<>();
        state = new AgentSessionState(clock, lease, ids, new AgentSessionState.EventSink() {
            @Override
            public void append(Map<String, Object> event) {
                persisted.add(event);
            }
        });
        AgentSessionState.StartResult start = start("owner-token-a-12345", config());
        AgentSessionState.Observation observation = observe(start, "tree-before");
        Map<String, Object> freshPage = singleton("packageName", "com.example.orders");
        AgentSessionState.Action back = AgentSessionState.Action.of(
                "back", Collections.<String, Object>emptyMap());

        AgentSessionState.BeginResult rejected = state.beginAction(start.sessionId,
                "owner-token-a-12345", "step-stale", observation.observationId,
                "tree-after", back, freshPage);

        assertFalse(rejected.accepted);
        assertEquals("stale_observation", rejected.receipt.errorCode);
        assertEquals(0, state.getAcceptedStepCount());
        assertEquals(AgentSessionState.STATE_ACTIVE, state.snapshot().get("state"));
        assertTrue(lease.isOwnedBy(start.leaseOwner));
        Map<String, Object> event = persisted.get(persisted.size() - 1);
        assertEquals("stale_observation_diagnostic", event.get("type"));
        assertEquals(start.sessionId, event.get("sessionId"));
        assertEquals("step-stale", event.get("stepId"));
        assertEquals(observation.observationId, event.get("observationId"));
        Map<?, ?> details = (Map<?, ?>) event.get("details");
        assertEquals("tree-before", details.get("expectedSignature"));
        assertEquals("tree-after", details.get("currentSignature"));
        assertEquals(observation.observationId, details.get("currentObservationId"));
        assertEquals(freshPage, details.get("freshPage"));
        assertFalse(event.toString().contains("ownerToken"));
        assertFalse(event.toString().contains("owner-token-a-12345"));

        int eventCount = persisted.size();
        AgentSessionState.BeginResult duplicate = state.beginAction(start.sessionId,
                "owner-token-a-12345", "step-stale", observation.observationId,
                "another-tree", back, singleton("text", "later page"));
        assertTrue(duplicate.duplicate);
        assertEquals(eventCount, persisted.size());
    }

    @Test
    public void diagnosticCannotBeWrittenByWrongOwnerOrSessionAndDoesNotAffectValidAction() {
        AgentSessionState.StartResult start = start("owner-token-a-12345", config());
        AgentSessionState.Observation observation = observe(start, "tree-before");
        AgentSessionState.Action back = AgentSessionState.Action.of(
                "back", Collections.<String, Object>emptyMap());
        Map<String, Object> freshPage = singleton("packageName", "com.example.orders");
        int eventCount = state.timeline(start.sessionId, "owner-token-a-12345").value.size();

        AgentSessionState.BeginResult wrongOwner = state.beginAction(start.sessionId,
                "owner-token-b-12345", "step-wrong-owner", observation.observationId,
                "tree-after", back, freshPage);
        AgentSessionState.BeginResult wrongSession = state.beginAction("other-session",
                "owner-token-a-12345", "step-wrong-session", observation.observationId,
                "tree-after", back, freshPage);

        assertEquals("owner_mismatch", wrongOwner.receipt.errorCode);
        assertEquals("session_not_found", wrongSession.receipt.errorCode);
        assertEquals(eventCount, state.timeline(start.sessionId, "owner-token-a-12345").value.size());

        AgentSessionState.BeginResult accepted = state.beginAction(start.sessionId,
                "owner-token-a-12345", "step-valid", observation.observationId,
                "tree-before", back, freshPage);
        assertTrue(accepted.accepted);
        List<Map<String, Object>> timeline = state.timeline(start.sessionId, "owner-token-a-12345").value;
        assertEquals(eventCount + 1, timeline.size());
        assertEquals("action_accepted", timeline.get(timeline.size() - 1).get("type"));
    }

    @Test
    public void sourceIdRefreshAllowsCurrentObservationButStillRejectsOldObservationId() {
        AgentSessionState.StartResult start = start("owner-token-a-12345", config());
        String observed = AgentSessionSchemeResolver.signature(
                AgentSessionSchemeResolverTest.accessibilityPage("source-before"));
        String fresh = AgentSessionSchemeResolver.signature(
                AgentSessionSchemeResolverTest.accessibilityPage("source-after"));
        AgentSessionState.Observation old = observe(start, observed);
        AgentSessionState.Observation current = observe(start, observed);
        AgentSessionState.Action click = AgentSessionState.Action.of(
                "click", singleton("nodeId", "node-1"));

        AgentSessionState.BeginResult stale = state.beginAction(start.sessionId,
                "owner-token-a-12345", "step-old-frame", old.observationId, fresh, click);
        assertFalse(stale.accepted);
        assertEquals("stale_observation", stale.receipt.errorCode);
        AgentSessionState.BeginResult accepted = state.beginAction(start.sessionId,
                "owner-token-a-12345", "step-current-frame", current.observationId, fresh, click);
        assertTrue(accepted.accepted);
        assertEquals(1, state.getAcceptedStepCount());
    }

    @Test
    public void semanticPageChangesStillRejectActionsAsStale() {
        AgentSessionState.StartResult start = start("owner-token-a-12345", config());
        String observed = AgentSessionSchemeResolver.signature(
                AgentSessionSchemeResolverTest.accessibilityPage("source-before"));
        AgentSessionState.Observation observation = observe(start, observed);
        AgentSessionState.Action click = AgentSessionState.Action.of(
                "click", singleton("nodeId", "node-1"));
        String[] fields = {"text", "packageName", "resourceId", "description", "isEnabled", "isClickable", "nodeBound"};
        for (String field : fields) {
            JSONObject changed = AgentSessionSchemeResolverTest.accessibilityPage("source-after");
            if ("nodeBound".equals(field)) {
                changed.getJSONObject(field).put("left", 1);
            } else {
                Object value = changed.get(field);
                changed.put(field, value instanceof Boolean ? !((Boolean) value) : "changed");
            }
            AgentSessionState.BeginResult rejected = state.beginAction(start.sessionId,
                    "owner-token-a-12345", "step-changed-" + field, observation.observationId,
                    AgentSessionSchemeResolver.signature(changed), click);
            assertFalse(field, rejected.accepted);
            assertEquals("stale_observation", rejected.receipt.errorCode);
        }
        assertEquals(0, state.getAcceptedStepCount());
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
        private boolean failRelease;

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
            if (failRelease || !isOwnedBy(expectedOwner)) {
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
