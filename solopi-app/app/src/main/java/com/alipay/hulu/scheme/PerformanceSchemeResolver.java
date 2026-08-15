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
package com.alipay.hulu.scheme;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.ApplicationInfo;

import com.alipay.hulu.R;
import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.scheme.SchemeActionResolver;
import com.alipay.hulu.common.scheme.AdbSchemeActivity;
import com.alipay.hulu.common.scheme.SchemeResolver;
import com.alipay.hulu.common.tools.AppInfoProvider;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.screenRecord.Notifications;
import com.alipay.hulu.shared.display.DisplayItemInfo;
import com.alipay.hulu.shared.display.DisplayProvider;
import com.alipay.hulu.shared.display.items.base.RecordPattern;
import com.alipay.hulu.util.RecordUtil;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Performance recording control for local ADB automation.
 *
 * HTTP callers may only use listItems and status. Starting and stopping a recording requires
 * the Activity context supplied by the ADB Scheme transport.
 */
@SchemeResolver("performance")
public class PerformanceSchemeResolver implements SchemeActionResolver {
    private static final String TAG = PerformanceSchemeResolver.class.getSimpleName();

    private static final String PERFORMANCE_MODE = "mode";
    private static final String MODE_NORMAL = "normal";
    private static final String MODE_LIST_ITEMS = "listItems";
    private static final String MODE_STATUS = "status";
    private static final String MODE_CURRENT = "current";
    private static final String TARGET_APP = "targetApp";
    private static final String NORMAL_ITEMS = "items";
    private static final String REPORT_URL = "url";
    private static final String ACTION = "action";
    private static final String ACTION_START = "start";
    private static final String ACTION_STOP = "stop";
    private static final String SESSION_ID = "sessionId";
    private static final String GLOBAL_TARGET = "-";

    private static final String STATE_IDLE = "idle";
    private static final String STATE_STARTING = "starting";
    private static final String STATE_RECORDING = "recording";
    private static final String STATE_STOPPING = "stopping";
    private static final String STATE_STOPPED = "stopped";
    private static final String STATE_FAILED = "failed";

    private static final int PERFORMANCE_RECORD_ID = 12201;

    private final Object stateLock = new Object();
    private Notification notification;
    private String state = STATE_IDLE;
    private String sessionId;
    private String targetPackage;
    private List<String> requestedItems = Collections.emptyList();
    private List<String> ownedDisplayNames = Collections.emptyList();
    private DisplayProvider.RecordingLease recordingLease;
    private DisplayProvider recordingProvider;
    private boolean cleanupOnly;
    private String cleanupTerminalError;
    private boolean stopInProgress;
    private String outputPath;
    private String uploadUrl;
    private String uploadResponse;
    private String error;
    private long startedAt;
    private long finishedAt;

    @Override
    public boolean processScheme(Context context, Map<String, String> params,
                                 Callback<Map<String, Object>> callback) {
        String mode = params.get(PERFORMANCE_MODE);
        if (StringUtil.isEmpty(mode)) {
            callback.onResult(error("Parameter 'mode' is required"));
            return true;
        }

        switch (mode) {
            case MODE_LIST_ITEMS:
                callback.onResult(listDisplayItems());
                return true;
            case MODE_STATUS:
                callback.onResult(snapshotWithRunningItems());
                return true;
            case MODE_CURRENT:
                callback.onResult(currentValues());
                return true;
            case MODE_NORMAL:
                if (!(context instanceof AdbSchemeActivity)) {
                    callback.onResult(error(
                            "Performance start and stop require the ADB Scheme transport"));
                    return true;
                }
                return processNormalRecord((Activity) context, params, callback);
            default:
                callback.onResult(error("Unsupported performance mode: " + mode));
                return true;
        }
    }

    private Map<String, Object> listDisplayItems() {
        DisplayProvider displayProvider = currentDisplayProvider();
        if (displayProvider == null || displayProvider.getAllDisplayItems() == null) {
            return error("Performance display service is not ready");
        }

        List<Map<String, Object>> items = new ArrayList<>();
        for (DisplayItemInfo info : displayProvider.getAllDisplayItems()) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("key", info.getKey());
            item.put("name", info.getName());
            item.put("permissions", info.getPermissions());
            item.put("tip", info.getTip());
            item.put("trigger", info.getTrigger());
            items.add(item);
        }

