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
package com.alipay.hulu.actions;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Build;
import android.os.IBinder;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.EditText;

import com.alipay.hulu.R;
import com.alipay.hulu.common.annotation.Enable;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.screenRecord.SimpleRecordService;
import com.alipay.hulu.screenRecord.ScreenRecorderLease;
import com.alipay.hulu.screenRecord.TextSpinner;
import com.alipay.hulu.screenRecord.VideoAnalyzer;
import com.alipay.hulu.shared.event.EventService;
import com.alipay.hulu.shared.event.bean.UniversalEventBean;
import com.alipay.hulu.shared.node.action.Constant;
import com.alipay.hulu.shared.node.action.OperationContext;
import com.alipay.hulu.shared.node.action.OperationExecutor;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.action.UIOperationMessage;
import com.alipay.hulu.shared.node.action.provider.ActionProvider;
import com.alipay.hulu.shared.node.action.provider.ViewLoadCallback;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.util.RecordUtil;

import java.io.File;
import java.lang.ref.WeakReference;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicBoolean;

import static com.alipay.hulu.common.application.LauncherApplication.DISMISS_LOADING_DIALOG;
import static com.alipay.hulu.common.application.LauncherApplication.SHOW_LOADING_DIALOG;
import static com.alipay.hulu.common.constant.Constant.EVENT_RECORD_SCREEN_CODE;
import static com.alipay.hulu.shared.node.action.provider.ActionProviderManager.KEY_TARGET_ACTION;

/**
 * Created by qiaoruikai on 2019/1/9 3:17 PM.
 */
@Enable
public class RecordScreenActionProvider implements ActionProvider {
    private static final String TAG = "RecordScreenPvder";
    private static final String ACTION_START_RECORD_SCREEN = "startRecordScreen";
    private static final String ACTION_STOP_RECORD_SCREEN = "stopRecordScreen";

    private static final String KEY_RECORD_RESOLUTION = "resolution";
    private static final String KEY_RECORD_UPLOAD_URL = "url";
    private static final String KEY_RECORD_UPLOAD_TITLE = "title";
    private static final int START_POLL_ATTEMPTS = 100;
    private static final int STOP_POLL_ATTEMPTS = 150;
    private static final long POLL_INTERVAL_MS = 100L;
    private static final Object CLICK_MODE_LOCK = new Object();
    private static RecordScreenActionProvider clickModeOwner;

    private InjectorService injectorService;
    private EventService eventService;
    private boolean injectorRegistered;
    private boolean touchTrackingOwned;

    private boolean inMasterMode = false;

    public volatile boolean isRecording = false;

    public Intent extraData;

    private String uploadUrl;
    private String uploadTitle;

    private String lastUploadTitle;

    private RecordServiceConnection recordConnection;
    private volatile SimpleRecordService.RecordBinder binder;
    private boolean serviceBound;
    private boolean destroyed = true;

    private AtomicBoolean waitForClick = new AtomicBoolean(false);

    private final Object recordingStateLock = new Object();
    private File currentRecordFile;
    private String currentRecordOwner;
    private String pendingRecordOwner;

    private long firstActionTime = -1;
    private long realTouchTime = -1;
    private double targetDiff = 0.2;

    @Override
    public boolean canProcess(String action) {
        // 5.0及以上系统才能支持
        return Build.VERSION.SDK_INT >= 21 && (StringUtil.equals(ACTION_START_RECORD_SCREEN, action)
                || StringUtil.equals(ACTION_STOP_RECORD_SCREEN, action));
    }

