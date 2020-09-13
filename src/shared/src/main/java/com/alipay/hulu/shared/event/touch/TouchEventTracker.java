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

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.tools.CmdLine;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.event.constant.Constant;

import java.io.IOException;
import java.lang.ref.WeakReference;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import static android.view.Surface.ROTATION_0;
import static android.view.Surface.ROTATION_180;
import static android.view.Surface.ROTATION_270;

/**
 * getevent监控
 * Created by cathor on 2017/12/20.
 */
public class TouchEventTracker {
    private static final String TAG = "TouchEventTracker";

    private volatile TouchListener touchListener;

    private ScheduledExecutorService touchCmdExecutor;

    private static final int WAIT_TOUCH_FILTER = 300 * 1000;

    private InjectorService injectorService;

    /**
     * Event Reader
     */
    private StreamReadRunnable readRunnable;

    public TouchEventTracker() {
        injectorService = LauncherApplication.getInstance()
                .findServiceByName(InjectorService.class.getName());
    }

    /**
     * touchtrack是否活着
     * @return
     */
    public boolean isTouchTrackRunning() {
        return touchCmdExecutor != null && !touchCmdExecutor.isShutdown() &&
                readRunnable != null && readRunnable.cmdLine != null &&
                !readRunnable.cmdLine.isClosed();
    }

    /**
     * 启动触摸事件跟踪
     */
    public void startTrackTouch() {
        // 清理之前引用
        if (touchCmdExecutor != null && !touchCmdExecutor.isShutdown()) {
            touchCmdExecutor.shutdownNow();
        }

        touchCmdExecutor = Executors.newSingleThreadScheduledExecutor();
        touchCmdExecutor.execute(new Runnable() {
            @Override
            public void run() {
                CmdLine cmdLine = CmdTools.openCmdLine();

                if (cmdLine == null) {
                    LogUtil.e(TAG, "无法开启CmdLine，稍后重试，确认高权限是否获取");
                    // 重试
                    touchCmdExecutor.schedule(this, 3000, TimeUnit.MILLISECONDS);
                    return;
                }

                if (readRunnable == null) {
                    // 启动触摸监听
                    readRunnable = new StreamReadRunnable(TouchEventTracker.this, cmdLine);
                } else {
                    readRunnable.useNewCmdLine(cmdLine);
                }
                touchCmdExecutor.schedule(readRunnable, 500, TimeUnit.MILLISECONDS);
            }
        });
    }

    /**
     * 中止触摸跟踪
     */
    public void stopTrackTouch() {
        if (readRunnable != null) {
            BackgroundExecutor.execute(new Runnable() {
                @Override
                public void run() {
                    readRunnable.stopCmdLine();
                }
            });
        }

        if (touchCmdExecutor != null) {
            touchCmdExecutor.shutdownNow();
            touchCmdExecutor = null;
        }
    }

    /**
     * 注册触摸监听器
     * @param listener
     */
    public void registerTouchListener(TouchListener listener) {
        this.touchListener = listener;
    }

    /**
     * 内部通知新触摸事件
     * @param time 事件时间
     * @param point 时间坐标
     */
    private void receiveNewTouch(long time, Point point) {
        if (touchListener == null) {
            return;
        }

        touchListener.notifyTouchEvent(point, time);
    }

    /**
     * 内部通知新触摸事件
     * @param time 事件时间
     */
    private void receiveTouchDown(long time) {
        if (touchListener == null) {
            return;
        }

        touchListener.notifyTouchStart(time);
    }

    /**
     * 内部通知新触摸事件
     * @param time 事件时间
     */
    private void receiveTouchUp(long time) {
        if (touchListener == null) {
            return;
        }

        touchListener.notifyTouchEnd(time);
    }

    /**
     * 读取event的Runnable
     */
    static class StreamReadRunnable implements Runnable {
        private WeakReference<TouchEventTracker> handlerRef;
        private CmdLine cmdLine;
        private boolean[] waitForXY = {false, false};
        private int[] xy = new int[2];
        private float xFactor = 0f;
        private float yFactor = 0f;
        private Map<String, float[]> devicesFactors;

        private Point screenSize;
        private long deviceStartTime = 0L;
        private int defaultScreenRotation = 0;
        private boolean changeRotation = false;

        /**
         * 默认竖屏
         */
        private int currentOrientation = ROTATION_0;

