/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.alipay.hulu.scheme;

import android.app.Activity;
import android.content.Context;
import android.content.pm.ApplicationInfo;

import com.alipay.hulu.R;
import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.scheme.AdbSchemeActivity;
import com.alipay.hulu.common.scheme.SchemeActionResolver;
import com.alipay.hulu.common.scheme.SchemeResolver;
import com.alipay.hulu.common.tools.AppInfoProvider;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.display.DisplayItemInfo;
import com.alipay.hulu.shared.display.DisplayProvider;
import com.alipay.hulu.util.RecordUtil;

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

/** 由 ADB 控制通道持有的性能实时监控会话。 */
@SchemeResolver(value = "performance", index = 2)
public class PerformanceDisplaySchemeResolver implements SchemeActionResolver {
    private static final String TAG =
            PerformanceDisplaySchemeResolver.class.getSimpleName();

    static final String MODE_DISPLAY = "display";
    static final String ACTION_STATUS = "status";
    static final String ACTION_START = "start";
    static final String ACTION_STOP = "stop";

    static final String STATE_IDLE = "idle";
    static final String STATE_STARTING = "starting";
    static final String STATE_RUNNING = "running";
    static final String STATE_STOPPING = "stopping";
    static final String STATE_STOPPED = "stopped";
    static final String STATE_FAILED = "failed";

    private static final String MODE = "mode";
    private static final String ACTION = "action";
    private static final String SESSION_ID = "sessionId";
    private static final String TARGET_APP = "targetApp";
    private static final String ITEMS = "items";
    private static final String GLOBAL_TARGET = "-";

    private final Object stateLock = new Object();
    private String state = STATE_IDLE;
    private String sessionId;
    private String targetPackage;
    private List<String> requestedItems = Collections.emptyList();
    private List<String> ownedDisplayNames = Collections.emptyList();
    private DisplayProvider displayProvider;
    private DisplayProvider.DisplayLease displayLease;
    private boolean cleanupOnly;
    private String cleanupTerminalError;
    private boolean stopInProgress;
    private String error;
    private long startedAt;
    private long finishedAt;

    @Override
    public boolean processScheme(Context context, Map<String, String> params,
                                 Callback<Map<String, Object>> callback) {
        if (!MODE_DISPLAY.equals(params.get(MODE))) {
            return false;
        }
        String action = params.get(ACTION);
        if (ACTION_STATUS.equals(action)) {
            callback.onResult(snapshotWithRunningItems());
            return true;
        }
        if (!ACTION_START.equals(action) && !ACTION_STOP.equals(action)) {
            callback.onResult(error("Unsupported performance display action: " + action));
            return true;
        }
        if (!(context instanceof AdbSchemeActivity)) {
            callback.onResult(error(
                    "Performance display start and stop require the ADB Scheme transport"));
            return true;
        }
        if (ACTION_START.equals(action)) {
            return start((Activity) context, params, callback);
        }
        return stop(params.get(SESSION_ID), callback);
    }

    private boolean start(final Activity context, Map<String, String> params,
                          final Callback<Map<String, Object>> callback) {
        final String requestedSessionId = StringUtil.isEmpty(params.get(SESSION_ID))
                ? UUID.randomUUID().toString() : params.get(SESSION_ID);
        final List<String> items = normalizeItems(params.get(ITEMS));
        final String requestedTargetPackage = params.get(TARGET_APP);

        if (!RecordUtil.isValidPerformanceSessionId(requestedSessionId)) {
            callback.onResult(error("Invalid performance display sessionId"));
            return true;
        }
        if (!beginStarting(requestedSessionId, requestedTargetPackage, items)) {
            callback.onResult(errorWithStatus(
                    "A performance display session is already active"));
            return true;
        }
        if (items.isEmpty()) {
            markFailed(requestedSessionId, requestedTargetPackage, items,
                    "Parameter 'items' is required");
            callback.onResult(snapshotWithRunningItems());
            return true;
        }

        final DisplayProvider provider = currentDisplayProvider();
        if (provider == null || provider.getAllDisplayItems() == null) {
            markFailed(requestedSessionId, requestedTargetPackage, items,
                    "Performance display service is not ready");
            callback.onResult(snapshotWithRunningItems());
            return true;
        }

        final Map<String, DisplayItemInfo> availableItems = new LinkedHashMap<>();
        for (DisplayItemInfo info : provider.getAllDisplayItems()) {
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
                    "Unsupported performance item(s): "
                            + StringUtil.join(",", unsupportedItems));
            callback.onResult(snapshotWithRunningItems());
            return true;
        }
        Set<String> alreadyRunning = provider.getRunningDisplayItems();
        if (alreadyRunning != null && !alreadyRunning.isEmpty()) {
            markFailed(requestedSessionId, requestedTargetPackage, items,
                    "Another performance session is already running");
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
            MyApplication.getInstance().updateAppAndNameTemp(
                    requestedTargetPackage, appLabel);
        }