    @Override
    public boolean processAction(String targetAction, AbstractNodeTree node, final OperationMethod method,
                                 final OperationContext context) {
        if (StringUtil.equals(targetAction, ACTION_START_RECORD_SCREEN)) {
            if (ClassUtil.getPatchInfo(VideoAnalyzer.SCREEN_RECORD_PATCH) == null) {
                LauncherApplication.getInstance().showToast(StringUtil.getString(R.string.settings__load_plugin));
                return false;
            }
            Intent targetIntent;
            try {
                targetIntent = genRecordIntent(LauncherApplication.getContext(), method);
            } catch (RuntimeException exception) {
                LogUtil.e(TAG, "Unable to prepare screen recording", exception);
                return false;
            }
            final double requestedTargetDiff = targetIntent.getDoubleExtra(
                    SimpleRecordService.INTENT_EXCEPT_DIFF, 0.2D);
            String recordOwner = ScreenRecorderLease.newOwner("case-action");
            SimpleRecordService.RecordBinder activeBinder;
            synchronized (recordingStateLock) {
                if (destroyed) {
                    LogUtil.e(TAG, "Screen recording provider is already destroyed");
                    return false;
                }
                activeBinder = binder;
                if (activeBinder == null) {
                    LogUtil.e(TAG, "Screen recording service is unavailable");
                    return false;
                }
                if (!StringUtil.isEmpty(currentRecordOwner)
                        || !StringUtil.isEmpty(pendingRecordOwner)) {
                    LogUtil.e(TAG, "A screen recording session is already active");
                    return false;
                }
                // 销毁流程必须在服务调用返回前也能取消这个 owner。
                pendingRecordOwner = recordOwner;
            }
            File startedRecordFile;
            try {
                startedRecordFile = activeBinder.startRecord(targetIntent, recordOwner);
            } catch (RuntimeException exception) {
                clearPendingRecordOwner(recordOwner);
                LogUtil.e(TAG, "Unable to start screen recording", exception);
                return false;
            }
            if (startedRecordFile == null) {
                clearPendingRecordOwner(recordOwner);
                LogUtil.e(TAG, "Screen recording service returned no output file");
                return false;
            }
            if (!awaitRecorderStarted(activeBinder, recordOwner)) {
                stopOwnedRecorder(activeBinder, recordOwner);
                clearPendingRecordOwner(recordOwner);
                LogUtil.e(TAG, "Screen recorder did not reach the recording state: "
                        + activeBinder.getLastRecordingError(recordOwner));
                return false;
            }

            boolean rejectPublishedRecorder = false;
            try {
                synchronized (recordingStateLock) {
                    if (destroyed || binder != activeBinder
                            || !StringUtil.equals(pendingRecordOwner, recordOwner)
                            || !activeBinder.isRecording(recordOwner)) {
                        clearPendingRecordOwnerLocked(recordOwner);
                        rejectPublishedRecorder = true;
                    } else {
                        pendingRecordOwner = null;
                        currentRecordFile = startedRecordFile;
                        currentRecordOwner = recordOwner;
                        targetDiff = requestedTargetDiff;
                        uploadTitle = method.getParam(KEY_RECORD_UPLOAD_TITLE);
                        uploadUrl = method.getParam(KEY_RECORD_UPLOAD_URL);
                        realTouchTime = -1;
                        firstActionTime = -1;

                        // 全部会话字段就绪后再切换点击模式，最后发布录制状态。
                        useSendEventClickMode();
                        waitForClick.set(true);
                        isRecording = true;
                    }
                }
            } catch (RuntimeException exception) {
                stopOwnedRecorder(activeBinder, recordOwner);
                resetRecordingState(true);
                LogUtil.e(TAG, "Unable to publish screen recording state", exception);
                return false;
            }
            if (rejectPublishedRecorder) {
                stopOwnedRecorder(activeBinder, recordOwner);
                return false;
            }
            if (!activeBinder.isRecording(recordOwner)) {
                stopOwnedRecorder(activeBinder, recordOwner);
                resetRecordingState(true);
                return false;
            }

            context.notifyOperationFinish();
            return true;
        } else if (StringUtil.equals(targetAction, ACTION_STOP_RECORD_SCREEN)) {
            final SimpleRecordService.RecordBinder activeBinder;
            final File recordFile;
            final String recordOwner;
            final String recordUploadUrl;
            final String recordUploadTitle;
            final double recordTargetDiff;
            final long recordTouchTime;
            synchronized (recordingStateLock) {
                activeBinder = binder;
                recordFile = currentRecordFile;
                recordOwner = currentRecordOwner;
                recordUploadUrl = uploadUrl;
                recordUploadTitle = uploadTitle;
                recordTargetDiff = targetDiff;
                recordTouchTime = realTouchTime;
                clearRecordingStateLocked();
            }
            restoreDefaultClickMode();
            if (activeBinder == null || recordFile == null
                    || StringUtil.isEmpty(recordOwner)) {
                LogUtil.e(TAG, "Screen recording session was lost before stop");
                return false;
            }
            context.notifyOnFinish(new Runnable() {
                @Override
                public void run() {
                    boolean loadingShown = false;
                    try {
                        injectorService.pushMessage(SHOW_LOADING_DIALOG, StringUtil.getString(R.string.record_screen__calculating_response_time));
                        loadingShown = true;

                        if (!activeBinder.stopRecord(recordOwner)) {
                            throw new IllegalStateException(
                                    "Screen recording ownership was lost before stop");
                        }
                        if (!awaitRecorderStopped(activeBinder, recordOwner)) {
                            throw new IllegalStateException(
                                    "Timed out waiting for screen recording to stop");
                        }
                        String recordingError = activeBinder.getLastRecordingError(recordOwner);
                        if (!StringUtil.isEmpty(recordingError)) {
                            throw new IllegalStateException(recordingError);
                        }
                        long startTime = activeBinder.getLastRecorderStartTime(recordOwner);
                        if (startTime <= 0L) {
                            throw new IllegalStateException(
                                    "Screen recorder did not publish a start time");
                        }
                        if (!recordFile.isFile() || recordFile.length() <= 0L) {
                            throw new IllegalStateException(
                                    "Screen recording output was not written successfully");
                        }

                        LogUtil.d(TAG, "视频起始时间： " + startTime);
                        processVideo(recordFile.getPath(), startTime, recordTouchTime,
                                recordTargetDiff, recordUploadUrl, recordUploadTitle);
                    } catch (Exception e) {
                        LogUtil.e(TAG, "计算响应耗时出现异常: " + e.getMessage(), e);
                    } finally {
                        if (loadingShown) {
                            injectorService.pushMessage(DISMISS_LOADING_DIALOG);
                        }
                    }
                }
            });
            return true;
        }
        return false;
    }

