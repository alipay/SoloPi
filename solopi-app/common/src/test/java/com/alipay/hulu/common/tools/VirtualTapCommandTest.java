package com.alipay.hulu.common.tools;

import org.junit.Test;
import static org.junit.Assert.*;

public class VirtualTapCommandTest {
    @Test public void validCoordinatesUseOnlyTheRequestedDisplay() {
        assertEquals("shell:input -d 2 tap 10 20; echo SOLOPI_TAP_EXIT:$?", VirtualTapCommand.create(2, 10, 20, 100, 200));
    }
    @Test public void rejectsMainDisplayAndOutOfBounds() {
        int[][] bad = {{0, 10, 20, 100, 200}, {2, -1, 20, 100, 200}, {2, 100, 20, 100, 200}, {2, 1, 1, 5000, 200}};
        for (int[] b : bad) {
            try { VirtualTapCommand.create(b[0], b[1], b[2], b[3], b[4]); fail(); }
            catch (IllegalArgumentException expected) { }
        }
    }
}
