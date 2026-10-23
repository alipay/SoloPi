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
import com.alipay.hulu.common.utils.RuntimeSessionGuard;
import com.alipay.hulu.shared.display.items.base.DisplayItem;
import com.alipay.hulu.shared.display.items.base.Displayable;
import com.alipay.hulu.shared.display.items.base.RecordPattern;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Created by qiaoruikai on 2018/10/15 2:27 PM.
 */
@LocalService
public class DisplayProvider implements ExportService {
    private static final String TAG = "DisplayProvider";
    private static final String RUNTIME_SESSION_OWNER_PREFIX = "performance-display:";

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

    /** 每个服务实例独占一个门闩 owner，避免热重启后的新实例释放旧实例门闩。 */
    private final String runtimeSessionOwner =
            RUNTIME_SESSION_OWNER_PREFIX + UUID.randomUUID().toString();

    /** 协议录制持有的不透明租约；非租约入口不能改动它拥有的显示项。 */
    private RecordingLease activeRecordingLease;

    /** 协议实时监控持有的不透明租约；旧 UI 入口不能改动它拥有的显示项。 */
    private DisplayLease activeDisplayLease;

    /** 构造或启动失败且 stop 也失败的实例，保留引用以阻止门闩被错误释放。 */
    private final List<Displayable> quarantinedDisplayables = new ArrayList<>();

    @Override
    public void onCreate(Context context) {
        this.allDisplayItems = loadDisplayItem();
        runningDisplay = new ConcurrentHashMap<>();
        this.scheduledExecutor = Executors.newSingleThreadScheduledExecutor();
        this.executorService = Executors.newCachedThreadPool();
        this.cachedContent = new ConcurrentHashMap<>();
    }

