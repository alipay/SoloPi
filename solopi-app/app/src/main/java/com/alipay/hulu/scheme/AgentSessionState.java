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

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/** 单个独占式动态 Agent 设备会话的纯 Java 状态机。 */
public final class AgentSessionState {
    public static final String STATE_IDLE = "idle";
    public static final String STATE_ACTIVE = "active";
    public static final String STATE_PAUSED = "paused";
    public static final String STATE_ACTING = "acting";
    public static final String STATE_ENDED = "ended";
    public static final String STATE_CANCELLED = "cancelled";
    public static final String STATE_FAILED = "failed";
    public static final String STATE_EXPIRED = "expired";

    private static final Set<String> ALLOWED_ACTIONS = Collections.unmodifiableSet(
            new java.util.HashSet<>(Arrays.asList(
                    "click", "longClick", "input", "back", "home", "scroll", "wait")));

    private final Clock clock;
    private final Lease lease;
    private final IdGenerator ids;
    private final EventSink eventSink;

    private String sessionId;
    private String ownerToken;
    private String leaseOwner;
    private long generation;
    private String state = STATE_IDLE;
    private String terminalReason;
    private long startedAt;
    private long lastActivityAt;
    private long finishedAt;
    private Config config;
    private Observation currentObservation;
    private boolean observationConsumed;
    private int acceptedStepCount;
    private int noProgressCount;
    private String lastActionSignature;
    private int repeatedActionCount;
    private long eventSequence;
    private final Map<String, Receipt> receipts = new LinkedHashMap<>();
    private final List<Map<String, Object>> events = new ArrayList<>();

    public AgentSessionState(Clock clock, Lease lease, IdGenerator ids, EventSink eventSink) {
        if (clock == null || lease == null || ids == null) {
            throw new IllegalArgumentException("Clock, lease, and id generator are required");
        }
        this.clock = clock;
        this.lease = lease;
        this.ids = ids;
        this.eventSink = eventSink;
    }

    public synchronized StartResult start(String requestedOwnerToken, Config requestedConfig) {
        if (isLive(state)) {
            return StartResult.error("session_conflict", "A dynamic Agent session is already active");
        }
        if (requestedOwnerToken == null || requestedOwnerToken.length() < 16) {
            return StartResult.error("invalid_owner_token", "ownerToken must contain at least 16 characters");
        }
        if (requestedConfig == null) {
            return StartResult.error("invalid_config", "Session bounds are required");
        }

        String requestedSessionId = ids.next("agent-session");
        String requestedLeaseOwner = ids.next("agent-lease");
        if (!lease.acquire(requestedLeaseOwner)) {
            return StartResult.error("lease_conflict",
                    "Another replay, Agent session, or maintenance task controls the device");
        }

        sessionId = requestedSessionId;
        ownerToken = requestedOwnerToken;
        leaseOwner = requestedLeaseOwner;
        generation++;
        state = STATE_ACTIVE;
        terminalReason = null;
        startedAt = clock.now();
        lastActivityAt = startedAt;
        finishedAt = 0L;
        config = requestedConfig;
        currentObservation = null;
        observationConsumed = false;
        acceptedStepCount = 0;
        noProgressCount = 0;
        lastActionSignature = null;
        repeatedActionCount = 0;
        eventSequence = 0L;
        receipts.clear();
        events.clear();
        appendEvent("session_started", null, null, null);
        return StartResult.success(sessionId, ownerToken, leaseOwner, generation, snapshotLocked());
    }

    public synchronized Result<Observation> recordObservation(String expectedSessionId,
                                                               String expectedOwnerToken,
                                                               String signature,
                                                               Map<String, Object> evidence) {
        Result<Object> access = requireAccess(expectedSessionId, expectedOwnerToken, true);
        if (!access.success) {
            return Result.error(access.errorCode, access.error);
        }
        if (STATE_ACTING.equals(state)) {
            return Result.error("session_busy", "An action is still executing");
        }
        if (signature == null || signature.length() == 0) {
            return Result.error("invalid_observation", "Observation signature is required");
        }
        touch();
        currentObservation = new Observation(ids.next("observation"), signature, clock.now(), evidence);
        observationConsumed = false;
        appendEvent("observation_created", null, currentObservation.observationId,
                currentObservation.toMap());
        return Result.success(currentObservation);
    }

