package com.alipay.hulu.virtualscreen;

import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.media.Image;
import android.media.ImageReader;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.view.Surface;

/** Bounded, in-memory frame source for one caller-owned virtual display. */
public final class LatestFrameBuffer implements AutoCloseable {
    private static final long FRAME_INTERVAL_MS = 100;
    private static final long MAX_FRAME_AGE_MS = 2000;
    private final int width;
    private final int height;
    private final HandlerThread thread;
    private final Handler handler;
    private final ImageReader reader;
    private final FrameEpoch epoch = new FrameEpoch();
    private final Object lock = new Object();
    private Bitmap latest;
    private boolean pending;
    private boolean closed;
    private long lastProcessed;

    public LatestFrameBuffer(int width, int height) {
        if (width <= 0 || height <= 0 || width > 4096 || height > 4096) {
            throw new IllegalArgumentException("Invalid display dimensions");
        }
        this.width = width;
        this.height = height;
        reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
        thread = new HandlerThread("solopi-virtual-frame");
        thread.start();
        handler = new Handler(thread.getLooper());
        reader.setOnImageAvailableListener(new ImageReader.OnImageAvailableListener() {
            @Override public void onImageAvailable(ImageReader ignored) { schedule(); }
        }, handler);
    }

    public Surface surface() { return reader.getSurface(); }
    public long generation() { return epoch.generation(); }

    /** Only results derived from the current, still-fresh frame can be served. */
    public boolean isCurrent(Frame frame) {
        return "current".equals(freshness(frame));
    }

    String freshness(Frame frame) {
        if (frame == null || frame.bitmap == null || frame.bitmap.isRecycled()) return "frame_unavailable";
        synchronized (lock) {
            long now = SystemClock.uptimeMillis();
            if (closed || latest == null) return "frame_unavailable";
            if (epoch.generation() != frame.generation) return "generation_changed";
            if (epoch.time() > now || now - epoch.time() > MAX_FRAME_AGE_MS) return "frame_expired";
            if (epoch.sequence() != frame.sequence && !latest.sameAs(frame.bitmap)) return "pixels_changed";
            return "current";
        }
    }

    static final class RegionComparison {
        final String freshness;
        final long comparedSequence;
        final boolean[] matching;
        RegionComparison(String freshness, long comparedSequence, boolean[] matching) {
            this.freshness = freshness; this.comparedSequence = comparedSequence; this.matching = matching;
        }
    }

    /** All regions are compared against the same cached frame; not an action authorization. */
    RegionComparison compareRegions(Frame frame, java.util.List<Rect> regions) {
        synchronized (lock) {
            String state = freshness(frame);
            long sequence = epoch.sequence();
            boolean[] matching = new boolean[regions.size()];
            long remainingPixels = 4_000_000L;
            for (int i = 0; i < matching.length; i++) {
                Rect region = regions.get(i);
                long area = region == null ? 0 : (long) region.width() * region.height();
                if (area <= 0 || area > remainingPixels) continue;
                matching[i] = regionPixelsMatch(frame, region);
                remainingPixels -= area;
            }
            return new RegionComparison(state, sequence, matching);
        }
    }

    boolean regionPixelsMatch(Frame frame, Rect region) {
        if (frame == null || frame.bitmap == null || frame.bitmap.isRecycled() || region == null) return false;
        synchronized (lock) {
            long now = SystemClock.uptimeMillis();
            if (closed || latest == null || epoch.generation() != frame.generation || epoch.time() > now
                    || now - epoch.time() > MAX_FRAME_AGE_MS || region.left < 0 || region.top < 0
                    || region.right > width || region.bottom > height || region.isEmpty()) return false;
            int regionWidth = region.width(), regionHeight = region.height();
            if ((long) regionWidth * regionHeight > 16_777_216L) return false;
            int[] before = new int[regionWidth], after = new int[regionWidth];
            for (int row = region.top; row < region.bottom; row++) {
                frame.bitmap.getPixels(before, 0, regionWidth, region.left, row, regionWidth, 1);
                latest.getPixels(after, 0, regionWidth, region.left, row, regionWidth, 1);
                if (!java.util.Arrays.equals(before, after)) return false;
            }
            return true;
        }
    }

