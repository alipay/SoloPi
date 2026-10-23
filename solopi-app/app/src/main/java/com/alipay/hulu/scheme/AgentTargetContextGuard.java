package com.alipay.hulu.scheme;

import android.graphics.Rect;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.serializer.SerializerFeature;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Device-owned, deliberately narrow native-click validation; never a client-supplied proof. */
final class AgentTargetContextGuard {
    static final String FULL_PAGE = "full-page";
    static final String TARGET_CONTEXT_V1 = "target-context-v1";
    private static final int MAX_NODES = 10000;
    private static final int MAX_DEPTH = 100;

    static boolean supports(String strategy) {
        return FULL_PAGE.equals(strategy) || TARGET_CONTEXT_V1.equals(strategy);
    }

    /** A stable page may already contain an overlay; equality is not hit-test proof. */
    static String clickOcclusionReason(Map<String, Object> page, String nodeId, int[] verifiedPath) {
        Snapshot snapshot = capture(new JSONObject(page), -1, null);
        Node target = snapshot == null ? null : verifiedPath == null
                ? snapshot.nodes.get(nodeId) : snapshot.at(verifiedPath);
        if (target == null || target.bounds == null || !target.bounds.nonEmpty()) {
            return "target_geometry_unknown";
        }
        for (Node peer : snapshot.nodes.values()) {
            // Code security: ignore ancestors/descendants; a label is not an occluder.
            // Do not guess z-order for an independent visible interactive peer.
            if (peer.bounds != null && peer.bounds.intersects(target.bounds)
                    && !prefix(peer.path, target.path) && !prefix(target.path, peer.path)
                    && Boolean.TRUE.equals(peer.own.get("isVisibleToUser"))
                    && (Boolean.TRUE.equals(peer.own.get("isClickable"))
                        || Boolean.TRUE.equals(peer.own.get("isEditable")))) {
                return "target_occluded";
            }
        }
        return null;
    }

    static Snapshot capture(JSONObject page, int targetWindowId, List<Window> windows) {
        if (page == null) {
            return null;
        }
        try {
            Map<String, Node> nodes = new LinkedHashMap<>();
            Node root = readNode(page, null, new int[0], nodes);
            return new Snapshot(root, nodes, AgentSessionSchemeResolver.signature(page),
                    targetWindowId, windows == null ? null : new ArrayList<>(windows));
        } catch (IllegalArgumentException invalid) {
            return null;
        }
    }

