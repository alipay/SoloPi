package com.alipay.hulu.virtualscreen;

import android.app.Activity;
import android.app.Instrumentation;
import android.app.Presentation;
import android.app.ActivityOptions;
import android.app.UiAutomation;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.os.Bundle;
import android.os.SystemClock;
import android.os.ParcelFileDescriptor;
import android.view.Display;
import android.view.Surface;
import android.widget.TextView;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.util.List;
import android.view.accessibility.AccessibilityWindowInfo;
import com.alipay.hulu.service.DeviceControlLease;

/** Isolated device probe: creates only an app-owned display and a synthetic presentation. */
public final class VirtualScreenInstrumentation extends Instrumentation {
    private boolean externalLaunch;
    private boolean shellLaunch;
    private boolean publicDisplay;
    private boolean tapProbe;
    private boolean destroyContent;
    private boolean boundFrameProbe;
    @Override public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        externalLaunch = arguments != null && "true".equals(arguments.getString("externalLaunch"));
        shellLaunch = arguments != null && "true".equals(arguments.getString("shellLaunch"));
        publicDisplay = arguments != null && "true".equals(arguments.getString("publicDisplay"));
        tapProbe = arguments != null && "true".equals(arguments.getString("tapProbe"));
        destroyContent = arguments != null && "true".equals(arguments.getString("destroyContent"));
        boundFrameProbe = arguments != null && "true".equals(arguments.getString("boundFrameProbe"));
        start();
    }

    @Override public void onStart() {
        Bundle result = new Bundle();
        LocalDisplayBridge bridge = null;
        VirtualScreen screen = null;
        final Presentation[] presentation = new Presentation[1];
        try {
            final Context context = getTargetContext();
            bridge = new LocalDisplayBridge(context);
            VirtualScreen.Bridge displayBridge = publicDisplay
                    ? (destroyContent ? new AgentDisplayBridge(context) : new ProbeDisplayBridge(context, false)) : bridge;
            screen = VirtualScreen.create(displayBridge, 720, 1280, 320);
            int id = screen.displayId();
            final Display display = ((DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE)).getDisplay(id);
            require(display != null && id != Display.DEFAULT_DISPLAY, "display was not created");
            if (shellLaunch) {
                UiAutomation ui = getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
                AccessibilityServiceInfo info = ui.getServiceInfo();
                info.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
                        | AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS
                        | AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
                ui.setServiceInfo(info);
                ParcelFileDescriptor descriptor = ui.executeShellCommand("am start --display " + id
                        + " -n com.solopi.fastpath.demo/.MainActivity");
                FileInputStream stream = new FileInputStream(descriptor.getFileDescriptor());
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] bytes = new byte[1024];
                int n;
                while ((n = stream.read(bytes)) > 0 && output.size() < 8192) output.write(bytes, 0, n);
                stream.close();
                descriptor.close();
                String response = output.toString("UTF-8");
                require(!response.contains("Error") && !response.contains("Exception"), "shell launch failed: " + response);
                Bundle state = new Bundle(); state.putString("displayId", Integer.toString(id));
                sendStatus(Activity.RESULT_OK, state);
                VirtualAccessibility.Snapshot snapshot = null;
                String lastState = "no_window_list";
                long readyDeadline = SystemClock.uptimeMillis() + 10000;
                while (snapshot == null && SystemClock.uptimeMillis() < readyDeadline) {
                    List<AccessibilityWindowInfo> windows = ui.getWindowsOnAllDisplays().get(id);
                    if (windows != null) {
                        lastState = "window_count=" + windows.size();
                        try { snapshot = VirtualAccessibility.observeWindows(screen, "com.solopi.fastpath.demo", windows); }
                        catch (IllegalStateException unavailable) { lastState += " error=" + unavailable.getMessage(); }
                    }
                    if (snapshot == null) SystemClock.sleep(200);
                }
                require(snapshot != null && snapshot.nodes.size() > 1, "controlled app nodes unavailable: " + lastState
                        + (snapshot == null ? "" : " node_count=" + snapshot.nodes.size()));
                if (boundFrameProbe) {
                    final VirtualScreen ownedScreen = screen;
                    final UiAutomation automation = ui;
                    final int ownedDisplayId = id;
                    String leaseOwner = DeviceControlLease.newOwner("virtual-probe");
                    require(DeviceControlLease.tryAcquire(leaseOwner), "probe lease unavailable");
                    try {
                        VirtualNodeController controller = new VirtualNodeController(screen, new VirtualNodeController.SnapshotSource() {
                            @Override public VirtualAccessibility.Snapshot observe() {
                                List<AccessibilityWindowInfo> windows = automation.getWindowsOnAllDisplays().get(ownedDisplayId);
                                if (windows == null) throw new IllegalStateException("virtual_windows_unavailable");
                                return VirtualAccessibility.observeWindows(ownedScreen, "com.solopi.fastpath.demo", windows);
                            }
                        });
                        VirtualAgentSession session = new VirtualAgentSession(leaseOwner, "com.solopi.fastpath.demo", screen, controller);
                        OnDeviceOcr localOcr = new OnDeviceOcr();
                        try {
                            result.putString("phase", "capture");
                            VirtualAgentSession.BoundObservation bound = session.observeWithFrame();
                            try {
                                require(bound.observation.snapshot.displayId == id, "bound display mismatch");
                                require(bound.frame.bitmap.getWidth() == 720 && bound.frame.bitmap.getHeight() == 1280,
                                        "bound frame geometry mismatch");
                                require(screen.frames().isCurrent(bound.frame), "bound frame is not current");
                                final CountDownLatch ocrFinished = new CountDownLatch(1);
                                final int[] ocrLineCount = {-1};
                                final String[] ocrError = {null};
                                final boolean[] ocrCurrent = {false};
                                final String[] ocrFreshness = {null};
                                final int[] ocrMatchingRegions = {0};
                                long ocrStarted = SystemClock.uptimeMillis();
                                result.putString("phase", "ocr_submit");
                                localOcr.read(session, bound, new OnDeviceOcr.Callback() {
                                    @Override public void onResult(OnDeviceOcr.Result value) {
                                        ocrLineCount[0] = value.lines.size(); ocrCurrent[0] = value.current;
                                        ocrFreshness[0] = value.freshness;
                                        for (OnDeviceOcr.Line line : value.lines) if (line.pixelsMatch) ocrMatchingRegions[0]++;
                                        ocrFinished.countDown();
                                    }
                                    @Override public void onError(String error) {
                                        ocrError[0] = error; ocrFinished.countDown();
                                    }
                                });
                                result.putString("phase", "ocr_wait");
                                require(ocrFinished.await(30, TimeUnit.SECONDS), "bound OCR timeout");
                                require(ocrError[0] == null && ocrLineCount[0] > 0, "bound OCR returned no text");
                                result.putString("ocrCurrent", String.valueOf(ocrCurrent[0]));
                                result.putString("ocrFreshness", ocrFreshness[0]);
                                result.putString("ocrLines", String.valueOf(ocrLineCount[0]));
                                result.putString("ocrMatchingRegions", String.valueOf(ocrMatchingRegions[0]));
                                result.putString("ocrMs", String.valueOf(SystemClock.uptimeMillis() - ocrStarted));
                                result.putString("phase", "stale_action");
                                screen.frames().invalidate();
                                require("stale_observation".equals(session.click(bound.observation.id, "0")),
                                        "invalidated frame did not reject the old action");
                            } finally { bound.frame.bitmap.recycle(); }
                        } finally { localOcr.close(); }
                    } finally { DeviceControlLease.release(leaseOwner); }
                }
                if (tapProbe) {
                    VirtualAccessibility.Node target = null;
                    long targetDeadline = SystemClock.uptimeMillis() + 5000;
                    do {
                        target = null;
                        for (VirtualAccessibility.Node node : snapshot.nodes) {
                            if (node.text.contains("标准订单流程") && node.visible && node.enabled && node.clickable) {
                                require(target == null, "ambiguous controlled target");
                                target = node;
                            }
                        }
                        if (target != null && target.bounds.left >= 0 && target.bounds.top >= 0
                                && target.bounds.right <= 720 && target.bounds.bottom <= 1280) break;
                        SystemClock.sleep(200);
                        List<AccessibilityWindowInfo> retry = ui.getWindowsOnAllDisplays().get(id);
                        if (retry != null) snapshot = VirtualAccessibility.observeWindows(screen, "com.solopi.fastpath.demo", retry);
                    } while (SystemClock.uptimeMillis() < targetDeadline);
                    if (target == null) {
                        StringBuilder labels = new StringBuilder();
                        for (VirtualAccessibility.Node node : snapshot.nodes) {
                            if (!node.text.isEmpty()) labels.append(node.text).append('|');
                        }
                        throw new IllegalStateException("controlled target unavailable: " + labels.toString());
                    }
                    require(target.bounds.left >= 0 && target.bounds.top >= 0
                            && target.bounds.right <= 720 && target.bounds.bottom <= 1280, "controlled target out of bounds: " + target.bounds);
                    List<AccessibilityWindowInfo> beforeClick = ui.getWindowsOnAllDisplays().get(id);
                    require(beforeClick != null, "window disappeared before click");
                    VirtualAccessibility.Snapshot fresh = VirtualAccessibility.observeWindows(screen, "com.solopi.fastpath.demo", beforeClick);
                    String refusal = VirtualActionGuard.check(snapshot.guardPage, fresh.guardPage, target.path);
                    require(refusal == null, "guard refused controlled target: " + refusal);
                    int x = target.bounds.centerX(), y = target.bounds.centerY();
                    ParcelFileDescriptor tap = ui.executeShellCommand("input -d " + id + " tap " + x + " " + y);
                    FileInputStream tapStream = new FileInputStream(tap.getFileDescriptor());
                    while (tapStream.read(bytes) != -1) { }
                    tapStream.close(); tap.close();
                    boolean observedOrders = false;
                    long orderDeadline = SystemClock.uptimeMillis() + 5000;
                    while (!observedOrders && SystemClock.uptimeMillis() < orderDeadline) {
                        List<AccessibilityWindowInfo> current = ui.getWindowsOnAllDisplays().get(id);
                        if (current != null) {
                            try {
                                VirtualAccessibility.Snapshot after = VirtualAccessibility.observeWindows(screen, "com.solopi.fastpath.demo", current);
                                for (VirtualAccessibility.Node node : after.nodes) if ("ORDERS".equals(node.text)) observedOrders = true;
                            } catch (IllegalStateException unavailable) { }
                        }
                        if (!observedOrders) SystemClock.sleep(200);
                    }
                    require(observedOrders, "tap did not reach fixed ORDERS checkpoint");
                }
                result.putString("result", "PASS: controlled app on display " + id + ", nodes=" + snapshot.nodes.size() + (tapProbe ? ", tap=ORDERS" : "") + (boundFrameProbe ? ", boundFrame=verified" : ""));
                screen.close(); screen = null;
                finish(Activity.RESULT_OK, result);
                return;
            }
            if (externalLaunch) {
                Intent intent = context.getPackageManager().getLaunchIntentForPackage("com.solopi.fastpath.demo");
                require(intent != null, "controlled app unavailable");
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent, ActivityOptions.makeBasic().setLaunchDisplayId(id).toBundle());
                Bundle state = new Bundle();
                state.putString("displayId", Integer.toString(id));
                sendStatus(Activity.RESULT_OK, state);
                SystemClock.sleep(8000);
                result.putString("result", "external launch requested on display " + id);
                screen.close();
                screen = null;
                finish(Activity.RESULT_OK, result);
                return;
            }
            runOnMainSync(new Runnable() {
                @Override public void run() {
                    presentation[0] = new Presentation(context, display);
                    TextView view = new TextView(context);
                    view.setText("SoloPi virtual screen 123");
                    view.setTextColor(Color.BLACK);
                    view.setBackgroundColor(Color.WHITE);
                    view.setTextSize(28);
                    presentation[0].setContentView(view);
                    presentation[0].show();
                }
            });
            LatestFrameBuffer.Frame frame = null;
            long deadline = SystemClock.uptimeMillis() + 10000;
            while (frame == null && SystemClock.uptimeMillis() < deadline) {
                frame = screen.frames().copy(screen.frames().generation(), 0);
                if (frame == null) SystemClock.sleep(100);
            }
            require(frame != null, "no fresh frame received");
            require(frame.bitmap.getWidth() == 720 && frame.bitmap.getHeight() == 1280, "incorrect frame dimensions");
            final CountDownLatch recognized = new CountDownLatch(1);
            final String[] ocrState = new String[1];
            final boolean[] fresh = new boolean[1];
            final long ocrStart = SystemClock.uptimeMillis();
            OnDeviceOcr ocr = new OnDeviceOcr();
            ocr.read(screen.frames(), frame, new OnDeviceOcr.Callback() {
                @Override public void onResult(OnDeviceOcr.Result value) {
                    boolean found = false;
                    for (OnDeviceOcr.Line line : value.lines) if (line.text.contains("SoloPi")) found = true;
                    ocrState[0] = found ? "success" : "expected_text_missing";
                    fresh[0] = value.current;
                    recognized.countDown();
                }
                @Override public void onError(String error) { ocrState[0] = error + " durationMs=" + (SystemClock.uptimeMillis() - ocrStart); recognized.countDown(); }
            });
            require(recognized.await(30, TimeUnit.SECONDS), "ocr timeout");
            ocr.close();
            require("success".equals(ocrState[0]), "ocr: " + ocrState[0]);
            runOnMainSync(new Runnable() { @Override public void run() { presentation[0].dismiss(); } });
            presentation[0] = null;
            screen.close();
            screen = null;
            require(((DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE)).getDisplay(id) == null,
                    "display release was not observed");
            result.putString("result", "PASS: private display, synthetic frame, local OCR, release; ocrCurrent=" + fresh[0]);
            finish(Activity.RESULT_OK, result);
        } catch (Throwable error) {
            result.putString("failure", error.getClass().getName() + ": " + error.getMessage());
            finish(Activity.RESULT_CANCELED, result);
        } finally {
            if (presentation[0] != null) runOnMainSync(new Runnable() { @Override public void run() { presentation[0].dismiss(); } });
            if (screen != null) try { screen.close(); } catch (Exception ignored) { }
            if (bridge != null) bridge.close();
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalStateException(message);
    }

    /** Used only for a synthetic test; never installed in the production APK. */
    private static final class ProbeDisplayBridge implements VirtualScreen.Bridge {
        private final DisplayManager manager;
        private final boolean destroyContent;
        private VirtualDisplay display;
        ProbeDisplayBridge(Context context, boolean destroyContent) {
            manager = (DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE);
            this.destroyContent = destroyContent;
        }
        @Override public int create(Surface surface, int width, int height, int density) {
            display = manager.createVirtualDisplay("SoloPi public probe", width, height, density, surface,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_PUBLIC | DisplayManager.VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY
                            | (destroyContent ? (1 << 8) : 0));
            return display == null ? -1 : display.getDisplay().getDisplayId();
        }
        @Override public void release(int id) {
            if (display == null || display.getDisplay().getDisplayId() != id) throw new IllegalStateException("display_not_owned");
            display.release(); display = null;
        }
    }
}