    /** Reject frames from before a navigation or display change. */
    public long invalidate() {
        synchronized (lock) {
            if (latest != null) { latest.recycle(); latest = null; }
            return epoch.invalidate(SystemClock.uptimeMillis());
        }
    }

    /** Caller owns the returned bitmap and must recycle it. */
    public Frame copy(long generation, long newerThanUptimeMs) {
        synchronized (lock) {
            long now = SystemClock.uptimeMillis();
            if (closed || latest == null || !epoch.available(generation, newerThanUptimeMs)
                    || epoch.time() > now || now - epoch.time() > MAX_FRAME_AGE_MS) return null;
            Bitmap bitmap = latest.copy(Bitmap.Config.ARGB_8888, false);
            if (bitmap == null) return null;
            return new Frame(bitmap, epoch.generation(), epoch.sequence(), epoch.time());
        }
    }

    /** Takes ownership of a screenshot captured on this display; rejects old generations. */
    boolean acceptExternalFrame(Bitmap bitmap, long timestamp, long generation) {
        synchronized (lock) {
            if (bitmap == null) return false;
            if (closed || bitmap.isRecycled() || bitmap.getWidth() != width || bitmap.getHeight() != height
                    || epoch.generation() != generation || timestamp > SystemClock.uptimeMillis()
                    || !epoch.accepts(timestamp)) {
                if (!bitmap.isRecycled()) bitmap.recycle();
                return false;
            }
            if (latest != null) latest.recycle();
            latest = bitmap;
            epoch.frame(timestamp);
            return true;
        }
    }

    private void schedule() {
        synchronized (lock) {
            if (closed || pending) return;
            pending = true;
            long delay = Math.max(0, lastProcessed + FRAME_INTERVAL_MS - SystemClock.uptimeMillis());
            handler.postDelayed(new Runnable() {
                @Override public void run() { processLatest(); }
            }, delay);
        }
    }

    private void processLatest() {
        synchronized (lock) {
            pending = false;
            if (closed) return;
            lastProcessed = SystemClock.uptimeMillis();
            Image image = null;
            Bitmap padded = null;
            try {
                image = reader.acquireLatestImage();
                if (image == null) return;
                long frameTime = image.getTimestamp() / 1000000L;
                // A buffered frame captured before invalidation must not become a new observation.
                if (frameTime > SystemClock.uptimeMillis() || !epoch.accepts(frameTime)) return;
                Image.Plane plane = image.getPlanes()[0];
                int pixelStride = plane.getPixelStride();
                int rowStride = plane.getRowStride();
                if (pixelStride != 4 || rowStride < width * 4 || rowStride % 4 != 0) return;
                int paddedWidth = rowStride / 4;
                if (paddedWidth > 8192) return;
                padded = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888);
                padded.copyPixelsFromBuffer(plane.getBuffer());
                Bitmap frame = Bitmap.createBitmap(padded, 0, 0, width, height);
                if (frame == padded) padded = null;
                if (latest != null) latest.recycle();
                latest = frame;
                epoch.frame(frameTime);
            } catch (IllegalStateException | IllegalArgumentException ignored) {
                // A bad or unavailable frame is never returned as a fresh observation.
            } finally {
                if (padded != null) padded.recycle();
                if (image != null) image.close();
            }
        }
    }

    @Override public void close() {
        synchronized (lock) {
            if (closed) return;
            closed = true;
            epoch.close();
            reader.setOnImageAvailableListener(null, null);
            handler.removeCallbacksAndMessages(null);
            reader.close();
            if (latest != null) { latest.recycle(); latest = null; }
        }
        thread.quitSafely();
    }

    public static final class Frame {
        public final Bitmap bitmap;
        public final long generation;
        public final long sequence;
        public final long uptimeMs;
        Frame(Bitmap bitmap, long generation, long sequence, long uptimeMs) {
            this.bitmap = bitmap; this.generation = generation; this.sequence = sequence; this.uptimeMs = uptimeMs;
        }
    }
}
