package com.alipay.hulu.virtualscreen;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;

/** One-shot in-memory handshake for a shell-owned display helper. */
final class TrustedDisplayHandoff {
    interface CallerIdentity { int uid(); }
    interface Clock { long nowMillis(); }
    private static final int SHELL_UID = 2000;
    private static final int NONCE_BYTES = 32;
    private static final long MAX_LIFETIME_MS = 15000L;
    private final CallerIdentity caller;
    private final Clock clock;
    private final byte[] nonce = new byte[NONCE_BYTES];
    private final long expiresAt;
    private boolean closed;

    TrustedDisplayHandoff(CallerIdentity caller, Clock clock, SecureRandom random) {
        if (caller == null || clock == null || random == null) throw new IllegalArgumentException("invalid_handoff");
        this.caller = caller; this.clock = clock;
        long now = clock.nowMillis();
        if (now < 0 || now > Long.MAX_VALUE - MAX_LIFETIME_MS) throw new IllegalStateException("invalid_handoff_clock");
        expiresAt = now + MAX_LIFETIME_MS;
        // Code security: a fresh unpredictable secret is kept only in memory, never in command arguments or logs.
        random.nextBytes(nonce);
    }

    synchronized byte[] secretForPrivateTransport() {
        if (closed) throw new IllegalStateException("handoff_closed");
        return nonce.clone();
    }

    synchronized void accept(byte[] candidate) {
        // Code security: production IPC must use Binder.getCallingUid(); submitted UID is never trusted.
        if (caller.uid() != SHELL_UID) throw new SecurityException("handoff_caller_mismatch");
        long now = clock.nowMillis();
        if (closed || now < 0 || now > expiresAt) {
            close();
            throw new SecurityException("handoff_expired");
        }
        if (candidate == null || candidate.length != NONCE_BYTES || !MessageDigest.isEqual(nonce, candidate))
            throw new SecurityException("handoff_secret_mismatch");
        close();
    }

    synchronized void close() {
        if (!closed) Arrays.fill(nonce, (byte) 0);
        closed = true;
    }
}
