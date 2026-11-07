package com.alipay.hulu.virtualscreen;

import android.accessibilityservice.AccessibilityService;
import android.os.SystemClock;
import android.graphics.Rect;
import com.alipay.hulu.common.tools.CmdTools;
import java.util.UUID;

/** In-process node controller; its owner must bind it to an authenticated device session. */
public final class VirtualNodeController {
    private static final long MAX_OBSERVATION_AGE_MS = 30_000L;
    private final VirtualScreen screen;
    interface SnapshotSource { VirtualAccessibility.Snapshot observe(); }
    private final SnapshotSource source;
    private final VirtualFrameVerifier verifier;
    private VirtualAccessibility.Snapshot observation;
    private String observationId;
    private long observedAt;
    private long observedGeneration;

    public VirtualNodeController(final VirtualScreen screen, final AccessibilityService service, final String packageName) {
        if (screen == null || service == null || packageName == null || packageName.isEmpty())
            throw new IllegalArgumentException("invalid_virtual_controller");
        this.screen = screen;
        this.source = new SnapshotSource() {
            @Override public VirtualAccessibility.Snapshot observe() {
                return VirtualAccessibility.observe(screen, service, packageName);
            }
        };
        this.verifier = createVerifier(service, screen);
    }

    // Package-private injection is used by the on-device instrumentation probe.
    VirtualNodeController(VirtualScreen screen, SnapshotSource source) {
        if (screen == null || source == null) throw new IllegalArgumentException("invalid_virtual_controller");
        this.screen = screen; this.source = source; this.verifier = null;
    }

    public static final class Observation {
        public final String id;
        public final VirtualAccessibility.Snapshot snapshot;
        Observation(String id, VirtualAccessibility.Snapshot snapshot) { this.id = id; this.snapshot = snapshot; }
    }

    public synchronized Observation observe() {
        // Code security: observation handles are created locally and cannot choose a display.
        synchronized (screen) {
            // A failed refresh must not leave the previous observation usable.
            observation = null; observationId = null;
            long captureStarted = SystemClock.uptimeMillis();
            long generation = screen.frames().generation();
            observation = source.observe();
            if (!VirtualActionGuard.observationFresh(captureStarted, SystemClock.uptimeMillis(),
                    MAX_OBSERVATION_AGE_MS, generation, screen.frames().generation())) {
                observation = null; observationId = null;
                throw new IllegalStateException("stale_observation");
            }
            observedAt = captureStarted;
            observedGeneration = generation;
            observationId = UUID.randomUUID().toString();
            return new Observation(observationId, observation);
        }
    }

    synchronized VirtualAccessibility.Snapshot peek() {
        synchronized (screen) { return source.observe(); }
    }

    /** Return a rejection code or a dispatch state; never treat dispatch as business success. */
    synchronized String click(String expectedId, String nodePath, LatestFrameBuffer.Frame frame) {
        if (observation == null || observationId == null || !observationId.equals(expectedId)) return "stale_observation";
        synchronized (screen) {
            VirtualAccessibility.Snapshot original = observation;
            long capturedAt = observedAt;
            long generation = observedGeneration;
            // Code security: consume the handle before capture or dispatch, including error paths.
            observation = null; observationId = null;
            if (!VirtualActionGuard.observationFresh(capturedAt, SystemClock.uptimeMillis(),
                    MAX_OBSERVATION_AGE_MS, generation, screen.frames().generation())) return "stale_observation";
            VirtualAccessibility.Snapshot current = source.observe();
            String rejection = VirtualActionGuard.check(original.guardPage, current.guardPage, nodePath);
            if (rejection != null) return "stale_observation".equals(rejection) ? "target_tree_changed" : rejection;
            VirtualActionGuard.Node selected = null;
            for (VirtualActionGuard.Node node : current.guardPage.nodes) if (node.path.equals(nodePath)) selected = node;
            if (selected == null) return "target_unavailable";
            int x = selected.bounds.left + (selected.bounds.right - selected.bounds.left) / 2;
            int y = selected.bounds.top + (selected.bounds.bottom - selected.bounds.top) / 2;
            // Code security: recapture itself may have outlived the observation; check again before dispatch.
            if (!VirtualActionGuard.observationFresh(capturedAt, SystemClock.uptimeMillis(),
                    MAX_OBSERVATION_AGE_MS, generation, screen.frames().generation())) return "stale_observation";
            String frameError = verifyTargetFrame(frame, selected.bounds);
            if (frameError != null) return frameError;
            // Code security: the window and node are re-read after the on-demand screenshot.
            rejection = VirtualActionGuard.check(original.guardPage, source.observe().guardPage, nodePath);
            if (rejection != null) return rejection;
            if (!VirtualActionGuard.observationFresh(capturedAt, SystemClock.uptimeMillis(),
                    MAX_OBSERVATION_AGE_MS, generation, screen.frames().generation())) return "stale_observation";
            // Invalidate before the one physical command; interrupted callers must re-observe.
            screen.frames().invalidate();
            return CmdTools.tapOnDisplayOnce(screen.displayId(), x, y, screen.width(), screen.height());
        }
    }

