/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
package com.alipay.hulu.scheme;

import android.content.Context;
import android.graphics.Bitmap;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.serializer.SerializerFeature;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.scheme.AdbSchemeActivity;
import com.alipay.hulu.common.scheme.AdbAgentActivity;
import com.alipay.hulu.common.scheme.SchemeActionResolver;
import com.alipay.hulu.common.scheme.SchemeResolver;
import com.alipay.hulu.common.service.ScreenCaptureService;
import com.alipay.hulu.common.service.TouchService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.service.DeviceControlLease;
import com.alipay.hulu.shared.event.accessibility.AccessibilityUiEventClock;
import com.alipay.hulu.shared.node.OperationService;
import com.alipay.hulu.shared.node.action.OperationContext;
import com.alipay.hulu.shared.node.action.OperationExecutor;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;

import java.io.File;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** 绑定准确观察和会话所有者的动态 Agent observe/act 协议。 */
@SchemeResolver("agent")
public class AgentSessionSchemeResolver implements SchemeActionResolver {
    private static final String TAG = AgentSessionSchemeResolver.class.getSimpleName();
    private static final String PROTOCOL_VERSION = "1.0";
    private static final long ACTION_COMPLETION_TIMEOUT_MS = 10_000L;
    private static final long SETTLE_TIMEOUT_MS = 3_000L;
    private static final long SETTLE_INTERVAL_MS = 250L;
    private static final long ROOT_READY_TIMEOUT_MS = 5_000L;
    private static final long ROOT_READY_INTERVAL_MS = 100L;
    private static final long ROOT_TRANSITION_SETTLE_MS = 500L;

    private static final int DEFAULT_MAX_STEPS = 50;
    private static final long DEFAULT_MAX_DURATION_MS = 300_000L;
    private static final long DEFAULT_IDLE_TIMEOUT_MS = 30_000L;
    private static final int DEFAULT_MAX_REPEATED_ACTIONS = 3;
    private static final int DEFAULT_MAX_NO_PROGRESS_STEPS = 3;

    private static final AgentEvidenceStore EVIDENCE = new AgentEvidenceStore();
    private static final AgentSessionState SESSION = new AgentSessionState(
            new AgentSessionState.Clock() {
                @Override
                public long now() {
                    return System.currentTimeMillis();
                }
            },
            new AgentSessionState.Lease() {
                @Override
                public boolean acquire(String owner) {
                    return DeviceControlLease.tryAcquire(owner);
                }

                @Override
                public boolean isOwnedBy(String owner) {
                    return DeviceControlLease.isOwnedBy(owner);
                }

                @Override
                public boolean release(String owner) {
                    return DeviceControlLease.release(owner);
                }
            },
            new AgentSessionState.IdGenerator() {
                @Override
                public String next(String prefix) {
                    return prefix + "-" + UUID.randomUUID().toString();
                }
            }, EVIDENCE);

    private static final Object FRAME_LOCK = new Object();
    private static Frame currentFrame;
    private static final Object OPERATION_LOCK = new Object();
    private static ActiveOperation activeOperation;
    private static final Object TOUCH_LOCK = new Object();
    private static TouchService activeTouchService;
    private static long touchGeneration;

    @Override
    public boolean processScheme(Context context, Map<String, String> params,
                                 Callback<Map<String, Object>> callback) {
        String type = params.get("type");
        if (StringUtil.isEmpty(type)) {
            callback.onResult(error("missing_type", "Parameter 'type' is required"));
            return true;
        }
        try {
            switch (type) {
                case "capabilities":
                    callback.onResult(capabilities());
                    return true;
                case "start-status":
                    callback.onResult(startStatus(params.get("ownerToken")));
                    return true;
                case "status":
                    callback.onResult(status(params));
                    return true;
                case "observe":
                    callback.onResult(observe(context, params));
                    return true;
                case "receipt":
                    callback.onResult(receipt(params));
                    return true;
                case "timeline":
                    callback.onResult(timeline(params));
                    return true;
                case "start":
                    requireAdb(context);
                    callback.onResult(start(params));
                    return true;
                case "act":
                    requireAdb(context);
                    callback.onResult(scheduleAction(params));
                    return true;
                case "pause":
                    requireAdb(context);
                    callback.onResult(mutation(params, "pause"));
                    return true;
                case "resume":
                    requireAdb(context);
                    callback.onResult(mutation(params, "resume"));
                    return true;
                case "end":
                    requireAdb(context);
                    callback.onResult(mutation(params, "end"));
                    return true;
                case "cancel":
                    requireAdb(context);
                    callback.onResult(mutation(params, "cancel"));
                    return true;
                default:
                    callback.onResult(error("unsupported_type", "Unsupported Agent type: " + type));
                    return true;
            }
        } catch (AgentProtocolException e) {
            callback.onResult(error(e.code, e.getMessage()));
            return true;
        } catch (Throwable throwable) {
            LogUtil.e(TAG, "Dynamic Agent request failed", throwable);
            callback.onResult(error("agent_internal_error", "Dynamic Agent request failed"));
            return true;
        }
    }

    private Map<String, Object> capabilities() {
        Map<String, Object> result = success();
        result.put("protocolVersion", PROTOCOL_VERSION);
        result.put("queries", java.util.Arrays.asList(
                "capabilities", "start-status", "status", "observe", "receipt", "timeline"));
        result.put("commands", java.util.Arrays.asList(
                "start", "act", "pause", "resume", "end", "cancel"));
        result.put("actions", java.util.Arrays.asList(
                "click", "longClick", "input", "back", "home", "scroll", "wait"));
        result.put("arbitraryShell", false);
        result.put("mutationTransport", "adb-scheme");
        result.put("queryTransport", "adb-forward-http");
        result.put("settleStrategies", java.util.Arrays.asList(
                AgentUiWaiter.LEGACY, AgentUiWaiter.EVENT_STABLE_V1));
        result.put("defaultSettleStrategy", AgentUiWaiter.LEGACY);
        result.put("actionValidationStrategies", java.util.Arrays.asList(
                AgentTargetContextGuard.FULL_PAGE, AgentTargetContextGuard.TARGET_CONTEXT_V1));
        result.put("defaultActionValidationStrategy", AgentTargetContextGuard.FULL_PAGE);
        return result;
    }

