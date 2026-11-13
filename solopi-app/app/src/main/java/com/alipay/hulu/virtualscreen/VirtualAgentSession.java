package com.alipay.hulu.virtualscreen;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.graphics.Bitmap;
import android.os.SystemClock;
import com.alipay.hulu.service.DeviceControlLease;

/** Device-side resources for one Agent lease. Not a public transport endpoint. */
public final class VirtualAgentSession implements AutoCloseable {
    private final String leaseOwner;
    private final String packageName;
    private final VirtualScreen screen;
    private final VirtualNodeController nodes;
    private final VirtualOcrEngine ocr;
    private final AccessibilityService accessibility;
    private boolean closed;
    private boolean ocrClosed;
    private long screenCreateMs = -1;
    private long launchSubmitMs = -1;
    private LatestFrameBuffer.Frame actionFrame;
    private String actionObservationId;

    VirtualAgentSession(String leaseOwner, String packageName, VirtualScreen screen, VirtualNodeController nodes) {
        this(leaseOwner, packageName, screen, nodes, null, null);
    }

    private VirtualAgentSession(String leaseOwner, String packageName, VirtualScreen screen,
                                VirtualNodeController nodes, VirtualOcrEngine ocr, AccessibilityService accessibility) {
        this.leaseOwner = leaseOwner; this.packageName = packageName; this.screen = screen; this.nodes = nodes;
        this.ocr = ocr;
        this.accessibility = accessibility;
    }

    /** Caller must register the returned resource under the lease before checking it again. */
    public static VirtualAgentSession create(Context context, AccessibilityService service, String packageName,
                                             String leaseOwner, int width, int height, int densityDpi) throws Exception {
        return create(context, service, packageName, leaseOwner, width, height, densityDpi, new AgentDisplayBridge(context));
    }

    private static VirtualAgentSession create(Context context, AccessibilityService service, String packageName,
                                              String leaseOwner, int width, int height, int densityDpi,
                                              VirtualScreen.Bridge bridge) throws Exception {
        if (context == null || service == null || packageName == null || packageName.isEmpty())
            throw new IllegalArgumentException("invalid_virtual_session");
        requireLease(leaseOwner);
        VirtualOcrEngine ocr = createOcr();
        VirtualScreen screen;
        long createStarted = SystemClock.elapsedRealtime();
        try { screen = VirtualScreen.create(bridge, width, height, densityDpi); }
        catch (Exception failure) { if (ocr != null) ocr.close(); throw failure; }
        long screenCreatedMs = SystemClock.elapsedRealtime() - createStarted;
        try {
            screen.startDisplayMonitoring(context);
            VirtualAccessibility.verifyGeometry(screen);
            // The resource owner rechecks the lease after registration, so even a concurrent
            // lease loss cannot discard the only reference needed to retry a failed close.
            VirtualNodeController nodes = new VirtualNodeController(screen, service, packageName);
            VirtualAgentSession session = new VirtualAgentSession(leaseOwner, packageName, screen, nodes, ocr, service);
            session.screenCreateMs = screenCreatedMs;
            return session;
        } catch (Exception failure) {
            try { screen.close(); } catch (Exception cleanup) { failure.addSuppressed(cleanup); }
            if (ocr != null) try { ocr.close(); } catch (RuntimeException cleanup) { failure.addSuppressed(cleanup); }
            throw failure;
        }
    }

    /** Registered under the device lease before the privileged helper can create any display. */
    public static final class TrustedResource implements AutoCloseable {
        private final TrustedDisplayBridge bridge;
        private VirtualAgentSession session;
        public TrustedResource(Context context) { bridge = new TrustedDisplayBridge(context); }
        public synchronized VirtualAgentSession initialize(Context context, AccessibilityService service, String packageName,
                                                            String owner, int width, int height, int density) throws Exception {
            if (session != null) throw new IllegalStateException("virtual_session_already_created");
            session = VirtualAgentSession.create(context, service, packageName, owner, width, height, density, bridge);
            return session;
        }
        public synchronized VirtualAgentSession session() { return session; }
        @Override public synchronized void close() throws Exception {
            if (session != null) session.close();
            else bridge.close();
        }
    }

    private static VirtualOcrEngine createOcr() {
        try {
            Object implementation = Class.forName("com.alipay.hulu.virtualscreen.OnDeviceOcr").newInstance();
            return implementation instanceof VirtualOcrEngine ? (VirtualOcrEngine) implementation : null;
        } catch (ReflectiveOperationException unavailable) {
            return null;
        } catch (LinkageError unavailable) {
            return null;
        }
    }

    public synchronized String launch(Context context) {
        requireOpen();
        long started = SystemClock.elapsedRealtime();
        try { return screen.launch(context, packageName); }
        finally { launchSubmitMs = SystemClock.elapsedRealtime() - started; }
    }

    public synchronized long screenCreateMs() { return screenCreateMs; }
    public synchronized long launchSubmitMs() { return launchSubmitMs; }

