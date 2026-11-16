package com.alipay.hulu.virtualscreen;

/** Tracks frame freshness without depending on wall-clock time. */
final class FrameEpoch {
    private long generation;
    private long frameSequence;
    private long frameTime;
    private long minimumTime;
    private boolean closed;

    synchronized boolean accepts(long timestamp) {
        return !closed && timestamp > minimumTime && timestamp >= frameTime;
    }

    synchronized void frame(long timestamp) {
        if (!accepts(timestamp)) return;
        frameTime = timestamp;
        frameSequence++;
    }

    synchronized long invalidate(long now) {
        if (!closed) generation++;
        frameTime = 0;
        minimumTime = Math.max(minimumTime, now);
        return generation;
    }

    synchronized boolean available(long expectedGeneration, long newerThan) {
        return !closed && generation == expectedGeneration && frameTime > newerThan;
    }

    synchronized long generation() { return generation; }
    synchronized long sequence() { return frameSequence; }
    synchronized long time() { return frameTime; }
    synchronized void close() { closed = true; frameTime = 0; generation++; }
}
