package com.alipay.hulu.virtualscreen;

import org.junit.Test;
import static org.junit.Assert.*;

public class TrustedDisplayFlagsTest {
    @Test public void trustedDisplayNeverRequestsAlwaysUnlockedOrASeparatePowerGroup() {
        for (int sdk : new int[] {30, 33, 34, 36}) {
            int flags = TrustedDisplayFlags.forSdk(sdk);
            assertNotEquals(0, flags & (1 << 10));
            assertEquals(0, flags & (1 << 11));
            assertEquals(0, flags & (1 << 12));
            assertEquals(sdk >= 34, (flags & (1 << 14)) != 0);
        }
        try { TrustedDisplayFlags.forSdk(29); fail(); } catch (IllegalArgumentException expected) { }
    }
}
