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
package com.alipay.hulu.shared.node.tree;


import android.graphics.Rect;

import androidx.annotation.NonNull;

import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.action.OperationContext;
import com.alipay.hulu.shared.node.action.OperationExecutor;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.utils.NodeTreeUtil;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedList;
import java.util.List;
import java.util.Queue;

/**
 * 抽象节点树
 */
public abstract class AbstractNodeTree implements Iterable<AbstractNodeTree> {
    private static final String TAG = "AbstractNodeTree";

    /**
     * 子节点
     */
    protected List<AbstractNodeTree> childrenNodes;

    /**
     * 父节点
     */
    protected AbstractNodeTree parent;

    /**
     * 包名
     */
    protected String packageName = "";

    /**
     * 类名
     */
    protected String className = "";

    /**
     * xpath
     */
    protected String xpath = null;

    /**
     * ID
     */
    protected String id = "";

    /**
     * 边界Rect
     */
    protected Rect nodeBound;

    /**
     * 资源ID
     */
    protected String resourceId = "";

    /**
     * 深度
     */
    protected int depth;

    /**
     * 文字
     */
    protected String text = "";

    /**
     * 绘制顺序
     */
    protected int drawingOrder;

    /**
     * 描述
     */
    protected String description = "";

    /**
     * 可见性
     */
    protected boolean visible;

    /**
     * 顺序
     */
    protected int index;

    /**
     * 截图
     */
    protected String capture;

    /**
     * 是否能够执行操作
     * @param action 操作类型
     * @return
     */
    public abstract boolean canDoAction(PerformActionEnum action);

    /**
     * 执行操作
     * @param method 操作方法
     * @param context 执行上下文
     * @return
     */
    public int performAction(OperationMethod method, final OperationContext context) {
        final Rect rect = getNodeBound();
        int x = rect.centerX();
        int y = rect.centerY();
        int width = rect.width();
        int height = rect.height();

        int screenWidth = context.screenWidth;
        int screenHeight = context.screenHeight;

        // 如果包含局部坐标
        if (method.containsParam(OperationExecutor.LOCAL_CLICK_POS_KEY)) {
            String[] origin = method.getParam(OperationExecutor.LOCAL_CLICK_POS_KEY).split(",");

            // 计算特定坐标
            if (origin.length == 2) {
                float factorX = Float.parseFloat(origin[0]);
                float factorY = Float.parseFloat(origin[1]);
                x = (int) (rect.left + factorX * rect.width());
                y = (int) (rect.top + factorY * rect.height());
            }
        }
        final int finalX = x;
        final int finalY = y;

        PerformActionEnum action = method.getActionEnum();

        switch (action) {
            case LONG_CLICK:
                // 如果有配置长按时间信息
                String longClickTime = method.getParam(OperationExecutor.INPUT_TEXT_KEY);
                int clickDuration = 2000;
                if (StringUtil.isNumeric(longClickTime)) {
                    clickDuration = Integer.parseInt(longClickTime);
                }

                final int finalClickDuration = clickDuration;
                context.notifyOnFinish(new Runnable() {
                    @Override
                    public void run() {
                        context.executor.executePress(finalX, finalY, finalClickDuration);
                    }
                });
                return 1;
//                break;
            case ASSERT:
                LogUtil.i(TAG, "Start Assert");
                return NodeTreeUtil.performAssertAction(this, method)? 0: -1;
            case CLICK:
            case CLICK_IF_EXISTS:
            case CLICK_QUICK:
                LogUtil.i(TAG, "Start ADB click " + x + "," + y);
                context.executor.executeClick(x, y);
                break;
            case CLICK_AND_INPUT:
                final String input = method.getParam(OperationExecutor.INPUT_TEXT_KEY);
                if (StringUtil.isEmpty(input)) {
                    break;
                }
                context.notifyOnFinish(new Runnable() {
                    @Override
                    public void run() {
                        context.keyBoard.inputText(input, finalX, finalY);
                    }
                });
                return 1;
            case INPUT_SEARCH:
                final String text = method.getParam(OperationExecutor.INPUT_TEXT_KEY);
                context.notifyOnFinish(new Runnable() {
                    @Override
                    public void run() {
                        context.keyBoard.inputTextSearch(text, finalX, finalY);
                    }
                });
                return 1;
            case MULTI_CLICK:
                LogUtil.w(TAG, "Start ADB multi click " + x + "," + y);
                String clickText = method.getParam(OperationExecutor.INPUT_TEXT_KEY);
                final int clickTime;
                try {
                    clickTime = Integer.parseInt(clickText);
                    // 数量小于一，无法执行
                    if (clickTime < 1) {
                        return -1;
                    }
                } catch (NumberFormatException e) {
                    LogUtil.e(TAG, e, "无法解析文字【%s】为数字", clickText);
                    return -1;
                }

                // 通过&实现短时间内多次点击
                context.notifyOnFinish(new Runnable() {
                    @Override
                    public void run() {
                        for (int i = 0; i < clickTime; i++) {
                            context.executor.executeClickAsync(finalX, finalY);
                            MiscUtil.sleep(100);
                        }
                    }
                });
                return 1;
            case SCROLL_TO_TOP:
            case SCROLL_TO_BOTTOM:
            case SCROLL_TO_LEFT:
            case SCROLL_TO_RIGHT:
                LogUtil.i(TAG, "Start ADB scroll " + x + "," + y);
                int fromY = y;
                int fromX = x;
                if (fromY > screenHeight - 40) {
                    fromY = screenHeight - 40;
                }
                if (fromY < 40) {
                    fromY = 40;
                }
                if (fromX < 10) {
                    fromX = 10;
                }
                if (fromX > screenWidth - 10) {
                    fromX = screenWidth - 10;
                }

                int toX = fromX, toY  = fromY;

                float scrollPercent = 1F;
                if (method.containsParam(OperationExecutor.INPUT_TEXT_KEY)) {
                    String content = method.getParam(OperationExecutor.INPUT_TEXT_KEY);
                    if (!StringUtil.isEmpty(content)) {
                        try {
                            scrollPercent = Integer.parseInt(content) / 100f;
                        } catch (NumberFormatException e) {
                            LogUtil.e(TAG, "Content %s is not integer", content);
                        }
                    }
                }
                if (action == PerformActionEnum.SCROLL_TO_BOTTOM || action == PerformActionEnum.SCROLL_TO_TOP) {
                    int scroll = (int) (scrollPercent * height);
                    if (action == PerformActionEnum.SCROLL_TO_TOP) {
                        toY = fromY - scroll;
                    } else {
                        toY = fromY + scroll;
                    }
                } else {
                    int scroll = (int) (scrollPercent * width);
                    if (action == PerformActionEnum.SCROLL_TO_LEFT) {
                        toX = fromX - scroll;
                    } else {
                        toX = fromX + scroll;
                    }
                }

                if (toY > screenHeight - 40) {
                    toY = screenHeight - 40;
                }
                if (toY < 40) {
                    toY = 40;
                }
                if (toX < 10) {
                    toX = 10;
                }
                if (toX > screenWidth - 10) {
                    toX = screenWidth - 10;
                }
                final int fx = fromX, fy = fromY, tx = toX, ty = toY;
                context.notifyOnFinish(new Runnable() {
                    @Override
                    public void run() {
                        context.executor.executeScroll(fx, fy, tx, ty, 300);;
                    }
                });
                return 1;
            case INPUT:
                final String inputText = method.getParam(OperationExecutor.INPUT_TEXT_KEY);
                if (StringUtil.isEmpty(inputText)) {
                    return -1;
                }
                context.notifyOnFinish(new Runnable() {
                    @Override
                    public void run() {
                        context.keyBoard.inputText(inputText, finalX, finalY);
                        waitInputMethodHide();
                    }
                });
                return 1;
        }

        return 0;
    }

