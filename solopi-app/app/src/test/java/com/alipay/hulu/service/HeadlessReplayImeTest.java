package com.alipay.hulu.service;

import com.alipay.hulu.bean.ReplayStepInfoBean;
import com.alipay.hulu.replay.AbstractStepProvider;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;

import org.junit.Test;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;

import static org.junit.Assert.*;

public class HeadlessReplayImeTest {
    @Test
    public void headlessPreparationAndReadOnlySegmentsNeverTouchIme() throws Exception {
        ImeManager manager = manager(true);
        assertTrue(manager.prepareAction());
        for (PerformActionEnum action : new PerformActionEnum[] {
                PerformActionEnum.ASSERT, PerformActionEnum.ASSERT_TOAST,
                PerformActionEnum.CHECK_NODE, PerformActionEnum.CHECK,
                PerformActionEnum.LET_NODE, PerformActionEnum.LET,
                PerformActionEnum.SLEEP_UNTIL, PerformActionEnum.SLEEP,
                PerformActionEnum.SCREENSHOT }) {
            assertFalse(CaseReplayManager.requiresPreparedIme(action));
        }
        manager.restoreReplayIme();
        assertEquals(0, manager.reads);
        assertTrue(manager.applied.isEmpty());
    }

    @Test
    public void interactivePreparationRetainsEagerImeSetup() throws Exception {
        ImeManager manager = manager(false);
        assertTrue(manager.prepareAction());
        assertEquals(1, manager.reads);
        assertEquals(1, manager.applied.size());
        manager.restoreReplayIme();
        assertEquals("example/.Keyboard", manager.applied.get(1));
    }

    @Test
    public void allInputAndPluginActionsRetainPreparedEnvironment() {
        for (PerformActionEnum action : new PerformActionEnum[] {
                PerformActionEnum.INPUT, PerformActionEnum.INPUT_SEARCH,
                PerformActionEnum.CLICK_AND_INPUT, PerformActionEnum.INPUT_GLOBAL,
                PerformActionEnum.KEYBOARD_INPUT, PerformActionEnum.OTHER_NODE,
                PerformActionEnum.OTHER_GLOBAL, PerformActionEnum.EXECUTE_SHELL,
                PerformActionEnum.CLICK }) {
            assertTrue(CaseReplayManager.requiresPreparedIme(action));
        }
        assertTrue(CaseReplayManager.requiresPreparedIme(null));
    }

    @Test
    public void invalidDefaultImeNeverSwitchesOrRestoresGuessedValue() {
        for (String original : new String[] {null, "", "  ", "null", " null\n"}) {
            ImeManager manager = new ImeManager();
            manager.original = original;
            assertFalse(manager.prepareReplayIme());
            manager.restoreReplayIme();
            assertTrue(manager.applied.isEmpty());
        }
    }

    @Test
    public void defaultImeReadFailureCannotCauseAnInventedRestore() throws Exception {
        ImeManager manager = manager(true);
        manager.failRead = true;
        try {
            manager.prepareReplayIme();
            fail("Query failure must abort preparation");
        } catch (IllegalStateException expected) {
            manager.restoreReplayIme();
            assertTrue(manager.applied.isEmpty());
        }
    }

    @Test
    public void failedPreparationDoesNotPrepareIme() throws Exception {
        ImeManager manager = manager(true);
        manager.prepared = false;
        assertFalse(manager.prepareAction());
        manager.restoreReplayIme();
        assertEquals(0, manager.reads);
        assertTrue(manager.applied.isEmpty());
    }

    @Test
    public void switchExceptionRestoresRecordedOriginal() {
        ImeManager manager = new ImeManager();
        manager.failNextSwitch = true;
        assertFalse(manager.prepareReplayIme());
        assertEquals(2, manager.applied.size());
        assertEquals("example/.Keyboard", manager.applied.get(1));
        manager.restoreReplayIme();
        assertEquals(2, manager.applied.size());
    }

    @Test
    public void cancelOrExceptionalDestroyRestoresOnlyOnceAndReleasesLease() throws Exception {
        ImeManager manager = manager(true);
        String owner = ReplaySessionLease.newOwner("ime-test");
        assertTrue(ReplaySessionLease.tryAcquire(owner));
        try {
            set(manager, "replayLeaseOwner", owner);
            assertTrue(manager.prepareReplayIme());
            assertTrue(manager.prepareReplayIme());
            set(manager, "cancelRequested", true);
            manager.onDestroy(null);
            assertEquals(1, manager.reads);
            assertEquals(2, manager.applied.size());
            assertEquals("example/.Keyboard", manager.applied.get(1));
            assertFalse(ReplaySessionLease.isOwnedBy(owner));
            manager.restoreReplayIme();
            assertEquals(2, manager.applied.size());
        } finally {
            ReplaySessionLease.release(owner);
        }
    }

    @Test
    public void restorationFailureDoesNotPreventLeaseRelease() throws Exception {
        ImeManager manager = manager(true);
        String owner = ReplaySessionLease.newOwner("ime-test-failed-restore");
        assertTrue(ReplaySessionLease.tryAcquire(owner));
        try {
            set(manager, "replayLeaseOwner", owner);
            assertTrue(manager.prepareReplayIme());
            manager.failNextSwitch = true;
            manager.onDestroy(null);
            assertFalse(ReplaySessionLease.isOwnedBy(owner));
        } finally {
            ReplaySessionLease.release(owner);
        }
    }

    private static ImeManager manager(boolean headless) throws Exception {
        ImeManager manager = new ImeManager();
        set(manager, "headless", headless);
        set(manager, "provider", new AbstractStepProvider() {
            public boolean hasNext() { return false; }
            public OperationStep provideStep() { throw new AssertionError(); }
            public boolean reportErrorStep(OperationStep step, String reason, List<String> stack) {
                return true;
            }
            public void onStepInfo(ReplayStepInfoBean info) { }
        });
        return manager;
    }

    private static void set(CaseReplayManager manager, String name, Object value) throws Exception {
        Field field = CaseReplayManager.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(manager, value);
    }

    private static class ImeManager extends CaseReplayManager {
        String original = "example/.Keyboard\n";
        int reads;
        boolean prepared = true;
        boolean failRead;
        boolean failNextSwitch;
        List<String> applied = new ArrayList<>();
        @Override protected boolean prepareReplayEnvironment() { return prepared; }
        @Override protected String readDefaultIme() {
            reads++;
            if (failRead) throw new IllegalStateException("test query failure");
            return original;
        }
        @Override protected void applyReplayIme(String ime) {
            applied.add(ime);
            if (failNextSwitch) {
                failNextSwitch = false;
                throw new IllegalStateException("test switch failure");
            }
        }
    }
}
