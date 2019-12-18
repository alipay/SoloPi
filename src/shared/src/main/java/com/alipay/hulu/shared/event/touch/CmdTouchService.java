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
package com.alipay.hulu.shared.event.touch;

import android.content.Context;
import android.os.Build;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.bean.ContinueGesture;
import com.alipay.hulu.common.service.TouchService;
import com.alipay.hulu.common.service.base.LocalService;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.LogUtil;

/**
 * Created by qiaoruikai on 2019/12/2 2:22 PM.
 */
@LocalService(name = "com.alipay.hulu.common.service.TouchService")
public class CmdTouchService implements TouchService {
    private static final String TAG = "CmdTouchService";

    @Override
    public void click(int x, int y) {
        CmdTools.execClick(x, y);
    }

    @Override
    public void press(int x, int y, int pressTime) {
        scroll(x, y, x + 1, y + 1, pressTime);
    }

    @Override
    public void scroll(int x1, int y1, int x2, int y2, int scrollTime) {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.JELLY_BEAN_MR2) {
            CmdTools.execHighPrivilegeCmd("input swipe " + x1 + " " + y1 + " " + x2 + " " + y2);
        } else {
            CmdTools.execHighPrivilegeCmd("input swipe " + x1 + " " + y1 + " " + x2 + " " + y2 + " " + scrollTime);
        }
    }

    @Override
    public void drag(int x1, int y1, int dragTime, int x2, int y2, int scrollTime) {
        LogUtil.e(TAG, "Drag not supported");
        LauncherApplication.getInstance().showToast("CmdTouch不支持拖动");
    }

    @Override
    public void gesture(ContinueGesture gesture) {
        LogUtil.e(TAG, "Gesture not supported");
        LauncherApplication.getInstance().showToast("CmdTouch不支持手势");
    }

    @Override
    public void pinch(int x, int y, int sourceRadio, int toRadio, int time) {
        LogUtil.e(TAG, "Pinch not supported");
        LauncherApplication.getInstance().showToast("CmdTouch不支持缩放");
    }

    @Override
    public void multiGesture(ContinueGesture[] gestures) {
        LogUtil.e(TAG, "Multi-Gesture not supported");
        LauncherApplication.getInstance().showToast("CmdTouch不支持多指手势");
    }

    @Override
    public boolean supportGesture() {
        return false;
    }

    @Override
    public void start() {

    }

    @Override
    public void stop() {

    }

    @Override
    public void onCreate(Context context) {

    }

    @Override
    public void onDestroy(Context context) {

    }
}
