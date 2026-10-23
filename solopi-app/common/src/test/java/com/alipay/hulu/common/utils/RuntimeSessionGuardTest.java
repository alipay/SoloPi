package com.alipay.hulu.common.utils;

import org.junit.After;
import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class RuntimeSessionGuardTest {
    private static final String SESSION_ONE = "test-session-one";
    private static final String SESSION_TWO = "test-session-two";
    private static final String MAINTENANCE = "test-maintenance";

    @After
    public void clearOwners() {
        RuntimeSessionGuard.endSession(SESSION_ONE);
        RuntimeSessionGuard.endSession(SESSION_TWO);
        RuntimeSessionGuard.endMaintenance(MAINTENANCE);
    }

    @Test
    public void activeSessionBlocksMaintenanceUntilReleased() {
        assertTrue(RuntimeSessionGuard.beginSession(SESSION_ONE));
        assertTrue(RuntimeSessionGuard.hasActiveSessions());
        assertFalse(RuntimeSessionGuard.beginMaintenance(MAINTENANCE));

        RuntimeSessionGuard.endSession(SESSION_ONE);

        assertFalse(RuntimeSessionGuard.hasActiveSessions());
        assertTrue(RuntimeSessionGuard.beginMaintenance(MAINTENANCE));
        assertTrue(RuntimeSessionGuard.isMaintenanceActive());
    }

    @Test
    public void maintenanceBlocksSessionsAndOnlyItsOwnerCanReleaseIt() {
        assertTrue(RuntimeSessionGuard.beginMaintenance(MAINTENANCE));
        assertFalse(RuntimeSessionGuard.beginSession(SESSION_TWO));

        RuntimeSessionGuard.endMaintenance("different-maintenance-owner");

        assertTrue(RuntimeSessionGuard.isMaintenanceActive());
        RuntimeSessionGuard.endMaintenance(MAINTENANCE);
        assertFalse(RuntimeSessionGuard.isMaintenanceActive());
        assertTrue(RuntimeSessionGuard.beginSession(SESSION_TWO));
    }

    @Test
    public void blankOwnersAreRejected() {
        assertFalse(RuntimeSessionGuard.beginSession(null));
        assertFalse(RuntimeSessionGuard.beginSession(""));
        assertFalse(RuntimeSessionGuard.beginMaintenance(null));
        assertFalse(RuntimeSessionGuard.beginMaintenance(""));
    }
}