    static Verification verify(String observationId, Snapshot before, Snapshot fresh,
                               AgentSessionState.Action action) {
        Object rawNodeId = action == null ? null : action.arguments.get("nodeId");
        String nodeId = rawNodeId instanceof String ? (String) rawNodeId : null;
        if (action == null || !"click".equals(action.type)) {
            return new Verification("not_applicable", "action_requires_full_page", observationId,
                    nodeId, before, fresh, null);
        }
        if (before == null || fresh == null) {
            return rejected("context_unavailable", observationId, nodeId, before, fresh);
        }
        Node target = before.nodes.get(nodeId);
        Node current = target == null ? null : fresh.at(target.path);
        if (target == null || current == null) {
            return rejected("target_missing", observationId, nodeId, before, fresh);
        }
        if (!uniqueSource(before, target) || !uniqueSource(fresh, current)) {
            return rejected("ambiguous_source_identity", observationId, nodeId, before, fresh);
        }
        // Code security: preserve source identity and complete local semantics, including
        // position. A recycled/renamed/moved node must never be rebound by fuzzy selectors.
        if (!nativeNode(target) || !nativeNode(current) || !target.treeKey().equals(current.treeKey())) {
            return rejected("target_changed", observationId, nodeId, before, fresh);
        }
        if (!Boolean.TRUE.equals(current.own.get("isEnabled"))
                || !Boolean.TRUE.equals(current.own.get("isVisibleToUser"))
                || !Boolean.TRUE.equals(current.own.get("isClickable"))
                || !Boolean.FALSE.equals(current.own.get("isPassword"))
                || current.bounds == null || !current.bounds.nonEmpty()) {
            return rejected("target_not_actionable", observationId, nodeId, before, fresh);
        }
        boolean requiresFullPage = false;
        for (Node old = target, now = current; old != null; old = old.parent, now = now.parent) {
            if (now == null || !nativeNode(old) || !nativeNode(now) || !old.ownKey.equals(now.ownKey)) {
                return rejected("ancestor_changed", observationId, nodeId, before, fresh);
            }
            String type = old.own.getString("className");
            if (Boolean.TRUE.equals(old.own.get("isWebView"))
                    || Boolean.TRUE.equals(old.own.get("isScrollable"))
                    || type == null || type.contains("RecyclerView") || type.contains("ListView")
                    || type.contains("GridView") || type.contains("WebView")) {
                requiresFullPage = true;
            }
        }
        if (target.parent == null || !target.parent.treeKey().equals(current.parent.treeKey())) {
            return rejected("local_container_changed", observationId, nodeId, before, fresh);
        }
        if (requiresFullPage) {
            // Code security: structural ineligibility routes to the existing full-page
            // guard, never a native-click proof. Replaced/moved targets and ancestors
            // were rejected above; the state machine must also require identical pages.
            return new Verification("not_applicable", "unsupported_reusable_context",
                    observationId, nodeId, before, fresh, null);
        }
        String windowError = windowError(before, fresh, current);
        if (windowError != null) {
            return rejected(windowError, observationId, nodeId, before, fresh);
        }
        // Compare every overlapping non-ancestor node, including inactive/empty-looking
        // containers. This catches new same-window overlays; it does NOT prove that an
        // unchanged custom-drawn overlay is absent, which Accessibility cannot establish.
        if (!overlapKey(before, target).equals(overlapKey(fresh, current))) {
            return rejected("overlapping_context_changed", observationId, nodeId, before, fresh);
        }
        return new Verification("verified", "target_and_context_unchanged", observationId,
                nodeId, before, fresh, target.path.clone());
    }

    static boolean ownNodeMatches(Snapshot fresh, int[] path, JSONObject refreshedNode) {
        Node expected = fresh == null ? null : fresh.at(path);
        return expected != null && expected.ownKey.equals(key(ownFields(refreshedNode)));
    }

    /** Only rechecks window evidence; this must not be represented as a new tree capture. */
    static boolean windowsStillSafe(Snapshot fresh, int[] path, int targetWindowId,
                                    List<Window> currentWindows) {
        Node target = fresh == null ? null : fresh.at(path);
        if (target == null) {
            return false;
        }
        Snapshot windowRefresh = new Snapshot(fresh.root, fresh.nodes, fresh.signature,
                targetWindowId, currentWindows);
        return windowError(fresh, windowRefresh, target) == null;
    }

    private static String windowError(Snapshot before, Snapshot fresh, Node target) {
        if (before.windows == null || fresh.windows == null || before.windows.isEmpty()
                || before.targetWindowId < 0 || before.targetWindowId != fresh.targetWindowId
                || !windowKey(before.windows).equals(windowKey(fresh.windows))) {
            return "window_context_changed_or_unknown";
        }
        Window active = null;
        int applications = 0;
        for (Window window : fresh.windows) {
            if (window.bounds == null || !window.bounds.nonEmpty() || window.packageName == null) {
                return "window_context_changed_or_unknown";
            }
            if (window.type == 1) { // AccessibilityWindowInfo.TYPE_APPLICATION
                applications++;
                if (window.id == fresh.targetWindowId) {
                    active = window;
                }
            } else if (window.type != 3 || window.active || window.focused
                    || window.bounds.intersects(target.bounds)) { // non-overlapping system bars only
                return "additional_window_or_keyboard";
            }
        }
        if (applications != 1 || active == null || !active.active || !active.focused
                || !active.packageName.equals(target.own.getString("packageName"))
                || !active.bounds.contains(target.bounds)) {
            return "target_window_not_exclusive";
        }
        return null;
    }

    private static String windowKey(List<Window> windows) {
        List<String> values = new ArrayList<>();
        for (Window window : windows) {
            values.add(window.key());
        }
        Collections.sort(values);
        return values.toString();
    }