    public synchronized BeginResult beginAction(String expectedSessionId,
                                                String expectedOwnerToken,
                                                String stepId,
                                                String observationId,
                                                String currentSignature,
                                                Action action) {
        Result<Object> identity = requireIdentity(expectedSessionId, expectedOwnerToken);
        if (!identity.success) {
            return BeginResult.rejected(rejectedReceipt(stepId, observationId, action,
                    identity.errorCode, identity.error), false);
        }

        Receipt existing = receipts.get(stepId);
        if (existing != null) {
            return BeginResult.rejected(existing, true);
        }
        if (isLive(state)) {
            checkTimeoutsLocked();
        }
        if (stepId == null || stepId.length() == 0) {
            return BeginResult.rejected(rejectedReceipt(stepId, observationId, action,
                    "invalid_step_id", "stepId is required"), false);
        }
        if (STATE_PAUSED.equals(state)) {
            return rememberRejection(stepId, observationId, action,
                    "session_paused", "Resume the session before acting");
        }
        if (STATE_ACTING.equals(state)) {
            return rememberRejection(stepId, observationId, action,
                    "session_busy", "Another action is still executing");
        }
        if (!STATE_ACTIVE.equals(state)) {
            return rememberRejection(stepId, observationId, action,
                    "terminal_session", "The session is no longer active");
        }
        if (action == null || !ALLOWED_ACTIONS.contains(action.type)) {
            return rememberRejection(stepId, observationId, action,
                    "unsupported_action", "Only phase-one typed actions are allowed");
        }
        String validationError = action.validationError();
        if (validationError != null) {
            return rememberRejection(stepId, observationId, action,
                    "invalid_action", validationError);
        }
        if (currentObservation == null || observationConsumed
                || observationId == null
                || !observationId.equals(currentObservation.observationId)
                || currentSignature == null
                || !currentSignature.equals(currentObservation.signature)) {
            return rememberRejection(stepId, observationId, action,
                    "stale_observation", "The action must reference the current unchanged observation");
        }
        if (acceptedStepCount >= config.maxSteps) {
            Receipt rejected = rejectedReceipt(stepId, observationId, action,
                    "step_budget_exhausted", "The session step budget is exhausted");
            receipts.put(stepId, rejected);
            appendEvent("action_rejected", stepId, observationId, rejected.toMap());
            terminate(STATE_FAILED, "step_budget_exhausted");
            return BeginResult.rejected(rejected, false);
        }

        String actionSignature = action.signature();
        int nextRepeatedCount = actionSignature.equals(lastActionSignature)
                ? repeatedActionCount + 1 : 1;
        if (nextRepeatedCount > config.maxRepeatedActions) {
            Receipt rejected = rejectedReceipt(stepId, observationId, action,
                    "loop_detected", "Repeated action limit reached");
            receipts.put(stepId, rejected);
            appendEvent("action_rejected", stepId, observationId, rejected.toMap());
            terminate(STATE_FAILED, "loop_detected");
            return BeginResult.rejected(rejected, false);
        }

        touch();
        observationConsumed = true;
        acceptedStepCount++;
        lastActionSignature = actionSignature;
        repeatedActionCount = nextRepeatedCount;
        state = STATE_ACTING;
        Receipt accepted = Receipt.accepted(stepId, observationId, action, clock.now())
                .withSourceSignature(currentObservation.signature);
        receipts.put(stepId, accepted);
        appendEvent("action_accepted", stepId, observationId, accepted.toMap());
        return BeginResult.accepted(accepted, generation);
    }

