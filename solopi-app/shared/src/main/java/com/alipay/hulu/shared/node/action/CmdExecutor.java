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

import android.os.Looper;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.bean.ContinueGesture;
import com.alipay.hulu.common.service.TouchService;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.shared.event.touch.CmdTouchService;
import com.android.permission.rom.RomUtils;

import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * Created by qiaoruikai on 2018/10/8 8:51 PM.
 */
public class CmdExecutor {
    private ExecutorService executorService;
    private TouchService touchService;

    private int clickType = OperationExecutor.CLICK_TYPE_ADB_TAP;
    private String touchDevice;
    private float factorX = 1;
    private float factorY = 1;

    /**
     * 通用Click事件
     */
    private static final String NORMAL_CLICK_EVENT = "sendevent %1$s 1 330 1 && " +
            "sendevent %1$s 1 325 1 && sendevent %1$s 3 57 111 && sendevent %1$s 3 53 %2$d && " +
            "sendevent %1$s 3 54 %3$d && sendevent %1$s 0 0 0 && sendevent %1$s 3 57 4294967295 &&" +
            " sendevent %1$s 1 330 0 && sendevent %1$s 1 325 0 && sendevent %1$s 0 0 0";

    /**
     * OPPO的Click事件
     */
    private static final String OPPO_CLICK_EVENT = "sendevent %1$s 3 57 111 &&" +
            " sendevent %1$s 1 330 1 && sendevent %1$s 1 325 1 && sendevent %1$s 3 53 %2$d && " +
            "sendevent %1$s 3 54 %3$d && sendevent %1$s 0 0 0 && sendevent %1$s 3 57 4294967295 && " +
            "sendevent %1$s 1 330 0 &&  sendevent %1$s 1 325 0 &&  sendevent %1$s 0 0 0";

    private static final String SONY_CLICK_EVENT = "sendevent %1$s 3 57 111 && " +
            "sendevent %1$s 3 55 0 && sendevent %1$s 3 53 %2$d && sendevent %1$s 3 54 %3$d && " +
            "sendevent %1$s 3 58 20 && sendevent %1$s 0 2 0 && sendevent %1$s 0 0 0 && " +
            "sendevent %1$s 3 57 4294967295 && sendevent %1$s 0 2 0 && sendevent %1$s 0 0 0";

    private static final String VIVO_CLICK_EVENT = "sendevent %1$s 1 330 1 &&" +
            " sendevent %1$s 1 325 1 && sendevent %1$s 3 47 0 && sendevent %1$s 3 57 111 && " +
            "sendevent %1$s 3 53 %2$d && sendevent %1$s 3 54 %3$d && sendevent %1$s 3 58 20 && " +
            "sendevent %1$s 0 0 0 && sendevent %1$s 3 57 4294967295 && sendevent %1$s 1 330 0 && " +
            "sendevent %1$s 1 325 0 && sendevent %1$s 0 0 0";

    private static final String GOOGLE_CLICK_EVENT = "sendevent %1$s 3 57 111 && " +
            "sendevent %1$s 1 330 1 && sendevent %1$s 1 325 1 && sendevent %1$s 3 53 %2$d && " +
            "sendevent %1$s 3 54 %3$d && sendevent %1$s 3 58 20 && sendevent %1$s 0 0 0 && " +
            "sendevent %1$s 3 57 4294967295 && sendevent %1$s 1 330 0 &&  sendevent %1$s 1 325 0 && " +
            "sendevent %1$s 0 0 0";

    /**
     * 华为的Click事件
     */
    private static final String HUAWEI_CLICK_EVENT = "sendevent %1$s 3 58 10 &&" +
            " sendevent %1$s 3 53 %2$d && sendevent %1$s 3 54 %3$d && sendevent %1$s 3 57 0 && " +
            "sendevent %1$s 0 2 0 && sendevent %1$s 1 330 1 && sendevent %1$s 0 0 0 && " +
            "sendevent %1$s 1 330 0 &&  sendevent %1$s 0 0 0";

    private static final String MEIZU_CLICK_EVENT = "sendevent %1$s 3 57 111 && " +
            "sendevent %1$s 3 58 20 && sendevent %1$s 3 53 %2$d && sendevent %1$s 3 54 %3$d && " +
            "sendevent %1$s 0 2 0 && sendevent %1$s 1 330 1 && sendevent %1$s 0 0 0 && " +
            "sendevent %1$s 1 330 0 && sendevent %1$s 0 0 0";

    public CmdExecutor() {
        this.executorService = new ThreadPoolExecutor(0, Integer.MAX_VALUE,
                0, TimeUnit.MILLISECONDS,
                new SynchronousQueue<Runnable>());
        touchService = LauncherApplication.service(TouchService.class);
    }

    public void setClickType(int clickType) {
        this.clickType = clickType;
    }

    public void setTouchDevice(String touchDevice) {
        this.touchDevice = touchDevice;
    }

    public void setFactorX(float factorX) {
        this.factorX = factorX;
    }

    public void setFactorY(float factorY) {
        this.factorY = factorY;
    }

    /**
     * 执行缩放
     * @param x 中心X
     * @param y 中心Y
     * @param fromDis 起始距离
     * @param toDis 重点距离
     * @param duration 耗时
     * @return
     */
    public boolean executePinch(int x, int y, int fromDis, int toDis, int duration) {
        if (touchService.supportGesture()) {
            touchService.pinch(x, y, fromDis, toDis, duration);
            return true;
        }

        return false;
    }