    /**
     * 生成录屏Intent
     * @param method
     * @return
     */
    private Intent genRecordIntent(Context context, OperationMethod method) {
        String resolution = method.getParam(KEY_RECORD_RESOLUTION);
        String[] xes = resolution.split("x");
        int width = Integer.parseInt(xes[0]);
        int height = Integer.parseInt(xes[1]);

        // 默认单位改成kbit/sec
        int bitrate = Integer.parseInt(method.getParam(SimpleRecordService.INTENT_VIDEO_BITRATE)) * 1000;
        int fps = Integer.parseInt(method.getParam(SimpleRecordService.INTENT_FRAME_RATE));
        double requestedTargetDiff = Double.parseDouble(
                method.getParam(SimpleRecordService.INTENT_EXCEPT_DIFF));

        Intent intent = new Intent(context, SimpleRecordService.class);
        intent.putExtra(SimpleRecordService.INTENT_FRAME_RATE, fps);
        intent.putExtra(SimpleRecordService.INTENT_VIDEO_BITRATE, bitrate);
        intent.putExtra(SimpleRecordService.INTENT_EXCEPT_DIFF, requestedTargetDiff);
        intent.putExtra(SimpleRecordService.INTENT_WIDTH, width);
        intent.putExtra(SimpleRecordService.INTENT_HEIGHT, height);
        intent.putExtras(extraData);

        return intent;
    }

