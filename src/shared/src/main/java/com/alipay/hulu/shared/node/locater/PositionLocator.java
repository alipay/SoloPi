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

import android.graphics.Rect;

import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.FakeNodeTree;

import java.util.ArrayList;
import java.util.LinkedList;
import java.util.List;
import java.util.Queue;

/**
 * 坐标定位
 */
public class PositionLocator {
    private static final String TAG = "PositionLocator";

    /**
     * 查找(x, y)处最深的节点
     *
     * @param root
     * @param x
     * @param y
     * @return
     */
    public static AbstractNodeTree findDeepestNode(AbstractNodeTree root, int x, int y) {
        if (root == null || !root.getNodeBound().contains(x, y)) {
            LogUtil.w(TAG, "Root为空或者不包含坐标位置");
            return null;
        }

        List<AbstractNodeTree> candiateNodes = new ArrayList<>();
        Queue<AbstractNodeTree> findQueue = new LinkedList<>();

        // 查找实际响应的window
        AbstractNodeTree targetWindow = root;
        if (root instanceof FakeNodeTree) {
            List<AbstractNodeTree> windows = root.getChildrenNodes();
            int maxIdx = -1;
            for (AbstractNodeTree window: windows) {
                // 找包含该坐标的最上层window
                if (window.getDrawingOrder() > maxIdx && window.getNodeBound().contains(x, y)) {
                    maxIdx = window.getDrawingOrder();
                    targetWindow = window;
                }
            }
        }

        findQueue.add(targetWindow);

        // 查找所有包含该位置的深度最深的节点
        AbstractNodeTree currentNode;
        while ((currentNode = findQueue.poll()) != null) {
            // 通过坐标查找
            boolean contains = currentNode.getNodeBound().contains(x, y);

            // 只保留可用于定位的节点（自身可用于定位或者有子节点）
            if (contains && (currentNode.isSelfUsableForLocating() ||
                    (currentNode.getChildrenNodes() != null &&
                            currentNode.getChildrenNodes().size() > 0))) {
                candiateNodes.add(currentNode);
            }

            // 查找包含该坐标的所有子节点
            if (currentNode.getChildrenNodes() != null) {
                findQueue.addAll(currentNode.getChildrenNodes());
            }
        }

        LogUtil.d(TAG, "get nodes count:" + candiateNodes.size());
        if (candiateNodes.size() == 0) {
            return null;
        }

        // 查找最小的节点
        AbstractNodeTree min = candiateNodes.get(0);
        int minSize = calculateRectSize(min.getNodeBound());
        for (AbstractNodeTree node: candiateNodes) {
            int curSize = calculateRectSize(node.getNodeBound());

            if (curSize < minSize) {
                min = node;
                minSize = curSize;
            } else if (curSize == minSize) {
                // 如果是父子节点关系，取子节点
                if (node.hasParent(min)) {
                    min = node;
                }
            }

        }

        return min;
    }

    /**
     * 计算面积
     * @param rect
     * @return
     */
    private static int calculateRectSize(Rect rect) {
        if (rect == null) {
            return Integer.MAX_VALUE;
        }

        return rect.width() * rect.height();
    }

}