        Map<String, Object> result = success();
        result.put("items", items);
        result.put("total", items.size());
        return result;
    }

    private boolean processNormalRecord(final Activity context, Map<String, String> params,
                                        final Callback<Map<String, Object>> callback) {
        String action = params.get(ACTION);
        if (StringUtil.equals(action, ACTION_START)) {
            return startRecording(context, params, callback);
        }
        if (StringUtil.equals(action, ACTION_STOP)) {
            return stopRecording(context, params, callback);
        }
        callback.onResult(error("Unsupported performance action: " + action));
        return true;
    }

    private boolean startRecording(final Activity context, Map<String, String> params,
                                   final Callback<Map<String, Object>> callback) {
        final String requestedSessionId = StringUtil.isEmpty(params.get(SESSION_ID))
                ? UUID.randomUUID().toString() : params.get(SESSION_ID);
        final List<String> items = normalizeItems(params.get(NORMAL_ITEMS));
        final String requestedTargetPackage = params.get(TARGET_APP);

        if (!RecordUtil.isValidPerformanceSessionId(requestedSessionId)) {
            callback.onResult(error("Invalid performance sessionId"));
            return true;
        }

        if (!beginStarting(requestedSessionId, requestedTargetPackage, items)) {
            callback.onResult(errorWithStatus("A performance recording is already active"));
            return true;
        }

        if (items.isEmpty()) {
            markFailed(requestedSessionId, requestedTargetPackage, items,
                    "Parameter 'items' is required");
            callback.onResult(snapshotWithRunningItems());
            return true;
        }

        final DisplayProvider displayProvider = currentDisplayProvider();
        if (displayProvider == null || displayProvider.getAllDisplayItems() == null) {
            markFailed(requestedSessionId, requestedTargetPackage, items,
                    "Performance display service is not ready");
            callback.onResult(snapshotWithRunningItems());
            return true;
        }

        final Map<String, DisplayItemInfo> availableItems = new LinkedHashMap<>();
        for (DisplayItemInfo info : displayProvider.getAllDisplayItems()) {
            availableItems.put(info.getKey(), info);
        }
        List<String> unsupportedItems = new ArrayList<>();
        for (String item : items) {
            if (!availableItems.containsKey(item)) {
                unsupportedItems.add(item);
            }
        }
        if (!unsupportedItems.isEmpty()) {
            markFailed(requestedSessionId, requestedTargetPackage, items,
                    "Unsupported performance item(s): " + StringUtil.join(",", unsupportedItems));
            callback.onResult(snapshotWithRunningItems());
            return true;
        }

        Set<String> alreadyRunning = displayProvider.getRunningDisplayItems();
        if (alreadyRunning != null && !alreadyRunning.isEmpty()) {
            markFailed(requestedSessionId, requestedTargetPackage, items,
                    "Another performance display session is already running");
            callback.onResult(snapshotWithRunningItems());
            return true;
        }

        if (StringUtil.equals(GLOBAL_TARGET, requestedTargetPackage)) {
            MyApplication.getInstance().updateAppAndNameTemp(
                    GLOBAL_TARGET, context.getString(R.string.constant_global));
        } else if (!StringUtil.isEmpty(requestedTargetPackage)) {
            String appLabel = null;
            List<ApplicationInfo> appList = MyApplication.getInstance().loadAppList();
            for (ApplicationInfo appInfo : appList) {
                if (StringUtil.equals(appInfo.packageName, requestedTargetPackage)) {
                    appLabel = appInfo.loadLabel(context.getPackageManager()).toString();
                    break;
                }
            }
            if (StringUtil.isEmpty(appLabel)) {
                markFailed(requestedSessionId, requestedTargetPackage, items,
                        "Target application is not installed: " + requestedTargetPackage);
                callback.onResult(snapshotWithRunningItems());
                return true;
            }
            MyApplication.getInstance().updateAppAndNameTemp(requestedTargetPackage, appLabel);
        }

        Set<String> allPermissions = new HashSet<>();
        for (String item : items) {
            allPermissions.addAll(availableItems.get(item).getPermissions());
        }
        allPermissions.add("adb");
        allPermissions.add("powerSave");

        try {
            PermissionUtil.requestPermissions(new ArrayList<>(allPermissions), context,
                    new PermissionUtil.OnPermissionCallback() {
                        @Override
                        public void onPermissionResult(boolean result, String reason) {
                            if (isCancellingStartSession(requestedSessionId)) {
                                markFailedIfCurrent(requestedSessionId,
                                        "Performance start was cancelled before recording");
                                callback.onResult(snapshotWithRunningItems());
                                return;
                            }
                            if (!isCurrentStartingSession(requestedSessionId)) {
                                return;
                            }
                            if (!result) {
                                markFailedIfCurrent(requestedSessionId,
                                        "Performance permissions are not ready: " + reason);
                                callback.onResult(snapshotWithRunningItems());
                                return;
                            }

                            DisplayProvider.RecordingLease acquiredLease = null;
                            try {
                                AppInfoProvider provider = AppInfoProvider.getInstance();
                                InjectorService.g().unregister(provider);
                                InjectorService.g().register(provider);

                                acquiredLease =
                                        displayProvider.startRecordingSessionIfIdle(items);
                                if (acquiredLease == null) {
                                    markFailedIfCurrent(requestedSessionId,
                                            "Unable to atomically acquire the requested performance items");
                                    callback.onResult(snapshotWithRunningItems());
                                    return;
                                }
                                List<String> acquiredDisplays =
                                        acquiredLease.getDisplayNames();
                                if (acquiredLease.isCleanupOnly()) {
                                    retainLeaseForCleanup(displayProvider,
                                            requestedSessionId, acquiredDisplays, acquiredLease,
                                            acquiredLease.getStartError(), false);
                                    callback.onResult(snapshotWithRunningItems());
                                    return;
                                }
                                if (acquiredDisplays.isEmpty()) {
                                    rollbackAcquiredRecording(displayProvider,
                                            requestedSessionId, acquiredDisplays, acquiredLease,
                                            "No performance items were acquired");
                                    callback.onResult(snapshotWithRunningItems());
                                    return;
                                }
                                showRecordingNotification(context);
                                if (!markRecording(requestedSessionId,
                                        acquiredDisplays, displayProvider, acquiredLease)) {
                                    hideRecordingNotification(context);
                                    rollbackAcquiredRecording(displayProvider,
                                            requestedSessionId, acquiredDisplays, acquiredLease,
                                            "Performance start was cancelled before recording");
                                    callback.onResult(snapshotWithRunningItems());
                                    return;
                                }
                                callback.onResult(snapshotWithRunningItems());
                            } catch (RuntimeException e) {
                                hideRecordingNotification(context);
                                if (acquiredLease != null) {
                                    rollbackAcquiredRecording(displayProvider,
                                            requestedSessionId, acquiredLease.getDisplayNames(),
                                            acquiredLease,
                                            "Unable to start performance recording: "
                                                    + e.getMessage());
                                } else {
                                    markFailedIfCurrent(requestedSessionId,
                                            "Unable to start performance recording: "
                                                    + e.getMessage());
                                }
                                LogUtil.e(TAG, "Unable to start performance recording", e);
                                callback.onResult(snapshotWithRunningItems());
                            }
                        }
                    });
        } catch (RuntimeException e) {
            LogUtil.e(TAG, "Unable to request performance permissions", e);
            markFailedIfCurrent(requestedSessionId,
                    "Unable to request performance permissions: " + e.getMessage());
            callback.onResult(snapshotWithRunningItems());
        }
        return true;
    }

    private boolean stopRecording(final Activity context, Map<String, String> params,
                                  final Callback<Map<String, Object>> callback) {
        final String expectedSessionId = params.get(SESSION_ID);
        final String reportUrl = params.get(REPORT_URL);
        boolean cancelledStarting = false;

        if (StringUtil.isEmpty(expectedSessionId)) {
            callback.onResult(errorWithStatus("Parameter 'sessionId' is required"));
            return true;
        }

        synchronized (stateLock) {
            if (!StringUtil.equals(expectedSessionId, sessionId)) {
                callback.onResult(errorWithStatus("Performance sessionId does not match"));
                return true;
            }
            if (STATE_STARTING.equals(state)) {
                state = STATE_STOPPING;
                error = "Performance start cancellation is waiting for the permission request";
                cancelledStarting = true;
            } else if (STATE_RECORDING.equals(state)) {
                state = STATE_STOPPING;
                stopInProgress = true;
            } else if (STATE_STOPPING.equals(state) && recordingLease != null) {
                if (stopInProgress) {
                    callback.onResult(errorWithStatus(
                            "Performance stop is already in progress"));
                    return true;
                }
                // 上一次资源清理未完成，允许使用同一租约重试。
                stopInProgress = true;
            } else {
                callback.onResult(errorWithStatus("There is no active performance recording"));
                return true;
            }
        }

        if (cancelledStarting) {
            callback.onResult(snapshotWithRunningItems());
            return true;
        }

        hideRecordingNotification(context);
        final RecordingOwner owner = recordingOwnerSnapshot(expectedSessionId);
        if (owner == null) {
            setStopError(expectedSessionId, null,
                    "Performance recording owner is missing");
            callback.onResult(snapshotWithRunningItems());
            return true;
        }
        final DisplayProvider displayProvider = owner.provider;
        final DisplayProvider.RecordingLease lease = owner.lease;

        final Map<RecordPattern, List<RecordPattern.RecordItem>> records;
        try {
            DisplayProvider.RecordingStopResult stopResult =
                    displayProvider.stopRecordingSession(lease);
            if (!stopResult.isMatched()) {
                if (clearRecordingLease(expectedSessionId, displayProvider, lease)) {
                    markFailedIfCurrent(expectedSessionId,
                            owner.cleanupOnly && !StringUtil.isEmpty(owner.terminalError)
                                    ? owner.terminalError
                                    : "Performance recording owner was restarted before cleanup completed");
                }
                callback.onResult(snapshotWithRunningItems());
                return true;
            }
            if (!stopResult.isCleanupComplete()) {
                setStopError(expectedSessionId, lease,
                        "Performance cleanup is incomplete; retry stop with the same sessionId: "
                        + stopResult.getError());
                callback.onResult(snapshotWithRunningItems());
                return true;
            }
            if (!clearRecordingLease(expectedSessionId, displayProvider, lease)) {
                callback.onResult(snapshotWithRunningItems());
                return true;
            }
            if (owner.cleanupOnly) {
                markFailedIfCurrent(expectedSessionId,
                        StringUtil.isEmpty(owner.terminalError)
                                ? "Performance start failed and cleanup is complete"
                                : owner.terminalError);
                callback.onResult(snapshotWithRunningItems());
                return true;
            }
            if (!stopResult.isRecordsComplete()) {
                markFailedIfCurrent(expectedSessionId,
                        "Performance records are incomplete: "
                        + stopResult.getError());
                callback.onResult(snapshotWithRunningItems());
                return true;
            }
            records = stopResult.getRecords();
        } catch (RuntimeException e) {
            LogUtil.e(TAG, "Unable to stop performance recording", e);
            setStopError(expectedSessionId, lease,
                    "Unable to stop performance recording; retry with the same sessionId: "
                    + e.getMessage());
            callback.onResult(snapshotWithRunningItems());
            return true;
        }

        callback.onResult(snapshotWithRunningItems());
        try {
            BackgroundExecutor.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (StringUtil.isEmpty(reportUrl)) {
                            File folder = RecordUtil.saveToFileStrict(records,
                                    RecordUtil.performanceFolderName(expectedSessionId));
                            String shellPath = FileUtils.getPathInShell(folder);
                            if (markStopped(expectedSessionId, shellPath, null, null)) {
                                LauncherApplication.getInstance().showToast(StringUtil.getString(
                                        R.string.performance__record_save, folder.getPath()));
                            }
                        } else {
                            String response = RecordUtil.uploadData(reportUrl, records);
                            if (response == null) {
                                markFailedIfCurrent(expectedSessionId,
                                        "Performance data upload failed");
                                return;
                            }
                            if (markStopped(expectedSessionId, null, reportUrl, response)) {
                                LauncherApplication.getInstance().showToast(StringUtil.getString(
                                        R.string.performance__record_upload, reportUrl, response));
                            }
                        }
                    } catch (IOException | RuntimeException e) {
                        LogUtil.e(TAG, "Unable to persist performance recording", e);
                        markFailedIfCurrent(expectedSessionId,
                                "Unable to persist performance recording: " + e.getMessage());
                    }
                }
            });
        } catch (RuntimeException e) {
            LogUtil.e(TAG, "Unable to schedule performance persistence", e);
            markFailedIfCurrent(expectedSessionId,
                    "Unable to schedule performance persistence: " + e.getMessage());
        }
        return true;
    }

    private void showRecordingNotification(Context context) {
        notification = Notifications.generateNotificationBuilder(context)
                .setContentTitle(context.getString(R.string.performance__recording))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setWhen(System.currentTimeMillis())
                .setPriority(Notification.PRIORITY_HIGH)
                .setSmallIcon(R.drawable.icon_recording)
                .setUsesChronometer(true)
                .setContentText(context.getString(R.string.performance__recording_performance_data))
                .build();
        NotificationManager notificationManager = (NotificationManager)
                context.getSystemService(Context.NOTIFICATION_SERVICE);
        notificationManager.notify(PERFORMANCE_RECORD_ID, notification);
    }

    private void hideRecordingNotification(Context context) {
        NotificationManager notificationManager = (NotificationManager)
                context.getSystemService(Context.NOTIFICATION_SERVICE);
        notificationManager.cancel(PERFORMANCE_RECORD_ID);
        notification = null;
    }

    private List<String> normalizeItems(String itemList) {
        if (StringUtil.isEmpty(itemList)) {
            return Collections.emptyList();
        }
        LinkedHashSet<String> normalized = new LinkedHashSet<>();
        for (String item : Arrays.asList(itemList.split(","))) {
            String value = item == null ? null : item.trim();
            if (!StringUtil.isEmpty(value)) {
                normalized.add(value);
            }
        }
        return new ArrayList<>(normalized);
    }

    private boolean beginStarting(String newSessionId, String target, List<String> items) {
        synchronized (stateLock) {
            if (isActive(state)) {
                return false;
            }
            sessionId = newSessionId;
            targetPackage = target;
            requestedItems = new ArrayList<>(items);
            ownedDisplayNames = Collections.emptyList();
            recordingLease = null;
            recordingProvider = null;
            cleanupOnly = false;
            cleanupTerminalError = null;
            stopInProgress = false;
            state = STATE_STARTING;
            outputPath = null;
            uploadUrl = null;
            uploadResponse = null;
            error = null;
            startedAt = 0L;
            finishedAt = 0L;
            return true;
        }
    }

    private boolean isCurrentStartingSession(String expectedSessionId) {
        synchronized (stateLock) {
            return STATE_STARTING.equals(state)
                    && StringUtil.equals(expectedSessionId, sessionId);
        }
    }

    private boolean isCancellingStartSession(String expectedSessionId) {
        synchronized (stateLock) {
            return STATE_STOPPING.equals(state)
                    && startedAt == 0L
                    && StringUtil.equals(expectedSessionId, sessionId);
        }
    }

    private boolean markRecording(String expectedSessionId, List<String> displayNames,
                                  DisplayProvider provider,
                                  DisplayProvider.RecordingLease lease) {
        synchronized (stateLock) {
            if (!STATE_STARTING.equals(state)
                    || !StringUtil.equals(expectedSessionId, sessionId)) {
                return false;
            }
            state = STATE_RECORDING;
            ownedDisplayNames = new ArrayList<>(displayNames);
            recordingProvider = provider;
            recordingLease = lease;
            cleanupOnly = false;
            cleanupTerminalError = null;
            stopInProgress = false;
            startedAt = System.currentTimeMillis();
            return true;
        }
    }

    private boolean markStopped(String expectedSessionId, String newOutputPath,
                                String newUploadUrl, String newUploadResponse) {
        synchronized (stateLock) {
            if (!StringUtil.equals(expectedSessionId, sessionId)
                    || recordingLease != null) {
                return false;
            }
            state = STATE_STOPPED;
            outputPath = newOutputPath;
            uploadUrl = newUploadUrl;
            uploadResponse = newUploadResponse;
            ownedDisplayNames = Collections.emptyList();
            recordingLease = null;
            recordingProvider = null;
            cleanupOnly = false;
            cleanupTerminalError = null;
            stopInProgress = false;
            error = null;
            finishedAt = System.currentTimeMillis();
            return true;
        }
    }

    private void markFailed(String newSessionId, String target, List<String> items, String reason) {
        synchronized (stateLock) {
            sessionId = newSessionId;
            targetPackage = target;
            requestedItems = new ArrayList<>(items);
            ownedDisplayNames = Collections.emptyList();
            recordingLease = null;
            recordingProvider = null;
            cleanupOnly = false;
            cleanupTerminalError = null;
            stopInProgress = false;
            state = STATE_FAILED;
            outputPath = null;
            uploadUrl = null;
            uploadResponse = null;
            error = reason;
            startedAt = 0L;
            finishedAt = System.currentTimeMillis();
        }
    }

    private void markFailedIfCurrent(String expectedSessionId, String reason) {
        synchronized (stateLock) {
            if (!StringUtil.equals(expectedSessionId, sessionId)) {
                return;
            }
            if (recordingLease != null) {
                state = STATE_STOPPING;
                error = reason;
                return;
            }
            state = STATE_FAILED;
            ownedDisplayNames = Collections.emptyList();
            recordingLease = null;
            recordingProvider = null;
            cleanupOnly = false;
            cleanupTerminalError = null;
            stopInProgress = false;
            error = reason;
            finishedAt = System.currentTimeMillis();
        }
    }

    private void setStopError(String expectedSessionId,
                              DisplayProvider.RecordingLease expectedLease,
                              String reason) {
        synchronized (stateLock) {
            if (!StringUtil.equals(expectedSessionId, sessionId)
                    || (expectedLease != null && recordingLease != expectedLease)) {
                return;
            }
            state = STATE_STOPPING;
            error = reason;
            stopInProgress = false;
        }
    }

    private void rollbackAcquiredRecording(DisplayProvider displayProvider,
                                           String expectedSessionId,
                                           List<String> displayNames,
                                           DisplayProvider.RecordingLease lease,
                                           String reason) {
        boolean tracked = retainLeaseForCleanup(
                displayProvider, expectedSessionId, displayNames, lease, reason, true);
        try {
            DisplayProvider.RecordingStopResult stopResult =
                    displayProvider.stopRecordingSession(lease);
            if (!tracked) {
                return;
            }
            if (stopResult.isMatched() && stopResult.isCleanupComplete()) {
                if (clearRecordingLease(expectedSessionId, displayProvider, lease)) {
                    markFailedIfCurrent(expectedSessionId, reason);
                }
            } else {
                setStopError(expectedSessionId, lease,
                        reason + "; cleanup is incomplete: " + stopResult.getError());
            }
        } catch (RuntimeException cleanupError) {
            LogUtil.e(TAG, "Unable to roll back performance recording", cleanupError);
            if (tracked) {
                setStopError(expectedSessionId, lease,
                        reason + "; cleanup failed: " + cleanupError.getMessage());
            }
        }
    }

    private boolean retainLeaseForCleanup(DisplayProvider provider,
                                          String expectedSessionId,
                                          List<String> displayNames,
                                          DisplayProvider.RecordingLease lease,
                                          String reason,
                                          boolean cleanupStarted) {
        synchronized (stateLock) {
            if (!StringUtil.equals(expectedSessionId, sessionId)) {
                return false;
            }
            state = STATE_STOPPING;
            ownedDisplayNames = new ArrayList<>(displayNames);
            recordingProvider = provider;
            recordingLease = lease;
            cleanupOnly = true;
            cleanupTerminalError = reason;
            stopInProgress = cleanupStarted;
            error = reason;
            return true;
        }
    }

    private RecordingOwner recordingOwnerSnapshot(String expectedSessionId) {
        synchronized (stateLock) {
            if (!StringUtil.equals(expectedSessionId, sessionId)
                    || recordingProvider == null || recordingLease == null) {
                return null;
            }
            return new RecordingOwner(recordingProvider, recordingLease,
                    cleanupOnly, cleanupTerminalError);
        }
    }

    private RecordingOwner recordingOwnerSnapshot() {
        synchronized (stateLock) {
            if (recordingProvider == null || recordingLease == null) {
                return null;
            }
            return new RecordingOwner(recordingProvider, recordingLease,
                    cleanupOnly, cleanupTerminalError);
        }
    }

    private boolean clearRecordingLease(String expectedSessionId,
                                        DisplayProvider provider,
                                        DisplayProvider.RecordingLease lease) {
        synchronized (stateLock) {
            if (StringUtil.equals(expectedSessionId, sessionId)
                    && recordingProvider == provider && recordingLease == lease) {
                recordingLease = null;
                recordingProvider = null;
                ownedDisplayNames = Collections.emptyList();
                stopInProgress = false;
                return true;
            }
            return false;
        }
    }

    private Map<String, Object> snapshotWithRunningItems() {
        Map<String, Object> result = snapshot();
        RecordingOwner owner = recordingOwnerSnapshot();
        DisplayProvider displayProvider = owner == null
                ? currentDisplayProvider()
                : owner.provider;
        Set<String> runningItems = displayProvider == null
                ? Collections.<String>emptySet() : displayProvider.getRunningDisplayItems();
        result.put("runningItems", runningItems == null
                ? Collections.emptyList() : new ArrayList<>(runningItems));
        return result;
    }

    private Map<String, Object> currentValues() {
        RecordingOwner owner = recordingOwnerSnapshot();
        DisplayProvider displayProvider = owner == null
                ? currentDisplayProvider()
                : owner.provider;
        if (displayProvider == null) {
            return error("Performance display service is not ready");
        }
        Map<String, Object> values = new LinkedHashMap<>();
        if (owner != null) {
            values.putAll(displayProvider.getCurrentDisplayContents(owner.lease));
        } else {
            Set<String> runningItems = displayProvider.getRunningDisplayItems();
            if (runningItems != null) {
                for (String displayName : runningItems) {
                    values.put(displayName,
                            displayProvider.getCurrentDisplayContent(displayName));
                }
            }
        }
        Map<String, Object> result = snapshotWithRunningItems();
        result.put("sampledAt", System.currentTimeMillis());
        result.put("values", values);
        return result;
    }

    private DisplayProvider currentDisplayProvider() {
        DisplayProvider service = LauncherApplication.service(DisplayProvider.class);
        return service == null ? null : service.getRecordingSessionOwner();
    }

    private static final class RecordingOwner {
        private final DisplayProvider provider;
        private final DisplayProvider.RecordingLease lease;
        private final boolean cleanupOnly;
        private final String terminalError;

        private RecordingOwner(DisplayProvider provider,
                               DisplayProvider.RecordingLease lease,
                               boolean cleanupOnly,
                               String terminalError) {
            this.provider = provider;
            this.lease = lease;
            this.cleanupOnly = cleanupOnly;
            this.terminalError = terminalError;
        }
    }

    private Map<String, Object> snapshot() {
        synchronized (stateLock) {
            Map<String, Object> result = success();
            result.put("kind", "performance");
            result.put("sessionId", sessionId);
            result.put("state", state);
            result.put("recording", STATE_RECORDING.equals(state));
            result.put("active", isActive(state));
            result.put("terminal", isTerminal(state));
            result.put("stopRetryable", STATE_STOPPING.equals(state)
                    && recordingLease != null && !stopInProgress);
            result.put("targetPackage", targetPackage);
            result.put("items", new ArrayList<>(requestedItems));
            result.put("startedAt", startedAt == 0L ? null : startedAt);
            result.put("finishedAt", finishedAt == 0L ? null : finishedAt);
            result.put("durationMs", startedAt == 0L ? null
                    : (finishedAt == 0L ? System.currentTimeMillis() : finishedAt) - startedAt);
            result.put("recordsRoot", FileUtils.getPathInShell(
                    new File(FileUtils.getSolopiDir(), "records")));
            result.put("outputPath", outputPath);
            result.put("uploadUrl", uploadUrl);
            result.put("uploadResponse", uploadResponse);
            result.put("error", error);
            return result;
        }
    }

    private boolean isActive(String targetState) {
        return STATE_STARTING.equals(targetState)
                || STATE_RECORDING.equals(targetState)
                || STATE_STOPPING.equals(targetState);
    }

    private boolean isTerminal(String targetState) {
        return STATE_STOPPED.equals(targetState) || STATE_FAILED.equals(targetState);
    }

    private Map<String, Object> success() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        return result;
    }

    private Map<String, Object> error(String message) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", false);
        result.put("error", message);
        return result;
    }

    private Map<String, Object> errorWithStatus(String message) {
        Map<String, Object> result = error(message);
        result.put("performance", snapshotWithRunningItems());
        return result;
    }
}