    @Override
    public Map<String, String> provideActions(AbstractNodeTree node) {
        if (Build.VERSION.SDK_INT < 21 || node != null) {
            return null;
        }

        Map<String, String> desc = new HashMap<>(2);
        if (!isRecording) {
            desc.put(ACTION_START_RECORD_SCREEN, StringUtil.getString(R.string.record_screen__start_launch_time));
        } else {
            desc.put(ACTION_STOP_RECORD_SCREEN, StringUtil.getString(R.string.record_screen__stop_launch_time));
        }

        return desc;
    }

    /**
     * 处理视频
     * @param path
     */
    private void processVideo(String path, long videoStartTime, long expectedTouchTime,
                              double expectedDiff,
                              final String expectedUploadUrl,
                              final String expectedUploadTitle) {
        VideoAnalyzer.getInstance().doAnalyze(expectedTouchTime - videoStartTime, expectedDiff
                ,path, new VideoAnalyzer.AnalyzeListener() {
                    @Override
                    public void onAnalyzeFinished(final long result) {
                        UIOperationMessage message = new UIOperationMessage();
                        message.eventType = UIOperationMessage.TYPE_DIALOG;
                        message.params.put("msg", StringUtil.getString(R.string.record_screen__cost_time, result));
                        message.params.put("title", StringUtil.getString(R.string.record_screen__response_time));
                        injectorService.pushMessage(null, message, false);

                        // 如果有配置上传信息
                        if (!StringUtil.isEmpty(expectedUploadUrl)) {
                            BackgroundExecutor.execute(new Runnable() {
                                @Override
                                public void run() {
                                    // 确保上传标题非空
                                    String toUpload = StringUtil.isEmpty(expectedUploadTitle)?
                                            Long.toString(System.currentTimeMillis()): expectedUploadTitle;

                                    RecordUtil.uploadRecordData(expectedUploadUrl, result, toUpload);

                                    // 记录上一次提交标题
                                    lastUploadTitle = expectedUploadTitle;
                                }
                            });
                        }
                    }

                    @Override
                    public void onAnalyzeFailed(final String msg) {

                    }
                });
    }

    @Override
    public void provideView(final Context context, String key, final OperationMethod method,
                            AbstractNodeTree node, ViewLoadCallback callback) {
        // 第一次需要配置
        if (StringUtil.equals(key, ACTION_START_RECORD_SCREEN)) {
            inMasterMode = true;
            View v = LayoutInflater.from(ContextUtil.getContextThemeWrapper(context, R.style.AppDialogTheme)).inflate(R.layout.dialog_action_record_config, null);
            View layoutWrapper = v.findViewById(R.id.dialog_action_record_title_layout);
            String uploadUrl = SPService.getString(SPService.KEY_RECORD_SCREEN_UPLOAD, null);

            // 有配置上传地址，提供标题配置选项
            if (uploadUrl != null) {
                method.putParam(KEY_RECORD_UPLOAD_URL, uploadUrl);
                EditText title = (EditText) layoutWrapper.findViewById(R.id.dialog_action_record_title);
                title.addTextChangedListener(new TextWatcher() {
                    @Override
                    public void beforeTextChanged(CharSequence s, int start, int count, int after) {

                    }

                    @Override
                    public void onTextChanged(CharSequence s, int start, int before, int count) {

                    }

                    @Override
                    public void afterTextChanged(Editable s) {
                        method.putParam(KEY_RECORD_UPLOAD_TITLE, s.toString());
                    }
                });

                // 如果有上一次上传的标题，配置下
                if (lastUploadTitle != null) {
                    title.setText(lastUploadTitle);
                }
            } else {
                // 没有上传地址，直接返回空
                layoutWrapper.setVisibility(View.GONE);
            }

            // 加载Spinner
            TextSpinner resolution = (TextSpinner) v.findViewById(R.id.dialog_action_record_resolution);
            resolution.setTag(KEY_RECORD_RESOLUTION);
            TextSpinner bitrate = (TextSpinner) v.findViewById(R.id.dialog_action_record_bitrate);
            bitrate.setTag(SimpleRecordService.INTENT_VIDEO_BITRATE);
            TextSpinner fps = (TextSpinner) v.findViewById(R.id.dialog_action_record_fps);
            fps.setTag(SimpleRecordService.INTENT_FRAME_RATE);
            TextSpinner diff = (TextSpinner) v.findViewById(R.id.dialog_action_record_diff);
            diff.setTag(SimpleRecordService.INTENT_EXCEPT_DIFF);


            TextSpinner.OnItemSelectedListener listener = new TextSpinner.OnItemSelectedListener() {
                @Override
                public void onItemSelected(TextSpinner view, int position) {
                    String key = (String) view.getTag();
                    String value = view.getSelectedItem();
                    method.putParam(key, value);
                }
            };

            // 统一监听下
            resolution.setOnItemSelectedListener(listener);
            bitrate.setOnItemSelectedListener(listener);
            fps.setOnItemSelectedListener(listener);
            diff.setOnItemSelectedListener(listener);

            // 默认设置
            resolution.setSelectedPosition(0);
            bitrate.setSelectedPosition(0);
            fps.setSelectedPosition(0);
            diff.setSelectedPosition(0);

            callback.onViewLoaded(v);
        } else {
            callback.onViewLoaded(null);
        }
    }

