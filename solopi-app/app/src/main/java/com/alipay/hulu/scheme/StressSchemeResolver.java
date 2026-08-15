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

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.scheme.SchemeActionResolver;
import com.alipay.hulu.common.scheme.AdbSchemeActivity;
import com.alipay.hulu.common.scheme.SchemeResolver;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.tools.PerformStressImpl;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;

/** CPU/内存加压的有界、带所有权和自动停止的控制协议。 */
@SchemeResolver("stress")
public class StressSchemeResolver implements SchemeActionResolver {
    private static final String ACTION_START = "start";
    private static final String ACTION_STOP = "stop";
    private static final String ACTION_STATUS = "status";
    private static final String STATE_IDLE = "idle";
    private static final String STATE_STARTING = "starting";
    private static final String STATE_RUNNING = "running";
    private static final String STATE_STOPPING = "stopping";
    private static final String STATE_STOPPED = "stopped";
    private static final String STATE_FAILED = "failed";
    private static final int MAX_MEMORY_MB = 2048;
    private static final int MAX_DURATION_SECONDS = 3600;
    private static final long STOP_CONFIRM_TIMEOUT_MS = 10000L;
    private static final long STOP_POLL_INTERVAL_MS = 50L;
    private static final String TAG = "StressSchemeResolver";

    private static final Object STATE_LOCK = new Object();
    private static String sessionId;
    private static String state = STATE_IDLE;
    private static int cpuCount;
    private static int cpuPercent;
    private static int memoryMb;
    private static int durationSec;
    private static String error;
    private static long startedAt;
    private static long finishedAt;
    private static long sessionGeneration;
    private static boolean loadApplied;

    @Override
    public boolean processScheme(Context context, Map<String, String> params,
                                 Callback<Map<String, Object>> callback) {
        String action = params.get("action");
        if (ACTION_STATUS.equals(action)) {
            callback.onResult(snapshot());
            return true;
        }
        if (!ACTION_START.equals(action) && !ACTION_STOP.equals(action)) {
            callback.onResult(error("unsupported_action", "Unsupported stress action: " + action));
            return true;
        }
        if (!(context instanceof AdbSchemeActivity)) {
            callback.onResult(error("mutation_transport_required",
                    "Stress changes require the ADB scheme transport"));
            return true;
        }
        if (ACTION_START.equals(action)) {
            callback.onResult(start((Activity) context, params));
        } else {
            callback.onResult(stop(params.get("sessionId"), false, -1L));
        }
        return true;
    }

