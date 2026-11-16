package com.alipay.hulu.virtualscreen;

/** Freeze a display's geometry; a detected change permanently invalidates this session. */
final class DisplayGeometryGuard {
    private final int width, height;
    private int initialRotation = -1;
    private boolean invalid;

    DisplayGeometryGuard(int width, int height) { this.width = width; this.height = height; }

    synchronized void verify(int currentWidth, int currentHeight, int rotation) {
        // Code security: once the screen changes, restoring it cannot revive an old target.
        if (invalid || currentWidth != width || currentHeight != height || rotation < 0 || rotation > 3
                || (initialRotation >= 0 && initialRotation != rotation)) {
            invalid = true;
            throw new IllegalStateException("virtual_display_geometry_changed");
        }
        if (initialRotation < 0) initialRotation = rotation;
    }

    synchronized void invalidate() { invalid = true; }
}
