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
package com.alipay.hulu.shared.event.accessibility;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Rect;
import android.os.Build;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.OperationService;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.android.permission.rom.RomUtils;

import java.lang.ref.WeakReference;
import java.util.List;

/**
 * Created by qiaoruikai on 2018/10/9 4:05 PM.
 */
public class AccessibilityEventTracker {
    private static final String TAG ="AccessEventTracker";

    private WeakReference<AccessibilityListener> accessibilityListenerRef;

    private WeakReference<AccessibilityService> serviceRef;

    private WeakReference<OperationService> operationRef;
    private long deviceStartTime;

    private boolean trackEvent = false;

    public AccessibilityEventTracker() {
        LauncherApplication application = LauncherApplication.getInstance();


        // 注册自身
        InjectorService service = application.findServiceByName(InjectorService.class.getName());
        service.register(this);

        operationRef = new WeakReference<>((OperationService) application.findServiceByName(OperationService.class.getName()));
    }

    public void startTrackEvent() {
        this.trackEvent = true;
    }

    public void stopTrackEvent() {
        this.trackEvent = false;
    }

    @Subscriber(@Param(SubscribeParamEnum.ACCESSIBILITY_SERVICE))
    public void setAccessibilityService(AccessibilityService service) {
        // 引用为空或者不变
        if (service == null || (serviceRef != null && serviceRef.get() == service)) {
            return;
        }

        this.serviceRef = new WeakReference<>(service);

        // 将自身注册给AccessibilityService
        AccessibilityServiceImpl realService = (AccessibilityServiceImpl) service;
        realService.setAccessibilityEventTracker(this);
    }

    public void setAccessibilityListener(AccessibilityListener accessibilityListener) {
        this.accessibilityListenerRef = new WeakReference<>(accessibilityListener);
    }

    /**
     * 通知手势
     * @param gesture
     */
    protected void notifyGestureEvent(int gesture) {
        if (trackEvent && accessibilityListenerRef.get() != null) {
            accessibilityListenerRef.get().onGesture(gesture);
        }
    }

