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
package com.alipay.hulu.shared.node.tree.accessibility;


import android.view.accessibility.AccessibilityNodeInfo;

import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.shared.node.AbstractNodeProcessor;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.FakeNodeTree;
import com.alipay.hulu.shared.node.tree.accessibility.util.AccessibilityUtil;
import com.alipay.hulu.shared.node.tree.annotation.NodeProcessor;
import com.alipay.hulu.shared.node.utils.NodeContext;

@NodeProcessor(acceptNodes = { AccessibilityNodeInfo.class, FakeNodeTree.class })
public class AccessibilityNodeProcessor implements AbstractNodeProcessor {
    private static final String TAG = "AccessibilityNodeProcessor";

    @Override
    public AbstractNodeTree loadNode(Object source, AbstractNodeTree parent, NodeContext context) {
        if (source instanceof AccessibilityNodeInfo) {
            try {
                return AccessibilityUtil.buildCurrentNode((AccessibilityNodeInfo) source, parent);
            } catch (Exception e) {
                LogUtil.e(TAG, "Catch java.lang.Exception: " + e.getMessage(), e);
            }
        } else if (source instanceof FakeNodeTree) {
            return (FakeNodeTree) source;
        }
        return null;
    }
}

