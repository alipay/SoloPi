package com.alipay.hulu.scheme;

import com.alipay.hulu.service.ReplaySessionLease;

import org.junit.After;
import org.junit.Test;

import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class HarnessStateTest {
    private String activeRunId;
    private String blockingLeaseOwner;

    @After
    public void finishActiveRun() {
        if (activeRunId != null && HarnessState.isActive(activeRunId)) {
            HarnessState.failActive(activeRunId, "test cleanup");
        }
        ReplaySessionLease.release(blockingLeaseOwner);
    }

    @Test
    public void cancelRequiresExactRunAndReachesTerminalState() {
        activeRunId = HarnessState.start("counter-case", "request-counter");
        assertNotNull(activeRunId);
        assertNull(HarnessState.start("competing-case", "request-competing"));
        assertFalse(HarnessState.requestCancel("different-run"));
        assertTrue(HarnessState.requestCancel(activeRunId));

        Map<String, Object> requested = HarnessState.snapshot();
        assertEquals("request-counter", requested.get("requestId"));
        assertEquals(HarnessState.STATE_CANCEL_REQUESTED, requested.get("state"));
        assertEquals(Boolean.TRUE, requested.get("active"));

        HarnessState.finishCancellation(activeRunId);

        Map<String, Object> cancelled = HarnessState.snapshot();
        assertEquals(HarnessState.STATE_CANCELLED, cancelled.get("state"));
        assertEquals(Boolean.FALSE, cancelled.get("active"));
        assertEquals(Boolean.TRUE, cancelled.get("terminal"));
        activeRunId = null;
    }

    @Test
    public void failureIgnoresWrongRunAndReleasesReplayLease() {
        activeRunId = HarnessState.start("failing-case", "request-failing");
        assertNotNull(activeRunId);

        HarnessState.failActive("different-run", "wrong failure");
        assertTrue(HarnessState.isActive(activeRunId));

        HarnessState.failActive(activeRunId, "expected failure");
        Map<String, Object> failed = HarnessState.snapshot();
        assertEquals(HarnessState.STATE_FAILED, failed.get("state"));
        assertEquals("expected failure", failed.get("error"));
        assertEquals(Boolean.TRUE, failed.get("terminal"));

        activeRunId = HarnessState.start("next-case", "request-next");
        assertNotNull(activeRunId);
    }

    @Test
    public void leaseConflictPublishesRequestBoundFailure() {
        blockingLeaseOwner = ReplaySessionLease.newOwner("ui-test");
        assertTrue(ReplaySessionLease.tryAcquire(blockingLeaseOwner));

        assertNull(HarnessState.start("blocked-case", "request-blocked"));

        Map<String, Object> failed = HarnessState.snapshot();
        assertEquals("request-blocked", failed.get("requestId"));
        assertEquals("blocked-case", failed.get("caseName"));
        assertEquals(HarnessState.STATE_FAILED, failed.get("state"));
        assertEquals(Boolean.FALSE, failed.get("active"));
        assertEquals(Boolean.TRUE, failed.get("terminal"));
    }
}
