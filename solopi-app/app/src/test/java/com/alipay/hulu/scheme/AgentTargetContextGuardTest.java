package com.alipay.hulu.scheme;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.Assert.*;

public class AgentTargetContextGuardTest {
    @Test
    public void unrelatedBottomIconMovementDoesNotInvalidateTarget() {
        JSONObject before = page();
        JSONObject after = page();
        footer(after).getJSONObject("nodeBound").put("top", 2210);
        AgentTargetContextGuard.Verification proof = verify(before, after);
        assertEquals("verified", proof.result);
        assertNotEquals(proof.beforeSignature, proof.freshSignature);
        assertEquals(Boolean.TRUE, proof.metadata().get("fullPageChanged"));
        assertTrue(proof.verifies("observation", proof.beforeSignature, proof.freshSignature, click()));
    }

    @Test
    public void earlierUnrelatedBranchCanShiftIdsWithoutRebindingSelectedTarget() {
        JSONObject before = page();
        JSONArray oldChildren = before.getJSONArray("children");
        Object first = oldChildren.remove(0);
        oldChildren.add(first); // footer, then target container: selected target is now node-4
        AgentTargetContextGuard.Snapshot old = snapshot(before);
        JSONObject after = page();
        JSONArray newChildren = after.getJSONArray("children");
        Object afterFirst = newChildren.remove(0);
        newChildren.add(afterFirst);
        JSONArray addedChildren = new JSONArray();
        addedChildren.add(node("footer-child", 50, 2210, 100, 2220));
        newChildren.getJSONObject(0).put("children", addedChildren);
        AgentTargetContextGuard.Snapshot fresh = snapshot(after);
        AgentSessionState.Action selected = AgentSessionState.Action.of("click",
                Collections.<String, Object>singletonMap("nodeId", "node-4"));
        AgentTargetContextGuard.Verification proof = AgentTargetContextGuard.verify("observation", old, fresh, selected);
        assertEquals("verified", proof.result);
        assertArrayEquals(new int[] {1, 0}, proof.path);
        assertEquals("container", fresh.nodes.get("node-4").own.getString("id"));
        assertEquals("target", fresh.at(proof.path).own.getString("id"));
        assertTrue(AgentTargetContextGuard.windowsStillSafe(fresh, proof.path, 1, windows()));
        assertFalse(AgentTargetContextGuard.windowsStillSafe(fresh, proof.path, 2, windows()));
    }

    @Test
    public void unrelatedNonOverlappingTextChangeIsAllowedButLocalSiblingChangeIsRejected() {
        JSONObject after = page();
        footer(after).put("text", "updated public label");
        assertEquals("verified", verify(page(), after).result);
        JSONArray children = container(after).getJSONArray("children");
        children.add(node("local", 800, 100, 900, 160));
        assertEquals("local_container_changed", verify(page(), after).reason);
    }

    @Test
    public void replacedSourceWithIdenticalLabelGeometryAndResourceIsRejected() {
        JSONObject after = page();
        target(after).put("id", "replaced-source");
        assertEquals(AgentSessionSchemeResolver.signature(page()), AgentSessionSchemeResolver.signature(after));
        assertEquals("target_changed", verify(page(), after).reason);
    }

    @Test
    public void duplicatedSourceIdentityIsNotAnUnambiguousTarget() {
        JSONObject after = page();
        footer(after).put("id", target(after).get("id"));
        assertEquals("ambiguous_source_identity", verify(page(), after).reason);
    }

    @Test
    public void replacedAncestorAndChangedTargetDescendantAreRejected() {
        JSONObject after = page();
        container(after).put("id", "replaced-container");
        assertEquals("ancestor_changed", verify(page(), after).reason);
        after = page();
        JSONArray children = new JSONArray();
        children.add(node("new-child", 100, 100, 120, 120));
        target(after).put("children", children);
        assertEquals("target_changed", verify(page(), after).reason);
    }

    @Test
    public void targetMovementIncludingMovementIntoOverlayIsNeverAllowed() {
        JSONObject after = page();
        target(after).getJSONObject("nodeBound").put("top", 120);
        assertEquals("target_changed", verify(page(), after).reason);
    }

    @Test
    public void disabledHiddenPasswordAndUnknownMetadataAreRejectedEvenIfUnchanged() {
        for (String field : Arrays.asList("isEnabled", "isVisibleToUser", "isClickable")) {
            JSONObject unsafe = page();
            target(unsafe).put(field, false);
            assertEquals(field, "target_not_actionable", verify(unsafe, unsafe).reason);
        }
        JSONObject password = page();
        target(password).put("isPassword", true);
        assertEquals("target_not_actionable", verify(password, password).reason);
        target(password).remove("isPassword");
        assertEquals("target_not_actionable", verify(password, password).reason);
    }

