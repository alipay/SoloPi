package com.alipay.hulu.scheme;

import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.JSONArray;
import com.alipay.hulu.virtualscreen.VirtualActionGuard;
import com.alipay.hulu.virtualscreen.VirtualOcrEngine;
import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;
import static org.junit.Assert.*;

public class AgentVirtualObservationTest {
    @Test public void ocrReuseRequiresIdenticalFrameAndPageAndVerifiedResult() {
        VirtualActionGuard.Box bounds = new VirtualActionGuard.Box(0, 0, 100, 200);
        VirtualActionGuard.Node root = new VirtualActionGuard.Node("0", "", "", "root", "Layout", bounds, true, true, false, false);
        VirtualActionGuard.Page page = new VirtualActionGuard.Page(5, 7, 100, 200, 0, "test.app",
                Collections.singletonList(new VirtualActionGuard.Window(7, 1, bounds)), Collections.singletonList(root));
        VirtualActionGuard.Page otherWindow = new VirtualActionGuard.Page(5, 8, 100, 200, 0, "test.app",
                Collections.singletonList(new VirtualActionGuard.Window(8, 1, bounds)), Collections.singletonList(root));
        VirtualOcrEngine.Result ready = new VirtualOcrEngine.Result(1, 2, 3, true, "current", Collections.<VirtualOcrEngine.Line>emptyList());
        VirtualOcrEngine.Result stale = new VirtualOcrEngine.Result(1, 2, 3, false, "stale", Collections.<VirtualOcrEngine.Line>emptyList());
        VirtualOcrEngine.Result inconsistent = new VirtualOcrEngine.Result(1, 2, 3, true, "stale", Collections.<VirtualOcrEngine.Line>emptyList());
        assertTrue(AgentVirtualObservation.reusableOcr("tree", "pixels", page, ready, "tree", "pixels", page));
        assertFalse(AgentVirtualObservation.reusableOcr("tree", "pixels", page, ready, "changed", "pixels", page));
        assertFalse(AgentVirtualObservation.reusableOcr("tree", "pixels", page, ready, "tree", "changed", page));
        assertFalse(AgentVirtualObservation.reusableOcr("tree", "pixels", page, ready, "tree", "pixels", otherWindow));
        assertFalse(AgentVirtualObservation.reusableOcr("tree", "pixels", page, stale, "tree", "pixels", page));
        assertFalse(AgentVirtualObservation.reusableOcr("tree", "pixels", page, inconsistent, "tree", "pixels", page));
        assertFalse(AgentVirtualObservation.reusableOcr("tree", "pixels", page, null, "tree", "pixels", page));
    }
    @Test public void progressUsesOnlyVerifiedVisibleOcrAndIsOrderIndependent() {
        JSONObject a = new JSONObject(), b = new JSONObject();
        JSONObject first = line("发现", 1, true), second = line("朋友圈", 2, true), unverified = line("闪动", 3, false);
        JSONArray one = new JSONArray(), two = new JSONArray();
        one.add(first); one.add(second); one.add(unverified);
        two.add(second); two.add(first);
        a.put("lines", one); b.put("lines", two);
        assertEquals(AgentVirtualObservation.progressSignature("tree", a), AgentVirtualObservation.progressSignature("tree", b));
        two.remove(0);
        assertNotEquals(AgentVirtualObservation.progressSignature("tree", a), AgentVirtualObservation.progressSignature("tree", b));
    }
    private static JSONObject line(String text, int x, boolean match) {
        JSONObject line = new JSONObject(), bounds = new JSONObject();
        bounds.put("left", x); bounds.put("top", 0); bounds.put("right", x + 1); bounds.put("bottom", 1);
        line.put("text", text); line.put("pixelsMatch", match); line.put("bounds", bounds);
        return line;
    }
    @Test public void keepsDevicePathsPrivateAndRedactsPasswordNodeText() {
        VirtualActionGuard.Box bounds = new VirtualActionGuard.Box(0, 0, 100, 200);
        VirtualActionGuard.Node root = new VirtualActionGuard.Node("0", "", "", "root", "Layout", bounds, true, true, false, false);
        VirtualActionGuard.Node password = new VirtualActionGuard.Node("0.3", "secret", "secret", "field", "EditText", bounds, true, true, true, true);
        VirtualActionGuard.Page source = new VirtualActionGuard.Page(5, 7, 100, 200, 0, "test.app",
                Collections.singletonList(new VirtualActionGuard.Window(7, 1, bounds)), Arrays.asList(root, password));
        AgentVirtualObservation.Encoded result = AgentVirtualObservation.encode(source);
        JSONObject child = result.page.getJSONArray("children").getJSONObject(0);
        assertEquals("node-2", child.getString("nodeId"));
        assertEquals("0.3", result.nodePaths.get("node-2"));
        assertEquals("", child.getString("text"));
        assertEquals("", child.getString("description"));
        assertEquals("test.app", child.getString("packageName"));
        assertTrue(child.getBooleanValue("isVisibleToUser"));
        assertEquals(100, child.getJSONObject("nodeBound").getIntValue("right"));
        assertFalse(child.containsKey("path"));
    }

    @Test public void refusesMissingOrDuplicateDevicePaths() {
        VirtualActionGuard.Box b = new VirtualActionGuard.Box(0, 0, 100, 200);
        VirtualActionGuard.Node orphan = new VirtualActionGuard.Node("0.3", "", "", "", "", b, true, true, false, false);
        VirtualActionGuard.Page page = new VirtualActionGuard.Page(1, 2, 100, 200, 0, "test.app",
                Collections.<VirtualActionGuard.Window>emptyList(), Collections.singletonList(orphan));
        try { AgentVirtualObservation.encode(page); fail("orphan accepted"); }
        catch (IllegalArgumentException expected) { }
    }
}