    /**
     * 获取根节点
     * @return
     */
    public AbstractNodeTree getRoot() {
        if (this.parent == null) {
            return this;
        }

        return this.parent.getRoot();
    }

    /**
     * 是否属于父节点
     * @param nodeTree
     * @return
     */
    public boolean hasParent(AbstractNodeTree nodeTree) {
        if (parent == null) {
            return false;
        }

        if (parent == nodeTree) {
            return true;
        }

        return parent.hasParent(nodeTree);
    }

    /**
     * 打印树结构
     * @param builder
     * @return
     */
    public abstract StringBuilder printTrace(StringBuilder builder);


    /**
     * 打印树结构
     * @return
     */
    public JSONObject exportToJsonObject() {
        JSONObject obj = new JSONObject();
        obj.put("depth", depth);
        obj.put("className", className);
        obj.put("nodeBound", nodeBound);
        obj.put("text", text);
        obj.put("description", description);
        obj.put("resourceId", resourceId);
        obj.put("id", id);
        obj.put("packageName", packageName);
        obj.put("visible", visible);
        obj.put("type", getClass().getSimpleName());

        if (childrenNodes != null) {
            List<JSONObject> children = new ArrayList<>(childrenNodes.size() + 1);
            for (AbstractNodeTree child : getChildrenNodes()) {
                JSONObject childObj = child.exportToJsonObject();
                if (childObj != null) {
                    children.add(childObj);
                }
            }
            obj.put("children", children);
        }

        return obj;
    }

    /**
     * 自身是否可用于辅助定位
     * @return
     */
    public abstract boolean isSelfUsableForLocating();

