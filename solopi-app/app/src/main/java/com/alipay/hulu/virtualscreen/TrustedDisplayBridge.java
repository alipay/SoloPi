package com.alipay.hulu.virtualscreen;

import android.content.Context;
import android.os.IBinder;
import android.os.SystemClock;
import android.view.Surface;
import com.alipay.hulu.common.tools.CmdTools;
import com.cgutman.adblib.AdbStream;
import java.util.Arrays;

/** Per-lease privileged display bridge. A failed or unknown create remains cleanup-owned. */
final class TrustedDisplayBridge implements VirtualScreen.Bridge, AutoCloseable {
    private final Context context;
    private TrustedDisplayAttachProvider.Pending pending;
    private AdbStream stream;
    private ITrustedDisplayHelper helper;
    private boolean createSubmitted, cleanupConfirmed, shutdownSubmitted, closed;
    private int displayId;

    TrustedDisplayBridge(Context context) { this.context = context; }

    @Override public synchronized int create(Surface surface, int width, int height, int densityDpi) throws Exception {
        if (closed || pending != null || helper != null) throw new IllegalStateException("trusted_display_already_started");
        TrustedAppIdentity identity = TrustedAppIdentity.read(context, context.getPackageName());
        pending = TrustedDisplayAttachProvider.begin();
        byte[] secret = pending.secretForPrivateTransport();
        try {
            stream = CmdTools.startTrustedDisplayHelper(identity.apkPath, identity.packageName, identity.uid,
                    identity.certificateSha256, secret);
            IBinder remote = pending.await();
            helper = ITrustedDisplayHelper.Stub.asInterface(remote);
            if (helper == null) throw new IllegalStateException("trusted_helper_unavailable");
            // Code security: retain this bridge under the device lease before any IPC that can create a screen.
            createSubmitted = true;
            displayId = helper.create(surface, width, height, densityDpi, pending.ownerToken());
            if (displayId <= 0) throw new IllegalStateException("trusted_display_unavailable");
            return displayId;
        } finally {
            Arrays.fill(secret, (byte) 0);
            pending.close();
        }
    }

    @Override public synchronized void release(int id) throws Exception {
        if (id <= 0 || id != displayId) throw new SecurityException("trusted_display_not_owned");
        close();
    }

    @Override public synchronized void close() throws Exception {
        if (closed) return;
        if (pending != null) pending.close();
        if (helper == null) {
            // No create call was submitted; closing an incomplete handoff cannot strand a display.
            if (createSubmitted) throw new IllegalStateException("trusted_display_release_unconfirmed");
            CmdTools.closeTrustedDisplayHelper(stream);
            closed = true;
            return;
        }
        if (!cleanupConfirmed) {
            // cleanup handles a response lost after create; failure is retained for an explicit retry.
            helper.cleanup();
            cleanupConfirmed = true;
        }
        if (!shutdownSubmitted) {
            helper.shutdown();
            shutdownSubmitted = true;
        }
        long deadline = SystemClock.elapsedRealtime() + 3000L;
        while (stream != null && !stream.isClosed() && SystemClock.elapsedRealtime() < deadline) Thread.sleep(25);
        if (stream != null && !stream.isClosed()) throw new IllegalStateException("trusted_helper_exit_unconfirmed");
        CmdTools.closeTrustedDisplayHelper(stream);
        closed = true;
    }
}
