/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.alipay.hulu.scheme;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.scheme.SchemeActionResolver;
import com.alipay.hulu.common.scheme.AdbSchemeActivity;
import com.alipay.hulu.common.scheme.SchemeResolver;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.screenRecord.ScreenRecorderLease;
import com.alipay.hulu.screenRecord.SimpleRecordService;

import java.io.File;
import java.io.IOException;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.alipay.hulu.common.constant.Constant.EVENT_RECORD_SCREEN_CODE;

/**
 * 有界屏幕录制协议。查询可走 HTTP；启动和停止只允许 ADB Scheme。
 * 每个会话都要求用户通过系统 MediaProjection 对话框确认。
 */
@SchemeResolver("screen-record")
public class ScreenRecordSchemeResolver implements SchemeActionResolver {
    private static final String TAG = ScreenRecordSchemeResolver.class.getSimpleName();

    private static final String ACTION_STATUS = "status";
    private static final String ACTION_START = "start";
    private static final String ACTION_STOP = "stop";

    private static final String STATE_IDLE = "idle";
    private static final String STATE_PENDING_USER_CONFIRMATION = "pending-user-confirmation";
    private static final String STATE_STARTING = "starting";
    private static final String STATE_RECORDING = "recording";
    private static final String STATE_STOPPING = "stopping";
    private static final String STATE_STOPPED = "stopped";
    private static final String STATE_FAILED = "failed";

    private static final String DEFAULT_RESOLUTION = "720x480";
    private static final int DEFAULT_BITRATE_KBPS = 2500;
    private static final int DEFAULT_FRAME_RATE = 30;
    private static final int DEFAULT_DURATION_SECONDS = 300;
    private static final int MIN_DIMENSION = 128;
    private static final int MAX_DIMENSION = 4096;
    private static final int MIN_BITRATE_KBPS = 100;
    private static final int MAX_BITRATE_KBPS = 50000;
    private static final int MIN_FRAME_RATE = 1;
    private static final int MAX_FRAME_RATE = 120;
    private static final int MIN_DURATION_SECONDS = 1;
    private static final int MAX_DURATION_SECONDS = 3600;
    private static final int START_POLL_ATTEMPTS = 100;
    private static final int STOP_POLL_ATTEMPTS = 150;
    private static final long POLL_INTERVAL_MS = 100L;
    private static final double INTERNAL_EXCEPT_DIFF = 0.2D;
    private static final Pattern RESOLUTION_PATTERN = Pattern.compile("^(\\d{3,4})x(\\d{3,4})$");
    private static final Pattern SESSION_ID_PATTERN = Pattern.compile("^[A-Za-z0-9._-]{1,128}$");

    private static final Object STATE_LOCK = new Object();
    private static final Handler MAIN_HANDLER = new Handler(Looper.getMainLooper());

    private static String sessionId;
    private static String state = STATE_IDLE;
    private static String error;
    private static String outputPath;
    private static String resolution;
    private static int width;
    private static int height;
    private static int bitrateKbps;
    private static int frameRate;
    private static int durationSec;
    private static long requestedAt;
    private static long startedAt;
    private static long finishedAt;
    private static boolean userActionRequired;
    private static boolean autoStopped;
    private static boolean cancelledBeforeStart;
    private static boolean stopIssued;
    private static long sessionGeneration;
    private static String recorderOwnerToken;
    private static String capturesRoot;

    private static Context boundContext;
    private static ServiceConnection serviceConnection;
    private static SimpleRecordService.RecordBinder recordBinder;
    private static long boundGeneration;

    @Override
    public boolean processScheme(Context context, Map<String, String> params,
                                 Callback<Map<String, Object>> callback) {
        String action = params.get("action");
        if (ACTION_STATUS.equals(action)) {
            callback.onResult(snapshot());
            return true;
        }
        if (!ACTION_START.equals(action) && !ACTION_STOP.equals(action)) {
            callback.onResult(error("unsupported_action", "Unsupported screen-record action: " + action));
            return true;
        }
        if (!(context instanceof AdbSchemeActivity)) {
            callback.onResult(error("mutation_transport_required",
                    "Screen recording changes require the ADB scheme transport"));
            return true;
        }
        if (ACTION_START.equals(action)) {
            callback.onResult(start((Activity) context, params));
        } else {
            callback.onResult(stop(params.get("sessionId"), false));
        }
        return true;
    }

