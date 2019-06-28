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

import android.view.accessibility.AccessibilityEvent;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.shared.event.bean.UniversalEventBean;
import com.alipay.hulu.shared.event.constant.Constant;

/**s
 * Created by qiaoruikai on 2018/11/13 12:34 PM.
 */
public class ContentChangeWatcher {
    private static final String TAG = "ContentWatcher";
    private long lastWatchingTime = 0L;

    private long filterTime = 1000L;

    public void start() {
        InjectorService injector = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
        injector.register(this);
    }

    public void stop() {
        InjectorService injector = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
        injector.unregister(this);
    }

    @Subscriber(@Param(value = Constant.EVENT_ACCESSIBILITY_EVENT, sticky = false))
    public void onAccessibilityEvent(UniversalEventBean eventBean) {
        Integer eventType = eventBean.getParam(Constant.KEY_ACCESSIBILITY_TYPE);
        LogUtil.d(TAG, "【ChangeWatcher】收到辅助功能事件=%d", eventType);
        if (eventType != null) {
            switch (eventType) {
                case AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED:
                case AccessibilityEvent.TYPE_WINDOWS_CHANGED:
                    lastWatchingTime = System.currentTimeMillis();
                    break;
            }
        }
    }

    /**
     * 设置窗口变化监控时间
     * @param filterTime
     */
    public void setFilterTime(long filterTime) {
        this.filterTime = filterTime;
    }

    /**
     * 等待sleep结束
     *
     */
    public void sleepUntilContentDontChange() {
        // 先注册监听event消息
        long start = System.currentTimeMillis();

        // 每100ms查看一次，直到窗口不再变化
        for (int i = 0; i < 100; i++) {
            MiscUtil.sleep(100);

            // 等待窗口变化结束
            if (lastWatchingTime != -1 && System.currentTimeMillis() - lastWatchingTime > filterTime) {
                break;
            }
        }

        // 至少等500ms
        long waitTime = System.currentTimeMillis() - start;
        if (waitTime < 500) {
            MiscUtil.sleep(500 - waitTime);
        }

        LogUtil.i(TAG, "等待窗口变化结束时间: %dms", (System.currentTimeMillis() - start));
    }
}