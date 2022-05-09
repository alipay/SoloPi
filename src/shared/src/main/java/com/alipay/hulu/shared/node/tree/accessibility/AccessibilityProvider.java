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

import android.accessibilityservice.AccessibilityService;
import android.graphics.Rect;
import android.os.Build;
import android.util.Pair;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.R;
import com.alipay.hulu.shared.event.accessibility.AccessibilityServiceImpl;
import com.alipay.hulu.shared.node.AbstractProvider;
import com.alipay.hulu.shared.node.action.Constant;
import com.alipay.hulu.shared.node.tree.FakeNodeTree;
import com.alipay.hulu.shared.node.tree.InputWindowTree;
import com.alipay.hulu.shared.node.tree.MetaTree;
import com.alipay.hulu.shared.node.tree.annotation.NodeProvider;
import com.alipay.hulu.shared.node.utils.NodeContext;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.LinkedList;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static com.alipay.hulu.common.utils.activity.PermissionDialogActivity.cleanInstrumentationAndUiAutomator;

/**
 * Created by qiaoruikai on 2018/10/8 12:46 PM.
 */
@NodeProvider(dataType = AccessibilityNodeInfo.class)
public class AccessibilityProvider implements AbstractProvider {
    private static final String TAG = "AccessibilityProvider";
    private WeakReference<AccessibilityService> accessibilityServiceRef;

    /**
     * WebView重载标记
     */
    private boolean reloadFlag = false;

    @Subscriber(@Param(SubscribeParamEnum.ACCESSIBILITY_SERVICE))
    public void setAccessibilityService(AccessibilityService accessibilityService) {
        this.accessibilityServiceRef = new WeakReference<>(accessibilityService);
    }

    public boolean onStart() {
        LogUtil.d(TAG, "AccessibilityProvider初始化");
        InjectorService service = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
        service.register(this);
        return true;
    }

