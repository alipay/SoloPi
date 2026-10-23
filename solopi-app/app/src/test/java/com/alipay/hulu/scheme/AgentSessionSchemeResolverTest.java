package com.alipay.hulu.scheme;

import android.graphics.Rect;
import android.util.DisplayMetrics;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.FakeNodeTree;

import org.junit.Test;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

public class AgentSessionSchemeResolverTest {
    @Test
    public void frameTargetBindsExactPathEvenWhenSiblingsHaveSameLabelsAndIds() {
        FakeNodeTree root = window("com.example.orders", 0, 0, 1080, 2400);
        FakeNodeTree first = window("com.example.orders", 0, 0, 1080, 300);
        FakeNodeTree second = window("com.example.orders", 0, 300, 1080, 600);
        first.setText("打开"); second.setText("打开");
        root.addChildNode(first); root.addChildNode(second);
        Map<String, int[]> paths = new LinkedHashMap<>();
        paths.put("node-2", new int[]{0}); paths.put("node-3", new int[]{1});
        assertSame(second, AgentSessionSchemeResolver.locateFrameTarget(root, paths, "node-3"));
        assertSame(first, AgentSessionSchemeResolver.locateFrameTarget(root, paths, "node-2"));
        assertNull(AgentSessionSchemeResolver.locateFrameTarget(root, paths, "node-99"));
        paths.put("node-4", new int[]{1, 0});
        assertNull(AgentSessionSchemeResolver.locateFrameTarget(root, paths, "node-4"));
    }

    @Test
    public void settleStrategyDefaultsToLegacyAndRejectsUnknownValues() throws Exception {
        assertEquals("legacy", AgentSessionSchemeResolver.parseSettleStrategy(null));
        assertEquals("legacy", AgentSessionSchemeResolver.parseSettleStrategy("legacy"));
        assertEquals("event-stable-v1", AgentSessionSchemeResolver.parseSettleStrategy("event-stable-v1"));
        for (String invalid : new String[] {"", "fast", "EVENT-STABLE-V1", "legacy\n"}) {
            try {
                AgentSessionSchemeResolver.parseSettleStrategy(invalid);
                org.junit.Assert.fail("Unknown strategy must fail closed");
            } catch (Exception expected) {
                assertEquals("Unsupported UI settle strategy", expected.getMessage());
            }
        }
    }

    @Test
    public void controllablePageRejectsControlAppAndNarrowSystemWindows() {
        DisplayMetrics metrics = metrics(1080, 2400);

        assertFalse(AgentSessionSchemeResolver.isControllablePage(
                page("com.alipay.hulu", 0, 0, 1080, 2400), metrics, "com.alipay.hulu"));
        assertFalse(AgentSessionSchemeResolver.isControllablePage(
                page("com.android.systemui", 0, 0, 1080, 132), metrics, "com.alipay.hulu"));
        assertTrue(AgentSessionSchemeResolver.isControllablePage(
                page("com.example.counter", 0, 0, 1080, 2400), metrics, "com.alipay.hulu"));
    }

    @Test
    public void multiWindowRootPreservesPageIdentityWithoutBecomingActionable() {
        FakeNodeTree root = window("com.example.orders", 0, 0, 1080, 2400);
        FakeNodeTree main = window("com.example.orders", 0, 0, 1080, 2400);
        FakeNodeTree overlay = window("com.example.orders", 60, 400, 900, 800);
        root.addChildNode(main);
        root.addChildNode(overlay);

        JSONObject exported = root.exportToJsonObject();

        assertEquals("FakeNodeTree", exported.getString("type"));
        assertEquals("com.example.orders", exported.getString("packageName"));
        assertSame(root.getNodeBound(), exported.get("nodeBound"));
        assertEquals(2, exported.getJSONArray("children").size());
        assertSame(main.getNodeBound(), exported.getJSONArray("children").getJSONObject(0).get("nodeBound"));
        assertSame(overlay.getNodeBound(), exported.getJSONArray("children").getJSONObject(1).get("nodeBound"));
        assertTrue(AgentSessionSchemeResolver.isControllablePage(
                pageForGate(exported), metrics(1080, 2400), "com.alipay.hulu"));
        assertFalse(root.canDoAction(PerformActionEnum.CLICK));
        assertFalse(root.isSelfUsableForLocating());
    }

