package com.alipay.hulu.screenRecord;

import com.alipay.hulu.common.utils.RuntimeSessionGuard;

import org.junit.After;
import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class ScreenRecorderLeaseTest {
    private String acquiredOwner;

    @After
    public void releaseLease() {
        ScreenRecorderLease.release(acquiredOwner);
        RuntimeSessionGuard.endMaintenance("screen-maintenance");
    }

    @Test
    public void screenRecorderLeaseRejectsCompetingAndWrongOwners() {
        acquiredOwner = ScreenRecorderLease.newOwner("first");
        String otherOwner = ScreenRecorderLease.newOwner("second");

        assertTrue(ScreenRecorderLease.tryAcquire(acquiredOwner));
        assertTrue(ScreenRecorderLease.isHeld());
        assertTrue(ScreenRecorderLease.isOwnedBy(acquiredOwner));
        assertFalse(ScreenRecorderLease.tryAcquire(otherOwner));
        assertFalse(ScreenRecorderLease.release(otherOwner));
        assertTrue(ScreenRecorderLease.release(acquiredOwner));
        acquiredOwner = null;
        assertFalse(ScreenRecorderLease.isHeld());
    }

    @Test
    public void maintenanceGatePreventsScreenRecorderLease() {
        assertTrue(RuntimeSessionGuard.beginMaintenance("screen-maintenance"));
        acquiredOwner = ScreenRecorderLease.newOwner("blocked");

        assertFalse(ScreenRecorderLease.tryAcquire(acquiredOwner));
        assertFalse(ScreenRecorderLease.isHeld());
    }
}
