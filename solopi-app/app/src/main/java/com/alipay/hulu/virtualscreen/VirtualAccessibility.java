package com.alipay.hulu.virtualscreen;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Rect;
import android.graphics.Point;
import android.os.Build;
import android.util.SparseArray;
import android.hardware.display.DisplayManager;
import android.content.Context;
import android.view.Display;
import com.alipay.hulu.common.application.LauncherApplication;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Read-only accessibility snapshot of one session-owned virtual display. */
public final class VirtualAccessibility {
    private static final int MAX_NODES = 2000;
    private static final int MAX_DEPTH = 60;

    public static final class Node {
        public final String path, text, description, resourceId, role;
        public final Rect bounds;
        public final boolean visible, enabled, clickable, password, scrollable;
        Node(String path, AccessibilityNodeInfo node, boolean ancestorPassword) {
            this.path = path;
            this.password = ancestorPassword || node.isPassword();
            // Code security: password nodes must not return their content or description.
            this.text = password ? "" : bounded(node.getText());
            this.description = password ? "" : bounded(node.getContentDescription());
            this.resourceId = bounded(node.getViewIdResourceName());
            this.role = bounded(node.getClassName());
            this.bounds = new Rect();
            node.getBoundsInScreen(bounds);
            this.visible = node.isVisibleToUser();
            this.enabled = node.isEnabled();
            this.clickable = node.isClickable();
            this.scrollable = node.isScrollable();
        }
    }

    public static final class Snapshot {
        public final int displayId, windowId;
        public final List<Node> nodes;
        public final VirtualActionGuard.Page guardPage;
        Snapshot(int displayId, int windowId, List<Node> nodes, VirtualActionGuard.Page guardPage) {
            this.displayId = displayId; this.windowId = windowId;
            this.nodes = Collections.unmodifiableList(nodes);
            this.guardPage = guardPage;
        }
    }

    /** Rejects missing and ambiguous target windows; caller must bind result to its session. */
    public static Snapshot observe(VirtualScreen screen, AccessibilityService service, String expectedPackage) {
        if (screen == null || service == null || expectedPackage == null || expectedPackage.isEmpty())
            throw new IllegalArgumentException("invalid_virtual_observation");
        if (Build.VERSION.SDK_INT < 30) throw new IllegalStateException("multi_display_accessibility_unavailable");
        verifyGeometry(screen);
        int displayId = screen.displayId();
        return observeWindows(screen, expectedPackage, windows(service, displayId));
    }

    // Package-private to permit a device instrumentation probe of the same conversion logic.
    static Snapshot observeWindows(VirtualScreen screen, String expectedPackage, List<AccessibilityWindowInfo> windows) {
        int displayId = screen.displayId();
        AccessibilityNodeInfo selected = null;
        int selectedId = -1;
        try {
            for (AccessibilityWindowInfo window : windows) {
                if (window == null || window.getType() != AccessibilityWindowInfo.TYPE_APPLICATION) continue;
                AccessibilityNodeInfo root = window.getRoot();
                if (root == null) continue;
                CharSequence pkg = root.getPackageName();
                if (!expectedPackage.contentEquals(pkg == null ? "" : pkg)) { root.recycle(); continue; }
                if (selected != null) { root.recycle(); throw new IllegalStateException("ambiguous_virtual_window"); }
                selected = root;
                selectedId = window.getId();
            }
            if (selected == null) throw new IllegalStateException("virtual_window_unavailable");
            List<Node> nodes = new ArrayList<Node>();
            visit(selected, "0", 0, false, expectedPackage, nodes);
            if (screen.displayId() != displayId) throw new IllegalStateException("virtual_display_changed");
            Display display = verifyGeometry(screen);
            List<VirtualActionGuard.Window> guardWindows = new ArrayList<VirtualActionGuard.Window>();
            for (AccessibilityWindowInfo window : windows) {
                if (window == null) throw new IllegalStateException("virtual_window_unavailable");
                Rect bounds = new Rect(); window.getBoundsInScreen(bounds);
                guardWindows.add(new VirtualActionGuard.Window(window.getId(), window.getLayer(), box(bounds)));
            }
            List<VirtualActionGuard.Node> guardNodes = new ArrayList<VirtualActionGuard.Node>();
            for (Node node : nodes) guardNodes.add(new VirtualActionGuard.Node(node.path, node.text, node.description,
                    node.resourceId, node.role, box(node.bounds), node.visible, node.enabled, node.clickable, node.password, node.scrollable));
            VirtualActionGuard.Page page = new VirtualActionGuard.Page(displayId, selectedId, screen.width(), screen.height(),
                    display.getRotation(), expectedPackage, guardWindows, guardNodes);
            return new Snapshot(displayId, selectedId, nodes, page);
        } finally {
            if (selected != null) selected.recycle();
            for (AccessibilityWindowInfo window : windows) if (window != null) window.recycle();
        }
    }

