package com.alipay.hulu.shared.node.utils;

import org.junit.Test;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class AppUtilTest {
    private static final String PACKAGE = "com.example.target";

    @Test
    public void acceptsLegacyAndModernTaskHeaders() {
        assertEquals(Integer.valueOf(42), AppUtil.findTaskId(
                "    * TaskRecord{abc123 #42 A=com.example.target U=0 sz=2}", PACKAGE));
        assertEquals(Integer.valueOf(1069), AppUtil.findTaskId(
                "    * Task{3e8990 #1069 type=standard A=10322:com.example.target U=0 visible=true}",
                PACKAGE));
        assertEquals(Integer.valueOf(3), AppUtil.findTaskId(
                "Task{ab3 #3 A=com.example.target}", PACKAGE));
    }

    @Test
    public void rejectsPackagePrefixesSuffixesAndInvalidUidPrefixes() {
        String dump = "* Task{a #1 A=com.example.target.other}\n"
                + "* Task{b #2 A=not.com.example.target}\n"
                + "* Task{c #3 A=com.example.target:remote}\n"
                + "* Task{d #4 A=uid:com.example.target}\n"
                + "* Task{e #5 A=10322:com.example.target.other}";
        assertNull(AppUtil.findTaskId(dump, PACKAGE));
    }

    @Test
    public void ignoresActivityIntentAndNestedTaskReferences() {
        String dump = "* Hist #0: ActivityRecord{abc #42 A=com.example.target}\n"
                + "mResumedActivity: ActivityRecord{abc Task{def #43 A=com.example.target}}\n"
                + "  intent={cmp=com.example.target/.MainActivity}\n"
                + "  rootTask=Task{ab #44 A=com.example.target}\n"
                + "* Task{cd #45 A=com.example.other} nested=Task{ef #46 A=com.example.target}";
        assertNull(AppUtil.findTaskId(dump, PACKAGE));
    }

    @Test
    public void skipsMalformedIdsAndKeepsFirstMatchingTaskOrder() {
        String dump = "* Task{a #99999999999999999999 A=com.example.target}\r\n"
                + "* Task{b #bad A=com.example.target}\r\n"
                + "* Task{c #-1 A=com.example.target}\r\n"
                + "* Task{d #72 A=10322:com.example.target}\r\n"
                + "* TaskRecord{e #18 A=com.example.target}";
        assertEquals(Integer.valueOf(72), AppUtil.findTaskId(dump, PACKAGE));
    }

    @Test
    public void missingDumpPackageOrAffinityDoesNotSelectTask() {
        assertNull(AppUtil.findTaskId(null, PACKAGE));
        assertNull(AppUtil.findTaskId("", PACKAGE));
        assertNull(AppUtil.findTaskId("* Task{a #1 A=com.example.target}", null));
        assertNull(AppUtil.findTaskId("* Task{a #1 A=com.example.target}", ""));
        assertNull(AppUtil.findTaskId("* Task{a #1 I=com.example.target/.MainActivity}", PACKAGE));
    }

    @Test
    public void backgroundCallerWaitsUntilUiMoveCompletes() throws Exception {
        final CountDownLatch started = new CountDownLatch(1);
        final CountDownLatch release = new CountDownLatch(1);
        final CountDownLatch returned = new CountDownLatch(1);
        final AtomicBoolean result = new AtomicBoolean();
        final AtomicReference<Throwable> failure = new AtomicReference<>();
        Thread caller = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    result.set(AppUtil.moveTaskAndWait(new Runnable() {
                        @Override
                        public void run() {
                            started.countDown();
                            try {
                                if (!release.await(2, TimeUnit.SECONDS)) {
                                    throw new IllegalStateException("test did not release task move");
                                }
                            } catch (InterruptedException e) {
                                Thread.currentThread().interrupt();
                                throw new IllegalStateException(e);
                            }
                        }
                    }, new Executor() {
                        @Override
                        public void execute(Runnable command) {
                            new Thread(command).start();
                        }
                    }, false, 2000));
                } catch (Throwable e) {
                    failure.set(e);
                } finally {
                    returned.countDown();
                }
            }
        });
        caller.start();
        try {
            assertTrue(started.await(1, TimeUnit.SECONDS));
            assertFalse(returned.await(30, TimeUnit.MILLISECONDS));
        } finally {
            release.countDown();
            caller.join(2000);
        }
        assertTrue(returned.await(1, TimeUnit.SECONDS));
        assertNull(failure.get());
        assertTrue(result.get());
    }

    @Test
    public void mainThreadRunsDirectlyAndDoesNotQueueWork() throws Exception {
        final AtomicBoolean moved = new AtomicBoolean();
        assertTrue(AppUtil.moveTaskAndWait(new Runnable() {
            @Override
            public void run() {
                moved.set(true);
            }
        }, new Executor() {
            @Override
            public void execute(Runnable command) {
                throw new AssertionError("main thread must not queue work to itself");
            }
        }, true, 100));
        assertTrue(moved.get());
    }

    @Test(timeout = 1000)
    public void uiFailureReleasesWaiterWithoutSuccess() throws Exception {
        assertFalse(AppUtil.moveTaskAndWait(new Runnable() {
            @Override
            public void run() {
                throw new SecurityException("task cannot be moved");
            }
        }, new Executor() {
            @Override
            public void execute(Runnable command) {
                command.run();
            }
        }, false, 10_000));
    }

    @Test
    public void timeoutDoesNotRunQueuedMoveLater() throws Exception {
        final AtomicReference<Runnable> queued = new AtomicReference<>();
        final AtomicBoolean moved = new AtomicBoolean();
        assertFalse(AppUtil.moveTaskAndWait(new Runnable() {
            @Override
            public void run() {
                moved.set(true);
            }
        }, new Executor() {
            @Override
            public void execute(Runnable command) {
                queued.set(command);
            }
        }, false, 1));
        queued.get().run();
        assertFalse(moved.get());
    }

    @Test
    public void interruptedWaitCancelsQueuedMove() throws Exception {
        final AtomicReference<Runnable> queued = new AtomicReference<>();
        final AtomicBoolean moved = new AtomicBoolean();
        boolean interrupted = false;
        Thread.currentThread().interrupt();
        try {
            AppUtil.moveTaskAndWait(new Runnable() {
                @Override
                public void run() {
                    moved.set(true);
                }
            }, new Executor() {
                @Override
                public void execute(Runnable command) {
                    queued.set(command);
                }
            }, false, 1000);
        } catch (InterruptedException expected) {
            interrupted = true;
        } finally {
            Thread.interrupted();
        }
        assertTrue(interrupted);
        queued.get().run();
        assertFalse(moved.get());
    }
}