    /**
     * 通知AccessibilityEvent
     * @param event
     */
    protected void notifyAccessibilityEvent(AccessibilityEvent event) {
        int eventType = event.getEventType();
        // 如果是等待窗口变化模式
        // 需要手动处理弹窗
        if (eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {

            LogUtil.d(TAG, "current package: %s class : %s", event.getPackageName(), event.getClassName());
            // 通用权限弹窗
            if (event.getPackageName() != null && event.getPackageName().toString().contains("packageinstaller")
                    && StringUtil.equals("com.android.packageinstaller.permission.ui.GrantPermissionsActivity", event.getClassName())) {
                BackgroundExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        OperationMethod method = new OperationMethod();
                        method.setActionEnum(PerformActionEnum.HANDLE_PERMISSION_ALERT);
                        operationRef.get().doSomeAction(method, null);
                    }
                }, 10);
            // Vivo的悬浮窗比较特殊
            } else if (RomUtils.isVivoSystem() && StringUtil.equals(event.getPackageName(), "android")
                    && StringUtil.equals(event.getClassName(), "android.app.AlertDialog")
                    && event.getSource() != null) {

                List<AccessibilityNodeInfo> nodeInfo = event.getSource().findAccessibilityNodeInfosByViewId("@vivo:id/confirm_msg");
                if (nodeInfo != null && nodeInfo.size() > 0) {
                    BackgroundExecutor.execute(new Runnable() {
                        @Override
                        public void run() {
                            OperationMethod method = new OperationMethod();
                            method.setActionEnum(PerformActionEnum.HANDLE_PERMISSION_ALERT);
                            operationRef.get().doSomeAction(method, null);
                        }
                    }, 10);
                }
            // 小米的权限弹窗
            } else if (RomUtils.checkIsMiuiRom() && StringUtil.equals(event.getPackageName(), "com.lbe.security.miui")) {
                BackgroundExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        OperationMethod method = new OperationMethod();
                        method.setActionEnum(PerformActionEnum.HANDLE_PERMISSION_ALERT);
                        operationRef.get().doSomeAction(method, null);
                    }
                }, 10);
            // 锤子的悬浮窗
            } else if (RomUtils.isSmartisanSystem() && StringUtil.equals(event.getClassName(), "com.android.server.SmtPermissionDialog")) {
                BackgroundExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        OperationMethod method = new OperationMethod();
                        method.setActionEnum(PerformActionEnum.HANDLE_PERMISSION_ALERT);
                        operationRef.get().doSomeAction(method, null);
                    }
                }, 10);
            // Sony的悬浮窗
            } else if (RomUtils.isSonySystem() && StringUtil.equals(event.getPackageName(), "com.sonymobile.cta")
                    &&StringUtil.contains(event.getClassName(), "GrantPermissionsActivity")) {
                BackgroundExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        OperationMethod method = new OperationMethod();
                        method.setActionEnum(PerformActionEnum.HANDLE_PERMISSION_ALERT);
                        operationRef.get().doSomeAction(method, null);
                    }
                }, 10);
            // 三星的权限提示框
            } else if (RomUtils.isSamSungSystem() && StringUtil.equals(event.getPackageName(), "com.samsung.android.packageinstaller")
                    && event.getSource() != null) {
                // 找下确认按钮
                List<AccessibilityNodeInfo> target = event.getSource()
                        .findAccessibilityNodeInfosByViewId("@com.android.packageinstaller:id/confirm_button");

                // 找到了，直接点确定
                if (target != null && target.size() > 0) {
                    final AccessibilityNodeInfo targetNode = target.get(0);
                    BackgroundExecutor.execute(new Runnable() {
                        @Override
                        public void run() {
                            Rect pos = new Rect();
                            targetNode.getBoundsInScreen(pos);
                            CmdTools.execClick(pos.centerX(), pos.centerY());

                            // 点击了确定，需要cancel
                            operationRef.get().invalidRoot();
                        }
                    });
                }
            // 华为9.0之后出现的权限弹窗，特别处理下
            } else if (Build.VERSION.SDK_INT >= 28 && RomUtils.checkIsHuaweiRom()
                    && StringUtil.equals(event.getPackageName(), "com.android.packageinstaller")
                    && StringUtil.contains(event.getClassName(), "AlertDialog")) {
                // 华为这个就是个Dialog，直接用HandleAlert处理掉
                BackgroundExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        OperationMethod method = new OperationMethod();
                        method.setActionEnum(PerformActionEnum.HANDLE_ALERT);
                        operationRef.get().doSomeAction(method, null);
                    }
                }, 10);
            // Android Q 权限处理
            } else if (Build.VERSION.SDK_INT >= 29 && StringUtil.equals(event.getPackageName(), "com.android.permissioncontroller")) {
                // 就是个Dialog，直接用HandleAlert处理掉
                BackgroundExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        OperationMethod method = new OperationMethod();
                        method.setActionEnum(PerformActionEnum.HANDLE_ALERT);
                        operationRef.get().doSomeAction(method, null);
                    }
                }, 10);
            }

            // Android 9.0的私有API弹窗
            if (Build.VERSION.SDK_INT >= 28 && event.getSource() != null &&
                    StringUtil.equals(event.getSource().getClassName(), "android.widget.FrameLayout")) {
                List<AccessibilityNodeInfo> nodeInfos = event.getSource().findAccessibilityNodeInfosByViewId("android:id/scrollView");
                if (nodeInfos != null && nodeInfos.size() == 1) {
                    if (StringUtil.startWith(nodeInfos.get(0).getText(), "Detected problems with API compatibility")) {
                        List<AccessibilityNodeInfo> button = event.getSource().findAccessibilityNodeInfosByText("确定");
                        if (button != null && button.size() > 0) {
                            Rect pos = new Rect();
                            button.get(0).getBoundsInScreen(pos);
                            CmdTools.execClick(pos.centerX(), pos.centerY());

                            operationRef.get().invalidRoot();
                        }
                    }
                }
            } else if (RomUtils.checkIsHuaweiRom() && StringUtil.equals(event.getPackageName(), "com.android.packageinstaller")
                    && StringUtil.equals(event.getClassName(), "android.app.AlertDialog")
                    && event.getSource() != null) {
                // emui 4.X
                List<AccessibilityNodeInfo> nodeInfos = event.getSource().findAccessibilityNodeInfosByViewId("com.android.packageinstaller:id/permission_allow_button");
                if (nodeInfos != null && nodeInfos.size() == 1 && StringUtil.contains(nodeInfos.get(0).getText(), "允许")) {
                    Rect pos = new Rect();
                    nodeInfos.get(0).getBoundsInScreen(pos);
                    CmdTools.execClick(pos.centerX(), pos.centerY());

                    operationRef.get().invalidRoot();
                }
            }
        }

        if (trackEvent && accessibilityListenerRef.get() != null) {
            accessibilityListenerRef.get().onAccessibilityEvent(
                    event.getEventTime() + getMilliSecondsSinceDeviceStart(),
                    eventType, event.getSource(), StringUtil.toString(event.getPackageName()));
        }
    }

    /**
     * 获取系统启动的时间
     * @return
     */
    private long getMilliSecondsSinceDeviceStart() {
        if (deviceStartTime == 0L) {
            deviceStartTime = System.currentTimeMillis() - SystemClock.uptimeMillis();
        }

        return deviceStartTime;
    }

    /**
     * Accessibility事件监听器
     */
    public interface AccessibilityListener {
        void onAccessibilityEvent(long time, int eventType, AccessibilityNodeInfo node, String sourcePackage);
        void onGesture(int gesture);
    }
}
