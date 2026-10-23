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

import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.service.ReplaySessionLease;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Process-local, machine-readable state for the latest replay.
 */
public final class HarnessState {
    public static final String STATE_IDLE = "idle";
    public static final String STATE_RUNNING = "running";
    public static final String STATE_CANCEL_REQUESTED = "cancel_requested";
    public static final String STATE_PASSED = "passed";
    public static final String STATE_FAILED = "failed";
    public static final String STATE_CANCELLED = "cancelled";

    private static String runId;
    private static String requestId;
    private static String caseName;
    private static String state = STATE_IDLE;
    private static String error;
    private static long startedAt;
    private static long finishedAt;
    private static List<Map<String, Object>> results = Collections.emptyList();
    private static String replayLeaseOwner;

    private HarnessState() {
    }

    public static synchronized boolean isActive() {
        return STATE_RUNNING.equals(state) || STATE_CANCEL_REQUESTED.equals(state);
    }

    public static synchronized String start(String targetCaseName, String targetRequestId) {
        if (isActive()) {
            return null;
        }
        runId = System.currentTimeMillis() + "-" + UUID.randomUUID().toString();
        requestId = targetRequestId;
        caseName = targetCaseName;
        String requestedOwner = ReplaySessionLease.newOwner("harness");
        if (!ReplaySessionLease.tryAcquire(requestedOwner)) {
            state = STATE_FAILED;
            error = "Another replay or plugin maintenance prevents replay from starting";
            startedAt = 0L;
            finishedAt = System.currentTimeMillis();
            results = Collections.emptyList();
            replayLeaseOwner = null;
            return null;
        }
        replayLeaseOwner = requestedOwner;
        state = STATE_RUNNING;
        error = null;
        startedAt = System.currentTimeMillis();
        finishedAt = 0L;
        results = Collections.emptyList();
        return runId;
    }

    public static synchronized void failToStart(String expectedRunId, String reason) {
        if (expectedRunId == null || !expectedRunId.equals(runId) || !isActive()) {
            return;
        }
        state = STATE_FAILED;
        error = reason;
        finishedAt = System.currentTimeMillis();
        releaseReplayLeaseLocked();
    }

    public static synchronized void failActive(String expectedRunId, String reason) {
        if (!isActive(expectedRunId)) {
            return;
        }
        state = STATE_FAILED;
        error = reason;
        finishedAt = System.currentTimeMillis();
        releaseReplayLeaseLocked();
    }

    public static synchronized boolean isActive(String expectedRunId) {
        return expectedRunId != null && expectedRunId.equals(runId) && isActive();
    }

    public static synchronized boolean isRunning(String expectedRunId) {
        return expectedRunId != null
                && expectedRunId.equals(runId)
                && STATE_RUNNING.equals(state);
    }

    public static synchronized String getReplayLeaseOwner(String expectedRunId) {
        if (!isActive(expectedRunId)
                || !ReplaySessionLease.isOwnedBy(replayLeaseOwner)) {
            return null;
        }
        return replayLeaseOwner;
    }

    public static synchronized void failByReplayLeaseOwner(String expectedOwner, String reason) {
        if (expectedOwner == null || !expectedOwner.equals(replayLeaseOwner) || !isActive()) {
            return;
        }
        if (STATE_CANCEL_REQUESTED.equals(state)) {
            state = STATE_CANCELLED;
            error = null;
        } else {
            state = STATE_FAILED;
            error = reason;
        }
        finishedAt = System.currentTimeMillis();
        releaseReplayLeaseLocked();
    }

    public static synchronized boolean requestCancel(String expectedRunId) {
        if (!isRunning(expectedRunId)) {
            return false;
        }
        state = STATE_CANCEL_REQUESTED;
        return true;
    }

    public static synchronized void finishCancellation(String expectedRunId) {
        if (expectedRunId == null
                || !expectedRunId.equals(runId)
                || !STATE_CANCEL_REQUESTED.equals(state)) {
            return;
        }
        state = STATE_CANCELLED;
        error = null;
        finishedAt = System.currentTimeMillis();
        releaseReplayLeaseLocked();
    }

