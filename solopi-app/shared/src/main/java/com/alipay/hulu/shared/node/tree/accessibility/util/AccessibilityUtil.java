/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * 	http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.alipay.hulu.shared.node.tree.accessibility.util;

import android.os.Build;
import android.view.accessibility.AccessibilityNodeInfo;

import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.FakeNodeTree;
import com.alipay.hulu.shared.node.tree.accessibility.tree.AccessibilityNodeTree;

import java.lang.reflect.Method;

/**
 * Accessibility节点工具类
 */
public class AccessibilityUtil {
    private static final String TAG = "AccessibilityUtil";
    private static Method getIdMethod;

    private static int indexCounter = 0;

    static {
        try {
            getIdMethod = AccessibilityNodeInfo.class.getDeclaredMethod("getSourceNodeId", (Class[]) null);
            getIdMethod.setAccessible(true);
        } catch (NoSuchMethodException e) {
            LogUtil.e(TAG, e.getLocalizedMessage(), e);
        }
    }

    /**
     * 根据当前节点构建子节点树
     *
     * @param rootNode 当前节点
     * @return
     * @throws Exception
     */
    public static AccessibilityNodeTree buildCurrentNode(AccessibilityNodeInfo rootNode, AbstractNodeTree parent) throws Exception {

        Long id = getAccessibilityNodeId(rootNode, getIdMethod);
        AccessibilityNodeTree currentNode = new AccessibilityNodeTree(rootNode, parent, StringUtil.toString(id));

        if (currentNode.getParent() == null || currentNode.getParent() instanceof FakeNodeTree) {
            indexCounter = 1;
        }

        currentNode.setIndex(indexCounter++);

        return currentNode;
    }

    /**
     * 反射获取ID
     * @param node
     * @param getMethod
     * @return
     */
    private static long getAccessibilityNodeId(AccessibilityNodeInfo node, Method getMethod) {
        try {
            if (getMethod == null) {
                getMethod = AccessibilityNodeInfo.class.getDeclaredMethod("getSourceNodeId", (Class[]) null);
                getMethod.setAccessible(true);
            }
            return (Long) getMethod.invoke(node);
        } catch (Exception e) {
            LogUtil.e(TAG, e, "抛出异常，Android Version is " + Build.VERSION.SDK_INT);
        }
        return 0;
    }
}