    public synchronized Receipt finishAction(long expectedGeneration, String stepId,
                                             boolean performed, String error,
                                             ObservationInput settledInput) {
        if (expectedGeneration != generation || !STATE_ACTING.equals(state)) {
            return null;
        }
        Receipt accepted = receipts.get(stepId);
        if (accepted == null || !"accepted".equals(accepted.status)) {
            return null;
        }

        touch();
        if (!performed || settledInput == null || settledInput.signature == null) {
            Receipt failed = accepted.finish("failed", null, "action_failed",
                    error == null ? "The device action or settle failed" : error, clock.now());
            receipts.put(stepId, failed);
            appendEvent("action_failed", stepId, accepted.observationId, failed.toMap());
            terminate(STATE_FAILED, "action_failed");
            return failed;
        }

        Observation settled = new Observation(ids.next("observation"), settledInput.signature,
                clock.now(), settledInput.evidence);
        currentObservation = settled;
        observationConsumed = false;
        state = STATE_ACTIVE;
        noProgressCount = settled.signature.equals(accepted.sourceSignature)
                ? noProgressCount + 1 : 0;
        Receipt succeeded = accepted.finish("succeeded", settled, null, null, clock.now());
        receipts.put(stepId, succeeded);
        appendEvent("action_settled", stepId, accepted.observationId, succeeded.toMap());
        if (noProgressCount >= config.maxNoProgressSteps) {
            terminate(STATE_FAILED, "no_progress_loop_detected");
        }
        return succeeded;
    }

    public synchronized Result<Map<String, Object>> pause(String expectedSessionId,
                                                           String expectedOwnerToken) {
        Result<Object> access = requireAccess(expectedSessionId, expectedOwnerToken, false);
        if (!access.success) {
            return Result.error(access.errorCode, access.error);
        }
        if (!STATE_ACTIVE.equals(state)) {
            return Result.error(STATE_PAUSED.equals(state) ? "already_paused" : "session_busy",
                    STATE_PAUSED.equals(state) ? "The session is already paused"
                            : "The session cannot pause while an action is executing");
        }
        touch();
        state = STATE_PAUSED;
        appendEvent("session_paused", null, observationId(), null);
        return Result.success(snapshotLocked());
    }

    public synchronized Result<Map<String, Object>> resume(String expectedSessionId,
                                                            String expectedOwnerToken) {
        Result<Object> access = requireAccess(expectedSessionId, expectedOwnerToken, false);
        if (!access.success) {
            return Result.error(access.errorCode, access.error);
        }
        if (!STATE_PAUSED.equals(state)) {
            return Result.error("not_paused", "The session is not paused");
        }
        touch();
        state = STATE_ACTIVE;
        appendEvent("session_resumed", null, observationId(), null);
        return Result.success(snapshotLocked());
    }

    public synchronized Result<Map<String, Object>> end(String expectedSessionId,
                                                         String expectedOwnerToken) {
        Result<Object> access = requireAccess(expectedSessionId, expectedOwnerToken, false);
        if (!access.success) {
            return Result.error(access.errorCode, access.error);
        }
        if (STATE_ACTING.equals(state)) {
            return Result.error("session_busy", "Cancel the session while an action is executing");
        }
        terminate(STATE_ENDED, "client_end");
        return Result.success(snapshotLocked());
    }

    public synchronized Result<Map<String, Object>> cancel(String expectedSessionId,
                                                            String expectedOwnerToken) {
        Result<Object> access = requireAccess(expectedSessionId, expectedOwnerToken, false);
        if (!access.success) {
            return Result.error(access.errorCode, access.error);
        }
        terminate(STATE_CANCELLED, "client_cancel");
        return Result.success(snapshotLocked());
    }

    public synchronized Result<Map<String, Object>> status(String expectedSessionId,
                                                            String expectedOwnerToken) {
        Result<Object> access = requireIdentity(expectedSessionId, expectedOwnerToken);
        if (!access.success) {
            return Result.error(access.errorCode, access.error);
        }
        if (isLive(state)) {
            checkTimeoutsLocked();
            if (isLive(state)) {
                touch();
            }
        }
        return Result.success(snapshotLocked());
    }

    public synchronized Result<Receipt> receipt(String expectedSessionId,
                                                String expectedOwnerToken, String stepId) {
        Result<Object> access = requireIdentity(expectedSessionId, expectedOwnerToken);
        if (!access.success) {
            return Result.error(access.errorCode, access.error);
        }
        Receipt receipt = receipts.get(stepId);
        return receipt == null
                ? Result.<Receipt>error("receipt_not_found", "No receipt exists for stepId")
                : Result.success(receipt);
    }