    private Map<String, Object> start(final Activity activity, Map<String, String> params) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            return error("unsupported_android_version", "Screen recording requires Android 5.0 or newer");
        }
        final String requestedSessionId = params.get("sessionId");
        if (!isValidSessionId(requestedSessionId)) {
            return error("invalid_session_id",
                    "sessionId must contain 1-128 letters, numbers, dots, underscores, or hyphens");
        }

        final RecordingConfig config;
        try {
            config = RecordingConfig.parse(params);
        } catch (IllegalArgumentException exception) {
            return error("invalid_screen_record_config", exception.getMessage());
        }

        final long expectedGeneration;
        final String expectedOwner;
        synchronized (STATE_LOCK) {
            if (isActive(state)) {
                return errorWithStatus("screen_record_conflict",
                        "A screen recording session is already active");
            }
            if (ScreenRecorderLease.isHeld()) {
                return errorWithStatus("external_screen_record_conflict",
                        "Another SoloPi screen recorder is already active");
            }
            sessionId = requestedSessionId;
            expectedGeneration = ++sessionGeneration;
            expectedOwner = ScreenRecorderLease.newOwner("scheme");
            recorderOwnerToken = expectedOwner;
            state = STATE_PENDING_USER_CONFIRMATION;
            error = null;
            outputPath = null;
            resolution = config.resolution;
            width = config.width;
            height = config.height;
            bitrateKbps = config.bitrateKbps;
            frameRate = config.frameRate;
            durationSec = config.durationSec;
            requestedAt = System.currentTimeMillis();
            startedAt = 0L;
            finishedAt = 0L;
            userActionRequired = true;
            autoStopped = false;
            cancelledBeforeStart = false;
            stopIssued = false;
            capturesRoot = canonicalPath(FileUtils.getSubDir(SimpleRecordService.VIDEO_DIR));
        }

        final InjectorService injectorService = InjectorService.g();
        if (injectorService == null) {
            markFailed(requestedSessionId, expectedGeneration,
                    "MediaProjection permission service is unavailable");
            return snapshot();
        }

        // 新版 Android 的 MediaProjection 授权令牌仅在当前会话有效。
        // 清除缓存令牌，确保本协议不会复用其他会话所有者的授权。
        injectorService.pushMessage(EVENT_RECORD_SCREEN_CODE, null);
        try {
            PermissionUtil.requestPermissions(Arrays.asList("screenRecord"), activity,
                    new PermissionUtil.OnPermissionCallback() {
                        @Override
                        public void onPermissionResult(boolean result, String reason) {
                            try {
                                if (!result) {
                                    markFailed(requestedSessionId, expectedGeneration,
                                            "MediaProjection permission was not granted: " + reason);
                                    return;
                                }
                                Intent projectionData;
                                synchronized (STATE_LOCK) {
                                    if (!matchesSessionLocked(requestedSessionId,
                                            expectedGeneration)
                                            || !StringUtil.equals(expectedOwner,
                                            recorderOwnerToken)
                                            || !STATE_PENDING_USER_CONFIRMATION.equals(state)) {
                                        return;
                                    }
                                    projectionData = injectorService.getMessage(
                                            EVENT_RECORD_SCREEN_CODE, Intent.class);
                                    // 在 generation 锁内消费并清除 grant，避免旧回调取走新会话 token。
                                    injectorService.pushMessage(EVENT_RECORD_SCREEN_CODE, null);
                                }
                                if (projectionData == null) {
                                    markFailed(requestedSessionId, expectedGeneration,
                                            "MediaProjection permission result is unavailable");
                                    return;
                                }
                                bindAndStart(requestedSessionId, expectedGeneration, expectedOwner,
                                        projectionData, config);
                            } catch (RuntimeException exception) {
                                markFailed(requestedSessionId, expectedGeneration,
                                        "Unable to handle MediaProjection permission result: "
                                                + exception.getMessage());
                            }
                        }
                    });
        } catch (RuntimeException exception) {
            markFailed(requestedSessionId, expectedGeneration,
                    "Unable to request MediaProjection permission: " + exception.getMessage());
        }
        return snapshot();
    }

    private static void bindAndStart(final String expectedSessionId,
                                     final long expectedGeneration, final String expectedOwner,
                                     Intent projectionData,
                                     final RecordingConfig config) {
        synchronized (STATE_LOCK) {
            if (!matchesSessionLocked(expectedSessionId, expectedGeneration)
                    || !StringUtil.equals(expectedOwner, recorderOwnerToken)
                    || !STATE_PENDING_USER_CONFIRMATION.equals(state)) {
                return;
            }
            state = STATE_STARTING;
            userActionRequired = false;
        }

        final Context applicationContext = LauncherApplication.getContext();
        final Intent recordIntent = new Intent(applicationContext, SimpleRecordService.class);
        recordIntent.putExtras(projectionData);
        // SimpleRecordService 为兼容历史用例动作，仍会交换 height/width。
        // 此处反向传递 extras，使类型化接口保持标准 WIDTHxHEIGHT 语义。
        recordIntent.putExtra(SimpleRecordService.INTENT_WIDTH, config.height);
        recordIntent.putExtra(SimpleRecordService.INTENT_HEIGHT, config.width);
        recordIntent.putExtra(SimpleRecordService.INTENT_VIDEO_BITRATE,
                config.bitrateKbps * 1000);
        recordIntent.putExtra(SimpleRecordService.INTENT_FRAME_RATE, config.frameRate);
        recordIntent.putExtra(SimpleRecordService.INTENT_EXCEPT_DIFF, INTERNAL_EXCEPT_DIFF);

        ServiceConnection connection = new ServiceConnection() {
            @Override
            public void onServiceConnected(ComponentName name, IBinder service) {
                if (!(service instanceof SimpleRecordService.RecordBinder)) {
                    markFailed(expectedSessionId, expectedGeneration,
                            "Unexpected screen recording service binder");
                    releaseBinding(expectedGeneration);
                    return;
                }
                SimpleRecordService.RecordBinder binder =
                        (SimpleRecordService.RecordBinder) service;
                boolean abandon = false;
                synchronized (STATE_LOCK) {
                    if (!matchesSessionLocked(expectedSessionId, expectedGeneration)
                            || !StringUtil.equals(expectedOwner, recorderOwnerToken)
                            || boundGeneration != expectedGeneration
                            || serviceConnection != this) {
                        abandon = true;
                    } else if (STATE_STOPPING.equals(state)) {
                        cancelledBeforeStart = true;
                        markStoppedLocked(expectedSessionId, expectedGeneration);
                        abandon = true;
                    } else if (!STATE_STARTING.equals(state)) {
                        abandon = true;
                    } else {
                        recordBinder = binder;
                    }
                }
                if (abandon) {
                    releaseBinding(expectedGeneration);
                    return;
                }

                File output;
                try {
                    output = binder.startRecord(recordIntent, expectedOwner);
                } catch (RuntimeException exception) {
                    markFailed(expectedSessionId, expectedGeneration,
                            "Unable to start screen recording: " + exception.getMessage());
                    releaseBinding(expectedGeneration);
                    return;
                }
                if (output == null) {
                    String serviceError = binder.getLastRecordingError(expectedOwner);
                    markFailed(expectedSessionId, expectedGeneration,
                            StringUtil.isEmpty(serviceError)
                                    ? "Unable to initialize screen recording" : serviceError);
                    releaseBinding(expectedGeneration);
                    return;
                }
                String canonicalOutput = canonicalPath(output);
                if (!isInsideCapturesRoot(canonicalOutput)) {
                    binder.stopRecord(expectedOwner);
                    markFailed(expectedSessionId, expectedGeneration,
                            "Screen recording output escaped the controlled capture directory");
                    releaseBinding(expectedGeneration);
                    return;
                }
                synchronized (STATE_LOCK) {
                    if (matchesSessionLocked(expectedSessionId, expectedGeneration)
                            && StringUtil.equals(expectedOwner, recorderOwnerToken)) {
                        outputPath = canonicalOutput;
                    }
                }
                awaitStarted(expectedSessionId, expectedGeneration, expectedOwner,
                        START_POLL_ATTEMPTS);
            }

            @Override
            public void onServiceDisconnected(ComponentName name) {
                boolean shouldFail;
                synchronized (STATE_LOCK) {
                    shouldFail = matchesSessionLocked(expectedSessionId, expectedGeneration)
                            && StringUtil.equals(expectedOwner, recorderOwnerToken)
                            && boundGeneration == expectedGeneration
                            && serviceConnection == this
                            && isActive(state);
                    if (boundGeneration == expectedGeneration && serviceConnection == this) {
                        recordBinder = null;
                        boundContext = null;
                        serviceConnection = null;
                        boundGeneration = 0L;
                    }
                }
                if (shouldFail) {
                    markFailed(expectedSessionId, expectedGeneration,
                            "Screen recording service disconnected");
                }
            }
        };

        synchronized (STATE_LOCK) {
            if (!matchesSessionLocked(expectedSessionId, expectedGeneration)
                    || !StringUtil.equals(expectedOwner, recorderOwnerToken)
                    || !STATE_STARTING.equals(state)) {
                return;
            }
            boundContext = applicationContext;
            serviceConnection = connection;
            boundGeneration = expectedGeneration;
        }
        boolean bound;
        try {
            bound = applicationContext.bindService(recordIntent, connection,
                    Context.BIND_AUTO_CREATE);
        } catch (RuntimeException exception) {
            bound = false;
            LogUtil.e(TAG, "Unable to bind screen recording service", exception);
        }
        if (!bound) {
            markFailed(expectedSessionId, expectedGeneration,
                    "Unable to bind screen recording service");
            releaseBinding(expectedGeneration);
        }
    }

    private static void awaitStarted(final String expectedSessionId,
                                     final long expectedGeneration, final String expectedOwner,
                                     final int attemptsLeft) {
        MAIN_HANDLER.postDelayed(new Runnable() {
            @Override
            public void run() {
                SimpleRecordService.RecordBinder binder;
                String currentState;
                synchronized (STATE_LOCK) {
                    if (!matchesSessionLocked(expectedSessionId, expectedGeneration)
                            || !StringUtil.equals(expectedOwner, recorderOwnerToken)) {
                        return;
                    }
                    binder = recordBinder;
                    currentState = state;
                }
                if (STATE_STOPPING.equals(currentState)) {
                    issueStopAndAwait(expectedSessionId, expectedGeneration, expectedOwner);
                    return;
                }
                if (!STATE_STARTING.equals(currentState) || binder == null) {
                    return;
                }
                String serviceError = binder.getLastRecordingError(expectedOwner);
                if (!StringUtil.isEmpty(serviceError)) {
                    markFailed(expectedSessionId, expectedGeneration, serviceError);
                    releaseBinding(expectedGeneration);
                    return;
                }
                int autoStopAfter = -1;
                synchronized (STATE_LOCK) {
                    if (!matchesSessionLocked(expectedSessionId, expectedGeneration)
                            || !StringUtil.equals(expectedOwner, recorderOwnerToken)
                            || !STATE_STARTING.equals(state)) {
                        return;
                    }
                    if (binder.isRecording(expectedOwner)) {
                        state = STATE_RECORDING;
                        startedAt = binder.getLastRecorderStartTime(expectedOwner);
                        autoStopAfter = durationSec;
                    }
                }
                if (autoStopAfter >= 0) {
                    if (!binder.isRecording(expectedOwner)) {
                        markFailed(expectedSessionId, expectedGeneration,
                                "Screen recorder ended while publishing its start state");
                        releaseBinding(expectedGeneration);
                        return;
                    }
                    MAIN_HANDLER.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            stop(expectedSessionId, expectedGeneration, expectedOwner, true);
                        }
                    }, autoStopAfter * 1000L);
                    return;
                }
                if (!binder.isRecorderActive(expectedOwner)) {
                    markFailed(expectedSessionId, expectedGeneration,
                            "Screen recorder ended before it started");
                    releaseBinding(expectedGeneration);
                    return;
                }
                if (attemptsLeft <= 0) {
                    binder.stopRecord(expectedOwner);
                    markFailed(expectedSessionId, expectedGeneration,
                            "Timed out waiting for screen recording to start");
                    releaseBinding(expectedGeneration);
                    return;
                }
                awaitStarted(expectedSessionId, expectedGeneration, expectedOwner,
                        attemptsLeft - 1);
            }
        }, POLL_INTERVAL_MS);
    }

    private static Map<String, Object> stop(String requestedSessionId, boolean automatic) {
        if (!isValidSessionId(requestedSessionId)) {
            return error("invalid_session_id", "A valid sessionId is required");
        }
        final long expectedGeneration;
        final String expectedOwner;
        synchronized (STATE_LOCK) {
            if (!StringUtil.equals(requestedSessionId, sessionId)) {
                return errorWithStatus("session_mismatch",
                        "Screen recording sessionId does not match");
            }
            expectedGeneration = sessionGeneration;
            expectedOwner = recorderOwnerToken;
        }
        return stop(requestedSessionId, expectedGeneration, expectedOwner, automatic);
    }

    private static Map<String, Object> stop(String requestedSessionId,
                                             long expectedGeneration, String expectedOwner,
                                             boolean automatic) {
        SimpleRecordService.RecordBinder currentBinder;
        synchronized (STATE_LOCK) {
            if (!matchesSessionLocked(requestedSessionId, expectedGeneration)
                    || !StringUtil.equals(expectedOwner, recorderOwnerToken)) {
                return automatic ? snapshot() : errorWithStatus("session_mismatch",
                        "Screen recording sessionId does not match");
            }
            currentBinder = recordBinder;
        }
        long serviceStartedAt = currentBinder == null ? 0L
                : currentBinder.getLastRecorderStartTime(expectedOwner);
        boolean stopBeforeStart = false;
        synchronized (STATE_LOCK) {
            if (!matchesSessionLocked(requestedSessionId, expectedGeneration)
                    || !StringUtil.equals(expectedOwner, recorderOwnerToken)) {
                return automatic ? snapshot() : errorWithStatus("session_mismatch",
                        "Screen recording sessionId does not match");
            }
            if (STATE_STOPPED.equals(state) || STATE_FAILED.equals(state)) {
                return snapshot();
            }
            autoStopped = autoStopped || automatic;
            if (STATE_PENDING_USER_CONFIRMATION.equals(state)) {
                cancelledBeforeStart = true;
                markStoppedLocked(requestedSessionId, expectedGeneration);
                stopBeforeStart = true;
            } else {
                if (STATE_STARTING.equals(state)) {
                    if (serviceStartedAt > 0L) {
                        startedAt = serviceStartedAt;
                        cancelledBeforeStart = false;
                    } else {
                        cancelledBeforeStart = true;
                    }
                }
                state = STATE_STOPPING;
                userActionRequired = false;
                if (cancelledBeforeStart && recordBinder == null
                        && serviceConnection == null) {
                    markStoppedLocked(requestedSessionId, expectedGeneration);
                    stopBeforeStart = true;
                }
            }
        }

        if (stopBeforeStart) {
            // Android 没有提供安全关闭已显示 MediaProjection 系统对话框的接口。
            // 延迟返回的权限回调会通过 sessionId/state 被忽略。
            return snapshot();
        }
        issueStopAndAwait(requestedSessionId, expectedGeneration, expectedOwner);
        return snapshot();
    }

    private static void issueStopAndAwait(String expectedSessionId, long expectedGeneration,
                                          String expectedOwner) {
        SimpleRecordService.RecordBinder binder;
        boolean shouldIssue;
        synchronized (STATE_LOCK) {
            if (!matchesSessionLocked(expectedSessionId, expectedGeneration)
                    || !StringUtil.equals(expectedOwner, recorderOwnerToken)
                    || !STATE_STOPPING.equals(state)) {
                return;
            }
            binder = recordBinder;
            shouldIssue = !stopIssued;
            if (shouldIssue) {
                stopIssued = true;
            }
        }
        if (binder == null) {
            awaitStopped(expectedSessionId, expectedGeneration, expectedOwner,
                    STOP_POLL_ATTEMPTS);
            return;
        }
        if (shouldIssue) {
            if (!binder.stopRecord(expectedOwner)) {
                markFailed(expectedSessionId, expectedGeneration,
                        "Screen recording ownership was lost before stop");
                releaseBinding(expectedGeneration);
                return;
            }
        }
        awaitStopped(expectedSessionId, expectedGeneration, expectedOwner,
                STOP_POLL_ATTEMPTS);
    }

    private static void awaitStopped(final String expectedSessionId,
                                     final long expectedGeneration, final String expectedOwner,
                                     final int attemptsLeft) {
        MAIN_HANDLER.postDelayed(new Runnable() {
            @Override
            public void run() {
                SimpleRecordService.RecordBinder binder;
                synchronized (STATE_LOCK) {
                    if (!matchesSessionLocked(expectedSessionId, expectedGeneration)
                            || !StringUtil.equals(expectedOwner, recorderOwnerToken)
                            || !STATE_STOPPING.equals(state)) {
                        return;
                    }
                    binder = recordBinder;
                }
                if (binder == null) {
                    if (attemptsLeft <= 0) {
                        markFailed(expectedSessionId, expectedGeneration,
                                "Timed out waiting for screen recording service");
                        releaseBinding(expectedGeneration);
                    } else {
                        awaitStopped(expectedSessionId, expectedGeneration, expectedOwner,
                                attemptsLeft - 1);
                    }
                    return;
                }
                if (!binder.isStopCompleted(expectedOwner)) {
                    if (attemptsLeft <= 0) {
                        markFailed(expectedSessionId, expectedGeneration,
                                "Timed out waiting for screen recording to stop");
                        releaseBinding(expectedGeneration);
                    } else {
                        awaitStopped(expectedSessionId, expectedGeneration, expectedOwner,
                                attemptsLeft - 1);
                    }
                    return;
                }
                long serviceStart = binder.getLastRecorderStartTime(expectedOwner);
                boolean cancelled;
                synchronized (STATE_LOCK) {
                    if (!matchesSessionLocked(expectedSessionId, expectedGeneration)
                            || !StringUtil.equals(expectedOwner, recorderOwnerToken)) {
                        return;
                    }
                    if (serviceStart > 0L) {
                        startedAt = serviceStart;
                        cancelledBeforeStart = false;
                    }
                    cancelled = cancelledBeforeStart;
                    if (cancelled) {
                        markStoppedLocked(expectedSessionId, expectedGeneration);
                    }
                }
                if (cancelled) {
                    releaseBinding(expectedGeneration);
                    return;
                }
                String serviceError = binder.getLastRecordingError(expectedOwner);
                if (!StringUtil.isEmpty(serviceError)) {
                    markFailed(expectedSessionId, expectedGeneration, serviceError);
                    releaseBinding(expectedGeneration);
                    return;
                }
                File output = StringUtil.isEmpty(outputPath) ? null : new File(outputPath);
                if (output == null || !isInsideCapturesRoot(canonicalPath(output))
                        || !output.isFile() || output.length() <= 0L) {
                    markFailed(expectedSessionId, expectedGeneration,
                            "Screen recording output was not written successfully");
                    releaseBinding(expectedGeneration);
                    return;
                }
                synchronized (STATE_LOCK) {
                    markStoppedLocked(expectedSessionId, expectedGeneration);
                }
                releaseBinding(expectedGeneration);
            }
        }, POLL_INTERVAL_MS);
    }

    private static void markFailed(String expectedSessionId, long expectedGeneration,
                                   String reason) {
        synchronized (STATE_LOCK) {
            markFailedLocked(expectedSessionId, expectedGeneration, reason);
        }
    }

    private static void markFailedLocked(String expectedSessionId, long expectedGeneration,
                                         String reason) {
        if (!matchesSessionLocked(expectedSessionId, expectedGeneration)
                || !isActive(state)) {
            return;
        }
        if (STATE_STOPPING.equals(state) && cancelledBeforeStart) {
            markStoppedLocked(expectedSessionId, expectedGeneration);
            return;
        }
        state = STATE_FAILED;
        error = reason;
        userActionRequired = false;
        finishedAt = System.currentTimeMillis();
    }

    private static void markStoppedLocked(String expectedSessionId, long expectedGeneration) {
        if (!matchesSessionLocked(expectedSessionId, expectedGeneration)
                || !isActive(state)) {
            return;
        }
        state = STATE_STOPPED;
        error = null;
        userActionRequired = false;
        finishedAt = System.currentTimeMillis();
    }

    private static void releaseBinding(long expectedGeneration) {
        Context context;
        ServiceConnection connection;
        synchronized (STATE_LOCK) {
            if (boundGeneration != expectedGeneration) {
                return;
            }
            context = boundContext;
            connection = serviceConnection;
            boundContext = null;
            serviceConnection = null;
            recordBinder = null;
            boundGeneration = 0L;
        }
        if (context != null && connection != null) {
            try {
                context.unbindService(connection);
            } catch (IllegalArgumentException ignored) {
                LogUtil.w(TAG, "Screen recording service was already unbound");
            }
        }
    }

    public static Map<String, Object> snapshot() {
        synchronized (STATE_LOCK) {
            Map<String, Object> result = success();
            result.put("kind", "screen-recording");
            result.put("sessionId", sessionId);
            result.put("state", state);
            result.put("recording", STATE_RECORDING.equals(state));
            result.put("active", isActive(state));
            result.put("terminal", STATE_STOPPED.equals(state) || STATE_FAILED.equals(state));
            result.put("userActionRequired", userActionRequired);
            result.put("requiredUserAction", userActionRequired
                    ? "Confirm the Android MediaProjection system dialog" : null);
            result.put("resolution", resolution);
            result.put("width", width == 0 ? null : width);
            result.put("height", height == 0 ? null : height);
            result.put("bitrateKbps", bitrateKbps == 0 ? null : bitrateKbps);
            result.put("frameRate", frameRate == 0 ? null : frameRate);
            result.put("durationSec", durationSec == 0 ? null : durationSec);
            result.put("requestedAt", requestedAt == 0L ? null : requestedAt);
            result.put("startedAt", startedAt == 0L ? null : startedAt);
            result.put("finishedAt", finishedAt == 0L ? null : finishedAt);
            result.put("durationMs", startedAt == 0L ? null
                    : (finishedAt == 0L ? System.currentTimeMillis() : finishedAt) - startedAt);
            result.put("capturesRoot", capturesRoot);
            result.put("outputPath", outputPath);
            File output = StringUtil.isEmpty(outputPath) ? null : new File(outputPath);
            result.put("fileSize", output != null && output.isFile() ? output.length() : null);
            result.put("autoStopped", autoStopped);
            result.put("cancelledBeforeStart", cancelledBeforeStart);
            result.put("error", error);
            return result;
        }
    }

    private static boolean isActive(String targetState) {
        return STATE_PENDING_USER_CONFIRMATION.equals(targetState)
                || STATE_STARTING.equals(targetState)
                || STATE_RECORDING.equals(targetState)
                || STATE_STOPPING.equals(targetState);
    }

    private static boolean matchesSessionLocked(String expectedSessionId,
                                                 long expectedGeneration) {
        return expectedGeneration == sessionGeneration
                && StringUtil.equals(expectedSessionId, sessionId);
    }

    private static String canonicalPath(File file) {
        if (file == null) {
            return null;
        }
        try {
            return file.getCanonicalPath();
        } catch (IOException exception) {
            LogUtil.e(TAG, "Unable to resolve canonical capture path", exception);
            return null;
        }
    }

    private static boolean isInsideCapturesRoot(String candidatePath) {
        final String root;
        synchronized (STATE_LOCK) {
            root = capturesRoot;
        }
        return !StringUtil.isEmpty(root) && !StringUtil.isEmpty(candidatePath)
                && candidatePath.startsWith(root + File.separator);
    }

    private static boolean isValidSessionId(String value) {
        return value != null && SESSION_ID_PATTERN.matcher(value).matches();
    }

    private static Map<String, Object> success() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        return result;
    }

    private static Map<String, Object> error(String code, String message) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", false);
        result.put("errorCode", code);
        result.put("error", message);
        return result;
    }

    private static Map<String, Object> errorWithStatus(String code, String message) {
        Map<String, Object> result = error(code, message);
        result.put("screenRecording", snapshot());
        return result;
    }

    private static int parseInteger(Map<String, String> params, String key, int defaultValue,
                                    int minimum, int maximum) {
        String raw = params.get(key);
        if (StringUtil.isEmpty(raw)) {
            return defaultValue;
        }
        final int value;
        try {
            value = Integer.parseInt(raw);
        } catch (NumberFormatException exception) {
            throw new IllegalArgumentException(key + " must be an integer");
        }
        if (value < minimum || value > maximum) {
            throw new IllegalArgumentException(key + " is outside the supported range");
        }
        return value;
    }

    private static class RecordingConfig {
        final String resolution;
        final int width;
        final int height;
        final int bitrateKbps;
        final int frameRate;
        final int durationSec;

        RecordingConfig(String resolution, int width, int height, int bitrateKbps,
                        int frameRate, int durationSec) {
            this.resolution = resolution;
            this.width = width;
            this.height = height;
            this.bitrateKbps = bitrateKbps;
            this.frameRate = frameRate;
            this.durationSec = durationSec;
        }

        static RecordingConfig parse(Map<String, String> params) {
            String resolution = params.get("resolution");
            if (StringUtil.isEmpty(resolution)) {
                resolution = DEFAULT_RESOLUTION;
            }
            Matcher matcher = RESOLUTION_PATTERN.matcher(resolution);
            if (!matcher.matches()) {
                throw new IllegalArgumentException("resolution must use WIDTHxHEIGHT format");
            }
            int width = Integer.parseInt(matcher.group(1));
            int height = Integer.parseInt(matcher.group(2));
            if (width < MIN_DIMENSION || width > MAX_DIMENSION
                    || height < MIN_DIMENSION || height > MAX_DIMENSION
                    || (width & 1) != 0 || (height & 1) != 0) {
                throw new IllegalArgumentException(
                        "resolution dimensions must be even numbers between 128 and 4096");
            }
            int bitrate = parseInteger(params, "bitrateKbps", DEFAULT_BITRATE_KBPS,
                    MIN_BITRATE_KBPS, MAX_BITRATE_KBPS);
            int frameRate = parseInteger(params, "frameRate", DEFAULT_FRAME_RATE,
                    MIN_FRAME_RATE, MAX_FRAME_RATE);
            int duration = parseInteger(params, "durationSec", DEFAULT_DURATION_SECONDS,
                    MIN_DURATION_SECONDS, MAX_DURATION_SECONDS);
            return new RecordingConfig(resolution, width, height, bitrate, frameRate, duration);
        }
    }
}
