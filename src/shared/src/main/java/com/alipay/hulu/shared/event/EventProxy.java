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

import android.graphics.Point;
import android.view.accessibility.AccessibilityNodeInfo;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.injector.provider.Provider;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.shared.event.accessibility.AccessibilityEventTracker;
import com.alipay.hulu.shared.event.bean.UniversalEventBean;
import com.alipay.hulu.shared.event.constant.Constant;
import com.alipay.hulu.shared.event.touch.TouchEventTracker;

import java.util.concurrent.TimeUnit;

/**
 * Created by qiaoruikai on 2018/10/9 4:45 PM.
 */
@Provider(value = {@Param(value = Constant.EVENT_TOUCH_POSITION, type = UniversalEventBean.class, sticky = false),
        @Param(value = Constant.EVENT_TOUCH_DOWN, type = UniversalEventBean.class, sticky = false),
        @Param(value = Constant.EVENT_TOUCH_UP, type = UniversalEventBean.class, sticky = false),
        @Param(value = Constant.EVENT_ACCESSIBILITY_GESTURE, type = UniversalEventBean.class, sticky = false),
        @Param(value = Constant.EVENT_ACCESSIBILITY_EVENT, type = UniversalEventBean.class, sticky = false),})
public class EventProxy implements TouchEventTracker.TouchListener, AccessibilityEventTracker.AccessibilityListener {
    private static final String TAG = "EventProxy";

    private InjectorService service;

    public EventProxy() {
        service = LauncherApplication.getInstance()
                .findServiceByName(InjectorService.class.getName());
    }

    @Override
    public void onAccessibilityEvent(long time, int eventType, AccessibilityNodeInfo node, String source) {
        UniversalEventBean eventBean = new UniversalEventBean();
        eventBean.setEventType(Constant.EVENT_ACCESSIBILITY_EVENT);
        eventBean.setTime(time);
        eventBean.setParam(Constant.KEY_ACCESSIBILITY_TYPE, eventType);
        eventBean.setParam(Constant.KEY_ACCESSIBILITY_SOURCE, source);
        eventBean.setParam(Constant.KEY_ACCESSIBILITY_NODE, node);
        LogUtil.d(TAG, "发送辅助功能事件type=%d,target=%d", eventType, 0x00000080);
        service.pushMessage(Constant.EVENT_ACCESSIBILITY_EVENT, eventBean);
    }

    @Override
    public void onGesture(int gesture) {
        UniversalEventBean eventBean = new UniversalEventBean();
        eventBean.setEventType(Constant.EVENT_ACCESSIBILITY_GESTURE);
        eventBean.setTime(System.currentTimeMillis());
        eventBean.setParam(Constant.KEY_GESTURE_TYPE, gesture);
        service.pushMessage(Constant.EVENT_ACCESSIBILITY_GESTURE, eventBean, true);
    }

    @Override
    public void notifyTouchStart(long microSecond) {
        UniversalEventBean eventBean = new UniversalEventBean();
        eventBean.setEventType(Constant.EVENT_TOUCH_DOWN);
        eventBean.setTime(microSecond, TimeUnit.MICROSECONDS);
        service.pushMessage(Constant.EVENT_TOUCH_DOWN, eventBean, true);
    }

    @Override
    public void notifyTouchEvent(Point p, long microSecond) {
        UniversalEventBean eventBean = new UniversalEventBean();
        eventBean.setEventType(Constant.EVENT_TOUCH_POSITION);
        eventBean.setTime(microSecond, TimeUnit.MICROSECONDS);
        eventBean.setParam(Constant.KEY_TOUCH_POINT, p);
        service.pushMessage(Constant.EVENT_TOUCH_POSITION, eventBean, true);
    }

    @Override
    public void notifyTouchEnd(long microSecond) {
        UniversalEventBean eventBean = new UniversalEventBean();
        eventBean.setEventType(Constant.EVENT_TOUCH_UP);
        eventBean.setTime(microSecond, TimeUnit.MICROSECONDS);
        service.pushMessage(Constant.EVENT_TOUCH_UP, eventBean, true);
    }

    /**
     * 销毁引用
     */
    public void destroy() {
        service.unregister(this);
    }
}
