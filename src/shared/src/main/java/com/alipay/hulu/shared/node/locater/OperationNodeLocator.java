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

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.common.utils.patch.PatchLoadResult;
import com.alipay.hulu.shared.node.locater.comparator.ItemComparator;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.OperationNode;
import com.alipay.hulu.shared.node.tree.accessibility.tree.AccessibilityNodeTree;
import com.alipay.hulu.shared.node.tree.capture.CaptureTree;
import com.alipay.hulu.shared.node.tree.export.OperationStepExporter;
import com.alipay.hulu.shared.node.utils.AssetsManager;
import com.alipay.hulu.shared.node.utils.BitmapUtil;

import java.io.File;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

/**
 * Created by qiaoruikai on 2018/10/8 8:12 PM.
 */
public class OperationNodeLocator {
    private static final String TAG = "OperationNodeLocator";
    public static final String IMAGE_COMPARE_PATCH = "hulu_imageCompare";

    /**
     * 通过子节点查找
     */
    public static final int FLAG_CHILDNODE = 0x00000001;

    /**
     * 通过自身文本信息查找
     */
    public static final int FLAG_SELF = 0x00000010;

    /**
     * 通过XPATH查找
     */
    public static final int FLAG_XPATH = 0x00000100;

    /**
     * 通过ResourceId查找
     */
    public static final int FLAG_RESOURCE_ID = 0x00001000;

    /**
     * 通过父节点信息查找
     */
    public static final int FLAG_PARENT = 0x00010000;

    /**
     * 通过类名查找，目前仅对EditText才用这个
     */
    public static final int FLAG_CLASS_NAME = 0x00100000;

    /**
     * 通过类名查找，目前仅对WebView才用这个
     */
    public static final int FLAG_EXTRA = 0x01000000;

    /**
     * 通过文字查找
     */
    public static final int FLAG_TEXT = 0X10000000;

    public static AbstractNodeTree findAbstractNode(AbstractNodeTree root, OperationNode operationNode) {
        if (root == null) {
            return null;
        }

        // 对于Accessibility Node
        if (AccessibilityNodeTree.class.getSimpleName().equals(operationNode.getNodeType())) {
            int flags = OperationNodeLocator.FLAG_XPATH | OperationNodeLocator.FLAG_RESOURCE_ID |
                    OperationNodeLocator.FLAG_SELF | OperationNodeLocator.FLAG_EXTRA |
                    OperationNodeLocator.FLAG_TEXT | OperationNodeLocator.FLAG_CHILDNODE;
            // EditText可以通过ClassName查找
            if (StringUtil.equals(operationNode.getClassName(), "android.widget.EditText")) {
                flags |= FLAG_CLASS_NAME;
            }

            return OperationNodeLocator.findAbstractNode(root, operationNode, flags);
        } else if (CaptureTree.class.getSimpleName().equals(operationNode.getNodeType())) {
            if (!(root instanceof CaptureTree)) {
                return null;
            }
            return OperationNodeLocator.findNodeByCapture((CaptureTree) root, operationNode);
        } else {
            return OperationNodeLocator.findAbstractNode(root, operationNode,
                    OperationNodeLocator.FLAG_XPATH | OperationNodeLocator.FLAG_RESOURCE_ID |
                            OperationNodeLocator.FLAG_SELF | OperationNodeLocator.FLAG_EXTRA |
                            OperationNodeLocator.FLAG_CHILDNODE);
        }
    }

    /**
     * 通过图像查找
     *
     * @param root
     * @param node
     * @return
     */
    public static AbstractNodeTree findNodeByCapture(CaptureTree root, OperationNode node) {
        String queryBase64 = node.getExtraValue(OperationStepExporter.CAPTURE_IMAGE_BASE64);
        if (StringUtil.isEmpty(queryBase64)) {
            return null;
        }

        PatchLoadResult rs = ClassUtil.getPatchInfo(IMAGE_COMPARE_PATCH);
        if (rs == null) {
            // 加载
            rs = AssetsManager.loadPatchFromServer(IMAGE_COMPARE_PATCH);

            // 还没有，GG
            if (rs == null) {
                return null;
            }
        }

        int queryWidth = root.getScaleWidth();
        String screen = node.getExtraValue(CaptureTree.KEY_ORIGIN_SCREEN);
        String[] splitted = StringUtil.split(screen, ",");
        if (splitted != null && splitted.length == 2) {
            queryWidth = Integer.parseInt(splitted[0]);
        }

        Bitmap query = BitmapUtil.base64ToBitmap(queryBase64);
        Bitmap origin = root.getOriginScreen();

        Rect rect = findTargetRect(rs, query, queryWidth, origin);

        if (rect == null) {
            return null;
        }

        root.resizeTo(root.fromScaleToOrigin(rect));

        return root;
    }