    /**
     * 是否支持手势操作
     * @return
     */
    public boolean supportGesture() {
        return touchService.supportGesture();
    }

    /**
     * 执行手势操作
     * @param gesture
     */
    public boolean executeGesture(ContinueGesture gesture) {
        if (touchService.supportGesture()) {
            touchService.gesture(gesture);
            return true;
        }

        return false;
    }

    public boolean executePress(int x, int y, int duration) {
        if (touchService.supportGesture()) {
            touchService.press(x, y, duration);
            return true;
        }
        return false;
    }

    /**
     * 执行adb命令
     * @param cmd
     */
    public void executeCmd(final String cmd) {
        if (Looper.getMainLooper() == Looper.myLooper()) {
            executorService.execute(new Runnable() {
                @Override
                public void run() {
                    CmdTools.execAdbCmd(cmd, 0);
                }
            });
        } else {
            CmdTools.execAdbCmd(cmd, 0);
        }
    }

    /**
     * 执行滑动
     * @param fromX
     * @param fromY
     * @param toX
     * @param toY
     * @param duration
     */
    public void executeScroll(int fromX, int fromY, int toX, int toY, int duration) {
        touchService.scroll(fromX, fromY, toX, toY, duration);
    }

    /**
     * 执行滑动
     * @param fromX
     * @param fromY
     * @param toX
     * @param toY
     * @param duration
     */
    public void executeScrollSync(int fromX, int fromY, int toX, int toY, int duration) {
        touchService.scroll(fromX, fromY, toX, toY, duration);
    }

    /**
     * 执行点击操作
     * @param x
     * @param y
     */
    public void executeClick(int x, int y) {
        if (!(touchService instanceof CmdTouchService)) {
            touchService.click(x, y);
            return;
        }
        String cmd;
        if (clickType == OperationExecutor.CLICK_TYPE_ADB_TAP) {
            touchService.click(x, y);
        } else {
            int realX = (int) (x / factorX);
            int realY = (int) (y / factorY);

            // 不同厂商device格式有些差异
            if (RomUtils.checkIsHuaweiRom()) {
                cmd = String.format(Locale.CHINA, HUAWEI_CLICK_EVENT, touchDevice, realX, realY);
            } else if (RomUtils.isOppoSystem()) {
                cmd = String.format(Locale.CHINA, OPPO_CLICK_EVENT, touchDevice, realX, realY);
            } else if (RomUtils.isSonySystem()) {
                cmd = String.format(Locale.CHINA, SONY_CLICK_EVENT, touchDevice, realX, realY);
            } else if (RomUtils.isVivoSystem()) {
                cmd = String.format(Locale.CHINA, VIVO_CLICK_EVENT, touchDevice, realX, realY);
            } else if (RomUtils.checkIsMeizuRom()) {
                cmd = String.format(Locale.CHINA, MEIZU_CLICK_EVENT, touchDevice, realX, realY);
            } else if (RomUtils.isGoogleSystem()) {
                cmd = String.format(Locale.CHINA, GOOGLE_CLICK_EVENT, touchDevice, realX, realY);
            } else {
                cmd = String.format(Locale.CHINA, NORMAL_CLICK_EVENT, touchDevice, realX, realY);
            }

            // 这个需要保证同步执行，即使是在主线程上
            executeCmdSync(cmd);

            // 再等500ms，防止没点击完毕
            MiscUtil.sleep(1000);
        }
    }

    /**
     * 异步执行点击
     * @param x
     * @param y
     */
    public void executeClickAsync(final int x, final int y) {
        executorService.execute(new Runnable() {
            @Override
            public void run() {
                executeClick(x, y);
            }
        });
    }

    /**
     * 异步执行adb命令
     * @param cmd
     */
    public void executeCmdAsync(final String cmd) {
        executorService.execute(new Runnable() {
            @Override
            public void run() {
                CmdTools.execAdbCmd(cmd, 0);
            }
        });
    }

    /**
     * 异步执行adb命令
     * @param cmd
     * @param maxTime 最长执行时间
     */
    public void executeCmdAsync(final String cmd, final int maxTime) {
        executorService.execute(new Runnable() {
            @Override
            public void run() {
                CmdTools.execAdbCmd(cmd, maxTime);
            }
        });
    }

    /**
     * 执行adb命令
     * @param cmd
     * @param maxTime 最大执行时间
     */
    public void executeCmd(final String cmd, final int maxTime) {
        if (Looper.getMainLooper() == Looper.myLooper()) {
            executorService.execute(new Runnable() {
                @Override
                public void run() {
                    CmdTools.execAdbCmd(cmd, maxTime);
                }
            });
        } else {
            CmdTools.execAdbCmd(cmd, maxTime);
        }
    }

    /**
     * 同步执行adb命令
     * @param cmd
     */
    public String executeCmdSync(final String cmd) {
        return CmdTools.execAdbCmd(cmd, 0);
    }

    /**
     * 同步执行adb命令
     * @param cmd
     * @param maxTime 最大执行时间
     */
    public String executeCmdSync(final String cmd, int maxTime) {
        return CmdTools.execAdbCmd(cmd, maxTime);
    }

    /**
     * 执行runnable
     * @param runnable
     */
    public Future<?> execute(Runnable runnable) {
        return executorService.submit(runnable);
    }
}
