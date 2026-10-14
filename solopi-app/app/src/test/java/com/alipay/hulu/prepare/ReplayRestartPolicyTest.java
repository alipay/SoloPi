package com.alipay.hulu.prepare;

import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.shared.node.utils.PrepareUtil;
import com.alipay.hulu.shared.node.utils.prepare.PrepareWorker;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class ReplayRestartPolicyTest {
    private Field workersField;
    private Field initializedField;
    private Object previousWorkers;
    private boolean previousInitialized;
    private int previousLogLevel;

    @Before
    public void isolatePrepareWorkers() throws Exception {
        workersField = PrepareUtil.class.getDeclaredField("PREPARE_WORKERS");
        workersField.setAccessible(true);
        initializedField = PrepareUtil.class.getDeclaredField("initialized");
        initializedField.setAccessible(true);
        previousWorkers = workersField.get(null);
        previousInitialized = initializedField.getBoolean(null);
        initializedField.setBoolean(null, true);
        previousLogLevel = LogUtil.LOG_LEVEL;
        LogUtil.LOG_LEVEL = Integer.MAX_VALUE;
    }

    @After
    public void restorePrepareWorkers() throws Exception {
        workersField.set(null, previousWorkers);
        initializedField.setBoolean(null, previousInitialized);
        LogUtil.LOG_LEVEL = previousLogLevel;
    }

    @Test
    public void explicitPolicyDoesNotReadOrChangeGlobalPreferences() {
        // SharedPreferences is deliberately uninitialized in this JVM test.
        assertFalse(PrepareUtil.shouldRestartApp(false));
        assertTrue(PrepareUtil.shouldRestartApp(true));
    }

    @Test
    public void policyIsPassedPerInvocationAndDoesNotLeakToLegacyCall() throws Exception {
        final List<Boolean> policies = new ArrayList<>();
        PrepareWorker worker = new PrepareWorker() {
            @Override
            public boolean doPrepareWork(String target, PrepareUtil.PrepareStatus status) {
                throw new AssertionError("Policy-aware path must be used");
            }

            @Override
            public boolean doPrepareWork(String target, PrepareUtil.PrepareStatus status,
                                         Boolean restartApp) {
                policies.add(restartApp);
                return true;
            }
        };
        workersField.set(null, Arrays.asList(worker));

        assertTrue(PrepareUtil.doPrepareWork("test.app", null, false));
        assertTrue(PrepareUtil.doPrepareWork("test.app", null, true));
        assertTrue(PrepareUtil.doPrepareWork("test.app", null));
        assertEquals(Arrays.asList(false, true, null), policies);
    }

    @Test
    public void noRestartRunsOnlyTaskResumeAndSkipsStopClearAndLauncher() throws Exception {
        final List<String> resumed = new ArrayList<>();
        StopAppPreparer stop = new StopAppPreparer() {
            @Override
            protected boolean resumeTargetApp(String targetApp) {
                resumed.add(targetApp);
                return true;
            }
        };
        workersField.set(null, Arrays.asList(stop, new StartAppPreparer()));

        // Any stop/clear/start or preference access would hit an Android JVM stub and fail.
        assertTrue(PrepareUtil.doPrepareWork("test.app", null, false));
        assertEquals(Arrays.asList("test.app"), resumed);
    }

    @Test
    public void failedTaskResumeFailsPreparationBeforeLauncher() throws Exception {
        StopAppPreparer stop = new StopAppPreparer() {
            @Override
            protected boolean resumeTargetApp(String targetApp) {
                return false;
            }
        };
        workersField.set(null, Arrays.asList(stop, new StartAppPreparer()));
        assertFalse(PrepareUtil.doPrepareWork("test.app", null, false));
    }

    @Test
    public void legacyWorkerStillParticipatesWithAnExplicitPolicy() throws Exception {
        final List<String> targets = new ArrayList<>();
        workersField.set(null, Arrays.asList(new PrepareWorker() {
            @Override
            public boolean doPrepareWork(String target, PrepareUtil.PrepareStatus status) {
                targets.add(target);
                return true;
            }
        }));
        assertTrue(PrepareUtil.doPrepareWork("test.app", null, false));
        assertEquals(Arrays.asList("test.app"), targets);
    }

    @Test
    public void failedPreparationStopsFollowingWorkers() throws Exception {
        final List<String> calls = new ArrayList<>();
        PrepareWorker fail = new PrepareWorker() {
            @Override
            public boolean doPrepareWork(String target, PrepareUtil.PrepareStatus status) {
                calls.add("failed");
                return false;
            }
        };
        PrepareWorker next = new PrepareWorker() {
            @Override
            public boolean doPrepareWork(String target, PrepareUtil.PrepareStatus status) {
                calls.add("unexpected");
                return true;
            }
        };
        workersField.set(null, Arrays.asList(fail, next));
        assertFalse(PrepareUtil.doPrepareWork("test.app", null, false));
        assertEquals(Arrays.asList("failed"), calls);
    }
}
