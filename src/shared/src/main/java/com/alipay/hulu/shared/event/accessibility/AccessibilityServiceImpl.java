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
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.Intent;
import android.os.Build;
import android.view.accessibility.AccessibilityEvent;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.RunningThread;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.injector.provider.Provider;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.event.constant.Constant;

import java.lang.ref.WeakReference;

import androidx.annotation.NonNull;

/**
 * Created by qiaoruikai on 2018/10/9 4:35 PM.
 */
public class AccessibilityServiceImpl extends AccessibilityService {
    public static final int MODE_BLOCK = 0;
    public static final int MODE_NORMAL = 1;

    private static final String TAG = "AccessibilityService";

    private WeakReference<AccessibilityEventTracker> accessibilityEventTrackerRef = null;

    @Provider(value = @Param(SubscribeParamEnum.ACCESSIBILITY_SERVICE), updatePeriod = 100000)
    public AccessibilityService provideAccessibilityService() {
        return this;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        LogUtil.d(TAG, "Service on create");
    }

    @Override
    public void onStart(Intent intent, int startId) {
        super.onStart(intent, startId);
        LogUtil.d(TAG, "Service on start");
    }

    @Override
    public boolean onUnbind(Intent intent) {
        LogUtil.i(TAG, "Service on unbind");
        LauncherApplication.getInstance().prepareInMain();
        InjectorService service = LauncherApplication.getInstance()
                .findServiceByName(InjectorService.class.getName());

        // 覆盖为空
        service.pushMessage(SubscribeParamEnum.ACCESSIBILITY_SERVICE, null);
        service.unregister(this);
        LauncherApplication.getInstance().setAccessibilityState(false);

        if (this.accessibilityEventTrackerRef != null) {
            this.accessibilityEventTrackerRef.clear();
        }
        return super.onUnbind(intent);
    }

    @Override
    public void onRebind(Intent intent) {
        LogUtil.d(TAG, "Service on rebind");
        super.onRebind(intent);
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        LogUtil.d(TAG, "Service on task removed");
        super.onTaskRemoved(rootIntent);
    }

    @Override
    protected void onServiceConnected() {
        LogUtil.d(TAG, "Service connected");
        super.onServiceConnected();

        // 如果初始化完成但没有注册过
        if (Build.VERSION.SDK_INT >= 24) {
            SoftKeyboardController controller = getSoftKeyboardController();
            controller.addOnShowModeChangedListener(new SoftKeyboardController.OnShowModeChangedListener() {
                @Override
                public void onShowModeChanged(@NonNull SoftKeyboardController controller, int showMode) {
                    LogUtil.i(TAG, "Soft keyboard show mode changed, to= " + (showMode == SHOW_MODE_AUTO? "自动": "隐藏"));
                }
            });
            controller.setShowMode(SHOW_MODE_AUTO);
        }
        registerSelf();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        LogUtil.d(TAG, "Service on start command");
        return super.onStartCommand(intent, flags, startId);
    }

    public void setAccessibilityEventTracker(AccessibilityEventTracker tracker) {
        this.accessibilityEventTrackerRef = new WeakReference<>(tracker);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        LogUtil.d(TAG, "收到辅助功能事件:" + event.getEventType());

        // SoloPi的窗口事件，不处理
        if (StringUtil.equals(event.getPackageName(), getPackageName())) {
            return;
        }

        // 如果没有注册过
        if (!LauncherApplication.getInstance().getAccessibilityState() && LauncherApplication.getInstance().hasFinishInit()) {
            // 注册自身到注入服务
            registerSelf();
        }

        if (accessibilityEventTrackerRef == null) {
            return;
        }

        AccessibilityEventTracker tracker = accessibilityEventTrackerRef.get();

        // 由tracker通知
        if (tracker != null) {
            tracker.notifyAccessibilityEvent(event);
        }
    }

    @Override
    protected boolean onGesture(int gestureId) {
        if (accessibilityEventTrackerRef == null) {
            return super.onGesture(gestureId);
        }
        AccessibilityEventTracker tracker = accessibilityEventTrackerRef.get();

        // 由tracker通知
        if (tracker != null) {
            tracker.notifyGestureEvent(gestureId);
        }

        return super.onGesture(gestureId);
    }

    private void registerSelf() {
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                LauncherApplication.getInstance().prepareInMain();
                InjectorService.g().register(AccessibilityServiceImpl.this);
                LauncherApplication.getInstance().setAccessibilityState(true);
                LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        setServiceToNormalMode();
                    }
                });
            }
        });
    }

    @Override
    public void onInterrupt() {
        LogUtil.e(TAG, "服务被Interrupt");
    }

    @Subscriber(value = @Param(Constant.EVENT_ACCESSIBILITY_MODE), thread = RunningThread.MAIN_THREAD)
    public void setAccessonilityMode(int mode) {
        if (mode == MODE_BLOCK) {
            setServiceInfoToTouchBlockMode();
        } else if (mode == MODE_NORMAL) {
            setServiceToNormalMode();
        }
    }

    private AccessibilityServiceInfo _getServiceInfo() {
        AccessibilityServiceInfo serviceInfo = getServiceInfo();
        if (serviceInfo == null) {
            serviceInfo = new AccessibilityServiceInfo();
            serviceInfo.eventTypes = AccessibilityEvent.TYPES_ALL_MASK;
            serviceInfo.notificationTimeout = 100;
            serviceInfo.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
        }

        return serviceInfo;
    }

    private void setServiceInfoToTouchBlockMode() {
        AccessibilityServiceInfo info = getServiceInfo();
        if (info == null) {
            LogUtil.e(TAG, "ServiceInfo为空");
            return;
        }
        info.flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS |
                AccessibilityServiceInfo.FLAG_REQUEST_ENHANCED_WEB_ACCESSIBILITY |
                AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS |
                AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS |
                AccessibilityServiceInfo.DEFAULT |
                AccessibilityServiceInfo.FLAG_REQUEST_TOUCH_EXPLORATION_MODE;

        LogUtil.d(TAG, "辅助功能进入触摸监控模式");
        setServiceInfo(info);
    }

    private void setServiceToNormalMode() {
        AccessibilityServiceInfo info = getServiceInfo();
        if (info == null) {
            LogUtil.e(TAG, "ServiceInfo为空");
            return;
        }
        info.flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS |
                AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS |
                AccessibilityServiceInfo.FLAG_REQUEST_ENHANCED_WEB_ACCESSIBILITY |
                AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS |
                AccessibilityServiceInfo.DEFAULT;

        LogUtil.d(TAG, "辅助功能进入正常模式");
        setServiceInfo(info);
    }

}
