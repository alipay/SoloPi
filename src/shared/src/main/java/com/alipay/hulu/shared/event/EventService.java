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
package com.alipay.hulu.shared.event;

import android.content.Context;
import android.content.Intent;
import android.provider.Settings;
import android.widget.Toast;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.service.base.ExportService;
import com.alipay.hulu.common.service.base.LocalService;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.shared.event.accessibility.AccessibilityEventTracker;
import com.alipay.hulu.shared.event.touch.TouchEventTracker;

import java.lang.ref.WeakReference;

/**
 * Created by qiaoruikai on 2018/10/9 11:08 PM.
 */
@LocalService
public class EventService implements ExportService {
    private TouchEventTracker touchTracker;
    private AccessibilityEventTracker accessibilityTracker;
    private EventProxy proxy;
    private WeakReference<Context> contextRef;

    /**
     * 开启触摸监控（可重入）
     */
    public void startTrackTouch() {
        if (touchTracker == null) {
            touchTracker = new TouchEventTracker();
            touchTracker.registerTouchListener(proxy);

            touchTracker.startTrackTouch();
        } else {
            // 运行状态有问题，重启下
            if (!touchTracker.isTouchTrackRunning()) {
                touchTracker.registerTouchListener(proxy);
                touchTracker.startTrackTouch();
            }
        }
    }

    public void stopTrackTouch() {
        if (touchTracker != null) {
            touchTracker.stopTrackTouch();

            touchTracker = null;
        }
    }

    public void startTrackAccessibilityEvent() {
        Context context = contextRef.get();
        if (context == null) {
            return;
        }

        // 检查Accessibility
        if (!PermissionUtil.isAccessibilitySettingsOn(context)) {
            showEnableAccessibilityServiceHint();
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK
                    | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
            context.startActivity(intent);
            // 当AccessibilityService已启动，修改运行模式
        } else {
            if (accessibilityTracker == null) {
                accessibilityTracker = new AccessibilityEventTracker();
            }

            accessibilityTracker.setAccessibilityListener(proxy);
            accessibilityTracker.startTrackEvent();
        }
    }

    public void stopTrackAccessibilityEvent() {
        if (accessibilityTracker != null) {
            accessibilityTracker.stopTrackEvent();
        }
    }

    @Override
    public void onCreate(Context context) {
        this.contextRef = new WeakReference<>(context);
        proxy = new EventProxy();
    }

    @Override
    public void onDestroy(Context context) {
        // 清理各个引用
        if (touchTracker != null) {
            touchTracker.stopTrackTouch();
            touchTracker = null;
        }

        if (accessibilityTracker != null) {
            accessibilityTracker.stopTrackEvent();
            accessibilityTracker = null;
        }

        if (proxy != null) {
            proxy.destroy();
            proxy = null;
        }
    }

    /**
     * 展示开启辅助功能提示
     */
    private void showEnableAccessibilityServiceHint() {
        LauncherApplication.getInstance().showToast("请在辅助功能中开启Soloπ");
    }
}
