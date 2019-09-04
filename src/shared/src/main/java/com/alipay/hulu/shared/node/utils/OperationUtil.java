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
package com.alipay.hulu.shared.node.utils;

import android.graphics.Rect;

import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.DeviceInfoUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.OperationService;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.locater.OperationNodeLocator;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.OperationNode;
import com.alipay.hulu.shared.node.tree.capture.CaptureTree;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 节点工具
 * Created by cathor on 2017/12/13.
 */
public class OperationUtil {

    private static final String TAG = "OperationUtil";

    private static final Map<CharSequence, Integer> alertContentMap;

    public static final int MAX_CONTENT_PRIORITY = Integer.MAX_VALUE;

    static {

        //Map中的Integer代表优先级，值越小优先级越高
        Map<CharSequence, Integer> map = new HashMap<>();
        map.put("打开", 0);
        map.put("打开应用", 0);
        map.put("同意并安装", 0);
        map.put("下一步", 0);
        map.put("允许", 1);
        map.put("始终允许", 1);
        map.put("总是允许", 1);
        map.put("安装", 1);
        map.put("重新安装", 1);
        map.put("继续安装", 1);
        map.put("继续安装旧版本", 1);
        map.put("我已充分了解该风险，继续安装", 1);
        map.put("允许本次安装", 1);
        map.put("同意", 1);
        map.put("立即切换", 1);
        map.put("好", 2);
        map.put("好的", 2);
        map.put("确认", 2);
        map.put("确定", 2);
        map.put("完成", 2);
        map.put("验证", 2);
        map.put("忽略", 3);
        map.put("稍候再说", 3);
        map.put("下次再说", 3);
        map.put("稍后再说", 3);
        map.put("以后再说", 3);
        map.put("稍后提醒", 3);
        map.put("知道了", 4);
        map.put("我知道了", 4);
        map.put("朕知道了", 4);
        map.put("我知道啦", 4);
        map.put("立即删除", 5);
        map.put("清除", 5);
        map.put("立即清理", 6);
        map.put("忽略风险", 7);
        alertContentMap = Collections.unmodifiableMap(map);
    }


    public static boolean isInAlertDict(CharSequence charSequence) {
        if (StringUtil.isEmpty(charSequence)) {
            return false;
        }

        for (CharSequence content : alertContentMap.keySet()) {
            if (StringUtil.equals(content, charSequence)) {
                return true;
            }
        }

        return false;
    }

    public static int getContentPriority(CharSequence charSequence) {
        if (StringUtil.isEmpty(charSequence)) {
            return MAX_CONTENT_PRIORITY;
        }

        for (CharSequence content : alertContentMap.keySet()) {
            if (StringUtil.equals(content, charSequence)) {
                return alertContentMap.get(content);
            }
        }

        return MAX_CONTENT_PRIORITY;
    }


    /**
     * 滑动控件到屏幕内
     * @param node
     * @param service
     * @return
     */
    public static AbstractNodeTree scrollToScreen(OperationNode node, OperationService service) {
        try {

            // 先查询记录的节点
            AbstractNodeTree operationNode;
            int pos = 0;

            int scrollCount = 0;
            do {
                AbstractNodeTree tmpRoot = service.getCurrentRoot();
                operationNode = OperationNodeLocator.findAbstractNode(tmpRoot, node);

                // 查询为空，未找到
                if (operationNode == null) {
                    LogUtil.w(TAG, "查找控件【%s】失败", node);
                    return null;
                }

                // CaptureTree直接结束
                if (!(operationNode instanceof CaptureTree)) {
                    // 判断下是否在屏幕内
                    Rect bound = operationNode.getNodeBound();
                    LogUtil.d(TAG, "控件空间属性：%s, 屏幕属性：%s",  bound, DeviceInfoUtil.realScreenSize);
                    if (bound.top <= 0 && bound.bottom <= 0) {
                        service.doSomeAction(new OperationMethod(PerformActionEnum.GLOBAL_SCROLL_TO_BOTTOM), null);
                        MiscUtil.sleep(2500);
                        scrollCount ++;
                    } else if (bound.top >= DeviceInfoUtil.realScreenSize.y) {
                        service.doSomeAction(new OperationMethod(PerformActionEnum.GLOBAL_SCROLL_TO_TOP), null);
                        MiscUtil.sleep(2500);
                        scrollCount ++;
                    } else if (bound.centerX() <= 0) {
                        service.doSomeAction(new OperationMethod(PerformActionEnum.GLOBAL_SCROLL_TO_RIGHT), null);
                        MiscUtil.sleep(2500);
                        scrollCount ++;
                    } else if (bound.centerX() >= DeviceInfoUtil.realScreenSize.x) {
                        service.doSomeAction(new OperationMethod(PerformActionEnum.GLOBAL_SCROLL_TO_LEFT), null);
                        MiscUtil.sleep(2500);
                        scrollCount ++;
                    } else {
                        pos = 1;
                    }
                } else {
                    pos = 1;
                }

            } while (pos != 1 && scrollCount < 3);

            LogUtil.d(TAG, "找到节点: " + operationNode);
            return operationNode;
        } catch (Exception e) {
            LogUtil.e(TAG, e, "节点查找失败，节点: %s", node);
            return null;
        }
    }

