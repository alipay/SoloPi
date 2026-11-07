package com.alipay.hulu.virtualscreen;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

/** Conservative node-click check. It does not inject input or grant an execution lease. */
public final class VirtualActionGuard {
    /** Bounds the lifetime of an observation even when a page looks unchanged. */
    public static boolean observationFresh(long observedAt, long now, long maxAgeMs,
                                           long observedGeneration, long currentGeneration) {
        return observedAt >= 0 && now >= observedAt && maxAgeMs > 0
                && now - observedAt <= maxAgeMs && observedGeneration == currentGeneration;
    }
    public static final class Box {
        public final int left, top, right, bottom;
        public Box(int left, int top, int right, int bottom) {
            this.left = left; this.top = top; this.right = right; this.bottom = bottom;
        }
        boolean valid(int width, int height) {
            return left >= 0 && top >= 0 && right > left && bottom > top && right <= width && bottom <= height;
        }
        boolean intersects(Box other) {
            return left < other.right && right > other.left && top < other.bottom && bottom > other.top;
        }
        @Override public boolean equals(Object value) {
            if (!(value instanceof Box)) return false;
            Box b = (Box) value;
            return left == b.left && top == b.top && right == b.right && bottom == b.bottom;
        }
        @Override public int hashCode() { return Objects.hash(left, top, right, bottom); }
    }
    public static final class Window {
        public final int id, layer;
        public final Box bounds;
        public Window(int id, int layer, Box bounds) { this.id = id; this.layer = layer; this.bounds = bounds; }
        @Override public boolean equals(Object value) {
            if (!(value instanceof Window)) return false;
            Window w = (Window) value;
            return id == w.id && layer == w.layer && Objects.equals(bounds, w.bounds);
        }
        @Override public int hashCode() { return Objects.hash(id, layer, bounds); }
    }
    public static final class Node {
        public final String path, text, description, resourceId, role;
        public final Box bounds;
        public final boolean visible, enabled, clickable, password, scrollable;
        public Node(String path, String text, String description, String resourceId, String role, Box bounds,
                    boolean visible, boolean enabled, boolean clickable, boolean password) {
            this(path, text, description, resourceId, role, bounds, visible, enabled, clickable, password, false);
        }
        public Node(String path, String text, String description, String resourceId, String role, Box bounds,
                    boolean visible, boolean enabled, boolean clickable, boolean password, boolean scrollable) {
            this.path = path; this.text = text; this.description = description; this.resourceId = resourceId;
            this.role = role; this.bounds = bounds; this.visible = visible; this.enabled = enabled;
            this.clickable = clickable; this.password = password; this.scrollable = scrollable;
        }
        @Override public boolean equals(Object value) {
            if (!(value instanceof Node)) return false;
            Node n = (Node) value;
            return Objects.equals(path, n.path) && Objects.equals(text, n.text)
                    && Objects.equals(description, n.description) && Objects.equals(resourceId, n.resourceId)
                    && Objects.equals(role, n.role) && Objects.equals(bounds, n.bounds)
                    && visible == n.visible && enabled == n.enabled && clickable == n.clickable
                    && password == n.password && scrollable == n.scrollable;
        }
        @Override public int hashCode() { return Objects.hash(path, text, description, resourceId, role, bounds, visible, enabled, clickable, password, scrollable); }
    }
    public static final class Page {
        public final int displayId, windowId, width, height, rotation;
        public final String packageName;
        public final List<Window> windows;
        public final List<Node> nodes;
        public Page(int displayId, int windowId, int width, int height, int rotation, String packageName,
                    List<Window> windows, List<Node> nodes) {
            this.displayId = displayId; this.windowId = windowId; this.width = width; this.height = height;
            this.rotation = rotation; this.packageName = packageName;
            this.windows = Collections.unmodifiableList(new ArrayList<Window>(windows));
            this.nodes = Collections.unmodifiableList(new ArrayList<Node>(nodes));
        }
    }
    /** Returns a stable rejection code or null when the candidate passes all checks. */
    public static String check(Page previous, Page current, String path) {
        return checkTarget(previous, current, path, false);
    }

    public static String checkScroll(Page previous, Page current, String path) {
        return checkTarget(previous, current, path, true);
    }

    /** Bounds the gesture and a narrow safety margin inside the verified scrollable node. */
    static Box scrollPathRegion(Box node, int x1, int y1, int x2, int y2) {
        if (node == null || node.right <= node.left || node.bottom <= node.top
                || x1 < node.left || x1 >= node.right || x2 < node.left || x2 >= node.right
                || y1 < node.top || y1 >= node.bottom || y2 < node.top || y2 >= node.bottom) return null;
        int mx = Math.max(1, (node.right - node.left) / 20);
        int my = Math.max(1, (node.bottom - node.top) / 20);
        return new Box(Math.max(node.left, Math.min(x1, x2) - mx),
                Math.max(node.top, Math.min(y1, y2) - my),
                Math.min(node.right, Math.max(x1, x2) + mx + 1),
                Math.min(node.bottom, Math.max(y1, y2) + my + 1));
    }

