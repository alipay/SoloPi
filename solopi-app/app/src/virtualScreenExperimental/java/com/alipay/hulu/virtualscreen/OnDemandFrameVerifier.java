package com.alipay.hulu.virtualscreen;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Bitmap;
import android.hardware.HardwareBuffer;
import android.os.Build;
import android.os.SystemClock;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

/** Captures only the internally owned display when its cached frame needs refresh. */
public final class OnDemandFrameVerifier implements VirtualFrameVerifier {
    private final AccessibilityService service;
    private final VirtualScreen screen;
    public OnDemandFrameVerifier(AccessibilityService service, VirtualScreen screen) {
        this.service = service; this.screen = screen;
    }

    @Override public String refresh(LatestFrameBuffer buffer, long generation) {
        Capture fresh = capture();
        if (fresh.error != null) return fresh.error;
        // Takes ownership whether accepted or rejected.
        return buffer.acceptExternalFrame(fresh.bitmap, fresh.timestamp, generation) ? null : "fresh_capture_stale";
    }

    @Override public String verify(LatestFrameBuffer.Frame observed, VirtualActionGuard.Box target) {
        if (observed == null || observed.bitmap.isRecycled() || target == null) return "fresh_capture_unavailable";
        Capture capture = capture();
        if (capture.error != null) return capture.error;
        Bitmap fresh = capture.bitmap;
        try {
            if (fresh.getWidth() != screen.width() || fresh.getHeight() != screen.height()
                    || target.left < 0 || target.top < 0 || target.right > screen.width()
                    || target.bottom > screen.height() || target.left >= target.right || target.top >= target.bottom)
                return "fresh_capture_geometry_changed";
            int width = target.right - target.left;
            int[] before = new int[width], after = new int[width];
            for (int row = target.top; row < target.bottom; row++) {
                observed.bitmap.getPixels(before, 0, width, target.left, row, width, 1);
                fresh.getPixels(after, 0, width, target.left, row, width, 1);
                if (!Arrays.equals(before, after)) return "target_pixels_changed";
            }
            long now = SystemClock.uptimeMillis();
            return capture.timestamp <= now && now - capture.timestamp <= 2000L ? null : "fresh_capture_expired";
        } finally { fresh.recycle(); }
    }

    private static final class Capture {
        final Bitmap bitmap;
        final long timestamp;
        final String error;
        Capture(Bitmap bitmap, long timestamp, String error) {
            this.bitmap = bitmap; this.timestamp = timestamp; this.error = error;
        }
    }

    private Capture capture() {
        if (Build.VERSION.SDK_INT < 30) return new Capture(null, 0, "fresh_capture_unavailable");
        final long requested = SystemClock.uptimeMillis();
        final CountDownLatch done = new CountDownLatch(1);
        final Object lock = new Object();
        final Capture[] result = new Capture[1];
        final boolean[] abandoned = {false};
        try {
            // Code security: display ID originates from the session-owned screen, never the model.
            service.takeScreenshot(screen.displayId(), new Executor() {
                @Override public void execute(Runnable task) { task.run(); }
            }, new AccessibilityService.TakeScreenshotCallback() {
                @Override public void onSuccess(AccessibilityService.ScreenshotResult shot) {
                    HardwareBuffer buffer = shot.getHardwareBuffer();
                    Bitmap software = null;
                    try {
                        if (shot.getTimestamp() >= requested) {
                            Bitmap hardware = Bitmap.wrapHardwareBuffer(buffer, shot.getColorSpace());
                            if (hardware != null) { software = hardware.copy(Bitmap.Config.ARGB_8888, false); hardware.recycle(); }
                        }
                    } catch (RuntimeException ignored) {
                        if (software != null) { software.recycle(); software = null; }
                    } finally { buffer.close(); }
                    synchronized (lock) {
                        if (abandoned[0] && software != null) software.recycle();
                        else result[0] = new Capture(software, shot.getTimestamp(), software == null ? "fresh_capture_unavailable" : null);
                    }
                    done.countDown();
                }
                @Override public void onFailure(int errorCode) { done.countDown(); }
            });
            if (!done.await(3, TimeUnit.SECONDS)) {
                synchronized (lock) { abandon(result, abandoned); }
                return new Capture(null, 0, "fresh_capture_timeout");
            }
            synchronized (lock) {
                Capture fresh = result[0]; result[0] = null; abandoned[0] = true;
                return fresh == null ? new Capture(null, 0, "fresh_capture_unavailable") : fresh;
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            synchronized (lock) { abandon(result, abandoned); }
            return new Capture(null, 0, "fresh_capture_interrupted");
        } catch (RuntimeException failure) {
            synchronized (lock) { abandon(result, abandoned); }
            return new Capture(null, 0, "fresh_capture_unavailable");
        }
    }

    private static void abandon(Capture[] result, boolean[] abandoned) {
        abandoned[0] = true;
        if (result[0] != null && result[0].bitmap != null) result[0].bitmap.recycle();
        result[0] = null;
    }
}
