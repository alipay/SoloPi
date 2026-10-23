package com.alipay.hulu.shared.node.tree.accessibility;

import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.shared.node.tree.accessibility.tree.AccessibilityNodeTree;

import org.junit.Test;

import java.lang.reflect.Field;

import static org.junit.Assert.*;

/** Wire-contract tests; actual AccessibilityNodeInfo getters require device verification. */
public class AccessibilityNodeMetadataTest {
    private static final String[] FIELDS = {
            "isPassword", "isSelected", "isChecked", "isVisibleToUser"
    };

    @Test
    public void missingAccessibilitySourceExportsUnknownInsteadOfClaimingSafeDefaults() {
        JSONObject page = new AccessibilityNodeTree(null, null).exportToJsonObject();
        for (String name : FIELDS) {
            assertTrue(name, page.containsKey(name));
            assertNull(name, page.get(name));
        }
    }

    @Test
    public void trueAndFalseMetadataAreExportedAsBooleansWithoutChangingNodeIdentity() throws Exception {
        AccessibilityNodeTree root = new AccessibilityNodeTree(null, null, "root-source");
        AccessibilityNodeTree child = new AccessibilityNodeTree(null, root, "child-source");
        root.addChildNode(child);
        for (String name : FIELDS) {
            set(root, name, true);
            set(child, name, false);
        }
        JSONObject page = root.exportToJsonObject();
        JSONObject exportedChild = page.getJSONArray("children").getJSONObject(0);
        assertEquals("root-source", page.getString("id"));
        assertEquals("child-source", exportedChild.getString("id"));
        assertEquals(1, page.getJSONArray("children").size());
        for (String name : FIELDS) {
            assertEquals(name, Boolean.TRUE, page.get(name));
            assertEquals(name, Boolean.FALSE, exportedChild.get(name));
        }
    }

    @Test
    public void rawVisibilityDoesNotRewriteLegacyAreaVisibility() throws Exception {
        AccessibilityNodeTree node = new AccessibilityNodeTree(null, null);
        node.setVisible(true);
        set(node, "isVisibleToUser", false);
        JSONObject page = node.exportToJsonObject();
        assertEquals(Boolean.TRUE, page.get("visible"));
        assertEquals(Boolean.FALSE, page.get("isVisibleToUser"));
    }

    private static void set(AccessibilityNodeTree node, String name, boolean value) throws Exception {
        Field field = AccessibilityNodeTree.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(node, value);
    }
}