    @Override
    public synchronized void onDestroy(Context context) {
        pauseFlag = true;
        forceStopAllDisplay();

        if (this.scheduledExecutor != null && !this.scheduledExecutor.isShutdown()) {
            this.scheduledExecutor.shutdownNow();

        }
        this.scheduledExecutor = null;

        if (this.executorService != null && !this.executorService.isShutdown()) {
            this.executorService.shutdownNow();
        }
        this.executorService = null;
        pauseFlag = false;
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
    public synchronized Set<String> getRunningDisplayItems() {
        return new HashSet<>(runningDisplay.keySet());
    }

    /**
     * 返回当前协议录制租约的真实服务所有者。
     *
     * <p>LauncherApplication 暴露的是可重启服务代理；代理会把该调用转发给当前
     * DisplayProvider 实例，因此这里返回的 {@code this} 可以随租约一起保存，避免
     * 服务重启后停止请求被转发到新的实例。</p>
     */
    public DisplayProvider getRecordingSessionOwner() {
        return this;
    }

    /** 返回当前性能服务实例，供实时监控会话保存稳定所有者。 */
    public DisplayProvider getSessionOwner() {
        return this;
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
    public synchronized void startRecording() {
        if (activeRecordingLease != null || activeDisplayLease != null) {
            LogUtil.w(TAG, "协议性能会话期间忽略旧入口的开始录制请求");
            return;
        }
        pauseFlag = true;
        try {
            for (DisplayWrapper wrapper: runningDisplay.values()) {
                wrapper.startRecord();
            }
            this.currentMode = RECORDING_MODE;
        } finally {
            pauseFlag = false;
        }
    }

    /**
     * 停止录制
     * @return
     */
    public synchronized Map<RecordPattern, List<RecordPattern.RecordItem>> stopRecording() {
        if (activeRecordingLease != null || activeDisplayLease != null) {
            LogUtil.w(TAG, "协议性能会话期间忽略旧入口的停止录制请求");
            return Collections.emptyMap();
        }
        pauseFlag = true;
        this.currentMode = DISPLAY_MODE;

        // 强制停止
        executorService.shutdownNow();
        Map<RecordPattern, List<RecordPattern.RecordItem>> result = new HashMap<>();
        try {
            for (DisplayWrapper wrapper: runningDisplay.values()) {
                result.putAll(wrapper.stopRecord());
            }
        } finally {
            if (scheduledExecutor != null && !scheduledExecutor.isShutdown()) {
                executorService = Executors.newCachedThreadPool();
            } else {
                executorService = null;
            }
            pauseFlag = false;
        }
        return result;
    }

    /**
     * 获取显示项列表
     * @return
     */
    public synchronized String getDisplayContent(String name) {
        DisplayWrapper wrapper = runningDisplay.get(name);
        if (isOwnedByActiveSession(name, wrapper)) {
            return null;
        }
        return cachedContent.get(name);
    }

    /**
     * 同步读取一个非协议租约显示项。
     *
     * <p>协议租约使用 {@code getCurrentDisplayContents} 返回最近缓存并触发后台刷新，
     * 避免控制请求等待可能阻塞的设备采样。</p>
     */
    public synchronized String getCurrentDisplayContent(String name) {
        DisplayWrapper wrapper = runningDisplay.get(name);
        if (wrapper == null || isOwnedByActiveSession(name, wrapper)) {
            return null;
        }
        return wrapper.getContent();
    }

    /** 读取租约拥有的当前值；过期租约不能读取后来创建的同名显示项。 */
    public Map<String, String> getCurrentDisplayContents(RecordingLease lease) {
        Map<String, DisplayWrapper> displays;
        ExecutorService refreshExecutor;
        synchronized (this) {
            if (lease == null || lease != activeRecordingLease) {
                return Collections.emptyMap();
            }
            displays = snapshotOwnedDisplays(lease.displays);
            refreshExecutor = lease.stopInProgress ? null : executorService;
        }
        return readCurrentDisplayContents(displays, refreshExecutor);
    }

    /** 读取实时监控租约拥有的当前值；过期租约不能读取后来创建的同名显示项。 */
    public Map<String, String> getCurrentDisplayContents(DisplayLease lease) {
        Map<String, DisplayWrapper> displays;
        ExecutorService refreshExecutor;
        synchronized (this) {
            if (lease == null || lease != activeDisplayLease) {
                return Collections.emptyMap();
            }
            displays = snapshotOwnedDisplays(lease.displays);
            refreshExecutor = lease.stopInProgress ? null : executorService;
        }
        return readCurrentDisplayContents(displays, refreshExecutor);
    }

    /** 调用方持有 provider 锁时复制租约仍拥有的 wrapper。 */
    private Map<String, DisplayWrapper> snapshotOwnedDisplays(
            Map<String, DisplayWrapper> leasedDisplays) {
        Map<String, DisplayWrapper> result = new LinkedHashMap<>();
        for (Map.Entry<String, DisplayWrapper> entry : leasedDisplays.entrySet()) {
            String name = entry.getKey();
            DisplayWrapper wrapper = runningDisplay.get(name);
            if (wrapper == entry.getValue()) {
                result.put(name, wrapper);
            }
        }
        return result;
    }

    private Map<String, String> readCurrentDisplayContents(
            Map<String, DisplayWrapper> displays, ExecutorService refreshExecutor) {
        Map<String, String> result = new LinkedHashMap<>();
        for (Map.Entry<String, DisplayWrapper> entry : displays.entrySet()) {
            DisplayWrapper wrapper = entry.getValue();
            result.put(entry.getKey(), wrapper.getCachedContent());
            wrapper.refreshContentIfIdle(refreshExecutor);
        }
        return result;
    }

    /**
     * 触发特定项
     * @param name
     * @return
     */
    public synchronized boolean triggerItem(String name) {
        DisplayWrapper wrapper = runningDisplay.get(name);
        if (wrapper != null && !isOwnedByActiveSession(name, wrapper)) {
            wrapper.trigger();
            return true;
        } else {
            return false;
        }
    }

    /** 定时刷新启动器 */
    private Runnable task = new Runnable() {
        public void run() {
            synchronized (DisplayProvider.this) {
                if (runningDisplay.size() == 0) {
                    startRefresh.set(false);
                    return;
                }

                // 与 startDisplay 共用 provider 锁，避免停止后快速重启时分裂出多条刷新链。
                try {
                    scheduledExecutor.schedule(this, REFRESH_PERIOD, TimeUnit.MILLISECONDS);
                } catch (RuntimeException exception) {
                    startRefresh.set(false);
                    LogUtil.w(TAG, "无法调度下一次性能刷新", exception);
                    return;
                }
            }

            // 正在运行，或者处于暂停中，不进行操作
            if (isRunning || pauseFlag) {
                return;
            }

            isRunning = true;
            try {
                ExecutorService refreshExecutor = executorService;
                if (refreshExecutor == null || refreshExecutor.isShutdown()) {
                    return;
                }

                // 调用显示工具刷新方法
                for (Map.Entry<String, DisplayWrapper> entry : runningDisplay.entrySet()) {
                    DisplayWrapper wrapper = entry.getValue();
                    if (wrapper.isRunning) {
                        continue;
                    }
                    try {
                        refreshExecutor.execute(getDisplayRunnable(entry.getKey(), wrapper));
                    } catch (RuntimeException exception) {
                        LogUtil.w(TAG, "无法提交性能刷新任务", exception);
                        break;
                    }
                }
            } finally {
                isRunning = false;
            }
        }
    };

    private volatile boolean pauseFlag = false;

    /***
     * 获取任务执行器
     * @param name 小工具名称
     * @return 执行器
     */
    private Runnable getDisplayRunnable(final String name, final DisplayWrapper wrapper) {
        return new Runnable() {
            @Override
            public void run() {
                if (pauseFlag || runningDisplay.get(name) != wrapper) {
                    return;
                }

                switch (currentMode) {
                    case DISPLAY_MODE:
                        // 实时显示模式，获取显示数据并设置在待显示数据中
                        String content = wrapper.getContent();
                        if (runningDisplay.get(name) == wrapper) {
                            cachedContent.put(name, content);
                        }
                        // handler.sendEmptyMessage(UPDATE_INFORMATION);
                        break;
                    case RECORDING_MODE:
                        // 录制模式，通知显示工具记录数据
                        if (runningDisplay.get(name) == wrapper) {
                            wrapper.record();
                        }
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
    public synchronized boolean startDisplay(String key) {
        return startDisplay(findDisplayItem(key));
    }

    /**
     * 原子取得一组显示项并进入协议实时监控模式。
     *
     * <p>返回值绑定到实际显示实例，名称相同但实例不同的后续任务不能复用该租约。
     * 启动失败且资源未能立即清理时返回 cleanup-only 租约，调用方必须保留它并用
     * 同一租约重试停止。</p>
     */
    public synchronized DisplayLease startDisplaySessionIfIdle(List<String> keys) {
        if (keys == null || keys.isEmpty() || activeRecordingLease != null
                || activeDisplayLease != null || !runningDisplay.isEmpty()) {
            return null;
        }
        retryQuarantinedDisplayables();
        if (!quarantinedDisplayables.isEmpty()) {
            return null;
        }
        releaseRuntimeGuardIfIdle();

        List<DisplayItemInfo> requested = new ArrayList<>(keys.size());
        Set<String> names = new LinkedHashSet<>();
        for (String key : keys) {
            DisplayItemInfo info = findDisplayItem(key);
            if (info == null) {
                return null;
            }
            if (names.add(info.getName())) {
                requested.add(info);
            }
        }
        if (!RuntimeSessionGuard.beginSession(runtimeSessionOwner)) {
            LogUtil.w(TAG, "插件维护期间不能启动性能实时监控");
            return null;
        }

        pauseFlag = true;
        Map<String, DisplayWrapper> candidates = new LinkedHashMap<>();
        Displayable pendingDisplayable = null;
        try {
            for (DisplayItemInfo info : requested) {
                pendingDisplayable = ClassUtil.constructClass(info.getTargetClass());
                if (pendingDisplayable == null) {
                    throw new IllegalStateException("无法构造性能显示项: " + info.getName());
                }
                DisplayWrapper wrapper = new DisplayWrapper(pendingDisplayable);
                candidates.put(info.getName(), wrapper);
                pendingDisplayable = null;
                wrapper.start();
            }
            if (!ensureRefreshScheduled()) {
                throw new IllegalStateException("无法启动性能刷新任务");
            }

            DisplayLease lease = new DisplayLease(candidates);
            runningDisplay.putAll(candidates);
            activeDisplayLease = lease;
            currentMode = DISPLAY_MODE;
            return lease;
        } catch (Throwable throwable) {
            LogUtil.e(TAG, "原子启动性能实时监控失败", throwable);
            boolean cleanupComplete = true;
            Map<String, DisplayWrapper> failedWrappers = new LinkedHashMap<>();
            List<Displayable> failedDisplayables = new ArrayList<>();
            List<Map.Entry<String, DisplayWrapper>> entries =
                    new ArrayList<>(candidates.entrySet());
            Collections.reverse(entries);
            for (Map.Entry<String, DisplayWrapper> entry : entries) {
                DisplayWrapper wrapper = entry.getValue();
                if (wrapper.stop()) {
                    if (runningDisplay.get(entry.getKey()) == wrapper) {
                        runningDisplay.remove(entry.getKey());
                    }
                    cachedContent.remove(entry.getKey());
                } else {
                    wrapper.quarantine();
                    runningDisplay.put(entry.getKey(), wrapper);
                    failedWrappers.put(entry.getKey(), wrapper);
                    cleanupComplete = false;
                }
            }
            if (pendingDisplayable != null) {
                try {
                    pendingDisplayable.stop();
                } catch (Throwable stopError) {
                    quarantinedDisplayables.add(pendingDisplayable);
                    failedDisplayables.add(pendingDisplayable);
                    cleanupComplete = false;
                    LogUtil.w(TAG, "回滚未包装的性能显示项失败", stopError);
                }
            }
            currentMode = DISPLAY_MODE;
            if (cleanupComplete && runningDisplay.isEmpty()) {
                RuntimeSessionGuard.endSession(runtimeSessionOwner);
            } else {
                activeDisplayLease = DisplayLease.forCleanup(
                        failedWrappers, new ArrayList<>(names), failedDisplayables,
                        "性能实时监控启动失败: " + throwable.getMessage());
                LogUtil.e(TAG, "性能显示项回滚未完成，保留运行门闩等待再次清理");
            }
            return activeDisplayLease;
        } finally {
            pauseFlag = false;
        }
    }

    /**
     * 原子取得一组显示项并直接进入录制模式。
     *
     * <p>返回值是不可由名称伪造的实例租约。租约存活期间，旧 UI/回放入口不能停止、
     * 重建或切换这些显示项，避免同名实例 ABA 被协议误认。若启动失败且资源未能立即
     * 清理，返回的租约会标记为 cleanup-only，调用方必须保留它并重试停止。</p>
     */
    public synchronized RecordingLease startRecordingSessionIfIdle(List<String> keys) {
        if (keys == null || keys.isEmpty() || activeRecordingLease != null
                || activeDisplayLease != null
                || !runningDisplay.isEmpty()) {
            return null;
        }
        retryQuarantinedDisplayables();
        if (!quarantinedDisplayables.isEmpty()) {
            return null;
        }
        releaseRuntimeGuardIfIdle();

        List<DisplayItemInfo> requested = new ArrayList<>(keys.size());
        Set<String> names = new LinkedHashSet<>();
        for (String key : keys) {
            DisplayItemInfo info = findDisplayItem(key);
            if (info == null) {
                return null;
            }
            if (names.add(info.getName())) {
                requested.add(info);
            }
        }
        if (!RuntimeSessionGuard.beginSession(runtimeSessionOwner)) {
            LogUtil.w(TAG, "插件维护期间不能启动性能录制");
            return null;
        }

        pauseFlag = true;
        Map<String, DisplayWrapper> candidates = new LinkedHashMap<>();
        Displayable pendingDisplayable = null;
        try {
            for (DisplayItemInfo info : requested) {
                pendingDisplayable = ClassUtil.constructClass(info.getTargetClass());
                if (pendingDisplayable == null) {
                    throw new IllegalStateException("无法构造性能显示项: " + info.getName());
                }
                DisplayWrapper wrapper = new DisplayWrapper(pendingDisplayable);
                candidates.put(info.getName(), wrapper);
                pendingDisplayable = null;
                wrapper.start();
            }
            for (DisplayWrapper wrapper : candidates.values()) {
                wrapper.startRecord();
            }
            if (!ensureRefreshScheduled()) {
                throw new IllegalStateException("无法启动性能刷新任务");
            }

            RecordingLease lease = new RecordingLease(candidates);
            runningDisplay.putAll(candidates);
            activeRecordingLease = lease;
            currentMode = RECORDING_MODE;
            return lease;
        } catch (Throwable throwable) {
            LogUtil.e(TAG, "原子启动性能录制失败", throwable);
            boolean cleanupComplete = true;
            Map<String, DisplayWrapper> failedWrappers = new LinkedHashMap<>();
            List<Displayable> failedDisplayables = new ArrayList<>();
            List<Map.Entry<String, DisplayWrapper>> entries =
                    new ArrayList<>(candidates.entrySet());
            Collections.reverse(entries);
            for (Map.Entry<String, DisplayWrapper> entry : entries) {
                DisplayWrapper wrapper = entry.getValue();
                if (wrapper.stop()) {
                    if (runningDisplay.get(entry.getKey()) == wrapper) {
                        runningDisplay.remove(entry.getKey());
                    }
                    cachedContent.remove(entry.getKey());
                } else {
                    wrapper.quarantine();
                    runningDisplay.put(entry.getKey(), wrapper);
                    failedWrappers.put(entry.getKey(), wrapper);
                    cleanupComplete = false;
                }
            }
            if (pendingDisplayable != null) {
                try {
                    pendingDisplayable.stop();
                } catch (Throwable stopError) {
                    quarantinedDisplayables.add(pendingDisplayable);
                    failedDisplayables.add(pendingDisplayable);
                    cleanupComplete = false;
                    LogUtil.w(TAG, "回滚未包装的性能显示项失败", stopError);
                }
            }
            currentMode = DISPLAY_MODE;
            if (cleanupComplete && runningDisplay.isEmpty()) {
                RuntimeSessionGuard.endSession(runtimeSessionOwner);
            } else {
                activeRecordingLease = RecordingLease.forCleanup(
                        failedWrappers, new ArrayList<>(names), failedDisplayables,
                        "性能录制启动失败: " + throwable.getMessage());
                LogUtil.e(TAG, "性能显示项回滚未完成，保留运行门闩等待再次清理");
            }
            return activeRecordingLease;
        } finally {
            pauseFlag = false;
        }
    }

    private boolean ensureRefreshScheduled() {
        if (startRefresh.getAndSet(true)) {
            return true;
        }
        try {
            if (scheduledExecutor == null || scheduledExecutor.isShutdown()) {
                startRefresh.set(false);
                return false;
            }
            scheduledExecutor.schedule(task, REFRESH_PERIOD, TimeUnit.MILLISECONDS);
            return true;
        } catch (RuntimeException exception) {
            startRefresh.set(false);
            LogUtil.w(TAG, "无法调度性能刷新", exception);
            return false;
        }
    }

    private DisplayItemInfo findDisplayItem(String key) {
        DisplayItemInfo displayItemInfo = allDisplayItems.get(key);
        if (displayItemInfo == null) {
            for (DisplayItemInfo info: allDisplayItems.values()) {
                if (info.getName().equals(key)) {
                    displayItemInfo = info;
                    break;
                }
            }
        }
        return displayItemInfo;
    }

    private synchronized boolean startDisplay(DisplayItemInfo displayItemInfo) {
        if (displayItemInfo == null) {
            LogUtil.e(TAG, "加载空信息");
            return false;
        }
        if (activeRecordingLease != null || activeDisplayLease != null) {
            LogUtil.w(TAG, "协议性能会话期间不能启动旧入口显示项");
            return false;
        }
        retryQuarantinedDisplayables();
        if (!quarantinedDisplayables.isEmpty()) {
            LogUtil.w(TAG, "隔离显示项尚未清理，不能启动新的性能显示项");
            return false;
        }
        releaseRuntimeGuardIfIdle();

        String name = displayItemInfo.getName();
        if (runningDisplay.containsKey(name)) {
            LogUtil.i(TAG, "显示项【%s】正在运行，不需要启动", name);
            return true;
        }

        boolean acquiredSession = false;
        if (runningDisplay.isEmpty()) {
            if (!RuntimeSessionGuard.beginSession(runtimeSessionOwner)) {
                LogUtil.w(TAG, "插件维护期间不能启动性能显示项");
                return false;
            }
            acquiredSession = true;
        }

        Displayable displayable = null;
        DisplayWrapper wrapper = null;
        boolean started = false;
        try {
            // 查找对应类的无参构造函数

            displayable = ClassUtil.constructClass(displayItemInfo.getTargetClass());
            if (displayable == null) {
                throw new IllegalStateException("无法构造性能显示项: " + name);
            }
            wrapper = new DisplayWrapper(displayable);
            wrapper.start();

            runningDisplay.put(name, wrapper);

            // 启动刷新
            if (!ensureRefreshScheduled()) {
                throw new IllegalStateException("无法启动性能刷新任务");
            }

            started = true;
            return true;
        } catch (Throwable e) {
            LogUtil.e(TAG, "构造显示项抛出异常", e);
            return false;
        } finally {
            if (!started) {
                if (wrapper != null && runningDisplay.get(name) == wrapper) {
                    runningDisplay.remove(name);
                }
                boolean cleanupComplete = true;
                if (wrapper != null && !wrapper.stop()) {
                    wrapper.quarantine();
                    runningDisplay.put(name, wrapper);
                    cleanupComplete = false;
                } else if (wrapper == null && displayable != null) {
                    try {
                        displayable.stop();
                    } catch (Throwable stopError) {
                        cleanupComplete = false;
                        quarantinedDisplayables.add(displayable);
                        LogUtil.w(TAG, "回滚显示项失败", stopError);
                    }
                }
                if (cleanupComplete && isCompletelyIdle()) {
                    if (acquiredSession) {
                        RuntimeSessionGuard.endSession(runtimeSessionOwner);
                    }
                } else if (!cleanupComplete) {
                    LogUtil.e(TAG, "显示项回滚未完成，保留运行门闩等待再次清理");
                }
            }
        }
    }

    /** 使用租约停止协议实时监控；失败项会保留，调用方可用同一租约重试。 */
    public DisplayStopResult stopDisplaySession(DisplayLease lease) {
        synchronized (this) {
            if (lease == null || lease != activeDisplayLease) {
                return DisplayStopResult.notMatched("性能实时监控租约已失效");
            }
            if (lease.stopInProgress) {
                return new DisplayStopResult(true, false, "性能实时监控停止处理中");
            }
            lease.stopInProgress = true;
            pauseFlag = true;
        }

        List<String> errors = new ArrayList<>();
        Map<String, DisplayWrapper> stoppedWrappers = new LinkedHashMap<>();
        List<Displayable> cleanedDisplayables = new ArrayList<>();
        try {
            for (Map.Entry<String, DisplayWrapper> entry : lease.displays.entrySet()) {
                String name = entry.getKey();
                DisplayWrapper wrapper = runningDisplay.get(name);
                if (wrapper == null) {
                    continue;
                }
                if (wrapper != entry.getValue()) {
                    errors.add("清理显示项所有权已变化: " + name);
                    continue;
                }
                if (wrapper.stop()) {
                    stoppedWrappers.put(name, wrapper);
                } else {
                    errors.add("清理显示项失败: " + name);
                }
            }

            List<Displayable> pendingDisplayables =
                    new ArrayList<>(lease.cleanupDisplayables);
            for (Displayable displayable : pendingDisplayables) {
                try {
                    displayable.stop();
                    cleanedDisplayables.add(displayable);
                } catch (Throwable throwable) {
                    errors.add("清理未包装显示项失败");
                    LogUtil.w(TAG, "再次清理未包装性能显示项失败", throwable);
                }
            }

            synchronized (this) {
                for (Map.Entry<String, DisplayWrapper> entry : stoppedWrappers.entrySet()) {
                    if (runningDisplay.get(entry.getKey()) == entry.getValue()) {
                        runningDisplay.remove(entry.getKey());
                        cachedContent.remove(entry.getKey());
                    }
                }
                for (Displayable displayable : cleanedDisplayables) {
                    lease.cleanupDisplayables.remove(displayable);
                    removeQuarantinedDisplayable(displayable);
                }

                boolean cleanupComplete = lease.cleanupDisplayables.isEmpty();
                for (Map.Entry<String, DisplayWrapper> entry : lease.displays.entrySet()) {
                    if (runningDisplay.get(entry.getKey()) == entry.getValue()) {
                        cleanupComplete = false;
                        break;
                    }
                }
                if (cleanupComplete && activeDisplayLease == lease) {
                    activeDisplayLease = null;
                    releaseRuntimeGuardIfIdle();
                }
                String resultError = errors.isEmpty() ? lease.startError : errors.toString();
                return new DisplayStopResult(true, cleanupComplete, resultError);
            }
        } finally {
            synchronized (this) {
                lease.stopInProgress = false;
                pauseFlag = false;
            }
        }
    }

    /** 使用租约停止协议录制；失败项会保留，调用方可使用同一租约重试。 */
    public RecordingStopResult stopRecordingSession(RecordingLease lease) {
        ExecutorService oldExecutor;
        synchronized (this) {
            if (lease == null || lease != activeRecordingLease) {
                return RecordingStopResult.notMatched("性能录制租约已失效");
            }
            if (lease.stopInProgress) {
                return new RecordingStopResult(true, false, false,
                        Collections.<RecordPattern,
                            List<RecordPattern.RecordItem>>emptyMap(),
                        "性能录制停止处理中");
            }
            lease.stopInProgress = true;
            pauseFlag = true;
            currentMode = DISPLAY_MODE;
            oldExecutor = executorService;
            executorService = null;
        }

        List<String> errors = new ArrayList<>();
        Map<String, DisplayWrapper> stoppedWrappers = new LinkedHashMap<>();
        List<Displayable> cleanedDisplayables = new ArrayList<>();
        RecordingStopResult result;
        try {
            if (oldExecutor != null) {
                oldExecutor.shutdownNow();
            }
            if (lease.cleanupOnly) {
                for (Map.Entry<String, DisplayWrapper> entry : lease.displays.entrySet()) {
                    String name = entry.getKey();
                    DisplayWrapper wrapper = runningDisplay.get(name);
                    if (wrapper == null) {
                        continue;
                    }
                    if (wrapper != entry.getValue()) {
                        errors.add("清理显示项所有权已变化: " + name);
                        continue;
                    }
                    if (wrapper.stop()) {
                        stoppedWrappers.put(name, wrapper);
                    } else {
                        errors.add("清理显示项失败: " + name);
                    }
                }

                List<Displayable> pendingDisplayables =
                        new ArrayList<>(lease.cleanupDisplayables);
                for (Displayable displayable : pendingDisplayables) {
                    try {
                        displayable.stop();
                        cleanedDisplayables.add(displayable);
                    } catch (Throwable throwable) {
                        errors.add("清理未包装显示项失败");
                        LogUtil.w(TAG, "再次清理未包装性能显示项失败", throwable);
                    }
                }
            } else {
                for (Map.Entry<String, DisplayWrapper> entry : lease.displays.entrySet()) {
                    String name = entry.getKey();
                    DisplayWrapper wrapper = runningDisplay.get(name);
                    if (wrapper != entry.getValue()) {
                        if (wrapper != null
                                || !lease.finalizedDisplayNames.contains(name)) {
                            errors.add("显示项已丢失: " + name);
                        }
                        continue;
                    }

                    if (!lease.finalizedDisplayNames.contains(name)) {
                        try {
                            lease.records.putAll(wrapper.stopRecord());
                            lease.finalizedDisplayNames.add(name);
                        } catch (Throwable throwable) {
                            errors.add("停止录制失败: " + name);
                            LogUtil.w(TAG, "停止性能录制项失败: " + name, throwable);
                            continue;
                        }
                    }

                    if (wrapper.stop()) {
                        stoppedWrappers.put(name, wrapper);
                    } else {
                        errors.add("清理显示项失败: " + name);
                    }
                }
            }

            synchronized (this) {
                for (Map.Entry<String, DisplayWrapper> entry : stoppedWrappers.entrySet()) {
                    if (runningDisplay.get(entry.getKey()) == entry.getValue()) {
                        runningDisplay.remove(entry.getKey());
                        cachedContent.remove(entry.getKey());
                    }
                }
                for (Displayable displayable : cleanedDisplayables) {
                    lease.cleanupDisplayables.remove(displayable);
                    removeQuarantinedDisplayable(displayable);
                }

                boolean cleanupComplete = lease.cleanupDisplayables.isEmpty();
                for (Map.Entry<String, DisplayWrapper> entry : lease.displays.entrySet()) {
                    if (runningDisplay.get(entry.getKey()) == entry.getValue()) {
                        cleanupComplete = false;
                        break;
                    }
                }
                boolean recordsComplete = lease.cleanupOnly
                        || lease.finalizedDisplayNames.containsAll(lease.displayNames);
                if (cleanupComplete && activeRecordingLease == lease) {
                    activeRecordingLease = null;
                    releaseRuntimeGuardIfIdle();
                }
                String resultError = errors.isEmpty()
                        ? (lease.cleanupOnly ? lease.startError : null)
                        : errors.toString();
                result = new RecordingStopResult(true, cleanupComplete, recordsComplete,
                        lease.cleanupOnly
                                ? Collections.<RecordPattern,
                                    List<RecordPattern.RecordItem>>emptyMap()
                                : lease.records,
                        resultError);
            }
        } finally {
            synchronized (this) {
                if (scheduledExecutor != null && !scheduledExecutor.isShutdown()) {
                    executorService = Executors.newCachedThreadPool();
                } else {
                    executorService = null;
                }
                lease.stopInProgress = false;
                pauseFlag = false;
            }
        }
        return result;
    }

    /**
     * 停止特定项。
     *
     * <p>协议录制拥有的项只能通过对应租约停止。底层清理失败时保留实例与门闩，
     * 避免插件维护在仍有代码运行时进入。</p>
     */
    public synchronized void stopDisplay(String name) {
        DisplayWrapper wrapper = runningDisplay.get(name);
        if (isOwnedByActiveSession(name, wrapper)) {
            LogUtil.w(TAG, "忽略非租约入口停止协议性能会话显示项: " + name);
            return;
        }
        if (wrapper != null && wrapper.stop()) {
            if (runningDisplay.get(name) == wrapper) {
                runningDisplay.remove(name);
            }
            cachedContent.remove(name);
        }
        releaseRuntimeGuardIfIdle();
    }

    /** 停止所有旧入口显示项；活跃协议租约不会被该入口破坏。 */
    public synchronized void stopAllDisplay() {
        if (activeRecordingLease != null || activeDisplayLease != null) {
            LogUtil.w(TAG, "忽略非租约入口停止协议性能会话");
            return;
        }
        stopAllLegacyDisplays();
    }

    private void stopAllLegacyDisplays() {
        List<Map.Entry<String, DisplayWrapper>> entries =
                new ArrayList<>(runningDisplay.entrySet());
        for (Map.Entry<String, DisplayWrapper> entry : entries) {
            if (entry.getValue().stop() && runningDisplay.get(entry.getKey()) == entry.getValue()) {
                runningDisplay.remove(entry.getKey());
                cachedContent.remove(entry.getKey());
            }
        }
        retryQuarantinedDisplayables();
        releaseRuntimeGuardIfIdle();
    }

    private void forceStopAllDisplay() {
        RecordingLease lease = activeRecordingLease;
        if (lease != null) {
            try {
                stopRecordingSession(lease);
            } catch (Throwable throwable) {
                LogUtil.w(TAG, "销毁服务时停止性能录制失败", throwable);
            }
        }
        DisplayLease displayLease = activeDisplayLease;
        if (activeRecordingLease == null && displayLease != null) {
            try {
                stopDisplaySession(displayLease);
            } catch (Throwable throwable) {
                LogUtil.w(TAG, "销毁服务时停止性能实时监控失败", throwable);
            }
        }
        if (activeRecordingLease == null && activeDisplayLease == null) {
            stopAllLegacyDisplays();
        } else {
            releaseRuntimeGuardIfIdle();
        }
    }

    private void retryQuarantinedDisplayables() {
        for (int i = quarantinedDisplayables.size() - 1; i >= 0; i--) {
            Displayable displayable = quarantinedDisplayables.get(i);
            try {
                displayable.stop();
                quarantinedDisplayables.remove(i);
            } catch (Throwable throwable) {
                LogUtil.w(TAG, "再次清理隔离显示项失败", throwable);
            }
        }
    }

    private void removeQuarantinedDisplayable(Displayable target) {
        for (int i = quarantinedDisplayables.size() - 1; i >= 0; i--) {
            if (quarantinedDisplayables.get(i) == target) {
                quarantinedDisplayables.remove(i);
                return;
            }
        }
    }

    private boolean isCompletelyIdle() {
        return activeRecordingLease == null
                && activeDisplayLease == null
                && runningDisplay.isEmpty()
                && quarantinedDisplayables.isEmpty();
    }

    private void releaseRuntimeGuardIfIdle() {
        if (isCompletelyIdle()) {
            RuntimeSessionGuard.endSession(runtimeSessionOwner);
        }
    }

    private boolean isOwnedByActiveSession(String name, DisplayWrapper wrapper) {
        return wrapper != null
                && ((activeRecordingLease != null
                        && activeRecordingLease.displays.get(name) == wrapper)
                    || (activeDisplayLease != null
                        && activeDisplayLease.displays.get(name) == wrapper));
    }

    /** 当前协议录制是否仍由指定租约持有。 */
    public synchronized boolean ownsRecordingSession(RecordingLease lease) {
        return lease != null && lease == activeRecordingLease;
    }

    /** 当前协议实时监控是否仍由指定租约持有。 */
    public synchronized boolean ownsDisplaySession(DisplayLease lease) {
        return lease != null && lease == activeDisplayLease;
    }

    /** 协议性能实时监控的不透明所有权令牌。 */
    public static final class DisplayLease {
        private final Map<String, DisplayWrapper> displays;
        private final List<String> displayNames;
        private final List<Displayable> cleanupDisplayables;
        private final boolean cleanupOnly;
        private final String startError;
        /** 由 DisplayProvider 锁保护，避免同一租约被并发清理。 */
        private boolean stopInProgress;

        private DisplayLease(Map<String, DisplayWrapper> displays) {
            this(displays, new ArrayList<>(displays.keySet()),
                    Collections.<Displayable>emptyList(), false, null);
        }

        private DisplayLease(Map<String, DisplayWrapper> displays,
                             List<String> displayNames,
                             List<Displayable> cleanupDisplayables,
                             boolean cleanupOnly,
                             String startError) {
            this.displays = Collections.unmodifiableMap(
                    new LinkedHashMap<>(displays));
            this.displayNames = Collections.unmodifiableList(
                    new ArrayList<>(displayNames));
            this.cleanupDisplayables = new ArrayList<>(cleanupDisplayables);
            this.cleanupOnly = cleanupOnly;
            this.startError = startError;
        }

        private static DisplayLease forCleanup(
                Map<String, DisplayWrapper> displays,
                List<String> displayNames,
                List<Displayable> cleanupDisplayables,
                String error) {
            return new DisplayLease(displays, displayNames,
                    cleanupDisplayables, true, error);
        }

        public List<String> getDisplayNames() {
            return new ArrayList<>(displayNames);
        }

        public boolean isCleanupOnly() {
            return cleanupOnly;
        }

        public String getStartError() {
            return startError;
        }
    }

    /** 实时监控停止结果，区分租约不匹配和资源清理失败。 */
    public static final class DisplayStopResult {
        private final boolean matched;
        private final boolean cleanupComplete;
        private final String error;

        private DisplayStopResult(boolean matched, boolean cleanupComplete, String error) {
            this.matched = matched;
            this.cleanupComplete = cleanupComplete;
            this.error = error;
        }

        private static DisplayStopResult notMatched(String error) {
            return new DisplayStopResult(false, false, error);
        }

        public boolean isMatched() {
            return matched;
        }

        public boolean isCleanupComplete() {
            return cleanupComplete;
        }

        public String getError() {
            return error;
        }
    }

    /** 协议性能录制的不透明所有权令牌。 */
    public static final class RecordingLease {
        private final Map<String, DisplayWrapper> displays;
        private final List<String> displayNames;
        private final Set<String> finalizedDisplayNames = new HashSet<>();
        private final Map<RecordPattern, List<RecordPattern.RecordItem>> records =
                new HashMap<>();
        private final List<Displayable> cleanupDisplayables;
        private final boolean cleanupOnly;
        private final String startError;
        /** 由 DisplayProvider 锁保护，避免同一租约被并发清理。 */
        private boolean stopInProgress;

        private RecordingLease(Map<String, DisplayWrapper> displays) {
            this(displays, new ArrayList<>(displays.keySet()),
                    Collections.<Displayable>emptyList(), false, null);
        }

        private RecordingLease(Map<String, DisplayWrapper> displays,
                               List<String> displayNames,
                               List<Displayable> cleanupDisplayables,
                               boolean cleanupOnly,
                               String startError) {
            this.displays = Collections.unmodifiableMap(
                    new LinkedHashMap<>(displays));
            this.displayNames = Collections.unmodifiableList(
                    new ArrayList<>(displayNames));
            this.cleanupDisplayables = new ArrayList<>(cleanupDisplayables);
            this.cleanupOnly = cleanupOnly;
            this.startError = startError;
        }

        private static RecordingLease forCleanup(
                Map<String, DisplayWrapper> displays,
                List<String> displayNames,
                List<Displayable> cleanupDisplayables,
                String error) {
            return new RecordingLease(displays, displayNames,
                    cleanupDisplayables, true, error);
        }

        public List<String> getDisplayNames() {
            return new ArrayList<>(displayNames);
        }

        public boolean isCleanupOnly() {
            return cleanupOnly;
        }

        public String getStartError() {
            return startError;
        }
    }

    /** 协议停止结果，区分租约不匹配、数据收尾失败和资源清理失败。 */
    public static final class RecordingStopResult {
        private final boolean matched;
        private final boolean cleanupComplete;
        private final boolean recordsComplete;
        private final Map<RecordPattern, List<RecordPattern.RecordItem>> records;
        private final String error;

        private RecordingStopResult(boolean matched, boolean cleanupComplete,
                                    boolean recordsComplete,
                                    Map<RecordPattern, List<RecordPattern.RecordItem>> records,
                                    String error) {
            this.matched = matched;
            this.cleanupComplete = cleanupComplete;
            this.recordsComplete = recordsComplete;
            this.records = new HashMap<>(records);
            this.error = error;
        }

        private static RecordingStopResult notMatched(String error) {
            return new RecordingStopResult(false, false, false,
                    Collections.<RecordPattern, List<RecordPattern.RecordItem>>emptyMap(), error);
        }

        public boolean isMatched() {
            return matched;
        }

        public boolean isCleanupComplete() {
            return cleanupComplete;
        }

        public boolean isRecordsComplete() {
            return recordsComplete;
        }

        public Map<RecordPattern, List<RecordPattern.RecordItem>> getRecords() {
            return new HashMap<>(records);
        }

        public String getError() {
            return error;
        }
    }

    /**
     * 显示项容器
     */
    public static class DisplayWrapper {
        private volatile String previousContent;
        private final Displayable reference;
        private final long minSpendTime;
        private final ReentrantLock operationLock = new ReentrantLock(true);
        private final AtomicBoolean contentRefreshPending = new AtomicBoolean(false);
        private long contentLastCallTime = 0L;
        private long contentMaxSpendTime;
        private int contentSmallCount = 0;
        private long recordLastCallTime = 0L;
        private long recordMaxSpendTime;
        private int recordSmallCount = 0;
        private volatile boolean isRunning = false;
        private boolean stopped = false;
        private boolean quarantined = false;

        DisplayWrapper(Displayable reference) {
            this.reference = reference;
            this.minSpendTime = reference.getRefreshFrequency();
            this.contentMaxSpendTime = minSpendTime;
            this.recordMaxSpendTime = minSpendTime;
        }

        public void start() {
            operationLock.lock();
            try {
                if (stopped) {
                    throw new IllegalStateException("显示项已经停止");
                }
                reference.start();
            } finally {
                operationLock.unlock();
            }
        }

        public void trigger() {
            operationLock.lock();
            try {
                if (!stopped && !quarantined) {
                    reference.trigger();
                }
            } finally {
                operationLock.unlock();
            }
        }

        public void startRecord() {
            operationLock.lock();
            try {
                if (!stopped && !quarantined) {
                    reference.startRecord();
                    recordLastCallTime = 0L;
                    recordMaxSpendTime = minSpendTime;
                    recordSmallCount = 0;
                }
            } finally {
                operationLock.unlock();
            }
        }

        public Map<RecordPattern, List<RecordPattern.RecordItem>> stopRecord() {
            operationLock.lock();
            try {
                if (stopped || quarantined) {
                    return Collections.emptyMap();
                }
                isRunning = true;
                try {
                    return reference.stopRecord();
                } finally {
                    isRunning = false;
                }
            } finally {
                operationLock.unlock();
            }
        }

        public String getContent() {
            operationLock.lock();
            try {
                return getContentLocked();
            } finally {
                operationLock.unlock();
            }
        }

        public String getCachedContent() {
            return previousContent;
        }

        /** 控制请求只排队后台刷新；繁忙时后台任务也不会等待采样锁。 */
        public void refreshContentIfIdle(final ExecutorService executor) {
            if (executor == null || executor.isShutdown()
                    || !contentRefreshPending.compareAndSet(false, true)) {
                return;
            }
            try {
                executor.execute(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            getContentIfIdle();
                        } finally {
                            contentRefreshPending.set(false);
                        }
                    }
                });
            } catch (RuntimeException exception) {
                contentRefreshPending.set(false);
                LogUtil.w(TAG, "无法提交即时性能刷新", exception);
            }
        }

        private String getContentIfIdle() {
            boolean locked = false;
            try {
                locked = operationLock.tryLock(0L, TimeUnit.MILLISECONDS);
                return locked ? getContentLocked() : previousContent;
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                return previousContent;
            } finally {
                if (locked) {
                    operationLock.unlock();
                }
            }
        }

        private String getContentLocked() {
            if (stopped || quarantined || isRunning) {
                return previousContent;
            }

            // 自动降速
            if (System.currentTimeMillis() - contentLastCallTime < contentMaxSpendTime) {
                return previousContent;
            }

            long startTime = System.currentTimeMillis();
            isRunning = true;
            contentLastCallTime = startTime;
            try {
                previousContent = reference.getCurrentInfo();
            } catch (Throwable throwable) {
                LogUtil.e(TAG, throwable, "调用Displayable【%s】抛出异常", reference);
            } finally {
                isRunning = false;
            }

            // 一次调用时间
            long spendTime = System.currentTimeMillis() - startTime;
            LogUtil.d(TAG, "调用【%s】耗时%dms", reference.getClass().getSimpleName(), spendTime);
            if (spendTime > contentMaxSpendTime) {
                contentMaxSpendTime = spendTime;
                contentSmallCount = 0;

            // 小于一半
            } else if (spendTime < contentMaxSpendTime / 2) {
                contentSmallCount ++;

                if (contentSmallCount >= 2) {
                    contentMaxSpendTime = minSpendTime;
                }
            }

            return previousContent;
        }

        public void record() {
            operationLock.lock();
            try {
                if (stopped || quarantined || isRunning) {
                    return;
                }

                // 自动降速
                if (System.currentTimeMillis() - recordLastCallTime < recordMaxSpendTime) {
                    return;
                }

                long startTime = System.currentTimeMillis();
                recordLastCallTime = startTime;
                isRunning = true;
                try {
                    reference.record();
                } catch (Throwable t) {
                    LogUtil.e(TAG, t, "调用Displayable【%s】record抛出异常", reference);
                } finally {
                    isRunning = false;
                }

                // 一次调用时间
                long spendTime = System.currentTimeMillis() - startTime;
                if (spendTime > recordMaxSpendTime) {
                    recordMaxSpendTime = spendTime;
                    recordSmallCount = 0;

                    // 小于一半
                } else if (spendTime < recordMaxSpendTime / 2) {
                    recordSmallCount ++;

                    if (recordSmallCount >= 2) {
                        recordMaxSpendTime = minSpendTime;
                    }
                }
            } finally {
                operationLock.unlock();
            }
        }

        public boolean stop() {
            operationLock.lock();
            try {
                if (stopped) {
                    return true;
                }
                isRunning = true;
                try {
                    reference.stop();
                    stopped = true;
                    quarantined = false;
                    return true;
                } catch (Throwable throwable) {
                    quarantined = true;
                    LogUtil.w(TAG, "停止性能显示项失败", throwable);
                    return false;
                } finally {
                    isRunning = false;
                }
            } finally {
                operationLock.unlock();
            }
        }

        public void quarantine() {
            operationLock.lock();
            try {
                quarantined = true;
            } finally {
                operationLock.unlock();
            }
        }
    }
}
