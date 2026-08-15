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
package com.alipay.hulu.shared.display;

import android.app.Activity;
import android.content.Context;

import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.service.base.ExportService;
import com.alipay.hulu.common.service.base.LocalService;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.shared.display.items.base.DisplayItem;
import com.alipay.hulu.shared.display.items.base.Displayable;
import com.alipay.hulu.shared.display.items.base.RecordPattern;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Created by qiaoruikai on 2018/10/15 2:27 PM.
 */
@LocalService
public class DisplayProvider implements ExportService {
    private static final String TAG = "DisplayProvider";

    public static final int DISPLAY_MODE = 0;
    public static final int RECORDING_MODE = 1;

    private Map<String, DisplayItemInfo> allDisplayItems;

    private Map<String, DisplayWrapper> runningDisplay;

    private Map<String, String> cachedContent;

    private ScheduledExecutorService scheduledExecutor;

    private ExecutorService executorService;

    private volatile int currentMode = 0;

    private volatile boolean isRunning = false;

    private static long REFRESH_PERIOD = 500;

    private AtomicBoolean startRefresh = new AtomicBoolean(false);

    @Override
    public void onCreate(Context context) {
        this.allDisplayItems = loadDisplayItem();
        runningDisplay = new ConcurrentHashMap<>();
        this.scheduledExecutor = Executors.newSingleThreadScheduledExecutor();
        this.executorService = Executors.newCachedThreadPool();
        this.cachedContent = new ConcurrentHashMap<>();
    }

    @Override
    public void onDestroy(Context context) {
        for (String name: runningDisplay.keySet()) {
            DisplayWrapper wrapper = runningDisplay.get(name);
            wrapper.reference.stop();
        }
        runningDisplay.clear();
        runningDisplay = null;

        if (this.scheduledExecutor != null && !this.scheduledExecutor.isShutdown()) {
            this.scheduledExecutor.shutdownNow();

        }
        this.scheduledExecutor = null;

        if (this.executorService != null && !this.executorService.isShutdown()) {
            this.executorService.shutdownNow();
        }
        this.executorService = null;
    }

    /**
     * 获取显示项列表
     * @return
     */
    public List<DisplayItemInfo> getAllDisplayItems() {
        // 按照名称排序
        ArrayList<String> list = new ArrayList<>(allDisplayItems.keySet());
        Collections.sort(list);

        List<DisplayItemInfo> displayItems = new ArrayList<>(list.size() + 1);
        for (String key : list) {
            displayItems.add(allDisplayItems.get(key));
        }

        return displayItems;
    }

    /**
     * 获取正在运行列表
     * @return
     */
    public Set<String> getRunningDisplayItems() {
        // 按照名称排序

        return runningDisplay.keySet();
    }

    /**
     * 加载所有显示项
     * @return
     */
    private Map<String, DisplayItemInfo> loadDisplayItem() {
        List<Class<? extends Displayable>> allDisplayable = ClassUtil.findSubClass(Displayable.class, DisplayItem.class);

        if (allDisplayable != null && allDisplayable.size() > 0) {
            Map<String, DisplayItemInfo> infoMap = new HashMap<>(allDisplayable.size() + 1);

            // 加载类信息
            for (Class<? extends Displayable> clazz : allDisplayable) {
                DisplayItem annotation = clazz.getAnnotation(DisplayItem.class);
                if (annotation != null) {
                    DisplayItemInfo info = new DisplayItemInfo(annotation, clazz);

                    DisplayItemInfo origin = infoMap.get(info.getKey());
                    if (origin == null) {
                        infoMap.put(info.getKey(), info);
                    } else {
                        // 如果level高于原有的level
                        if (origin.level < info.level) {
                            infoMap.put(info.getKey(), info);
                        }
                    }
                }
            }

            // 返回List
            return infoMap;
        }
        return null;
    }

    /**
     * 开始录制
     */
    public void startRecording() {
        pauseFlag = true;
        for (DisplayWrapper wrapper: runningDisplay.values()) {
            wrapper.startRecord();
        }
        this.currentMode = RECORDING_MODE;
        pauseFlag = false;
    }

