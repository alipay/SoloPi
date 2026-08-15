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
package com.alipay.hulu.shared.node.locater;

import android.os.Build;
import android.view.accessibility.AccessibilityNodeInfo;

import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.accessibility.tree.AccessibilityNodeTree;

import java.lang.reflect.Method;

/**
 * AccessibilityEvent定位器
 * Created by qiaoruikai on 2018/10/8 8:25 PM.
 */
public class AccessibilityLocator {
    private static final String TAG = "AccessibilityLocator";

    /**
     * 查找id的方法
     */
    private static Method getIdMethod = null;

    /**
     * 通过AccessibilityNodeInfo查找
     *
     * @param eventNode
     * @return
     */
    public static AbstractNodeTree findNodeByAccessbilityEventNode(AbstractNodeTree root, AccessibilityNodeInfo eventNode) {
        // 对于非AccessibilityNode为根节点的树，无法查找
        if (!(root instanceof AccessibilityNodeTree)) {
            return null;
        }

        Long targetId = getAccessibilityNodeId(eventNode, getIdMethod);
        if (targetId == null) {
            return null;
        }

        for (AbstractNodeTree node : root) {
            // 仅处理AccessibilityNodeTree
            if (node instanceof AccessibilityNodeTree) {
                // 比较ID
                if (StringUtil.equals(node.getId(), Long.toString(targetId))) {
                    AbstractNodeTree parent = node;
                    // 确认不是WebView内部类
                    while (parent != null) {
                        if (StringUtil.contains(parent.getClassName(), "WebView")) {
                            return null;
                        }

                        parent = parent.getParent();
                    }

                    return node;
                }
            }
        }

        return null;
    }

    /**
     * 反射获取ID
     * @param node
     * @param getMethod
     * @return
     */
    private static Long getAccessibilityNodeId(AccessibilityNodeInfo node, Method getMethod) {
        try {
            if (getMethod == null) {
                getMethod = AccessibilityNodeInfo.class.getDeclaredMethod("getSourceNodeId", (Class[]) null);
                getMethod.setAccessible(true);
            }
            return (Long) getMethod.invoke(node);
        } catch (Exception e) {
            LogUtil.e(TAG, "Not supported, Android Version is " + Build.VERSION.SDK_INT);
        }
        return null;
    }
}
