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
package com.alipay.hulu.shared.node.action;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.os.Build;
import android.support.annotation.NonNull;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityNodeInfo;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.injector.provider.Provider;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.service.ScreenCaptureService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.AbstractNodeProcessor;
import com.alipay.hulu.shared.node.OperationService;
import com.alipay.hulu.shared.node.locater.OperationNodeLocator;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.accessibility.AccessibilityNodeProcessor;
import com.alipay.hulu.shared.node.tree.accessibility.tree.AccessibilityNodeTree;
import com.alipay.hulu.shared.node.tree.accessibility.AccessibilityProvider;
import com.alipay.hulu.shared.node.tree.capture.CaptureProcessor;
import com.alipay.hulu.shared.node.tree.capture.CaptureProvider;
import com.alipay.hulu.shared.node.utils.AppUtil;
import com.alipay.hulu.shared.node.utils.LogicUtil;
import com.alipay.hulu.shared.node.utils.OperationUtil;
import com.alipay.hulu.shared.node.utils.PrepareUtil;
import com.android.permission.rom.RomUtils;

import java.io.File;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;

/**
 * Created by qiaoruikai on 2018/10/8 8:46 PM.
 */
@Provider(@Param(type = UIOperationMessage.class, sticky = false))
public class OperationExecutor {
    private static final String TAG = "OperationExecutor";

    public static final String INPUT_TEXT_KEY = "text";
    public static final String SCHEME_KEY = "scheme";
    public static final String APP_URL_KEY = "appUrl";
    public static final String ASSERT_MODE = "assertMode";
    public static final String ASSERT_INPUT_CONTENT = "assertInputContent";
    public static final String ASSERT_CONTENT = "assertContent";
    public static final String LOCAL_CLICK_POS_KEY = "localClickPos";
    public static final String SCREEN_SIZE_KEY = "screenSize";
    public static final String IS_OVERRIDE_INSTALL_KEY = "isOverrideInstall";
    public static final String PACKAGENAME_KEY = "packageName";
    public static final String GET_NODE_MODE = "descriptorMode";

    /**
     * 点击操作类型
     */
    public static final String EVENT_CLICK_TYPE = "clickType";

    public static final int CLICK_TYPE_ADB_TAP = 0;
    public static final int CLICK_TYPE_SEND_EVENT = 1;

    private int currentClickType = CLICK_TYPE_ADB_TAP;


    private static final Pattern FILED_CALL_PATTERN = Pattern.compile("\\$\\{[^}\\s]+\\.?[^}\\s]*\\}");

    private AtomicInteger handleFlag = new AtomicInteger(0);

    private WeakReference<AccessibilityService> serviceRef = new WeakReference<>(null);

    private WeakReference<OperationService> operationManagerRef;

    /**
     * 参数映射处理
     */
    private OperationMethod.ParamProcessor paramReplacer = new OperationMethod.ParamProcessor() {
        @Override
        public String filterParam(String key, String value, PerformActionEnum action) {
            return getMappedContent(value, operationManagerRef != null? operationManagerRef.get(): null);
        }
    };

    private InjectorService injectorService;
    private ScreenCaptureService captureService;
    private String currentApp;

    private CmdExecutor executor;

    public OperationExecutor(OperationService manager) {
        this.executor = new CmdExecutor();
        injectorService = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
        injectorService.register(this);

        // 尝试获取截图服务
        captureService = LauncherApplication.getInstance().findServiceByName(ScreenCaptureService.class.getName());

        this.operationManagerRef = new WeakReference<>(manager);
    }

    @Subscriber(@Param(SubscribeParamEnum.ACCESSIBILITY_SERVICE))
    public void setService(AccessibilityService service) {
        this.serviceRef = new WeakReference<>(service);
    }

    @Subscriber(@Param(SubscribeParamEnum.APP))
    public void setApp(String app) {
        this.currentApp = app;
    }

    public int getCurrentClickType() {
        return currentClickType;
    }

    // 触摸相关
    @Subscriber(@Param(EVENT_CLICK_TYPE))
    public void setCurrentClickType(int currentClickType) {
        this.currentClickType = currentClickType;
        executor.setClickType(currentClickType);
    }

    @Subscriber(@Param(com.alipay.hulu.shared.event.constant.Constant.EVENT_TOUCH_DEVICE))
    public void updateTouchDevice(String device) {
        executor.setTouchDevice(device);
    }

