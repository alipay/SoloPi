package com.alipay.hulu.virtualscreen;

import android.content.Context;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.os.Build;
import android.view.Display;
import android.view.Surface;

/** Single owned display for an Agent session. No automatic fallback to the main display. */
public final class AgentDisplayBridge implements VirtualScreen.Bridge {
    private static final int DESTROY_CONTENT_ON_REMOVAL = 1 << 8;
    private final DisplayManager manager;
    private VirtualDisplay display;

    public AgentDisplayBridge(Context context) {
        manager = (DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE);
        if (Build.VERSION.SDK_INT < 30 || manager == null) throw new IllegalStateException("virtual_display_unsupported");
    }

    @Override public synchronized int create(Surface surface, int width, int height, int densityDpi) {
        if (display != null) throw new IllegalStateException("virtual_display_already_created");
        // Android needs a public display for multi-display accessibility on the tested device.
        // Code security: no main-screen mirroring; all windows on this display are rechecked before action.
        int flags = DisplayManager.VIRTUAL_DISPLAY_FLAG_PUBLIC | DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY
                | DESTROY_CONTENT_ON_REMOVAL;
        VirtualDisplay created = manager.createVirtualDisplay("SoloPi Agent", width, height, densityDpi, surface, flags);
        if (created == null) throw new IllegalStateException("virtual_display_unavailable");
        Display resolved = created.getDisplay();
        if (resolved == null || resolved.getDisplayId() <= 0) {
            created.release(); throw new IllegalStateException("virtual_display_unavailable");
        }
        display = created;
        return resolved.getDisplayId();
    }

    @Override public synchronized void release(int displayId) {
        // Code security: only the display held by this bridge can be released.
        if (display == null || display.getDisplay() == null || display.getDisplay().getDisplayId() != displayId)
            throw new IllegalStateException("virtual_display_not_owned");
        display.release(); display = null;
    }
}
