package com.alipay.hulu.agentmodel;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public class RegistryStateTest {
    @Test
    public void activateTracksPreviousAndRollbackSwapsVersions() {
        RegistryState first = new RegistryState(null, null).activate("1.0.0");
        RegistryState second = first.activate("1.1.0");
        RegistryState rolledBack = second.rollback();

        assertEquals("1.0.0", rolledBack.activeVersion);
        assertEquals("1.1.0", rolledBack.previousVersion);
    }

    @Test(expected = IllegalStateException.class)
    public void rollbackWithoutPreviousFailsClosed() {
        new RegistryState("1.0.0", null).rollback();
    }

    @Test
    public void activatingSameVersionIsIdempotent() {
        RegistryState state = new RegistryState("1.0.0", null).activate("1.0.0");
        assertEquals("1.0.0", state.activeVersion);
        assertNull(state.previousVersion);
    }
}
