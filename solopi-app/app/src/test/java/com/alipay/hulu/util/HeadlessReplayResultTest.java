package com.alipay.hulu.util;

import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.scheme.HarnessState;
import com.alipay.hulu.service.ReplaySessionLease;

import org.junit.After;
import org.junit.Test;

import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.*;

public class HeadlessReplayResultTest {
    private String runId;
    private String owner;

    @After public void releaseOwner() {
        if (runId != null && HarnessState.isActive(runId)) {
            HarnessState.failActive(runId, "test cleanup");
        }
        ReplaySessionLease.release(owner);
    }

    @Test
    @SuppressWarnings("unchecked")
    public void passingResultRetainsReportEvidenceWithoutActivityContext() {
        start();
        ReplayResultBean bean = new ReplayResultBean();
        bean.setCaseName("headless-case");
        bean.setLogFile("/test-evidence/replay.log");
        CaseReplayUtil.HEADLESS_REPLAY_LISTENER.onFinish(Collections.singletonList(bean), null);
        Map<String, Object> state = HarnessState.snapshot();
        assertEquals(HarnessState.STATE_PASSED, state.get("state"));
        assertEquals(Boolean.TRUE, state.get("terminal"));
        List<Map<String, Object>> results = (List<Map<String, Object>>) state.get("results");
        assertEquals("/test-evidence/replay.log", results.get(0).get("logFile"));
        // Completion must not release control while the manager is still cleaning up.
        assertTrue(ReplaySessionLease.isOwnedBy(owner));
    }

    @Test
    public void failedAssertionRemainsFailedWithoutResultScreen() {
        start();
        ReplayResultBean bean = new ReplayResultBean();
        bean.setExceptionMessage("frozen assertion mismatch");
        bean.setExceptionStep(2);
        CaseReplayUtil.HEADLESS_REPLAY_LISTENER.onFinish(Collections.singletonList(bean), null);
        assertEquals(HarnessState.STATE_FAILED, HarnessState.snapshot().get("state"));
    }

    @Test
    public void emptyResultCannotBeReportedAsSuccess() {
        start();
        CaseReplayUtil.HEADLESS_REPLAY_LISTENER.onFinish(Collections.<ReplayResultBean>emptyList(), null);
        assertEquals(HarnessState.STATE_FAILED, HarnessState.snapshot().get("state"));
    }

    private void start() {
        runId = HarnessState.start("headless-case", "headless-result-test");
        assertNotNull(runId);
        owner = HarnessState.getReplayLeaseOwner(runId);
        assertTrue(ReplaySessionLease.isOwnedBy(owner));
    }
}