    /**
     * 根据query图像查找目标Rect
     *
     * @param rs    插件
     * @param query query图像
     * @return
     */
    private static Rect findTargetRect(PatchLoadResult rs, Bitmap query, int queryScale, Bitmap screenshot) {
        if (query == null || screenshot == null) {
            return null;
        }

        // 截图查找
        final File target = new File(FileUtils.getSubDir("tmp"), "screenshot_" + System.currentTimeMillis() + ".png");

        int screenWidth = screenshot.getWidth();
        float scale = screenWidth / (float) queryScale;

        if (scale != 1F) {
            LogUtil.d(TAG, "缩放目标图片：%f", scale);
            // 缩放为同一比例
            query = Bitmap.createScaledBitmap(query, (int) (query.getWidth() * scale), (int) (query.getHeight() * scale), false);
        }

        try {
            Class<?> targetClass = ClassUtil.getClassByName(rs.entryClass);
            if (targetClass == null) {
                LogUtil.e(TAG, "插件类不存在");
                return null;
            }

            Method targetMethod = targetClass.getMethod(rs.entryMethod, Bitmap.class, Bitmap.class);
            if (targetMethod == null) {
                LogUtil.e(TAG, "插件目标方法不存在");
                return null;
            }

            float[] result = (float[]) targetMethod.invoke(null, query, screenshot);

            // 未能找到目标框
            if (result == null || result.length != 8) {
                LogUtil.e(TAG, "未能找到目标控件");
                return null;
            }

            int left = Integer.MAX_VALUE;
            int top = Integer.MAX_VALUE;
            int right = -1;
            int bottom = -1;

            // 可能存在目标点不是标准矩形，找上下左右最值点
            for (int i = 0; i < 8; i++) {
                if (i % 2 == 0) {
                    if (result[i] < left) {
                        left = (int) result[i];
                    }
                    if (result[i] > right) {
                        right = (int) result[i];
                    }
                } else {
                    if (result[i] < top) {
                        top = (int) result[i];
                    }

                    if (result[i] > bottom) {
                        bottom = (int) result[i];
                    }
                }
            }

            float targetWidth = right - left;
            float targetHeight = bottom - top;

            float widthRadio = targetWidth / query.getWidth();
            float heightRadio = targetHeight / query.getHeight();

            LogUtil.d(TAG, "原尺寸: %s, 查找尺寸: %s", query.getWidth() + "x" + query.getHeight(), targetWidth + "x" + targetHeight);

            // 差别过大，说明找错了，当做没找到
            if (widthRadio < 0.4 || widthRadio > 2 || heightRadio < 0.4 || heightRadio > 2) {
                LogUtil.w(TAG, "查找结果与原图尺寸差别过大，不可信");
                return null;
            }

            return new Rect(left, top, right, bottom);
        } catch (Exception e) {
            LogUtil.e(TAG, "Catch Exception: " + e.getMessage(), e);
            return null;
        } finally {
            if (target.exists()) {
                FileUtils.deleteFile(target);
            }
        }
    }


