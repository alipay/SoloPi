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
package com.alipay.hulu.screenRecord;

import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 保存近期录屏 owner 的独立结果，避免后续会话覆盖前一会话的终态。
 */
final class ScreenRecorderSessionState {
    private static final int DEFAULT_HISTORY_LIMIT = 64;

    private final int historyLimit;
    private final LinkedHashMap<String, SessionResult> sessions = new LinkedHashMap<>();

    ScreenRecorderSessionState() {
        this(DEFAULT_HISTORY_LIMIT);
    }

    ScreenRecorderSessionState(int historyLimit) {
        if (historyLimit < 1) {
            throw new IllegalArgumentException("History limit must be positive");
        }
        this.historyLimit = historyLimit;
    }

    synchronized void start(String owner) {
        requireOwner(owner);
        sessions.remove(owner);
        sessions.put(owner, new SessionResult());
        trimHistory();
    }

    synchronized void updateStartTime(String owner, long startTime) {
        SessionResult result = sessions.get(owner);
        if (result != null && !result.completed) {
            result.startTime = startTime;
        }
    }

    synchronized void updateError(String owner, String error) {
        SessionResult result = sessions.get(owner);
        if (result != null && !result.completed) {
            result.error = error;
        }
    }

    synchronized void reject(String owner, String error) {
        requireOwner(owner);
        SessionResult result = sessions.get(owner);
        if (result != null && !result.completed) {
            return;
        }
        complete(owner, 0L, error);
    }

    synchronized void complete(String owner, long startTime, String error) {
        requireOwner(owner);
        SessionResult result = sessions.get(owner);
        if (result == null) {
            result = new SessionResult();
        } else {
            // 终态按完成时间保留，防止刚结束的 owner 被下一次启动立即淘汰。
            sessions.remove(owner);
        }
        sessions.put(owner, result);
        result.startTime = startTime;
        result.error = error;
        result.completed = true;
        trimHistory();
    }

    synchronized boolean isCompleted(String owner) {
        SessionResult result = sessions.get(owner);
        return result != null && result.completed;
    }

    synchronized long getStartTime(String owner) {
        SessionResult result = sessions.get(owner);
        return result == null ? 0L : result.startTime;
    }

    synchronized String getError(String owner) {
        SessionResult result = sessions.get(owner);
        return result == null ? null : result.error;
    }

    synchronized int size() {
        return sessions.size();
    }

    private void trimHistory() {
        if (sessions.size() <= historyLimit) {
            return;
        }
        Iterator<Map.Entry<String, SessionResult>> iterator = sessions.entrySet().iterator();
        while (sessions.size() > historyLimit && iterator.hasNext()) {
            Map.Entry<String, SessionResult> entry = iterator.next();
            if (entry.getValue().completed) {
                iterator.remove();
            }
        }
    }

    private static void requireOwner(String owner) {
        if (owner == null || owner.length() == 0) {
            throw new IllegalArgumentException("Screen recorder owner is required");
        }
    }

    private static final class SessionResult {
        private boolean completed;
        private long startTime;
        private String error;
    }
}