        /**
         * 初始化时执行getevent
         * @param handler
         * @param cmdLine
         */
        public StreamReadRunnable(TouchEventTracker handler, CmdLine cmdLine) {
            this.handlerRef = new WeakReference<>(handler);
            this.cmdLine = cmdLine;
            calculatePosFactor();
            cmdLine.writeCommand("getevent -lt " + "\n");

            InjectorService.g().register(this);

            defaultScreenRotation = SPService.getInt(SPService.KEY_SCREEN_FACTOR_ROTATION, 0);
            changeRotation = SPService.getBoolean(SPService.KEY_SCREEN_ROTATION, false);
            currentOrientation = (ROTATION_0 + defaultScreenRotation) % 4;
        }

        /**
         * 关闭命令行
         */
        public void stopCmdLine() {
            if (cmdLine != null && !cmdLine.isClosed()) {
                try {
                    cmdLine.close();
                } catch (IOException e) {
                    LogUtil.e(TAG, "Catch java.io.IOException: " + e.getMessage(), e);
                }
            }

            // 保证命令行为空
            cmdLine = null;
        }

        @Subscriber(@Param(LauncherApplication.SCREEN_ORIENTATION))
        public void setScreenOrientation(int orientation) {
            this.currentOrientation = (orientation + defaultScreenRotation) % 4;

            LogUtil.d(TAG, "更新屏幕旋转方向为： " + orientation);
        }

        /**
         * 使用新的命令行
         * @param cmdLine
         */
        public void useNewCmdLine(CmdLine cmdLine) {
            stopCmdLine();

            // 重新开启获取事件
            this.cmdLine = cmdLine;
            cmdLine.writeCommand("getevent -lt " + "\n");
        }

        /**
         * 分别计算缩放
         */
        private void calculatePosFactor() {
            // 获取各个设备的分辨率
            Map<String, Point> deviceContent = calculateDeviceSize();

            LogUtil.w("lezhou", "device resolution:" + deviceContent);

            if (deviceContent.size() > 0) {
                int screenWidth = -1;
                int screenHeight = -1;

                // 计算当前屏幕的分辨率
                String result = CmdTools.execHighPrivilegeCmd("wm size", 3000);
                LogUtil.d("hahaha", result);

                String[] lines = result.split("\\n");
                String info = null;
                if (lines.length >= 1) {
                    for (String line : lines) {
                        if (line.contains("Physical size")) {
                            info = line;
                        } else if (line.contains("Override size")) {
                            info = line;
                            break;
                        }
                    }
                }

                if (info != null) {
                    String[] fields = info.split(":");
                    if (fields.length == 2) {
                        String express = fields[1];
                        String[] dimension = express.split("x");
                        if (dimension.length == 2) {
                            try {
                                screenWidth = Integer.parseInt(dimension[0].trim());
                                screenHeight = Integer.parseInt(dimension[1].trim());
                            } catch (NumberFormatException e) {
                                LogUtil.e(TAG, e.toString());
                            }
                        }
                    }
                }

                LogUtil.w("lezhou", "sw:" + screenWidth);
                LogUtil.w("lezhou", "sh:" + screenHeight);

                screenSize = new Point(screenWidth, screenHeight);

                // 当获取到的高宽可用
                if (screenHeight > 0 && screenWidth > 0) {
                    devicesFactors = new HashMap<>(deviceContent.size() + 1);

                    // 设置屏幕factors
                    for (String key : deviceContent.keySet()) {
                        Point deviceWH = deviceContent.get(key);
                        float[] factors = {screenWidth * 1.0f / deviceWH.x,
                                screenHeight * 1.0f / deviceWH.y};
                        LogUtil.i(TAG, String.format("load factor for device: %s is (%.2f, %.2f)", key, factors[0], factors[1]));
                        devicesFactors.put(key, factors);
                    }
                }
            }
        }

