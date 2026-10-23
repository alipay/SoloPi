package com.alipay.hulu.shared.node.utils;

import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.shared.node.action.OperationExecutor;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.FakeNodeTree;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;

public class NodeTreeAssertionTest {
    private int previousLogLevel;

    @Before public void suppressAndroidLogs() {
        previousLogLevel = LogUtil.LOG_LEVEL;
        LogUtil.LOG_LEVEL = Integer.MAX_VALUE;
    }

    @After public void restoreLogs() {
        LogUtil.LOG_LEVEL = previousLogLevel;
    }

    @Test
    public void descriptionSelectsOnlyCurrentNodeDespiteDifferentChildDescriptions() {
        FakeNodeTree parent = node("glyph", "返回");
        parent.addChildNode(node("child text", "关闭"));
        assertEquals("返回", NodeTreeUtil.assertionContent(parent, "description"));
    }

    @Test
    public void missingDescriptionDoesNotFallBackToTextOrDescendants() {
        FakeNodeTree parent = node("返回", null);
        parent.addChildNode(node("child text", "返回"));
        assertEquals("", NodeTreeUtil.assertionContent(parent, "description"));
    }

    @Test
    public void absentAndExplicitTextRetainLegacyDescendantAggregation() {
        FakeNodeTree parent = node("parent", "ignored description");
        FakeNodeTree child = node("child", "ignored child description");
        parent.addChildNode(child);
        child.addChildNode(node("grandchild", "ignored grandchild description"));
        assertEquals("parentchildgrandchild", NodeTreeUtil.assertionContent(parent, null));
        assertEquals("parentchildgrandchild", NodeTreeUtil.assertionContent(parent, "text"));
    }

    @Test
    public void unknownAndEmptyTargetsFailClosedAtActualActionEntry() {
        FakeNodeTree node = node("返回", "返回");
        for (String target : new String[]{"", "Description", "packageName", "children.description"}) {
            OperationMethod method = new OperationMethod(PerformActionEnum.ASSERT);
            method.setEncrypt(false);
            method.putParam(OperationExecutor.ASSERT_TARGET, target);
            method.putParam(OperationExecutor.ASSERT_MODE, "assert_accurate");
            method.putParam(OperationExecutor.ASSERT_INPUT_CONTENT, "返回");
            assertNull(NodeTreeUtil.assertionContent(node, target));
            assertFalse(NodeTreeUtil.performAssertAction(node, method));
        }
    }

    @Test
    public void missingNodeCannotSatisfyAnAssertion() {
        assertNull(NodeTreeUtil.assertionContent(null, "description"));
        OperationMethod method = new OperationMethod(PerformActionEnum.ASSERT);
        method.setEncrypt(false);
        method.putParam(OperationExecutor.ASSERT_TARGET, "description");
        assertFalse(NodeTreeUtil.performAssertAction(null, method));
    }

    private static FakeNodeTree node(String text, String description) {
        FakeNodeTree node = new FakeNodeTree();
        node.setText(text);
        node.setDescription(description);
        return node;
    }
}