    private static String overlapKey(Snapshot page, Node target) {
        List<String> result = new ArrayList<>();
        for (Node node : page.nodes.values()) {
            if (node.bounds != null && node.bounds.intersects(target.bounds)
                    && !prefix(node.path, target.path) && !prefix(target.path, node.path)) {
                result.add(java.util.Arrays.toString(node.path) + node.ownKey);
            }
        }
        return result.toString();
    }

    private static boolean prefix(int[] prefix, int[] value) {
        if (prefix.length > value.length) {
            return false;
        }
        for (int index = 0; index < prefix.length; index++) {
            if (prefix[index] != value[index]) {
                return false;
            }
        }
        return true;
    }

    private static boolean nativeNode(Node node) {
        String id = node.own.getString("id");
        return "AccessibilityNodeTree".equals(node.own.getString("type"))
                && id != null && !id.isEmpty() && !"null".equals(id) && !"0".equals(id);
    }

    private static boolean uniqueSource(Snapshot snapshot, Node target) {
        String source = target.own.getString("id");
        if (source == null) {
            return false;
        }
        int count = 0;
        for (Node node : snapshot.nodes.values()) {
            if (source.equals(node.own.getString("id"))) {
                count++;
            }
        }
        return count == 1;
    }

    private static Node readNode(JSONObject raw, Node parent, int[] path, Map<String, Node> nodes) {
        if (nodes.size() >= MAX_NODES || path.length > MAX_DEPTH) {
            throw new IllegalArgumentException("Target context exceeds limits");
        }
        Node node = new Node(ownFields(raw), parent, path);
        nodes.put("node-" + (nodes.size() + 1), node);
        JSONArray children = raw.getJSONArray("children");
        if (children != null) {
            for (int index = 0; index < children.size(); index++) {
                int[] childPath = java.util.Arrays.copyOf(path, path.length + 1);
                childPath[path.length] = index;
                node.children.add(readNode(children.getJSONObject(index), node, childPath, nodes));
            }
        }
        return node;
    }

    private static JSONObject ownFields(JSONObject raw) {
        JSONObject result = new JSONObject();
        for (Map.Entry<String, Object> entry : raw.entrySet()) {
            if (!"children".equals(entry.getKey()) && !"nodeId".equals(entry.getKey())) {
                result.put(entry.getKey(), copy(entry.getValue()));
            }
        }
        return result;
    }

    private static Object copy(Object value) {
        if (value == null || value instanceof String || value instanceof Number || value instanceof Boolean) {
            return value;
        }
        if (value instanceof Rect) {
            Rect rect = (Rect) value;
            return new Box(rect.left, rect.top, rect.right, rect.bottom).json();
        }
        if (value instanceof Map) {
            JSONObject result = new JSONObject();
            for (Object rawEntry : ((Map<?, ?>) value).entrySet()) {
                Map.Entry<?, ?> entry = (Map.Entry<?, ?>) rawEntry;
                // Rect's serialized derived fields are not additional geometry.
                if (!"empty".equals(entry.getKey()) && !"stability".equals(entry.getKey())) {
                    result.put(String.valueOf(entry.getKey()), copy(entry.getValue()));
                }
            }
            return result;
        }
        throw new IllegalArgumentException("Unsupported target-context value");
    }

    private static String key(Object value) {
        return JSON.toJSONString(value, SerializerFeature.MapSortField);
    }

    private static Verification rejected(String reason, String observationId, String nodeId,
                                         Snapshot before, Snapshot fresh) {
        return new Verification("rejected", reason, observationId, nodeId, before, fresh, null);
    }

    static final class Verification {
        final String result;
        final String reason;
        final String observationId;
        final String nodeId;
        final String beforeSignature;
        final String freshSignature;
        final int[] path;

        private Verification(String result, String reason, String observationId, String nodeId,
                             Snapshot before, Snapshot fresh, int[] path) {
            this.result = result;
            this.reason = reason;
            this.observationId = observationId;
            this.nodeId = nodeId;
            this.beforeSignature = before == null ? null : before.signature;
            this.freshSignature = fresh == null ? null : fresh.signature;
            this.path = path;
        }

        boolean verifies(String expectedObservationId, String expectedSignature, String currentSignature,
                         AgentSessionState.Action action) {
            return "verified".equals(result) && binds(expectedObservationId, expectedSignature,
                    currentSignature, action);
        }