    @Test
    public void multiWindowRootDoesNotBorrowMissingIdentityFromChildren() {
        FakeNodeTree root = new FakeNodeTree();
        root.addChildNode(window("com.example.orders", 0, 0, 1080, 2400));

        JSONObject exported = root.exportToJsonObject();
        assertEquals("", exported.getString("packageName"));
        assertNull(exported.get("nodeBound"));
        assertFalse(AgentSessionSchemeResolver.isControllablePage(
                exported, metrics(1080, 2400), "com.alipay.hulu"));

        root.setPackageName("com.example.orders");
        assertFalse(AgentSessionSchemeResolver.isControllablePage(
                root.exportToJsonObject(), metrics(1080, 2400), "com.alipay.hulu"));
    }

    @Test
    public void multiWindowRootStillRejectsControlAppAndNarrowWindows() {
        assertFalse(AgentSessionSchemeResolver.isControllablePage(
                pageForGate(window("com.alipay.hulu", 0, 0, 1080, 2400).exportToJsonObject()),
                metrics(1080, 2400), "com.alipay.hulu"));
        assertFalse(AgentSessionSchemeResolver.isControllablePage(
                pageForGate(window("com.android.systemui", 0, 0, 1080, 132).exportToJsonObject()),
                metrics(1080, 2400), "com.alipay.hulu"));
    }

    @Test
    public void pageSignatureIgnoresObjectInsertionOrder() {
        JSONObject firstBounds = new JSONObject();
        firstBounds.put("left", 0);
        firstBounds.put("right", 1080);
        JSONObject first = new JSONObject();
        first.put("packageName", "com.example.counter");
        first.put("nodeBound", firstBounds);

        JSONObject secondBounds = new JSONObject();
        secondBounds.put("right", 1080);
        secondBounds.put("left", 0);
        JSONObject second = new JSONObject();
        second.put("nodeBound", secondBounds);
        second.put("packageName", "com.example.counter");

        assertTrue(AgentSessionSchemeResolver.signature(first)
                .equals(AgentSessionSchemeResolver.signature(second)));
    }

    @Test
    public void pageSignatureIgnoresNestedAccessibilitySourceIdWithoutChangingEvidence() {
        JSONObject before = accessibilityPage("-4294966405");
        JSONObject after = accessibilityPage("-4294966390");
        JSONObject firstRoot = page("com.example.orders", 0, 0, 1080, 2400);
        JSONObject secondRoot = page("com.example.orders", 0, 0, 1080, 2400);
        firstRoot.put("type", "FakeNodeTree");
        secondRoot.put("type", "FakeNodeTree");
        JSONArray firstChildren = new JSONArray();
        JSONArray secondChildren = new JSONArray();
        firstChildren.add(before);
        secondChildren.add(after);
        firstRoot.put("children", firstChildren);
        secondRoot.put("children", secondChildren);

        assertEquals(AgentSessionSchemeResolver.signature(firstRoot),
                AgentSessionSchemeResolver.signature(secondRoot));
        assertEquals("-4294966405", before.getString("id"));
        assertEquals("-4294966390", after.getString("id"));
        assertSame(before, firstRoot.getJSONArray("children").getJSONObject(0));
    }

    @Test
    public void pageSignatureStillIncludesSemanticFieldsAndChildOrder() {
        JSONObject baseline = accessibilityPage("source-a");
        String signature = AgentSessionSchemeResolver.signature(baseline);
        String[] fields = {"text", "description", "resourceId", "packageName", "className",
                "isClickable", "isEnabled", "isEditable", "isFocusable", "isScrollable", "visible",
                "isPassword", "isSelected", "isChecked", "isVisibleToUser"};
        for (String field : fields) {
            JSONObject changed = accessibilityPage("source-b");
            Object original = changed.get(field);
            changed.put(field, original instanceof Boolean ? !((Boolean) original) : "changed");
            assertNotEquals(field, signature, AgentSessionSchemeResolver.signature(changed));
        }
        JSONObject moved = accessibilityPage("source-b");
        moved.getJSONObject("nodeBound").put("left", 1);
        assertNotEquals(signature, AgentSessionSchemeResolver.signature(moved));

        JSONObject first = accessibilityPage("one");
        JSONObject second = accessibilityPage("two");
        second.put("text", "Second action");
        JSONArray forward = new JSONArray();
        forward.add(first);
        forward.add(second);
        JSONArray reverse = new JSONArray();
        reverse.add(second);
        reverse.add(first);
        JSONObject root = accessibilityPage("root");
        root.put("children", forward);
        String forwardSignature = AgentSessionSchemeResolver.signature(root);
        root.put("children", reverse);
        assertNotEquals(forwardSignature, AgentSessionSchemeResolver.signature(root));
        root.remove("children");
        assertNotEquals(forwardSignature, AgentSessionSchemeResolver.signature(root));
    }