    /** Direction is the movement of the finger; coordinates come only from a checked node. */
    synchronized String scroll(String expectedId, String nodePath, String direction, LatestFrameBuffer.Frame frame) {
        if (!("up".equals(direction) || "down".equals(direction)
                || "left".equals(direction) || "right".equals(direction))) return "invalid_direction";
        if (observation == null || observationId == null || !observationId.equals(expectedId)) return "stale_observation";
        synchronized (screen) {
            VirtualAccessibility.Snapshot original = observation;
            long capturedAt = observedAt;
            long generation = observedGeneration;
            // Code security: consume the observation before any fresh check or physical input.
            observation = null; observationId = null;
            if (!VirtualActionGuard.observationFresh(capturedAt, SystemClock.uptimeMillis(),
                    MAX_OBSERVATION_AGE_MS, generation, screen.frames().generation())) return "stale_observation";
            VirtualAccessibility.Snapshot current = source.observe();
            String rejection = VirtualActionGuard.checkScroll(original.guardPage, current.guardPage, nodePath);
            if (rejection != null) return "stale_observation".equals(rejection) ? "target_tree_changed" : rejection;
            VirtualActionGuard.Node selected = null;
            for (VirtualActionGuard.Node node : current.guardPage.nodes) if (node.path.equals(nodePath)) selected = node;
            if (selected == null) return "target_unavailable";
            VirtualActionGuard.Box b = selected.bounds;
            int x1 = b.left + (b.right - b.left) / 2, x2 = x1;
            int y1 = b.top + (b.bottom - b.top) / 2, y2 = y1;
            int xLow = b.left + (b.right - b.left) / 5, xHigh = b.right - 1 - (b.right - b.left) / 5;
            int yLow = b.top + (b.bottom - b.top) / 5, yHigh = b.bottom - 1 - (b.bottom - b.top) / 5;
            if ("up".equals(direction)) { y1 = yHigh; y2 = yLow; }
            else if ("down".equals(direction)) { y1 = yLow; y2 = yHigh; }
            else if ("left".equals(direction)) { x1 = xHigh; x2 = xLow; }
            else { x1 = xLow; x2 = xHigh; }
            if (x1 == x2 && y1 == y2) return "target_geometry_unknown";
            VirtualActionGuard.Box gestureRegion = VirtualActionGuard.scrollPathRegion(b, x1, y1, x2, y2);
            if (gestureRegion == null) return "target_geometry_unknown";
            if (!VirtualActionGuard.observationFresh(capturedAt, SystemClock.uptimeMillis(),
                    MAX_OBSERVATION_AGE_MS, generation, screen.frames().generation())) return "stale_observation";
            // Code security: verify the full gesture corridor while tree and windows still guard the node.
            String frameError = verifyTargetFrame(frame, gestureRegion);
            if (frameError != null) return frameError;
            rejection = VirtualActionGuard.checkScroll(original.guardPage, source.observe().guardPage, nodePath);
            if (rejection != null) return rejection;
            if (!VirtualActionGuard.observationFresh(capturedAt, SystemClock.uptimeMillis(),
                    MAX_OBSERVATION_AGE_MS, generation, screen.frames().generation())) return "stale_observation";
            // Code security: device and points are derived from the owned screen and verified node only.
            screen.frames().invalidate();
            return CmdTools.swipeOnDisplayOnce(screen.displayId(), x1, y1, x2, y2, screen.width(), screen.height());
        }
    }

