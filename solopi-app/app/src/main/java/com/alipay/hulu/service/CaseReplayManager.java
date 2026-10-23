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
package com.alipay.hulu.service;

import android.app.ProgressDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.ServiceConnection;
import android.graphics.Bitmap;
import android.graphics.Point;
import android.graphics.Rect;
import android.os.Build;
import android.os.Environment;
import android.os.IBinder;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.bean.OperationStepResult;
import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.bean.ReplayStepInfoBean;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.bean.DeviceInfo;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.RunningThread;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.service.ScreenCaptureService;
import com.alipay.hulu.common.service.TouchService;
import com.alipay.hulu.common.service.base.ExportService;
import com.alipay.hulu.common.service.base.LocalService;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.DeviceInfoUtil;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.replay.AbstractStepProvider;
import com.alipay.hulu.scheme.HarnessState;
import com.alipay.hulu.shared.event.EventService;
import com.alipay.hulu.shared.node.AbstractNodeProcessor;
import com.alipay.hulu.shared.node.OperationService;
import com.alipay.hulu.shared.node.action.OperationContext;
import com.alipay.hulu.shared.node.action.OperationExecutor;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.action.UIOperationMessage;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.OperationNode;
import com.alipay.hulu.shared.node.tree.accessibility.AccessibilityNodeProcessor;
import com.alipay.hulu.shared.node.tree.accessibility.AccessibilityProvider;
import com.alipay.hulu.shared.node.tree.capture.CaptureTree;
import com.alipay.hulu.shared.node.tree.export.OperationStepExporter;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;
import com.alipay.hulu.shared.node.utils.AppUtil;
import com.alipay.hulu.shared.node.utils.BitmapUtil;
import com.alipay.hulu.shared.node.utils.ContentChangeWatcher;
import com.alipay.hulu.shared.node.utils.OperationUtil;
import com.alipay.hulu.shared.node.utils.PrepareUtil;
import com.alipay.hulu.shared.node.utils.RectUtil;
import com.alipay.hulu.tools.HighLightService;
import com.alipay.hulu.util.DialogUtils;

import java.io.File;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 操作回放服务
 * Created by qiaoruikai on 2018/10/16 12:31 AM.
 */
@LocalService
public class CaseReplayManager implements ExportService {
    public static final String REPLAY_STEP_FINISH_EVENT = "REPLAY_STEP_FINISH_EVENT";
    private static final String TAG = "CaseReplayManager";

    /**
     * 运行标记
     */
    volatile boolean runningFlag;

    /**
     * 故障步骤
     */
    OperationStep exceptionStep;

    /**
     * 操作提供器
     */
    private volatile AbstractStepProvider provider;
    private volatile String replayLeaseOwner;
    private final AtomicBoolean processStarted = new AtomicBoolean(false);
    private final AtomicBoolean preStartCancellationHandled = new AtomicBoolean(false);
    private volatile boolean cancelRequested;
    private boolean restartAppForReplay = true;
    private volatile boolean headless;
    private volatile String headlessExecutionError;
    private final AtomicBoolean finishDelivered = new AtomicBoolean(false);
    private String preparationError;

    /**
     * 操作服务
     */
    private OperationService operationService;

    /**
     * 操作服务
     */
    private TouchService touchService;

    /**
     * 高亮服务
     */
    private HighLightService highLightService;

    /**
     * 截图服务
     */
    private ScreenCaptureService captureService;

    private WindowManager windowManager;

    /**
     * 消息服务
     */
    private InjectorService injectorService;

    private volatile OperationContext runningContext;

    /**
     * 用例运行器
     */
    private final ThreadPoolExecutor runningExecutor = new ThreadPoolExecutor(2, 2, 0L,
            TimeUnit.MILLISECONDS, new LinkedBlockingQueue<Runnable>(), new ThreadFactory() {
        private final AtomicInteger RUNNING_COUNTER = new AtomicInteger(1);
        @Override
        public Thread newThread(@NonNull Runnable r) {
            String name = String.format(Locale.CHINA, "CaseReplayThread-%d", RUNNING_COUNTER.getAndIncrement());
            return new Thread(r, name);
        }
    });

    /**
     * Daemon 执行器
     */
    private final ScheduledExecutorService daemonExecutor = Executors.newScheduledThreadPool(2, new ThreadFactory() {
        private final AtomicInteger DAEMON_COUNTER = new AtomicInteger(1);
        @Override
        public Thread newThread(@NonNull Runnable r) {
            String name = String.format(Locale.CHINA, "CaseReplayThread-%d", DAEMON_COUNTER.getAndIncrement());
            return new Thread(r, name);
        }
    });

    /**
     * 目标应用
     */
    private String app;

    /**
     * 悬浮窗Binder
     */
    private volatile FloatWinService.FloatBinder binder;

    /**
     * 悬浮窗连接
     */
    private volatile ReplayConnection connection;

    private volatile OnFinishListener finishListener;

    private ContentChangeWatcher watcher;

    private EventService eventService;

    private FloatWinService.OnRunListener listener = new FloatWinService.OnRunListener() {
        @Override
        public int onRunClick() {
            AbstractStepProvider currentProvider = provider;
            if (!cancelRequested && currentProvider != null && currentProvider.canStart()) {
                startProcess();
            } else {
                LauncherApplication.getInstance().showToast(StringUtil.getString(R.string.replay__not_start_by_hand));
            }
            return 0;
        }
    };

