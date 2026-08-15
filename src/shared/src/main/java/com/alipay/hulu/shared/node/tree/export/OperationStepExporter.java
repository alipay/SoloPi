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
package com.alipay.hulu.shared.node.tree.export;

import android.content.Context;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.OperationNode;
import com.alipay.hulu.shared.node.tree.capture.CaptureTree;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Created by qiaoruikai on 2018/10/10 5:15 PM.
 */
public class OperationStepExporter implements BaseStepExporter<OperationStep> {
    public static final String CAPTURE_IMAGE_BASE64 = "captureImage";
    public static final String ORIGIN_SCREEN_SIZE = "screenSize";
    String operationId;
    AtomicInteger operationIdx;

    public OperationStepExporter(String operationId) {
        this.operationId = operationId;
        operationIdx = new AtomicInteger(0);
    }

    public void refresh(String operationId) {
        this.operationId = operationId;
        this.operationIdx.set(0);
    }

    @Override
    public OperationStep exportStep(AbstractNodeTree root, AbstractNodeTree currentNode, OperationMethod method) {
        OperationNode node = null;
        if (currentNode != null) {
            node = exportNodeToOperationNode(currentNode);
        }
        // 组装步骤信息
        OperationStep step = new OperationStep();
        step.setOperationNode(node);
        step.setOperationMethod(method);
        step.setOperationId(operationId);
        step.setOperationIndex(operationIdx.getAndIncrement());

        return step;
    }

    /**
     * 查找可用于辅助定位的子节点
     *
     * @return
     */
    private static List<AbstractNodeTree> findUsableChildNodes(AbstractNodeTree node) {
        if (node.getChildrenNodes() == null || node.getChildrenNodes().size() == 0) {
            return null;
        }

        List<AbstractNodeTree> findResult = new ArrayList<>();

        // 只保留text非空或description非空的子节点
        for (AbstractNodeTree currentChild : node) {

            // 自身不用记录
            if (node == currentChild) {
                continue;
            }

            // 对于可用于辅助定位的节点
            if (currentChild.isSelfUsableForLocating()) { //!StringUtil.isEmpty(currentChild.getText()) || !StringUtil.isEmpty(currentChild.getDescription())) {
                findResult.add(currentChild);
            }
        }
        return findResult;
    }

    /**
     * 将AbstractNode转为OperationNode
     *
     * @param currentNode
     * @return
     */
    public static OperationNode exportNodeToOperationNode(AbstractNodeTree currentNode) {
        OperationNode node = new OperationNode();

        // 暂时先记录包名，类名，描述，resourceId，Id，Xpath，Text
        node.setClassName(currentNode.getClassName());
        node.setPackageName(currentNode.getPackageName());
        node.setNodeType(currentNode.getClass().getSimpleName());
        if (currentNode.getDescription() != null) {
            node.setDescription(currentNode.getDescription());
        }
        node.setResourceId(currentNode.getResourceId());
        if (currentNode.getText() != null) {
            node.setText(currentNode.getText());
        }
        node.setId(currentNode.getId());
        node.setXpath(currentNode.getXpath());
        node.setDepth(currentNode.getDepth());
        node.setNodeBound(currentNode.getNodeBound());

        // 查找辅助定位节点
        List<AbstractNodeTree> assistantChildren = findUsableChildNodes(currentNode);
        if (assistantChildren != null && assistantChildren.size() > 0) {
            List<OperationNode.AssistantNode> usableNodes = new ArrayList<>(assistantChildren.size());
            for (AbstractNodeTree child : assistantChildren) {
                usableNodes.add(new OperationNode.AssistantNode(StringUtil.toString(child.getClassName()),
                        StringUtil.toString(child.getResourceId()), StringUtil.toString(child.getText()),
                        StringUtil.toString(child.getDescription()), child.getDepth() - currentNode.getDepth()));
            }

            node.setAssistantNodes(usableNodes);
        }

        Map<String, String> extras = new HashMap<>();
        if (currentNode instanceof CaptureTree) {
            ((CaptureTree) currentNode).exportExtras(extras);
        }

        DisplayMetrics metrics = new DisplayMetrics();
        ((WindowManager) LauncherApplication.getInstance().getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRealMetrics(metrics);

        // 保留下原始尺寸信息
        extras.put(ORIGIN_SCREEN_SIZE, metrics.widthPixels + "," + metrics.heightPixels);

        // 截图信息保存至额外字段
        String capture = currentNode.getCapture();
        if (capture != null) {
            extras.put(CAPTURE_IMAGE_BASE64, capture);

            // 获取缩放分辨率
            int minEdge = Math.min(metrics.widthPixels, metrics.heightPixels);
            float scale = SPService.getInt(SPService.KEY_SCREENSHOT_RESOLUTION, 720) / (float) minEdge;
            // 不会大于1
            if (scale > 1) {
                scale = 1;
            }

            int realW = (int) (scale * metrics.widthPixels);
            int realH = (int) (scale * metrics.heightPixels);

            extras.put(CaptureTree.KEY_ORIGIN_SCREEN, realW + "," + realH);
        }

        if (extras.size() > 0) {
            node.setExtra(extras);
        }

        return node;
    }
}
