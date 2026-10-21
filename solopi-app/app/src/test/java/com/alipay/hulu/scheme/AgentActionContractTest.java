package com.alipay.hulu.scheme;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import org.junit.Test;
import java.util.LinkedHashMap;
import java.util.Map;
import static org.junit.Assert.*;

public class AgentActionContractTest {
    private JSONObject page() {
        return JSON.parseObject("{\"packageName\":\"app\",\"children\":["
            + "{\"nodeId\":\"n1\",\"resourceId\":\"target\",\"packageName\":\"app\",\"visible\":true,\"enabled\":true,\"isEditable\":true,\"isClickable\":true,\"text\":\"Quantity\"},"
            + "{\"resourceId\":\"object\",\"packageName\":\"app\",\"visible\":true,\"text\":\"A\"},"
            + "{\"resourceId\":\"unit\",\"packageName\":\"app\",\"visible\":true,\"text\":\"units\"},"
            + "{\"resourceId\":\"memo\",\"packageName\":\"app\",\"visible\":true,\"text\":\"draft\"}]}");
    }
    private JSONObject contract(String kind) {
        JSONObject c = JSON.parseObject("{\"version\":1,\"packageName\":\"app\","
            + "\"action\":{\"type\":\"input\",\"targetResourceId\":\"target\",\"text\":\"8\"},"
            + "\"bindings\":[{\"role\":\"object\",\"resourceId\":\"object\",\"text\":\"A\"},"
            + "{\"role\":\"unit\",\"resourceId\":\"unit\",\"text\":\"units\"}],\"volatileTextResources\":[\"memo\"]}");
        c.getJSONObject("action").put("type", kind);
        if ("click".equals(kind)) c.getJSONObject("action").remove("text");
        return c;
    }
    private AgentSessionState.Action action(String kind) {
        Map<String, Object> args = new LinkedHashMap<>(); args.put("nodeId", "n1");
        if ("input".equals(kind)) args.put("text", "8");
        return AgentSessionState.Action.of(kind, args);
    }
    private JSONObject node(JSONObject p, int index) { return p.getJSONArray("children").getJSONObject(index); }
    private JSONObject accessibilityPage(int handle) {
        JSONObject p = page();
        for (int i = 0; i < p.getJSONArray("children").size(); i++) {
            node(p, i).put("type", "AccessibilityNodeTree");
            node(p, i).put("id", handle + i);
        }
        return p;
    }
    @Test public void runtimeAccessibilityHandlesMayChangeButSemanticIdentityMustNot() {
        JSONObject old = accessibilityPage(100), fresh = accessibilityPage(200);
        String saved = fresh.toJSONString();
        assertTrue(allows(contract("click"), old, fresh, "click"));
        assertEquals(saved, fresh.toJSONString());
        for (String field : new String[]{"text", "resourceId", "nodeBound", "type", "className"}) {
            fresh = accessibilityPage(200); node(fresh, 0).put(field, "changed");
            assertFalse(field, allows(contract("click"), old, fresh, "click"));
        }
        fresh = accessibilityPage(200); node(fresh, 1).put("text", "B");
        assertFalse(allows(contract("click"), old, fresh, "click"));
        for (String flag : new String[]{"visible", "enabled", "isClickable"}) {
            fresh = accessibilityPage(200); node(fresh, 0).put(flag, false);
            assertFalse(allows(contract("click"), old, fresh, "click"));
        }
        fresh = accessibilityPage(200); fresh.getJSONArray("children").remove(0);
        assertFalse(allows(contract("click"), old, fresh, "click"));
        fresh = accessibilityPage(200); fresh.getJSONArray("children").add(node(fresh, 0));
        assertFalse(allows(contract("click"), old, fresh, "click"));
    }
    @Test public void idsFromOtherProvidersRemainProtected() {
        JSONObject old = page(), fresh = page();
        node(old, 0).put("id", 1); node(fresh, 0).put("id", 2);
        assertFalse(allows(contract("click"), old, fresh, "click"));
        node(old, 0).put("type", "OtherProvider"); node(fresh, 0).put("type", "OtherProvider");
        assertFalse(allows(contract("click"), old, fresh, "click"));
    }
    private boolean allows(JSONObject c, JSONObject old, JSONObject fresh, String kind) {
        return AgentActionContract.allows(c.toJSONString(), old, fresh, action(kind));
    }
    @Test public void permitsOnlyDeclaredLeafTextForClickAndInputWithoutMutatingEvidence() {
        for (String kind : new String[]{"click", "input"}) {
            JSONObject old = page(), fresh = page(); String saved = old.toJSONString();
            node(fresh, 3).put("text", "updated"); node(fresh, 0).remove("nodeId");
            assertTrue(allows(contract(kind), old, fresh, kind)); assertEquals(saved, old.toJSONString());
            node(fresh, 3).put("nodeBound", "changed");
            assertFalse(allows(contract(kind), old, fresh, kind));
        }
    }
    @Test public void rejectsChangedBindingsEvenAfterFreshModelObservation() {
        for (int i : new int[]{1, 2}) {
            JSONObject fresh = page(); node(fresh, i).put("text", "different");
            assertFalse(allows(contract("input"), page(), fresh, "input"));
            assertFalse(allows(contract("input"), fresh, fresh, "input"));
        }
    }
    @Test public void rejectsMissingDuplicateHiddenDisabledAndReplacedTarget() {
        for (String kind : new String[]{"click", "input"}) {
            JSONObject fresh = page(); fresh.getJSONArray("children").remove(0);
            assertFalse(allows(contract(kind), page(), fresh, kind));
            fresh = page(); fresh.getJSONArray("children").add(node(fresh, 0));
            assertFalse(allows(contract(kind), page(), fresh, kind));
            for (String flag : new String[]{"visible", "enabled", "isEditable", "isClickable"}) {
                fresh = page(); node(fresh, 0).put(flag, false);
                assertFalse(allows(contract(kind), page(), fresh, kind));
            }
            fresh = page(); node(fresh, 0).put("resourceId", "replacement");
            assertFalse(allows(contract(kind), page(), fresh, kind));
        }
    }
    @Test public void rejectsOverlappingMissingMalformedAndOverbroadContracts() {
        for (String resource : new String[]{"target", "object", "unit", "missing"}) {
            JSONObject c = contract("input"); c.getJSONArray("volatileTextResources").set(0, resource);
            assertFalse(allows(c, page(), page(), "input"));
        }
        assertFalse(AgentActionContract.allows("bad", page(), page(), action("input")));
        assertFalse(AgentActionContract.allows("{}", page(), page(), action("input")));
        JSONObject c = contract("input"); c.put("extra", true);
        assertFalse(allows(c, page(), page(), "input"));
        c = contract("input"); c.getJSONArray("bindings").clear();
        assertFalse(allows(c, page(), page(), "input"));
        JSONObject fresh = page(); fresh.getJSONArray("children").add(node(fresh, 1));
        assertFalse(allows(contract("input"), page(), fresh, "input"));
    }
    @Test public void newDecisionCannotChangeActionTargetOrInputValue() {
        assertFalse(allows(contract("click"), page(), page(), "input"));
        AgentSessionState.Action a = action("input");
        Map<String, Object> args = new LinkedHashMap<>(a.arguments); args.put("text", "99");
        assertFalse(AgentActionContract.allows(contract("input").toJSONString(), page(), page(),
                AgentSessionState.Action.of("input", args)));
        args.put("nodeId", "missing");
        assertFalse(AgentActionContract.allows(contract("input").toJSONString(), page(), page(),
                AgentSessionState.Action.of("input", args)));
    }
}