    /**
     * 检查前台activity可访问行
     */
    private void checkFrontActivityAccessibility() {
        AccessibilityService service = accessibilityServiceRef.get();
        if (service == null) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            // 必须要能拿到顶层应用
            boolean waitToFind = false;
            String topPkg = null;
            String[] pkgAndActivity = CmdTools.getTopPkgAndActivity();
            if (pkgAndActivity == null) {
                return;
            }

            topPkg = pkgAndActivity[0];
            waitToFind = true;
            LogUtil.i(TAG, "目标检查窗口:" + topPkg);

            List<AccessibilityWindowInfo> windowInfos = service.getWindows();
            for (AccessibilityWindowInfo win : windowInfos) {
                AccessibilityNodeInfo root = win.getRoot();

                // 不包含子节点，直接跳过
                if (root == null) {
                    continue;
                }

                LogUtil.i(TAG, "当前访问窗口:" + root.getPackageName());

                // 是否能够找到目标应用
                if (StringUtil.contains(root.getPackageName(), topPkg)) {
                    waitToFind = false;
                    break;
                }
            }

            // 如果找不到顶层Activity所在window，说明当前AccessibilityService有问题，重启一下
            if (waitToFind) {
                simpleRestartAccessibilityService();
            }
        } else {
            // 如果获取ActiveWindow失败，也进行重启
            if (service.getRootInActiveWindow() == null) {
                simpleRestartAccessibilityService();
            }
        }
    }

    /**
     * 获取根节点
     * @return
     */
    private MetaTree getRootInWindows(NodeContext context) {
        AccessibilityService service = accessibilityServiceRef.get();
        if (service == null) {
            return null;
        }
        if (Build.VERSION.SDK_INT >= 21) {
            // 构建Windows树
            List<AccessibilityWindowInfo> windowInfos = service.getWindows();
            AccessibilityWindowInfo targetWin = null;
            AccessibilityWindowInfo maxSizeWin = null;
            int maxSize = -1;
            MetaTree inputNode = null;
            for (AccessibilityWindowInfo win : windowInfos) {
                Rect size = new Rect();
                win.getBoundsInScreen(size);
                LogUtil.i(TAG, "当前窗口区域：%s, 类型：%d", size, win.getType());
                // 在极速模式下，输入法框特殊定义
                if (SPService.getBoolean(SPService.KEY_USE_EASY_MODE, false) && win.getType() == AccessibilityWindowInfo.TYPE_INPUT_METHOD) {
                    LogUtil.i(TAG, "发现输入法框，注意下");
                    context.put(Constant.TRIGGER_INPUT_METHOD, "true");

                    inputNode = new MetaTree();
                    InputWindowTree tree = new InputWindowTree();
                    tree.setNodeBound(size);
                    tree.setDrawingOrder(Integer.MAX_VALUE);
                    inputNode.setCurrentNode(tree);
                    continue;
                }

                AccessibilityNodeInfo root = win.getRoot();

                // 不包含子节点，直接跳过
                if (root == null) {
                    continue;
                }
                // 如果是SoloPi自己的window，就不处理
                if (StringUtil.equals(root.getPackageName(), "com.alipay.hulu")) {
                    LogUtil.d(TAG, "自己的Windows，不处理");
                    continue;
                }

                int realSize = size.width() * size.height();
                if (realSize > maxSize) {
                    maxSize = realSize;
                    maxSizeWin = win;
                }

                // 首先是active window
                if (win.isActive()) {
                    LogUtil.i(TAG, "Active window:::" + root.getPackageName());
                    targetWin = win;
                    break;
                    // 然后考虑有Accessibility focus的
                } else if (targetWin == null && win.isAccessibilityFocused()) {
                    targetWin = win;
                }
            }

            // 如果都不是激活状态
            if (targetWin == null) {
                if (maxSizeWin != null) {
                    targetWin = maxSizeWin;
                } else {
                    return null;
                }
            }

            // 多窗口情况
            MetaTree result = new MetaTree();
            if (inputNode != null || targetWin.getChildCount() > 0) {
                FakeNodeTree fake = new FakeNodeTree();
                result.setCurrentNode(fake);
                List<MetaTree> children = new ArrayList<>();

                maxSize = -1;
                Rect maxRect = null;

                // 添加所有子窗口
                Queue<AccessibilityWindowInfo> windowQueue = new LinkedList<>();
                windowQueue.add(targetWin);
                CharSequence packageName = null;
                while (!windowQueue.isEmpty()) {
                    AccessibilityWindowInfo windowInfo = windowQueue.poll();
                    if (windowInfo == null) {
                        continue;
                    }

                    MetaTree item = new MetaTree();
                    AccessibilityNodeInfo root = windowInfo.getRoot();
                    if (packageName == null) {
                        packageName = root.getPackageName();
                    }

                    // 还不更新？
                    if (root == null) {
                        continue;
                    }
                    root.refresh();

                    item.setCurrentNode(root);


                    // 算一下最大高宽
                    Rect currentRect = new Rect();
                    windowInfo.getBoundsInScreen(currentRect);
                    int currSize = currentRect.width() * currentRect.height();
                    if (currSize > maxSize) {
                        maxSize = currSize;
                        maxRect = currentRect;
                    }

                    children.add(item);

                    // 遍历所有子window
                    if (windowInfo.getChildCount() > 0) {
                        for (int i = 0; i < windowInfo.getChildCount(); i++) {
                            windowQueue.add(windowInfo.getChild(i));
                        }
                    }
                }

                // 一个没加成功
                if (children.isEmpty()) {
                    return null;
                }

                fake.setPackageName(StringUtil.toString(packageName));
                fake.setNodeBound(maxRect);

                if (inputNode != null) {
                    children.add(inputNode);
                }

                // 将window结果拍平
                result.setChildren(children);
            } else {
                AccessibilityNodeInfo root = targetWin.getRoot();
                if (root == null) {
                    return null;
                }

                root.refresh();
                result.setCurrentNode(root);
            }

            // 最后全回收掉
            if (windowInfos.size() > 0) {
                for (AccessibilityWindowInfo windowInfo: windowInfos) {
                    windowInfo.recycle();
                }
            }

            return result;
        } else {
            MetaTree metaTree = new MetaTree();
            metaTree.setCurrentNode(service.getRootInActiveWindow());
            return metaTree;
        }
    }

    @Override
    public MetaTree provideMetaTree(NodeContext context) {
        if (accessibilityServiceRef == null) {
            return null;
        }

        final AccessibilityService service = accessibilityServiceRef.get();

        if (service == null) {
            LogUtil.e(TAG, "不存在辅助功能应用");
            return null;
        }

        // 预先检查可访问行
        checkFrontActivityAccessibility();

        reloadFlag = false;
        MetaTree root = null;
        int retryCount = 0;

//        final AtomicBoolean runningFlag = new AtomicBoolean(false);

        // 重试三次
        while (root == null && retryCount < 3) {
            try {
                root = loadMetaTree(context);
                retryCount++;
            } catch (Exception e) {
                LogUtil.e(TAG, "Load accessibility tree throw exception: " + e.getMessage(), e);
            }
        }

        return root;
    }

    /**
     * 加载Meta树
     * @return
     */
    private MetaTree loadMetaTree(NodeContext context) {
        MetaTree rootNode = getRootInWindows(context);
        int retryCount = 0;
        while ((rootNode == null || rootNode.getCurrentNode() == null) && retryCount < 3) {
            MiscUtil.sleep(500);
            retryCount ++;
            rootNode = getRootInWindows(context);
        }

        if (rootNode == null || rootNode.getCurrentNode() == null) {
            LogUtil.e(TAG, "根节点为空");

            // 重启辅助功能
            restartAccessibilityService();
            return null;
        }

        Queue<Pair<MetaTree, AccessibilityNodeInfo>> nodeQueue = new LinkedList<>();

        if (rootNode.getCurrentNode() instanceof FakeNodeTree) {
            for (MetaTree child: rootNode.getChildren()) {
                if (child.getCurrentNode() instanceof AccessibilityNodeInfo) {
                    nodeQueue.add(new Pair<>(child, (AccessibilityNodeInfo) child.getCurrentNode()));
                }
            }
        } else {
            nodeQueue.add(new Pair<>(rootNode, (AccessibilityNodeInfo) rootNode.getCurrentNode()));
        }
        Pair<MetaTree, AccessibilityNodeInfo> curr = null;

        while ((curr = nodeQueue.poll()) != null) {
            MetaTree tmpTree = curr.first;
            AccessibilityNodeInfo info = curr.second;

            // 遇到WebView，重新加载
            if (!reloadFlag &&
                    (StringUtil.equals(info.getClassName(), "android.webkit.WebView")
                    || StringUtil.contains(info.getClassName(), "com.uc.webkit"))) {
                reloadFlag = true;
                LogUtil.d(TAG, "发现WebView，重载下界面");
                info.performAction(AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS);
                // 等待500ms
                MiscUtil.sleep(100);

                // 刚生成的需要回收下
                recycleTmpTree(rootNode);
                return null;
            }


            tmpTree.setCurrentNode(info);

            int childCount = info.getChildCount();
            if (childCount > 0) {
                List<MetaTree> children = new ArrayList<>(childCount + 1);
                for (int i = 0; i < childCount; i++) {
                    // 找下child
                    AccessibilityNodeInfo child = info.getChild(i);
                    if (child != null) {
                        MetaTree newTree = new MetaTree();
                        children.add(newTree);
                        nodeQueue.add(new Pair<>(newTree, info.getChild(i)));
                    }
                }

                tmpTree.setChildren(children);
            }
        }

        return rootNode;
    }

    /**
     * 重启辅助功能
     */
    private void restartAccessibilityService() {
        LauncherApplication.getInstance().showToast(StringUtil.getString(R.string.permission__restarting_accessibility));
        // 关uiautomator
        cleanInstrumentationAndUiAutomator();

        // 切换回TalkBack
        CmdTools.putAccessibility("enabled_accessibility_services", "com.android.talkback/com.google.android.marvin.talkback.TalkBackService");
        // 等2秒
        MiscUtil.sleep(2000);

        CmdTools.execHighPrivilegeCmd("settings put secure enabled_accessibility_services com.alipay.hulu/com.alipay.hulu.shared.event.accessibility.AccessibilityServiceImpl");

        final CountDownLatch latch = new CountDownLatch(1);
        InjectorService.g().waitForMessage(SubscribeParamEnum.ACCESSIBILITY_SERVICE, new Callback<AccessibilityService>() {
            @Override
            public void onResult(AccessibilityService item) {
                LogUtil.i(TAG, "Accessibility Service 回调成功");
                latch.countDown();
            }

            @Override
            public void onFailed() {
                latch.countDown();
            }
        });

        CmdTools.putAccessibility("enabled_accessibility_services", "com.alipay.hulu/com.alipay.hulu.shared.event.accessibility.AccessibilityServiceImpl");

        // 等待辅助功能重新激活
        try {
            latch.await(20000, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            LogUtil.e(TAG, "Catch java.lang.InterruptedException: " + e.getMessage(), e);
        }
    }

    /**
     * 重启辅助功能
     */
    private void simpleRestartAccessibilityService() {
        LauncherApplication.getInstance().showToast(R.string.permission__restarting_accessibility);

        // 切换回TalkBack
        CmdTools.putAccessibility("enabled_accessibility_services", "com.android.talkback/com.google.android.marvin.talkback.TalkBackService");
        // 等2秒
        MiscUtil.sleep(2000);
        final CountDownLatch latch = new CountDownLatch(1);
        InjectorService.g().waitForMessage(SubscribeParamEnum.ACCESSIBILITY_SERVICE, new Callback<AccessibilityService>() {
            @Override
            public void onResult(AccessibilityService item) {
                LogUtil.i(TAG, "Accessibility 回调");
                latch.countDown();
            }

            @Override
            public void onFailed() {
                latch.countDown();
            }
        });

        CmdTools.putAccessibility("enabled_accessibility_services", "com.alipay.hulu/com.alipay.hulu.shared.event.accessibility.AccessibilityServiceImpl");

        LogUtil.i(TAG, "等待辅助功能重新激活");
        long startTime = System.currentTimeMillis();

        LauncherApplication.getInstance().showToast(R.string.permission__starting_accessibility_service);

        // 等待辅助功能重新激活
        try {
            latch.await(20000, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            LogUtil.e(TAG, "Catch java.lang.InterruptedException: " + e.getMessage(), e);
        }
        LogUtil.i(TAG, "等待辅助功能恢复完成，耗时: " + (System.currentTimeMillis() - startTime));
    }

    @Override
    public boolean refresh() {
        return true;
    }

    /**
     * 回收下临时的Node
     * @param root
     */
    private void recycleTmpTree(MetaTree root) {
        // 空对象回收什么
        if (root == null) {
            return;
        }

        Queue<MetaTree> nodeQueue = new LinkedList<>();
        nodeQueue.add(root);
        MetaTree tmpNode;
        while ((tmpNode = nodeQueue.poll()) != null) {
            List<MetaTree> children = tmpNode.getChildren();
            if (children != null && children.size() > 0) {
                nodeQueue.addAll(children);
            }

            // 生成的AccessibilityNode需要回收下
            Object target = tmpNode.getCurrentNode();
            if (target instanceof AccessibilityNodeInfo) {
                ((AccessibilityNodeInfo) target).recycle();
            }
        }
    }

    @Override
    public void onStop() {
        InjectorService injectorService = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
        injectorService.unregister(this);
    }
}