    /** Caller must first match this rectangle to a unique, freshly verified OCR target. */
    synchronized String clickVisual(String expectedId, VirtualActionGuard.Box target, LatestFrameBuffer.Frame frame) {
        if (observation == null || observationId == null || !observationId.equals(expectedId)) return "stale_observation";
        synchronized (screen) {
            VirtualAccessibility.Snapshot original = observation;
            long capturedAt = observedAt, generation = observedGeneration;
            observation = null; observationId = null;
            if (!VirtualActionGuard.observationFresh(capturedAt, SystemClock.uptimeMillis(),
                    MAX_OBSERVATION_AGE_MS, generation, screen.frames().generation())) return "stale_observation";
            String rejection = VirtualActionGuard.checkVisual(original.guardPage, source.observe().guardPage, target);
            if (rejection != null) return rejection;
            String frameError = verifyTargetFrame(frame, target);
            if (frameError != null) return frameError;
            rejection = VirtualActionGuard.checkVisual(original.guardPage, source.observe().guardPage, target);
            if (rejection != null) return rejection;
            if (!VirtualActionGuard.observationFresh(capturedAt, SystemClock.uptimeMillis(),
                    MAX_OBSERVATION_AGE_MS, generation, screen.frames().generation())) return "stale_observation";
            int x = target.left + (target.right - target.left) / 2;
            int y = target.top + (target.bottom - target.top) / 2;
            screen.frames().invalidate();
            return CmdTools.tapOnDisplayOnce(screen.displayId(), x, y, screen.width(), screen.height());
        }
    }

    /** A device-derived viewport is usable only while the bound empty-node page remains unchanged. */
    synchronized String scrollVisual(String expectedId, String direction, LatestFrameBuffer.Frame frame) {
        if (!("up".equals(direction) || "down".equals(direction))) return "invalid_direction";
        if (observation == null || observationId == null || !observationId.equals(expectedId)) return "stale_observation";
        synchronized (screen) {
            VirtualAccessibility.Snapshot original = observation;
            long capturedAt = observedAt, generation = observedGeneration;
            observation = null; observationId = null;
            if (!VirtualActionGuard.observationFresh(capturedAt, SystemClock.uptimeMillis(), MAX_OBSERVATION_AGE_MS,
                    generation, screen.frames().generation())) return "stale_observation";
            VirtualActionGuard.Box area = VirtualActionGuard.visualScrollArea(original.guardPage);
            if (area == null) return "viewport_unavailable";
            String rejection = VirtualActionGuard.checkVisual(original.guardPage, source.observe().guardPage, area);
            if (rejection != null) return rejection;
            String frameError = verifyTargetFrame(frame, area);
            if (frameError != null) return frameError;
            rejection = VirtualActionGuard.checkVisual(original.guardPage, source.observe().guardPage, area);
            if (rejection != null) return rejection;
            if (!VirtualActionGuard.observationFresh(capturedAt, SystemClock.uptimeMillis(), MAX_OBSERVATION_AGE_MS,
                    generation, screen.frames().generation())) return "stale_observation";
            int x = area.left + (area.right - area.left) / 2;
            int high = area.bottom - 1, low = area.top;
            // Code security: the gesture is derived from the owned window, never caller coordinates.
            screen.frames().invalidate();
            return CmdTools.swipeOnDisplayOnce(screen.displayId(), x, "up".equals(direction) ? high : low,
                    x, "up".equals(direction) ? low : high, screen.width(), screen.height());
        }
    }

    private String verifyTargetFrame(LatestFrameBuffer.Frame frame, VirtualActionGuard.Box bounds) {
        // Code security: a blacked-out target cannot be verified even if two black frames match.
        if (frame == null || VirtualFrameGuard.blackRegion(frame.bitmap, rect(bounds))) return "target_protected_or_blank";
        String freshness = screen.frames().freshness(frame);
        if ("current".equals(freshness) || "pixels_changed".equals(freshness))
            return screen.frames().regionPixelsMatch(frame, rect(bounds)) ? null : "target_pixels_changed";
        if ("frame_expired".equals(freshness) && verifier != null) return verifier.verify(frame, bounds);
        return "frame_" + freshness;
    }

    String refreshCachedFrame(long generation) {
        return verifier == null ? "fresh_capture_unavailable" : verifier.refresh(screen.frames(), generation);
    }

    private static VirtualFrameVerifier createVerifier(AccessibilityService service, VirtualScreen screen) {
        try {
            Object instance = Class.forName("com.alipay.hulu.virtualscreen.OnDemandFrameVerifier")
                    .getConstructor(AccessibilityService.class, VirtualScreen.class).newInstance(service, screen);
            return instance instanceof VirtualFrameVerifier ? (VirtualFrameVerifier) instance : null;
        } catch (ReflectiveOperationException unavailable) { return null; }
        catch (LinkageError unavailable) { return null; }
    }

    private static Rect rect(VirtualActionGuard.Box box) {
        return new Rect(box.left, box.top, box.right, box.bottom);
    }
}
