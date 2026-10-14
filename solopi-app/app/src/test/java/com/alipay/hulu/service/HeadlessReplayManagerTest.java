package com.alipay.hulu.service;

import android.content.Context;

import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.bean.ReplayStepInfoBean;
import com.alipay.hulu.replay.AbstractStepProvider;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.action.UIOperationMessage;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;
import com.alipay.hulu.shared.node.utils.PrepareUtil;

import org.junit.After;
import org.junit.Test;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Collections;
import java.util.List;

import static org.junit.Assert.*;

/** Exercises headless lifecycle decisions without an Activity, Service, binder or overlay permission. */
public class HeadlessReplayManagerTest {
    private String owner;

    @After
    public void releaseOwner() {
        ReplaySessionLease.release(owner);
    }

    @Test
    public void legacyOverloadsKeepInteractiveMode() {
        CapturingManager manager = new CapturingManager();
        FixtureProvider provider = new FixtureProvider();
        assertTrue(manager.start(provider, null));
        assertFalse(manager.requestedHeadless);
        assertTrue(manager.start(provider, null, "existing-owner"));
        assertFalse(manager.requestedHeadless);
        assertTrue(manager.start(provider, null, "existing-owner", false));
        assertFalse(manager.requestedHeadless);
        assertEquals(Boolean.FALSE, manager.restartOverride);
    }

    @Test
    public void headlessCanStartWithoutBinderButOnlyForExactLiveLease() throws Exception {
        CaseReplayManager manager = ownedManager();
        assertTrue(manager.canStartProcess(owner));
        assertFalse(manager.canStartProcess("another-owner"));
        assertFalse(manager.canStartProcess(null));
        ReplaySessionLease.release(owner);
        assertFalse(manager.canStartProcess(owner));
    }

    @Test
    public void queuedHeadlessStartCannotRestartAfterCancellation() throws Exception {
        CaseReplayManager manager = ownedManager();
        setField(manager, "cancelRequested", true);
        assertFalse(manager.canStartProcess(owner));
        assertTrue(ReplaySessionLease.isOwnedBy(owner));
    }

    @Test
    public void interactiveStillWaitsForFloatingWindowBinder() throws Exception {
        CaseReplayManager manager = ownedManager();
        setField(manager, "headless", false);
        assertFalse(manager.canStartProcess(owner));
    }

    @Test
    public void manualOnlyProviderIsRejectedWithoutTakingDeviceLease() {
        FixtureProvider provider = new FixtureProvider() {
            @Override public boolean canStart() { return false; }
        };
        assertFalse(new CaseReplayManager().start(provider, null, null, false, true));
        owner = ReplaySessionLease.newOwner("after-manual-only-provider");
        assertTrue(ReplaySessionLease.tryAcquire(owner));
    }

    @Test
    public void headlessPreparationRetainsProviderPreparationAndPropagatesFailure() throws Exception {
        PreparationManager manager = new PreparationManager(false);
        FixtureProvider provider = new FixtureProvider();
        setField(manager, "headless", true);
        setField(manager, "provider", provider);
        assertFalse(manager.prepareAction());
        assertEquals(1, provider.prepareCalls);
        assertEquals(1, manager.prepareCalls);
        assertNull(manager.statusCallback);
    }

    @Test
    public void headlessSuccessfulEnvironmentPreparationNeedsNoUiContext() throws Exception {
        PreparationManager manager = new PreparationManager(true);
        setField(manager, "headless", true);
        assertTrue(manager.prepareReplayEnvironment());
        assertEquals(1, manager.prepareCalls);
        assertNull(manager.statusCallback);
    }

    @Test
    public void uiOnlyStepFailsBeforeAcquiringAnyNodeOrOperationService() throws Exception {
        CaseReplayManager manager = new CaseReplayManager();
        setField(manager, "headless", true);
        manager.runningFlag = true;
        OperationStep step = new OperationStep();
        step.setOperationMethod(new OperationMethod(PerformActionEnum.DEVICE_INFO));
        Method processOperation = CaseReplayManager.class.getDeclaredMethod(
                "processOperation", OperationStep.class);
        processOperation.setAccessible(true);
        assertEquals("Interactive replay operation is unavailable in headless mode",
                processOperation.invoke(manager, step));
        assertSame(step, manager.exceptionStep);
        assertFalse(manager.runningFlag);
    }

