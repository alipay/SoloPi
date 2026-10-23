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
import android.content.Context;
import android.content.Intent;

import com.alipay.hulu.activity.QRScanActivity;
import com.alipay.hulu.common.scheme.AdbSchemeActivity;
import com.alipay.hulu.common.scheme.SchemeActionResolver;
import com.alipay.hulu.common.scheme.SchemeResolver;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.StringUtil;

import java.lang.ref.WeakReference;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/** 由用户持有相机权限与取景动作的扫码会话。 */
@SchemeResolver("scan")
public class ScanSchemeResolver implements SchemeActionResolver {
    public static final String ACTION = "action";
    public static final String ACTION_START = "start";
    public static final String ACTION_STATUS = "status";
    public static final String ACTION_CANCEL = "cancel";
    public static final String SESSION_ID = "sessionId";

    public static final String STATE_IDLE = "idle";
    public static final String STATE_STARTING = "starting";
    public static final String STATE_PENDING_CAMERA_PERMISSION =
            "pending-camera-permission";
    public static final String STATE_SCANNING = "scanning";
    public static final String STATE_COMPLETED = "completed";
    public static final String STATE_CANCELLED = "cancelled";
    public static final String STATE_FAILED = "failed";

    private static final Pattern SESSION_ID_PATTERN =
            Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,127}");
    private static final Object STATE_LOCK = new Object();

    private static String sessionId;
    private static String state = STATE_IDLE;
    private static String content;
    private static String format;
    private static String codeType;
    private static String error;
    private static long requestedAt;
    private static long startedAt;
    private static long finishedAt;
    private static long generation;
    private static WeakReference<QRScanActivity> protocolActivity =
            new WeakReference<>(null);
    private static WeakReference<QRScanActivity> manualActivity =
            new WeakReference<>(null);

    @Override
    public boolean processScheme(Context context, Map<String, String> params,
                                 Callback<Map<String, Object>> callback) {
        String action = params.get(ACTION);
        if (ACTION_STATUS.equals(action)) {
            callback.onResult(snapshot());
            return true;
        }
        if (!ACTION_START.equals(action) && !ACTION_CANCEL.equals(action)) {
            callback.onResult(error("unsupported_action",
                    "Unsupported scan action: " + action));
            return true;
        }
        if (!(context instanceof AdbSchemeActivity)) {
            callback.onResult(error("mutation_transport_required",
                    "Scan changes require the ADB scheme transport"));
            return true;
        }
        if (ACTION_START.equals(action)) {
            callback.onResult(start((Activity) context, params.get(SESSION_ID)));
        } else {
            callback.onResult(cancel(params.get(SESSION_ID)));
        }
        return true;
    }

    private Map<String, Object> start(Activity activity, String requestedSessionId) {
        if (!isValidSessionId(requestedSessionId)) {
            return error("invalid_session_id", "A valid sessionId is required");
        }

        final long expectedGeneration;
        synchronized (STATE_LOCK) {
            if (isActive(state)) {
                return errorWithStatus("scan_conflict", "A scan session is already active");
            }
            if (liveActivity(manualActivity) != null) {
                return errorWithStatus("manual_scan_active",
                        "A manual scan page is already active");
            }
            if (liveActivity(protocolActivity) != null) {
                return errorWithStatus("scan_activity_busy",
                        "The previous scan page is still closing");
            }

            generation += 1L;
            expectedGeneration = generation;
            sessionId = requestedSessionId;
            state = STATE_STARTING;
            content = null;
            format = null;
            codeType = null;
            error = null;
            requestedAt = System.currentTimeMillis();
            startedAt = 0L;
            finishedAt = 0L;
        }

        Intent intent = new Intent(activity, QRScanActivity.class);
        intent.putExtra(QRScanActivity.KEY_PROTOCOL_SESSION_ID, requestedSessionId);
        intent.putExtra(QRScanActivity.KEY_PROTOCOL_GENERATION, expectedGeneration);
        try {
            activity.startActivity(intent);
        } catch (RuntimeException exception) {
            markFailed(requestedSessionId, expectedGeneration,
                    "Unable to open the scan page: " + exception.getMessage());
        }
        return snapshot();
    }

    private Map<String, Object> cancel(String requestedSessionId) {
        if (!isValidSessionId(requestedSessionId)) {
            return error("invalid_session_id", "A valid sessionId is required");
        }

        final QRScanActivity activity;
        synchronized (STATE_LOCK) {
            if (!StringUtil.equals(sessionId, requestedSessionId)) {
                return errorWithStatus("session_mismatch",
                        "The scan sessionId does not match the active or latest session");
            }
            if (isTerminal(state)) {
                return snapshotLocked();
            }
            if (!isActive(state)) {
                return errorWithStatus("scan_not_active", "The scan session is not active");
            }
            state = STATE_CANCELLED;
            finishedAt = System.currentTimeMillis();
            error = null;
            activity = liveActivity(protocolActivity);
        }

        if (activity != null) {
            activity.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (!activity.isFinishing()) {
                        activity.finish();
                    }
                }
            });
        }
        return snapshot();
    }

    public static boolean attachProtocolActivity(QRScanActivity activity,
                                                 String requestedSessionId,
                                                 long expectedGeneration) {
        synchronized (STATE_LOCK) {
            if (!matchesActiveSessionLocked(requestedSessionId, expectedGeneration)
                    || liveActivity(manualActivity) != null) {
                return false;
            }
            QRScanActivity attached = liveActivity(protocolActivity);
            if (attached != null && attached != activity) {
                return false;
            }
            protocolActivity = new WeakReference<>(activity);
            return true;
        }
    }

    public static boolean attachManualActivity(QRScanActivity activity) {
        synchronized (STATE_LOCK) {
            if (isActive(state) || liveActivity(protocolActivity) != null) {
                return false;
            }
            QRScanActivity attached = liveActivity(manualActivity);
            if (attached != null && attached != activity) {
                return false;
            }
            manualActivity = new WeakReference<>(activity);
            return true;
        }
    }

    public static void releaseManualActivity(QRScanActivity activity) {
        synchronized (STATE_LOCK) {
            if (manualActivity.get() == activity) {
                manualActivity.clear();
            }
        }
    }

    public static void onCameraPermissionRequired(String requestedSessionId,
                                                  long expectedGeneration) {
        synchronized (STATE_LOCK) {
            if (matchesActiveSessionLocked(requestedSessionId, expectedGeneration)) {
                state = STATE_PENDING_CAMERA_PERMISSION;
            }
        }
    }

    public static void onScanReady(String requestedSessionId, long expectedGeneration) {
        synchronized (STATE_LOCK) {
            if (matchesActiveSessionLocked(requestedSessionId, expectedGeneration)) {
                state = STATE_SCANNING;
                if (startedAt == 0L) {
                    startedAt = System.currentTimeMillis();
                }
            }
        }
    }

    public static boolean onScanCompleted(String requestedSessionId, long expectedGeneration,
                                          String scannedContent, String scannedFormat,
                                          String scannedCodeType) {
        if (StringUtil.isEmpty(scannedContent)
                || StringUtil.isEmpty(scannedFormat)
                || StringUtil.isEmpty(scannedCodeType)) {
            return false;
        }
        synchronized (STATE_LOCK) {
            if (!matchesActiveSessionLocked(requestedSessionId, expectedGeneration)) {
                return false;
            }
            long now = System.currentTimeMillis();
            if (startedAt == 0L) {
                startedAt = now;
            }
            content = scannedContent;
            format = scannedFormat;
            codeType = scannedCodeType;
            state = STATE_COMPLETED;
            finishedAt = now;
            error = null;
            return true;
        }
    }

    public static void markFailed(String requestedSessionId, long expectedGeneration,
                                  String failure) {
        synchronized (STATE_LOCK) {
            if (!matchesActiveSessionLocked(requestedSessionId, expectedGeneration)) {
                return;
            }
            state = STATE_FAILED;
            finishedAt = System.currentTimeMillis();
            error = StringUtil.isEmpty(failure) ? "Scan failed" : failure;
        }
    }

    public static void onProtocolActivityDestroyed(QRScanActivity activity,
                                                   String requestedSessionId,
                                                   long expectedGeneration) {
        synchronized (STATE_LOCK) {
            if (protocolActivity.get() == activity) {
                protocolActivity.clear();
            }
            if (matchesActiveSessionLocked(requestedSessionId, expectedGeneration)) {
                state = STATE_CANCELLED;
                finishedAt = System.currentTimeMillis();
                error = null;
            }
        }
    }

    static boolean isValidSessionId(String value) {
        return value != null && SESSION_ID_PATTERN.matcher(value).matches();
    }

    static boolean isActive(String value) {
        return STATE_STARTING.equals(value)
                || STATE_PENDING_CAMERA_PERMISSION.equals(value)
                || STATE_SCANNING.equals(value);
    }

    static boolean isTerminal(String value) {
        return STATE_COMPLETED.equals(value)
                || STATE_CANCELLED.equals(value)
                || STATE_FAILED.equals(value);
    }

    private static boolean matchesActiveSessionLocked(String requestedSessionId,
                                                      long expectedGeneration) {
        return generation == expectedGeneration
                && StringUtil.equals(sessionId, requestedSessionId)
                && isActive(state);
    }

    private static QRScanActivity liveActivity(WeakReference<QRScanActivity> reference) {
        QRScanActivity activity = reference.get();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            return null;
        }
        return activity;
    }

    private static Map<String, Object> snapshot() {
        synchronized (STATE_LOCK) {
            return snapshotLocked();
        }
    }

    private static Map<String, Object> snapshotLocked() {
        Map<String, Object> result = new LinkedHashMap<>();
        boolean idle = STATE_IDLE.equals(state);
        boolean terminal = isTerminal(state);
        boolean userActionRequired = STATE_PENDING_CAMERA_PERMISSION.equals(state)
                || STATE_SCANNING.equals(state);
        result.put("success", true);
        result.put("kind", "scan");
        result.put("sessionId", idle ? null : sessionId);
        result.put("state", state);
        result.put("active", isActive(state));
        result.put("terminal", terminal);
        result.put("scanning", STATE_SCANNING.equals(state));
        result.put("userActionRequired", userActionRequired);
        if (STATE_PENDING_CAMERA_PERMISSION.equals(state)) {
            result.put("requiredUserAction", "Grant camera permission on the device");
        } else if (STATE_SCANNING.equals(state)) {
            result.put("requiredUserAction", "Aim the camera at a supported code");
        } else {
            result.put("requiredUserAction", null);
        }
        result.put("manualScanActive", liveActivity(manualActivity) != null);
        result.put("protocolActivityAttached", liveActivity(protocolActivity) != null);
        result.put("content", STATE_COMPLETED.equals(state) ? content : null);
        result.put("format", STATE_COMPLETED.equals(state) ? format : null);
        result.put("codeType", STATE_COMPLETED.equals(state) ? codeType : null);
        result.put("contentExecuted", false);
        result.put("requestedAt", idle ? null : requestedAt);
        result.put("startedAt", startedAt == 0L ? null : startedAt);
        result.put("finishedAt", finishedAt == 0L ? null : finishedAt);
        result.put("durationMs", startedAt == 0L || finishedAt == 0L
                ? null : Math.max(0L, finishedAt - startedAt));
        result.put("error", STATE_FAILED.equals(state) ? error : null);
        return result;
    }

    private static Map<String, Object> errorWithStatus(String code, String message) {
        Map<String, Object> result = error(code, message);
        result.put("scan", snapshot());
        return result;
    }

    private static Map<String, Object> error(String code, String message) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", false);
        result.put("errorCode", code);
        result.put("error", message);
        return result;
    }
}
