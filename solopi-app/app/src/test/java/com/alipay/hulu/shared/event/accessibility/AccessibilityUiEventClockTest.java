package com.alipay.hulu.shared.event.accessibility;

import android.view.accessibility.AccessibilityEvent;

import org.junit.Test;

import static org.junit.Assert.*;

public class AccessibilityUiEventClockTest {
    @Test
    public void lifecycleAndEventsAdvanceContentFreeGeneration() {
        AccessibilityUiEventClock.connected(true);
        AccessibilityUiEventClock.Snapshot connected = AccessibilityUiEventClock.snapshot();
        assertTrue(connected.available);
        AccessibilityUiEventClock.changed();
        AccessibilityUiEventClock.Snapshot changed = AccessibilityUiEventClock.snapshot();
        assertTrue(changed.sequence > connected.sequence);
        assertTrue(changed.lastEventMs >= connected.lastEventMs);
        AccessibilityUiEventClock.connected(false);
        AccessibilityUiEventClock.Snapshot disconnected = AccessibilityUiEventClock.snapshot();
        assertFalse(disconnected.available);
        assertTrue(disconnected.sequence > changed.sequence);
    }

    @Test
    public void windowKeyboardTextAndScrollEventsMatterButNotificationsDoNot() {
        for (int type : new int[] { AccessibilityEvent.TYPE_WINDOWS_CHANGED,
                AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
                AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,
                AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED,
                AccessibilityEvent.TYPE_VIEW_FOCUSED,
                AccessibilityEvent.TYPE_VIEW_SCROLLED }) {
            assertTrue(AccessibilityServiceImpl.isUiTransitionEvent(type));
        }
        assertFalse(AccessibilityServiceImpl.isUiTransitionEvent(
                AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED));
        assertFalse(AccessibilityServiceImpl.isUiTransitionEvent(
                AccessibilityEvent.TYPE_ANNOUNCEMENT));
    }
}
