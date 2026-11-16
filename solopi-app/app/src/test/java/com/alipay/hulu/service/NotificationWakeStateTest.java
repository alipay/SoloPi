package com.alipay.hulu.service;

import org.junit.Test;
import static org.junit.Assert.*;

public class NotificationWakeStateTest {
    @Test public void filtersNotificationsAndOnlyCountsWhileConnected() {
        NotificationWakeState state = new NotificationWakeState(false);
        state.posted("com.tencent.mm");
        assertFalse(state.snapshot().available);
        assertEquals(0, state.snapshot().sequence);
        state.connected();
        state.posted(null);
        state.posted("other.package");
        state.posted("com.tencent.mm");
        assertEquals(1, state.snapshot().sequence);
        state.disconnected();
        state.posted("com.tencent.mm");
        assertEquals(0, state.snapshot().sequence);
        assertFalse(state.snapshot().available);
    }

    @Test public void reconnectChangesEpochAndResetsCounter() {
        NotificationWakeState state = new NotificationWakeState(false);
        state.connected();
        state.posted("com.tencent.mm");
        String previous = state.snapshot().epoch;
        state.disconnected();
        String disconnected = state.snapshot().epoch;
        state.connected();
        NotificationWakeState.Snapshot next = state.snapshot();
        assertNotEquals(previous, disconnected);
        assertNotEquals(previous, next.epoch);
        assertNotEquals(disconnected, next.epoch);
        assertTrue(next.available);
        assertEquals(0, next.sequence);
    }

    @Test public void controlledPackageIsAllowedOnlyInDebugConfiguration() {
        NotificationWakeState production = new NotificationWakeState(false);
        NotificationWakeState debug = new NotificationWakeState(true);
        production.connected();
        debug.connected();
        production.posted("com.solopi.fastpath.demo");
        debug.posted("com.solopi.fastpath.demo");
        production.posted("com.solopi.fastpath.replyfixture");
        debug.posted("com.solopi.fastpath.replyfixture");
        debug.posted("com.solopi.fastpath.demo.other");
        assertEquals(0, production.snapshot().sequence);
        assertEquals(2, debug.snapshot().sequence);
    }
}