    public synchronized Result<Observation> currentObservation(String expectedSessionId,
                                                                String expectedOwnerToken) {
        Result<Object> access = requireIdentity(expectedSessionId, expectedOwnerToken);
        if (!access.success) {
            return Result.error(access.errorCode, access.error);
        }
        return currentObservation == null
                ? Result.<Observation>error("observation_not_found", "No observation is available")
                : Result.success(currentObservation);
    }

    public synchronized Result<Map<String, Object>> statusByOwner(String expectedOwnerToken) {
        if (sessionId == null || expectedOwnerToken == null
                || !expectedOwnerToken.equals(ownerToken)) {
            return Result.error("session_not_found", "No session belongs to ownerToken");
        }
        if (isLive(state)) {
            checkTimeoutsLocked();
        }
        return Result.success(snapshotLocked());
    }

    public synchronized Result<Map<String, Object>> fail(String expectedSessionId,
                                                          String expectedOwnerToken,
                                                          String reason) {
        Result<Object> access = requireAccess(expectedSessionId, expectedOwnerToken, false);
        if (!access.success) {
            return Result.error(access.errorCode, access.error);
        }
        terminate(STATE_FAILED, reason == null ? "session_failed" : reason);
        return Result.success(snapshotLocked());
    }

    public synchronized Result<List<Map<String, Object>>> timeline(String expectedSessionId,
                                                                   String expectedOwnerToken) {
        Result<Object> access = requireIdentity(expectedSessionId, expectedOwnerToken);
        if (!access.success) {
            return Result.error(access.errorCode, access.error);
        }
        List<Map<String, Object>> copy = new ArrayList<>(events.size());
        for (Map<String, Object> event : events) {
            copy.add(new LinkedHashMap<>(event));
        }
        return Result.success(copy);
    }

    public synchronized boolean checkTimeouts() {
        return checkTimeoutsLocked();
    }

    public synchronized Map<String, Object> snapshot() {
        return snapshotLocked();
    }

    public synchronized int getAcceptedStepCount() {
        return acceptedStepCount;
    }

    private Result<Object> requireAccess(String expectedSessionId, String expectedOwnerToken,
                                         boolean allowPaused) {
        Result<Object> identity = requireIdentity(expectedSessionId, expectedOwnerToken);
        if (!identity.success) {
            return identity;
        }
        if (isLive(state) && checkTimeoutsLocked()) {
            return Result.error("session_expired", "The session exceeded its configured deadline");
        }
        if (!isLive(state)) {
            return Result.error("terminal_session", "The session is already terminal");
        }
        if (!allowPaused && STATE_PAUSED.equals(state)) {
            // 所有权检查完成后，由 beginAction 返回更精确的类型化拒绝原因。
            return Result.success(null);
        }
        return Result.success(null);
    }

    private Result<Object> requireIdentity(String expectedSessionId, String expectedOwnerToken) {
        if (sessionId == null || expectedSessionId == null || !expectedSessionId.equals(sessionId)) {
            return Result.error("session_not_found", "sessionId does not identify the current session");
        }
        if (expectedOwnerToken == null || !expectedOwnerToken.equals(ownerToken)) {
            return Result.error("owner_mismatch", "ownerToken does not own this session");
        }
        return Result.success(null);
    }

    private BeginResult rememberRejection(String stepId, String observationId, Action action,
                                          String code, String message) {
        Receipt rejected = rejectedReceipt(stepId, observationId, action, code, message);
        if (stepId != null && stepId.length() > 0) {
            receipts.put(stepId, rejected);
        }
        appendEvent("action_rejected", stepId, observationId, rejected.toMap());
        return BeginResult.rejected(rejected, false);
    }

    private Receipt rejectedReceipt(String stepId, String observationId, Action action,
                                    String code, String message) {
        return Receipt.rejected(stepId, observationId, action, code, message, clock.now(),
                currentObservation == null ? null : currentObservation.signature);
    }