    private FloatWinService.OnFloatListener floatListener = new FloatWinService.OnFloatListener() {
        @Override
        public void onFloatClick(boolean hide) {
            final FloatWinService.FloatBinder activeBinder = binder;
            final AbstractStepProvider activeProvider = provider;
            if (!headless && !hide && activeProvider != null && activeBinder != null) {
                activeProvider.onFloatClick(activeBinder.loadServiceContext(), CaseReplayManager.this);
            }
        }
    };

    private int stepCount = 0;

    private String defaultIme = null;
    private boolean imeRestorePending;

    private volatile CaseReplayStatus currentStatus = CaseReplayStatus.NONE;

    public void onCreate(Context context) {
        LauncherApplication app = LauncherApplication.getInstance();
        operationService = app.findServiceByName(OperationService.class.getName());
        injectorService = app.findServiceByName(InjectorService.class.getName());
        injectorService.register(this);
        eventService = app.findServiceByName(EventService.class.getName());
        touchService = app.findServiceByName(TouchService.class.getName());

        // 截图服务
        captureService = app.findServiceByName(ScreenCaptureService.class.getName());

        windowManager = (WindowManager) app.getSystemService(Context.WINDOW_SERVICE);

        operationService.startExtraActionHandle();
    }

    /**
     * 启动Replay流程
     */
    public synchronized boolean start(AbstractStepProvider provider,
                                      OnFinishListener finishListener) {
        return start(provider, finishListener, null);
    }

    /**
     * 启动回放。协议调用传入已预留的唯一 owner；UI 调用由 manager 原子创建 owner。
     */
    public synchronized boolean start(AbstractStepProvider provider,
                                      OnFinishListener finishListener,
                                      String expectedOwner) {
        return start(provider, finishListener, expectedOwner, null);
    }

    public synchronized boolean start(AbstractStepProvider provider,
                                      OnFinishListener finishListener,
                                      String expectedOwner, Boolean restartAppOverride) {
        return start(provider, finishListener, expectedOwner, restartAppOverride, false);
    }

