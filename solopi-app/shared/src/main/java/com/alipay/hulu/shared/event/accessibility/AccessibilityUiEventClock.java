package com.alipay.hulu.shared.event.accessibility;

/** Content-free UI event clock. Events are hints; callers must still read and validate fresh trees. */
public final class AccessibilityUiEventClock {
    private static long sequence;
    private static long lastEventMs;
    private static boolean available;

    private AccessibilityUiEventClock() { }

    public static long monotonicMs() {
        return System.nanoTime() / 1_000_000L;
    }

    static synchronized void connected(boolean connected) {
        available = connected;
        changed();
    }

    static synchronized void changed() {
        sequence++;
        lastEventMs = monotonicMs();
    }

    public static synchronized Snapshot snapshot() {
        return new Snapshot(sequence, lastEventMs, available);
    }

    public static final class Snapshot {
        public final long sequence;
        public final long lastEventMs;
        public final boolean available;

        Snapshot(long sequence, long lastEventMs, boolean available) {
            this.sequence = sequence;
            this.lastEventMs = lastEventMs;
            this.available = available;
        }
    }
}