    private boolean checkTimeoutsLocked() {
        if (!isLive(state) || config == null) {
            return false;
        }
        long now = clock.now();
        if (now - startedAt >= config.maxDurationMs) {
            terminate(STATE_EXPIRED, "max_duration_exceeded");
            return true;
        }
        if (now - lastActivityAt >= config.idleTimeoutMs) {
            terminate(STATE_EXPIRED, "idle_timeout");
            return true;
        }
        return false;
    }

    private void terminate(String terminalState, String reason) {
        if (!isLive(state)) {
            return;
        }
        state = terminalState;
        terminalReason = reason;
        finishedAt = clock.now();
        appendEvent("session_terminal", null, observationId(), singleton("reason", reason));
        String owner = leaseOwner;
        leaseOwner = null;
        boolean released = lease.release(owner);
        appendEvent("lease_released", null, observationId(), singleton("released", released));
    }

    private void touch() {
        lastActivityAt = clock.now();
    }

    private String observationId() {
        return currentObservation == null ? null : currentObservation.observationId;
    }

    private void appendEvent(String type, String stepId, String observationId,
                             Map<String, Object> details) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("sequence", ++eventSequence);
        event.put("timestamp", clock.now());
        event.put("type", type);
        event.put("sessionId", sessionId);
        event.put("generation", generation);
        event.put("stepId", stepId);
        event.put("observationId", observationId);
        if (details != null && !details.isEmpty()) {
            event.put("details", new LinkedHashMap<>(details));
        }
        events.add(event);
        if (eventSink != null) {
            eventSink.append(new LinkedHashMap<>(event));
        }
    }

    private Map<String, Object> snapshotLocked() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        result.put("sessionId", sessionId);
        result.put("generation", generation == 0L ? null : generation);
        result.put("state", state);
        result.put("active", isLive(state));
        result.put("terminal", isTerminal(state));
        result.put("terminalReason", terminalReason);
        result.put("startedAt", startedAt == 0L ? null : startedAt);
        result.put("lastActivityAt", lastActivityAt == 0L ? null : lastActivityAt);
        result.put("finishedAt", finishedAt == 0L ? null : finishedAt);
        result.put("acceptedSteps", acceptedStepCount);
        result.put("maxSteps", config == null ? null : config.maxSteps);
        result.put("observationId", observationId());
        result.put("leaseHeld", leaseOwner != null && lease.isOwnedBy(leaseOwner));
        return result;
    }

    private static boolean isLive(String value) {
        return STATE_ACTIVE.equals(value) || STATE_PAUSED.equals(value) || STATE_ACTING.equals(value);
    }

    private static boolean isTerminal(String value) {
        return STATE_ENDED.equals(value) || STATE_CANCELLED.equals(value)
                || STATE_FAILED.equals(value) || STATE_EXPIRED.equals(value);
    }

    private static Map<String, Object> singleton(String key, Object value) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put(key, value);
        return result;
    }

    public interface Clock {
        long now();
    }

    public interface Lease {
        boolean acquire(String owner);

        boolean isOwnedBy(String owner);

        boolean release(String owner);
    }

    public interface IdGenerator {
        String next(String prefix);
    }

    public interface EventSink {
        void append(Map<String, Object> event);
    }

    public static final class Config {
        public final int maxSteps;
        public final long maxDurationMs;
        public final long idleTimeoutMs;
        public final int maxRepeatedActions;
        public final int maxNoProgressSteps;

        public Config(int maxSteps, long maxDurationMs, long idleTimeoutMs,
                      int maxRepeatedActions, int maxNoProgressSteps) {
            if (maxSteps <= 0 || maxDurationMs <= 0L || idleTimeoutMs <= 0L
                    || maxRepeatedActions <= 0 || maxNoProgressSteps <= 0) {
                throw new IllegalArgumentException("All Agent session bounds must be positive");
            }
            this.maxSteps = maxSteps;
            this.maxDurationMs = maxDurationMs;
            this.idleTimeoutMs = idleTimeoutMs;
            this.maxRepeatedActions = maxRepeatedActions;
            this.maxNoProgressSteps = maxNoProgressSteps;
        }
    }

    public static final class ObservationInput {
        public final String signature;
        public final Map<String, Object> evidence;

        private ObservationInput(String signature, Map<String, Object> evidence) {
            this.signature = signature;
            this.evidence = evidence == null ? Collections.<String, Object>emptyMap()
                    : new LinkedHashMap<>(evidence);
        }

        public static ObservationInput of(String signature, Map<String, Object> evidence) {
            return new ObservationInput(signature, evidence);
        }
    }

    public static final class Observation {
        public final String observationId;
        public final String signature;
        public final long createdAt;
        public final Map<String, Object> evidence;

        private Observation(String observationId, String signature, long createdAt,
                            Map<String, Object> evidence) {
            this.observationId = observationId;
            this.signature = signature;
            this.createdAt = createdAt;
            this.evidence = evidence == null ? Collections.<String, Object>emptyMap()
                    : Collections.unmodifiableMap(new LinkedHashMap<>(evidence));
        }

        public Map<String, Object> toMap() {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("observationId", observationId);
            result.put("signature", signature);
            result.put("createdAt", createdAt);
            result.putAll(evidence);
            return result;
        }
    }

    public static final class Action {
        public final String type;
        public final Map<String, Object> arguments;

        private Action(String type, Map<String, Object> arguments) {
            this.type = type;
            this.arguments = arguments == null ? Collections.<String, Object>emptyMap()
                    : Collections.unmodifiableMap(new LinkedHashMap<>(arguments));
        }

        public static Action of(String type, Map<String, Object> arguments) {
            return new Action(type, arguments);
        }

        String signature() {
            return type + ":" + new TreeMap<>(arguments).toString();
        }

        String validationError() {
            Set<String> allowedFields = new java.util.HashSet<>();
            if ("click".equals(type)) {
                allowedFields.add("nodeId");
                if (!nonEmptyString(arguments.get("nodeId"))) {
                    return "click requires nodeId";
                }
            } else if ("longClick".equals(type)) {
                allowedFields.add("nodeId");
                allowedFields.add("durationMs");
                if (!nonEmptyString(arguments.get("nodeId"))) {
                    return "longClick requires nodeId";
                }
                if (arguments.containsKey("durationMs")
                        && !numberInRange(arguments.get("durationMs"), 100L, 5000L)) {
                    return "durationMs must be between 100 and 5000";
                }
            } else if ("input".equals(type)) {
                allowedFields.add("nodeId");
                allowedFields.add("text");
                if (!nonEmptyString(arguments.get("nodeId")) || !(arguments.get("text") instanceof String)) {
                    return "input requires nodeId and string text";
                }
            } else if ("scroll".equals(type)) {
                allowedFields.add("nodeId");
                allowedFields.add("direction");
                allowedFields.add("distance");
                Object direction = arguments.get("direction");
                if (!(direction instanceof String) || !Arrays.asList(
                        "up", "down", "left", "right").contains(direction)) {
                    return "scroll direction must be up, down, left, or right";
                }
                if (arguments.containsKey("nodeId") && !nonEmptyString(arguments.get("nodeId"))) {
                    return "nodeId must be a non-empty string";
                }
                if (arguments.containsKey("distance")
                        && !numberInRange(arguments.get("distance"), 1L, 90L)) {
                    return "distance must be between 1 and 90";
                }
            } else if ("wait".equals(type)) {
                allowedFields.add("durationMs");
                if (!numberInRange(arguments.get("durationMs"), 100L, 5000L)) {
                    return "wait requires durationMs between 100 and 5000";
                }
            }
            for (String key : arguments.keySet()) {
                if (!allowedFields.contains(key)) {
                    return "Unexpected action field: " + key;
                }
            }
            return null;
        }

        private static boolean nonEmptyString(Object value) {
            return value instanceof String && ((String) value).length() > 0;
        }

        private static boolean numberInRange(Object value, long minimum, long maximum) {
            if (!(value instanceof Number)) {
                return false;
            }
            long number = ((Number) value).longValue();
            return number >= minimum && number <= maximum;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("type", type);
            result.put("arguments", new LinkedHashMap<>(arguments));
            return result;
        }
    }

    public static final class Receipt {
        public final String stepId;
        public final String observationId;
        public final Action action;
        public final String status;
        public final String errorCode;
        public final String error;
        public final long acceptedAt;
        public final long finishedAt;
        public final Observation settledObservation;
        private final String sourceSignature;

        private Receipt(String stepId, String observationId, Action action, String status,
                        String errorCode, String error, long acceptedAt, long finishedAt,
                        Observation settledObservation, String sourceSignature) {
            this.stepId = stepId;
            this.observationId = observationId;
            this.action = action;
            this.status = status;
            this.errorCode = errorCode;
            this.error = error;
            this.acceptedAt = acceptedAt;
            this.finishedAt = finishedAt;
            this.settledObservation = settledObservation;
            this.sourceSignature = sourceSignature;
        }

        static Receipt accepted(String stepId, String observationId, Action action, long now) {
            return new Receipt(stepId, observationId, action, "accepted", null, null,
                    now, 0L, null, null);
        }

        static Receipt rejected(String stepId, String observationId, Action action,
                                String code, String error, long now, String sourceSignature) {
            return new Receipt(stepId, observationId, action, "rejected", code, error,
                    now, now, null, sourceSignature);
        }

        Receipt finish(String finalStatus, Observation observation, String code,
                       String finalError, long now) {
            return new Receipt(stepId, observationId, action, finalStatus, code, finalError,
                    acceptedAt, now, observation, sourceSignature);
        }

        Receipt withSourceSignature(String signature) {
            return new Receipt(stepId, observationId, action, status, errorCode, error,
                    acceptedAt, finishedAt, settledObservation, signature);
        }

        public Map<String, Object> toMap() {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("stepId", stepId);
            result.put("observationId", observationId);
            result.put("action", action == null ? null : action.toMap());
            result.put("status", status);
            result.put("errorCode", errorCode);
            result.put("error", error);
            result.put("acceptedAt", acceptedAt);
            result.put("finishedAt", finishedAt == 0L ? null : finishedAt);
            result.put("settledObservation", settledObservation == null
                    ? null : settledObservation.toMap());
            return result;
        }
    }

    public static class Result<T> {
        public final boolean success;
        public final T value;
        public final String errorCode;
        public final String error;

        private Result(boolean success, T value, String errorCode, String error) {
            this.success = success;
            this.value = value;
            this.errorCode = errorCode;
            this.error = error;
        }

        public static <T> Result<T> success(T value) {
            return new Result<>(true, value, null, null);
        }

        public static <T> Result<T> error(String code, String error) {
            return new Result<>(false, null, code, error);
        }
    }

    public static final class StartResult {
        public final boolean success;
        public final String sessionId;
        public final String ownerToken;
        public final String leaseOwner;
        public final long generation;
        public final Map<String, Object> session;
        public final String errorCode;
        public final String error;

        private StartResult(boolean success, String sessionId, String ownerToken,
                            String leaseOwner, long generation, Map<String, Object> session,
                            String errorCode, String error) {
            this.success = success;
            this.sessionId = sessionId;
            this.ownerToken = ownerToken;
            this.leaseOwner = leaseOwner;
            this.generation = generation;
            this.session = session;
            this.errorCode = errorCode;
            this.error = error;
        }

        static StartResult success(String sessionId, String ownerToken, String leaseOwner,
                                   long generation, Map<String, Object> session) {
            return new StartResult(true, sessionId, ownerToken, leaseOwner, generation,
                    session, null, null);
        }

        static StartResult error(String code, String error) {
            return new StartResult(false, null, null, null, 0L, null, code, error);
        }
    }

    public static final class BeginResult {
        public final boolean accepted;
        public final boolean duplicate;
        public final Receipt receipt;
        public final long generation;

        private BeginResult(boolean accepted, boolean duplicate, Receipt receipt, long generation) {
            this.accepted = accepted;
            this.duplicate = duplicate;
            this.receipt = receipt;
            this.generation = generation;
        }

        static BeginResult accepted(Receipt receipt, long generation) {
            return new BeginResult(true, false, receipt, generation);
        }

        static BeginResult rejected(Receipt receipt, boolean duplicate) {
            return new BeginResult(false, duplicate, receipt, 0L);
        }
    }
}