    @Test
    public void pageSignatureDoesNotIgnoreOtherNodeIdsOrFrameNodeIds() {
        JSONObject before = accessibilityPage("source-a");
        JSONObject after = accessibilityPage("source-b");
        before.put("type", "OtherNodeTree");
        after.put("type", "OtherNodeTree");
        assertNotEquals(AgentSessionSchemeResolver.signature(before),
                AgentSessionSchemeResolver.signature(after));
        before.put("type", "AccessibilityNodeTree");
        after.put("type", "AccessibilityNodeTree");
        before.put("nodeId", "node-1");
        after.put("nodeId", "node-2");
        assertNotEquals(AgentSessionSchemeResolver.signature(before),
                AgentSessionSchemeResolver.signature(after));
        before.remove("nodeId");
        after.remove("nodeId");
        JSONObject firstMetadata = new JSONObject();
        JSONObject secondMetadata = new JSONObject();
        firstMetadata.put("id", "business-a");
        secondMetadata.put("id", "business-b");
        before.put("metadata", firstMetadata);
        after.put("metadata", secondMetadata);
        assertNotEquals(AgentSessionSchemeResolver.signature(before),
                AgentSessionSchemeResolver.signature(after));
    }

    @Test
    public void settleRequiresAChangedSignatureToBecomeStable() {
        assertFalse(AgentSessionSchemeResolver.hasSettled("before", "before", "before"));
        assertFalse(AgentSessionSchemeResolver.hasSettled("before", "before", "after"));
        assertTrue(AgentSessionSchemeResolver.hasSettled("before", "after", "after"));
    }

    private static DisplayMetrics metrics(int width, int height) {
        DisplayMetrics metrics = new DisplayMetrics();
        metrics.widthPixels = width;
        metrics.heightPixels = height;
        return metrics;
    }

    static JSONObject accessibilityPage(String sourceId) {
        JSONObject page = page("com.example.orders", 0, 0, 1080, 2400);
        page.put("type", "AccessibilityNodeTree");
        page.put("id", sourceId);
        page.put("text", "Search");
        page.put("description", "Search orders");
        page.put("resourceId", "com.example.orders:id/search");
        page.put("className", "android.widget.TextView");
        page.put("isClickable", true);
        page.put("isEnabled", true);
        page.put("isEditable", false);
        page.put("isFocusable", false);
        page.put("isScrollable", false);
        page.put("visible", true);
        page.put("isPassword", false);
        page.put("isSelected", false);
        page.put("isChecked", false);
        page.put("isVisibleToUser", true);
        return page;
    }

    private static FakeNodeTree window(String packageName, int left, int top, int right, int bottom) {
        Rect bounds = new Rect();
        bounds.left = left;
        bounds.top = top;
        bounds.right = right;
        bounds.bottom = bottom;
        FakeNodeTree window = new FakeNodeTree();
        window.setPackageName(packageName);
        window.setNodeBound(bounds);
        return window;
    }

    private static JSONObject pageForGate(JSONObject exported) {
        JSONObject page = new JSONObject(exported);
        Rect bounds = (Rect) exported.get("nodeBound");
        if (bounds != null) {
            // JVM Android stubs cannot run Rect's bean getters. Convert only the exported
            // public fields to the existing wire shape; never recover missing root metadata.
            page.put("nodeBound", page("", bounds.left, bounds.top, bounds.right, bounds.bottom)
                    .getJSONObject("nodeBound"));
        }
        return page;
    }

    private static JSONObject page(String packageName, int left, int top, int right, int bottom) {
        JSONObject bounds = new JSONObject();
        bounds.put("left", left);
        bounds.put("top", top);
        bounds.put("right", right);
        bounds.put("bottom", bottom);
        JSONObject page = new JSONObject();
        page.put("packageName", packageName);
        page.put("nodeBound", bounds);
        return page;
    }
}