    @Override
    public void onCreate(Context context) {
        if (Build.VERSION.SDK_INT < 21) {
            return;
        }

        final Context applicationContext = LauncherApplication.getContext();
        final InjectorService targetInjector = LauncherApplication.getInstance()
                .findServiceByName(InjectorService.class.getName());
        final EventService targetEventService = LauncherApplication.getInstance()
                .findServiceByName(EventService.class.getName());
        final Intent intent = new Intent(applicationContext, SimpleRecordService.class);
        final RecordServiceConnection connection =
                new RecordServiceConnection(RecordScreenActionProvider.this);
        synchronized (recordingStateLock) {
            destroyed = false;
            injectorService = targetInjector;
            eventService = targetEventService;
            injectorRegistered = false;
            touchTrackingOwned = false;
            binder = null;
            recordConnection = connection;
            serviceBound = false;
        }

        targetInjector.register(this);
        boolean unregisterAfterDestroy = false;
        synchronized (recordingStateLock) {
            if (!destroyed && injectorService == targetInjector) {
                injectorRegistered = true;
            } else {
                unregisterAfterDestroy = true;
            }
        }
        if (unregisterAfterDestroy) {
            targetInjector.unregister(this);
        }

        targetEventService.startTrackTouch(this);
        boolean releaseTouchAfterDestroy = false;
        synchronized (recordingStateLock) {
            if (!destroyed && eventService == targetEventService) {
                touchTrackingOwned = true;
            } else {
                releaseTouchAfterDestroy = true;
            }
        }
        if (releaseTouchAfterDestroy) {
            targetEventService.stopTrackTouch(this);
        }

        // 连接SimpleRecordService
        boolean bound = applicationContext.bindService(
                intent, connection, Context.BIND_AUTO_CREATE);
        boolean unbindAfterDestroy = false;
        synchronized (recordingStateLock) {
            if (!destroyed && recordConnection == connection) {
                serviceBound = bound;
            } else if (bound) {
                unbindAfterDestroy = true;
            }
        }
        if (unbindAfterDestroy) {
            unbindServiceQuietly(applicationContext, connection);
        }
    }