    public synchronized VirtualNodeController.Observation observe() {
        requireOpen(); clearActionFrame(); return nodes.observe();
    }

    /** Caller owns and must recycle the returned frame bitmap. */
    public static final class BoundObservation {
        public final VirtualNodeController.Observation observation;
        public final LatestFrameBuffer.Frame frame;
        private boolean frameConsumed;
        BoundObservation(VirtualNodeController.Observation observation, LatestFrameBuffer.Frame frame) {
            this.observation = observation; this.frame = frame;
        }
    }

    interface FrameConsumer { void read(LatestFrameBuffer buffer, LatestFrameBuffer.Frame frame); }

    /** Transfer the captured bitmap once to the on-device reader; no external image is accepted. */
    synchronized void readBoundFrame(BoundObservation bound, FrameConsumer consumer) {
        requireOpen();
        // Code security: OCR input is exactly the still-current observation owned by this session.
        if (bound == null || consumer == null || bound.frameConsumed || bound.frame.bitmap.isRecycled()
                || actionFrame == null || !actionObservationId.equals(bound.observation.id)
                || !screen.frames().isCurrent(bound.frame)) throw new IllegalStateException("stale_observation");
        bound.frameConsumed = true;
        consumer.read(screen.frames(), bound.frame);
    }

    public synchronized boolean hasOcr() { requireOpen(); return ocr != null && !ocrClosed; }

    public synchronized void verifyDisplayGeometry() { requireOpen(); VirtualAccessibility.verifyGeometry(screen); }

    public synchronized boolean targetActiveOnDefaultDisplay() {
        requireOpen();
        return VirtualAccessibility.activePackageOnDefaultDisplay(accessibility, packageName);
    }

    /** OCR runs only on this session's bound frame; it never dispatches input. */
    public synchronized void recognize(BoundObservation bound, VirtualOcrEngine.Callback callback) {
        requireOpen();
        if (ocr == null || ocrClosed) throw new IllegalStateException("virtual_ocr_unavailable");
        ocr.recognize(this, bound, callback);
    }

    /** Recheck OCR regions against a new frame and unchanged window/tree after recognition. */
    public synchronized VirtualOcrEngine.Result revalidateOcr(BoundObservation bound, VirtualOcrEngine.Result value) {
        requireOpen();
        if (bound == null || value == null || actionFrame == null
                || !actionObservationId.equals(bound.observation.id)
                || actionFrame.generation != value.frameGeneration || actionFrame.sequence != value.frameSequence)
            throw new IllegalStateException("stale_observation");
        // Code security: verify the same owned display and window on both sides of a fresh capture.
        if (VirtualActionGuard.comparePages(bound.observation.snapshot.guardPage, nodes.peek().guardPage) != null)
            throw new IllegalStateException("stale_observation");
        String error = nodes.refreshCachedFrame(actionFrame.generation);
        if (error != null) throw new IllegalStateException(error);
        if (VirtualActionGuard.comparePages(bound.observation.snapshot.guardPage, nodes.peek().guardPage) != null)
            throw new IllegalStateException("stale_observation");
        java.util.List<android.graphics.Rect> bounds = new java.util.ArrayList<android.graphics.Rect>();
        for (VirtualOcrEngine.Line line : value.lines) bounds.add(line.bounds);
        LatestFrameBuffer.RegionComparison comparison = screen.frames().compareRegions(actionFrame, bounds);
        java.util.List<VirtualOcrEngine.Line> lines = new java.util.ArrayList<VirtualOcrEngine.Line>();
        for (int i = 0; i < value.lines.size(); i++) {
            VirtualOcrEngine.Line line = value.lines.get(i);
            lines.add(new VirtualOcrEngine.Line(line.text, line.bounds, comparison.matching[i]));
        }
        return new VirtualOcrEngine.Result(value.frameGeneration, value.frameSequence, comparison.comparedSequence,
                "current".equals(comparison.freshness), comparison.freshness, lines);
    }