    /** Derive a scroll area only for a window with an empty accessibility root. */
    public static Box visualScrollArea(Page page) {
        if (page == null || page.nodes.size() != 1) return null;
        Node root = page.nodes.get(0);
        if (root == null || !"0".equals(root.path) || root.clickable || root.scrollable || root.password
                || (root.text != null && !root.text.isEmpty())
                || (root.description != null && !root.description.isEmpty())) return null;
        Window selected = null;
        for (Window window : page.windows) {
            if (window != null && window.id == page.windowId) {
                if (selected != null) return null;
                selected = window;
            }
        }
        if (selected == null || selected.bounds == null || !selected.bounds.valid(page.width, page.height)) return null;
        Box b = selected.bounds;
        int width = b.right - b.left, height = b.bottom - b.top;
        if (width < 100 || height < 200) return null;
        return new Box(b.left + width * 2 / 5, b.top + height / 4,
                b.right - width * 2 / 5, b.bottom - height / 4);
    }

    /** Window/geometry check for an OCR rectangle; text identity is checked separately. */
    public static String checkVisual(Page previous, Page current, Box target) {
        String pageMismatch = comparePages(previous, current);
        if (pageMismatch != null) return pageMismatch;
        if (target == null || !target.valid(current.width, current.height)) return "target_geometry_unknown";
        Window targetWindow = null;
        for (Window window : current.windows) {
            if (window == null || window.bounds == null || !window.bounds.valid(current.width, current.height))
                return "window_geometry_unknown";
            if (window.id == current.windowId) {
                if (targetWindow != null) return "ambiguous_window";
                targetWindow = window;
            }
        }
        if (targetWindow == null) return "window_unavailable";
        if (target.left < targetWindow.bounds.left || target.top < targetWindow.bounds.top
                || target.right > targetWindow.bounds.right || target.bottom > targetWindow.bounds.bottom)
            return "target_geometry_unknown";
        for (Window window : current.windows)
            if (window.id != targetWindow.id && window.layer >= targetWindow.layer && window.bounds.intersects(target))
                return "target_occluded";
        for (Node node : current.nodes) {
            if (node == null || node.bounds == null || !node.bounds.intersects(target)) continue;
            if (node.password) return "target_protected";
            // Code security: OCR must not turn a disabled accessible control into a tappable target.
            if (node.visible && !node.enabled) return "target_disabled";
            // An actionable node owns this region; use its verified node action instead.
            if (node.visible && node.enabled && node.clickable) return "target_has_accessible_node";
        }
        return null;
    }

    private static String checkTarget(Page previous, Page current, String path, boolean scroll) {
        if (previous == null || current == null || path == null || path.isEmpty()) return "invalid_observation";
        String pageMismatch = comparePages(previous, current);
        if (pageMismatch != null) return pageMismatch;
        Node target = null;
        for (Node node : current.nodes) {
            if (node == null) return "invalid_observation";
            if (path.equals(node.path)) {
                if (target != null) return "ambiguous_target";
                target = node;
            }
        }
        if (target == null || !target.visible || !target.enabled || target.password
                || (scroll ? !target.scrollable : !target.clickable)) return "target_unavailable";
        if (target.bounds == null || !target.bounds.valid(current.width, current.height)) return "target_geometry_unknown";
        Window targetWindow = null;
        for (Window w : current.windows) {
            if (w == null || w.bounds == null || !w.bounds.valid(current.width, current.height)) return "window_geometry_unknown";
            if (w.id == current.windowId) {
                if (targetWindow != null) return "ambiguous_window";
                targetWindow = w;
            }
        }
        if (targetWindow == null) return "window_unavailable";
        if (target.bounds.left < targetWindow.bounds.left || target.bounds.top < targetWindow.bounds.top
                || target.bounds.right > targetWindow.bounds.right || target.bounds.bottom > targetWindow.bounds.bottom)
            return "target_geometry_unknown";
        for (Window w : current.windows) {
            if (w.id != targetWindow.id && w.layer >= targetWindow.layer && w.bounds.intersects(target.bounds)) return "target_occluded";
        }
        return null;
    }

    /** Compare page identity and structure, including all windows, without picking a target. */
    public static String comparePages(Page previous, Page current) {
        if (previous == null || current == null) return "invalid_observation";
        if (previous.displayId <= 0 || previous.displayId != current.displayId || previous.windowId != current.windowId
                || previous.width != current.width || previous.height != current.height || previous.rotation != current.rotation
                || previous.width <= 0 || previous.height <= 0 || previous.packageName == null || previous.packageName.isEmpty()
                || !previous.packageName.equals(current.packageName)) return "screen_changed";
        if (!previous.nodes.equals(current.nodes) || !previous.windows.equals(current.windows)) return "stale_observation";
        return null;
    }
    private VirtualActionGuard() { }
}