        /**
         * 获取设备多个size
         * @return
         */
        private Map<String, Point> calculateDeviceSize() {
            String result = CmdTools.execHighPrivilegeCmd("getevent -p", 2000);
            LogUtil.d(TAG, "getevent -p: " + result);
            String[] lines = result.split("\\n");

            Map<String, Point> devices = new HashMap<>();

            // 数据结构：
            //
            //add device 8: /dev/input/event4
            //  name:     "fts"
            //  events:
            //    KEY (0001): 0011  0012  0018  002e  0032  0067  0069  006a
            //                008b  008f  009e  00ac  00f9  00fa  00fc
            //    ABS (0003): 002f  : value 0, min 0, max 10, fuzz 0, flat 0, resolution 0
            //                0030  : value 0, min 0, max 127, fuzz 0, flat 0, resolution 0
            //                0035  : value 0, min 0, max 1440, fuzz 0, flat 0, resolution 0
            //                0036  : value 0, min 0, max 2560, fuzz 0, flat 0, resolution 0
            //                0039  : value 0, min 0, max 10, fuzz 0, flat 0, resolution 0
            //                003a  : value 0, min 0, max 63, fuzz 0, flat 0, resolution 0
            //  input props:
            //    INPUT_PROP_DIRECT

            // 状态码
            // 0: 等待
            // 1: 加载到device
            // 2: 等待设置w, h
            int currentState = 0;
            String currentDevice = null;
            Point currentWH = null;

            try {
                for (int i = 0; i < lines.length; i++) {
                    String line = lines[i];

                    // 包含add device，声明设备
                    if (StringUtil.contains(line, "add device")) {

                        // 如果已有其他设备配置好
                        if (currentDevice != null && currentWH != null && currentWH.x > 0 && currentWH.y > 0) {
                            devices.put(currentDevice, currentWH);

                            currentDevice = null;
                            currentWH = null;
                        }

                        // 确定设备
                        String[] device = StringUtil.split(line, ":");
                        if (device == null || device.length < 2) {
                            continue;
                        }
                        currentState = 1;
                        currentDevice = device[1].trim();
                        continue;

                        // 配置文件前部信息
                    } else if (StringUtil.contains(line, "events:")) {
                        if (currentState != 1) {
                            continue;
                        }
                        currentState = 2;
                        currentWH = new Point(0, 0);
                        continue;
                    }

                    // 对于需要加载数值
                    if (currentState == 2) {
                        int pos;
                        if (StringUtil.contains(line, "0035")) {
                            pos = 0;
                        } else if (StringUtil.contains(line, "0036")) {
                            pos = 1;
                        } else {
                            continue;
                        }

                        // 如果point不存在
                        if (currentWH == null) {
                            continue;
                        }

                        String[] fields = StringUtil.split(line, ",");

                        int min = -1;
                        int max = -1;

                        for (String field : fields) {
                            field = field.trim();
                            if (field.contains("min")) {
                                String[] paras = field.split(" ");
                                if (paras.length == 2) {
                                    min = Integer.parseInt(paras[1]);
                                }
                            } else if (field.contains("max")) {
                                String[] paras = field.split(" ");
                                if (paras.length == 2) {
                                    max = Integer.parseInt(paras[1]);
                                }
                            }
                        }

                        int value = max - min;
                        if (pos == 0) {
                            currentWH.x = value;
                        } else if (pos == 1) {
                            currentWH.y = value;
                        }
                    }
                }

                // 未添加的东西
                if (currentDevice != null && currentWH != null && currentWH.x > 0 && currentWH.y > 0) {
                    devices.put(currentDevice, currentWH);
                }
            } catch (NumberFormatException e) {
                LogUtil.e(TAG, e.toString());
            }
            return devices;
        }

        long lastUpActionTime = 0L;
        long lastDownActionTime = 0L;

        @Override
        public void run() {
            // handler没了，说明被回收了
            TouchEventTracker tracker = handlerRef.get();
            if (tracker == null) {
                return;
            }

            // 没人订阅，等下次再看
            int downCount = tracker.injectorService.getReferenceCount(Constant.EVENT_TOUCH_DOWN);
            int positionCount = tracker.injectorService.getReferenceCount(Constant.EVENT_TOUCH_POSITION);
            int upCount = tracker.injectorService.getReferenceCount(Constant.EVENT_TOUCH_UP);
            if (downCount <= 0 && positionCount <= 0 && upCount <= 0) {
                // 只有在stream还能存在的情况才会进行读取
                tracker.touchCmdExecutor.schedule(this, 500, TimeUnit.MILLISECONDS);
                return;
            }

            // 预检查
            if (!envCheck()) {
                tracker.touchCmdExecutor.schedule(this, 10, TimeUnit.SECONDS);
                return;
            }

            // 解析当前触摸事件
            String content;
            CmdLine.CmdLineReader reader = cmdLine.getReader();
            while ((content = reader.readLine()) != null) {
                parseSingleLine(content, tracker);
            }
        }

