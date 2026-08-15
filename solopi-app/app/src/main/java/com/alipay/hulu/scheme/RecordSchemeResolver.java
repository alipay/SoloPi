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
import android.app.ProgressDialog;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.provider.Settings;

import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.scheme.SchemeActionResolver;
import com.alipay.hulu.common.scheme.AdbSchemeActivity;
import com.alipay.hulu.common.scheme.SchemeResolver;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.service.CaseRecordManager;
import com.alipay.hulu.shared.io.OperationStepService;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.io.db.OperationLogHandler;
import com.alipay.hulu.shared.node.utils.AppUtil;
import com.alipay.hulu.shared.node.utils.PrepareUtil;
import com.alipay.hulu.util.DialogUtils;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 交互式用例录制协议。查询可走 HTTP；启动和停止只允许 ADB Scheme。
 */
@SchemeResolver("record")
public class RecordSchemeResolver implements SchemeActionResolver {
    public static final String RECORD_MODE = "recordMode";
    public static final String CASE_NAME = "caseName";
    public static final String CASE_DESC = "caseDesc";
    public static final String TARGET_APP = "targetApp";
    public static final String SESSION_ID = "sessionId";

    public static final String MODE_NORMAL = "normal";
    public static final String MODE_STOP = "stop";
    public static final String MODE_STATUS = "status";

    private static final String STATE_IDLE = "idle";
    private static final String STATE_STARTING = "starting";
    private static final String STATE_RECORDING = "recording";
    private static final String STATE_STOPPING = "stopping";
    private static final String STATE_STOPPED = "stopped";
    private static final String STATE_FAILED = "failed";
    private static final long MANAGER_READY_TIMEOUT_MS = 5000L;
    private static final long PERSIST_TIMEOUT_MS = 10000L;

    private static final Object STATE_LOCK = new Object();
    private static String sessionId;
    private static String state = STATE_IDLE;
    private static String caseName;
    private static Long caseId;
    private static RecordCaseInfo activeCaseInfo;
    private static boolean cancelledBeforeStart;
    private static String targetPackage;
    private static String error;
    private static long startedAt;
    private static long finishedAt;
    private static long sessionGeneration;
    private static Object activeOwnerToken;
    private static CaseRecordManager activeRecordManager;

    @Override
    public boolean processScheme(Context context, Map<String, String> params,
                                 Callback<Map<String, Object>> callback) {
        String mode = params.get(RECORD_MODE);
        if (MODE_STATUS.equals(mode)) {
            callback.onResult(snapshot());
            return true;
        }
        if (!MODE_NORMAL.equals(mode) && !MODE_STOP.equals(mode)) {
            callback.onResult(error("unsupported_mode", "Unsupported record mode: " + mode));
            return true;
        }
        if (!(context instanceof AdbSchemeActivity)) {
            callback.onResult(error("mutation_transport_required",
                    "Recording changes require the ADB scheme transport"));
            return true;
        }
        if (MODE_NORMAL.equals(mode)) {
            callback.onResult(startNormalMode((Activity) context, params));
        } else {
            callback.onResult(stopRecording(params.get(SESSION_ID)));
        }
        return true;
    }