    /**
     * 停止录制
     * @return
     */
    public Map<RecordPattern, List<RecordPattern.RecordItem>> stopRecording() {
        pauseFlag = true;
        this.currentMode = DISPLAY_MODE;

        // 强制停止
        executorService.shutdownNow();
        Map<RecordPattern, List<RecordPattern.RecordItem>> result = new HashMap<>();
        for (DisplayWrapper wrapper: runningDisplay.values()) {
            result.putAll(wrapper.stopRecord());
        }

        executorService = Executors.newCachedThreadPool();

        pauseFlag = false;
        return result;
    }

    /**
     * 获取显示项列表
     * @return
     */
    public String getDisplayContent(String name) {
        return cachedContent.get(name);
    }

    /**
     * 触发特定项
     * @param name
     * @return
     */
    public boolean triggerItem(String name) {
        DisplayWrapper wrapper = runningDisplay.get(name);
        if (wrapper != null) {
            wrapper.trigger();
            return true;
        } else {
            return false;
        }
    }

    /** 定时刷新启动器 */
    private Runnable task = new Runnable() {
        public void run() {

            if (runningDisplay.size() == 0) {
                startRefresh.set(false);
                return;
            }

            // 定时500ms后执行
            scheduledExecutor.schedule(this, REFRESH_PERIOD, TimeUnit.MILLISECONDS);

            // 正在运行，或者处于暂停中，不进行操作
            if (isRunning || pauseFlag) {
                return;
            }

            isRunning = true;

            // 调用显示工具刷新方法
            for (Map.Entry<String, DisplayWrapper> entry : runningDisplay.entrySet()) {
                // 对于当前不再显示列表的数据，在显示列表加一行
                DisplayWrapper wrapper = entry.getValue();

                if (wrapper.isRunning) {
                    continue;
                }
                // 当 当前时间 - 上一次刷新时间 > 工具最短刷新时间 时，调用刷新方法
                if (executorService != null && !executorService.isShutdown()) {
                    executorService.execute(getDisplayRunnable(entry.getKey()));
                }
            }
            isRunning = false;
        }
    };

    private volatile boolean pauseFlag = false;

    /***
     * 获取任务执行器
     * @param name 小工具名称
     * @return 执行器
     */
    private Runnable getDisplayRunnable(final String name) {
        return new Runnable() {
            @Override
            public void run() {
                if (pauseFlag) {
                    return;
                }

                DisplayWrapper wrapper = runningDisplay.get(name);
                if (wrapper == null) {
                    return;
                }

                switch (currentMode) {
                    case DISPLAY_MODE:
                        // 实时显示模式，获取显示数据并设置在待显示数据中
                        cachedContent.put(name, wrapper.getContent());
                        // handler.sendEmptyMessage(UPDATE_INFORMATION);
                        break;
                    case RECORDING_MODE:
                        // 录制模式，通知显示工具记录数据
                        wrapper.record();
                        break;
                }
            }
        };
    }

    /**
     * 加载权限
     *
     * @param name
     * @return
     */
    public void checkPermission(String name, Activity activity, PermissionUtil.OnPermissionCallback callback) {
        DisplayItemInfo info = allDisplayItems.get(name);

        if (info == null) {
            LogUtil.e(TAG, "申请空权限");
            return;
        }

        // 申请权限
        PermissionUtil.requestPermissions(info.getPermissions(), activity, callback);
    }

    /**
     * 通过工具类与参数反射生成显示工具并配置参数
     * 工具类需事先 {@link Displayable} 接口，并对需要注入的依赖实现public的设置方法，并在相关方法使用{@link Subscriber}注解
     *
     * @param key 工具类名称
     * @return 显示名称与显示工具
     */
    public boolean startDisplay(String key) {
        DisplayItemInfo displayItemInfo = allDisplayItems.get(key);
        if (displayItemInfo == null) {
            for (DisplayItemInfo info: allDisplayItems.values()) {
                if (info.getName().equals(key)) {
                    displayItemInfo = info;
                    break;
                }
            }
        }

        // 实际启动
        return startDisplay(displayItemInfo);
    }