    /** manager 在执行前完成取消；租约由 manager 清理结束后释放。 */
    public static synchronized void cancelByReplayLeaseOwner(String expectedOwner) {
        if (expectedOwner == null || !expectedOwner.equals(replayLeaseOwner)
                || !STATE_CANCEL_REQUESTED.equals(state)) {
            return;
        }
        state = STATE_CANCELLED;
        error = null;
        results = Collections.emptyList();
        finishedAt = System.currentTimeMillis();
        replayLeaseOwner = null;
    }

    public static synchronized void complete(List<ReplayResultBean> resultBeans) {
        long now = System.currentTimeMillis();
        if (!isActive()) {
            runId = now + "-ui-" + UUID.randomUUID().toString();
            requestId = null;
            caseName = null;
            state = STATE_RUNNING;
            error = null;
            finishedAt = 0L;
            results = Collections.emptyList();
            if (resultBeans != null && !resultBeans.isEmpty()) {
                ReplayResultBean first = resultBeans.get(0);
                caseName = first.getCaseName();
                startedAt = first.getStartTime() == null ? now : first.getStartTime().getTime();
            } else {
                startedAt = now;
            }
        }

        List<Map<String, Object>> summaries = new ArrayList<>();
        int failedCount = 0;
        if (resultBeans != null) {
            for (ReplayResultBean resultBean : resultBeans) {
                if (resultBean == null) {
                    continue;
                }
                Map<String, Object> summary = summarize(resultBean);
                summaries.add(summary);
                if (resultBean.getExceptionMessage() != null) {
                    failedCount++;
                }
            }
        }

        results = summaries;
        finishedAt = now;
        if (STATE_CANCEL_REQUESTED.equals(state)) {
            state = STATE_CANCELLED;
        } else if (summaries.isEmpty()) {
            state = STATE_FAILED;
            error = "Replay finished without a result";
        } else if (failedCount > 0) {
            state = STATE_FAILED;
            error = failedCount + " replay result(s) failed";
        } else {
            state = STATE_PASSED;
            error = null;
        }
        // CaseReplayManager 持有同一唯一 owner，并在所有清理完成后释放租约。
        replayLeaseOwner = null;
    }

    public static synchronized Map<String, Object> snapshot() {
        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("success", true);
        snapshot.put("runId", runId);
        snapshot.put("requestId", requestId);
        snapshot.put("caseName", caseName);
        snapshot.put("state", state);
        snapshot.put("active", isActive());
        snapshot.put("terminal", isTerminal(state));
        snapshot.put("startedAt", startedAt == 0L ? null : startedAt);
        snapshot.put("finishedAt", finishedAt == 0L ? null : finishedAt);
        snapshot.put("durationMs", startedAt == 0L ? null
                : (finishedAt == 0L ? System.currentTimeMillis() : finishedAt) - startedAt);
        snapshot.put("error", error);
        snapshot.put("results", new ArrayList<>(results));
        return snapshot;
    }

    private static boolean isTerminal(String targetState) {
        return STATE_PASSED.equals(targetState)
                || STATE_FAILED.equals(targetState)
                || STATE_CANCELLED.equals(targetState);
    }

    private static void releaseReplayLeaseLocked() {
        String owner = replayLeaseOwner;
        replayLeaseOwner = null;
        ReplaySessionLease.release(owner);
    }

    private static Map<String, Object> summarize(ReplayResultBean resultBean) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("caseName", resultBean.getCaseName());
        summary.put("status", resultBean.getExceptionMessage() == null ? STATE_PASSED : STATE_FAILED);
        summary.put("targetApp", resultBean.getTargetApp());
        summary.put("targetAppPackage", resultBean.getTargetAppPkg());
        summary.put("targetAppVersion", resultBean.getTargetAppVersion());
        summary.put("startTime", resultBean.getStartTime() == null ? null : resultBean.getStartTime().getTime());
        summary.put("endTime", resultBean.getEndTime() == null ? null : resultBean.getEndTime().getTime());
        summary.put("exceptionMessage", resultBean.getExceptionMessage());
        summary.put("exceptionStep", resultBean.getExceptionStep());
        summary.put("exceptionStepId", resultBean.getExceptionStepId());
        summary.put("logFile", resultBean.getLogFile());
        summary.put("screenshotFiles", resultBean.getScreenshotFiles());
        summary.put("platform", resultBean.getPlatform());
        summary.put("platformVersion", resultBean.getPlatformVersion());
        return summary;
    }
}
