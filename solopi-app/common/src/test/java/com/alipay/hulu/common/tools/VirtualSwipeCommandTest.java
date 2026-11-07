package com.alipay.hulu.common.tools;

import org.junit.Test;
import static org.junit.Assert.*;

public class VirtualSwipeCommandTest {
    @Test public void buildsOnlyBoundedDisplaySpecificSwipe() {
        assertEquals("shell:input -d 5 swipe 50 80 50 20 350; echo SOLOPI_SWIPE_EXIT:$?",
                VirtualSwipeCommand.create(5, 50, 80, 50, 20, 100, 200));
        int[][] bad = {{0, 50, 80, 50, 20}, {5, -1, 80, 50, 20}, {5, 50, 80, 100, 20}, {5, 50, 80, 50, 80}};
        for (int[] v : bad) {
            try {
                VirtualSwipeCommand.create(v[0], v[1], v[2], v[3], v[4], 100, 200);
                fail("invalid gesture accepted");
            } catch (IllegalArgumentException expected) { }
        }
    }
}