    @Subscriber(@Param(com.alipay.hulu.shared.event.constant.Constant.EVENT_TOUCH_DEVICE_FACTOR_X))
    public void updateDeviceXFactor(float xFactor) {
        executor.setFactorX(xFactor);
    }

    @Subscriber(@Param(com.alipay.hulu.shared.event.constant.Constant.EVENT_TOUCH_DEVICE_FACTOR_Y))
    public void updateDeviceYFactor(float yFactor) {
        executor.setFactorY(yFactor);
    }

    /**
     * 内部调用
     * @param node
     * @param method
     * @return
     */
    private boolean performAction(AbstractNodeTree node, OperationMethod method) {
        return performAction(node, method, null);
    }

    /**
     * 执行动作
     * @param node 操作节点
     * @param operationMethod 操作方法
     */
    public boolean performAction(final AbstractNodeTree node, OperationMethod operationMethod, OperationContext.OperationListener listener) {
        PerformActionEnum actionEnum = operationMethod.getActionEnum();

        // 广播下要执行的操作
        injectorService.pushMessage(Constant.ACTION_OPERATION_STEP, actionEnum);

        // 设置替换参数工具
        operationMethod.setSuffixProcessor(paramReplacer);
        OperationContext opContext = wrapOpContext(listener);
        LogUtil.i(TAG, "开始执行操作： %s", actionEnum.getDesc());

        // 如果是外部操作，由actionMng处理
        if (actionEnum == PerformActionEnum.OTHER_GLOBAL || actionEnum == PerformActionEnum.OTHER_NODE) {
            return operationManagerRef.get().getActionProviderMng()
                    .processAction(node, operationMethod, opContext);
        }

        // 操作结果记录
        switch (actionEnum.getCategory()) {
            // node操作处理
            case PerformActionEnum.CATEGORY_NODE_OPERATION:
                return executeNodeAction(operationMethod, node, opContext);
            case PerformActionEnum.CATEGORY_APP_OPERATION:
                return executeAppAction(operationMethod, opContext);
            case PerformActionEnum.CATEGORY_DEVICE_OPERATION:
                return executeDeviceAction(operationMethod, opContext);
            // 流程控制
            case PerformActionEnum.CATEGORY_CONTROL_OPERATION:
                return executeControlAction(operationMethod, opContext);
            case PerformActionEnum.CATEGORY_INTERNAL_OPERATION:
                return executeInternalAction(operationMethod, opContext);
        }

        // 通知完成
        opContext.notifyOperationFinish();
        return false;
    }


    /**
     * 将当期运行时变量映射到字符串中
     *
     * @param origin
     * @param service
     * @return
     */
    private static String getMappedContent(String origin, final OperationService service) {
        if (service == null) {
            return origin;
        }

        return StringUtil.patternReplace(origin, FILED_CALL_PATTERN, new StringUtil.PatternReplace() {
            @Override
            public String replacePattern(String origin) {
                String content = origin.substring(2, origin.length() - 1);
                // 有子内容调用
                if (content.contains(".")) {
                    String[] group = content.split("\\.", 2);

                    if (group.length != 2) {
                        return origin;
                    }

                    // 获取当前变量
                    Object obj = service.getRuntimeParam(group[0]);
                    if (obj == null) {
                        return origin;
                    }

                    LogUtil.d(TAG, "Map key word %s to value %s", group[0], obj);

                    // 特殊判断
                    // 节点字段，自行操作
                    if (obj instanceof AbstractNodeTree) {
                        String replace = StringUtil.toString(((AbstractNodeTree) obj).getField(group[1]));
                        if (replace == null) {
                            return origin;
                        } else {
                            return replace;
                        }
                    } else {
                        // 目前只支持length方法
                        if (StringUtil.equals(group[1], "length")) {
                            return Integer.toString(StringUtil.toString(obj).length());
                        } else {
                            return origin;
                        }
                    }
                } else {
                    String target = StringUtil.toString(service.getRuntimeParam(content));
                    if (target == null) {
                        return origin;
                    } else {
                        return target;
                    }
                }
            }
        });
    }

