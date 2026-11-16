package com.alipay.hulu.virtualscreen;

import android.content.Context;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.view.Surface;

import java.util.HashMap;
import java.util.Map;

/** Creates private app-owned displays. External-app launch support is device dependent. */
public final class LocalDisplayBridge implements VirtualScreen.Bridge, AutoCloseable {
    private final DisplayManager manager;
    private final Map<Integer, VirtualDisplay> displays = new HashMap<Integer, VirtualDisplay>();
    private boolean closed;

    public LocalDisplayBridge(Context context) {
        manager = (DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE);
        if (manager == null) throw new IllegalStateException("display_service_unavailable");
    }

    @Override public synchronized int create(Surface surface, int width, int height, int densityDpi) {
        if (closed) throw new IllegalStateException("display_bridge_closed");
        // Keep the display private; do not mirror the main screen or expose it to other processes.
        VirtualDisplay display = manager.createVirtualDisplay("SoloPi Agent", width, height, densityDpi,
                surface, DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY
                        | DisplayManager.VIRTUAL_DISPLAY_FLAG_PRESENTATION);
        if (display == null) throw new IllegalStateException("virtual_display_unavailable");
        if (display.getDisplay() == null || display.getDisplay().getDisplayId() <= 0) {
            display.release();
            throw new IllegalStateException("virtual_display_unavailable");
        }
        int id = display.getDisplay().getDisplayId();
        if (displays.containsKey(id)) {
            display.release();
            throw new IllegalStateException("duplicate_display_id");
        }
        displays.put(id, display);
        return id;
    }

    @Override public synchronized void release(int displayId) {
        // Only displays created by this bridge can be released.
        VirtualDisplay display = displays.get(displayId);
        if (display == null) throw new IllegalStateException("virtual_display_not_owned");
        display.release();
        displays.remove(displayId);
    }

    @Override public synchronized void close() {
        closed = true;
        for (VirtualDisplay display : displays.values()) display.release();
        displays.clear();
    }
}
