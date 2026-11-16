package com.alipay.hulu.virtualscreen;

/** Internal ownership boundary for a single screen created by a privileged helper. */
final class TrustedDisplayLease {
    interface CallerIdentity { int uid(); }
    interface ScreenFactory { Screen create() throws Exception; }
    interface Screen {
        int displayId();
        void release() throws Exception;
    }

    private final int ownerUid;
    private final CallerIdentity caller;
    private Screen screen;

    TrustedDisplayLease(int ownerUid, CallerIdentity caller) {
        if (ownerUid <= 0 || caller == null) throw new IllegalArgumentException("invalid_display_owner");
        this.ownerUid = ownerUid;
        this.caller = caller;
    }

    synchronized int create(ScreenFactory factory) throws Exception {
        requireOwner();
        if (screen != null) throw new IllegalStateException("trusted_display_already_owned");
        if (factory == null) throw new IllegalArgumentException("invalid_display_factory");
        Screen created = factory.create();
        if (created == null) throw new IllegalStateException("trusted_display_unavailable");
        // Code security: retain the resource before inspecting it, so a failed cleanup is retryable.
        screen = created;
        int displayId = created.displayId();
        if (displayId <= 0) {
            releaseOwned();
            throw new IllegalStateException("invalid_trusted_display");
        }
        return displayId;
    }

    synchronized void release(int displayId) throws Exception {
        requireOwner();
        // Code security: the supplied display ID must identify the screen held by this owner.
        if (screen == null || displayId <= 0 || screen.displayId() != displayId)
            throw new SecurityException("trusted_display_not_owned");
        releaseOwned();
    }

    synchronized void cleanup() throws Exception {
        requireOwner();
        releaseOwned();
    }

    synchronized boolean hasScreen() { return screen != null; }

    /** Internal death-recipient callback; never expose this method through the IPC surface. */
    synchronized void ownerDied() throws Exception { releaseOwned(); }

    private void requireOwner() {
        // Code security: production IPC must supply Binder.getCallingUid(), never a caller-provided UID.
        if (caller.uid() != ownerUid) throw new SecurityException("trusted_display_caller_mismatch");
    }

    private void releaseOwned() throws Exception {
        if (screen == null) return;
        screen.release();
        // Do not forget the screen if release() throws; cleanup may be retried.
        screen = null;
    }
}