    /**
     * 包装OperationContext
     * @param listener
     * @return
     */
    public OperationContext wrapOpContext(OperationContext.OperationListener listener) {
        DisplayMetrics dm = new DisplayMetrics();
        ((WindowManager) LauncherApplication.getInstance().getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRealMetrics(dm);
        int height = dm.heightPixels;
        int width = dm.widthPixels;

        OperationContext context = new OperationContext();
        context.setListener(listener);

        context.opExecutor = this;
        context.executor = executor;
        context.screenHeight = height;
        context.screenWidth = width;
        return context;
    }

    /**
     * 执行节点操作
     * @param method 方法
     * @param node 操作节点
     */
    private boolean executeNodeAction(OperationMethod method, AbstractNodeTree node, final OperationContext opContext) {
        if (node == null) {
            LogUtil.e(TAG, "Get Node failed");
            return false;
        }
        PerformActionEnum actionEnum = method.getActionEnum();
        AbstractNodeTree targetNode = node;
        boolean operationFlag = false;

        // 已经找到具体节点了，不需要再sleep了
        if (actionEnum == PerformActionEnum.SLEEP_UNTIL) {
            operationManagerRef.get().invalidRoot();

            // 通知完成
            opContext.notifyOperationFinish();
            return true;
        }

        // 如果是设置变量，直接处理下
        if (actionEnum == PerformActionEnum.LET_NODE) {
            boolean result = LogicUtil.letStep(method, node, operationManagerRef.get());
            opContext.notifyOperationFinish();
            return result;
        } else if (actionEnum == PerformActionEnum.CHECK_NODE) {
            boolean result = LogicUtil.checkStep(method, node, operationManagerRef.get());
            opContext.notifyOperationFinish();
            return result;
        }

        // send event模式下需要异步点击
        if (currentClickType == CLICK_TYPE_SEND_EVENT && actionEnum == PerformActionEnum.CLICK) {
            final Rect rect = node.getNodeBound();
            // 如果包含局部坐标
            final int x;
            final int y;
            if (method.containsParam(OperationExecutor.LOCAL_CLICK_POS_KEY)) {
                String[] origin = method.getParam(OperationExecutor.LOCAL_CLICK_POS_KEY).split(",");

                // 计算特定坐标
                if (origin.length == 2) {
                    float factorX = Float.parseFloat(origin[0]);
                    float factorY = Float.parseFloat(origin[1]);
                    x = (int) (rect.left + factorX * rect.width());
                    y = (int) (rect.top + factorY * rect.height());
                } else {
                    x = rect.centerX();
                    y = rect.centerY();
                }
            } else {
                x = rect.centerX();
                y = rect.centerY();
            }
            opContext.notifyOnFinish(new Runnable() {
                @Override
                public void run() {
                    executor.executeClick(x, y);
                }
            });

            return true;
        }

        // 看看子节点能不能处理
        for (AbstractNodeTree nodeTree: targetNode){
            if (nodeTree.canDoAction(actionEnum)) {
                targetNode = nodeTree;
                operationFlag = true;
                break;
            }
        }

        // 可能是父节点的锅
        if (!operationFlag && node.getParent() != null) {
            for (AbstractNodeTree rootItem : node.getParent()) {
                if (rootItem.canDoAction(actionEnum)) {
                    operationFlag = true;
                    targetNode = rootItem;
                    break;
                }
            }
        }

        boolean result;
        if (operationFlag) {
            // 由节点自身去处理
            result = targetNode.performAction(method, opContext);
        } else {
            // 强制执行
            result = forceAction(method, node, opContext);
        }

        operationManagerRef.get().invalidRoot();

        // 通知完成，失败就不通知
        if (result) {
            opContext.notifyOperationFinish();
        }

        return result;
    }

    /**
     * 兜底执行
     * @param method 方法
     * @param node
     * @return
     */
    private boolean forceAction(OperationMethod method, AbstractNodeTree node, OperationContext listener) {
        if (method.getActionEnum() == PerformActionEnum.INPUT) {
            inputText(method.getParam(OperationExecutor.INPUT_TEXT_KEY), node.getNodeBound(), listener);
            return true;
        }

        return false;
    }

    /**
     * 向指定位置强制输入文字
     * @param text
     * @param rect
     */
    private void inputText(final String text, final Rect rect, OperationContext listener) {
        listener.notifyOnFinish(new Runnable() {
            @Override
            public void run() {
                LogUtil.e(TAG, "Start Input");
                try {
                    String defaultIme = executor.executeCmdSync("settings get secure default_input_method");
                    executor.executeCmdSync("settings put secure default_input_method com.alipay.hulu/.tools.AdbIME", 0);
                    executor.executeCmdSync("input tap " + rect.centerX() + " " + rect.centerY(), 0);
                    MiscUtil.sleep(1500);
                    executor.executeCmdSync("am broadcast -a ADB_INPUT_TEXT --es msg '" + text + "' --es default '" + StringUtil.trim(defaultIme) + "'", 0);
                } catch (Exception e) {
                    LogUtil.e(TAG, "Input throw Exception：" + e.getLocalizedMessage(), e);
                }
                LogUtil.e(TAG, "Finish Input");
            }
        });
    }

    /**
     * 执行应用操作动作
     *
     * @param method
     */
    private boolean executeAppAction(OperationMethod method, final OperationContext opContext) {
        AccessibilityService service = null;
        if (serviceRef != null) {
            service = serviceRef.get();
        }

        int width = opContext.screenWidth;
        int height = opContext.screenHeight;

        PerformActionEnum actionEnum = method.getActionEnum();

        switch (actionEnum) {
            case BACK:
                executor.executeCmd("input keyevent 4");
                break;
            case RELOAD:
                operationManagerRef.get().refreshCurrentRoot();
                break;
            case GLOBAL_SCROLL_TO_BOTTOM:
                int x = width / 2;
                int y = height / 3;
                int toBottom = height * 2 / 3;
                LogUtil.i(TAG, "Start ADB scroll " + x + "," + y);
                executor.executeCmdSync(MiscUtil.generateSwipeCmd(x, y, x, toBottom, 300));
                break;
            case GLOBAL_SCROLL_TO_TOP:
                x = width / 2;
                y = height * 2 / 3;
                int toTop = height / 3;
                LogUtil.i(TAG, "Start ADB scroll " + x + "," + y);
                executor.executeCmdSync(MiscUtil.generateSwipeCmd(x, y, x, toTop, 300));
                break;
            case GLOBAL_SCROLL_TO_LEFT:
                x = width / 4 * 3;
                y = height / 2;
                int toLeft = width / 4;
                LogUtil.i(TAG, "Start ADB scroll " + x + "," + y);
                executor.executeCmdSync(MiscUtil.generateSwipeCmd(x, y, toLeft, y, 300));
                break;
            case GLOBAL_SCROLL_TO_RIGHT:
                x = width / 4;
                y = height / 2;
                int toRight = width * 3 / 4;
                LogUtil.i(TAG, "Start ADB scroll " + x + "," + y);
                executor.executeCmdSync(MiscUtil.generateSwipeCmd(x, y, toRight, y, 300));
                break;
            case HANDLE_ALERT:
                // 等权限弹窗处理完毕
                while (handleFlag.get() == 1) {
                    MiscUtil.sleep(10);
                }

                // 看看需不需要自己处理下弹窗
                UIOperationMessage dismissMsg = new UIOperationMessage();
                dismissMsg.eventType = UIOperationMessage.TYPE_DISMISS;
                injectorService.pushMessage(null, dismissMsg, false);

                // 只有当前没有正在处理弹窗的任务时才会处理
                if (handleFlag.compareAndSet(0, 2)) {
                    try {
                        AbstractNodeTree root = operationManagerRef.get().getCurrentRoot();
                        AbstractNodeTree target = null;
                        for (AbstractNodeTree curNode : root) {
                            if (OperationUtil.isInAlertDict(curNode.getText())) {
                                target = curNode;
                                break;
                            }
                        }

                        if (target == null) {
                            handleFlag.set(0);
                            break;
                        }

                        LogUtil.i(TAG, "准备点击控件：%s", target);

                        Rect targetRec = target.getNodeBound();
                        int targetX = targetRec.centerX();
                        int targetY = targetRec.centerY();
                        LogUtil.i(TAG, "Start ADB click " + targetX + "," + targetY);
                        executor.executeCmd("input tap " + targetX + " " + targetY);
                        handleFlag.set(0);
                        MiscUtil.sleep(1500);
                    } catch (Exception e) {
                        LogUtil.w(TAG, "处理弹窗抛出异常", e);
                        handleFlag.set(0);
                    }
                }
                break;
            case JUMP_TO_PAGE:
                String scheme = method.getParam(SCHEME_KEY);
                if (StringUtil.isEmpty(scheme)) {
                    return false;
                }

                executor.executeCmdSync("am start '" + scheme + "'");
                break;
            case GOTO_INDEX:
                opContext.notifyOnFinish(new Runnable() {
                        @Override
                        public void run() {
                            // 先杀进程，再启动应用
                            AppUtil.forceStopApp(currentApp);
                            MiscUtil.sleep(1000);
                            AppUtil.startApp(currentApp);
                            operationManagerRef.get().invalidRoot();
                    }
                });
                return true;
            case KILL_PROCESS:
                AppUtil.forceStopApp(currentApp);
                break;
            case CLEAR_DATA:
                opContext.notifyOnFinish(new Runnable() {
                    @Override
                    public void run() {
                        // 清理输出
                        AppUtil.clearAppData(currentApp);

                        // 准备操作
                        PrepareUtil.doPrepareWork(currentApp);

                        // 重启应用
                        AppUtil.startApp(currentApp);
                    }
                });
                return true;
            case EXECUTE_SHELL:
                final String command = method.getParam(INPUT_TEXT_KEY);
                if (StringUtil.isEmpty(command)) {
                    return false;
                }
                opContext.notifyOnFinish(new Runnable() {
                    @Override
                    public void run() {
                        executor.executeCmd(command);
                    }
                });
                return true;
            case SLEEP:
                String sleepTime = method.getParam(INPUT_TEXT_KEY);
                if (StringUtil.isEmpty(sleepTime)) {
                    return false;
                }

                // sleep加一个悬浮窗，防止误操作
                try {
                    final long count = Long.parseLong(sleepTime);
                    UIOperationMessage message = new UIOperationMessage();
                    message.eventType = UIOperationMessage.TYPE_COUNT_DOWN;
                    message.putParam("time", count);
                    injectorService.pushMessage(null, message, true);

                    opContext.notifyOnFinish(new Runnable() {
                        @Override
                        public void run() {
                            MiscUtil.sleep(count);
                        }
                    });
                    return true;
                } catch (NumberFormatException e) {
                    LogUtil.e(TAG, "无法解析时间%s，格式有误", sleepTime);
                    return false;
                }
        }

        opContext.notifyOperationFinish();
        operationManagerRef.get().invalidRoot();
        return true;
    }

    /**
     * 执行设备控制动作
     *
     * @param method
     */
    private boolean executeDeviceAction(OperationMethod method, final OperationContext opContext) {
        AccessibilityService service = serviceRef.get();
        PerformActionEnum actionEnum = method.getActionEnum();

        switch (actionEnum) {
            case HOME:
                if (service != null) {
                    service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME);
                } else {
                    executor.executeCmd("input keyevent 3");
                }
                break;
            case NOTIFICATION:
                if (service != null) {
                    service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS);
                } else {
                    executor.executeCmd("input keyevent 83");
                }
                break;
            case RECENT_TASK:
                if (service != null) {
                    service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_RECENTS);
                }
                break;
            case DEVICE_INFO:
                UIOperationMessage message = new UIOperationMessage();
                message.eventType = UIOperationMessage.TYPE_DEVICE_INFO;
                injectorService.pushMessage(null, message, false);
                break;
            case SCREENSHOT:
                String screenShot = method.getParam(INPUT_TEXT_KEY);
                if (StringUtil.isEmpty(screenShot)) {
                    return false;
                }
                final String screenshotName = screenShot + ".png";
                opContext.notifyOnFinish(new Runnable() {
                    @Override
                    public void run() {
                        File parentDir = FileUtils.getSubDir("screenshots");
                        boolean result = true;
                        if (!parentDir.exists()) {
                            result = parentDir.mkdirs();
                        }

                        if (result) {
                            File screenshot = new File(parentDir, screenshotName);
                            // 如果可以，通过minicap截图
                            if (captureService != null) {
                                Bitmap bit = captureService.captureScreen(screenshot, opContext.screenWidth,
                                        opContext.screenHeight, opContext.screenWidth, opContext.screenHeight);
                                if (bit != null) {
                                    operationManagerRef.get().invalidRoot();
                                    return;
                                }
                            }

                            String path = FileUtils.getPathInShell(screenshot);
                            CmdTools.execAdbCmd("screencap -p \"" + path + "\"", 0);
                        }
                        operationManagerRef.get().invalidRoot();
                    }
                });
                return true;
        }

        opContext.notifyOperationFinish();
        operationManagerRef.get().invalidRoot();
        return true;
    }

    /**
     * 处理流程控制动作
     * @param method
     */
    private boolean executeControlAction(OperationMethod method, OperationContext opContext) {
        switch (method.getActionEnum()) {
            case CHANGE_MODE:
                if (method.getParam(GET_NODE_MODE) == null) {
                    return false;
                }

                RunningModeEnum toRunningMode = RunningModeEnum.getModeByCode(method.getParam(GET_NODE_MODE));

                // 两种运行模式
                if (toRunningMode == RunningModeEnum.ACCESSIBILITY_MODE) {
                    List<Class<? extends AbstractNodeProcessor>> processors = new ArrayList<>();
                    processors.add(AccessibilityNodeProcessor.class);
                    operationManagerRef.get().configProcessors(processors);
                    operationManagerRef.get().configProvider(AccessibilityProvider.class);
                    SPService.putBoolean(SPService.KEY_H5_COMPAT, false);
                } else if (toRunningMode == RunningModeEnum.CAPTURE_MODE) {
                    List<Class<? extends AbstractNodeProcessor>> processors = new ArrayList<>();
                    processors.add(CaptureProcessor.class);
                    operationManagerRef.get().configProcessors(processors);
                    operationManagerRef.get().configProvider(CaptureProvider.class);
                    SPService.putBoolean(SPService.KEY_H5_COMPAT, false);
                } else {
                    return false;
                }
                break;
            case LET:
                boolean result = LogicUtil.letStep(method, null, operationManagerRef.get());
                opContext.notifyOperationFinish();
                return result;
            case CHECK:
                result = LogicUtil.checkStep(method, null, operationManagerRef.get());
                opContext.notifyOperationFinish();
                return result;
        }

        opContext.notifyOperationFinish();
        operationManagerRef.get().invalidRoot();

        return true;
    }

    /**
     * 处理弹窗
     *
     * @param method
     */
    private boolean executeInternalAction(OperationMethod method, OperationContext opContext) {
        int width = opContext.screenWidth;
        int height = opContext.screenHeight;

        switch (method.getActionEnum()) {
            case HANDLE_PERMISSION_ALERT:
                handlePermissionAlertEntry(opContext);
                return true;
            case HIDE_INPUT_METHOD:
                opContext.notifyOnFinish(new Runnable() {
                    @Override
                    public void run() {
                        hideSoftInput();
                    }
                });
                return true;
        }

        opContext.notifyOperationFinish();
        operationManagerRef.get().invalidRoot();
        return true;
    }

    /**
     * 处理权限弹窗
     */
    public void handlePermissionAlert() {
        // 获取当前窗口根节点
        try {
            AbstractNodeTree curRoot = operationManagerRef.get().refreshCurrentRoot();
            if (curRoot == null) {
                return;
            }

            AbstractNodeTree target = null;
            for (AbstractNodeTree node : curRoot) {
                if (StringUtil.equals("始终允许", node.getText())
                        || StringUtil.equals("允许", node.getText())
                        || StringUtil.equals("总是允许", node.getText())
                        || StringUtil.equals("好的", node.getText())) {
                    target = node;
                    break;
                }
            }

            // 没找到，特殊查找
            if (target == null) {
                // MIUI特殊处理
                if (RomUtils.checkIsMiuiRom() && curRoot instanceof AccessibilityNodeTree) {
                    AccessibilityNodeInfo nodeInfo = ((AccessibilityNodeTree) curRoot).getCurrentNode();
                    List<AccessibilityNodeInfo> findNodes = nodeInfo.findAccessibilityNodeInfosByText("允许");

                    // 查找允许
                    if (findNodes != null && findNodes.size() > 0) {
                        for (AccessibilityNodeInfo targetInfo: findNodes) {
                            if (StringUtil.equals(targetInfo.getText(), "始终允许")
                                    || StringUtil.equals("允许", targetInfo.getText())
                                    || StringUtil.equals("总是允许", targetInfo.getText())) {
                                Rect node = new Rect();
                                targetInfo.getBoundsInScreen(node);
                                executor.executeCmd("input tap " + node.centerX() + " " + node.centerY());

                                operationManagerRef.get().invalidRoot();
                                return;
                            }
                        }
                    }

                    // 查找好的
                    findNodes = nodeInfo.findAccessibilityNodeInfosByText("好的");
                    if (findNodes != null && findNodes.size() > 0) {
                        for (AccessibilityNodeInfo targetInfo: findNodes) {
                            if (StringUtil.equals(targetInfo.getText(), "好的")) {
                                Rect node = new Rect();
                                targetInfo.getBoundsInScreen(node);
                                executor.executeCmd("input tap " + node.centerX() + " " + node.centerY());

                                operationManagerRef.get().invalidRoot();
                                return;
                            }
                        }
                    }
                }
                return;
            }

            target.performAction(new OperationMethod(PerformActionEnum.CLICK), wrapOpContext(null));
            operationManagerRef.get().invalidRoot();
        } catch (Exception e) {
            LogUtil.e(TAG, "Catch Exception: " + e.getMessage(), e);
        }
    }

    /**
     * 处理权限弹窗
     */
    private void handlePermissionAlertEntry(@NonNull final OperationContext opContext) {
        // 如果没有正在处理弹窗
        if (handleFlag.compareAndSet(0, 1)) {
            opContext.notifyOnFinish(new Runnable() {
                @Override
                public void run() {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        while (CmdTools.getTopActivity().contains("GrantPermissionsActivity")) {
                            handlePermissionAlert();
                            MiscUtil.sleep(500);
                        }
                    }

                    int maxCount = 5;
                    int retryCount = 0;
                    AbstractNodeTree target;
                    OperationMethod operationMethod = new OperationMethod();
                    operationMethod.setActionEnum(PerformActionEnum.CLICK);

                    while (retryCount++ < maxCount) {
                        if ((target = findAllowPermissionBtn()) != null) {
                            performAction(target, operationMethod, null);
                            retryCount = 0;
                        }

                        MiscUtil.sleep(500);
                    }
                    // 设置回false
                    handleFlag.set(0);
                    operationManagerRef.get().invalidRoot();
                }
            });
        } else {
            // 通知结束
            opContext.notifyOperationFinish();
        }
    }

    /**
     * 查找允许权限按钮
     * @return
     */
    private AbstractNodeTree findAllowPermissionBtn() {
        try {
            AbstractNodeTree curRoot = operationManagerRef.get().getCurrentRoot();
            if (curRoot == null) {
                return null;
            }

            for (AbstractNodeTree node : curRoot) {
                if (StringUtil.equals("始终允许", node.getText())
                        || StringUtil.equals("允许", node.getText())
                        || StringUtil.equals("总是允许", node.getText())
                        || StringUtil.equals("好的", node.getText())) {
                    return node;
                }
            }

        } catch (Exception e) {
            LogUtil.e(TAG, "Catch Exception: " + e.getMessage(), e);
        }

        return null;
    }

    /**
     * 判断当前界面是有有输入法框存在
     *
     * @return
     */
    private boolean judgeSoftInputIsShown() {
        if (Build.VERSION.SDK_INT >= 28) {
            String result = executor.executeCmdSync("dumpsys input_method |grep mInputShown=true");

            return StringUtil.contains(result, "mInputShown");
        } else {
            String result = executor.executeCmdSync("dumpsys SurfaceFlinger --list");

            return StringUtil.contains(result, "InputMethod");
        }
    }

    private AtomicBoolean softHideFlag = new AtomicBoolean(false);

    /**
     * 用back键隐藏输入法框，基本上好用
     *
     */
    public void hideSoftInput() {
        if (softHideFlag.compareAndSet(false, true)) {
            return;
        }
        int count = 0;
        while (count < 4) {
            MiscUtil.sleep(500);
            if (!judgeSoftInputIsShown()) {
                LogUtil.i(TAG, "输入法已被隐藏，不需要手动隐藏");
                softHideFlag.set(false);
                return;
            }

            count++;
        }

        // back隐藏输入法
        LogUtil.i(TAG, "隐藏软键盘，等待1s");
        // InputMangerUtil.press_back(this);

        if (Build.VERSION.SDK_INT >= 28) {
            // 针对android 9 通过back隐藏键盘存在问题
            executor.executeCmd("input keyevent 111");
        } else {
            OperationMethod method = new OperationMethod(PerformActionEnum.BACK);
            performAction(null, method);
        }
        softHideFlag.set(false);
        MiscUtil.sleep(500);
    }
}
