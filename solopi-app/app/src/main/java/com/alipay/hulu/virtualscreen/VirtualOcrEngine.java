package com.alipay.hulu.virtualscreen;

import android.graphics.Rect;
import java.util.List;

/** Optional device-local OCR implementation; it cannot choose or dispatch actions. */
public interface VirtualOcrEngine extends AutoCloseable {
    final class Line {
        public final String text;
        public final Rect bounds;
        public final boolean pixelsMatch;
        public Line(String text, Rect bounds, boolean pixelsMatch) {
            this.text = text; this.bounds = new Rect(bounds); this.pixelsMatch = pixelsMatch;
        }
    }
    final class Result {
        public final long frameGeneration, frameSequence, comparedFrameSequence;
        public final boolean current;
        public final String freshness;
        public final List<Line> lines;
        public Result(long generation, long sequence, long compared, boolean current, String freshness, List<Line> lines) {
            this.frameGeneration = generation; this.frameSequence = sequence; this.comparedFrameSequence = compared;
            this.current = current; this.freshness = freshness;
            this.lines = java.util.Collections.unmodifiableList(new java.util.ArrayList<Line>(lines));
        }
    }
    interface Callback { void onResult(Result result); void onError(String error); }
    /** The implementation takes ownership of the observation's bitmap on successful submission. */
    void recognize(VirtualAgentSession session, VirtualAgentSession.BoundObservation observation, Callback callback);
    @Override void close();
}