        /**
         * 运行环境检查
         * @return
         */
        private boolean envCheck() {
            long startTime = System.currentTimeMillis();
            int count = 0;

            // 尝试恢复三次
            while ((cmdLine == null || cmdLine.isClosed()) && count < 3) {
                try {
                    LogUtil.w(TAG, "ADB无法连接");

                    // 尝试恢复Stream
                    cmdLine = CmdTools.openCmdLine();
                    if (cmdLine != null) {
                        cmdLine.writeCommand("getevent -lt" + "\n");
                    }
                } catch (Exception e) {
                    LogUtil.e(TAG, "初始化流抛出异常", e);
                }

                count ++;
            }

            // adb完全挂了，stream无法恢复，等10s，看看SoloPi的15s的adb保活是否有用
            if (cmdLine == null || cmdLine.isClosed()) {
                LogUtil.e(TAG, "Stream can't recover from dead");
                return false;
            }
            return true;
        }

        /**
         * 解析getEvent
         * @param result
         * @param tracker
         */
        private void doContentParse(String result, TouchEventTracker tracker) {
            // 每500ms读一次消息
            try {
                // 只有在stream还能存在的情况才会进行读取
                String[] lines = result.split("\n");


                for (String line : lines) {
                    parseSingleLine(line, tracker);
                }
                //LogUtil.i(TAG, "Touch Manager Cost time " + (System.currentTimeMillis() - startTime));
            } catch (Throwable t) {
                LogUtil.e(TAG, "监听抛出异常，需要检查", t);
            }
        }

        /**
         * 解析单行数据
         * @param line
         * @param tracker
         */
        private void parseSingleLine(String line, TouchEventTracker tracker) {
            try {
                if (line.contains("ABS_MT_TRACKING_ID")) {
                    // 抬起事件
                    if (line.contains("ffffff")) {
                        // 防止重复触发事件
                        long upTime = getEventMicroSecond(line);
                        // 防止重复触发事件
                        if (upTime - lastUpActionTime < WAIT_TOUCH_FILTER) {
                            return;
                        }

                        lastUpActionTime = upTime;

                        LogUtil.w(TAG, "Tracking line: " + line);
                        tracker.receiveTouchUp(upTime);
                    } else {
                        // 根据DOWN消息来确定是否有点击
                        // 出现DOWN消息后找ABS_MS_POSITION_X 和 ABS_MT_POSITION_Y来获取点击位置
                        // OnePlus A3010点击是BTN_TOOL_FINGER...
                        long downTime = getEventMicroSecond(line);
                        // 防止重复触发事件
                        if (downTime - lastDownActionTime < WAIT_TOUCH_FILTER) {
                            return;
                        }

                        lastDownActionTime = downTime;

                        if (xFactor == 0f || yFactor == 0f) {
                            reloadFactor(line);
                        }
                        LogUtil.i(TAG, line);
                        waitForXY = new boolean[]{true, true};
                        tracker.receiveTouchDown(downTime);
                    }
                } else if (line.contains("BTN_TOUCH")) {
                    if (line.contains("UP")) {
                        // 防止重复触发事件
                        long upTime = getEventMicroSecond(line);
                        // 防止重复触发事件
                        if (upTime - lastUpActionTime < WAIT_TOUCH_FILTER) {
                            return;
                        }

                        lastUpActionTime = upTime;

                        LogUtil.w(TAG, "Tracking line: " + line);
                        tracker.receiveTouchUp(upTime);
                    } else if (line.contains("DOWN")) {
                        long downTime = getEventMicroSecond(line);
                        // 防止重复触发事件
                        if (downTime - lastDownActionTime < WAIT_TOUCH_FILTER) {
                            return;
                        }

                        lastDownActionTime = downTime;

                        if (xFactor == 0f || yFactor == 0f) {
                            reloadFactor(line);
                        }
                        LogUtil.i(TAG, line);
                        waitForXY = new boolean[]{true, true};
                        tracker.receiveTouchDown(downTime);
                    }
                } else if (waitForXY[0] && line.contains("ABS_MT_POSITION_X")) {
                    LogUtil.i(TAG, line);
                    String[] splited = line.split("ABS_MT_POSITION_X");
                    String x = splited[splited.length - 1].trim();
                    xy[0] = (int) (Integer.parseInt(x, 16) * xFactor);
                    waitForXY[0] = false;

                    LogUtil.w("lezhou", "xfactor:" + xFactor);

                    LogUtil.w("lezhou", "x: " + (xy[0]));

                    // 如果xy都找到了，发送消息
                    sendIfPossible(line);
                } else if (waitForXY[1] && line.contains("ABS_MT_POSITION_Y")) {
                    LogUtil.i(TAG, line);
                    String[] splited = line.split("ABS_MT_POSITION_Y");
                    String y = splited[splited.length - 1].trim();
                    xy[1] = (int) (Integer.parseInt(y, 16) * yFactor);
                    waitForXY[1] = false;

                    LogUtil.w("lezhou", "y: " + xy[1]);

                    // 如果xy都找到了，发送消息
                    sendIfPossible(line);
                }
            } catch (Throwable t) {
                LogUtil.e(TAG, "Fail to parse line " + line, t);
            }
        }

