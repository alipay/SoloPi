package com.alipay.hulu.scheme;

import org.junit.Test;

import static org.junit.Assert.*;

public class AgentUiWaiterTest {
    @Test
    public void slowTransitionGetsOneBoundedObservationExtension() throws Exception {
        final Fixture f = new Fixture();
        f.reader = new AgentUiWaiter.Reader<String>() {
            public AgentUiWaiter.Sample<String> read() {
                return f.sample(f.now < 3_500L ? "loading-" + f.now : "page",
                        0L, -1_000L, true);
            }
        };
        AgentUiWaiter.Result<String> result = f.waiter().awaitWithTransitionGrace(3_000L, 5_000L, "before");
        assertEquals("page", result.value);
        assertEquals(3_700L, result.elapsedMs);
        assertTrue(result.settled);
    }

    @Test
    public void stableNoOpKeepsOriginalBudgetAndPermanentAnimationStillFails() throws Exception {
        final Fixture stable = new Fixture();
        assertEquals(3_000L, stable.waiter().awaitWithTransitionGrace(3_000L, 5_000L, "page").elapsedMs);
        final Fixture changing = new Fixture();
        changing.reader = new AgentUiWaiter.Reader<String>() {
            public AgentUiWaiter.Sample<String> read() {
                return changing.sample("page-" + changing.now, 0L, -1_000L, true);
            }
        };
        AgentUiWaiter.Result<String> result = changing.waiter().awaitWithTransitionGrace(3_000L, 5_000L, "before");
        assertNull(result.value);
        assertEquals(8_000L, result.elapsedMs);
        assertTrue(result.timedOut);
    }

    @Test
    public void alreadyReadyPageNeedsFreshConfirmationButNoFixedFiveHundredMs() throws Exception {
        Fixture f = new Fixture();
        AgentUiWaiter.Result<String> result = f.waiter().await(5_000L, null);
        assertEquals("page", result.value);
        assertEquals(200L, result.elapsedMs);
        assertEquals(3, result.treeSamples);
        assertTrue(result.settled);
        assertFalse(result.timedOut);
    }

    @Test
    public void changedPageCanSettleBeforeLegacyFirstTwoSamples() throws Exception {
        Fixture f = new Fixture();
        AgentUiWaiter.Result<String> result = f.waiter().await(3_000L, "previous-page");
        assertEquals(200L, result.elapsedMs);
        assertEquals("page", result.value);
    }

    @Test
    public void uiEventWithIdenticalTreeRestartsConfirmation() throws Exception {
        final Fixture f = new Fixture();
        f.reader = new AgentUiWaiter.Reader<String>() {
            public AgentUiWaiter.Sample<String> read() {
                return f.sample("page", f.now >= 100L ? 1 : 0,
                        f.now >= 100L ? 100L : -1_000L, true);
            }
        };
        assertEquals(300L, f.waiter().await(1_000L, null).elapsedMs);
    }

    @Test
    public void eventDuringTreeCaptureInvalidatesThatSample() throws Exception {
        final Fixture f = new Fixture();
        f.reader = new AgentUiWaiter.Reader<String>() {
            public AgentUiWaiter.Sample<String> read() {
                return f.now == 0L
                        ? new AgentUiWaiter.Sample<>("page", "page", 0L, 1L, 0L, true)
                        : f.sample("page", 1L, 0L, true);
            }
        };
        assertEquals(300L, f.waiter().await(1_000L, null).elapsedMs);
    }

    @Test
    public void keyboardOrWindowSignatureChangeNeedsNewStableSamples() throws Exception {
        final Fixture f = new Fixture();
        f.reader = new AgentUiWaiter.Reader<String>() {
            public AgentUiWaiter.Sample<String> read() {
                return f.sample(f.now < 100L ? "page+keyboard" : "page+dialog",
                        0L, -1_000L, true);
            }
        };
        AgentUiWaiter.Result<String> result = f.waiter().await(1_000L, "page");
        assertEquals("page+dialog", result.value);
        assertEquals(300L, result.elapsedMs);
    }

