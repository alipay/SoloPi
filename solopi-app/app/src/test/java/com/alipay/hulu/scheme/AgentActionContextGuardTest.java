package com.alipay.hulu.scheme;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class AgentActionContextGuardTest {
    private JSONObject page() {
        return JSON.parseObject("{\"packageName\":\"app\",\"children\":["
            + "{\"nodeId\":\"n1\",\"resourceId\":\"title\",\"packageName\":\"app\",\"className\":\"EditText\",\"visible\":true,\"isEditable\":true,\"text\":\"Title\",\"nodeBound\":{\"left\":0,\"right\":100}},"
            + "{\"nodeId\":\"n2\",\"resourceId\":\"body\",\"packageName\":\"app\",\"visible\":true,\"isEditable\":true,\"text\":\"Body\"}]}");
    }

    @Test public void rejectsOtherEditableTextWithoutMutatingEvidence() {
        JSONObject old = page(), fresh = page();
        String saved = old.toJSONString();
        fresh.getJSONArray("children").getJSONObject(1).put("text", "External draft");
        assertFalse(AgentActionContextGuard.allows(old, fresh, "n1", "input"));
        assertFalse(AgentActionContextGuard.allows(old, fresh, "n1", "click"));
        assertFalse(AgentActionContextGuard.allows(old, fresh, "n1", "back"));
        assertEquals(saved, old.toJSONString());
    }

    @Test public void rejectsBusinessContextChangesEvenWhenTargetIsIdentical() {
        for (String context : new String[]{"Object B", "Unit: boxes (10 units)", "Account: other", "Unrelated memo"}) {
            JSONObject old = page(), fresh = page();
            fresh.getJSONArray("children").getJSONObject(1).put("text", context);
            assertFalse(context, AgentActionContextGuard.allows(old, fresh, "n1", "input"));
        }
    }

    @Test public void acceptsEquivalentEvidenceWithOnlyHostNodeAnnotationsChanged() {
        JSONObject old = page(), fresh = page();
        fresh.getJSONArray("children").getJSONObject(0).remove("nodeId");
        fresh.getJSONArray("children").getJSONObject(1).remove("nodeId");
        assertTrue(AgentActionContextGuard.allows(old, fresh, "n1", "input"));
        assertEquals("n1", old.getJSONArray("children").getJSONObject(0).getString("nodeId"));
    }

    @Test public void rejectsTargetDisappearanceDuplicatesAndOldIds() {
        JSONObject old = page(), fresh = page();
        fresh.getJSONArray("children").remove(0);
        assertFalse(AgentActionContextGuard.allows(old, fresh, "n1", "input"));
        fresh = page();
        fresh.getJSONArray("children").add(fresh.getJSONArray("children").getJSONObject(0));
        assertFalse(AgentActionContextGuard.allows(old, fresh, "n1", "input"));
        assertFalse(AgentActionContextGuard.allows(old, page(), "missing", "input"));
    }

    @Test public void rejectsEveryTargetSemanticChange() {
        for (String key : new String[]{"text", "className", "resourceId", "packageName", "nodeBound", "visible", "isEditable"}) {
            JSONObject fresh = page();
            fresh.getJSONArray("children").getJSONObject(0).put(key, "changed");
            assertFalse(key, AgentActionContextGuard.allows(page(), fresh, "n1", "input"));
        }
    }

    @Test public void rejectsLayoutNonEditableTextAndPackageChanges() {
        JSONObject old = page(), fresh = page();
        fresh.put("packageName", "other");
        assertFalse(AgentActionContextGuard.allows(old, fresh, "n1", "input"));
        fresh = page(); fresh.put("newOverlay", true);
        assertFalse(AgentActionContextGuard.allows(old, fresh, "n1", "input"));
        old.getJSONArray("children").getJSONObject(1).put("isEditable", false);
        fresh = JSON.parseObject(old.toJSONString());
        fresh.getJSONArray("children").getJSONObject(1).put("text", "different warning");
        assertFalse(AgentActionContextGuard.allows(old, fresh, "n1", "input"));
    }
}