    private Map<String, Object> start(final Map<String, String> params)
            throws AgentProtocolException {
        String ownerToken = require(params, "ownerToken");
        AgentSessionState.Config config = new AgentSessionState.Config(
                boundedInt(params, "maxSteps", DEFAULT_MAX_STEPS, 1, 200),
                boundedLong(params, "maxDurationMs", DEFAULT_MAX_DURATION_MS, 1_000L, 1_800_000L),
                boundedLong(params, "idleTimeoutMs", DEFAULT_IDLE_TIMEOUT_MS, 1_000L, 300_000L),
                boundedInt(params, "maxRepeatedActions", DEFAULT_MAX_REPEATED_ACTIONS, 1, 20),
                boundedInt(params, "maxNoProgressSteps", DEFAULT_MAX_NO_PROGRESS_STEPS, 1, 20),
                parseSettleStrategy(params.get("settleStrategy")),
                parseActionValidationStrategy(params.get("actionValidationStrategy")));
        final AgentSessionState.StartResult started = SESSION.start(ownerToken, config);
        if (!started.success) {
            return error(started.errorCode, started.error);
        }
        if (!startTouchService(started.generation)) {
            SESSION.fail(started.sessionId, started.ownerToken,
                    "touch_service_unavailable");
            return error("touch_service_unavailable",
                    "Touch service could not be started");
        }
        synchronized (FRAME_LOCK) {
            currentFrame = null;
        }
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    AgentSessionState.Result<AgentSessionState.Observation> captured =
                            captureAndRecord(started.sessionId, started.ownerToken, true);
                    if (!captured.success) {
                        SESSION.fail(started.sessionId, started.ownerToken,
                                captured.errorCode == null
                                        ? "initial_observation_failed" : captured.errorCode);
                        stopTouchService(started.generation);
                    }
                } catch (Throwable throwable) {
                    LogUtil.e(TAG, "Unable to capture initial Agent observation", throwable);
                    SESSION.fail(started.sessionId, started.ownerToken,
                            "initial_observation_failed");
                    stopTouchService(started.generation);
                }
            }
        });
        scheduleWatchdog(started.generation);
        Map<String, Object> result = success();
        result.put("accepted", true);
        result.put("session", started.session);
        return result;
    }

    private Map<String, Object> startStatus(String ownerToken) {
        AgentSessionState.Result<Map<String, Object>> status = SESSION.statusByOwner(ownerToken);
        if (!status.success) {
            return error(status.errorCode, status.error);
        }
        Map<String, Object> result = success();
        result.put("session", status.value);
        String sessionId = (String) status.value.get("sessionId");
        AgentSessionState.Result<AgentSessionState.Observation> observation =
                SESSION.currentObservation(sessionId, ownerToken);
        result.put("observation", observation.success ? observation.value.toMap() : null);
        result.put("timelinePath", EVIDENCE.timelinePath(sessionId));
        return result;
    }

    private Map<String, Object> status(Map<String, String> params) throws AgentProtocolException {
        AgentSessionState.Result<Map<String, Object>> status = SESSION.status(
                require(params, "sessionId"), require(params, "ownerToken"));
        if (!status.success) {
            return error(status.errorCode, status.error);
        }
        Map<String, Object> result = success();
        result.put("session", status.value);
        return result;
    }

    private Map<String, Object> observe(Context context, Map<String, String> params)
            throws AgentProtocolException {
        requireObservationPermissions(context);
        String sessionId = require(params, "sessionId");
        String ownerToken = require(params, "ownerToken");
        AgentSessionState.Result<Map<String, Object>> status = SESSION.status(sessionId, ownerToken);
        if (!status.success) {
            return error(status.errorCode, status.error);
        }
        AgentSessionState.Result<AgentSessionState.Observation> captured =
                captureAndRecord(sessionId, ownerToken, true);
        if (!captured.success) {
            return error(captured.errorCode, captured.error);
        }
        Map<String, Object> result = success();
        result.put("session", SESSION.snapshot());
        result.put("observation", captured.value.toMap());
        return result;
    }

    private Map<String, Object> receipt(Map<String, String> params) throws AgentProtocolException {
        AgentSessionState.Result<AgentSessionState.Receipt> receipt = SESSION.receipt(
                require(params, "sessionId"), require(params, "ownerToken"),
                require(params, "stepId"));
        if (!receipt.success) {
            return error(receipt.errorCode, receipt.error);
        }
        Map<String, Object> result = success();
        result.put("receipt", receipt.value.toMap());
        result.put("session", SESSION.snapshot());
        return result;
    }

    private Map<String, Object> timeline(Map<String, String> params) throws AgentProtocolException {
        String sessionId = require(params, "sessionId");
        AgentSessionState.Result<List<Map<String, Object>>> timeline = SESSION.timeline(
                sessionId, require(params, "ownerToken"));
        if (!timeline.success) {
            return error(timeline.errorCode, timeline.error);
        }
        Map<String, Object> result = success();
        result.put("events", timeline.value);
        result.put("timelinePath", EVIDENCE.timelinePath(sessionId));
        return result;
    }

    private Map<String, Object> scheduleAction(final Map<String, String> params)
            throws AgentProtocolException {
        final String sessionId = require(params, "sessionId");
        final String ownerToken = require(params, "ownerToken");
        final String stepId = require(params, "stepId");
        final String observationId = require(params, "observationId");
        final AgentSessionState.Action action = parseAction(params);
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                executeAction(sessionId, ownerToken, stepId, observationId, action);
            }
        });
        Map<String, Object> result = success();
        result.put("accepted", true);
        result.put("stepId", stepId);
        return result;
    }

    private void executeAction(final String sessionId, String ownerToken, String stepId,
                               String observationId, AgentSessionState.Action action) {
        long actionGeneration = 0L;
        OperationService service = LauncherApplication.service(OperationService.class);
        if (service == null) {
            failAcceptedAction(sessionId, ownerToken, stepId, observationId, action,
                    "Operation service is unavailable");
            return;
        }
        try {
            AgentSessionState.Config config = requireWorkConfig(sessionId, ownerToken);
            String settleStrategy = config.settleStrategy;
            boolean targetContext = AgentTargetContextGuard.TARGET_CONTEXT_V1.equals(config.actionValidationStrategy);
            AgentUiWaiter.Guard guard = workGuard(sessionId, ownerToken);
            Frame frame;
            synchronized (FRAME_LOCK) {
                frame = currentFrame;
            }
            AgentUiWaiter.Result<AbstractNodeTree> ready = loadControllableRoot(
                    service, ROOT_READY_TIMEOUT_MS, frame == null ? null : frame.packageName,
                    settleStrategy, guard);
            AbstractNodeTree freshRoot = ready.value;
            if (freshRoot == null) {
                failAcceptedAction(sessionId, ownerToken, stepId, observationId, action,
                        "Controllable foreground page root is unavailable");
                return;
            }
            JSONObject freshPage = freshRoot.exportToJsonObject();
            String currentSignature = signature(freshPage);
            AgentTargetContextGuard.Snapshot freshContext = targetContext
                    ? AgentTargetContextAndroid.capture(freshRoot, freshPage) : null;
            AgentTargetContextGuard.Verification validation = targetContext
                    ? AgentTargetContextGuard.verify(observationId,
                    frame != null && observationId.equals(frame.observationId) ? frame.targetContext : null,
                    freshContext, action) : null;
            AgentSessionState.BeginResult begin = SESSION.beginAction(sessionId, ownerToken,
                    stepId, observationId, currentSignature, action, freshPage, validation);
            if (!begin.accepted) {
                stopTouchServiceIfTerminal();
                return;
            }
            actionGeneration = begin.generation;
            final long acceptedGeneration = begin.generation;

            boolean nativeClick = validation != null && "verified".equals(validation.result);
            AbstractNodeTree target = nativeClick ? AgentTargetContextAndroid.at(freshRoot, validation.path)
                    : locateTarget(frame, observationId, action, freshRoot);
            OperationMethod method = operationMethod(action);
            final CountDownLatch completed = new CountDownLatch(1);
            guard.check();
            boolean dispatched;
            if (nativeClick) {
                dispatched = AgentTargetContextAndroid.click(freshRoot, freshContext, validation, guard);
                completed.countDown();
            } else {
                dispatched = service.doSomeAction(method, target,
                    new OperationContext.BaseOperationListener() {
                        @Override
                        public void onContextReceive(OperationContext context) {
                            synchronized (OPERATION_LOCK) {
                                activeOperation = new ActiveOperation(sessionId,
                                        acceptedGeneration, context);
                            }
                        }

                        @Override
                        public void notifyOperationFinish() {
                            completed.countDown();
                        }
                    });
            }
            if (!dispatched || !completed.await(ACTION_COMPLETION_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
                SESSION.finishAction(begin.generation, stepId, false,
                        dispatched ? "Action completion timed out" : nativeClick
                                ? "Native click rejected or live target/window changed before dispatch"
                                : "OperationService rejected the action",
                        null);
                return;
            }

            CapturedPage settled = settle(service, sessionId, currentSignature, settleStrategy, guard, targetContext);
            // This is observation feedback, never a business-verification result.
            settled.evidence.put("actionEffect", currentSignature.equals(settled.signature)
                    ? "NO_VISIBLE_CHANGE" : "UI_CHANGED");
            Map<String, Object> settleTiming = (Map<String, Object>) settled.evidence.get("settleTiming");
            settleTiming.put("preActionRootMs", ready.elapsedMs);
            settleTiming.put("preActionTreeSamples", ready.treeSamples);
            guard.check();
            AgentSessionState.Receipt receipt = SESSION.finishAction(begin.generation, stepId, true,
                    null, AgentSessionState.ObservationInput.of(settled.signature, settled.evidence));
            if (receipt != null && receipt.settledObservation != null) {
                synchronized (FRAME_LOCK) {
                    currentFrame = new Frame(receipt.settledObservation.observationId,
                            settled.signature, settled.packageName, settled.nodes, settled.targetContext);
                }
            }
        } catch (AgentUiWaiter.AbortedException aborted) {
            SESSION.finishAction(actionGeneration, stepId, false, "Agent UI work was cancelled", null);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            SESSION.finishAction(actionGeneration, stepId, false,
                    "Action execution was interrupted", null);
        } catch (Throwable throwable) {
            LogUtil.e(TAG, "Dynamic Agent action failed", throwable);
            SESSION.finishAction(actionGeneration, stepId, false,
                    "Action execution failed", null);
        } finally {
            clearActiveOperation(sessionId, actionGeneration);
            stopTouchServiceIfTerminal();
        }
    }

    private void failAcceptedAction(String sessionId, String ownerToken, String stepId,
                                    String observationId, AgentSessionState.Action action,
                                    String message) {
        Frame frame;
        synchronized (FRAME_LOCK) {
            frame = currentFrame;
        }
        String signature = frame == null ? null : frame.signature;
        AgentSessionState.BeginResult begin = SESSION.beginAction(sessionId, ownerToken,
                stepId, observationId, signature, action);
        if (begin.accepted) {
            SESSION.finishAction(begin.generation, stepId, false, message, null);
        }
    }

    private Map<String, Object> mutation(Map<String, String> params, String type)
            throws AgentProtocolException {
        String sessionId = require(params, "sessionId");
        String ownerToken = require(params, "ownerToken");
        AgentSessionState.Result<Map<String, Object>> mutation;
        if ("pause".equals(type)) {
            mutation = SESSION.pause(sessionId, ownerToken);
        } else if ("resume".equals(type)) {
            mutation = SESSION.resume(sessionId, ownerToken);
        } else if ("end".equals(type)) {
            mutation = SESSION.end(sessionId, ownerToken);
        } else {
            AgentSessionState.Result<Map<String, Object>> status = SESSION.status(
                    sessionId, ownerToken);
            if (!status.success) {
                return error(status.errorCode, status.error);
            }
            Object generation = status.value.get("generation");
            mutation = SESSION.cancel(sessionId, ownerToken);
            if (generation instanceof Number) {
                cancelActiveOperation(sessionId, ((Number) generation).longValue());
            }
        }
        if (!mutation.success) {
            return error(mutation.errorCode, mutation.error);
        }
        if ("end".equals(type) || "cancel".equals(type)) {
            Object generation = mutation.value.get("generation");
            if (generation instanceof Number) {
                stopTouchService(((Number) generation).longValue());
            }
            synchronized (FRAME_LOCK) {
                currentFrame = null;
            }
        }
        Map<String, Object> result = success();
        result.put("session", mutation.value);
        return result;
    }

    private static void requireAdb(Context context) throws AgentProtocolException {
        if (!(context instanceof AdbSchemeActivity) && !(context instanceof AdbAgentActivity)) {
            throw new AgentProtocolException("adb_required",
                    "Agent mutations require the DUMP-protected ADB scheme transport");
        }
    }

    private static void requireObservationPermissions(Context context) throws AgentProtocolException {
        if (!PermissionUtil.getPermissionStatus(context, "adb")
                || !PermissionUtil.getPermissionStatus(
                context, Settings.ACTION_ACCESSIBILITY_SETTINGS)) {
            throw new AgentProtocolException("observation_permission_required",
                    "ADB and accessibility permissions are required");
        }
    }

    private AgentSessionState.Result<AgentSessionState.Observation> captureAndRecord(
            String sessionId, String ownerToken, boolean screenshot) throws AgentProtocolException {
        AgentSessionState.Config config = requireWorkConfig(sessionId, ownerToken);
        String settleStrategy = config.settleStrategy;
        AgentUiWaiter.Guard guard = workGuard(sessionId, ownerToken);
        OperationService service = LauncherApplication.service(OperationService.class);
        if (service == null) {
            return AgentSessionState.Result.error("operation_service_unavailable",
                    "Operation service is unavailable");
        }
        AgentUiWaiter.Result<AbstractNodeTree> ready;
        try {
            ready = loadControllableRoot(service, ROOT_READY_TIMEOUT_MS, null, settleStrategy, guard);
        } catch (AgentUiWaiter.AbortedException aborted) {
            return AgentSessionState.Result.error("observation_cancelled", "Observation capture was cancelled");
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return AgentSessionState.Result.error("observation_interrupted",
                    "Observation capture was interrupted");
        }
        if (ready.value == null) {
            return AgentSessionState.Result.error("page_root_unavailable",
                    "Controllable foreground page root is unavailable");
        }
        CapturedPage captured = capturePage(ready.value, sessionId, screenshot,
                AgentTargetContextGuard.TARGET_CONTEXT_V1.equals(config.actionValidationStrategy));
        captured.evidence.put("settleTiming", settleTiming(settleStrategy, "root-ready", ready));
        requireWorkConfig(sessionId, ownerToken);
        AgentSessionState.Result<AgentSessionState.Observation> result = SESSION.recordObservation(
                sessionId, ownerToken, captured.signature, captured.evidence);
        if (result.success) {
            synchronized (FRAME_LOCK) {
                currentFrame = new Frame(result.value.observationId,
                        captured.signature, captured.packageName, captured.nodes, captured.targetContext);
            }
        }
        return result;
    }

    private CapturedPage settle(OperationService service, String sessionId, String baselineSignature,
                               String strategy, AgentUiWaiter.Guard guard, boolean targetContext)
            throws AgentProtocolException, InterruptedException {
        if (AgentUiWaiter.EVENT_STABLE_V1.equals(strategy)) {
            AgentUiWaiter.Result<AbstractNodeTree> result = stableRoot(
                    service, SETTLE_TIMEOUT_MS, null, baselineSignature, guard);
            if (result.value == null) {
                throw new AgentProtocolException("settle_failed", "UI stability could not be verified after action");
            }
            CapturedPage captured = capturePage(result.value, sessionId, true, targetContext);
            captured.evidence.put("settleTiming", settleTiming(strategy, "post-action", result));
            return captured;
        }
        long started = AccessibilityUiEventClock.monotonicMs();
        long deadline = started + SETTLE_TIMEOUT_MS;
        String previousSignature = null;
        AbstractNodeTree root = null;
        int samples = 0;
        boolean settled = false;
        while (AccessibilityUiEventClock.monotonicMs() < deadline) {
            guard.check();
            Thread.sleep(SETTLE_INTERVAL_MS);
            root = service.getBaseCurrentRootForAgent();
            samples++;
            guard.check();
            if (root == null) {
                continue;
            }
            JSONObject page = root.exportToJsonObject();
            if (!isControllableRoot(root, page, displayMetrics())) {
                root = null;
                continue;
            }
            String current = signature(page);
            if (hasSettled(baselineSignature, previousSignature, current)) {
                settled = true;
                break;
            }
            previousSignature = current;
        }
        if (root == null) {
            throw new AgentProtocolException("settle_failed", "No UI root was available after action");
        }
        AgentUiWaiter.Result<AbstractNodeTree> result = new AgentUiWaiter.Result<>(root,
                AccessibilityUiEventClock.monotonicMs() - started, samples, settled, !settled);
        CapturedPage captured = capturePage(root, sessionId, true, targetContext);
        captured.evidence.put("settleTiming", settleTiming(strategy, "post-action", result));
        return captured;
    }

    static boolean hasSettled(String baselineSignature, String previousSignature,
                              String currentSignature) {
        return currentSignature != null
                && !currentSignature.equals(baselineSignature)
                && currentSignature.equals(previousSignature);
    }

    private static AgentUiWaiter.Result<AbstractNodeTree> loadControllableRoot(
            OperationService service, long timeoutMs, String expectedPackage,
            String strategy, AgentUiWaiter.Guard guard)
            throws InterruptedException {
        if (AgentUiWaiter.EVENT_STABLE_V1.equals(strategy)) {
            return stableRoot(service, timeoutMs, expectedPackage, null, guard);
        }
        long started = AccessibilityUiEventClock.monotonicMs();
        long deadline = started + timeoutMs;
        int samples = 0;
        DisplayMetrics metrics = displayMetrics();
        do {
            guard.check();
            AbstractNodeTree root = service.getBaseCurrentRootForAgent();
            samples++;
            guard.check();
            if (root != null) {
                JSONObject page = root.exportToJsonObject();
                String packageName = page == null ? null : page.getString("packageName");
                if (isControllableRoot(root, page, metrics)
                        && (StringUtil.isEmpty(expectedPackage)
                        || expectedPackage.equals(packageName))) {
                    Thread.sleep(ROOT_TRANSITION_SETTLE_MS);
                    guard.check();
                    root = service.getBaseCurrentRootForAgent();
                    samples++;
                    guard.check();
                    page = root == null ? null : root.exportToJsonObject();
                    packageName = page == null ? null : page.getString("packageName");
                    if (isControllableRoot(root, page, metrics)
                            && (StringUtil.isEmpty(expectedPackage)
                            || expectedPackage.equals(packageName))) {
                        return new AgentUiWaiter.Result<>(root,
                                AccessibilityUiEventClock.monotonicMs() - started,
                                samples, true, false);
                    }
                }
            }
            Thread.sleep(ROOT_READY_INTERVAL_MS);
        } while (AccessibilityUiEventClock.monotonicMs() < deadline);
        return new AgentUiWaiter.Result<>(null, AccessibilityUiEventClock.monotonicMs() - started,
                samples, false, true);
    }

    static String parseSettleStrategy(String value) throws AgentProtocolException {
        String strategy = value == null ? AgentUiWaiter.LEGACY : value;
        if (!AgentUiWaiter.supports(strategy)) {
            throw new AgentProtocolException("invalid_settle_strategy", "Unsupported UI settle strategy");
        }
        return strategy;
    }

    static String parseActionValidationStrategy(String value) throws AgentProtocolException {
        String strategy = value == null ? AgentTargetContextGuard.FULL_PAGE : value;
        if (!AgentTargetContextGuard.supports(strategy)) {
            throw new AgentProtocolException("invalid_action_validation_strategy",
                    "Unsupported action validation strategy");
        }
        return strategy;
    }

    private static AgentSessionState.Config requireWorkConfig(String sessionId, String ownerToken)
            throws AgentProtocolException {
        AgentSessionState.Result<AgentSessionState.Config> result = SESSION.workConfig(sessionId, ownerToken);
        if (!result.success) {
            throw new AgentProtocolException(result.errorCode, result.error);
        }
        return result.value;
    }

    private static AgentUiWaiter.Guard workGuard(final String sessionId, final String ownerToken) {
        return new AgentUiWaiter.Guard() {
            @Override
            public void check() throws InterruptedException {
                if (Thread.currentThread().isInterrupted()) {
                    throw new InterruptedException("Agent UI wait interrupted");
                }
                // Code security: every fresh sample and the final dispatch retain exact owner/lease
                // binding; polling does not refresh idle deadlines or revive terminal sessions.
                if (!SESSION.workConfig(sessionId, ownerToken).success) {
                    throw new AgentUiWaiter.AbortedException();
                }
            }
        };
    }

    private static AgentUiWaiter.Result<AbstractNodeTree> stableRoot(
            final OperationService service, long timeoutMs, final String expectedPackage,
            String baselineSignature, AgentUiWaiter.Guard guard) throws InterruptedException {
        final DisplayMetrics metrics = displayMetrics();
        AgentUiWaiter<AbstractNodeTree> waiter = new AgentUiWaiter<>(new AgentUiWaiter.Clock() {
            @Override
            public long now() {
                return AccessibilityUiEventClock.monotonicMs();
            }

            @Override
            public void sleep(long durationMs) throws InterruptedException {
                Thread.sleep(durationMs);
            }
        }, new AgentUiWaiter.Reader<AbstractNodeTree>() {
            @Override
            public AgentUiWaiter.Sample<AbstractNodeTree> read() {
                AccessibilityUiEventClock.Snapshot before = AccessibilityUiEventClock.snapshot();
                AbstractNodeTree root = service.getBaseCurrentRootForAgent();
                JSONObject page = root == null ? null : root.exportToJsonObject();
                String packageName = page == null ? null : page.getString("packageName");
                boolean valid = isControllableRoot(root, page, metrics)
                        && (StringUtil.isEmpty(expectedPackage) || expectedPackage.equals(packageName));
                String pageSignature = valid ? signature(page) : null;
                AccessibilityUiEventClock.Snapshot after = AccessibilityUiEventClock.snapshot();
                return new AgentUiWaiter.Sample<>(valid ? root : null, pageSignature,
                        before.sequence, after.sequence, after.lastEventMs,
                        before.available && after.available);
            }
        }, guard);
        return baselineSignature == null ? waiter.await(timeoutMs, null)
                : waiter.awaitWithTransitionGrace(timeoutMs, 5_000L, baselineSignature);
    }

    private static Map<String, Object> settleTiming(String strategy, String phase,
                                                    AgentUiWaiter.Result<?> result) {
        Map<String, Object> timing = new LinkedHashMap<>();
        timing.put("strategy", strategy);
        timing.put("phase", phase);
        timing.put("elapsedMs", result.elapsedMs);
        timing.put("treeSamples", result.treeSamples);
        timing.put("settled", result.settled);
        timing.put("timedOut", result.timedOut);
        return timing;
    }

    static boolean isControllablePage(JSONObject page, DisplayMetrics metrics) {
        return isControllablePage(page, metrics,
                LauncherApplication.getContext().getPackageName());
    }

    private static boolean isControllableRoot(AbstractNodeTree root, JSONObject page,
                                              DisplayMetrics metrics) {
        return isControllablePage(page, metrics)
                || AgentTargetContextAndroid.isActiveApplicationRoot(root, page, metrics,
                LauncherApplication.getContext().getPackageName());
    }

    static boolean isControllablePage(JSONObject page, DisplayMetrics metrics,
                                      String controlPackage) {
        if (page == null || metrics == null) {
            return false;
        }
        String packageName = page.getString("packageName");
        if (StringUtil.isEmpty(packageName)
                || controlPackage.equals(packageName)) {
            return false;
        }
        JSONObject bounds = page.getJSONObject("nodeBound");
        if (bounds == null) {
            return false;
        }
        int width = bounds.getIntValue("right") - bounds.getIntValue("left");
        int height = bounds.getIntValue("bottom") - bounds.getIntValue("top");
        return width >= Math.max(1, metrics.widthPixels / 3)
                && height >= Math.max(1, metrics.heightPixels / 3);
    }

    private static DisplayMetrics displayMetrics() {
        DisplayMetrics metrics = new DisplayMetrics();
        WindowManager windowManager = (WindowManager) LauncherApplication.getInstance()
                .getSystemService(Context.WINDOW_SERVICE);
        windowManager.getDefaultDisplay().getRealMetrics(metrics);
        return metrics;
    }

    private CapturedPage capturePage(AbstractNodeTree root, String sessionId, boolean screenshot,
                                    boolean targetContext)
            throws AgentProtocolException {
        JSONObject page = root.exportToJsonObject();
        if (page == null) {
            throw new AgentProtocolException("page_export_failed", "Current page could not be exported");
        }
        String signature = signature(page);
        String packageName = page.getString("packageName");
        AgentTargetContextGuard.Snapshot context = targetContext
                ? AgentTargetContextAndroid.capture(root, page) : null;
        Map<String, int[]> nodes = new LinkedHashMap<>();
        assignNodeIds(root, page, nodes, new AtomicInteger(), new int[0]);

        Map<String, Object> evidence = new LinkedHashMap<>();
        evidence.put("treeSha256", signature);
        evidence.put("page", page);
        evidence.put("timelinePath", EVIDENCE.timelinePath(sessionId));
        if (screenshot) {
            evidence.putAll(captureScreenshot(sessionId));
        }
        return new CapturedPage(signature, packageName, evidence, nodes, context);
    }

    private Map<String, Object> captureScreenshot(String sessionId) {
        Map<String, Object> evidence = new LinkedHashMap<>();
        ScreenCaptureService captureService = LauncherApplication.service(ScreenCaptureService.class);
        if (captureService == null) {
            evidence.put("screenshotError", "screen_capture_service_unavailable");
            return evidence;
        }
        String name = "observation-" + UUID.randomUUID().toString() + ".png";
        File file = EVIDENCE.artifactFile(sessionId, name);
        Bitmap bitmap = null;
        try {
            DisplayMetrics metrics = displayMetrics();
            bitmap = captureService.captureScreen(file, metrics.widthPixels, metrics.heightPixels,
                    metrics.widthPixels, metrics.heightPixels);
            if (bitmap == null || !file.isFile()) {
                evidence.put("screenshotError", "screen_capture_failed");
                return evidence;
            }
            evidence.put("screenshotPath", file.getAbsolutePath());
            evidence.put("screenshotSha256", AgentEvidenceStore.sha256(file));
        } catch (Throwable throwable) {
            LogUtil.w(TAG, "Unable to capture Agent observation screenshot", throwable);
            evidence.put("screenshotError", "screen_capture_failed");
        } finally {
            if (bitmap != null && !bitmap.isRecycled()) {
                bitmap.recycle();
            }
        }
        return evidence;
    }

    private static void assignNodeIds(AbstractNodeTree node, JSONObject json,
                                      Map<String, int[]> nodes, AtomicInteger sequence, int[] path) {
        String nodeId = "node-" + sequence.incrementAndGet();
        json.put("nodeId", nodeId);
        nodes.put(nodeId, path.clone());
        List<AbstractNodeTree> children = node.getChildrenNodes();
        JSONArray childJson = json.getJSONArray("children");
        if (children == null || childJson == null) {
            return;
        }
        // Code security: never guess a path if export removed a child.
        if (children.size() != childJson.size()) {
            throw new IllegalArgumentException("Observation child mapping is incomplete");
        }
        int count = children.size();
        for (int index = 0; index < count; index++) {
            JSONObject current = childJson.getJSONObject(index);
            if (current != null) {
                int[] childPath = Arrays.copyOf(path, path.length + 1);
                childPath[path.length] = index;
                assignNodeIds(children.get(index), current, nodes, sequence, childPath);
            }
        }
    }

    private static AbstractNodeTree locateTarget(Frame frame, String observationId,
                                                 AgentSessionState.Action action,
                                                 AbstractNodeTree root)
            throws AgentProtocolException {
        Object rawNodeId = action.arguments.get("nodeId");
        if (rawNodeId == null) {
            return null;
        }
        if (frame == null || !observationId.equals(frame.observationId)) {
            throw new AgentProtocolException("stale_observation", "Observation frame is unavailable");
        }
        // Code security: beginAction has verified owner, observation and the complete
        // fresh page signature. Bind its exact path; replay's fuzzy locator can choose
        // a different same-labelled node even when the complete page is unchanged.
        AbstractNodeTree target = locateFrameTarget(root, frame.nodes, rawNodeId.toString());
        if (target == null) {
            throw new AgentProtocolException("node_not_found", "Observed node no longer exists");
        }
        return target;
    }

    static AbstractNodeTree locateFrameTarget(AbstractNodeTree root, Map<String, int[]> nodes,
                                               String nodeId) {
        int[] path = nodes.get(nodeId);
        return path == null ? null : AgentTargetContextAndroid.at(root, path);
    }

    private static OperationMethod operationMethod(AgentSessionState.Action action)
            throws AgentProtocolException {
        PerformActionEnum actionEnum;
        if ("click".equals(action.type)) {
            actionEnum = PerformActionEnum.CLICK;
        } else if ("longClick".equals(action.type)) {
            actionEnum = PerformActionEnum.LONG_CLICK;
        } else if ("input".equals(action.type)) {
            actionEnum = PerformActionEnum.INPUT;
        } else if ("back".equals(action.type)) {
            actionEnum = PerformActionEnum.BACK;
        } else if ("home".equals(action.type)) {
            actionEnum = PerformActionEnum.HOME;
        } else if ("wait".equals(action.type)) {
            actionEnum = PerformActionEnum.SLEEP;
        } else if ("scroll".equals(action.type)) {
            String direction = String.valueOf(action.arguments.get("direction"));
            boolean global = !action.arguments.containsKey("nodeId");
            actionEnum = scrollAction(direction, global);
        } else {
            throw new AgentProtocolException("unsupported_action", "Unsupported typed action");
        }
        OperationMethod method = new OperationMethod(actionEnum);
        method.setEncrypt(false);
        if (action.arguments.containsKey("text")) {
            method.putParam(OperationExecutor.INPUT_TEXT_KEY,
                    String.valueOf(action.arguments.get("text")));
        }
        if (action.arguments.containsKey("durationMs")) {
            method.putParam(OperationExecutor.INPUT_TEXT_KEY,
                    String.valueOf(action.arguments.get("durationMs")));
        }
        if (action.arguments.containsKey("distance")) {
            method.putParam(OperationExecutor.SCROLL_DISTANCE,
                    String.valueOf(action.arguments.get("distance")));
        }
        return method;
    }

    private static PerformActionEnum scrollAction(String direction, boolean global)
            throws AgentProtocolException {
        if ("down".equals(direction)) {
            return global ? PerformActionEnum.GLOBAL_SCROLL_TO_BOTTOM
                    : PerformActionEnum.SCROLL_TO_BOTTOM;
        }
        if ("up".equals(direction)) {
            return global ? PerformActionEnum.GLOBAL_SCROLL_TO_TOP
                    : PerformActionEnum.SCROLL_TO_TOP;
        }
        if ("right".equals(direction)) {
            return global ? PerformActionEnum.GLOBAL_SCROLL_TO_RIGHT
                    : PerformActionEnum.SCROLL_TO_RIGHT;
        }
        if ("left".equals(direction)) {
            return global ? PerformActionEnum.GLOBAL_SCROLL_TO_LEFT
                    : PerformActionEnum.SCROLL_TO_LEFT;
        }
        throw new AgentProtocolException("invalid_action", "Invalid scroll direction");
    }

    private static AgentSessionState.Action parseAction(Map<String, String> params)
            throws AgentProtocolException {
        String type = require(params, "action");
        Map<String, Object> arguments = new LinkedHashMap<>();
        putIfPresent(params, arguments, "nodeId");
        putIfPresent(params, arguments, "text");
        putIfPresent(params, arguments, "direction");
        putLongIfPresent(params, arguments, "durationMs");
        putLongIfPresent(params, arguments, "distance");
        return AgentSessionState.Action.of(type, arguments);
    }

    private static void putIfPresent(Map<String, String> params, Map<String, Object> target,
                                     String key) {
        if (params.containsKey(key)) {
            target.put(key, params.get(key));
        }
    }

    private static void putLongIfPresent(Map<String, String> params, Map<String, Object> target,
                                         String key) throws AgentProtocolException {
        if (!params.containsKey(key)) {
            return;
        }
        try {
            target.put(key, Long.parseLong(params.get(key)));
        } catch (NumberFormatException e) {
            throw new AgentProtocolException("invalid_action", key + " must be an integer");
        }
    }

    static String signature(JSONObject page) {
        return AgentEvidenceStore.sha256(
                JSON.toJSONString(pageForSignature(page), SerializerFeature.MapSortField));
    }

    private static JSONObject pageForSignature(JSONObject page) {
        if (page == null) {
            return null;
        }
        JSONObject semanticPage = new JSONObject(page.size());
        boolean accessibilityNode = "AccessibilityNodeTree".equals(page.getString("type"));
        for (Map.Entry<String, Object> field : page.entrySet()) {
            // Code security: only Accessibility's transient source ID is nonsemantic.
            // Preserve every other field and ordered child; never mutate raw evidence.
            if (accessibilityNode && "id".equals(field.getKey())) {
                continue;
            }
            if ("children".equals(field.getKey()) && field.getValue() instanceof List) {
                JSONArray children = new JSONArray();
                for (Object child : (List<?>) field.getValue()) {
                    children.add(child instanceof JSONObject
                            ? pageForSignature((JSONObject) child) : child);
                }
                semanticPage.put(field.getKey(), children);
            } else {
                semanticPage.put(field.getKey(), field.getValue());
            }
        }
        return semanticPage;
    }

    private static String require(Map<String, String> params, String key)
            throws AgentProtocolException {
        String value = params.get(key);
        if (StringUtil.isEmpty(value)) {
            throw new AgentProtocolException("missing_parameter", "Parameter '" + key + "' is required");
        }
        return value;
    }

    private static int boundedInt(Map<String, String> params, String key, int defaultValue,
                                  int minimum, int maximum) throws AgentProtocolException {
        long value = boundedLong(params, key, defaultValue, minimum, maximum);
        return (int) value;
    }

    private static long boundedLong(Map<String, String> params, String key, long defaultValue,
                                    long minimum, long maximum) throws AgentProtocolException {
        if (!params.containsKey(key)) {
            return defaultValue;
        }
        try {
            long value = Long.parseLong(params.get(key));
            if (value < minimum || value > maximum) {
                throw new NumberFormatException();
            }
            return value;
        } catch (NumberFormatException e) {
            throw new AgentProtocolException("invalid_parameter",
                    key + " must be between " + minimum + " and " + maximum);
        }
    }

    private static void scheduleWatchdog(final long generation) {
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                Map<String, Object> snapshot = SESSION.snapshot();
                Object currentGeneration = snapshot.get("generation");
                if (!(currentGeneration instanceof Number)
                        || ((Number) currentGeneration).longValue() != generation
                        || Boolean.TRUE.equals(snapshot.get("terminal"))) {
                    return;
                }
                boolean expired = SESSION.checkTimeouts();
                if (expired) {
                    cancelActiveOperation(null, generation);
                    stopTouchService(generation);
                }
                snapshot = SESSION.snapshot();
                if (!Boolean.TRUE.equals(snapshot.get("terminal"))) {
                    scheduleWatchdog(generation);
                }
            }
        }, 1_000);
    }

    private static void cancelActiveOperation(String sessionId, long generation) {
        OperationContext context = null;
        synchronized (OPERATION_LOCK) {
            if (activeOperation != null
                    && activeOperation.generation == generation
                    && (sessionId == null || sessionId.equals(activeOperation.sessionId))) {
                context = activeOperation.context;
                activeOperation = null;
            }
        }
        if (context != null) {
            context.cancelRunning();
        }
    }

    private static void clearActiveOperation(String sessionId, long generation) {
        synchronized (OPERATION_LOCK) {
            if (activeOperation != null
                    && activeOperation.generation == generation
                    && sessionId.equals(activeOperation.sessionId)) {
                activeOperation = null;
            }
        }
    }

    private static boolean startTouchService(long generation) {
        TouchService service = LauncherApplication.service(TouchService.class);
        if (service == null) {
            return false;
        }
        try {
            service.start();
            synchronized (TOUCH_LOCK) {
                activeTouchService = service;
                touchGeneration = generation;
            }
            return true;
        } catch (Throwable throwable) {
            LogUtil.e(TAG, "Unable to start Agent touch service", throwable);
            return false;
        }
    }

    private static void stopTouchServiceIfTerminal() {
        Map<String, Object> snapshot = SESSION.snapshot();
        if (Boolean.TRUE.equals(snapshot.get("terminal"))) {
            Object generation = snapshot.get("generation");
            if (generation instanceof Number) {
                stopTouchService(((Number) generation).longValue());
            }
        }
    }

    private static void stopTouchService(long generation) {
        TouchService service;
        synchronized (TOUCH_LOCK) {
            if (activeTouchService == null || touchGeneration != generation) {
                return;
            }
            service = activeTouchService;
            activeTouchService = null;
            touchGeneration = 0L;
        }
        try {
            service.stop();
        } catch (Throwable throwable) {
            LogUtil.w(TAG, "Unable to stop Agent touch service", throwable);
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

    private static final class Frame {
        final String observationId;
        final String signature;
        final String packageName;
        final Map<String, int[]> nodes;
        final AgentTargetContextGuard.Snapshot targetContext;

        Frame(String observationId, String signature, String packageName,
              Map<String, int[]> nodes, AgentTargetContextGuard.Snapshot targetContext) {
            this.observationId = observationId;
            this.signature = signature;
            this.packageName = packageName;
            this.nodes = Collections.unmodifiableMap(new LinkedHashMap<>(nodes));
            this.targetContext = targetContext;
        }
    }

    private static final class CapturedPage {
        final String signature;
        final String packageName;
        final Map<String, Object> evidence;
        final Map<String, int[]> nodes;
        final AgentTargetContextGuard.Snapshot targetContext;

        CapturedPage(String signature, String packageName, Map<String, Object> evidence,
                     Map<String, int[]> nodes, AgentTargetContextGuard.Snapshot targetContext) {
            this.signature = signature;
            this.packageName = packageName;
            this.evidence = evidence;
            this.nodes = nodes;
            this.targetContext = targetContext;
        }
    }

    private static final class ActiveOperation {
        final String sessionId;
        final long generation;
        final OperationContext context;

        ActiveOperation(String sessionId, long generation, OperationContext context) {
            this.sessionId = sessionId;
            this.generation = generation;
            this.context = context;
        }
    }

    private static final class AgentProtocolException extends Exception {
        final String code;

        AgentProtocolException(String code, String message) {
            super(message);
            this.code = code;
        }
    }
}
