package com.alipay.hulu.screenRecord;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class ScreenRecorderSessionStateTest {
    @Test
    public void rejectedOwnerDoesNotPoisonActiveOwner() {
        ScreenRecorderSessionState state = new ScreenRecorderSessionState();
        state.start("active");
        state.updateStartTime("active", 123L);

        state.reject("rejected", "Another recorder is active");

        assertNull(state.getError("active"));
        assertFalse(state.isCompleted("active"));
        assertEquals(123L, state.getStartTime("active"));
        assertTrue(state.isCompleted("rejected"));
        assertEquals("Another recorder is active", state.getError("rejected"));
    }

    @Test
    public void duplicateOwnerRejectionDoesNotCompleteActiveSession() {
        ScreenRecorderSessionState state = new ScreenRecorderSessionState();
        state.start("active");
        state.updateStartTime("active", 234L);

        state.reject("active", "Another recorder is active");

        assertFalse(state.isCompleted("active"));
        assertNull(state.getError("active"));
        assertEquals(234L, state.getStartTime("active"));
    }

    @Test
    public void completedOwnerSurvivesNextOwnerStart() {
        ScreenRecorderSessionState state = new ScreenRecorderSessionState();
        state.start("first");
        state.updateStartTime("first", 456L);
        state.complete("first", 456L, null);

        state.start("second");

        assertTrue(state.isCompleted("first"));
        assertEquals(456L, state.getStartTime("first"));
        assertNull(state.getError("first"));
        assertFalse(state.isCompleted("second"));
    }

    @Test
    public void historyIsBounded() {
        ScreenRecorderSessionState state = new ScreenRecorderSessionState(2);
        state.complete("first", 1L, null);
        state.complete("second", 2L, null);
        state.complete("third", 3L, null);

        assertEquals(2, state.size());
        assertFalse(state.isCompleted("first"));
        assertTrue(state.isCompleted("second"));
        assertTrue(state.isCompleted("third"));
    }

    @Test
    public void historyDoesNotEvictActiveOwner() {
        ScreenRecorderSessionState state = new ScreenRecorderSessionState(2);
        state.start("active");
        state.updateStartTime("active", 99L);
        state.complete("rejected-one", 0L, "busy");
        state.complete("rejected-two", 0L, "busy");

        assertEquals(2, state.size());
        assertFalse(state.isCompleted("active"));
        assertEquals(99L, state.getStartTime("active"));
        assertFalse(state.isCompleted("rejected-one"));
        assertTrue(state.isCompleted("rejected-two"));
    }

    @Test
    public void newlyCompletedOwnerIsRetainedAcrossNextStart() {
        ScreenRecorderSessionState state = new ScreenRecorderSessionState(2);
        state.start("active");
        state.complete("rejected", 0L, "busy");
        state.complete("active", 321L, null);

        state.start("next");

        assertFalse(state.isCompleted("rejected"));
        assertTrue(state.isCompleted("active"));
        assertEquals(321L, state.getStartTime("active"));
        assertFalse(state.isCompleted("next"));
    }
}
