package com.alipay.hulu.scheme;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Trusted session policy, never supplied by a model decision. No fuzzy selectors. */
final class AgentActionContract {
    static boolean allows(String raw, JSONObject observed, JSONObject current,
                          AgentSessionState.Action action) {
        try {
            JSONObject contract = JSON.parseObject(raw);
            keys(contract, "version", "packageName", "action", "bindings", "volatileTextResources");
            if (!Integer.valueOf(1).equals(contract.get("version"))) return false;
            String pkg = text(contract, "packageName");
            if (!pkg.equals(observed.getString("packageName"))
                    || !pkg.equals(current.getString("packageName"))) return false;
            JSONObject requiredAction = contract.getJSONObject("action");
            String kind = text(requiredAction, "type");
            if (!kind.equals(action.type) || !("click".equals(kind) || "input".equals(kind))) return false;
            if ("input".equals(kind)) {
                keys(requiredAction, "type", "targetResourceId", "text");
                if (!text(requiredAction, "text").equals(action.arguments.get("text"))) return false;
            } else keys(requiredAction, "type", "targetResourceId");
            String targetResource = text(requiredAction, "targetResourceId");
            JSONObject oldTarget = unique(observed, targetResource, pkg);
            JSONObject newTarget = unique(current, targetResource, pkg);
            if (!action.arguments.get("nodeId").equals(oldTarget.get("nodeId"))) return false;
            String flag = "input".equals(kind) ? "isEditable" : "isClickable";
            if (!Boolean.TRUE.equals(oldTarget.get(flag)) || !Boolean.TRUE.equals(newTarget.get(flag))) return false;
            if (!Boolean.TRUE.equals(oldTarget.get("enabled")) || !Boolean.TRUE.equals(newTarget.get("enabled"))) return false;

            Set<String> protectedResources = new HashSet<>();
            protectedResources.add(targetResource);
            Set<String> roles = new HashSet<>();
            JSONArray bindings = contract.getJSONArray("bindings");
            if (bindings == null || bindings.isEmpty()) return false;
            for (int i = 0; i < bindings.size(); i++) {
                JSONObject binding = bindings.getJSONObject(i);
                keys(binding, "role", "resourceId", "text");
                if (!roles.add(text(binding, "role"))) return false;
                String resource = text(binding, "resourceId");
                if (!protectedResources.add(resource)) return false;
                String expected = text(binding, "text");
                if (!expected.equals(unique(observed, resource, pkg).get("text"))
                        || !expected.equals(unique(current, resource, pkg).get("text"))) return false;
            }
            if (!roles.contains("object") && !roles.contains("unit")) return false;
            JSONObject oldCopy = JSON.parseObject(observed.toJSONString());
            JSONObject newCopy = JSON.parseObject(current.toJSONString());
            JSONArray volatileResources = contract.getJSONArray("volatileTextResources");
            if (volatileResources == null) return false;
            Set<String> seen = new HashSet<>(protectedResources);
            for (int i = 0; i < volatileResources.size(); i++) {
                Object value = volatileResources.get(i);
                if (!(value instanceof String) || ((String) value).isEmpty() || !seen.add((String) value)) return false;
                for (JSONObject page : new JSONObject[]{oldCopy, newCopy}) {
                    JSONObject node = unique(page, (String) value, pkg);
                    // Only leaf text may vary. Structure, geometry and flags remain protected.
                    JSONArray children = node.getJSONArray("children");
                    if (children != null && !children.isEmpty() || !(node.get("text") instanceof String)) return false;
                    node.put("text", "");
                }
            }
            stripHostIds(oldCopy); stripHostIds(newCopy);
            return oldCopy.equals(newCopy);
        } catch (RuntimeException invalid) {
            return false;
        }
    }

    private static void keys(JSONObject object, String... names) {
        if (object == null || !object.keySet().equals(new HashSet<>(Arrays.asList(names))))
            throw new IllegalArgumentException("Invalid contract fields");
    }

    private static String text(JSONObject object, String key) {
        Object value = object.get(key);
        if (!(value instanceof String) || ((String) value).isEmpty())
            throw new IllegalArgumentException("Missing contract text");
        return (String) value;
    }

    private static JSONObject unique(JSONObject page, String resource, String pkg) {
        JSONArray matches = new JSONArray();
        find(page, resource, pkg, matches);
        if (matches.size() != 1) throw new IllegalArgumentException("Missing or duplicate resource");
        JSONObject node = matches.getJSONObject(0);
        if (!Boolean.TRUE.equals(node.get("visible"))) throw new IllegalArgumentException("Hidden resource");
        return node;
    }

    private static void find(JSONObject node, String resource, String pkg, JSONArray matches) {
        if (resource.equals(node.get("resourceId")) && pkg.equals(node.get("packageName"))) matches.add(node);
        JSONArray children = node.getJSONArray("children");
        if (children != null) for (int i = 0; i < children.size(); i++) find(children.getJSONObject(i), resource, pkg, matches);
    }

    private static void stripHostIds(JSONObject node) {
        node.remove("nodeId");
        // AccessibilityNodeTree.id is an Android runtime handle, not an app
        // resource identity. A new accessibility snapshot may allocate another
        // handle for the same resource. Keep all semantic fields and geometry.
        if ("AccessibilityNodeTree".equals(node.getString("type"))) node.remove("id");
        JSONArray children = node.getJSONArray("children");
        if (children != null) for (int i = 0; i < children.size(); i++) stripHostIds(children.getJSONObject(i));
    }
}