    /**
     * 查找AbstractNodeTree
     *
     * @param root          根节点
     * @param operationNode 记录
     * @return
     */
    public static AbstractNodeTree findAbstractNode(AbstractNodeTree root, final OperationNode operationNode, int findFlag) {

        RankedFindResult findResult = new RankedFindResult();

        List<AbstractNodeTree> result = null;

        LogUtil.i(TAG, "目标节点信息:%s", operationNode);

        // 优先根据子节点定位信息查找
        if ((findFlag & FLAG_CHILDNODE) == FLAG_CHILDNODE && operationNode.getAssistantNodes() != null && operationNode.getAssistantNodes().size() > 0) {
            LogUtil.d(TAG, "Start find child");

            for (final OperationNode.AssistantNode node : operationNode.getAssistantNodes()) {
                LogUtil.d(TAG, "子节点信息：" + node.toString());
                List<AbstractNodeTree> childNodes = findAbstractNodeBySomething(root, new ItemComparator<AbstractNodeTree>() {
                    @Override
                    public boolean isEqual(AbstractNodeTree item) {

                        // 包含子节点内容相同，resourceId相同，类名相同
                        boolean findFlag = StringUtil.equalsOrMatch(node.getClassName(), item.getClassName())
                                && StringUtil.equalsOrLeftBlank(node.getText(), item.getText())
                                && StringUtil.equalsOrLeftBlank(node.getDescription(), item.getDescription())
                                && StringUtil.equalsOrLeftBlank(node.getResourceId(), item.getResourceId());


                        // 还需要父节点结构相同
                        if (findFlag) {
                            AbstractNodeTree tmpNode = item;
                            for (int j = 0; j < node.getParentHeight(); j++) {
                                tmpNode = tmpNode.getParent();

                                if (tmpNode == null) {
                                    return false;
                                }
                            }

                            findFlag = StringUtil.equalsOrMatch(operationNode.getClassName(), tmpNode.getClassName());
                        }

                        return findFlag;
                    }
                });

                // 当子节点可以唯一确定父节点时，返回结果
                if (childNodes != null && childNodes.size() > 0) {
                    int findCount = 0;
                    for (AbstractNodeTree tmpNode : childNodes) {
                        AbstractNodeTree current = tmpNode;
                        for (int j = 0; j < node.getParentHeight(); j++) {
                            current = current.getParent();
                        }

                        // 每一个子节点都辅助定位下
                        if (StringUtil.equalsOrMatch(operationNode.getClassName(), current.getClassName())) {
                            findResult.addItem(current, 2);
                            findCount ++;
                        }
                    }
                    LogUtil.d(TAG, "Child node find %d items", findCount);
                }
            }
        }



        // 父节点Text和ResourceId定位
        if ((findFlag & FLAG_SELF) == FLAG_SELF && (!StringUtil.isEmpty(operationNode.getText()) || !StringUtil.isEmpty(operationNode.getDescription()))) {
            result = findAbstractNodeBySomething(root, new ItemComparator<AbstractNodeTree>() {
                @Override
                public boolean isEqual(AbstractNodeTree item) {
                    return StringUtil.equalsOrLeftBlank(operationNode.getText(), item.getText()) &&
                            StringUtil.equalsOrLeftBlank(operationNode.getDescription(), item.getDescription())
                            && StringUtil.equalsOrLeftBlank(operationNode.getResourceId(), item.getResourceId()) &&
                            StringUtil.equalsOrMatch(operationNode.getClassName(), item.getClassName());
                }
            });


            if (result != null && result.size() > 0) {
                findResult.addAllItem(result, 2);
                LogUtil.d(TAG, "Self find %d items", result.size());
            }
        }


        // 通过ResourceId查找
        if ((findFlag & FLAG_RESOURCE_ID) == FLAG_RESOURCE_ID && !StringUtil.isEmpty(operationNode.getResourceId())) {
            result = findAbstractNodeBySomething(root, new ItemComparator<AbstractNodeTree>() {
                @Override
                public boolean isEqual(AbstractNodeTree item) {
                    return StringUtil.equals(operationNode.getResourceId(), item.getResourceId());
                }
            });
            if (result != null && result.size() > 0) {
                findResult.addAllItem(result, 2);
                LogUtil.d(TAG, "ResourceId find %d items", result.size());
            }
        }


        // 通过Text查找
        if ((findFlag & FLAG_TEXT) == FLAG_TEXT && !(StringUtil.isEmpty(operationNode.getText())
                & StringUtil.isEmpty(operationNode.getDescription()))) {
            final String txt = StringUtil.isEmpty(operationNode.getText())? operationNode.getDescription(): operationNode.getText();
            result = findAbstractNodeBySomething(root, new ItemComparator<AbstractNodeTree>() {
                @Override
                public boolean isEqual(AbstractNodeTree item) {
                    // 通过文本查找
                    return StringUtil.equals(txt, item.getText())
                            || StringUtil.equals(txt, item.getDescription());
                }
            });
            if (result != null && result.size() > 0) {
                findResult.addAllItem(result, 2);
                LogUtil.d(TAG, "Text find %d items", result.size());
            }
        }

        // 通过Extra字段查找
        if ((findFlag & FLAG_EXTRA) == FLAG_EXTRA && operationNode.getExtra() != null && operationNode.getExtra().size() > 0) {
            result = findAbstractNodeBySomething(root, new ItemComparator<AbstractNodeTree>() {
                @Override
                public boolean isEqual(AbstractNodeTree item) {
                    int findCount = 0;
                    for (String key : operationNode.getExtra().keySet()) {
                        if (StringUtil.isEmpty(operationNode.getExtra().get(key))) {
                            continue;
                        }

                        if (!StringUtil.equals((String) item.getField(key), operationNode.getExtra().get(key))) {
                            return false;
                        }

                        findCount++;
                    }

                    return findCount > 0;
                }
            });
            if (result != null && result.size() > 0) {
                findResult.addAllItem(result, 2);
                LogUtil.d(TAG, "Extra find %d items", result.size());
            }
        }


        // 通过Xpath定位
        if ((findFlag & FLAG_XPATH) == FLAG_XPATH && !StringUtil.isEmpty(operationNode.getXpath())) {
            LogUtil.d(TAG, "Start Find Element at : " + operationNode.getXpath());

            result = XpathLocator.findNodeByXpath(operationNode.getXpath(), root);
            if (result != null && result.size() > 0) {
                findResult.addAllItem(result);
                LogUtil.d(TAG, "Xpath find %d items", result.size());
            }
        }



        if ((findFlag & FLAG_CLASS_NAME) == FLAG_CLASS_NAME && !StringUtil.isEmpty(operationNode.getClassName())) {
            result = findAbstractNodeBySomething(root, new ItemComparator<AbstractNodeTree>() {
                @Override
                public boolean isEqual(AbstractNodeTree item) {
                    return operationNode.getClassName() != null
                            && operationNode.getClassName().equals(item.getClassName());
                }
            });

            if (result != null && result.size() > 0) {
                findResult.addAllItem(result);
                LogUtil.d(TAG, "ClassName find %d items", result.size());
            }
        }

        AbstractNodeTree target = findResult.getTopResult(operationNode);
        LogUtil.d(TAG, "Find target node: %s", target);

        return target;
    }