        Set<String> permissions = new HashSet<>();
        for (String item : items) {
            permissions.addAll(availableItems.get(item).getPermissions());
        }
        permissions.add("adb");
        permissions.add("powerSave");
        try {
            PermissionUtil.requestPermissions(new ArrayList<>(permissions), context,
                    new PermissionUtil.OnPermissionCallback() {
                        @Override
                        public void onPermissionResult(boolean result, String reason) {
                            if (isCancellingStartSession(requestedSessionId)) {
                                markFailedIfCurrent(requestedSessionId,
                                        "Performance display start was cancelled");
                                callback.onResult(snapshotWithRunningItems());
                                return;
                            }
                            if (!isCurrentStartingSession(requestedSessionId)) {
                                return;
                            }
                            if (!result) {
                                markFailedIfCurrent(requestedSessionId,
                                        "Performance display permissions are not ready: "
                                                + reason);
                                callback.onResult(snapshotWithRunningItems());
                                return;
                            }

                            try {
                                refreshAppInfoProvider(
                                        InjectorService.g(), AppInfoProvider.getInstance());
                            } catch (RuntimeException exception) {
                                LogUtil.e(TAG,
                                        "Unable to register performance app information",
                                        exception);
                                markFailedIfCurrent(requestedSessionId,
                                        "Unable to register performance app information: "
                                                + exception.getMessage());
                                callback.onResult(snapshotWithRunningItems());
                                return;
                            }

                            DisplayProvider.DisplayLease lease =
                                    provider.startDisplaySessionIfIdle(items);
                            if (lease == null) {
                                markFailedIfCurrent(requestedSessionId,
                                        "Unable to atomically acquire the requested performance items");
                                callback.onResult(snapshotWithRunningItems());
                                return;
                            }
                            List<String> acquiredDisplays = lease.getDisplayNames();
                            if (lease.isCleanupOnly()) {
                                retainLeaseForCleanup(provider, requestedSessionId,
                                        acquiredDisplays, lease, lease.getStartError());
                                callback.onResult(snapshotWithRunningItems());
                                return;
                            }
                            if (acquiredDisplays.isEmpty()) {
                                retainLeaseForCleanup(provider, requestedSessionId,
                                        acquiredDisplays, lease,
                                        "No performance items were acquired");
                                callback.onResult(snapshotWithRunningItems());
                                return;
                            }
                            if (!markRunning(requestedSessionId, acquiredDisplays,
                                    provider, lease)) {
                                retainLeaseForCleanup(provider, requestedSessionId,
                                        acquiredDisplays, lease,
                                        "Performance display start was cancelled");
                            }
                            callback.onResult(snapshotWithRunningItems());
                        }
                    });
        } catch (RuntimeException exception) {
            markFailedIfCurrent(requestedSessionId,
                    "Unable to request performance display permissions: "
                            + exception.getMessage());
            callback.onResult(snapshotWithRunningItems());
        }
        return true;
    }

    static void refreshAppInfoProvider(InjectorService injectorService,
                                       AppInfoProvider appInfoProvider) {
        if (injectorService == null) {
            throw new IllegalStateException("Injector service is not ready");
        }
        injectorService.unregister(appInfoProvider);
        int result = injectorService.register(appInfoProvider);
        if (result != InjectorService.REGISTER_SUCCESS) {
            throw new IllegalStateException(
                    "Unable to register AppInfoProvider: " + result);
        }
    }

    private boolean stop(String expectedSessionId,
                         Callback<Map<String, Object>> callback) {
        boolean cancelledStarting = false;
        DisplayOwner owner = null;
        if (StringUtil.isEmpty(expectedSessionId)) {
            callback.onResult(errorWithStatus("Parameter 'sessionId' is required"));
            return true;
        }
        synchronized (stateLock) {
            if (!StringUtil.equals(expectedSessionId, sessionId)) {
                callback.onResult(errorWithStatus(
                        "Performance display sessionId does not match"));
                return true;
            }
            if (STATE_STARTING.equals(state)) {
                state = STATE_STOPPING;
                error = "Performance display start cancellation is waiting for permissions";
                cancelledStarting = true;
            } else if (STATE_RUNNING.equals(state)) {
                state = STATE_STOPPING;
                stopInProgress = true;
                owner = ownerSnapshot(expectedSessionId);
            } else if (STATE_STOPPING.equals(state) && displayLease != null) {
                if (stopInProgress) {
                    callback.onResult(errorWithStatus(
                            "Performance display stop is already in progress"));
                    return true;
                }
                stopInProgress = true;
                owner = ownerSnapshot(expectedSessionId);
            } else {
                callback.onResult(errorWithStatus(
                        "There is no active performance display session"));
                return true;
            }
        }
        if (cancelledStarting) {
            callback.onResult(snapshotWithRunningItems());
            return true;
        }
        if (owner == null) {
            setStopError(expectedSessionId, null,
                    "Performance display owner is missing");
            callback.onResult(snapshotWithRunningItems());
            return true;
        }

        DisplayProvider.DisplayStopResult stopResult =
                owner.provider.stopDisplaySession(owner.lease);
        if (!stopResult.isMatched()) {
            clearLease(expectedSessionId, owner.provider, owner.lease);
            markFailedIfCurrent(expectedSessionId,
                    "Performance display owner was restarted before cleanup completed");
        } else if (!stopResult.isCleanupComplete()) {
            setStopError(expectedSessionId, owner.lease,
                    "Performance display cleanup is incomplete; retry stop with the same "
                            + "sessionId: " + stopResult.getError());
        } else if (clearLease(expectedSessionId, owner.provider, owner.lease)) {
            if (owner.cleanupOnly) {
                markFailedIfCurrent(expectedSessionId,
                        StringUtil.isEmpty(owner.terminalError)
                                ? "Performance display start failed and cleanup is complete"
                                : owner.terminalError);
            } else {
                markStopped(expectedSessionId);
            }
        }
        callback.onResult(snapshotWithRunningItems());
        return true;
    }

    static List<String> normalizeItems(String rawItems) {
        if (StringUtil.isEmpty(rawItems)) {
            return Collections.emptyList();
        }
        LinkedHashSet<String> result = new LinkedHashSet<>();
        for (String item : Arrays.asList(rawItems.split(","))) {
            String normalized = item == null ? null : item.trim();
            if (!StringUtil.isEmpty(normalized)) {
                result.add(normalized);
            }
        }
        return new ArrayList<>(result);
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
            displayProvider = null;
            displayLease = null;
            cleanupOnly = false;
            cleanupTerminalError = null;
            stopInProgress = false;
            state = STATE_STARTING;
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
            return STATE_STOPPING.equals(state) && displayLease == null
                    && StringUtil.equals(expectedSessionId, sessionId);
        }
    }

    private boolean markRunning(String expectedSessionId, List<String> displayNames,
                                DisplayProvider provider,
                                DisplayProvider.DisplayLease lease) {
        synchronized (stateLock) {
            if (!STATE_STARTING.equals(state)
                    || !StringUtil.equals(expectedSessionId, sessionId)) {
                return false;
            }
            state = STATE_RUNNING;
            ownedDisplayNames = new ArrayList<>(displayNames);
            displayProvider = provider;
            displayLease = lease;
            cleanupOnly = false;
            cleanupTerminalError = null;
            stopInProgress = false;
            startedAt = System.currentTimeMillis();
            return true;
        }
    }

    private void retainLeaseForCleanup(DisplayProvider provider,
                                       String expectedSessionId,
                                       List<String> displayNames,
                                       DisplayProvider.DisplayLease lease,
                                       String reason) {
        synchronized (stateLock) {
            if (!StringUtil.equals(expectedSessionId, sessionId)) {
                return;
            }
            state = STATE_STOPPING;
            ownedDisplayNames = new ArrayList<>(displayNames);
            displayProvider = provider;
            displayLease = lease;
            cleanupOnly = true;
            cleanupTerminalError = reason;
            stopInProgress = false;
            error = reason;
        }
    }

    private void markStopped(String expectedSessionId) {
        synchronized (stateLock) {
            if (!StringUtil.equals(expectedSessionId, sessionId)
                    || displayLease != null) {
                return;
            }
            state = STATE_STOPPED;
            ownedDisplayNames = Collections.emptyList();
            cleanupOnly = false;
            cleanupTerminalError = null;
            stopInProgress = false;
            error = null;
            finishedAt = System.currentTimeMillis();
        }
    }

    private void markFailed(String newSessionId, String target,
                            List<String> items, String reason) {
        synchronized (stateLock) {
            sessionId = newSessionId;
            targetPackage = target;
            requestedItems = new ArrayList<>(items);
            ownedDisplayNames = Collections.emptyList();
            displayProvider = null;
            displayLease = null;
            cleanupOnly = false;
            cleanupTerminalError = null;
            stopInProgress = false;
            state = STATE_FAILED;
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
            if (displayLease != null) {
                state = STATE_STOPPING;
                error = reason;
                stopInProgress = false;
                return;
            }
            state = STATE_FAILED;
            ownedDisplayNames = Collections.emptyList();
            displayProvider = null;
            cleanupOnly = false;
            cleanupTerminalError = null;
            stopInProgress = false;
            error = reason;
            finishedAt = System.currentTimeMillis();
        }
    }

    private void setStopError(String expectedSessionId,
                              DisplayProvider.DisplayLease expectedLease,
                              String reason) {
        synchronized (stateLock) {
            if (!StringUtil.equals(expectedSessionId, sessionId)
                    || (expectedLease != null && displayLease != expectedLease)) {
                return;
            }
            state = STATE_STOPPING;
            error = reason;
            stopInProgress = false;
        }
    }

    private DisplayOwner ownerSnapshot(String expectedSessionId) {
        if (!StringUtil.equals(expectedSessionId, sessionId)
                || displayProvider == null || displayLease == null) {
            return null;
        }
        return new DisplayOwner(displayProvider, displayLease,
                cleanupOnly, cleanupTerminalError);
    }

    private boolean clearLease(String expectedSessionId, DisplayProvider provider,
                               DisplayProvider.DisplayLease lease) {
        synchronized (stateLock) {
            if (StringUtil.equals(expectedSessionId, sessionId)
                    && displayProvider == provider && displayLease == lease) {
                displayProvider = null;
                displayLease = null;
                ownedDisplayNames = Collections.emptyList();
                stopInProgress = false;
                return true;
            }
            return false;
        }
    }

    private DisplayProvider currentDisplayProvider() {
        DisplayProvider service = LauncherApplication.service(DisplayProvider.class);
        return service == null ? null : service.getSessionOwner();
    }

    private Map<String, Object> snapshotWithRunningItems() {
        synchronized (stateLock) {
            Map<String, Object> result = snapshotLocked();
            DisplayOwner owner = displayProvider == null || displayLease == null
                    ? null : new DisplayOwner(displayProvider, displayLease,
                            cleanupOnly, cleanupTerminalError);
            if (owner != null) {
                Set<String> runningItems = owner.provider.getRunningDisplayItems();
                result.put("runningItems", runningItems == null
                        ? Collections.emptyList() : new ArrayList<>(runningItems));
                result.put("sampledAt", System.currentTimeMillis());
                result.put("values", new LinkedHashMap<>(
                        owner.provider.getCurrentDisplayContents(owner.lease)));
                return result;
            }
            DisplayProvider provider = currentDisplayProvider();
            if (provider == null) {
                result.put("runningItems", Collections.emptyList());
                result.put("sampledAt", System.currentTimeMillis());
                result.put("values", Collections.emptyMap());
                return result;
            }
            Set<String> runningItems = provider.getRunningDisplayItems();
            result.put("runningItems", runningItems == null
                    ? Collections.emptyList() : new ArrayList<>(runningItems));
            result.put("sampledAt", System.currentTimeMillis());
            result.put("values", Collections.emptyMap());
            return result;
        }
    }

    /** 调用方必须持有 stateLock。 */
    private Map<String, Object> snapshotLocked() {
        Map<String, Object> result = success();
        result.put("kind", "performance-display");
        result.put("sessionId", sessionId);
        result.put("state", state);
        result.put("running", STATE_RUNNING.equals(state));
        result.put("active", isActive(state));
        result.put("terminal", isTerminal(state));
        result.put("stopRetryable", STATE_STOPPING.equals(state)
                && displayLease != null && !stopInProgress);
        result.put("targetPackage", targetPackage);
        result.put("items", new ArrayList<>(requestedItems));
        result.put("ownedDisplayNames", new ArrayList<>(ownedDisplayNames));
        result.put("startedAt", startedAt == 0L ? null : startedAt);
        result.put("finishedAt", finishedAt == 0L ? null : finishedAt);
        result.put("durationMs", startedAt == 0L ? null
                : (finishedAt == 0L ? System.currentTimeMillis() : finishedAt) - startedAt);
        result.put("error", error);
        return result;
    }

    static boolean isActive(String targetState) {
        return STATE_STARTING.equals(targetState)
                || STATE_RUNNING.equals(targetState)
                || STATE_STOPPING.equals(targetState);
    }

    static boolean isTerminal(String targetState) {
        return STATE_STOPPED.equals(targetState) || STATE_FAILED.equals(targetState);
    }

    private static Map<String, Object> success() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        return result;
    }

    private static Map<String, Object> error(String message) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", false);
        result.put("error", message);
        return result;
    }

    private Map<String, Object> errorWithStatus(String message) {
        Map<String, Object> result = error(message);
        result.put("performanceDisplay", snapshotWithRunningItems());
        return result;
    }

    private static final class DisplayOwner {
        final DisplayProvider provider;
        final DisplayProvider.DisplayLease lease;
        final boolean cleanupOnly;
        final String terminalError;

        DisplayOwner(DisplayProvider provider, DisplayProvider.DisplayLease lease,
                     boolean cleanupOnly, String terminalError) {
            this.provider = provider;
            this.lease = lease;
            this.cleanupOnly = cleanupOnly;
            this.terminalError = terminalError;
        }
    }

}