    /**
     * 获取字段
     * @param key
     * @return
     */
    public Object getField(String key) {
        if (StringUtil.isEmpty(key)) {
            return null;
        }
        try {
            List<Method> allMethods = ClassUtil.getAllMethods(getClass());
            String methodName = "get" + key.substring(0, 1).toUpperCase() + key.substring(1);

            // 查找该方法
            Method targetMethod = null;
            for (Method method: allMethods) {
                if (StringUtil.equals(methodName, method.getName())) {
                    targetMethod = method;
                }
            }

            // 如果未找到该方法
            if (targetMethod == null) {
                return null;
            }

            if (!targetMethod.isAccessible()) {
                targetMethod.setAccessible(true);
            }
            return targetMethod.invoke(this);
        } catch (IllegalAccessException e) {
            LogUtil.e(TAG, "Catch java.lang.IllegalAccessException: " + e.getMessage(), e);
        } catch (InvocationTargetException e) {
            LogUtil.e(TAG, "Catch java.lang.reflect.InvocationTargetException: " + e.getMessage(), e);
        }

        return null;
    }

    public void addChildNode(AbstractNodeTree child) {
        if (this.childrenNodes == null) {
            this.childrenNodes = new ArrayList<>();
        }

        childrenNodes.add(child);
    }

    public void setChildrenNodes(List<AbstractNodeTree> children) {
        this.childrenNodes = children;
    }

    public void setParent(AbstractNodeTree parent) {
        this.parent = parent;
    }

    public List<AbstractNodeTree> getChildrenNodes() {
        return childrenNodes;
    }

    public AbstractNodeTree getParent() {
        return parent;
    }

    public String getPackageName() {
        return packageName;
    }

    public void setPackageName(String packageName) {
        this.packageName = StringUtil.nonNullString(packageName);
    }

    public String getClassName() {
        return className;
    }

    public void setClassName(String className) {
        this.className = StringUtil.nonNullString(className);
    }

    public String getXpath() {
        return xpath;
    }

    public void setXpath(String xpath) {
        this.xpath = StringUtil.nonNullString(xpath);
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public Rect getNodeBound() {
        return nodeBound;
    }

    public void setNodeBound(Rect nodeBound) {
        this.nodeBound = nodeBound;
    }

    public String getResourceId() {
        return resourceId;
    }

    public void setResourceId(String resourceId) {
        this.resourceId = StringUtil.nonNullString(resourceId);
    }

    public int getDepth() {
        return depth;
    }

    public void setDepth(int depth) {
        this.depth = depth;
    }

    public String getText() {
        return text;
    }

    public void setText(String text) {
        this.text = StringUtil.nonNullString(text);
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = StringUtil.nonNullString(description);
    }

    public boolean isVisible() {
        return visible;
    }

    public void setVisible(boolean visible) {
        this.visible = visible;
    }

    public int getIndex() {
        return index;
    }

    public void setIndex(int index) {
        this.index = index;
    }

    public int getDrawingOrder() {
        return drawingOrder;
    }

    public void setDrawingOrder(int drawingOrder) {
        this.drawingOrder = drawingOrder;
    }

    public String getCapture() {
        return capture;
    }

    public void setCapture(String capture) {
        this.capture = capture;
    }

    /**
     * 回收自身信息
     */
    protected void recycleSelf() {

    }

    /**
     * 回收资源
     */
    public final void recycle() {
        // 先回收自身
        recycleSelf();

        // 回收子节点
        if (childrenNodes != null && childrenNodes.size() > 0) {
            for (AbstractNodeTree child : childrenNodes) {
                child.recycle();
            }
        }
    }

    /**
     * 等待输入法隐藏
     * No use since input method has been changed to soloPi input
     */
    protected void waitInputMethodHide() {
        MiscUtil.sleep(500);
    }

    @NonNull
    @Override
    public Iterator<AbstractNodeTree> iterator() {
        return new MIterator(this);
    }

    public static class MIterator implements Iterator<AbstractNodeTree> {
        private static final String TAG = "MIterator";
        private Queue<AbstractNodeTree> mQueue;

        private MIterator(AbstractNodeTree root) {
            mQueue = new LinkedList<>();

            Queue<AbstractNodeTree> tmpQueue = new LinkedList<>();
            tmpQueue.add(root);
            AbstractNodeTree current = null;

            while ((current = tmpQueue.poll()) != null) {
                mQueue.add(current);
                if (current.getChildrenNodes() != null && current.getChildrenNodes().size() > 0) {
                    tmpQueue.addAll(current.getChildrenNodes());
                }
            }
        }

        @Override
        public boolean hasNext() {
            return !mQueue.isEmpty();
        }

        @Override
        public AbstractNodeTree next() {
            return mQueue.poll();
        }

        @Override
        public void remove() {
            LogUtil.d(TAG, "no use");
        }
    }
}