    @Override
    public void onDestroy(Context context) {
        if (Build.VERSION.SDK_INT < 21) {
            return;
        }

        final SimpleRecordService.RecordBinder activeBinder;
        final RecordServiceConnection connection;
        final boolean shouldUnbind;
        final String recordOwner;
        final InjectorService registeredInjector;
        final EventService ownedEventService;
        synchronized (recordingStateLock) {
            destroyed = true;
            activeBinder = binder;
            binder = null;
            connection = recordConnection;
            shouldUnbind = serviceBound;
            recordConnection = null;
            serviceBound = false;
            recordOwner = StringUtil.isEmpty(currentRecordOwner)
                    ? pendingRecordOwner : currentRecordOwner;
            registeredInjector = injectorRegistered ? injectorService : null;
            injectorRegistered = false;
            ownedEventService = touchTrackingOwned ? eventService : null;
            touchTrackingOwned = false;
            clearRecordingStateLocked();
        }
        restoreDefaultClickMode();
        if (activeBinder != null && !StringUtil.isEmpty(recordOwner)) {
            try {
                activeBinder.stopRecord(recordOwner);
            } catch (RuntimeException exception) {
                LogUtil.w(TAG, "Unable to stop screen recording while destroying provider");
            }
        }
        Context applicationContext = context.getApplicationContext();
        if (shouldUnbind && connection != null) {
            unbindServiceQuietly(applicationContext, connection);
        }
        if (activeBinder != null || shouldUnbind) {
            Intent intent = new Intent(applicationContext, SimpleRecordService.class);
            applicationContext.stopService(intent);
        }
        if (ownedEventService != null) {
            ownedEventService.stopTrackTouch(this);
        }
        if (registeredInjector != null) {
            registeredInjector.unregister(this);
        }
    }

    @Subscriber(@Param(value = Constant.ACTION_OPERATION_STEP, sticky = false))
    public void onReceiveEvent(PerformActionEnum actionEnum) {
        if ((actionEnum == PerformActionEnum.CLICK
                || actionEnum == PerformActionEnum.CLICK_IF_EXISTS
                ||actionEnum == PerformActionEnum.CLICK_QUICK)
                && waitForClick.compareAndSet(true, false)) {
            firstActionTime = System.currentTimeMillis();

            LogUtil.d(TAG, "Receive event: " + actionEnum);

            // 主机模式需要监控点击事件
            if (inMasterMode) {
                LogUtil.d(TAG, "主机模式，控制悬浮窗点击");
                injectorService.pushMessage("FloatClickMethod", new Callable<OperationMethod>() {
                    @Override
                    public OperationMethod call() throws Exception {
                        OperationMethod method = new OperationMethod(PerformActionEnum.OTHER_GLOBAL);
                        method.putParam(KEY_TARGET_ACTION, ACTION_STOP_RECORD_SCREEN);
                        return method;
                    }
                });
            }
        }
    }

    @Subscriber(@Param(value = com.alipay.hulu.shared.event.constant.Constant.EVENT_TOUCH_UP, sticky = false))
    public void onReceiveButtonUp(UniversalEventBean eventBean) {
        if (realTouchTime == -1 && firstActionTime > 0 && eventBean.getTime() > firstActionTime) {
            LogUtil.d(TAG, "Select touch time: " + eventBean.getTime());
            realTouchTime = eventBean.getTime();
        }
    }

    @Subscriber(@Param(EVENT_RECORD_SCREEN_CODE))
    public void receiveRecordData(Intent extra) {
        this.extraData = extra;
    }

    private static class RecordServiceConnection implements ServiceConnection {
        private WeakReference<RecordScreenActionProvider> pvderRef;

        /**
         * 初始化
         * @param pvd
         */
        RecordServiceConnection(RecordScreenActionProvider pvd) {
            pvderRef = new WeakReference<>(pvd);
        }

        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            LogUtil.d(TAG, "SimpleRecordService Connected");
            RecordScreenActionProvider pvd = pvderRef.get();
            if (pvd != null) {
                pvd.handleServiceConnected(this,
                        (SimpleRecordService.RecordBinder) service);
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            LogUtil.d(TAG, "SimpleRecordService disconnected");
            RecordScreenActionProvider provider = pvderRef.get();
            if (provider != null) {
                provider.handleServiceDisconnected(this);
            }
        }
    }

