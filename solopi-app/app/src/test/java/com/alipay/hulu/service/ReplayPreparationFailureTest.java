package com.alipay.hulu.service;

import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.bean.ReplayStepInfoBean;
import com.alipay.hulu.replay.AbstractStepProvider;
import com.alipay.hulu.scheme.HarnessState;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;

import org.junit.After;
import org.junit.Test;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

public class ReplayPreparationFailureTest {
    private String runId;
    private String owner;

    @After
    public void releaseLease() {
        if (runId != null && HarnessState.isActive(runId)) {
            HarnessState.failActive(runId, "test cleanup");
        }
        ReplaySessionLease.release(owner);
    }

    @Test
    public void failedPreparationSkipsAllStepsAndReportsFailedTerminalResult() throws Exception {
        runId = HarnessState.start("cleanup-case", "prepare-failed");
        assertNotNull(runId);
        owner = HarnessState.getReplayLeaseOwner(runId);
        FixtureProvider provider = new FixtureProvider();
        FixtureManager manager = new FixtureManager(false);
        setField(manager, "provider", provider);
        setField(manager, "replayLeaseOwner", owner);
        setStatus(manager, "BEFORE_PREPARE");
        manager.runningFlag = true;

        Method process = CaseReplayManager.class.getDeclaredMethod("process");
        process.setAccessible(true);
        process.invoke(manager);

        assertEquals(0, provider.hasNextCalls);
        assertEquals(0, provider.providedSteps);
        assertEquals("FINISH_RUNNING", manager.statusAtFinish);
        assertFalse(manager.isRunning());
        assertFalse(manager.runningFlag);
        assertEquals(-1, manager.results.get(0).getExceptionStep());
        assertEquals("Replay preparation failed; no replay step was executed",
                manager.results.get(0).getExceptionMessage());
        Map<String, Object> state = HarnessState.snapshot();
        assertEquals(HarnessState.STATE_FAILED, state.get("state"));
        assertEquals(Boolean.TRUE, state.get("terminal"));
        assertEquals(Boolean.FALSE, state.get("active"));
        // Reporting leaves the manager's lease intact until its normal teardown completes.
        assertTrue(ReplaySessionLease.isOwnedBy(owner));
    }

    private static void setField(Object target, String name, Object value) throws Exception {
        Field field = CaseReplayManager.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(target, value);
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static void setStatus(Object target, String name) throws Exception {
        Field field = CaseReplayManager.class.getDeclaredField("currentStatus");
        field.setAccessible(true);
        field.set(target, Enum.valueOf((Class) field.getType(), name));
    }

    private static class FixtureManager extends CaseReplayManager {
        final boolean prepared;
        String statusAtFinish;
        List<ReplayResultBean> results;

        FixtureManager(boolean prepared) {
            this.prepared = prepared;
        }

        @Override
        protected boolean prepareAction() {
            return prepared;
        }

        @Override
        protected void suffixAction() {
            try {
                Field field = CaseReplayManager.class.getDeclaredField("currentStatus");
                field.setAccessible(true);
                statusAtFinish = field.get(this).toString();
            } catch (Exception e) {
                throw new AssertionError(e);
            }
            // Exercise the real result marking and Harness terminal state without Android UI.
            results = collectReplayResults();
            HarnessState.complete(results);
        }
    }

    private static class FixtureProvider extends AbstractStepProvider {
        int hasNextCalls;
        int providedSteps;

        @Override public boolean hasNext() { hasNextCalls++; return true; }
        @Override public OperationStep provideStep() { providedSteps++; return null; }
        @Override public boolean reportErrorStep(OperationStep step, String reason,
                                                List<String> callStack) { return true; }
        @Override public void onStepInfo(ReplayStepInfoBean bean) { }
    }
}