    @Test
    public void invalidRootBreaksConsecutiveConfirmation() throws Exception {
        final Fixture f = new Fixture();
        f.reader = new AgentUiWaiter.Reader<String>() {
            public AgentUiWaiter.Sample<String> read() {
                return f.now == 100L ? null : f.sample("page", 0L, -1_000L, true);
            }
        };
        assertEquals(400L, f.waiter().await(1_000L, null).elapsedMs);
    }

    @Test
    public void unchangedPageRetainsFullProgressBudget() throws Exception {
        Fixture f = new Fixture();
        AgentUiWaiter.Result<String> result = f.waiter().await(3_000L, "page");
        assertEquals(3_000L, result.elapsedMs);
        assertEquals("page", result.value);
        assertFalse(result.settled);
        assertTrue(result.timedOut);
    }

    @Test
    public void unknownEventSourceCannotCertifyStability() throws Exception {
        final Fixture f = new Fixture();
        f.reader = new AgentUiWaiter.Reader<String>() {
            public AgentUiWaiter.Sample<String> read() {
                return f.sample("page", 0L, -1_000L, false);
            }
        };
        AgentUiWaiter.Result<String> result = f.waiter().await(500L, null);
        assertNull(result.value);
        assertTrue(result.timedOut);
    }

    @Test
    public void changingPageCannotPassAtDeadline() throws Exception {
        final Fixture f = new Fixture();
        f.reader = new AgentUiWaiter.Reader<String>() {
            public AgentUiWaiter.Sample<String> read() {
                return f.sample("page-" + f.now, 0L, -1_000L, true);
            }
        };
        assertNull(f.waiter().await(500L, "before").value);
    }

    @Test
    public void cancellationBetweenSamplesStopsBeforeAnotherRead() throws Exception {
        final Fixture f = new Fixture();
        f.guard = new AgentUiWaiter.Guard() {
            public void check() { if (f.now >= 100L) throw new AgentUiWaiter.AbortedException(); }
        };
        try {
            f.waiter().await(3_000L, null);
            fail("cancelled session must abort");
        } catch (AgentUiWaiter.AbortedException expected) {
            assertEquals(1, f.reads);
        }
    }

    @Test
    public void cancellationDuringFinalReadCannotReturnObservation() throws Exception {
        final Fixture f = new Fixture();
        f.guard = new AgentUiWaiter.Guard() {
            public void check() { if (f.reads == 3) throw new AgentUiWaiter.AbortedException(); }
        };
        try {
            f.waiter().await(3_000L, null);
            fail("post-capture guard must abort");
        } catch (AgentUiWaiter.AbortedException expected) {
            assertEquals(3, f.reads);
        }
    }

    @Test
    public void threadInterruptionPropagatesWithoutRetry() throws Exception {
        Fixture f = new Fixture();
        f.interruptSleep = true;
        try {
            f.waiter().await(3_000L, null);
            fail("interruption must propagate");
        } catch (InterruptedException expected) {
            assertEquals(1, f.reads);
        }
    }

    private static final class Fixture implements AgentUiWaiter.Clock {
        long now;
        int reads;
        boolean interruptSleep;
        AgentUiWaiter.Guard guard = new AgentUiWaiter.Guard() {
            public void check() { }
        };
        AgentUiWaiter.Reader<String> reader = new AgentUiWaiter.Reader<String>() {
            public AgentUiWaiter.Sample<String> read() {
                return sample("page", 0L, -1_000L, true);
            }
        };

        AgentUiWaiter<String> waiter() {
            return new AgentUiWaiter<>(this, new AgentUiWaiter.Reader<String>() {
                public AgentUiWaiter.Sample<String> read() {
                    reads++;
                    return reader.read();
                }
            }, guard);
        }

        AgentUiWaiter.Sample<String> sample(String signature, long sequence, long lastEvent,
                                            boolean available) {
            return new AgentUiWaiter.Sample<>(signature, signature, sequence, sequence,
                    lastEvent, available);
        }

        @Override public long now() { return now; }
        @Override public void sleep(long durationMs) throws InterruptedException {
            if (interruptSleep) throw new InterruptedException();
            now += durationMs;
        }
    }
}
