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
package com.alipay.hulu.common.service;

import com.alipay.hulu.common.bean.ContinueGesture;
import com.alipay.hulu.common.service.base.ExportService;

/**
 * Created by qiaoruikai on 2019/11/26 9:43 PM.
 */
public interface TouchService extends ExportService {
    /**
     * 点击
     * @param x
     * @param y
     */
    public void click(int x, int y);

    /**
     * 长按
     * @param x
     * @param y
     * @param pressTime
     */
    public void press(int x, int y, int pressTime);

    /**
     * 滑动
     * @param x1
     * @param y1
     * @param x2
     * @param y2
     */
    public void scroll(int x1, int y1, int x2, int y2, int scrollTime);

    /**
     * 拖动
     * @param x1
     * @param y1
     * @param dragTime
     * @param x2
     * @param y2
     * @param scrollTime
     */
    public void drag(int x1, int y1, int dragTime, int x2, int y2, int scrollTime);

    /**
     * 连续手势操作
     * @param gesture
     */
    public void gesture(ContinueGesture gesture);

    /**
     * 缩放
     * @param x
     * @param y
     * @param sourceRadio
     * @param toRadio
     * @param time
     */
    public void pinch(int x, int y, int sourceRadio, int toRadio, int time);

    /**
     * 多手势
     * @param gestures
     */
    public void multiGesture(ContinueGesture[] gestures);

    /**
     * 开始
     */
    public void start();

    /**
     * 结束
     */
    public void stop();

    /**
     * 是否支持高级手势
     * @return
     */
    public boolean supportGesture();
}
