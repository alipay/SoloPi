package com.alipay.hulu.virtualscreen;

import org.junit.Test;
import java.security.SecureRandom;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class TrustedDisplayHandoffTest {
    private static final class Caller implements TrustedDisplayHandoff.CallerIdentity {
        int uid = 2000;
        @Override public int uid() { return uid; }
    }
    private static final class Clock implements TrustedDisplayHandoff.Clock {
        long now = 100;
        @Override public long nowMillis() { return now; }
    }

    @Test public void acceptsOnlyShellAndTheOneTimeSecret() {
        Caller caller = new Caller(); Clock clock = new Clock();
        TrustedDisplayHandoff handoff = new TrustedDisplayHandoff(caller, clock, new SecureRandom());
        byte[] secret = handoff.secretForPrivateTransport(), altered = secret.clone(); altered[0] ^= 1;
        caller.uid = 12345;
        try { handoff.accept(secret); fail(); } catch (SecurityException expected) { }
        caller.uid = 2000;
        try { handoff.accept(altered); fail(); } catch (SecurityException expected) { }
        handoff.accept(secret);
        try { handoff.accept(secret); fail(); } catch (SecurityException expected) { }
        try { handoff.secretForPrivateTransport(); fail(); } catch (IllegalStateException expected) { }
    }

    @Test public void expiresAndZeroesAHandshake() {
        Caller caller = new Caller(); Clock clock = new Clock();
        TrustedDisplayHandoff handoff = new TrustedDisplayHandoff(caller, clock, new SecureRandom());
        byte[] secret = handoff.secretForPrivateTransport(); clock.now += 15001;
        try { handoff.accept(secret); fail(); } catch (SecurityException expected) { }
        try { handoff.secretForPrivateTransport(); fail(); } catch (IllegalStateException expected) { }
    }

    @Test public void onlyOneConcurrentAttachCanConsumeTheSecret() throws Exception {
        final Caller caller = new Caller(); final Clock clock = new Clock();
        final TrustedDisplayHandoff handoff = new TrustedDisplayHandoff(caller, clock, new SecureRandom());
        final byte[] secret = handoff.secretForPrivateTransport();
        final CountDownLatch ready = new CountDownLatch(2), start = new CountDownLatch(1);
        final AtomicInteger accepted = new AtomicInteger(), rejected = new AtomicInteger();
        Runnable attempt = new Runnable() {
            @Override public void run() {
                ready.countDown();
                try {
                    if (!start.await(3, TimeUnit.SECONDS)) return;
                    handoff.accept(secret); accepted.incrementAndGet();
                } catch (SecurityException expected) { rejected.incrementAndGet(); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            }
        };
        Thread a = new Thread(attempt), b = new Thread(attempt); a.start(); b.start();
        assertTrue(ready.await(3, TimeUnit.SECONDS)); start.countDown(); a.join(3000); b.join(3000);
        assertFalse(a.isAlive()); assertFalse(b.isAlive());
        assertEquals(1, accepted.get()); assertEquals(1, rejected.get());
    }
}
