package com.alipay.hulu.virtualscreen;

import org.junit.Test;
import static org.junit.Assert.*;

public class FrameEpochTest {
    @Test public void invalidationAndCloseRejectOldFrames() {
        FrameEpoch state = new FrameEpoch();
        state.frame(10);
        assertTrue(state.available(0, 9));
        assertFalse(state.available(0, 10));
        long next = state.invalidate(15);
        assertFalse(state.available(next, 0));
        state.frame(12);
        assertFalse(state.available(next, 0));
        state.frame(20);
        assertFalse(state.available(0, 0));
        assertTrue(state.available(next, 10));
        state.close();
        state.frame(30);
        assertFalse(state.available(next, 0));
    }

    @Test public void olderFrameCannotReplaceNewerFrame() {
        FrameEpoch state = new FrameEpoch();
        state.frame(20);
        state.frame(19);
        assertEquals(1, state.sequence());
        assertEquals(20, state.time());
    }
}
