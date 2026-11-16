package com.alipay.hulu.virtualscreen;

import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.RemoteException;
import android.view.Display;
import android.view.Surface;

/** Internal shell-process Binder. It is not registered or exported on its own. */
final class TrustedDisplayHelperService extends ITrustedDisplayHelper.Stub {
    private final int appUid;
    private final DisplayManager manager;
    private final Handler worker;
    private final Runnable onOwnerDeathCleaned;
    private final TrustedDisplayLease lease;
    private IBinder owner;
    private boolean deathCleanupPending;
    private boolean shutdown;

    TrustedDisplayHelperService(int appUid, DisplayManager manager, Handler worker, Runnable onOwnerDeathCleaned) {
        if (appUid < 10000 || manager == null || worker == null || onOwnerDeathCleaned == null)
            throw new IllegalArgumentException("invalid_trusted_helper");
        this.appUid = appUid; this.manager = manager; this.worker = worker;
        this.onOwnerDeathCleaned = onOwnerDeathCleaned;
        this.lease = new TrustedDisplayLease(appUid, new TrustedDisplayLease.CallerIdentity() {
            @Override public int uid() { return Binder.getCallingUid(); }
        });
    }

    @Override public synchronized int create(final Surface surface, final int width, final int height,
                                              final int densityDpi, IBinder ownerToken) throws RemoteException {
        requireCaller();
        if (shutdown) throw new IllegalStateException("trusted_helper_closed");
        long deadline = android.os.SystemClock.elapsedRealtime() + 3000L;
        while (owner == null && !shutdown) {
            long remaining = deadline - android.os.SystemClock.elapsedRealtime();
            if (remaining <= 0) break;
            try { wait(remaining); }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new IllegalStateException("trusted_owner_not_ready"); }
        }
        if (owner == null || deathCleanupPending || lease.hasScreen()) throw new IllegalStateException("trusted_display_already_owned");
        if (surface == null || !surface.isValid() || ownerToken == null || !ownerToken.isBinderAlive()
                || !owner.equals(ownerToken)
                || width <= 0 || width > 4096 || height <= 0 || height > 4096
                || densityDpi < 72 || densityDpi > 1000) throw new IllegalArgumentException("invalid_trusted_display_request");
        try {
            return lease.create(new TrustedDisplayLease.ScreenFactory() {
                @Override public TrustedDisplayLease.Screen create() {
                    final VirtualDisplay display = manager.createVirtualDisplay("SoloPi Trusted Agent", width, height,
                            densityDpi, surface, TrustedDisplayFlags.forSdk(Build.VERSION.SDK_INT));
                    if (display == null) throw new IllegalStateException("trusted_display_unavailable");
                    return new TrustedDisplayLease.Screen() {
                        @Override public int displayId() {
                            Display result = display.getDisplay();
                            return result == null ? -1 : result.getDisplayId();
                        }
                        @Override public void release() { display.release(); }
                    };
                }
            });
        } catch (SecurityException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("trusted_display_create_failed");
        }
    }

    synchronized void bindOwner(IBinder ownerToken) throws RemoteException {
        if (owner != null || shutdown || ownerToken == null || !ownerToken.isBinderAlive())
            throw new IllegalStateException("invalid_trusted_owner");
        // Code security: the app-process token comes from the authenticated one-time handoff.
        ownerToken.linkToDeath(deathRecipient, 0);
        owner = ownerToken;
        notifyAll();
    }

    @Override public synchronized void release(int displayId) {
        requireCaller();
        try { lease.release(displayId); clearOwner(); }
        catch (SecurityException e) { throw e; }
        catch (Exception e) { throw new IllegalStateException("trusted_display_release_unconfirmed"); }
    }

    @Override public synchronized void cleanup() {
        requireCaller();
        try { lease.cleanup(); clearOwner(); }
        catch (Exception e) { throw new IllegalStateException("trusted_display_release_unconfirmed"); }
    }

    @Override public synchronized void shutdown() {
        requireCaller();
        if (lease.hasScreen() || owner != null || deathCleanupPending)
            throw new IllegalStateException("trusted_display_release_unconfirmed");
        shutdown = true;
        worker.post(onOwnerDeathCleaned);
    }

    synchronized boolean stopIfUnclaimed() {
        if (lease.hasScreen() || deathCleanupPending) return false;
        clearOwner();
        shutdown = true;
        notifyAll();
        return true;
    }

    private void requireCaller() {
        // Code security: Binder, not an IPC argument, supplies the application identity.
        if (Binder.getCallingUid() != appUid) throw new SecurityException("trusted_display_caller_mismatch");
    }

    private void clearOwner() {
        if (owner != null) owner.unlinkToDeath(deathRecipient, 0);
        owner = null;
    }

    private final IBinder.DeathRecipient deathRecipient = new IBinder.DeathRecipient() {
        @Override public void binderDied() {
            synchronized (TrustedDisplayHelperService.this) {
                if (owner == null || deathCleanupPending) return;
                deathCleanupPending = true;
            }
            worker.post(deathCleanup);
        }
    };

    private final Runnable deathCleanup = new Runnable() {
        @Override public void run() {
            synchronized (TrustedDisplayHelperService.this) {
                try {
                    // Code security: a dead owner's resource is kept until release actually succeeds.
                    lease.ownerDied();
                    clearOwner();
                    deathCleanupPending = false;
                } catch (Exception failure) {
                    worker.postDelayed(this, 5000);
                    return;
                }
            }
            onOwnerDeathCleaned.run();
        }
    };
}
