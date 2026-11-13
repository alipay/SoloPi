package com.alipay.hulu.virtualscreen;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Binder;
import android.os.Bundle;
import android.os.IBinder;
import android.os.SystemClock;
import java.security.SecureRandom;

/** DUMP-protected, one-shot Binder handoff; it cannot create or control a screen itself. */
public final class TrustedDisplayAttachProvider extends ContentProvider {
    private static final Object LOCK = new Object();
    private static final String METHOD_ATTACH = "attachTrustedDisplay";
    private static final String DESCRIPTOR = "com.alipay.hulu.virtualscreen.ITrustedDisplayHelper";
    private static final long TIMEOUT_MS = 15000L;
    private static Pending pending;

    static final class Pending implements AutoCloseable {
        private final TrustedDisplayHandoff handshake;
        private final long deadline;
        private final IBinder ownerToken = new Binder();
        private IBinder remote;
        private boolean closed;

        private Pending() {
            handshake = new TrustedDisplayHandoff(new TrustedDisplayHandoff.CallerIdentity() {
                @Override public int uid() { return Binder.getCallingUid(); }
            }, new TrustedDisplayHandoff.Clock() {
                @Override public long nowMillis() { return SystemClock.elapsedRealtime(); }
            }, new SecureRandom());
            deadline = SystemClock.elapsedRealtime() + TIMEOUT_MS;
        }

        byte[] secretForPrivateTransport() { synchronized (LOCK) { return handshake.secretForPrivateTransport(); } }
        IBinder ownerToken() { return ownerToken; }

        IBinder await() throws InterruptedException {
            synchronized (LOCK) {
                while (!closed && remote == null) {
                    long remaining = deadline - SystemClock.elapsedRealtime();
                    if (remaining <= 0) break;
                    try { LOCK.wait(remaining); }
                    catch (InterruptedException interrupted) { close(); throw interrupted; }
                }
                if (closed || remote == null || !remote.isBinderAlive()) {
                    close();
                    throw new IllegalStateException("trusted_helper_handoff_unconfirmed");
                }
                IBinder result = remote;
                close();
                return result;
            }
        }

        @Override public void close() {
            synchronized (LOCK) {
                if (closed) return;
                closed = true; handshake.close(); remote = null;
                if (pending == this) pending = null;
                LOCK.notifyAll();
            }
        }
    }

    /** Called only by the local session owner before starting a helper process. */
    static Pending begin() {
        synchronized (LOCK) {
            if (pending != null) throw new IllegalStateException("trusted_helper_handoff_busy");
            pending = new Pending();
            return pending;
        }
    }

    @Override public Bundle call(String method, String arg, Bundle extras) {
        Bundle result = new Bundle();
        result.putBoolean("accepted", false);
        if (!METHOD_ATTACH.equals(method) || extras == null) return result;
        synchronized (LOCK) {
            Pending candidate = pending;
            if (candidate == null || candidate.closed || candidate.remote != null) return result;
            try {
                IBinder remote = extras.getBinder("binder");
                byte[] secret = extras.getByteArray("secret");
                if (remote == null || !remote.isBinderAlive() || !DESCRIPTOR.equals(remote.getInterfaceDescriptor())) return result;
                // Code security: the shell UID and one-time secret are checked atomically before handoff.
                candidate.handshake.accept(secret);
                candidate.remote = remote;
                result.putBinder("ownerToken", candidate.ownerToken);
                result.putBoolean("accepted", true);
                LOCK.notifyAll();
            } catch (Exception rejected) {
                // Do not log IPC input, authentication material or application contents.
            }
        }
        return result;
    }

    @Override public boolean onCreate() { return true; }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) { throw new UnsupportedOperationException(); }
    @Override public String getType(Uri uri) { throw new UnsupportedOperationException(); }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { throw new UnsupportedOperationException(); }
}