    private Map<String, Object> startNormalMode(final Activity context,
                                                 Map<String, String> params) {
        final String requestedSessionId = params.get(SESSION_ID);
        if (StringUtil.isEmpty(requestedSessionId)) {
            return error("missing_session_id", "Parameter 'sessionId' is required");
        }
        final String requestedCaseName = params.get(CASE_NAME);
        if (StringUtil.isEmpty(requestedCaseName)
                || StringUtil.isEmpty(requestedCaseName.trim())) {
            return error("missing_case_name", "Parameter 'caseName' is required");
        }
        final RecordCaseInfo caseInfo = loadBaseInfo(context, params);
        if (caseInfo == null) {
            return error("target_app_not_found", "Target application was not found");
        }
        caseInfo.setRecordMode("local");

        final CaseRecordManager manager;
        try {
            manager = LauncherApplication.service(CaseRecordManager.class);
        } catch (RuntimeException e) {
            LogUtil.e("RecordSchemeResolver", "Unable to create recording manager", e);
            return error("recording_manager_unavailable",
                    "Recording manager is unavailable");
        }
        final long expectedGeneration;
        final Object ownerToken;
        synchronized (STATE_LOCK) {
            if (isActive(state)) {
                return errorWithStatus("recording_conflict", "A recording session is already active");
            }
            expectedGeneration = sessionGeneration + 1L;
            ownerToken = new ProtocolRecordOwner(requestedSessionId, expectedGeneration);
            if (!manager.reserveRecordCase(ownerToken, caseInfo)) {
                return errorWithStatus("recording_conflict",
                        "A recording session, UI reservation, or plugin maintenance is active");
            }
            sessionGeneration = expectedGeneration;
            sessionId = requestedSessionId;
            state = STATE_STARTING;
            caseName = caseInfo.getCaseName();
            caseId = null;
            activeCaseInfo = caseInfo;
            cancelledBeforeStart = false;
            targetPackage = caseInfo.getTargetAppPackage();
            error = null;
            startedAt = 0L;
            finishedAt = 0L;
            activeOwnerToken = ownerToken;
            activeRecordManager = manager;
        }

        try {
            PermissionUtil.requestPermissions(
                Arrays.asList("adb", "float", "background",
                        Settings.ACTION_ACCESSIBILITY_SETTINGS, "powerSave"),
                context,
                new PermissionUtil.OnPermissionCallback() {
                    @Override
                    public void onPermissionResult(boolean result, String reason) {
                        if (!isStartingSession(requestedSessionId, expectedGeneration,
                                ownerToken, caseInfo)) {
                            return;
                        }
                        if (!result) {
                            markFailed(requestedSessionId, expectedGeneration, ownerToken,
                                    caseInfo, manager,
                                    "Permission denied: " + reason);
                            return;
                        }
                        ProgressDialog createdDialog = null;
                        try {
                            createdDialog = DialogUtils.showProgressDialog(
                                    LauncherApplication.getContext(), "正在加载中");
                            final ProgressDialog dialog = createdDialog;
                            MyApplication.getInstance().updateAppAndName(
                                    caseInfo.getTargetAppPackage(), caseInfo.getTargetAppLabel());

                            BackgroundExecutor.execute(new Runnable() {
                            @Override
                            public void run() {
                                try {
                                    if (!isStartingSession(requestedSessionId,
                                            expectedGeneration, ownerToken, caseInfo)) {
                                        return;
                                    }
                                    boolean prepared = PrepareUtil.doPrepareWork(
                                            caseInfo.getTargetAppPackage(),
                                            new PrepareUtil.PrepareStatus() {
                                                @Override
                                                public void currentStatus(int progress, int total,
                                                                          String message, boolean status) {
                                                    updateProgressDialog(dialog, progress, total, message);
                                                }
                                            });
                                    if (!prepared) {
                                        markFailed(requestedSessionId, expectedGeneration,
                                                ownerToken, caseInfo, manager,
                                                "Recording environment preparation failed");
                                        return;
                                    }
                                    if (!isStartingSession(requestedSessionId,
                                            expectedGeneration, ownerToken, caseInfo)) {
                                        return;
                                    }

                                    LauncherApplication.service(OperationStepService.class)
                                            .registerStepProcessor(new OperationLogHandler());
                                    manager.setRecordCase(ownerToken, caseInfo);

                                    if (!isStartingSession(requestedSessionId,
                                            expectedGeneration, ownerToken, caseInfo)) {
                                        manager.discardPreparedRecordCase(ownerToken, caseInfo);
                                        return;
                                    }

                                    restartTargetApp(context, caseInfo.getTargetAppPackage());
                                    if (!isStartingSession(requestedSessionId,
                                            expectedGeneration, ownerToken, caseInfo)) {
                                        manager.discardPreparedRecordCase(ownerToken, caseInfo);
                                        return;
                                    }
                                    if (!manager.awaitReadyForRecording(MANAGER_READY_TIMEOUT_MS)) {
                                        throw new IllegalStateException(
                                                "Recording services were not ready before timeout");
                                    }
                                    if (!isStartingSession(requestedSessionId,
                                            expectedGeneration, ownerToken, caseInfo)) {
                                        manager.discardPreparedRecordCase(ownerToken, caseInfo);
                                        return;
                                    }
                                    LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                                        @Override
                                        public void run() {
                                            try {
                                                if (!startRecording(requestedSessionId,
                                                        expectedGeneration, ownerToken,
                                                        caseInfo, manager)) {
                                                    manager.discardPreparedRecordCase(
                                                            ownerToken, caseInfo);
                                                    return;
                                                }
                                            } catch (RuntimeException e) {
                                                LogUtil.e("RecordSchemeResolver",
                                                        "Unable to start recording", e);
                                                markFailed(requestedSessionId,
                                                        expectedGeneration, ownerToken,
                                                        caseInfo, manager,
                                                        "Unable to start recording: " + e.getMessage());
                                            }
                                        }
                                    });
                                } catch (RuntimeException e) {
                                    LogUtil.e("RecordSchemeResolver", "Unable to prepare recording", e);
                                    markFailed(requestedSessionId, expectedGeneration,
                                            ownerToken, caseInfo, manager,
                                            "Unable to prepare recording: " + e.getMessage());
                                } finally {
                                    dismissProgressDialog(dialog);
                                }
                            }
                            });
                        } catch (RuntimeException e) {
                            dismissProgressDialog(createdDialog);
                            LogUtil.e("RecordSchemeResolver",
                                    "Unable to schedule recording preparation", e);
                            markFailed(requestedSessionId, expectedGeneration, ownerToken,
                                    caseInfo, manager,
                                    "Unable to schedule recording preparation: "
                                            + e.getMessage());
                        }
                    }
                });
        } catch (RuntimeException e) {
            LogUtil.e("RecordSchemeResolver", "Unable to request recording permissions", e);
            markFailed(requestedSessionId, expectedGeneration, ownerToken, caseInfo, manager,
                    "Unable to request recording permissions: " + e.getMessage());
        }
        return snapshot();
    }

    private Map<String, Object> stopRecording(String requestedSessionId) {
        if (StringUtil.isEmpty(requestedSessionId)) {
            return error("missing_session_id", "Parameter 'sessionId' is required");
        }
        final RecordCaseInfo stoppingCase;
        final long expectedGeneration;
        final Object ownerToken;
        final CaseRecordManager manager;
        boolean cancellingStart = false;
        synchronized (STATE_LOCK) {
            if (!StringUtil.equals(requestedSessionId, sessionId)) {
                return errorWithStatus("session_mismatch", "Recording sessionId does not match");
            }
            stoppingCase = activeCaseInfo;
            expectedGeneration = sessionGeneration;
            ownerToken = activeOwnerToken;
            manager = activeRecordManager;
            if (stoppingCase == null || ownerToken == null || manager == null) {
                return errorWithStatus("recording_not_active",
                        "The recording session has no active owner");
            }
            if (STATE_STARTING.equals(state)) {
                state = STATE_STOPPED;
                cancelledBeforeStart = true;
                finishedAt = System.currentTimeMillis();
                error = null;
                cancellingStart = true;
            } else if (STATE_RECORDING.equals(state)) {
                state = STATE_STOPPING;
            } else {
                return errorWithStatus("recording_not_active", "The recording session is not recording");
            }
        }

        if (cancellingStart) {
            try {
                manager.discardPreparedRecordCase(ownerToken, stoppingCase);
            } catch (RuntimeException e) {
                LogUtil.w("RecordSchemeResolver",
                        "Unable to reset cancelled recording context", e);
            } finally {
                synchronized (STATE_LOCK) {
                    if (matchesSessionLocked(requestedSessionId, expectedGeneration,
                            ownerToken, stoppingCase, manager)
                            && STATE_STOPPED.equals(state)) {
                        activeOwnerToken = null;
                        activeRecordManager = null;
                    }
                }
            }
            return snapshot();
        }

        if (!manager.isRecording(ownerToken, stoppingCase)) {
            markFailed(requestedSessionId, expectedGeneration, ownerToken,
                    stoppingCase, manager,
                    "Recording manager is not running");
            return snapshot();
        }
        final String stoppingSessionId = requestedSessionId;
        try {
            BackgroundExecutor.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        long persistedCaseId = manager.stopRecordProgrammatically(
                                ownerToken, stoppingCase, PERSIST_TIMEOUT_MS);
                        markStopped(stoppingSessionId, expectedGeneration, ownerToken,
                                stoppingCase, manager, persistedCaseId);
                    } catch (RuntimeException e) {
                        LogUtil.e("RecordSchemeResolver", "Unable to stop recording", e);
                        markFailed(stoppingSessionId, expectedGeneration, ownerToken,
                                stoppingCase, manager,
                                "Unable to stop recording: " + e.getMessage());
                    }
                }
            });
        } catch (RuntimeException e) {
            LogUtil.e("RecordSchemeResolver", "Unable to schedule recording stop", e);
            markFailed(stoppingSessionId, expectedGeneration, ownerToken,
                    stoppingCase, manager,
                    "Unable to schedule recording stop: " + e.getMessage());
        }
        return snapshot();
    }

    private static RecordCaseInfo loadBaseInfo(Context context, Map<String, String> params) {
        String app = params.get(TARGET_APP);
        if (StringUtil.isEmpty(app)) {
            return null;
        }
        String appLabel = null;
        List<ApplicationInfo> appList = MyApplication.getInstance().loadAppList();
        for (ApplicationInfo appInfo : appList) {
            if (StringUtil.equals(appInfo.packageName, app)) {
                appLabel = appInfo.loadLabel(context.getPackageManager()).toString();
                break;
            }
        }
        if (StringUtil.isEmpty(appLabel)) {
            return null;
        }

        RecordCaseInfo caseInfo = new RecordCaseInfo();
        caseInfo.setCaseName(params.get(CASE_NAME).trim());
        caseInfo.setCaseDesc(params.get(CASE_DESC));
        caseInfo.setTargetAppPackage(app);
        caseInfo.setTargetAppLabel(appLabel);
        return caseInfo;
    }

    private static boolean startRecording(String expectedSessionId,
                                          long expectedGeneration,
                                          Object ownerToken,
                                          RecordCaseInfo expectedCase,
                                          CaseRecordManager manager) {
        synchronized (STATE_LOCK) {
            if (!matchesSessionLocked(expectedSessionId, expectedGeneration, ownerToken,
                    expectedCase, manager)
                    || !STATE_STARTING.equals(state)) {
                return false;
            }
            if (!manager.isRecording(ownerToken, expectedCase)) {
                manager.startRecord(ownerToken, expectedCase);
            }
            state = STATE_RECORDING;
            startedAt = System.currentTimeMillis();
            error = null;
            return true;
        }
    }

    private static void markStopped(String expectedSessionId, long expectedGeneration,
                                    Object ownerToken, RecordCaseInfo expectedCase,
                                    CaseRecordManager manager, long persistedCaseId) {
        synchronized (STATE_LOCK) {
            if (!matchesSessionLocked(expectedSessionId, expectedGeneration, ownerToken,
                    expectedCase, manager)
                    || !STATE_STOPPING.equals(state)) {
                return;
            }
            state = STATE_STOPPED;
            caseId = persistedCaseId;
            finishedAt = System.currentTimeMillis();
            error = null;
            activeOwnerToken = null;
            activeRecordManager = null;
        }
    }

    private static void markFailed(String expectedSessionId, long expectedGeneration,
                                   Object ownerToken, RecordCaseInfo expectedCase,
                                   CaseRecordManager manager, String reason) {
        boolean shouldCleanup = false;
        synchronized (STATE_LOCK) {
            if (!matchesSessionLocked(expectedSessionId, expectedGeneration, ownerToken,
                    expectedCase, manager)
                    || !isActive(state)) {
                return;
            }
            state = STATE_FAILED;
            error = reason;
            finishedAt = System.currentTimeMillis();
            shouldCleanup = true;
        }
        if (!shouldCleanup) {
            return;
        }

        cleanupFailedStart(manager, ownerToken, expectedCase);
        synchronized (STATE_LOCK) {
            if (matchesSessionLocked(expectedSessionId, expectedGeneration, ownerToken,
                    expectedCase, manager) && STATE_FAILED.equals(state)) {
                activeOwnerToken = null;
                activeRecordManager = null;
            }
        }
    }

    public static Map<String, Object> snapshot() {
        synchronized (STATE_LOCK) {
            Map<String, Object> result = success();
            result.put("kind", "recording");
            result.put("sessionId", sessionId);
            result.put("state", state);
            result.put("recording", STATE_RECORDING.equals(state));
            result.put("active", isActive(state));
            result.put("terminal", STATE_STOPPED.equals(state) || STATE_FAILED.equals(state));
            result.put("caseName", caseName);
            result.put("caseId", caseId);
            result.put("cancelledBeforeStart", cancelledBeforeStart);
            result.put("targetPackage", targetPackage);
            result.put("startedAt", startedAt == 0L ? null : startedAt);
            result.put("finishedAt", finishedAt == 0L ? null : finishedAt);
            result.put("durationMs", startedAt == 0L ? null
                    : (finishedAt == 0L ? System.currentTimeMillis() : finishedAt) - startedAt);
            result.put("error", error);
            return result;
        }
    }

    private static boolean isActive(String targetState) {
        return STATE_STARTING.equals(targetState)
                || STATE_RECORDING.equals(targetState)
                || STATE_STOPPING.equals(targetState);
    }

    private static boolean isStartingSession(String expectedSessionId,
                                             long expectedGeneration,
                                             Object ownerToken,
                                             RecordCaseInfo expectedCase) {
        synchronized (STATE_LOCK) {
            return STATE_STARTING.equals(state)
                    && expectedGeneration == sessionGeneration
                    && activeOwnerToken == ownerToken
                    && StringUtil.equals(expectedSessionId, sessionId)
                    && activeCaseInfo == expectedCase;
        }
    }

    private static boolean matchesSessionLocked(String expectedSessionId,
                                                long expectedGeneration,
                                                Object ownerToken,
                                                RecordCaseInfo expectedCase,
                                                CaseRecordManager manager) {
        return expectedGeneration == sessionGeneration
                && activeOwnerToken == ownerToken
                && activeRecordManager == manager
                && StringUtil.equals(expectedSessionId, sessionId)
                && activeCaseInfo == expectedCase;
    }

    private static void restartTargetApp(Context context, String packageName) {
        if (!StringUtil.equals(context.getPackageName(), packageName)) {
            AppUtil.forceStopApp(packageName);
            MiscUtil.sleep(500L);
        }
        if (!AppUtil.startApp(packageName)) {
            throw new IllegalStateException("Target application has no launchable activity");
        }
    }

    private static void cleanupFailedStart(CaseRecordManager manager, Object ownerToken,
                                           RecordCaseInfo expectedCase) {
        if (manager == null) {
            return;
        }
        try {
            manager.abortRecordProgrammatically(ownerToken, expectedCase);
        } catch (RuntimeException cleanupError) {
            LogUtil.w("RecordSchemeResolver", "Unable to clean up failed recording start",
                    cleanupError);
        }
        try {
            manager.discardPreparedRecordCase(ownerToken, expectedCase);
        } catch (RuntimeException cleanupError) {
            LogUtil.w("RecordSchemeResolver", "Unable to discard failed recording start",
                    cleanupError);
        }
    }

    /** 进程内协议 owner；generation 使复用 sessionId 的迟到回调也无法命中新会话。 */
    private static final class ProtocolRecordOwner {
        private final String value;

        private ProtocolRecordOwner(String sessionId, long generation) {
            value = "record-scheme:" + sessionId + ":" + generation;
        }

        @Override
        public String toString() {
            return value;
        }
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
        result.put("recording", snapshot());
        return result;
    }

    private static void dismissProgressDialog(final ProgressDialog progressDialog) {
        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (progressDialog != null && progressDialog.isShowing()) {
                    progressDialog.dismiss();
                }
            }
        });
    }

    private static void updateProgressDialog(final ProgressDialog progressDialog,
                                             final int progress, final int totalProgress,
                                             final String message) {
        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (progressDialog == null || !progressDialog.isShowing()) {
                    return;
                }
                progressDialog.setProgress(progress);
                progressDialog.setMax(totalProgress);
                progressDialog.setMessage(message);
            }
        });
    }
}
