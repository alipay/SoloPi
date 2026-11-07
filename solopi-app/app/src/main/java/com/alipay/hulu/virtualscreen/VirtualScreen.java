package com.alipay.hulu.virtualscreen;

import android.view.Surface;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.hardware.display.DisplayManager;
import android.os.Handler;
import android.os.Looper;
import com.alipay.hulu.common.tools.CmdTools;

/** A virtual screen whose lifetime and frame source belong to one control session. */
public final class VirtualScreen implements AutoCloseable {
    /** Device-specific bridge. Implementations must release a partially created display on failure. */
    public interface Bridge {
        int create(Surface surface, int width, int height, int densityDpi) throws Exception;
        void release(int displayId) throws Exception;
    }

    private final Bridge bridge;
    private final LatestFrameBuffer frames;
    private final int displayId;
    private final int width, height;
    private final DisplayGeometryGuard geometry;
    private DisplayManager displayManager;
    private DisplayManager.DisplayListener displayListener;
    private boolean closed;
    private boolean released;

    private VirtualScreen(Bridge bridge, LatestFrameBuffer frames, int displayId, int width, int height) {
        this.bridge = bridge;
        this.frames = frames;
        this.displayId = displayId;
        this.width = width; this.height = height;
        this.geometry = new DisplayGeometryGuard(width, height);
    }

    public static VirtualScreen create(Bridge bridge, int width, int height, int densityDpi) throws Exception {
        if (bridge == null || densityDpi < 72 || densityDpi > 1000) throw new IllegalArgumentException("invalid display configuration");
        LatestFrameBuffer frames = new LatestFrameBuffer(width, height);
        try {
            int id = bridge.create(frames.surface(), width, height, densityDpi);
            // Code security: the device bridge may only return a non-default display it owns.
            if (id <= 0) throw new IllegalStateException("virtual_display_unavailable");
            return new VirtualScreen(bridge, frames, id, width, height);
        } catch (Exception e) {
            frames.close();
            throw e;
        } catch (Error e) {
            frames.close();
            throw e;
        }
    }

    public synchronized int displayId() {
        if (closed) throw new IllegalStateException("virtual_display_closed");
        return displayId;
    }

    public synchronized LatestFrameBuffer frames() {
        if (closed) throw new IllegalStateException("virtual_display_closed");
        return frames;
    }

    public int width() { return width; }
    public int height() { return height; }

    void verifyGeometry(int actualWidth, int actualHeight, int rotation) {
        geometry.verify(actualWidth, actualHeight, rotation);
    }

    synchronized void startDisplayMonitoring(Context context) {
        if (closed || displayListener != null || context == null) throw new IllegalStateException("virtual_display_monitor_unavailable");
        final DisplayManager manager = (DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE);
        if (manager == null) throw new IllegalStateException("virtual_display_monitor_unavailable");
        DisplayManager.DisplayListener listener = new DisplayManager.DisplayListener() {
            @Override public void onDisplayAdded(int id) { }
            @Override public void onDisplayChanged(int id) {
                if (id != displayId) return;
                synchronized (VirtualScreen.this) {
                    if (closed) return;
                    // Code security: even a transient rotation invalidates any previously captured action frame.
                    frames.invalidate();
                    try { VirtualAccessibility.verifyGeometry(VirtualScreen.this); }
                    catch (RuntimeException unavailable) { geometry.invalidate(); }
                }
            }
            @Override public void onDisplayRemoved(int id) {
                if (id != displayId) return;
                synchronized (VirtualScreen.this) {
                    if (closed) return;
                    geometry.invalidate();
                    frames.invalidate();
                }
            }
        };
        manager.registerDisplayListener(listener, new Handler(Looper.getMainLooper()));
        displayManager = manager;
        displayListener = listener;
    }

    /** Launch a system-resolved application on this screen, once, without guessing success. */
    public synchronized String launch(Context context, String packageName) {
        if (closed) throw new IllegalStateException("virtual_display_closed");
        if (context == null || packageName == null) throw new IllegalArgumentException("invalid_virtual_launch");
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(packageName);
        ComponentName component = launch == null ? null : launch.getComponent();
        if (component == null || !packageName.equals(component.getPackageName())) {
            throw new IllegalArgumentException("launch_activity_unavailable");
        }
        return CmdTools.launchOnDisplayOnce(displayId, component);
    }

    /** Close the frame source even if the helper cannot confirm display release. */
    @Override public synchronized void close() throws Exception {
        if (released) return;
        if (!closed) {
            closed = true;
            if (displayManager != null && displayListener != null) {
                try { displayManager.unregisterDisplayListener(displayListener); }
                catch (RuntimeException ignored) { /* The closed listener cannot authorize any action. */ }
                displayListener = null;
                displayManager = null;
            }
            frames.close();
        }
        // Failed release remains retryable by this same owner; it is never reported as success.
        bridge.release(displayId);
        released = true;
    }
}