    private void handleServiceConnected(RecordServiceConnection connection,
                                        SimpleRecordService.RecordBinder connectedBinder) {
        synchronized (recordingStateLock) {
            if (!destroyed && recordConnection == connection) {
                binder = connectedBinder;
            }
        }
    }

    private void handleServiceDisconnected(RecordServiceConnection connection) {
        synchronized (recordingStateLock) {
            if (recordConnection != connection) {
                return;
            }
            binder = null;
            clearRecordingStateLocked();
        }
        restoreDefaultClickMode();
    }

    private boolean awaitRecorderStarted(SimpleRecordService.RecordBinder activeBinder,
                                         String recordOwner) {
        for (int attempt = 0; attempt < START_POLL_ATTEMPTS; attempt++) {
            synchronized (recordingStateLock) {
                if (destroyed || binder != activeBinder) {
                    return false;
                }
            }
            if (!StringUtil.isEmpty(activeBinder.getLastRecordingError(recordOwner))) {
                return false;
            }
            if (activeBinder.isRecording(recordOwner)) {
                return true;
            }
            if (!activeBinder.isRecorderActive(recordOwner)) {
                return false;
            }
            if (!waitForNextPoll()) {
                return false;
            }
        }
        return false;
    }

    private boolean awaitRecorderStopped(SimpleRecordService.RecordBinder activeBinder,
                                         String recordOwner) {
        for (int attempt = 0; attempt < STOP_POLL_ATTEMPTS; attempt++) {
            if (!activeBinder.isOwnedBy(recordOwner)
                    && activeBinder.isStopCompleted(recordOwner)) {
                return true;
            }
            if (!waitForNextPoll()) {
                return false;
            }
        }
        return false;
    }

    private void resetRecordingState(boolean restoreClickMode) {
        synchronized (recordingStateLock) {
            clearRecordingStateLocked();
        }
        if (restoreClickMode) {
            restoreDefaultClickMode();
        }
    }

    private void clearRecordingStateLocked() {
        isRecording = false;
        waitForClick.set(false);
        inMasterMode = false;
        currentRecordFile = null;
        currentRecordOwner = null;
        pendingRecordOwner = null;
        uploadUrl = null;
        uploadTitle = null;
        firstActionTime = -1L;
        realTouchTime = -1L;
    }

    private void useSendEventClickMode() {
        synchronized (CLICK_MODE_LOCK) {
            injectorService.pushMessage(OperationExecutor.EVENT_CLICK_TYPE,
                    OperationExecutor.CLICK_TYPE_SEND_EVENT);
            clickModeOwner = this;
        }
    }

    private void restoreDefaultClickMode() {
        synchronized (CLICK_MODE_LOCK) {
            if (clickModeOwner != this) {
                return;
            }
            clickModeOwner = null;
            if (injectorService != null) {
                injectorService.pushMessage(OperationExecutor.EVENT_CLICK_TYPE,
                        OperationExecutor.CLICK_TYPE_ADB_TAP);
            }
        }
    }

    private void clearPendingRecordOwner(String recordOwner) {
        synchronized (recordingStateLock) {
            clearPendingRecordOwnerLocked(recordOwner);
        }
    }

    private void clearPendingRecordOwnerLocked(String recordOwner) {
        if (StringUtil.equals(pendingRecordOwner, recordOwner)) {
            pendingRecordOwner = null;
        }
    }

    private void stopOwnedRecorder(SimpleRecordService.RecordBinder activeBinder,
                                   String recordOwner) {
        if (activeBinder != null && activeBinder.isOwnedBy(recordOwner)) {
            activeBinder.stopRecord(recordOwner);
        }
    }

    private boolean waitForNextPoll() {
        try {
            Thread.sleep(POLL_INTERVAL_MS);
            return true;
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private void unbindServiceQuietly(Context context, ServiceConnection connection) {
        try {
            context.unbindService(connection);
        } catch (IllegalArgumentException exception) {
            LogUtil.w(TAG, "Screen recording service was already unbound");
        }
    }
}
