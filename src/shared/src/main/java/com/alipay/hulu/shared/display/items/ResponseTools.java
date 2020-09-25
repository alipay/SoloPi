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
package com.alipay.hulu.shared.display.items;

import android.provider.Settings;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.R;
import com.alipay.hulu.shared.display.items.base.DisplayItem;
import com.alipay.hulu.shared.display.items.base.Displayable;
import com.alipay.hulu.shared.display.items.base.RecordPattern;
import com.alipay.hulu.shared.display.items.data.EventsResponseType;
import com.alipay.hulu.shared.display.items.util.FinalR;
import com.alipay.hulu.shared.event.EventService;
import com.alipay.hulu.shared.event.bean.UniversalEventBean;
import com.alipay.hulu.shared.event.constant.Constant;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Created by cathor on 17/7/25.
 */

@DisplayItem(nameRes = FinalR.RESPONSE_TIME, key = "Response", permissions = {Settings.ACTION_ACCESSIBILITY_SETTINGS})
public class ResponseTools implements Displayable {
    public static final int RES = 1;
    private static final String TAG = "ResponseTools";

    private EventsResponseType eventResponse = new EventsResponseType();
    private static long filter = 3000;

    private String app;

    private InjectorService service;
    private EventService eventService;

    private volatile boolean restartFlag = false;

    private static Long startTime;

    private static List<RecordPattern.RecordItem> responseList;
    private static List<RecordPattern.RecordItem> refreshList;

    @Subscriber(@Param(SubscribeParamEnum.APP))
    public void setApp(String app) {
        this.app = app;
    }


    @Override
    public void startRecord() {
        startTime = System.currentTimeMillis();
        responseList = new ArrayList<>();
        refreshList = new ArrayList<>();
    }

    @Override
    public void record() {

    }

    @Override
    public void start() {
        service = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
        service.register(this);
        eventService = LauncherApplication.getInstance().findServiceByName(EventService.class.getName());
        eventService.startTrackAccessibilityEvent();
    }

    @Override
    public void stop() {
        service.unregister(this);
        service = null;

        eventService.stopTrackAccessibilityEvent();
        eventService = null;
    }

    @Override
    public Map<RecordPattern, List<RecordPattern.RecordItem>> stopRecord() {
        Long endTime = System.currentTimeMillis();
        Map<RecordPattern, List<RecordPattern.RecordItem>> result = new HashMap<>();
        RecordPattern pattern = new RecordPattern("响应耗时", "ms", "Response");
        pattern.setEndTime(endTime);
        pattern.setStartTime(startTime);
        result.put(pattern, responseList);
        pattern = new RecordPattern("刷新耗时", "ms", "Response");
        pattern.setEndTime(endTime);
        pattern.setStartTime(startTime);
        result.put(pattern, refreshList);
        responseList = null;
        refreshList = null;
        return result;
    }

    @Subscriber(@Param(value = Constant.EVENT_ACCESSIBILITY_EVENT, sticky = false))
    public void receiveAccessibilityEvent(UniversalEventBean eventBean) {
        long sendTime = System.currentTimeMillis();
        if (eventBean == null) {
            LogUtil.e(TAG, "收到空EventBean");
            return;
        } else if (eventBean.getParam(Constant.KEY_ACCESSIBILITY_TYPE) == null) {
            LogUtil.e(TAG, "收到的EventBean不包含AccessibilityType信息，无法处理，%s", eventBean);
            return;
        }

        if (!StringUtil.equals((String) eventBean.getParam(Constant.KEY_ACCESSIBILITY_SOURCE), app)) {
            LogUtil.d(TAG, "收到其他来源：%s", eventBean.getParam(Constant.KEY_ACCESSIBILITY_SOURCE));
            return;
        }

        LogUtil.d(TAG, "收到辅助功能事件, %s", eventBean);

        switch ((Integer) eventBean.getParam(Constant.KEY_ACCESSIBILITY_TYPE)) {
            case AccessibilityEvent.TYPE_VIEW_CLICKED:
                processClickEvent(eventBean.getTime());
                break;
            case AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED:
            case AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED:
                processContentChange(eventBean.getTime());
                break;
            default:
                return;
        }

        // 获取节点文案
        AccessibilityNodeInfo node = eventBean.getParam(Constant.KEY_ACCESSIBILITY_NODE);
        String text = "";
        if (node != null) {
            text = StringUtil.toString(node.getText());
        }

        if (responseList != null && refreshList != null) {
            LogUtil.d(TAG, "响应： [%d::%d]",  eventResponse.getResponsDate() - eventResponse.getClickDate(), eventResponse.getRefreshDate() - eventResponse.getClickDate());
            // 响应时间，从点击到第一次窗口变化的时间间隔
            responseList.add(new RecordPattern.RecordItem(sendTime, (float) (eventResponse.getResponsDate() - eventResponse.getClickDate()), text + eventResponse.getOperation()));
            // 刷新时间，从点击到最后一次窗口变化的时间间隔
            refreshList.add(new RecordPattern.RecordItem(sendTime, (float) (eventResponse.getRefreshDate() - eventResponse.getClickDate()), text + eventResponse.getOperation()));
        }
    }

    /**
     * 处理点击事件
     * @param clickTime
     */
    private void processClickEvent(long clickTime) {
        if (clickTime - eventResponse.getClickDate() < 500) {
            return;
        }

        eventResponse.setClickDate(clickTime);
        eventResponse.setResponsDate(clickTime);
        eventResponse.setRefreshDate(clickTime);
        restartFlag = true;
    }

    /**
     * 处理内容变化事件
     * @param changeTime
     */
    private void processContentChange(long changeTime) {
        if ( restartFlag == true )//第一次点击控件或者点击新控件
        {
            // 点击之后的第一次窗口变化时间为响应时间
            eventResponse.setResponsDate(changeTime);
            eventResponse.setRefreshDate(changeTime);
            restartFlag = false;
        }
        else
        {
            // 持续更新刷新时间，直到两次的刷新间隔大于250ms
            if ( changeTime - eventResponse.getRefreshDate() < filter )
            {
                eventResponse.setRefreshDate(changeTime);
            }
        }
    }

    @Override
    public String getCurrentInfo() {
        return "响应耗时: " + (eventResponse.getResponsDate() - eventResponse.getClickDate()) + "ms/刷新耗时: "
                + (eventResponse.getRefreshDate() - eventResponse.getClickDate()) + "ms";
    }

    @Override
    public long getRefreshFrequency() {
        return 250;
    }

    @Override
    public void clear() {
        responseList = null;
        refreshList = null;
    }

    @Override
    public void trigger() {

    }
}
