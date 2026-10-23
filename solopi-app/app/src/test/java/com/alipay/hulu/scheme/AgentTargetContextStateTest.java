package com.alipay.hulu.scheme;

import com.alibaba.fastjson.JSONObject;
import org.junit.Test;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class AgentTargetContextStateTest {
    @Test
    public void unchangedAdvertisementOverRecyclerTargetIsRejectedInBothStrategies() {
        for (String strategy : new String[] {"full-page", "target-context-v1"}) {
            Fixture fixture = new Fixture(strategy);
            JSONObject page = AgentTargetContextGuardTest.page();
            AgentTargetContextGuardTest.container(page).put("className", "android.support.v7.widget.RecyclerView");
            JSONObject advert = AgentTargetContextGuardTest.node("advert", 0, 0, 1080, 2000);
            advert.put("isClickable", true);
            advert.put("description", "Full-screen advertisement");
            page.getJSONArray("children").add(advert);
            AgentTargetContextGuard.Snapshot snapshot = AgentTargetContextGuardTest.snapshot(page);
            String observation = fixture.state.recordObservation(fixture.started.sessionId, fixture.started.ownerToken,
                    snapshot.signature, Collections.<String, Object>emptyMap()).value.observationId;
            AgentTargetContextGuard.Verification proof = AgentTargetContextGuard.verify(observation,
                    snapshot, snapshot, AgentTargetContextGuardTest.click());
            assertEquals("not_applicable", proof.result);
            AgentSessionState.BeginResult rejected = fixture.state.beginAction(fixture.started.sessionId,
                    fixture.started.ownerToken, "covered", observation, snapshot.signature,
                    AgentTargetContextGuardTest.click(), page, proof);
            assertFalse(strategy, rejected.accepted);
            assertEquals("target_occluded", rejected.receipt.toMap().get("errorCode"));
            assertEquals(0, fixture.state.status(fixture.started.sessionId, fixture.started.ownerToken)
                    .value.get("acceptedSteps"));
            assertTrue(fixture.state.beginAction(fixture.started.sessionId, fixture.started.ownerToken,
                    "covered", observation, snapshot.signature, AgentTargetContextGuardTest.click(), page, proof).duplicate);
        }
    }

    @Test
    public void visibleInteractiveOverlapIsConservativeButHiddenPeersAndLabelsAreAllowed() {
        JSONObject page = AgentTargetContextGuardTest.page();
        JSONObject peer = AgentTargetContextGuardTest.node("overlay", 150, 120, 400, 180);
        peer.put("isClickable", true);
        page.getJSONArray("children").add(peer);
        assertEquals("target_occluded", AgentTargetContextGuard.clickOcclusionReason(page, "node-3", null));
        peer.put("isVisibleToUser", false);
        assertNull(AgentTargetContextGuard.clickOcclusionReason(page, "node-3", null));
        page.getJSONArray("children").remove(2);
        JSONObject label = AgentTargetContextGuardTest.node("label", 150, 120, 400, 180);
        com.alibaba.fastjson.JSONArray labels = new com.alibaba.fastjson.JSONArray();
        label.put("isClickable", true);
        labels.add(label);
        AgentTargetContextGuardTest.target(page).put("children", labels);
        assertNull(AgentTargetContextGuard.clickOcclusionReason(page, "node-3", null));
        assertEquals("target_geometry_unknown", AgentTargetContextGuard.clickOcclusionReason(page, "missing", null));
        // A verified native path survives unrelated DFS node-id changes.
        assertNull(AgentTargetContextGuard.clickOcclusionReason(page, "wrong-id", new int[] {0, 0}));
    }

    @Test
    public void capabilityParserDefaultsStrictlyAndRejectsUnknownStrategy() throws Exception {
        assertEquals("full-page", AgentSessionSchemeResolver.parseActionValidationStrategy(null));
        assertEquals("target-context-v1", AgentSessionSchemeResolver.parseActionValidationStrategy("target-context-v1"));
        for (String invalid : new String[] {"", "fast", "TARGET-CONTEXT-V1", "full-page\n"}) {
            try {
                AgentSessionSchemeResolver.parseActionValidationStrategy(invalid);
                fail("Unknown strategy must fail closed");
            } catch (Exception expected) {
                assertEquals("Unsupported action validation strategy", expected.getMessage());
            }
        }
    }

    @Test
    public void verifiedContextAllowsDifferentFullPageOnlyInOptInSession() {
        Fixture optedIn = new Fixture("target-context-v1");
        assertEquals("target-context-v1", optedIn.started.session.get("actionValidationStrategy"));
        AgentSessionState.BeginResult accepted = optedIn.begin("step", optedIn.started.ownerToken);
        assertTrue(accepted.accepted);
        assertEquals("verified", ((Map<?, ?>) accepted.receipt.toMap().get("actionValidation")).get("result"));
        AgentSessionState.Receipt finished = optedIn.state.finishAction(accepted.generation, "step", true,
                null, AgentSessionState.ObservationInput.of(optedIn.fresh.signature, Collections.<String, Object>emptyMap()));
        assertEquals("succeeded", finished.status);
        assertNotNull(finished.toMap().get("actionValidation"));

        Fixture legacy = new Fixture("full-page");
        assertFalse(legacy.begin("step", legacy.started.ownerToken).accepted);
        assertEquals("full-page", new AgentSessionState.Config(3, 60000, 10000, 3, 3).actionValidationStrategy);
    }

    @Test
    public void missingProofAndSameSignatureSourceReplacementAreStillRejected() {
        Fixture fixture = new Fixture("target-context-v1");
        assertFalse(fixture.state.beginAction(fixture.started.sessionId, fixture.started.ownerToken,
                "no-proof", fixture.observation, fixture.before.signature, AgentTargetContextGuardTest.click()).accepted);
        JSONObject replaced = AgentTargetContextGuardTest.page();
        AgentTargetContextGuardTest.target(replaced).put("id", "replacement");
        AgentTargetContextGuard.Snapshot next = AgentTargetContextGuardTest.snapshot(replaced);
        assertEquals(fixture.before.signature, next.signature);
        AgentTargetContextGuard.Verification proof = AgentTargetContextGuard.verify(fixture.observation,
                fixture.before, next, AgentTargetContextGuardTest.click());
        assertFalse(fixture.state.beginAction(fixture.started.sessionId, fixture.started.ownerToken,
                "replaced", fixture.observation, next.signature, AgentTargetContextGuardTest.click(),
                replaced, proof).accepted);
        assertEquals(0, fixture.state.snapshot().get("acceptedSteps"));
    }

    @Test
    public void localProofCannotBypassOwnerCancellationOrLostLease() {
        Fixture owner = new Fixture("target-context-v1");
        assertFalse(owner.begin("step", "different-owner-token").accepted);
        assertEquals(0, owner.state.snapshot().get("acceptedSteps"));
        Fixture cancelled = new Fixture("target-context-v1");
        cancelled.state.cancel(cancelled.started.sessionId, cancelled.started.ownerToken);
        assertFalse(cancelled.begin("step", cancelled.started.ownerToken).accepted);
        Fixture lostLease = new Fixture("target-context-v1");
        lostLease.lease.owner = null;
        assertFalse(lostLease.begin("step", lostLease.started.ownerToken).accepted);
    }

    @Test
    public void localProofIsBoundToObservationAndCannotCreateExtraActionBudget() {
        Fixture fixture = new Fixture("target-context-v1");
        AgentSessionState.BeginResult first = fixture.begin("step-1", fixture.started.ownerToken);
        assertTrue(first.accepted);
        assertFalse(fixture.begin("step-2", fixture.started.ownerToken).accepted);
        AgentSessionState.Receipt finished = fixture.state.finishAction(first.generation, "step-1", true,
                null, AgentSessionState.ObservationInput.of(fixture.fresh.signature, Collections.<String, Object>emptyMap()));
        String nextObservation = finished.settledObservation.observationId;
        AgentTargetContextGuard.Verification nextProof = AgentTargetContextGuard.verify(nextObservation,
                fixture.fresh, fixture.fresh, AgentTargetContextGuardTest.click());
        AgentSessionState.BeginResult overBudget = fixture.state.beginAction(fixture.started.sessionId,
                fixture.started.ownerToken, "step-3", nextObservation, fixture.fresh.signature,
                AgentTargetContextGuardTest.click(), null, nextProof);
        assertFalse(overBudget.accepted);
        assertEquals("step_budget_exhausted", overBudget.receipt.errorCode);
        assertEquals(1, fixture.state.snapshot().get("acceptedSteps"));
    }

    @Test
    public void nonClickStillRequiresUnchangedFullPageAndRecordsNotApplicable() {
        Fixture fixture = new Fixture("target-context-v1");
        AgentSessionState.Action back = AgentSessionState.Action.of("back", Collections.<String, Object>emptyMap());
        AgentTargetContextGuard.Verification proof = AgentTargetContextGuard.verify(fixture.observation,
                fixture.before, fixture.fresh, back);
        AgentSessionState.BeginResult stale = fixture.state.beginAction(fixture.started.sessionId,
                fixture.started.ownerToken, "back", fixture.observation, fixture.fresh.signature, back,
                null, proof);
        assertFalse(stale.accepted);
        assertEquals("not_applicable", ((Map<?, ?>) stale.receipt.toMap().get("actionValidation")).get("result"));
    }

    @Test
    public void reusableClickRoutesToFullPageOnlyWhenItsBoundPageIsUnchanged() {
        JSONObject page = AgentTargetContextGuardTest.page();
        AgentTargetContextGuardTest.container(page).put("className", "android.widget.ListView");
        Fixture fixture = new Fixture("target-context-v1");
        AgentTargetContextGuard.Snapshot before = AgentTargetContextGuardTest.snapshot(page);
        String observation = fixture.state.recordObservation(fixture.started.sessionId,
                fixture.started.ownerToken, before.signature, Collections.<String, Object>emptyMap())
                .value.observationId;
        AgentSessionState.Action click = AgentTargetContextGuardTest.click();
        JSONObject changed = JSONObject.parseObject(page.toJSONString());
        AgentTargetContextGuardTest.footer(changed).put("text", "animation tick");
        AgentTargetContextGuard.Snapshot fresh = AgentTargetContextGuardTest.snapshot(changed);
        AgentTargetContextGuard.Verification changedProof = AgentTargetContextGuard.verify(
                observation, before, fresh, click);
        assertFalse(fixture.state.beginAction(fixture.started.sessionId, fixture.started.ownerToken,
                "changed", observation, fresh.signature, click, changed, changedProof).accepted);
        AgentTargetContextGuard.Verification proof = AgentTargetContextGuard.verify(
                observation, before, before, click);
        assertFalse(proof.requiresUnchangedFullPage("another-observation", before.signature,
                before.signature, click));
        assertFalse(proof.requiresUnchangedFullPage(observation, before.signature, before.signature,
                AgentSessionState.Action.of("click", Collections.<String, Object>singletonMap("nodeId", "node-4"))));
        AgentSessionState.BeginResult accepted = fixture.state.beginAction(fixture.started.sessionId,
                fixture.started.ownerToken, "unchanged", observation, before.signature, click, page, proof);
        assertTrue(accepted.accepted);
        assertEquals("full-page", ((Map<?, ?>) accepted.receipt.toMap().get("actionValidation")).get("effectiveStrategy"));
    }

    private static final class Fixture {
        final Lease lease = new Lease();
        final AgentSessionState state;
        final AgentSessionState.StartResult started;
        final AgentTargetContextGuard.Snapshot before;
        final AgentTargetContextGuard.Snapshot fresh;
        final String observation;
        final JSONObject page;
        final AgentTargetContextGuard.Verification proof;

        Fixture(String strategy) {
            final AtomicInteger counter = new AtomicInteger();
            state = new AgentSessionState(new AgentSessionState.Clock() {
                @Override public long now() { return 1000L; }
            }, lease, new AgentSessionState.IdGenerator() {
                @Override public String next(String prefix) { return prefix + counter.incrementAndGet(); }
            }, null);
            started = state.start("test-owner-token-12345", new AgentSessionState.Config(1, 60000,
                    10000, 3, 3, "legacy", strategy));
            assertTrue(started.success);
            before = AgentTargetContextGuardTest.snapshot(AgentTargetContextGuardTest.page());
            observation = state.recordObservation(started.sessionId, started.ownerToken,
                    before.signature, Collections.<String, Object>emptyMap()).value.observationId;
            page = AgentTargetContextGuardTest.page();
            AgentTargetContextGuardTest.footer(page).getJSONObject("nodeBound").put("top", 2210);
            fresh = AgentTargetContextGuardTest.snapshot(page);
            proof = AgentTargetContextGuard.verify(observation, before, fresh, AgentTargetContextGuardTest.click());
        }

        AgentSessionState.BeginResult begin(String step, String owner) {
            return state.beginAction(started.sessionId, owner, step, observation, fresh.signature,
                    AgentTargetContextGuardTest.click(), page, proof);
        }
    }

    private static final class Lease implements AgentSessionState.Lease {
        String owner;
        public boolean acquire(String value) { owner = value; return true; }
        public boolean isOwnedBy(String value) { return value.equals(owner); }
        public boolean release(String value) {
            if (!isOwnedBy(value)) { return false; }
            owner = null; return true;
        }
    }
}