    private boolean startDisplay(DisplayItemInfo displayItemInfo) {
        if (displayItemInfo == null) {
            LogUtil.e(TAG, "加载空信息");
            return false;
        }

        String name = displayItemInfo.getName();
        if (runningDisplay.containsKey(name)) {
            LogUtil.i(TAG, "显示项【%s】正在运行，不需要启动", name);
            return true;
        }

        Displayable displayable = null;
        try {
            // 查找对应类的无参构造函数

            displayable = ClassUtil.constructClass(displayItemInfo.getTargetClass());
            displayable.start();
            DisplayWrapper wrapper = new DisplayWrapper(displayable);

            runningDisplay.put(name, wrapper);

            // 启动刷新
            if (!startRefresh.getAndSet(true)) {
                scheduledExecutor.schedule(task, 500, TimeUnit.MILLISECONDS);
            }

            return true;
        } catch (Exception e) {
            if (displayable != null) {
                displayable.stop();
            }
            LogUtil.e(TAG, "构造显示项抛出异常", e);
        }
        return false;
    }

    /**
     * 停止特定项
     * @param name
     */
    public void stopDisplay(String name) {
        DisplayWrapper info = runningDisplay.remove(name);

        if (info != null) {
            info.reference.stop();
        }
    }

    /**
     * 停止所有显示项
     */
    public void stopAllDisplay() {
        for (String name: runningDisplay.keySet()) {
            DisplayWrapper wrapper = runningDisplay.get(name);
            wrapper.reference.stop();
        }

        runningDisplay.clear();
    }

    /**
     * 显示项容器
     */
    public static class DisplayWrapper {
        public long lastCallTime = 0L;
        private String previousContent;
        private Displayable reference;
        private long maxSpendTime = 0;
        private final long minSpendTime;
        private int smallCount = 0;
        private volatile boolean isRunning = false;

        DisplayWrapper(Displayable reference) {
            this.reference = reference;
            this.minSpendTime = reference.getRefreshFrequency();
            this.maxSpendTime = minSpendTime;
        }

        public void trigger() {
            reference.trigger();
        }

        public void startRecord() {
            reference.startRecord();
        }

        public Map<RecordPattern, List<RecordPattern.RecordItem>> stopRecord() {
            isRunning = true;
            Map<RecordPattern, List<RecordPattern.RecordItem>> records = reference.stopRecord();
            isRunning = false;
            return records;
        }

        public String getContent() {
            if (isRunning) {
                return previousContent;
            }

            // 自动降速
            if (System.currentTimeMillis() - lastCallTime < maxSpendTime) {
                return previousContent;
            }

            long startTime = System.currentTimeMillis();
            isRunning = true;
            lastCallTime = startTime;
            try {
                previousContent = reference.getCurrentInfo();
            } catch (Throwable throwable) {
                LogUtil.e(TAG, throwable, "调用Displayable【%s】抛出异常", reference);
            }
            isRunning = false;

            // 一次调用时间
            long spendTime = System.currentTimeMillis() - startTime;
            LogUtil.d(TAG, "调用【%s】耗时%dms", reference.getClass().getSimpleName(), spendTime);
            if (spendTime > maxSpendTime) {
                maxSpendTime = spendTime;
                smallCount = 0;

            // 小于一半
            } else if (spendTime < maxSpendTime / 2) {
                smallCount ++;

                if (smallCount >= 2) {
                    maxSpendTime = minSpendTime;
                }
            }

            return previousContent;
        }

        public void record() {
            if (isRunning) {
                return;
            }

            // 自动降速
            if (System.currentTimeMillis() - lastCallTime < maxSpendTime) {
                return;
            }

            long startTime = System.currentTimeMillis();
            lastCallTime = startTime;
            isRunning = true;
            try {
                reference.record();
            } catch (Throwable t) {
                LogUtil.e(TAG, t, "调用Displayable【%s】record抛出异常", reference);
            }
            isRunning = false;

            // 一次调用时间
            long spendTime = System.currentTimeMillis() - startTime;
            if (spendTime > maxSpendTime) {
                maxSpendTime = spendTime;
                smallCount = 0;

                // 小于一半
            } else if (spendTime < maxSpendTime / 2) {
                smallCount ++;

                if (smallCount >= 2) {
                    maxSpendTime = minSpendTime;
                }
            }
        }
    }
}