    public static void sleepUntilTargetActivitiesShown(String... targetActivities) {
        if (targetActivities == null || targetActivities.length == 0) {
            return;
        }
        String curActivity = "";
        long start = System.currentTimeMillis();
        while (!isCurActivityInTargetArray(curActivity, targetActivities) && System.currentTimeMillis() - start < 60*1000) {
            MiscUtil.sleep(5000);
            curActivity = CmdTools.getTopActivity();
        }
    }

    private static boolean isCurActivityInTargetArray(String curActivity, String... targetActivities) {
        if (targetActivities == null || targetActivities.length == 0 || curActivity == null) {
            return false;
        }
        for (String activity : targetActivities) {
            if (curActivity.contains(activity)) {
                return true;
            }
        }
        return false;
    }

    public static AbstractNodeTree findAbstractNode(OperationNode node, OperationService service) {
        return findAbstractNode(node, service,  null);
    }

    /**
     * 查找控件
     * @param node
     * @param service
     * @return
     */
    public static AbstractNodeTree findAbstractNode(OperationNode node, OperationService service, List<String> prepareActions) {

        AbstractNodeTree tmpRoot = null;
        try {
            tmpRoot = service.getCurrentRoot();
        } catch (Exception e) {
            LogUtil.e(TAG, "Catch Exception: " + e.getMessage(), e);
        }

        // 拿不到root
        if (tmpRoot == null) {
            return null;
        }

        AbstractNodeTree targetNode = null;

        // 两次处理弹窗
        int maxCount = 2;
        while (maxCount > 0) {
            targetNode = scrollToScreen(node, service);
            maxCount--;

            // 找不到，先处理下弹窗
            if (targetNode == null) {
                long startTime = System.currentTimeMillis();
                service.doSomeAction(new OperationMethod(PerformActionEnum.HANDLE_ALERT), null);

                if (prepareActions != null) {
                    prepareActions.add(PerformActionEnum.HANDLE_ALERT.getDesc());
                }

                // 没有实际处理掉弹窗
                if (System.currentTimeMillis() - startTime < 1500) {
                    break;
                }
            } else {
                break;
            }

//            MiscUtil.sleep(1500);
            service.invalidRoot();
        }

        // 上滑刷新两次
        maxCount = 2;
        while (targetNode == null && maxCount > 0) {
            targetNode = scrollToScreen(node, service);
            maxCount--;

            // 找不到，先向上滑刷新
            if (targetNode == null) {
                service.doSomeAction(new OperationMethod(PerformActionEnum.GLOBAL_SCROLL_TO_BOTTOM), null);

                if (prepareActions != null) {
                    prepareActions.add(PerformActionEnum.GLOBAL_SCROLL_TO_BOTTOM.getDesc());
                }
            } else {
                break;
            }

            MiscUtil.sleep(1500);
            service.invalidRoot();
        }


        // 下滑查找四次
        maxCount = 4;
        while (targetNode == null && maxCount > 0) {
            targetNode = scrollToScreen(node, service);
            maxCount--;

            if (targetNode == null) {
                service.doSomeAction(new OperationMethod(PerformActionEnum.GLOBAL_SCROLL_TO_TOP), null);

                if (prepareActions != null) {
                    prepareActions.add(PerformActionEnum.GLOBAL_SCROLL_TO_TOP.getDesc());
                }
            } else {
                break;
            }

            MiscUtil.sleep(1500);
            service.invalidRoot();
        }

        return targetNode;
    }

    /**
     * 查找控件
     * @param node
     * @param service
     * @return
     */
    public static AbstractNodeTree findAbstractNodeWithoutScroll(OperationNode node, OperationService service, List<String> prepareActions) {

        AbstractNodeTree tmpRoot = null;
        try {
            tmpRoot = service.getCurrentRoot();
        } catch (Exception e) {
            e.printStackTrace();
        }

        // 拿不到root
        if (tmpRoot == null) {
            return null;
        }

        AbstractNodeTree targetNode = null;

        // 两次处理弹窗
        int maxCount = 2;
        while (targetNode == null && maxCount > 0) {
            targetNode = scrollToScreen(node, service);
            maxCount--;

            // 找不到，先处理下弹窗
            if (targetNode == null) {
                long startTime = System.currentTimeMillis();
                service.doSomeAction(new OperationMethod(PerformActionEnum.HANDLE_ALERT), null);

                if (prepareActions != null) {
                    prepareActions.add(PerformActionEnum.HANDLE_ALERT.getDesc());
                }

                // 没有实际处理弹窗
                if (System.currentTimeMillis() - startTime < 1500) {
                    break;
                }
            } else {
                break;
            }

            // 不需要Sleep，处理弹窗时已经sleep过了
//            MiscUtil.sleep(1500);
            service.invalidRoot();
        }

        return targetNode;
    }
}
