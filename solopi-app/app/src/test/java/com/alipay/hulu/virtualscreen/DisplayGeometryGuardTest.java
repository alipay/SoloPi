package com.alipay.hulu.virtualscreen;

import org.junit.Test;
import static org.junit.Assert.*;

public class DisplayGeometryGuardTest {
    @Test public void rotationInvalidatesEvenWhenDimensionsDoNotChange() {
        DisplayGeometryGuard guard = new DisplayGeometryGuard(1080, 2400);
        guard.verify(1080, 2400, 0);
        guard.verify(1080, 2400, 0);
        reject(guard, 1080, 2400, 2);
        reject(guard, 1080, 2400, 0);
    }

    @Test public void sizeChangeInvalidatesAndCannotBeRestored() {
        DisplayGeometryGuard guard = new DisplayGeometryGuard(1080, 2400);
        guard.verify(1080, 2400, 0);
        reject(guard, 2400, 1080, 1);
        reject(guard, 1080, 2400, 0);
    }

    @Test public void invalidInitialGeometryNeverBecomesUsable() {
        DisplayGeometryGuard guard = new DisplayGeometryGuard(1080, 2400);
        reject(guard, 0, 0, 0);
        reject(guard, 1080, 2400, 0);
    }

    @Test public void removedDisplayCannotBeRevived() {
        DisplayGeometryGuard guard = new DisplayGeometryGuard(1080, 2400);
        guard.verify(1080, 2400, 0);
        guard.invalidate();
        reject(guard, 1080, 2400, 0);
    }

    private static void reject(DisplayGeometryGuard guard, int width, int height, int rotation) {
        try { guard.verify(width, height, rotation); fail("geometry change must reject"); }
        catch (IllegalStateException expected) { assertEquals("virtual_display_geometry_changed", expected.getMessage()); }
    }
}