    private Map<String, Object> start(Activity context, Map<String, String> params) {
        final String requestedSessionId = params.get("sessionId");
        if (StringUtil.isEmpty(requestedSessionId)) {
            return error("missing_session_id", "Parameter 'sessionId' is required");
        }
        final int requestedCpuCount;
        final int requestedCpuPercent;
        final int requestedMemory;
        final int requestedDuration;
        try {
            requestedCpuCount = parseInt(params.get("cpuCount"), 0);
            requestedCpuPercent = parseInt(params.get("cpuPercent"), 0);
            requestedMemory = parseInt(params.get("memory"), 0);
            requestedDuration = parseInt(params.get("durationSec"), 60);
        } catch (NumberFormatException e) {
            return error("invalid_stress_value", "Stress values must be integers");
        }
        int maxCpuCount = Runtime.getRuntime().availableProcessors();
        if (requestedCpuCount < 0 || requestedCpuCount > maxCpuCount) {
            return error("invalid_cpu_count", "cpuCount must be between 0 and " + maxCpuCount);
        }
        if (requestedCpuPercent < 0 || requestedCpuPercent > 100) {
            return error("invalid_cpu_percent", "cpuPercent must be between 0 and 100");
        }
        if ((requestedCpuCount == 0) != (requestedCpuPercent == 0)) {
            return error("invalid_cpu_stress", "cpuCount and cpuPercent must both be zero or positive");
        }
        if (requestedMemory < 0 || requestedMemory > MAX_MEMORY_MB) {
            return error("invalid_memory", "memory must be between 0 and " + MAX_MEMORY_MB + " MB");
        }
        if (requestedCpuCount == 0 && requestedMemory == 0) {
            return error("empty_stress", "At least CPU or memory stress is required");
        }
        if (requestedDuration < 1 || requestedDuration > MAX_DURATION_SECONDS) {
            return error("invalid_duration", "durationSec must be between 1 and 3600");
        }

        final PerformStressImpl stressController = resolveStressController();
        if (stressController == null) {
            return error("stress_service_unavailable", "Stress service is not available");
        }

        final long requestedGeneration;
        synchronized (STATE_LOCK) {
            if (isActive(state)) {
                return errorWithStatus("stress_conflict", "A stress session is already active");
            }
            if (stressController.isLoadBlockedByMaintenance()) {
                return errorWithStatus("external_stress_conflict",
                        "Plugin maintenance prevents starting CPU or memory stress");
            }
            if (hasStressLoad(stressController)) {
                return errorWithStatus("external_stress_conflict",
                        "CPU or memory stress is already active outside this session");
            }
            sessionId = requestedSessionId;
            requestedGeneration = ++sessionGeneration;
            state = STATE_STARTING;
            cpuCount = requestedCpuCount;
            cpuPercent = requestedCpuPercent;
            memoryMb = requestedMemory;
            durationSec = requestedDuration;
            error = null;
            startedAt = 0L;
            finishedAt = 0L;
            loadApplied = false;
        }

        try {
            PermissionUtil.requestPermissions(Arrays.asList("adb", "powerSave"), context,
                    new PermissionUtil.OnPermissionCallback() {
                        @Override
                        public void onPermissionResult(boolean result, String reason) {
                            if (!result) {
                                failStartAndCleanup(requestedSessionId, requestedGeneration,
                                        stressController,
                                        "Permission denied: " + reason);
                                return;
                            }
                            String failure = configureAndMarkRunning(requestedSessionId,
                                    requestedGeneration, stressController, requestedCpuCount,
                                    requestedCpuPercent, requestedMemory);
                            if (failure != null) {
                                return;
                            }
                            if (!isSessionInState(requestedSessionId, requestedGeneration,
                                    STATE_RUNNING)) {
                                return;
                            }
                            LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    stop(requestedSessionId, true, requestedGeneration);
                                }
                            }, requestedDuration * 1000L);
                        }
                    });
        } catch (RuntimeException e) {
            failStartAndCleanup(requestedSessionId, requestedGeneration, stressController,
                    "Unable to request stress permissions: " + safeMessage(e));
        }
        return snapshot();
    }

    private static Map<String, Object> stop(final String requestedSessionId, boolean automatic,
                                            long expectedGeneration) {
        if (StringUtil.isEmpty(requestedSessionId)) {
            return error("missing_session_id", "Parameter 'sessionId' is required");
        }
        final long stoppingGeneration;
        final boolean shouldClearLoad;
        synchronized (STATE_LOCK) {
            if (!StringUtil.equals(requestedSessionId, sessionId)
                    || (expectedGeneration >= 0 && expectedGeneration != sessionGeneration)) {
                if (automatic) {
                    return snapshot();
                }
                return errorWithStatus("session_mismatch", "Stress sessionId does not match");
            }
            if (STATE_STOPPING.equals(state) || STATE_STOPPED.equals(state)
                    || STATE_FAILED.equals(state)) {
                return snapshot();
            }
            if (!STATE_STARTING.equals(state) && !STATE_RUNNING.equals(state)) {
                return errorWithStatus("stress_not_active", "The stress session is not active");
            }
            state = STATE_STOPPING;
            stoppingGeneration = sessionGeneration;
            shouldClearLoad = loadApplied;
            if (!shouldClearLoad) {
                // 尚在权限阶段时本会话没有施加任何负载，不能误清理随后由 UI 启动的压力。
                state = STATE_STOPPED;
                finishedAt = System.currentTimeMillis();
                error = null;
            }
        }

        if (!shouldClearLoad) {
            return snapshot();
        }

        final PerformStressImpl stressController = resolveStressController();
        if (stressController == null) {
            markFailed(requestedSessionId, stoppingGeneration,
                    "Stress service is unavailable during cleanup");
            return snapshot();
        }
        try {
            BackgroundExecutor.execute(new Runnable() {
                @Override
                public void run() {
                    stopAndConfirm(requestedSessionId, stoppingGeneration, stressController);
                }
            });
        } catch (RuntimeException e) {
            LogUtil.e(TAG, "Unable to schedule stress cleanup", e);
            requestStressStop(stressController);
            markFailed(requestedSessionId, stoppingGeneration,
                    "Unable to schedule stress cleanup: " + safeMessage(e));
        }
        return snapshot();
    }

    private static int parseInt(String value, int defaultValue) throws NumberFormatException {
        return StringUtil.isEmpty(value) ? defaultValue : Integer.parseInt(value);
    }

    private static String configureAndMarkRunning(String expectedSessionId,
                                                  long expectedGeneration,
                                                  PerformStressImpl stressController,
                                                  int requestedCpuCount,
                                                  int requestedCpuPercent,
                                                  int requestedMemory) {
        synchronized (STATE_LOCK) {
            if (!isSessionInStateLocked(expectedSessionId, expectedGeneration,
                    STATE_STARTING)) {
                return null;
            }
            try {
                if (stressController.isLoadBlockedByMaintenance()) {
                    String reason = "Plugin maintenance started while stress permissions "
                            + "were pending";
                    state = STATE_FAILED;
                    error = reason;
                    finishedAt = System.currentTimeMillis();
                    return reason;
                }
                if (hasStressLoad(stressController)) {
                    String reason = "CPU or memory stress started outside this session "
                            + "while permissions were pending";
                    state = STATE_FAILED;
                    error = reason;
                    finishedAt = System.currentTimeMillis();
                    return reason;
                }
                // 从第一次写入服务开始即持有清理责任；并发 stop 会等本临界区结束。
                loadApplied = true;
                InjectorService injector = InjectorService.g();
                if (injector == null) {
                    throw new IllegalStateException("Injector service is unavailable");
                }
                injector.pushMessage(PerformStressImpl.PERFORMANCE_STRESS_CPU_PERCENT,
                        requestedCpuPercent);
                injector.pushMessage(PerformStressImpl.PERFORMANCE_STRESS_CPU_COUNT,
                        requestedCpuCount);
                injector.pushMessage(PerformStressImpl.PERFORMANCE_STRESS_MEMORY,
                        requestedMemory);

                String loadError = stressController.getLastLoadError();
                if (!StringUtil.isEmpty(loadError)) {
                    throw new IllegalStateException(loadError);
                }
                if (stressController.getTargetCpuCount() != requestedCpuCount
                        || stressController.getCpuPercent() != requestedCpuPercent
                        || stressController.getTargetMemoryMb() != requestedMemory
                        || stressController.getMemoryLoadMb() != requestedMemory) {
                    throw new IllegalStateException(
                            "Stress service did not apply the requested load");
                }
            } catch (RuntimeException e) {
                String reason = "Unable to start stress: " + safeMessage(e);
                LogUtil.e(TAG, reason, e);
                if (loadApplied) {
                    requestStressStop(stressController);
                }
                loadApplied = false;
                state = STATE_FAILED;
                error = reason;
                finishedAt = System.currentTimeMillis();
                return reason;
            }
            state = STATE_RUNNING;
            startedAt = System.currentTimeMillis();
            error = null;
            return null;
        }
    }

    private static void stopAndConfirm(String expectedSessionId, long expectedGeneration,
                                       PerformStressImpl stressController) {
        requestStressStop(stressController);
        long deadline = System.currentTimeMillis() + STOP_CONFIRM_TIMEOUT_MS;
        while (System.currentTimeMillis() < deadline) {
            if (!isSessionInState(expectedSessionId, expectedGeneration, STATE_STOPPING)) {
                return;
            }
            try {
                if (stressController.getTargetCpuCount() == 0
                        && stressController.getActiveCpuCount() == 0
                        && stressController.getTargetMemoryMb() == 0
                        && stressController.getMemoryLoadMb() == 0) {
                    markStopped(expectedSessionId, expectedGeneration);
                    return;
                }
            } catch (RuntimeException e) {
                LogUtil.w(TAG, "Unable to inspect stress cleanup state", e);
            }
            try {
                Thread.sleep(STOP_POLL_INTERVAL_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                requestStressStop(stressController);
                markFailed(expectedSessionId, expectedGeneration,
                        "Interrupted while waiting for stress cleanup");
                return;
            }
        }

        // 超时后再次把目标压到 0；即使线程尚未退出，也不能恢复压力目标。
        requestStressStop(stressController);
        markFailed(expectedSessionId, expectedGeneration,
                "Timed out waiting for CPU and memory stress cleanup");
    }

    private static void requestStressStop(PerformStressImpl stressController) {
        try {
            InjectorService injector = InjectorService.g();
            if (injector != null) {
                injector.pushMessage(PerformStressImpl.PERFORMANCE_STRESS_CPU_COUNT, 0);
                injector.pushMessage(PerformStressImpl.PERFORMANCE_STRESS_CPU_PERCENT, 0);
                injector.pushMessage(PerformStressImpl.PERFORMANCE_STRESS_MEMORY, 0);
            }
        } catch (RuntimeException e) {
            LogUtil.w(TAG, "Injector failed while clearing stress", e);
        }

        // Injector 内部会吞掉订阅方法异常，直接调用作为尽力清理兜底。
        if (stressController != null) {
            try {
                stressController.setTargetCount(0);
            } catch (RuntimeException e) {
                LogUtil.w(TAG, "Unable to clear CPU stress count", e);
            }
            try {
                stressController.setStress(0);
            } catch (RuntimeException e) {
                LogUtil.w(TAG, "Unable to clear CPU stress percent", e);
            }
            try {
                stressController.setMemory(0);
            } catch (RuntimeException e) {
                LogUtil.w(TAG, "Unable to clear memory stress", e);
            }
        }
    }

    private static void markStopped(String expectedSessionId, long expectedGeneration) {
        synchronized (STATE_LOCK) {
            if (!isSessionInStateLocked(expectedSessionId, expectedGeneration,
                    STATE_STOPPING)) {
                return;
            }
            state = STATE_STOPPED;
            finishedAt = System.currentTimeMillis();
            error = null;
            loadApplied = false;
        }
    }

    private static void failStartAndCleanup(String expectedSessionId,
                                            long expectedGeneration,
                                            PerformStressImpl stressController,
                                            String reason) {
        synchronized (STATE_LOCK) {
            if (!isSessionInStateLocked(expectedSessionId, expectedGeneration,
                    STATE_STARTING)) {
                return;
            }
            if (loadApplied) {
                requestStressStop(stressController);
                loadApplied = false;
            }
            state = STATE_FAILED;
            error = reason;
            finishedAt = System.currentTimeMillis();
        }
    }

    private static void markFailed(String expectedSessionId, long expectedGeneration,
                                   String reason) {
        synchronized (STATE_LOCK) {
            if (!StringUtil.equals(expectedSessionId, sessionId)
                    || expectedGeneration != sessionGeneration
                    || !isActive(state)) {
                return;
            }
            state = STATE_FAILED;
            error = reason;
            finishedAt = System.currentTimeMillis();
        }
    }

    private static boolean isSessionInState(String expectedSessionId,
                                            long expectedGeneration,
                                            String expectedState) {
        synchronized (STATE_LOCK) {
            return isSessionInStateLocked(expectedSessionId, expectedGeneration,
                    expectedState);
        }
    }

    private static boolean isSessionInStateLocked(String expectedSessionId,
                                                  long expectedGeneration,
                                                  String expectedState) {
        return StringUtil.equals(expectedSessionId, sessionId)
                && expectedGeneration == sessionGeneration
                && StringUtil.equals(expectedState, state);
    }

    private static PerformStressImpl resolveStressController() {
        try {
            PerformStressImpl controller = LauncherApplication.service(PerformStressImpl.class);
            if (controller != null) {
                // 触发懒加载并确认代理背后的服务实例可用。
                controller.getTargetCpuCount();
            }
            return controller;
        } catch (RuntimeException e) {
            LogUtil.e(TAG, "Unable to initialize stress service", e);
            return null;
        }
    }

    private static boolean hasStressLoad(PerformStressImpl stressController) {
        return stressController.getTargetCpuCount() != 0
                || stressController.getActiveCpuCount() != 0
                || stressController.getTargetMemoryMb() != 0
                || stressController.getMemoryLoadMb() != 0;
    }

    private static String safeMessage(RuntimeException exception) {
        return StringUtil.isEmpty(exception.getMessage())
                ? exception.getClass().getSimpleName() : exception.getMessage();
    }

    public static Map<String, Object> snapshot() {
        PerformStressImpl stressController = resolveStressController();
        Integer targetCpuCount = null;
        Integer activeCpuCount = null;
        Integer targetMemory = null;
        Integer memoryLoad = null;
        if (stressController != null) {
            try {
                targetCpuCount = stressController.getTargetCpuCount();
                activeCpuCount = stressController.getActiveCpuCount();
                targetMemory = stressController.getTargetMemoryMb();
                memoryLoad = stressController.getMemoryLoadMb();
            } catch (RuntimeException e) {
                LogUtil.w(TAG, "Unable to read stress service state", e);
            }
        }
        synchronized (STATE_LOCK) {
            Map<String, Object> result = success();
            result.put("kind", "stress");
            result.put("sessionId", sessionId);
            result.put("state", state);
            result.put("active", isActive(state));
            result.put("terminal", STATE_STOPPED.equals(state) || STATE_FAILED.equals(state));
            result.put("cpuCount", cpuCount);
            result.put("cpuPercent", cpuPercent);
            result.put("memory", memoryMb);
            result.put("targetCpuCount", targetCpuCount);
            result.put("activeCpuCount", activeCpuCount);
            result.put("targetMemoryMb", targetMemory);
            result.put("actualMemoryMb", memoryLoad);
            result.put("durationSec", durationSec);
            result.put("startedAt", startedAt == 0L ? null : startedAt);
            result.put("finishedAt", finishedAt == 0L ? null : finishedAt);
            result.put("error", error);
            return result;
        }
    }

    private static boolean isActive(String targetState) {
        return STATE_STARTING.equals(targetState)
                || STATE_RUNNING.equals(targetState)
                || STATE_STOPPING.equals(targetState);
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
        result.put("stress", snapshot());
        return result;
    }
}
