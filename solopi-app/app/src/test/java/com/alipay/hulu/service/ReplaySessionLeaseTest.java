package com.alipay.hulu.service;

import com.alipay.hulu.common.utils.RuntimeSessionGuard;

import org.junit.After;
import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

public class ReplaySessionLeaseTest {
    private String acquiredOwner;

    @After
    public void releaseLease() {
        ReplaySessionLease.release(acquiredOwner);
        RuntimeSessionGuard.endMaintenance("replay-maintenance");
    }

    @Test
    public void generatedOwnersAreUniqueAndRequired() {
        assertNotEquals(
                ReplaySessionLease.newOwner("test"),
                ReplaySessionLease.newOwner("test"));

        boolean nullRejected = false;
        try {
            ReplaySessionLease.newOwner(null);
        } catch (IllegalArgumentException expected) {
            nullRejected = true;
        }
        assertTrue(nullRejected);
    }

    @Test
    public void onlyExactOwnerCanReleaseReplayLease() {
        acquiredOwner = ReplaySessionLease.newOwner("first");
        String otherOwner = ReplaySessionLease.newOwner("second");

        assertTrue(ReplaySessionLease.tryAcquire(acquiredOwner));
        assertTrue(ReplaySessionLease.isOwnedBy(acquiredOwner));
        assertFalse(ReplaySessionLease.tryAcquire(otherOwner));
        assertFalse(ReplaySessionLease.release(otherOwner));
        assertTrue(ReplaySessionLease.isOwnedBy(acquiredOwner));
        assertTrue(ReplaySessionLease.release(acquiredOwner));
        acquiredOwner = null;
    }

    @Test
    public void maintenanceGatePreventsReplayLease() {
        assertTrue(RuntimeSessionGuard.beginMaintenance("replay-maintenance"));
        acquiredOwner = ReplaySessionLease.newOwner("blocked");

        assertFalse(ReplaySessionLease.tryAcquire(acquiredOwner));
        assertFalse(ReplaySessionLease.isOwnedBy(acquiredOwner));
    }

    @Test
    public void replayAndAgentShareOneDeviceControlLease() {
        acquiredOwner = DeviceControlLease.newOwner("agent-test");
        String replayOwner = ReplaySessionLease.newOwner("replay-test");

        assertTrue(DeviceControlLease.tryAcquire(acquiredOwner));
        assertFalse(ReplaySessionLease.tryAcquire(replayOwner));
        assertFalse(ReplaySessionLease.release(replayOwner));
        assertTrue(DeviceControlLease.isOwnedBy(acquiredOwner));

        assertTrue(DeviceControlLease.release(acquiredOwner));
        acquiredOwner = replayOwner;
        assertTrue(ReplaySessionLease.tryAcquire(acquiredOwner));
        assertTrue(DeviceControlLease.isOwnedBy(acquiredOwner));
    }
}
