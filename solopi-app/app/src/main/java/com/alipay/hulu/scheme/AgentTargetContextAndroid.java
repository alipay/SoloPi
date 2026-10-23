package com.alipay.hulu.scheme;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Rect;
import android.os.Build;
import android.util.DisplayMetrics;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.accessibility.tree.AccessibilityNodeTree;

import java.util.ArrayList;
import java.util.List;

/** Android evidence adapter. Unknown windows never count as verified target context. */
final class AgentTargetContextAndroid {
    interface NativeClick {
        boolean refreshTarget();
        boolean verifyWindows();
        boolean perform();
    }

    static boolean dispatch(NativeClick click, AgentUiWaiter.Guard guard) throws InterruptedException {
        guard.check();
        if (!click.refreshTarget() || !click.verifyWindows()) {
            return false;
        }
        guard.check();
        // Exactly one native dispatch. A false native return never retries or taps coordinates.
        return click.perform();
    }
    static AgentTargetContextGuard.Snapshot capture(AbstractNodeTree root, JSONObject page) {
        int windowId = -1;
        if (root instanceof AccessibilityNodeTree) {
            AccessibilityNodeInfo info = ((AccessibilityNodeTree) root).getCurrentNode();
            if (info != null) {
                windowId = info.getWindowId();
            }
        }
        return AgentTargetContextGuard.capture(page, windowId, windows());
    }

    static AbstractNodeTree at(AbstractNodeTree root, int[] path) {
        AbstractNodeTree node = root;
        for (int index : path) {
            List<AbstractNodeTree> children = node == null ? null : node.getChildrenNodes();
            if (children == null || index < 0 || index >= children.size()) {
                return null;
            }
            node = children.get(index);
        }
        return node;
    }

    static boolean isActiveApplicationRoot(AbstractNodeTree root, JSONObject page,
                                            DisplayMetrics metrics, String controlPackage) {
        if (!(root instanceof AccessibilityNodeTree)) return false;
        AccessibilityNodeInfo info = ((AccessibilityNodeTree) root).getCurrentNode();
        return info != null && activeApplicationWindow(page, metrics, info.getWindowId(),
                windows(), controlPackage);
    }

    static boolean activeApplicationWindow(JSONObject page, DisplayMetrics metrics, int windowId,
                                             List<AgentTargetContextGuard.Window> windows,
                                             String controlPackage) {
        if (page == null || metrics == null || windows == null || windowId < 0) return false;
        String pkg = page.getString("packageName");
        JSONObject b = page.getJSONObject("nodeBound");
        if (pkg == null || pkg.length() == 0 || pkg.equals(controlPackage) || b == null) return false;
        int left = b.getIntValue("left"), top = b.getIntValue("top");
        int right = b.getIntValue("right"), bottom = b.getIntValue("bottom");
        if (left < 0 || top < 0 || right > metrics.widthPixels || bottom > metrics.heightPixels
                || left >= right || top >= bottom) return false;
        int matches = 0;
        for (AgentTargetContextGuard.Window w : windows) {
            if (w.id != windowId) continue;
            // Code security: small roots need native active application-window proof.
            // A narrow system/IME/control window or an unknown source is not a page.
            if (w.type != AccessibilityWindowInfo.TYPE_APPLICATION || !w.active || !w.focused
                    || !pkg.equals(w.packageName) || w.bounds == null
                    || w.bounds.left > left || w.bounds.top > top
                    || w.bounds.right < right || w.bounds.bottom < bottom) return false;
            matches++;
        }
        return matches == 1;
    }

    static boolean click(AbstractNodeTree root,
                         final AgentTargetContextGuard.Snapshot fresh,
                         final AgentTargetContextGuard.Verification proof,
                         AgentUiWaiter.Guard guard)
            throws InterruptedException {
        guard.check();
        AbstractNodeTree node = proof.path == null ? null : at(root, proof.path);
        if (!(node instanceof AccessibilityNodeTree)) {
            return false;
        }
        final AccessibilityNodeTree target = (AccessibilityNodeTree) node;
        final AccessibilityNodeInfo info = target.getCurrentNode();
        // Code security: no coordinate fallback. Refresh the exact live source, verify
        // its current geometry/actionability and windows again immediately before dispatch.
        return dispatch(new NativeClick() {
            @Override public boolean refreshTarget() {
                if (info == null || !info.refresh() || info.getWindowId() != fresh.targetWindowId
                        || (info.getActions() & AccessibilityNodeInfo.ACTION_CLICK) == 0
                        || info.getChildCount() != (target.getChildrenNodes() == null
                        ? 0 : target.getChildrenNodes().size())) {
                    return false;
                }
                AccessibilityNodeTree refreshed = new AccessibilityNodeTree(info, null, target.getId());
                refreshed.setDepth(target.getDepth());
                return AgentTargetContextGuard.ownNodeMatches(fresh, proof.path, refreshed.exportToJsonObject());
            }

            @Override public boolean verifyWindows() {
                // Only windows and the live target are refreshed here, not a new page tree.
                // The verified path survives unrelated earlier branches shifting DFS IDs.
                return AgentTargetContextGuard.windowsStillSafe(fresh, proof.path, info.getWindowId(), windows());
            }

            @Override public boolean perform() {
                return info.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            }
        }, guard);
    }

    private static List<AgentTargetContextGuard.Window> windows() {
        if (Build.VERSION.SDK_INT < 21) {
            return null;
        }
        List<AccessibilityWindowInfo> windows = null;
        try {
            AccessibilityService service = InjectorService.g().getMessage(
                    SubscribeParamEnum.ACCESSIBILITY_SERVICE, AccessibilityService.class);
            if (service == null) {
                return null;
            }
            windows = service.getWindows();
            if (windows == null || windows.isEmpty()) {
                return null;
            }
            List<AgentTargetContextGuard.Window> result = new ArrayList<>();
            for (AccessibilityWindowInfo window : windows) {
                Rect bounds = new Rect();
                window.getBoundsInScreen(bounds);
                AccessibilityNodeInfo root = window.getRoot();
                String packageName = null;
                if (root != null) {
                    try {
                        CharSequence rawPackage = root.getPackageName();
                        packageName = rawPackage == null ? null : rawPackage.toString();
                    } finally {
                        root.recycle();
                    }
                }
                result.add(new AgentTargetContextGuard.Window(window.getId(), window.getType(),
                        window.getLayer(), window.isActive(), window.isFocused(),
                        new AgentTargetContextGuard.Box(bounds.left, bounds.top, bounds.right, bounds.bottom),
                        packageName));
            }
            return result;
        } catch (RuntimeException unavailable) {
            // Do not log raw window/node data. Unsupported acquisition fails closed.
            return null;
        } finally {
            if (windows != null) {
                for (AccessibilityWindowInfo window : windows) {
                    window.recycle();
                }
            }
        }
    }
}
