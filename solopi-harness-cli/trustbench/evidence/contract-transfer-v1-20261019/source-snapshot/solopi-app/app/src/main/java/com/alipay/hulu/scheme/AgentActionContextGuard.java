package com.alipay.hulu.scheme;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;

/** Input evidence equivalence. Other fields may determine the target's business meaning. */
final class AgentActionContextGuard {
    static boolean allows(JSONObject observed, JSONObject current, String nodeId, String action) {
        try {
            return allowsChecked(observed, current, nodeId, action);
        } catch (RuntimeException invalidEvidence) {
            return false;
        }
    }

    private static boolean allowsChecked(JSONObject observed, JSONObject current, String nodeId, String action) {
        if (!"input".equals(action) || observed == null || current == null || nodeId == null) return false;
        JSONObject target = byNodeId(observed, nodeId);
        if (target == null || !Boolean.TRUE.equals(target.getBoolean("visible"))
                || !Boolean.TRUE.equals(target.getBoolean("isEditable"))) return false;
        String resource = target.getString("resourceId");
        String pkg = target.getString("packageName");
        if (resource == null || resource.isEmpty() || pkg == null || pkg.isEmpty()
                || !pkg.equals(observed.getString("packageName"))
                || !pkg.equals(current.getString("packageName"))) return false;
        if (countResource(observed, resource, pkg) != 1 || countResource(current, resource, pkg) != 1) return false;
        return normalize(observed, resource, pkg).equals(normalize(current, resource, pkg));
    }

    private static JSONObject normalize(JSONObject page, String resource, String pkg) {
        JSONObject copy = JSON.parseObject(page.toJSONString());
        normalizeInPlace(copy, resource, pkg);
        return copy;
    }

    private static void normalizeInPlace(JSONObject node, String resource, String pkg) {
        node.remove("nodeId"); // Host observation annotation, absent from fresh export.
        // Never discard other editable fields' text: it can select an object, unit,
        // account or amount. A changed page needs a new observation and decision.
        JSONArray children = node.getJSONArray("children");
        if (children != null) for (int i = 0; i < children.size(); i++) normalizeInPlace(children.getJSONObject(i), resource, pkg);
    }

    private static JSONObject byNodeId(JSONObject node, String id) {
        if (id.equals(node.getString("nodeId"))) return node;
        JSONArray children = node.getJSONArray("children");
        if (children != null) for (int i = 0; i < children.size(); i++) {
            JSONObject found = byNodeId(children.getJSONObject(i), id);
            if (found != null) return found;
        }
        return null;
    }

    private static int countResource(JSONObject node, String resource, String pkg) {
        int count = resource.equals(node.getString("resourceId")) && pkg.equals(node.getString("packageName")) ? 1 : 0;
        JSONArray children = node.getJSONArray("children");
        if (children != null) for (int i = 0; i < children.size(); i++) count += countResource(children.getJSONObject(i), resource, pkg);
        return count;
    }
}