    /**
     * 根据Text查找节点
     *
     * @param root
     * @param comparator 比较器
     * @return
     */
    public static List<AbstractNodeTree> findAbstractNodeBySomething(AbstractNodeTree root, ItemComparator<AbstractNodeTree> comparator) {
        List<AbstractNodeTree> result = new ArrayList<>();
        int count = 0;
        int findCount = 0;
        for (AbstractNodeTree tmpNode : root) {
            if (comparator.isEqual(tmpNode)) {
                result.add(tmpNode);
                findCount ++;
            }
            count ++;
        }

        LogUtil.d(TAG, "count: " + count + ", findCount: " + findCount);
        return result;
    }

    /**
     * 通过ResourceId查找控件
     * @param root
     * @param id
     * @return
     */
    public static AbstractNodeTree findAbstractNodeById(AbstractNodeTree root, final String id) {
        if (StringUtil.isEmpty(id)) {
            return null;
        }
        List<AbstractNodeTree> result = findAbstractNodeBySomething(root, new ItemComparator<AbstractNodeTree>() {
            @Override
            public boolean isEqual(AbstractNodeTree item) {
                return item != null && id.equals(item.getResourceId());
            }
        });

        if (result == null || result.size() <= 0) {
            return null;
        }

        return result.get(0);
    }

    /**
     * 基于文字查找
     * @param root
     * @param text
     * @return
     */
    public static AbstractNodeTree findAbstractNodeByText(AbstractNodeTree root, final String text) {
        if (StringUtil.isEmpty(text)) {
            return null;
        }
        List<AbstractNodeTree> result = findAbstractNodeBySomething(root, new ItemComparator<AbstractNodeTree>() {
            @Override
            public boolean isEqual(AbstractNodeTree item) {
                return item != null && StringUtil.equals(text, item.getText());
            }
        });

        if (result == null || result.size() <= 0) {
            return null;
        }

        return result.get(0);
    }

