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
package com.alipay.hulu.shared.node.tree.accessibility.tree;

import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.view.accessibility.AccessibilityNodeInfo;

import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.annotation.JSONField;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.OperationService;
import com.alipay.hulu.shared.node.action.OperationContext;
import com.alipay.hulu.shared.node.action.OperationExecutor;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.FakeNodeTree;
import com.alipay.hulu.shared.node.utils.NodeTreeUtil;

import java.util.concurrent.CountDownLatch;

/**
 * 构建Accessibility树

 */
public class AccessibilityNodeTree extends AbstractNodeTree {
    private static final String TAG = "AccessibilityTree";
    public static final int TYPE_VERTICAL_SCROLLABLE = 1;
    public static final int TYPE_HORIZONTAL_SCROLLABLE = 2;
    public static final int TYPE_NOT_SCROLLABLE = 0;


    // 当前节点
    private AccessibilityNodeInfo currentNode;

    private boolean isWebview;

    private boolean isScrollable;

    private boolean isClickable;
    private boolean isFocusable;

    private boolean isEditable;

    /**
     * 构造函数
     * @param currentNode
     * @param parentNode
     */
    public AccessibilityNodeTree(AccessibilityNodeInfo currentNode, AbstractNodeTree parentNode) {
        this.currentNode = currentNode;
        this.parent = parentNode;

        // 当节点信息不为空，初始化节点信息
        if (currentNode != null) {
            initAccessibilityNodeInfo(currentNode);
        }

        if (parentNode != null) {
            if (parentNode instanceof AccessibilityNodeTree) {
                this.isWebview = ((AccessibilityNodeTree) parentNode).isWebview || StringUtil.equals(className, "android.webkit.WebView");
            } else {
                this.isWebview = StringUtil.equals(className, "android.webkit.WebView");
            }

            // API 21，多窗口支持
            if (Build.VERSION.SDK_INT >= 21) {
                if (parentNode instanceof FakeNodeTree) {
                    this.drawingOrder = currentNode.getWindow().getLayer();
                }
            }
        }

        if (this.isWebview) {
            String content = StringUtil.isEmpty(text)? description : text;

            // 如果是WebView，将文字同时设置到text和description中做兼容
            this.text = StringUtil.nonNullString(content);
            this.description = StringUtil.nonNullString(content);
        }

        if (parent != null) {
            this.depth = parent.getDepth() + 1;
        } else {
            this.depth = 1;
        }
    }

    /**
     * 构造函数
     * @param currentNode
     * @param parentNode
     */
    public AccessibilityNodeTree(AccessibilityNodeInfo currentNode, AbstractNodeTree parentNode, String id) {
        this(currentNode, parentNode);
        this.id = StringUtil.nonNullString(id);
    }

    private void initAccessibilityNodeInfo(AccessibilityNodeInfo info) {
        this.className = StringUtil.nonNullString(info.getClassName());
        this.packageName = StringUtil.nonNullString(info.getPackageName());
        this.resourceId = info.getViewIdResourceName();
        this.text = StringUtil.nonNullString(info.getText());
        this.description = StringUtil.nonNullString(info.getContentDescription());
        Rect rect = new Rect();
        info.getBoundsInScreen(rect);
        this.nodeBound = rect;
        this.isScrollable = info.isScrollable();
        this.visible = rect.width() * rect.height() > 0;//info.isVisibleToUser();
        this.isClickable = info.isClickable();
        this.isFocusable = info.isFocusable();
        this.isEditable = info.isEditable();
    }

    public int getScrollType() {
        if (isWebview || (getClassName() != null
                && (getClassName().contains("ScrollView")
                || getClassName().contains("ListView")
                || getClassName().contains("RecyclerView")))) {
            return TYPE_VERTICAL_SCROLLABLE;
        } else if (isScrollable) {
            //fixme 暂不考虑横向的RecyclerView
            return TYPE_HORIZONTAL_SCROLLABLE;
        }

        for (AbstractNodeTree child: getChildrenNodes()) {
            if (!(child instanceof AccessibilityNodeTree)) {
                break;
            }

            int scrollType = ((AccessibilityNodeTree)child).getScrollType();
            if (scrollType > 0) {
                return scrollType;
            }
        }

        return TYPE_NOT_SCROLLABLE;
    }

    @JSONField(serialize = false)
    public AccessibilityNodeInfo getCurrentNode() {
        return currentNode;
    }

    public void setCurrentNode(AccessibilityNodeInfo currentNode) {
        this.currentNode = currentNode;
    }

    public boolean isWebview() {
        return isWebview;
    }

    public void setWebview(boolean webview) {
        isWebview = webview;
    }

    public boolean isEditable() {
        return isEditable;
    }

    public void setEditable(boolean editable) {
        isEditable = editable;
    }

    @Override
    public boolean equals(Object obj) {
        return obj instanceof AccessibilityNodeTree  && (StringUtil.equals(id, ((AccessibilityNodeTree) obj).getId()) || this == obj);
    }