        boolean requiresUnchangedFullPage(String expectedObservationId, String expectedSignature,
                                          String currentSignature, AgentSessionState.Action action) {
            return "not_applicable".equals(result) && "unsupported_reusable_context".equals(reason)
                    && binds(expectedObservationId, expectedSignature, currentSignature, action)
                    && expectedSignature.equals(currentSignature);
        }

        private boolean binds(String expectedObservationId, String expectedSignature, String currentSignature,
                              AgentSessionState.Action action) {
            return expectedObservationId != null
                    && expectedSignature != null && currentSignature != null && action != null
                    && expectedObservationId.equals(observationId)
                    && expectedSignature.equals(beforeSignature) && currentSignature.equals(freshSignature)
                    && "click".equals(action.type) && nodeId != null
                    && nodeId.equals(action.arguments.get("nodeId"));
        }

        Map<String, Object> metadata() {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("strategy", TARGET_CONTEXT_V1);
            result.put("result", this.result);
            result.put("reason", reason);
            result.put("fullPageChanged", beforeSignature == null || freshSignature == null
                    ? null : !beforeSignature.equals(freshSignature));
            result.put("effectiveStrategy", "verified".equals(this.result) ? TARGET_CONTEXT_V1
                    : "not_applicable".equals(this.result) ? FULL_PAGE : "none");
            return result;
        }
    }

    static final class Snapshot {
        final Node root;
        final Map<String, Node> nodes;
        final String signature;
        final int targetWindowId;
        final List<Window> windows;

        Snapshot(Node root, Map<String, Node> nodes, String signature, int targetWindowId, List<Window> windows) {
            this.root = root;
            this.nodes = nodes;
            this.signature = signature;
            this.targetWindowId = targetWindowId;
            this.windows = windows;
        }

        Node at(int[] path) {
            Node node = root;
            for (int index : path) {
                if (index < 0 || index >= node.children.size()) {
                    return null;
                }
                node = node.children.get(index);
            }
            return node;
        }
    }

    static final class Node {
        final JSONObject own;
        final String ownKey;
        final Node parent;
        final int[] path;
        final Box bounds;
        final List<Node> children = new ArrayList<>();

        Node(JSONObject own, Node parent, int[] path) {
            this.own = own;
            this.ownKey = key(own);
            this.parent = parent;
            this.path = path;
            JSONObject bounds = own.getJSONObject("nodeBound");
            this.bounds = bounds == null ? null : new Box(bounds.getIntValue("left"),
                    bounds.getIntValue("top"), bounds.getIntValue("right"), bounds.getIntValue("bottom"));
        }

        String treeKey() {
            StringBuilder result = new StringBuilder(ownKey).append('[');
            for (Node child : children) {
                result.append(child.treeKey()).append(',');
            }
            return result.append(']').toString();
        }
    }

    static final class Window {
        final int id;
        final int type;
        final int layer;
        final boolean active;
        final boolean focused;
        final Box bounds;
        final String packageName;

        Window(int id, int type, int layer, boolean active, boolean focused, Box bounds, String packageName) {
            this.id = id;
            this.type = type;
            this.layer = layer;
            this.active = active;
            this.focused = focused;
            this.bounds = bounds;
            this.packageName = packageName;
        }

        String key() {
            return id + ":" + type + ":" + layer + ":" + active + ":" + focused + ":"
                    + (bounds == null ? "null" : AgentTargetContextGuard.key(bounds.json())) + ":" + packageName;
        }
    }

    static final class Box {
        final int left, top, right, bottom;
        Box(int left, int top, int right, int bottom) {
            this.left = left;
            this.top = top;
            this.right = right;
            this.bottom = bottom;
        }
        boolean nonEmpty() { return left < right && top < bottom; }
        boolean intersects(Box other) {
            return nonEmpty() && other.nonEmpty() && left < other.right && other.left < right
                    && top < other.bottom && other.top < bottom;
        }
        boolean contains(Box other) {
            return left <= other.left && top <= other.top && right >= other.right && bottom >= other.bottom;
        }
        JSONObject json() {
            JSONObject value = new JSONObject();
            value.put("left", left); value.put("top", top);
            value.put("right", right); value.put("bottom", bottom);
            return value;
        }
    }
}