    @Test
    public void unknownSourceIdentityAndNonAccessibilityRootCannotUseLocalValidation() {
        JSONObject unknown = page();
        target(unknown).put("id", "0");
        assertEquals("target_changed", verify(unknown, unknown).reason);
        unknown = page();
        unknown.put("type", "FakeNodeTree");
        assertEquals("ancestor_changed", verify(unknown, unknown).reason);
    }

    @Test
    public void scrollingListGridAndWebContextsRequireFullPageInsteadOfNativeClick() {
        for (String className : Arrays.asList("androidx.recyclerview.widget.RecyclerView",
                "android.widget.ListView", "android.widget.GridView", "android.webkit.WebView")) {
            JSONObject unsafe = page();
            container(unsafe).put("className", className);
            assertEquals(className, "unsupported_reusable_context", verify(unsafe, unsafe).reason);
            assertEquals("not_applicable", verify(unsafe, unsafe).result);
            assertEquals("full-page", verify(unsafe, unsafe).metadata().get("effectiveStrategy"));
        }
        JSONObject unsafe = page();
        container(unsafe).put("isScrollable", true);
        assertEquals("unsupported_reusable_context", verify(unsafe, unsafe).reason);
    }

    @Test
    public void fullPageRoutingCannotHideReplacedAncestorsOrTargetsInReusableContext() {
        JSONObject before = page();
        container(before).put("className", "android.widget.ListView");
        JSONObject after = JSONObject.parseObject(before.toJSONString());
        after.put("id", "replacement-root");
        assertEquals("ancestor_changed", verify(before, after).reason);
        after = JSONObject.parseObject(before.toJSONString());
        target(after).put("id", "recycled-target");
        assertEquals("target_changed", verify(before, after).reason);
    }

    @Test
    public void addedSameWindowOverlayAndChangedExistingOverlappingSiblingAreRejected() {
        JSONObject after = page();
        after.getJSONArray("children").add(node("overlay", 0, 0, 1080, 600));
        assertEquals("overlapping_context_changed", verify(page(), after).reason);
        JSONObject before = page();
        before.getJSONArray("children").add(node("background", 0, 0, 1080, 600));
        after = page();
        after.getJSONArray("children").add(node("background", 0, 0, 1080, 610));
        assertEquals("overlapping_context_changed", verify(before, after).reason);
    }

    @Test
    public void popupKeyboardOverlayAndUnknownWindowInformationFailClosed() {
        AgentTargetContextGuard.Snapshot baseline = snapshot(page());
        for (int type : new int[] {1, 2, 4, 5}) {
            List<AgentTargetContextGuard.Window> windows = new ArrayList<>(windows());
            windows.add(new AgentTargetContextGuard.Window(2, type, 2, false, false,
                    new AgentTargetContextGuard.Box(0, 800, 1080, 2400), "test.overlay"));
            assertEquals("rejected", AgentTargetContextGuard.verify("observation", baseline,
                    AgentTargetContextGuard.capture(page(), 1, windows), click()).result);
            // A pre-existing additional window is also ineligible, even if unchanged.
            AgentTargetContextGuard.Snapshot obstructed = AgentTargetContextGuard.capture(page(), 1, windows);
            assertEquals("rejected", AgentTargetContextGuard.verify("observation", obstructed,
                    obstructed, click()).result);
        }
        assertEquals("rejected", AgentTargetContextGuard.verify("observation", baseline,
                AgentTargetContextGuard.capture(page(), 1, null), click()).result);
    }

    @Test
    public void activeWindowChangeAndSystemWindowOverlapAreRejected() {
        List<AgentTargetContextGuard.Window> windows = windows();
        windows.set(0, new AgentTargetContextGuard.Window(1, 1, 0, false, false,
                new AgentTargetContextGuard.Box(0, 0, 1080, 2400), "test.app"));
        AgentTargetContextGuard.Snapshot changed = AgentTargetContextGuard.capture(page(), 1, windows);
        assertEquals("rejected", AgentTargetContextGuard.verify("observation", snapshot(page()), changed, click()).result);
        windows = windows();
        windows.add(new AgentTargetContextGuard.Window(2, 3, 2, false, false,
                new AgentTargetContextGuard.Box(0, 0, 1080, 150), "test.system"));
        changed = AgentTargetContextGuard.capture(page(), 1, windows);
        assertEquals("additional_window_or_keyboard", AgentTargetContextGuard.verify(
                "observation", changed, changed, click()).reason);
    }