    static Display verifyGeometry(VirtualScreen screen) {
        DisplayManager manager = (DisplayManager) LauncherApplication.getContext().getSystemService(Context.DISPLAY_SERVICE);
        Display display = manager == null ? null : manager.getDisplay(screen.displayId());
        if (display == null) throw new IllegalStateException("virtual_display_unavailable");
        Point real = new Point();
        display.getRealSize(real);
        // Code security: coordinates remain valid only for the screen's original geometry.
        screen.verifyGeometry(real.x, real.y, display.getRotation());
        return display;
    }

    @SuppressWarnings("unchecked")
    private static List<AccessibilityWindowInfo> windows(AccessibilityService service, int displayId) {
        try {
            Method method = AccessibilityService.class.getMethod("getWindowsOnAllDisplays");
            Object result = method.invoke(service);
            if (!(result instanceof SparseArray)) throw new IllegalStateException("virtual_windows_unavailable");
            List<AccessibilityWindowInfo> found = ((SparseArray<List<AccessibilityWindowInfo>>) result).get(displayId);
            return found == null ? Collections.<AccessibilityWindowInfo>emptyList() : found;
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("virtual_windows_unavailable", error);
        }
    }

    /** Only a package identity and active/focused state leave this check; no window content does. */
    public static boolean activePackageOnDefaultDisplay(AccessibilityService service, String expectedPackage) {
        if (service == null || expectedPackage == null || Build.VERSION.SDK_INT < 30) return false;
        List<AccessibilityWindowInfo> found;
        try { found = windows(service, Display.DEFAULT_DISPLAY); }
        catch (RuntimeException unavailable) { return false; }
        try {
            for (AccessibilityWindowInfo window : found) {
                if (window == null || window.getType() != AccessibilityWindowInfo.TYPE_APPLICATION
                        || (!window.isActive() && !window.isFocused())) continue;
                AccessibilityNodeInfo root = window.getRoot();
                if (root == null) continue;
                try {
                    CharSequence pkg = root.getPackageName();
                    if (pkg != null && expectedPackage.contentEquals(pkg)) return true;
                } finally { root.recycle(); }
            }
            return false;
        } finally {
            for (AccessibilityWindowInfo window : found) if (window != null) window.recycle();
        }
    }

    private static void visit(AccessibilityNodeInfo node, String path, int depth, boolean ancestorPassword,
                              String expectedPackage, List<Node> nodes) {
        if (nodes.size() >= MAX_NODES || depth > MAX_DEPTH) throw new IllegalStateException("virtual_tree_too_large");
        // Code security: never attribute a foreign application's embedded node to the target package.
        CharSequence pkg = node.getPackageName();
        if (pkg == null || !expectedPackage.contentEquals(pkg)) throw new IllegalStateException("virtual_foreign_node");
        boolean protectedNode = ancestorPassword || node.isPassword();
        nodes.add(new Node(path, node, ancestorPassword));
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            try { visit(child, path + "." + i, depth + 1, protectedNode, expectedPackage, nodes); }
            finally { child.recycle(); }
        }
    }

    private static String bounded(CharSequence value) {
        if (value == null) return "";
        String text = value.toString();
        return text.length() <= 4096 ? text : text.substring(0, 4096);
    }

    private static VirtualActionGuard.Box box(Rect value) {
        return new VirtualActionGuard.Box(value.left, value.top, value.right, value.bottom);
    }

    private VirtualAccessibility() { }
}
