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

import android.graphics.Point;

import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.shared.event.bean.UniversalEventBean;

import java.util.HashSet;
import java.util.Set;

import static com.alipay.hulu.shared.event.constant.Constant.EVENT_TOUCH_DOWN;
import static com.alipay.hulu.shared.event.constant.Constant.EVENT_TOUCH_POSITION;
import static com.alipay.hulu.shared.event.constant.Constant.EVENT_TOUCH_UP;
import static com.alipay.hulu.shared.event.constant.Constant.KEY_TOUCH_POINT;

public class TouchWrapper {
    private static final String TAG = TouchWrapper.class.getSimpleName();

    private static volatile TouchWrapper _INSTANCE;

    /**
     * 操作100px范围内认为是点击
     */
    private static final int CLICK_RANGE = 100;

    /**
     * 500毫秒以上点击为长按
     */
    private static final long LONG_CLICK_RANGE = 500;

    /**
     * 起始点击位置
     */
    private Point startPos;

    /**
     * 起始时间
     */
    private long startTime;

    /**
     * 当前点击位置
     */
    private Point currentPos;

    /**
     * 当前时间
     */
    private long curTime;

    private boolean listening;

    /**
     * 是否正在运行
     */
    public volatile boolean isRunning;

    /**
     * 手势监听器
     */
    private Set<GestureListener> gestureListeners;

    /**
     * 获取单例
     * @return
     */
    public static TouchWrapper getInstance() {
        if (_INSTANCE == null) {
            synchronized (TouchWrapper.class) {
                if (_INSTANCE == null) {
                    _INSTANCE = new TouchWrapper();
                }
            }
        }

        return _INSTANCE;
    }

    private TouchWrapper() {
        isRunning = false;
        gestureListeners = new HashSet<>();
        listening = false;
    }

    public void start() {
        InjectorService.g().register(this);
        isRunning = true;
    }

    public void stop() {
        InjectorService.g().unregister(this);
        isRunning = false;
    }

    public boolean isRunning() {
        return isRunning;
    }

    @Subscriber(@Param(value = EVENT_TOUCH_DOWN, sticky = false))
    public void receiveTouchDown(UniversalEventBean event) {
        receiveTouchDown(event.getTime());
    }

    /**
     * 收到手指放下事件
     * @param time
     */
    public void receiveTouchDown(long time) {
        // 只关心单点操作
        if (listening) {
            return;
        }

        LogUtil.i(TAG, "Receive Touch down at " + time);
        startPos = null;
        startTime = time;
        listening =true;
    }

    @Subscriber(@Param(value = EVENT_TOUCH_POSITION, sticky = false))
    public void receiveTouchPos(UniversalEventBean event) {
        receiveTouchPosition((Point) event.getParam(KEY_TOUCH_POINT), event.getTime());
    }

    /**
     * 收到touch坐标
     * @param p
     * @param time
     */
    public void receiveTouchPosition(Point p, long time) {
        LogUtil.i(TAG, "Receive Touch position %s at %d", p, time);
        if (!listening) {
            return;
        }

        if (startPos == null) {
            startPos = p;
            startTime = time;
        }

        currentPos = p;
        curTime = time;

        if (curTime - startTime >= LONG_CLICK_RANGE) {
            double distance = calDistance(startPos, currentPos);
            if (distance < CLICK_RANGE) {
                for (GestureListener listener: gestureListeners) {
                    listener.receiveLongClick(currentPos, curTime - startTime);
                }
                listening = false;
            }
        }
    }

    @Subscriber(@Param(value = EVENT_TOUCH_UP, sticky = false))
    public void receiveTouchUp(UniversalEventBean event) {
        receiveTouchUp(event.getTime());
    }

    /**
     * 收到手指抬起事件
     * @param endTime
     */
    public void receiveTouchUp(long endTime) {
        if (!listening) {
            return;
        }

        LogUtil.i(TAG, "Receive up at " + endTime);
        double distance = calDistance(startPos, currentPos);
        if (distance < CLICK_RANGE) {
            if (endTime - startTime < LONG_CLICK_RANGE) {
                for (GestureListener listener: gestureListeners) {
                    listener.receiveClick(currentPos);
                }
            } else {
                for (GestureListener listener: gestureListeners) {
                    listener.receiveLongClick(currentPos, endTime - startTime);
                }
            }
        } else {
            for (GestureListener listener: gestureListeners) {
                listener.receiveScroll(startPos, currentPos, endTime - startTime);
            }
        }

        listening = false;
    }

    public void listen(GestureListener listener) {
        gestureListeners.add(listener);
    }

    public void cancelListen(GestureListener listener) {
        gestureListeners.remove(listener);
    }

    /**
     * 计算
     * @param a
     * @param b
     * @return
     */
    private double calDistance(Point a, Point b) {
        return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + 1);
    }

    /**
     * 手势监听器
     */
    public interface GestureListener {
        void receiveClick(Point p);

        void receiveLongClick(Point p, long time);

        void receiveScroll(Point start, Point end, long time);
    }
}