    /** Bind a newly captured frame to matching before/after accessibility windows and tree. */
    public synchronized BoundObservation observeWithFrame() throws InterruptedException {
        requireOpen();
        clearActionFrame();
        for (int attempt = 0; attempt < 3; attempt++) {
            // Code security: no prior observation or pre-capture frame survives a new capture attempt.
            long generation = screen.frames().invalidate();
            long started = SystemClock.uptimeMillis();
            VirtualNodeController.Observation before = nodes.observe();
            LatestFrameBuffer.Frame frame = null;
            long deadline = started + 2000L;
            boolean attemptedRefresh = false;
            while (frame == null && SystemClock.uptimeMillis() < deadline) {
                requireOpen();
                frame = screen.frames().copy(generation, started);
                if (frame == null && !attemptedRefresh && SystemClock.uptimeMillis() - started >= 250L) {
                    attemptedRefresh = true;
                    nodes.refreshCachedFrame(generation);
                    frame = screen.frames().copy(generation, started);
                }
                if (frame == null) Thread.sleep(40L);
            }
            if (frame == null) continue;
            boolean keep = false;
            try {
                // Code security: protected and entirely blank captures are indistinguishable; do not expose targets.
                if (VirtualFrameGuard.blackRegion(frame.bitmap,
                        new android.graphics.Rect(0, 0, frame.bitmap.getWidth(), frame.bitmap.getHeight())))
                    throw new IllegalStateException("virtual_protected_or_blank_frame");
                VirtualNodeController.Observation after = nodes.observe();
                requireOpen();
                VirtualActionGuard.Window activeWindow = null;
                for (VirtualActionGuard.Window window : after.snapshot.guardPage.windows)
                    if (window != null && window.id == after.snapshot.guardPage.windowId) {
                        if (activeWindow != null) throw new IllegalStateException("ambiguous_virtual_window");
                        activeWindow = window;
                    }
                if (activeWindow == null || activeWindow.bounds == null)
                    throw new IllegalStateException("virtual_window_unavailable");
                VirtualActionGuard.Box b = activeWindow.bounds;
                // Code security: a blacked-out protected dialog must not yield usable node handles.
                if (VirtualFrameGuard.blackRegion(frame.bitmap,
                        new android.graphics.Rect(b.left, b.top, b.right, b.bottom)))
                    throw new IllegalStateException("virtual_protected_or_blank_frame");
                if (VirtualActionGuard.comparePages(before.snapshot.guardPage, after.snapshot.guardPage) == null
                        && screen.frames().isCurrent(frame)) {
                    Bitmap actionBitmap = frame.bitmap.copy(Bitmap.Config.ARGB_8888, false);
                    if (actionBitmap == null) throw new IllegalStateException("virtual_frame_unavailable");
                    actionFrame = new LatestFrameBuffer.Frame(actionBitmap, frame.generation, frame.sequence, frame.uptimeMs);
                    actionObservationId = after.id;
                    keep = true;
                    return new BoundObservation(after, frame);
                }
            } finally {
                if (!keep) frame.bitmap.recycle();
            }
        }
        // Prevent the final unsuccessful attempt from leaving a usable target handle behind.
        screen.frames().invalidate();
        throw new IllegalStateException("virtual_observation_unstable");
    }

    public synchronized String click(String observationId, String nodePath) {
        requireOpen();
        if (actionFrame == null || !actionObservationId.equals(observationId)) return "stale_observation";
        try { return nodes.click(observationId, nodePath, actionFrame); }
        finally { clearActionFrame(); }
    }

    public synchronized String input(String observationId, String nodePath, String text) {
        requireOpen();
        if (actionFrame == null || !actionObservationId.equals(observationId)) return "stale_observation";
        try { return nodes.input(observationId, nodePath, text, actionFrame); }
        finally { clearActionFrame(); }
    }

    public synchronized String scroll(String observationId, String nodePath, String direction) {
        requireOpen();
        if (actionFrame == null || !actionObservationId.equals(observationId)) return "stale_observation";
        try { return nodes.scroll(observationId, nodePath, direction, actionFrame); }
        finally { clearActionFrame(); }
    }

    /** Internal caller supplies a rectangle already matched to a unique live OCR target. */
    public synchronized String clickVisual(String observationId, VirtualActionGuard.Box verifiedTarget) {
        requireOpen();
        if (actionFrame == null || !actionObservationId.equals(observationId)) return "stale_observation";
        try { return nodes.clickVisual(observationId, verifiedTarget, actionFrame); }
        finally { clearActionFrame(); }
    }

    public synchronized String scrollVisual(String observationId, String direction) {
        requireOpen();
        if (actionFrame == null || !actionObservationId.equals(observationId)) return "stale_observation";
        try { return nodes.scrollVisual(observationId, direction, actionFrame); }
        finally { clearActionFrame(); }
    }

    public synchronized LatestFrameBuffer.Frame frame(long generation, long newerThanUptimeMs) {
        requireOpen(); return screen.frames().copy(generation, newerThanUptimeMs);
    }

    public synchronized long frameGeneration() { requireOpen(); return screen.frames().generation(); }

    public synchronized int displayId() { requireOpen(); return screen.displayId(); }

    private void requireOpen() {
        if (closed) throw new IllegalStateException("virtual_session_closed");
        requireLease(leaseOwner);
    }

    private void clearActionFrame() {
        if (actionFrame != null) actionFrame.bitmap.recycle();
        actionFrame = null; actionObservationId = null;
    }

    private static void requireLease(String owner) {
        // Code security: the lease value originates from the server-held Agent session, not model input.
        if (!DeviceControlLease.isOwnedBy(owner)) throw new IllegalStateException("virtual_lease_lost");
    }

    @Override public synchronized void close() throws Exception {
        closed = true;
        clearActionFrame();
        if (ocr != null && !ocrClosed) {
            ocr.close();
            ocrClosed = true;
        }
        // Release stays retryable if the display backend reports a cleanup failure.
        screen.close();
    }
}