    @Override
    public int performAction(OperationMethod method, OperationContext opContext) {
        PerformActionEnum action = method.getActionEnum();
        switch (action) {
            case INPUT:
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    try {
                        performInputByAccessibility(method.getParam(OperationExecutor.INPUT_TEXT_KEY), opContext);
                    } catch (IllegalStateException e) {
                        return super.performAction(method, opContext);
                    }
                } else {
                    return super.performAction(method, opContext);
                }
                return 0;
            case FOCUS:
                currentNode.performAction(AccessibilityNodeInfo.ACTION_FOCUS, null);
                return 0;
        }

        return super.performAction(method, opContext);
    }

    @Override
    public boolean canDoAction(PerformActionEnum action) {
        // 不可见，返回false
        if (!visible) {
            return false;
        }

        if (action == PerformActionEnum.INPUT) {
            return isEditable;
        }

        if (action == PerformActionEnum.FOCUS) {
            return isFocusable;
        }

        return true;
    }

    @Override
    public String getXpath() {
        // 优先使用已构建过的Xpath
        if (this.xpath != null) {
            return this.xpath;
        }

        String xpath;
        // 先构建父节点Xpath
        if (this.parent == null || parent instanceof FakeNodeTree) {
            xpath = "/";
        } else {
            xpath = this.parent.getXpath() + "/";
        }

        // 添加当前节点的Class信息
        xpath += this.className;

        // 查找在父节点中的位置，如果有顺序，添加位置信息
        Integer idx = NodeTreeUtil.findIndexInParent(this);
        if (idx != null) {
            xpath += "[" + idx + "]";
        }

        // 缓存当前构建的节点信息
        this.xpath = xpath;

        return xpath;
    }

    /**
     * 执行输入操作
     * @param content
     * @param opContext
     */
    public void performInputByAccessibility(final String content, final OperationContext opContext) throws IllegalStateException {
        try {
            Bundle textData = new Bundle();
            textData.putString(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, content);
            currentNode.performAction(AccessibilityNodeInfo.ACTION_FOCUS, null);
            currentNode.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, textData);
            MiscUtil.sleep(500);
            opContext.notifyOnFinish(new Runnable() {
                @Override
                public void run() {
                    waitInputMethodHide();
                }
            });
        } catch (IllegalStateException e) {
            LogUtil.e(TAG, "Node recycled", e);
            throw e;
        }
    }

    @Override
    protected void recycleSelf() {
        // 需要将Accessibility节点回收下
        if (currentNode != null) {
            currentNode.recycle();
        }
    }

    /**
     * 打印结构
     * @param builder
     */
    public StringBuilder printTrace(StringBuilder builder) {
        for (int i = 1; i < depth; i++) {
            builder.append("  ");
        }
        builder.append("Depth[").append(depth)
                .append("],Node[").append(className)
                .append("],Bound[").append(nodeBound)
                .append("],Text[").append(text)
                .append("],Description[").append(description)
                .append("],Resource[").append(resourceId)
                .append("],ChildCount[").append(childrenNodes == null? 0: childrenNodes.size())
                .append("],Id[").append(id).append("]\n");
        if (childrenNodes != null) {
            for (AbstractNodeTree child : getChildrenNodes()) {
                child.printTrace(builder);
            }
        }
        return builder;
    }

    @Override
    public JSONObject exportToJsonObject() {
        JSONObject obj = super.exportToJsonObject();
        obj.put("isWebView", isWebview);
        obj.put("isClickable", isClickable);
        obj.put("isEditable", isEditable);
        obj.put("isFocusable", isFocusable);
        obj.put("isScrollable", isScrollable);
        return obj;
    }

    public boolean isSelfUsableForLocating() {
        return visible;
    }

    public boolean isScrollable() {
        return isScrollable;
    }

    public void setScrollable(boolean scrollable) {
        isScrollable = scrollable;
    }

    public boolean isClickable() {
        return isClickable;
    }

    public void setClickable(boolean clickable) {
        isClickable = clickable;
    }

    public boolean isFocusable() {
        return isFocusable;
    }

    public void setFocusable(boolean focusable) {
        isFocusable = focusable;
    }

    @Override
    public String toString() {
        return "AccessibilityNodeTree{" +
                "parent=" + (parent == null ? null : parent.getClassName()) +
                ", childrenNodeCount=" + (getChildrenNodes() == null ? 0 : getChildrenNodes().size()) +
                ", id=" + id +
                ", xpath='" + StringUtil.hide(xpath) + '\'' +
                ", text='" + StringUtil.hide(text) + '\'' +
                ", description='" + StringUtil.hide(description) + '\'' +
                ", depth=" + depth +
                ", className=" + className +
                ", packageName=" + StringUtil.hide(packageName) +
                ", bounds=" + (nodeBound == null ? null : nodeBound.toShortString()) +
                ", resourceId='" + StringUtil.hide(resourceId) + '\'' +
                '}';
    }
}