    /** Computer-controlled replay executes without creating any replay overlay. */
    public synchronized boolean start(AbstractStepProvider provider,
                                      OnFinishListener finishListener,
                                      String expectedOwner, Boolean restartAppOverride,
                                      boolean headless) {
        if (provider == null || (headless && !provider.canStart())) {
            return false;
        }
        if (connection != null || replayLeaseOwner != null) {
            if (!headless) {
                LauncherApplication.getInstance().showToast("已有回放正在进行");
            }
            return false;
        }

        String owner = expectedOwner;
        if (owner == null) {
            owner = ReplaySessionLease.newOwner("ui");
            if (!ReplaySessionLease.tryAcquire(owner)) {
                if (!headless) {
                    LauncherApplication.getInstance().showToast("已有回放或插件维护正在进行");
                }
                return false;
            }
        } else if (!ReplaySessionLease.isOwnedBy(owner)) {
            return false;
        }
        final String activeOwner = owner;
        replayLeaseOwner = activeOwner;

        boolean started = false;
        boolean floatBound = false;
        try {
            this.provider = provider;
            this.finishListener = finishListener;
            this.headless = headless;
            headlessExecutionError = null;
            finishDelivered.set(false);

            restartAppForReplay = PrepareUtil.shouldRestartApp(restartAppOverride);
            preparationError = null;
            if (restartAppForReplay) {
                AppUtil.forceStopApp(app);
            }

            // 初始化运行参数
            stepCount = 0;
            defaultIme = null;
            imeRestorePending = false;
            runningFlag = false;
            cancelRequested = false;
            processStarted.set(false);
            preStartCancellationHandled.set(false);
            currentStatus = CaseReplayStatus.BEFORE_PREPARE;

            List<Class<? extends AbstractNodeProcessor>> processors = new ArrayList<>();
            processors.add(AccessibilityNodeProcessor.class);
            operationService.configProcessors(processors);
            operationService.configProvider(AccessibilityProvider.class);

            Context context = LauncherApplication.getContext();
            if (!headless) {
                // HighLightService creates an overlay in onCreate, so load it only for UI replay.
                highLightService = LauncherApplication.getInstance().findServiceByName(
                        HighLightService.class.getName());
                connection = new ReplayConnection(this);
                floatBound = context.getApplicationContext().bindService(
                        new Intent(context.getApplicationContext(), FloatWinService.class),
                        connection, Context.BIND_AUTO_CREATE);
                if (!floatBound) {
                    throw new IllegalStateException("Unable to bind replay floating window");
                }
            }

            watcher = new ContentChangeWatcher();
            watcher.start();
            eventService.startTrackAccessibilityEvent();
            if (touchService != null) {
                touchService.start();
            }

            // A host request is already the start signal; no phone preference or binder is needed.
            if (headless) {
                startProcess();
            } else if (provider.canStart()
                    && SPService.getBoolean(SPService.KEY_REPLAY_AUTO_START, false)) {
                // 等待初始化完毕
                LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (cancelRequested || !ownsReplayLease(activeOwner)) {
                            return;
                        }
                        if (binder == null) {
                            LauncherApplication.getInstance().runOnUiThread(this, 500);
                        } else {
                            startProcess();
                        }
                    }
                }, 2000);
            }
            started = true;
            return true;
        } finally {
            if (!started) {
                rollbackReplayStart(floatBound, activeOwner);
            }
        }
    }

    private boolean ownsReplayLease(String owner) {
        return owner != null && owner.equals(replayLeaseOwner)
                && ReplaySessionLease.isOwnedBy(owner);
    }

    private void rollbackReplayStart(boolean floatBound, String owner) {
        Context context = LauncherApplication.getContext();
        if (watcher != null) {
            try {
                watcher.stop();
            } catch (RuntimeException ignored) {
                LogUtil.w(TAG, "Unable to stop failed replay watcher");
            }
            watcher = null;
        }
        try {
            eventService.stopTrackAccessibilityEvent();
        } catch (RuntimeException ignored) {
            LogUtil.w(TAG, "Unable to stop failed replay event tracking");
        }
        if (touchService != null) {
            try {
                touchService.stop();
            } catch (RuntimeException ignored) {
                LogUtil.w(TAG, "Unable to stop failed replay touch service");
            }
        }
        if (floatBound && connection != null) {
            try {
                context.getApplicationContext().unbindService(connection);
            } catch (RuntimeException ignored) {
                LogUtil.w(TAG, "Unable to unbind failed replay floating window");
            }
        }
        if (highLightService != null) {
            try {
                LauncherApplication.getInstance().stopServiceByName(HighLightService.class.getName());
            } catch (RuntimeException ignored) {
                LogUtil.w(TAG, "Unable to stop failed replay highlight service");
            }
            highLightService = null;
        }
        connection = null;
        binder = null;
        provider = null;
        finishListener = null;
        currentStatus = CaseReplayStatus.STOP;
        cancelRequested = true;
        replayLeaseOwner = null;
        ReplaySessionLease.release(owner);
    }

    /**
     * 停止replay
     */
    public synchronized void onDestroy(Context context) {
        String owner = replayLeaseOwner;
        replayLeaseOwner = null;
        try {
            // Preparation or a replay action can throw before suffixAction is reached.
            // Restore only if this replay actually attempted an IME switch.
            restoreReplayIme();
            this.provider = null;
            try {
                eventService.stopTrackAccessibilityEvent();
            } catch (RuntimeException exception) {
                LogUtil.w(TAG, "Unable to stop replay event tracking", exception);
            }

            if (watcher != null) {
                try {
                    watcher.stop();
                } catch (RuntimeException exception) {
                    LogUtil.w(TAG, "Unable to stop replay watcher", exception);
                }
                watcher = null;
            }

            if (connection != null) {
                try {
                    context.unbindService(connection);
                } catch (RuntimeException exception) {
                    LogUtil.w(TAG, "Unable to unbind replay floating window", exception);
                }
                connection = null;
                binder = null;
            }

            try {
                operationService.stopExtraActionHandle();
            } catch (RuntimeException exception) {
                LogUtil.w(TAG, "Unable to stop replay action handlers", exception);
            }
            runningFlag = false;
            currentStatus = CaseReplayStatus.STOP;
            runningExecutor.shutdownNow();
            daemonExecutor.shutdownNow();
            if (highLightService != null) {
                try {
                    LauncherApplication.getInstance().stopServiceByName(
                            HighLightService.class.getName());
                } catch (RuntimeException exception) {
                    LogUtil.w(TAG, "Unable to stop replay highlight service", exception);
                }
                highLightService = null;
            }
            if (injectorService != null) {
                injectorService.unregister(this);
            }
        } finally {
            HarnessState.failByReplayLeaseOwner(owner,
                    "Replay manager stopped before reporting a result");
            ReplaySessionLease.release(owner);
        }
    }

    /**
     * 开始处理
     */
    public void startProcess() {
        final String activeOwner = replayLeaseOwner;
        final FloatWinService.FloatBinder activeBinder = binder;
        if (!canStartProcess(activeOwner)
                || !processStarted.compareAndSet(false, true)) {
            return;
        }
        if (cancelRequested || !ownsReplayLease(activeOwner)) {
            if (cancelRequested) {
                finishPreStartCancellation();
            } else {
                processStarted.set(false);
            }
            return;
        }

        try {
            if (!headless && activeBinder != null) {
                activeBinder.hideFloat();
            }

            runningFlag = true;
            if (cancelRequested) {
                runningFlag = false;
                finishPreStartCancellation();
                return;
            }
            final Runnable runningR = new Runnable() {
                @Override
                public void run() {
                    try {
                        process();
                    } catch (Exception e) {
                        LogUtil.e(TAG, "抛出异常" + e.getMessage(), e);
                        LauncherApplication.getInstance().stopServiceByName(
                                CaseReplayManager.class.getName());
                    }
                }
            };
            // 启动执行器
            runningExecutor.execute(runningR);

            // 守护线程，10s检查一次状态
            daemonExecutor.schedule(new Runnable() {
                @Override
                public void run() {
                    // 执行完毕，停止守护线程
                    if (currentStatus == CaseReplayStatus.STOP) {
                        daemonExecutor.shutdownNow();
                        return;
                    }

                    // 没执行完毕，并且没有正在处理的线程
                    int count = runningExecutor.getActiveCount();
                    if (count == 0) {
                        runningExecutor.execute(runningR);
                    }
                }
            }, 10, TimeUnit.SECONDS);
        } catch (RuntimeException exception) {
            runningFlag = false;
            LogUtil.e(TAG, "无法启动回放执行线程", exception);
            LauncherApplication.getInstance().stopServiceByName(
                    CaseReplayManager.class.getName());
        }
    }

    // Code security: changing UI mode never bypasses the exact-owner device lease.
    boolean canStartProcess(String activeOwner) {
        return !cancelRequested && (headless || binder != null)
                && ownsReplayLease(activeOwner);
    }

    /**
     * 具体执行（可重入）
     */
    private void process() {
        if (cancelRequested && currentStatus == CaseReplayStatus.BEFORE_PREPARE) {
            finishPreStartCancellation();
            return;
        }
        if (provider == null) {
            LogUtil.e(TAG, "provider为空");
            return;
        }

        if (currentStatus == CaseReplayStatus.NONE) {
            LogUtil.w(TAG, "未准备，无法执行");
            return;
        }

        if (currentStatus == CaseReplayStatus.BEFORE_PREPARE) {
            if (prepareAction()) {
                currentStatus = CaseReplayStatus.PREPARED;
            } else {
                preparationError = "Replay preparation failed; no replay step was executed";
                runningFlag = false;
                currentStatus = CaseReplayStatus.FINISH_RUNNING;
            }
        }

        if (currentStatus == CaseReplayStatus.PREPARED || currentStatus == CaseReplayStatus.RUNNING) {
            InjectorService injectorService = InjectorService.g();
            // 执行各步骤
            while (runningFlag && provider.hasNext()) {
                boolean shouldStop = stepAction(injectorService);
                if (shouldStop) {
                    break;
                }
            }

            currentStatus = CaseReplayStatus.FINISH_RUNNING;
        }

        if (currentStatus == CaseReplayStatus.FINISH_RUNNING) {
            suffixAction();
            currentStatus = CaseReplayStatus.STOP;
        }
    }

    /**
     * 前置准备操作
     */
    protected boolean prepareAction() {
        // 准备
        provider.prepare();

        boolean prepared = prepareReplayEnvironment();
        if (!prepared) {
            return false;
        }

        // Headless assertion-only segments never use a keyboard. Defer their IME setup;
        // interactive replay retains the original preparation point.
        if (!headless && !prepareReplayIme()) {
            return false;
        }

        stepCount = 1;
        return true;
    }

    protected synchronized boolean prepareReplayIme() {
        if (imeRestorePending) {
            return true;
        }
        String original = readDefaultIme();
        if (original == null || original.trim().length() == 0 || "null".equals(original.trim())) {
            return false;
        }
        defaultIme = original.trim();
        // Record before switching: an exception may happen after the platform changed the IME.
        imeRestorePending = true;
        try {
            applyReplayIme("com.alipay.hulu/.common.tools.AdbIME");
            return true;
        } catch (RuntimeException exception) {
            restoreReplayIme();
            return false;
        }
    }

    protected String readDefaultIme() {
        return CmdTools.execHighPrivilegeCmd("settings get secure default_input_method");
    }

    protected void applyReplayIme(String ime) {
        MyApplication.getInstance().updateDefaultIme(ime);
        CmdTools.switchToIme(ime);
    }

    protected synchronized void restoreReplayIme() {
        if (!imeRestorePending || defaultIme == null) {
            return;
        }
        try {
            applyReplayIme(defaultIme);
            imeRestorePending = false;
        } catch (RuntimeException exception) {
            // Keep the marker so onDestroy can retry without omitting result/lease cleanup.
            LogUtil.w(TAG, "Unable to restore replay input method");
        }
    }

    static boolean requiresPreparedIme(PerformActionEnum action) {
        if (action == null) {
            return true;
        }
        switch (action) {
            case ASSERT:
            case ASSERT_TOAST:
            case CHECK_NODE:
            case CHECK:
            case LET_NODE:
            case LET:
            case SLEEP_UNTIL:
            case SLEEP:
            case SCREENSHOT:
                return false;
            default:
                // Unknown/plugin/input actions keep the old IME environment. This first
                // optimization is intentionally limited to proven read-only segments.
                return true;
        }
    }

    protected boolean prepareReplayEnvironment() {
        if (headless) {
            return prepareTargetApp(null);
        }
        Context service = LauncherApplication.getInstance().loadRunningService();
        final ProgressDialog progressDialog = DialogUtils.showProgressDialog(ContextUtil.getContextThemeWrapper(service, R.style.AppDialogTheme), "环境准备中");
        PrepareUtil.PrepareStatus prepareStatus = new PrepareUtil.PrepareStatus() {
            @Override
            public void currentStatus(final int progress, final int total, final String message, boolean status) {
                LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (progressDialog == null || !progressDialog.isShowing()) {
                            return;
                        }

                        // 更新progressDialog的状态
                        progressDialog.setProgress(progress);
                        progressDialog.setMax(total);
                        progressDialog.setMessage(message);
                    }
                });
            }
        };
        boolean prepared = prepareTargetApp(prepareStatus);

        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (progressDialog != null) {
                    progressDialog.dismiss();
                }
            }
        });

        return prepared;
    }

    protected boolean prepareTargetApp(PrepareUtil.PrepareStatus status) {
        return PrepareUtil.doPrepareWork(app, status, restartAppForReplay);
    }

    /**
     * 单步操作
     * @return 是否执行完毕
     */
    private boolean stepAction(InjectorService injector) {
        OperationStep step = null;
        try {
            step = provider.provideStep();
        } catch (Throwable t) {
            LogUtil.e(TAG, "Load Step failed", t);
        }
        // 说明特殊情况，执行完毕
        if (step == null) {
            return true;
        }

        LogUtil.i(TAG, "开始执行操作：%s", step);
        updateFloatIcon(R.drawable.solopi_running);

        String result;
        try {
            result = processOperation(step);
        } catch (Exception e) {
            LogUtil.e(TAG, "执行操作抛出异常: " + e.getMessage(), e);
            result = "执行异常:" + e.getMessage();
        }

        // 是否阻塞执行
        boolean isError = result != null;
        if (isError) {
            LogUtil.e(TAG, "执行步骤出现问题：%s", result);
            isError = provider.reportErrorStep(step, result, new ArrayList<String>());
        }

        // 有需要监听执行结果的监听器
        if (injector.getReferenceCount(REPLAY_STEP_FINISH_EVENT) > 0) {
            OperationStepResult replayResult = new OperationStepResult();
            replayResult.method = step.getOperationMethod().getActionEnum().getCode();
            replayResult.error = result;
            replayResult.result = !isError;
            File captureFile = new File(FileUtils.getSubDir("tmp"), "step_" + stepCount + ".jpg");

            // 截图信息
            if (captureService != null) {
                Bitmap captureResult = capture(captureFile);
                if (captureResult != null) {
                    replayResult.screenCaptureFile = captureFile;
                }
            }

            injector.pushMessage(REPLAY_STEP_FINISH_EVENT, replayResult);
        }

        // 如果是error步骤
        if (StringUtil.equals(result, "回放终止") || isError) {
            return true;
        }

        // 更新到原始图标
        updateFloatIcon(R.drawable.solopi_float);

        MiscUtil.sleep(200);
        return false;
    }

    /**
     * 后置操作
     */
    protected void suffixAction() {
        watcher.sleepUntilContentDontChange();
        if (touchService != null) {
            touchService.stop();
        }

        // 删除临时图片
        File targetDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM);
        targetDir = new File(targetDir, "solopi");
        if (targetDir.exists()) {
            FileUtils.deleteFile(targetDir);
        }

        // 切换回默认输入法
        restoreReplayIme();

        // 汇报结果
        final List<ReplayResultBean> resultBeans = collectReplayResults();
        if (resultBeans != null && resultBeans.size() > 0) {
            DeviceInfo deviceInfo = DeviceInfoUtil.generateDeviceInfo();
            for (ReplayResultBean result: resultBeans) {
                result.setDeviceInfo(deviceInfo);
                result.setPlatform("Android");
                result.setPlatformVersion(deviceInfo.getSystemVersion());
            }
        }


        try {
            final FloatWinService.FloatBinder activeBinder = binder;
            if (!headless && activeBinder != null) {
                activeBinder.restoreFloat();
                activeBinder.stopFloat();
            }
            deliverReplayResults(resultBeans);
        } finally {
            // Release services and the device lease even if a result consumer fails.
            LauncherApplication.getInstance().stopServiceByName(CaseReplayManager.class.getName());
        }
    }

    protected Context getReplayContext() {
        final FloatWinService.FloatBinder activeBinder = binder;
        return !headless && activeBinder != null
                ? activeBinder.loadServiceContext() : LauncherApplication.getContext();
    }

    protected void deliverReplayResults(List<ReplayResultBean> resultBeans) {
        final OnFinishListener activeListener = finishListener;
        if (activeListener != null && finishDelivered.compareAndSet(false, true)) {
            activeListener.onFinish(resultBeans, getReplayContext());
        }
    }

    protected List<ReplayResultBean> collectReplayResults() {
        List<ReplayResultBean> results = provider.genReplayResult();
        String terminalError = preparationError != null ? preparationError : headlessExecutionError;
        if (terminalError != null && results != null) {
            for (ReplayResultBean result : results) {
                if (result != null) {
                    result.setExceptionMessage(terminalError);
                    if (preparationError != null) {
                        result.setExceptionStep(-1);
                    }
                }
            }
        }
        return results;
    }

    public void stopRunning() {
        cancelRequested = true;
        this.runningFlag = false;
        OperationContext context = runningContext;
        if (context != null) {
            context.cancelRunning();
        }
        if (currentStatus == CaseReplayStatus.BEFORE_PREPARE
                && processStarted.compareAndSet(false, true)) {
            finishPreStartCancellation();
        }
    }

    public boolean isRunning() {
        return currentStatus != CaseReplayStatus.NONE && currentStatus != CaseReplayStatus.STOP;
    }

    private void finishPreStartCancellation() {
        if (!preStartCancellationHandled.compareAndSet(false, true)) {
            return;
        }
        String owner = replayLeaseOwner;
        runningFlag = false;
        currentStatus = CaseReplayStatus.STOP;
        HarnessState.cancelByReplayLeaseOwner(owner);
        LauncherApplication.getInstance().stopServiceByName(
                CaseReplayManager.class.getName());
    }


    /**
     * 执行截图
     * @param captureFile
     * @return
     */
    private Bitmap capture(File captureFile) {
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(metrics);

        int minEdge = Math.min(metrics.widthPixels, metrics.heightPixels);
        float radio = SPService.getInt(SPService.KEY_SCREENSHOT_RESOLUTION, 720) / (float) minEdge;

        // 无法放大
        if (radio > 1) {
            radio = 1;
        }

        return captureService.captureScreen(captureFile, metrics.widthPixels, metrics.heightPixels,
                (int) (radio * metrics.widthPixels), (int) (radio * metrics.heightPixels));
    }

    /**
     * 处理单步操作
     * @param operation
     * @return
     */
    private String processOperation(OperationStep operation) {
        if (!runningFlag) {
            return  "回放终止";
        }

        if (operation == null) {
            return "操作为空";
        }

        final OperationMethod method = operation.getOperationMethod();
        if (method == null || method.getActionEnum() == null) {
            exceptionStep = operation;
            return "方法为空";
        }

        if (headless && method.getActionEnum() == PerformActionEnum.DEVICE_INFO) {
            exceptionStep = operation;
            failHeadlessUiOperation();
            return headlessExecutionError;
        }

        // 这两个操作返回出来，说明出现问题
        if (method.getActionEnum() == PerformActionEnum.BREAK ||
                method.getActionEnum() == PerformActionEnum.CONTINUE) {
            return "逻辑控制异常";
        }

        if (headless && requiresPreparedIme(method.getActionEnum())) {
            // Code security: validate the live owner before preparing the keyboard, then
            // acquire the target afresh because switching the IME can change window bounds.
            if (!canContinueHeadlessLookup()) {
                return "回放终止";
            }
            if (!prepareReplayIme()) {
                return "输入法准备失败";
            }
            if (!canContinueHeadlessLookup()) {
                return "回放终止";
            }
        }

        ReplayStepInfoBean stepInfoBean = new ReplayStepInfoBean();

        final CountDownLatch runningFlag = new CountDownLatch(1);
        final long startTime = System.currentTimeMillis();
        OperationContext.OperationListener listener = new OperationContext.OperationListener() {
            @Override
            public void notifyOperationFinish() {
                LogUtil.d(TAG, "当前操作【%s】执行完毕，执行耗时: %dms", method.getActionEnum().getDesc(), System.currentTimeMillis() - startTime);
                runningFlag.countDown();
            }

            @Override
            public void onContextReceive(OperationContext context) {
                runningContext = context;
            }
        };

        // 对于需要操作节点的记录
        AbstractNodeTree node = null;
        if (operation.getOperationNode() != null) {
            // 解析Node数据
            OperationNode origin = new OperationNode(operation.getOperationNode(), operationService);
            if (operation.getOperationMethod().getActionEnum() != PerformActionEnum.CLICK_QUICK) {
                watcher.sleepUntilContentDontChange();
            } else {
                // 快速点击模式下，需要尽快进行点击，sleep 500ms够了
                MiscUtil.sleep(500);
            }
            List<String> prepareActions = new ArrayList<>();
            if (headless && HeadlessReplayNodeResolver.supports(origin)) {
                long targetWaitMs = 3000L;
                if (method.getActionEnum() == PerformActionEnum.CLICK_IF_EXISTS) {
                    targetWaitMs = 0L;
                } else if (method.getActionEnum() == PerformActionEnum.SLEEP_UNTIL) {
                    try {
                        targetWaitMs = Long.parseLong(method.getParam(OperationExecutor.INPUT_TEXT_KEY));
                    } catch (NumberFormatException exception) {
                        return "参数错误";
                    }
                }
                try {
                    node = findHeadlessReplayNode(origin, targetWaitMs);
                } catch (HeadlessReplayNodeResolver.AmbiguousTargetException exception) {
                    return "节点匹配不唯一";
                }
                if (!canContinueHeadlessLookup()) {
                    return "回放终止";
                }
                if (node == null) {
                    return method.getActionEnum() == PerformActionEnum.CLICK_IF_EXISTS
                            ? null : "节点未查找到或匹配不唯一";
                }
            } else if (operation.getOperationMethod().getActionEnum() == PerformActionEnum.CLICK_IF_EXISTS) {
                node = OperationUtil.findAbstractNodeWithoutScroll(origin, operationService, prepareActions);

                if (node == null) {
                    LogUtil.i(TAG, "未查找到节点【%s】，不进行操作", origin);
                    return null;
                }
            } else if (operation.getOperationMethod().getActionEnum() == PerformActionEnum.CHECK_NODE || operation.getOperationMethod().getActionEnum() == PerformActionEnum.CLICK_QUICK) {
                node = OperationUtil.findAbstractNodeWithoutScroll(origin, operationService, prepareActions);

                if (node == null) {
                    LogUtil.i(TAG, "未查找到节点【%s】，不进行操作", origin);
                    return "节点未查找到";
                }
            } else if (operation.getOperationMethod().getActionEnum() == PerformActionEnum.SLEEP_UNTIL) {
                // 获取最长sleep时间
                String sleepCount = operation.getOperationMethod().getParam(OperationExecutor.INPUT_TEXT_KEY);
                try {
                    long time = Long.parseLong(sleepCount);

                    long start = System.currentTimeMillis();
                    while ((System.currentTimeMillis() - start) < time) {
                        node = OperationUtil.scrollToScreen(origin, operationService);

                        // 如果找到了，直接break
                        if (node != null) {
                            break;
                        }

                        operationService.invalidRoot();
                        // 等500ms
                        MiscUtil.sleep(500);
                    }

                    // 没找到
                    if (node == null) {
                        LogUtil.w(TAG, "未查找到节点【%s】", origin);
                        return "节点未查找到";
                    }
                } catch (NumberFormatException e) {
                    LogUtil.e(TAG, "无法解析时间%s", sleepCount);
                    return "参数错误";
                }
            } else {
                node = OperationUtil.findAbstractNode(origin, operationService, prepareActions);
                if (node == null) {
                    LogUtil.w(TAG, "未查找到节点【%s】，无法进行操作", origin);
                    return "节点未查找到";
                }
            }

            if (headless && !HeadlessReplayNodeResolver.matchesDeclaredFields(origin, node)) {
                return "节点与已冻结定位条件不一致";
            }
            if (headless && !HeadlessReplayNodeResolver.isActionEligible(node, method.getActionEnum())) {
                return "目标节点不可见或不可用";
            }
            stepInfoBean.setPrepareActionList(prepareActions);

            // 非一机多控回放时截图对比
            // CaptureTree自己会保留截图信息
            if (!(node instanceof CaptureTree) && node.getNodeBound() != null && captureService != null) {
                File captureFile = new File(FileUtils.getSubDir("tmp"), "running.jpg");
                DisplayMetrics metrics = new DisplayMetrics();
                windowManager.getDefaultDisplay().getRealMetrics(metrics);

                int minEdge = Math.min(metrics.widthPixels, metrics.heightPixels);
                float radio = SPService.getInt(SPService.KEY_SCREENSHOT_RESOLUTION, 720) / (float) minEdge;

                // 无法放大
                if (radio > 1) {
                    radio = 1;
                }

                Bitmap capture = null;
                try {
                    capture = captureService.captureScreen(captureFile, metrics.widthPixels, metrics.heightPixels,
                            (int) (radio * metrics.widthPixels), (int) (radio * metrics.heightPixels));
                } catch (RuntimeException e) {
                    // Legacy minicap plugins cannot link on some newer Android releases. Node replay only
                    // uses this bitmap as optional step evidence, so keep accessibility operations running.
                    LogUtil.w(TAG, "截图服务不可用，跳过当前步骤的节点截图", e);
                }

                // 成功截图
                if (capture != null) {
                    Rect displayRect = node.getNodeBound();
                    Rect scaledRect = RectUtil.safetyScale(displayRect, radio, capture.getWidth(),
                            capture.getHeight());

                    Bitmap crop = Bitmap.createBitmap(capture, scaledRect.left,
                            scaledRect.top, scaledRect.width(),
                            scaledRect.height());

                    String content = BitmapUtil.bitmapToBase64(crop);
                    node.setCapture(content);

                    // 回收图片
                    crop.recycle();
                    capture.recycle();
                }

                // 删除文件
                captureFile.delete();
            }

            // 如果需要高亮
            if (!headless && SPService.getBoolean(SPService.KEY_HIGHLIGHT_REPLAY_NODE, true)) {
                // 高亮下
                highLightAndRemove(node, operation.getOperationMethod());
            }
        } else {
            // 前一次操作时间有记录，需要Sleep这段时间
            watcher.sleepUntilContentDontChange();
        }


        // Code security: do not execute after cancellation/lease loss while collecting evidence.
        if (headless && !canContinueHeadlessLookup()) {
            return "回放终止";
        }
        // 执行操作
        boolean result = operationService.doSomeAction(operation.getOperationMethod(), node, listener);
        if (!result) {
            return "执行失败";
        }

        OperationNode opNode = null;
        if (node != null) {
            opNode = OperationStepExporter.exportNodeToOperationNode(node);
        }

        // 等待操作结束
        long sleepTime;
        // 成功执行，需要等待10分钟
        // 等待操作结束
        if (node != null) {
            sleepTime = 60;
        } else if (operation.getOperationMethod().getActionEnum() != PerformActionEnum.SLEEP) {
            sleepTime = 600;
        } else {
            sleepTime = 60 * 60;
        }
        try {
            runningFlag.await(sleepTime, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            LogUtil.e(TAG, "Catch java.lang.InterruptedException: " + e.getMessage(), e);
        }

        // 输入操作会较耗时，需要等待下
        if (method.getActionEnum() == PerformActionEnum.INPUT
                || method.getActionEnum() == PerformActionEnum.INPUT_SEARCH
                || method.getActionEnum() == PerformActionEnum.CLICK_AND_INPUT) {
            MiscUtil.sleep(1000);
            watcher.sleepUntilContentDontChange();
        }

        if (headlessExecutionError != null) {
            return headlessExecutionError;
        }
        stepInfoBean.setFindNode(opNode);

        provider.onStepInfo(stepInfoBean);
        LogUtil.d(TAG, "操作执行完毕");
        return null;
    }

    private boolean canContinueHeadlessLookup() {
        return runningFlag && !cancelRequested && !Thread.currentThread().isInterrupted()
                && ownsReplayLease(replayLeaseOwner);
    }

    private AbstractNodeTree findHeadlessReplayNode(OperationNode selector, long timeoutMs) {
        return HeadlessReplayNodeResolver.resolve(selector, timeoutMs,
                new HeadlessReplayNodeResolver.Source() {
                    @Override public AbstractNodeTree capture() {
                        operationService.invalidRoot();
                        return operationService.getCurrentRoot();
                    }
                    @Override public boolean canContinue() {
                        return canContinueHeadlessLookup();
                    }
                    @Override public long nowMs() {
                        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime());
                    }
                    @Override public boolean await(long delayMs) {
                        try {
                            Thread.sleep(delayMs);
                            return true;
                        } catch (InterruptedException exception) {
                            Thread.currentThread().interrupt();
                            return false;
                        }
                    }
                });
    }

    /**
     * 更新悬浮窗图标
     * @param res
     */
    public void updateFloatIcon(final int res) {
        if (headless) {
            return;
        }
        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                final FloatWinService.FloatBinder activeBinder = binder;
                if (activeBinder != null && !headless) {
                    activeBinder.updateFloatIcon(res);
                }
            }
        });
    }

    /**
     * 高亮操作节点后隐藏
     * @param nodeTree
     * @param method
     */
    private void highLightAndRemove(AbstractNodeTree nodeTree, OperationMethod method) {
        Point p = null;
        Rect rect = nodeTree.getNodeBound();
        if (method != null) {
            String clickPos = method.getParam(OperationExecutor.LOCAL_CLICK_POS_KEY);
            if (!StringUtil.isEmpty(clickPos)) {
                String[] origin = clickPos.split(",");

                // 计算特定坐标
                if (origin.length == 2) {
                    try {
                        float factorX = Float.parseFloat(origin[0]);
                        float factorY = Float.parseFloat(origin[1]);
                        int x = (int) (rect.left + factorX * rect.width());
                        int y = (int) (rect.top + factorY * rect.height());
                        p = new Point(x, y);
                    } catch (Exception e) {
                        LogUtil.e(TAG, "Can't load position");
                    }
                }
            }
        }

        highLightService.highLight(rect, p);
        MiscUtil.sleep(500);
        highLightService.removeHightLightSync();
    }

    @Subscriber(@Param(SubscribeParamEnum.APP))
    public void setApp(String app) {
        this.app = app;
    }



    @Subscriber(value = @Param(type = UIOperationMessage.class, sticky = false), thread = RunningThread.MAIN_THREAD)
    public void receiveDeviceInfoMessage(UIOperationMessage message) {
        if (message == null) {
            return;
        }
        if (headless) {
            // A sleep countdown is presentation only; the executor still performs the full wait.
            // Interactive-only operations must fail instead of silently disappearing or waiting.
            if (runningFlag && (message.eventType == UIOperationMessage.TYPE_DEVICE_INFO
                    || message.eventType == UIOperationMessage.TYPE_DIALOG)) {
                failHeadlessUiOperation();
            }
            return;
        }
        if (binder == null) {
            return;
        }
        if (message.eventType == UIOperationMessage.TYPE_DEVICE_INFO) {
            DeviceInfo info = DeviceInfoUtil.generateDeviceInfo();
            showDialog(StringUtil.getString(R.string.ui__device_info), info.toString(), binder.loadServiceContext(), 0);
        } else if (message.eventType == UIOperationMessage.TYPE_DIALOG) {
            String info = message.getParam("msg");
            String title = message.getParam("title");
            showDialog(title, info, binder.loadServiceContext(), 0);
        } else if (message.eventType == UIOperationMessage.TYPE_COUNT_DOWN) {
            long timeMillis = message.getParam("time");
            showDialog(StringUtil.getString(R.string.ui__sleep), StringUtil.getString(R.string.ui__sleep_time, timeMillis), binder.loadServiceContext(), timeMillis);
        } else if (message.eventType == UIOperationMessage.TYPE_DISMISS) {
            // 隐藏掉原来的Dialog
            if (dialogRef != null && dialogRef.get() != null && dialogRef.get().isShowing()) {
                dialogRef.get().dismiss();
            }
        }
    }

    private void failHeadlessUiOperation() {
        headlessExecutionError = "Interactive replay operation is unavailable in headless mode";
        runningFlag = false;
        OperationContext context = runningContext;
        if (context != null) {
            context.cancelRunning();
        }
    }

    private WeakReference<AlertDialog> dialogRef;

    /**
     * 显示设备悬浮窗
     * @param deviceInfo
     * @param context
     */
    public void showDialog(String title, String deviceInfo, Context context, long timeOut) {
        if (headless || TextUtils.isEmpty(deviceInfo)) {
            return;
        }

        try {
            // 隐藏掉原来的Dialog
            if (dialogRef != null && dialogRef.get() != null && dialogRef.get().isShowing()) {
                dialogRef.get().dismiss();
            }

            View v = LayoutInflater.from(ContextUtil.getContextThemeWrapper(context, R.style.AppDialogTheme)).inflate(R.layout.device_info_view, null);
            TextView info = (TextView) v.findViewById(R.id.device_info);
            info.setText(deviceInfo);

            if (deviceInfo.length() < 30) {
                info.setTextSize(18);
                if (Build.VERSION.SDK_INT >= 23) {
                    info.setTextColor(context.getColor(R.color.colorAccent));
                } else {
                    info.setTextColor(context.getResources().getColor(R.color.colorAccent));
                }
            }

            final AlertDialog dialog = new AlertDialog.Builder(context, R.style.AppDialogTheme)
                    .setTitle(title)
                    .setView(v)
                    .setPositiveButton(R.string.constant__confirm, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            dialog.dismiss();
                        }
                    }).create();
            dialog.getWindow().setType(com.alipay.hulu.common.constant.Constant.TYPE_ALERT);
            dialog.setCanceledOnTouchOutside(false);
            dialog.setCancelable(false);
            dialog.show();
            dialogRef = new WeakReference<>(dialog);

            dialog.getWindow().setLayout(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT);

            // 提前500ms隐藏下
            if (timeOut > 0) {
                long count = timeOut > 500? timeOut - 500: timeOut;

                LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        dialog.dismiss();
                    }
                }, count);
            }
        } catch (Exception e) {
            LogUtil.e(TAG, "显示设备信息异常", e);
        }
    }

    private static class ReplayConnection implements ServiceConnection {
        private WeakReference<CaseReplayManager> managerRef;

        ReplayConnection(CaseReplayManager manager) {
            managerRef = new WeakReference<>(manager);
        }

        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            final FloatWinService.FloatBinder binder = (FloatWinService.FloatBinder) service;
            final CaseReplayManager manager = managerRef.get();

            if (manager == null || manager.headless || manager.cancelRequested
                    || manager.connection != this
                    || !manager.ownsReplayLease(manager.replayLeaseOwner)
                    || manager.provider == null) {
                return;
            }
            manager.binder = binder;
            View v = manager.provider.provideView(binder.loadServiceContext());
            if (v != null) {
                binder.provideDisplayView(v, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            } else {
                binder.provideDisplayView(null, null);
            }

            binder.provideExpendView(null, null);

            binder.registerRunClickListener(manager.listener);
            binder.registerFloatClickListener(manager.floatListener);
            binder.registerStopClickListener(new FloatWinService.OnStopListener() {
                @Override
                public boolean onStopClick() {
                    manager.runningFlag = false;
                    LauncherApplication.getInstance().stopServiceByName(CaseReplayManager.class.getName());
                    return true;
                }
            });
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
        }
    }

    public interface OnFinishListener {
        void onFinish(List<ReplayResultBean> resultBeans, Context context);
    }

    /**
     * 运行状态
     */
    private enum CaseReplayStatus {
        NONE,
        BEFORE_PREPARE,
        PREPARED,
        RUNNING,
        FINISH_RUNNING,
        STOP,
    }
}