    @Test
    public void countdownAndDismissMessagesDoNotCancelActualSleep() throws Exception {
        CaseReplayManager manager = new CaseReplayManager();
        setField(manager, "headless", true);
        manager.runningFlag = true;
        UIOperationMessage countdown = new UIOperationMessage();
        countdown.eventType = UIOperationMessage.TYPE_COUNT_DOWN;
        countdown.putParam("time", 5000L);
        manager.receiveDeviceInfoMessage(countdown);
        UIOperationMessage dismiss = new UIOperationMessage();
        dismiss.eventType = UIOperationMessage.TYPE_DISMISS;
        manager.receiveDeviceInfoMessage(dismiss);
        assertTrue(manager.runningFlag);
        assertNull(getField(manager, "headlessExecutionError"));
        // With no Android Application installed this also detects accidental UI scheduling.
        manager.updateFloatIcon(0);
    }

    @Test
    public void interactiveMessageFailsHeadlessResultInsteadOfSilentlyPassing() throws Exception {
        CaseReplayManager manager = new CaseReplayManager();
        setField(manager, "headless", true);
        setField(manager, "provider", new FixtureProvider());
        manager.runningFlag = true;
        UIOperationMessage message = new UIOperationMessage();
        message.eventType = UIOperationMessage.TYPE_DIALOG;
        message.putParam("msg", "not included in the failure message");
        manager.receiveDeviceInfoMessage(message);
        assertFalse(manager.runningFlag);
        assertEquals("Interactive replay operation is unavailable in headless mode",
                manager.collectReplayResults().get(0).getExceptionMessage());
        assertFalse((Boolean) getField(manager, "cancelRequested"));
    }

    @Test
    public void lateUiMessageDoesNotModifyCompletedHeadlessRun() throws Exception {
        CaseReplayManager manager = new CaseReplayManager();
        setField(manager, "headless", true);
        UIOperationMessage message = new UIOperationMessage();
        message.eventType = UIOperationMessage.TYPE_DIALOG;
        manager.receiveDeviceInfoMessage(message);
        assertNull(getField(manager, "headlessExecutionError"));
    }

    @Test
    public void headlessResultCallbackReceivesUnchangedResultsExactlyOnce() throws Exception {
        CaseReplayManager manager = new CaseReplayManager() {
            @Override protected Context getReplayContext() { return null; }
        };
        setField(manager, "headless", true);
        final int[] calls = {0};
        final List<ReplayResultBean> results = Collections.singletonList(new ReplayResultBean());
        setField(manager, "finishListener", new CaseReplayManager.OnFinishListener() {
            @Override public void onFinish(List<ReplayResultBean> actual, Context context) {
                calls[0]++;
                assertSame(results, actual);
                assertNull(context);
            }
        });
        manager.deliverReplayResults(results);
        manager.deliverReplayResults(results);
        assertEquals(1, calls[0]);
    }

    private CaseReplayManager ownedManager() throws Exception {
        owner = ReplaySessionLease.newOwner("headless-test");
        assertTrue(ReplaySessionLease.tryAcquire(owner));
        CaseReplayManager manager = new CaseReplayManager();
        setField(manager, "replayLeaseOwner", owner);
        setField(manager, "headless", true);
        return manager;
    }

    private static void setField(Object target, String name, Object value) throws Exception {
        Field field = CaseReplayManager.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(target, value);
    }

    private static Object getField(Object target, String name) throws Exception {
        Field field = CaseReplayManager.class.getDeclaredField(name);
        field.setAccessible(true);
        return field.get(target);
    }

    private static class CapturingManager extends CaseReplayManager {
        boolean requestedHeadless = true;
        Boolean restartOverride;
        @Override public synchronized boolean start(AbstractStepProvider provider,
                OnFinishListener listener, String expectedOwner, Boolean restart, boolean headless) {
            requestedHeadless = headless;
            restartOverride = restart;
            return true;
        }
    }

    private static class PreparationManager extends CaseReplayManager {
        final boolean prepared;
        int prepareCalls;
        PrepareUtil.PrepareStatus statusCallback;
        PreparationManager(boolean prepared) { this.prepared = prepared; }
        @Override protected boolean prepareTargetApp(PrepareUtil.PrepareStatus status) {
            prepareCalls++;
            statusCallback = status;
            return prepared;
        }
    }

    private static class FixtureProvider extends AbstractStepProvider {
        int prepareCalls;
        @Override public void prepare() { prepareCalls++; super.prepare(); }
        @Override public boolean hasNext() { return false; }
        @Override public OperationStep provideStep() { throw new AssertionError("No step expected"); }
        @Override public boolean reportErrorStep(OperationStep step, String reason,
                                                List<String> callStack) { return true; }
        @Override public void onStepInfo(ReplayStepInfoBean bean) { }
    }
}
