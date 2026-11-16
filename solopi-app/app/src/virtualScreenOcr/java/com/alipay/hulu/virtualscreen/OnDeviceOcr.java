package com.alipay.hulu.virtualscreen;

import android.graphics.Rect;

import com.google.android.gms.tasks.OnCompleteListener;
import com.google.android.gms.tasks.Task;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/** On-device OCR for an explicitly captured frame. Does not perform actions or network requests. */
public final class OnDeviceOcr implements VirtualOcrEngine {
    private static final int MAX_LINES = 512;
    private final TextRecognizer chinese = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
    private final TextRecognizer latin = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);

    public interface Callback {
        void onResult(Result result);
        void onError(String error);
    }

    public static final class Line {
        public final String text;
        public final Rect bounds;
        /** The same pixels remain at this region; not proof that an action is safe. */
        public final boolean pixelsMatch;
        Line(String text, Rect bounds) { this(text, bounds, false); }
        Line(String text, Rect bounds, boolean pixelsMatch) {
            this.text = text; this.bounds = bounds; this.pixelsMatch = pixelsMatch;
        }
    }

    public static final class Result {
        public final long generation;
        public final long frameSequence;
        public final boolean current;
        public final String freshness;
        public final long comparedFrameSequence;
        public final List<Line> lines;
        Result(long generation, long frameSequence, boolean current, String freshness, long comparedFrameSequence, List<Line> lines) {
            this.generation = generation; this.frameSequence = frameSequence;
            this.current = current;
            this.freshness = freshness;
            this.comparedFrameSequence = comparedFrameSequence;
            this.lines = Collections.unmodifiableList(lines);
        }
    }

    /** Transfers ownership of the bound frame bitmap to OCR. */
    public void read(VirtualAgentSession session, VirtualAgentSession.BoundObservation observation,
                     final Callback callback) {
        if (session == null || observation == null || callback == null) throw new IllegalArgumentException();
        session.readBoundFrame(observation, new VirtualAgentSession.FrameConsumer() {
            @Override public void read(LatestFrameBuffer buffer, LatestFrameBuffer.Frame frame) {
                OnDeviceOcr.this.read(buffer, frame, callback);
            }
        });
    }

    @Override public void recognize(VirtualAgentSession session, VirtualAgentSession.BoundObservation observation,
                                    final VirtualOcrEngine.Callback callback) {
        if (callback == null) throw new IllegalArgumentException();
        read(session, observation, new Callback() {
            @Override public void onResult(Result result) {
                List<VirtualOcrEngine.Line> lines = new ArrayList<VirtualOcrEngine.Line>();
                for (Line line : result.lines) lines.add(new VirtualOcrEngine.Line(line.text, line.bounds, line.pixelsMatch));
                callback.onResult(new VirtualOcrEngine.Result(result.generation, result.frameSequence,
                        result.comparedFrameSequence, result.current, result.freshness, lines));
            }
            @Override public void onError(String error) { callback.onError(error); }
        });
    }

    /** Takes ownership of frame.bitmap; callback happens once both recognizers finish. */
    public void read(final LatestFrameBuffer buffer, final LatestFrameBuffer.Frame frame, final Callback callback) {
        if (buffer == null || frame == null || callback == null) throw new IllegalArgumentException();
        if (!buffer.isCurrent(frame)) {
            frame.bitmap.recycle();
            callback.onError("stale_frame");
            return;
        }
        final InputImage image;
        try {
            image = InputImage.fromBitmap(frame.bitmap, 0);
        } catch (RuntimeException error) {
            frame.bitmap.recycle();
            callback.onError("ocr_invalid_image");
            return;
        }
        final Object lock = new Object();
        final List<Line> lines = new ArrayList<Line>();
        final AtomicInteger remaining = new AtomicInteger(2);
        final AtomicInteger successes = new AtomicInteger();
        final TextRecognizer[] recognizers = { chinese, latin };
        for (final TextRecognizer recognizer : recognizers) {
            try {
                recognizer.process(image).addOnCompleteListener(new OnCompleteListener<Text>() {
                    @Override public void onComplete(Task<Text> task) {
                        try {
                        if (task.isSuccessful() && task.getResult() != null) {
                            synchronized (lock) {
                                for (Text.TextBlock block : task.getResult().getTextBlocks()) {
                                    for (Text.Line line : block.getLines()) {
                                        Rect bounds = line.getBoundingBox();
                                        String text = line.getText().trim();
                                        if (bounds != null && !bounds.isEmpty() && !text.isEmpty()
                                                && bounds.left >= 0 && bounds.top >= 0
                                                && bounds.right <= frame.bitmap.getWidth() && bounds.bottom <= frame.bitmap.getHeight()) {
                                            boolean duplicate = false;
                                            for (Line existing : lines) {
                                                if (existing.text.equals(text) && existing.bounds.equals(bounds)) { duplicate = true; break; }
                                            }
                                            if (!duplicate && lines.size() < MAX_LINES) lines.add(new Line(text, new Rect(bounds)));
                                        }
                                    }
                                }
                            }
                            successes.incrementAndGet();
                        }
                        } catch (RuntimeException ignored) {
                            // Treat extraction errors as recognizer failure, without logging screen contents.
                        } finally { finish(); }
                    }
                    private void finish() { complete(buffer, frame, callback, remaining, successes, lines, lock); }
                });
            } catch (RuntimeException error) {
                complete(buffer, frame, callback, remaining, successes, lines, lock);
            }
        }
    }

    private static void complete(LatestFrameBuffer buffer, LatestFrameBuffer.Frame frame, Callback callback,
                                 AtomicInteger remaining, AtomicInteger successes, List<Line> lines, Object lock) {
        if (remaining.decrementAndGet() != 0) return;
        if (successes.get() == 0) { frame.bitmap.recycle(); callback.onError("ocr_failed"); return; }
        // Read-only text remains attributable to its source frame; stale results must not drive an action.
        List<Line> resultLines = new ArrayList<Line>();
        LatestFrameBuffer.RegionComparison comparison;
        try {
            synchronized (lock) {
                List<Rect> bounds = new ArrayList<Rect>();
                for (Line line : lines) bounds.add(line.bounds);
                comparison = buffer.compareRegions(frame, bounds);
                for (int i = 0; i < lines.size(); i++) {
                    Line line = lines.get(i);
                    resultLines.add(new Line(line.text, line.bounds, comparison.matching[i]));
                }
            }
        } catch (RuntimeException failure) {
            callback.onError("ocr_frame_comparison_failed");
            return;
        } finally {
            frame.bitmap.recycle();
        }
        callback.onResult(new Result(frame.generation, frame.sequence, "current".equals(comparison.freshness),
                comparison.freshness, comparison.comparedSequence, resultLines));
    }

    @Override public void close() { chinese.close(); latin.close(); }
}