    @Test
    public void nonOverlappingSystemBarIsPermittedWhenWindowSetIsStable() {
        List<AgentTargetContextGuard.Window> windows = windows();
        windows.add(new AgentTargetContextGuard.Window(2, 3, 2, false, false,
                new AgentTargetContextGuard.Box(0, 0, 1080, 60), "test.system"));
        AgentTargetContextGuard.Snapshot unchanged = AgentTargetContextGuard.capture(page(), 1, windows);
        assertEquals("verified", AgentTargetContextGuard.verify("observation", unchanged, unchanged, click()).result);
    }

    @Test
    public void proofCannotBeReusedForAnotherObservationTargetOrFreshPage() {
        AgentTargetContextGuard.Verification proof = verify(page(), page());
        assertFalse(proof.verifies("different", proof.beforeSignature, proof.freshSignature, click()));
        assertFalse(proof.verifies("observation", "different", proof.freshSignature, click()));
        assertFalse(proof.verifies("observation", proof.beforeSignature, "different", click()));
        assertFalse(proof.verifies(null, proof.beforeSignature, proof.freshSignature, click()));
        assertFalse(proof.verifies("observation", proof.beforeSignature, proof.freshSignature,
                AgentSessionState.Action.of("click", Collections.<String, Object>singletonMap("nodeId", "node-4"))));
    }

    @Test
    public void snapshotIsIndependentOfLaterJsonMutationAndInjectedNodeIds() {
        JSONObject before = page();
        AgentTargetContextGuard.Snapshot snapshot = snapshot(before);
        target(before).put("nodeId", "node-999");
        assertEquals("verified", AgentTargetContextGuard.verify("observation", snapshot,
                snapshot(page()), click()).result);
        target(before).put("text", "changed");
        assertEquals("rejected", AgentTargetContextGuard.verify("observation", snapshot,
                snapshot(before), click()).result);
    }

    @Test
    public void nonClickActionsAreExplicitlyNotApplicableAndMetadataIsPayloadFree() {
        AgentTargetContextGuard.Verification proof = AgentTargetContextGuard.verify("observation",
                snapshot(page()), snapshot(page()), AgentSessionState.Action.of("back", Collections.<String, Object>emptyMap()));
        assertEquals("not_applicable", proof.result);
        assertEquals("full-page", proof.metadata().get("effectiveStrategy"));
        assertFalse(proof.metadata().containsKey("nodeId"));
        assertFalse(proof.metadata().containsKey("observationId"));
    }

    static AgentTargetContextGuard.Verification verify(JSONObject before, JSONObject after) {
        return AgentTargetContextGuard.verify("observation", snapshot(before), snapshot(after), click());
    }

    static AgentSessionState.Action click() {
        return AgentSessionState.Action.of("click", Collections.<String, Object>singletonMap("nodeId", "node-3"));
    }

    static AgentTargetContextGuard.Snapshot snapshot(JSONObject page) {
        return AgentTargetContextGuard.capture(page, 1, windows());
    }

    static List<AgentTargetContextGuard.Window> windows() {
        return new ArrayList<>(Collections.singletonList(new AgentTargetContextGuard.Window(1, 1,
                0, true, true, new AgentTargetContextGuard.Box(0, 0, 1080, 2400), "test.app")));
    }

    static JSONObject page() {
        JSONObject root = node("root", 0, 0, 1080, 2400);
        JSONObject container = node("container", 0, 80, 1080, 240);
        JSONObject target = node("target", 100, 100, 700, 200);
        target.put("description", "Search");
        target.put("isClickable", true);
        JSONArray local = new JSONArray();
        local.add(target);
        container.put("children", local);
        JSONArray children = new JSONArray();
        children.add(container);
        children.add(node("footer", 50, 2200, 150, 2300));
        root.put("children", children);
        return root;
    }

    static JSONObject container(JSONObject page) { return page.getJSONArray("children").getJSONObject(0); }
    static JSONObject target(JSONObject page) { return container(page).getJSONArray("children").getJSONObject(0); }
    static JSONObject footer(JSONObject page) { return page.getJSONArray("children").getJSONObject(1); }

    static JSONObject node(String id, int left, int top, int right, int bottom) {
        JSONObject node = new JSONObject();
        node.put("id", id);
        node.put("type", "AccessibilityNodeTree");
        node.put("className", "android.widget.FrameLayout");
        node.put("packageName", "test.app");
        node.put("text", "");
        node.put("description", "");
        node.put("isEnabled", true);
        node.put("isVisibleToUser", true);
        node.put("isPassword", false);
        node.put("isClickable", false);
        node.put("isScrollable", false);
        node.put("isWebView", false);
        node.put("nodeBound", new AgentTargetContextGuard.Box(left, top, right, bottom).json());
        return node;
    }
}