    /**
     * 判断是否包含文字
     * @param root
     * @param text
     * @return
     */
    public static AbstractNodeTree findAbstractNodeByContainsText(AbstractNodeTree root, final String text) {
        if (StringUtil.isEmpty(text)) {
            return null;
        }
        List<AbstractNodeTree> result = findAbstractNodeBySomething(root, new ItemComparator<AbstractNodeTree>() {
            @Override
            public boolean isEqual(AbstractNodeTree item) {
                return item != null && StringUtil.contains(item.getText(), text);
            }
        });

        if (result == null || result.size() <= 0) {
            return null;
        }

        return result.get(0);
    }

    /**
     * 结果计分统计
     */
    private static class RankedFindResult {
        private List<AbstractNodeTree> findResult;
        private List<Integer> findRank;

        RankedFindResult() {
            this.findResult = new ArrayList<>();
            this.findRank = new ArrayList<>();
        }

        /**
         * 批量添加结果项
         * @param nodes
         */
        void addAllItem(Collection<AbstractNodeTree> nodes) {
            for (AbstractNodeTree nodeTree: nodes) {
                addItem(nodeTree);
            }
        }

        /**
         * 批量添加结果项
         * @param nodes
         */
        void addAllItem(Collection<AbstractNodeTree> nodes, int score) {
            for (AbstractNodeTree nodeTree: nodes) {
                addItem(nodeTree, score);
            }
        }

        /**
         * 添加结果项
         * @param node
         */
        void addItem(AbstractNodeTree node) {
            addItem(node, 1);
        }

        void addItem(AbstractNodeTree node, int score) {
            int index = -1;
            if ((index = findResult.indexOf(node)) > -1) {
                findRank.set(index, findRank.get(index) + score);
            } else {
                findResult.add(node);
                findRank.add(score);
            }
        }

        AbstractNodeTree getTopResult(OperationNode node) {
            return getTopResult(1, node);
        }

        /**
         * 找到得分最高的结果
         * @return
         */
        AbstractNodeTree getTopResult(int filter, OperationNode target) {
            int maxRank = 0;
            List<Integer> maxPoses = new ArrayList<>();
            for (int i = 0; i < findResult.size(); i++) {
                if (findRank.get(i) > maxRank) {
                    maxPoses.clear();
                    maxRank = findRank.get(i);
                    maxPoses.add(i);
                } else if (findRank.get(i) == maxRank) {
                    maxPoses.add(i);
                }
            }

            LogUtil.d(TAG, "Max score %d", maxRank);

            if (maxPoses.size() > 0 && maxRank >= filter) {
                // 只找到一个，就直接返回
                if (maxPoses.size() == 1) {
                    return findResult.get(maxPoses.get(0));
                }


                // 找到多个，通过位置进行比较
                Rect bound = target.getNodeBound();

                // 录制时没有位置信息，只能返回原有的
                if (bound == null) {
                    return findResult.get(maxPoses.get(0));
                }

                String screenSize = target.getExtraValue(OperationStepExporter.ORIGIN_SCREEN_SIZE);
                if (StringUtil.isEmpty(screenSize)) {
                    return findResult.get(maxPoses.get(0));
                }
                String[] split = screenSize.split(",");
                int x = Integer.parseInt(split[0]);
                int y = Integer.parseInt(split[1]);
                float xP = bound.centerX() / (float) x;
                float yP = bound.centerY() / (float) y;

                List<Rect> rects = new ArrayList<>(maxPoses.size() + 1);
                for (int pos: maxPoses) {
                    rects.add(findResult.get(pos).getNodeBound());
                }

                DisplayMetrics metrics = new DisplayMetrics();
                ((WindowManager) LauncherApplication.getInstance().getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRealMetrics(metrics);

                // 根据位置进行打分
                double minScore = Double.MAX_VALUE;
                int pos = 0;
                for (int i = 0; i < rects.size(); i++) {
                    Rect rect = rects.get(i);
                    float dy = rect.centerY() / (float) metrics.heightPixels;
                    float dx = rect.centerX() / (float) metrics.widthPixels;

                    // 由两项得分确定，距离和面积差
                    double score = Math.pow(dx - xP, 2) + Math.pow(dy - yP, 2);                    if (score < minScore) {
                        minScore = score;
                        pos = i;
                    }
                }

                return findResult.get(maxPoses.get(pos));
            }

            return null;
        }

        /**
         * 清理数据
         */
        void clear() {
            findResult.clear();
            findRank.clear();
            findRank = null;
            findResult = null;
        }
    }
}
