package com.alipay.hulu.virtualscreen;

import org.junit.Test;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class TrustedDisplayLeaseTest {
    private static final class Caller implements TrustedDisplayLease.CallerIdentity {
        int uid = 42;
        @Override public int uid() { return uid; }
    }
    private static final class Screen implements TrustedDisplayLease.Screen {
        final int id; int releases; boolean fail;
        Screen(int id) { this.id = id; }
        @Override public int displayId() { return id; }
        @Override public void release() throws Exception { releases++; if (fail) throw new Exception("release_failed"); }
    }
    private static TrustedDisplayLease.ScreenFactory factory(final Screen screen) {
        return new TrustedDisplayLease.ScreenFactory() {
            @Override public TrustedDisplayLease.Screen create() { return screen; }
        };
    }

    @Test public void onlyOwnerMayCreateAndReleaseItsExactScreen() throws Exception {
        Caller caller = new Caller(); TrustedDisplayLease lease = new TrustedDisplayLease(42, caller);
        Screen owned = new Screen(7);
        caller.uid = 43;
        try { lease.create(factory(owned)); fail(); } catch (SecurityException expected) { }
        caller.uid = 42;
        assertEquals(7, lease.create(factory(owned)));
        try { lease.create(factory(new Screen(8))); fail(); } catch (IllegalStateException expected) { }
        try { lease.release(8); fail(); } catch (SecurityException expected) { }
        caller.uid = 43;
        try { lease.release(7); fail(); } catch (SecurityException expected) { }
        assertEquals(0, owned.releases);
        caller.uid = 42; lease.release(7);
        assertEquals(1, owned.releases);
    }

    @Test public void failedCleanupRetainsScreenAndDeathCleanupCanRetry() throws Exception {
        Caller caller = new Caller(); TrustedDisplayLease lease = new TrustedDisplayLease(42, caller);
        Screen owned = new Screen(9); lease.create(factory(owned)); owned.fail = true;
        try { lease.cleanup(); fail(); } catch (Exception expected) { }
        try { lease.create(factory(new Screen(10))); fail(); } catch (IllegalStateException expected) { }
        owned.fail = false; lease.ownerDied();
        assertEquals(2, owned.releases);
        assertEquals(10, lease.create(factory(new Screen(10))));
    }

    @Test public void invalidDisplayMustBeCleanedAndNeverReturned() throws Exception {
        Caller caller = new Caller(); TrustedDisplayLease lease = new TrustedDisplayLease(42, caller);
        Screen invalid = new Screen(0);
        try { lease.create(factory(invalid)); fail(); } catch (IllegalStateException expected) { }
        assertEquals(1, invalid.releases);
        assertEquals(11, lease.create(factory(new Screen(11))));
    }

    @Test public void competingCreationsCannotOwnTwoScreens() throws Exception {
        final Caller caller = new Caller(); final TrustedDisplayLease lease = new TrustedDisplayLease(42, caller);
        final CountDownLatch ready = new CountDownLatch(2), start = new CountDownLatch(1);
        final AtomicInteger success = new AtomicInteger(), rejected = new AtomicInteger();
        Runnable run = new Runnable() {
            @Override public void run() {
                ready.countDown();
                try {
                    if (!start.await(3, TimeUnit.SECONDS)) return;
                    lease.create(factory(new Screen(12)));
                    success.incrementAndGet();
                } catch (IllegalStateException expected) { rejected.incrementAndGet(); }
                catch (Exception unexpected) { throw new AssertionError(unexpected); }
            }
        };
        Thread a = new Thread(run), b = new Thread(run); a.start(); b.start();
        assertTrue(ready.await(3, TimeUnit.SECONDS)); start.countDown(); a.join(3000); b.join(3000);
        assertFalse(a.isAlive()); assertFalse(b.isAlive());
        assertEquals(1, success.get()); assertEquals(1, rejected.get());
        lease.cleanup();
    }
}