        /**
         * 获取事件时间
         * @param line
         * @return
         */
        private long getEventMicroSecond(String line) {
            // 来自 https://source.android.com/devices/input/getevent
            // 注意：getevent 时间戳采用 CLOCK_MONOTONIC 时基，并使用 $SECONDS.$MICROSECONDS 格式。有关详情，请参阅 getevent.c。
            LogUtil.i(TAG, "Event Line: %s", line);
            String content = line.split("]")[0].trim();

            // 魅族比较特殊
            // FLYME_HIPS_DEBUG:30,0 [    9837.628329] /dev/input/event8: EV_KEY       BTN_TOUCH            DOWN
            if (content.startsWith("[")) {
                content = content.substring(1).replace(".", "");
            } else {
                content = content.split("\\[")[1].replace(".", "");
            }

            // 加上开机时间
            return Long.parseLong(content.trim()) + getTimeDiffInMicron(System.currentTimeMillis());
        }

        /**
         * 重载X、Y的缩放比
         * @param line
         */
        private void reloadFactor(String line) {
            // 如果没有加载到任何设备
            if (devicesFactors == null || devicesFactors.size() == 0) {
                xFactor = 1f;
                yFactor = 1f;
            }

            // 根据device查找目标分辨率
            String[] splitted = StringUtil.split(line, ":");
            LogUtil.e(TAG, "Factor: " + line);
            if (splitted.length > 1) {
                String device = splitted[0];
                if (StringUtil.contains(device, "]")) {
                    device = device.split("]")[1];
                }
                float[] factors = devicesFactors.get(device.trim());

                // 设置对应设备的分辨率
                if (factors != null) {
                    xFactor = factors[0];
                    yFactor = factors[1];
                } else {
                    xFactor = 1f;
                    yFactor = 1f;
                }

                // 推送出去设备相关信息
                if (handlerRef.get() != null) {
                    InjectorService injectorService = handlerRef.get().injectorService;
                    injectorService.pushMessage(Constant.EVENT_TOUCH_DEVICE, device.trim());
                    injectorService.pushMessage(Constant.EVENT_TOUCH_DEVICE_FACTOR_X, xFactor);
                    injectorService.pushMessage(Constant.EVENT_TOUCH_DEVICE_FACTOR_Y, yFactor);
                }


                LogUtil.i(TAG, String.format("Use factor (%.2f, %.2f) for device %s", xFactor, yFactor, device));
            } else {
                xFactor = 1f;
                yFactor = 1f;
            }
        }

        /**
         * 根据Down情况发送点击消息
         */
        private void sendIfPossible(String line) {
            if (!waitForXY[0] && !waitForXY[1]) {
                Point p;
                // 横屏模式下，x、y坐标切换
                if (currentOrientation == ROTATION_0) {
                    p = new Point(xy[0], xy[1]);
                } else if (currentOrientation == ROTATION_270) {
                    p = new Point(screenSize.y - xy[1], xy[0]);
                } else if (currentOrientation == ROTATION_180) {
                    p = new Point(screenSize.x - xy[0], screenSize.y - xy[1]);
                } else {
                    p = new Point(xy[1], screenSize.x - xy[0]);
                }

                if (changeRotation) {
                    float divide = screenSize.x / (float) screenSize.y;
                    p.x = (int) (p.x * divide);
                    p.y = (int) (p.y / divide);
                }

                // 获取毫秒级时间
                long eventTime = getEventMicroSecond(line);
                handlerRef.get().receiveNewTouch(eventTime, p);
            }
        }
    }

    /**
     * 获取CLOCK_MONOTONIC与
     */
    public static native long getTimeDiffInMicron(long currentTime);

    /**
     * 触摸监听器
     */
    public interface TouchListener {
        void notifyTouchStart(long microSecond);
        void notifyTouchEvent(Point p, long microSecond);
        void notifyTouchEnd(long microSecond);
    }
}

