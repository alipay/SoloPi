package com.alipay.hulu.virtualscreen;

import org.junit.Test;
import static org.junit.Assert.*;

public class VirtualFrameGuardTest {
    @Test public void blackOrMissingPixelsFailClosed() {
        assertTrue(VirtualFrameGuard.allBlack(null, 1));
        assertTrue(VirtualFrameGuard.allBlack(new int[]{0xff000000, 0x00000000}, 2));
        assertTrue(VirtualFrameGuard.allBlack(new int[]{0xff000000}, 2));
        assertFalse(VirtualFrameGuard.allBlack(new int[]{0xff000000, 0xff000001}, 2));
    }
}
