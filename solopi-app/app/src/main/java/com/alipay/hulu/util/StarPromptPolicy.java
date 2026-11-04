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
package com.alipay.hulu.util;

/** Local-only invitation policy, independent of Android and wall-clock time. */
public final class StarPromptPolicy {
    public static final long FIRST_MS = 30 * 60 * 1000L;
    public static final long AGAIN_MS = 5 * 60 * 60 * 1000L;
    public static final long QUIET_MS = 3000L;
    public static final long TASK_COOLDOWN_MS = 2 * 60 * 1000L;
    long usedMs;
    int shows;
    long askedAtMs;
    boolean finished;
    private long since = -1;
    private long quietSince = -1;
    private long busyUntil;
    private boolean shownThisProcess;

    public StarPromptPolicy(long usedMs, int shows, long askedAtMs, boolean finished) {
        if (usedMs < 0 || shows < 0 || shows > 2 || askedAtMs < 0 || askedAtMs > usedMs) {
            throw new IllegalArgumentException("Invalid invitation record");
        }
        this.usedMs = usedMs;
        this.shows = shows;
        this.askedAtMs = askedAtMs;
        this.finished = finished;
    }

    public boolean over() { return finished || shows >= 2; }

    public void resume(long now) {
        if (since < 0 && !over()) since = now;
    }

    public void checkpoint(long now) {
        if (since < 0) return;
        long elapsed = Math.max(0, now - since);
        if (!over()) usedMs = usedMs > Long.MAX_VALUE - elapsed ? Long.MAX_VALUE : usedMs + elapsed;
        since = now;
    }

    public void pause(long now) {
        checkpoint(now);
        since = -1;
        interrupt();
    }

    public void interrupt() { quietSince = -1; }

    public boolean eligible(long now, boolean safeHome, boolean taskActive) {
        checkpoint(now);
        if (taskActive) busyUntil = now + TASK_COOLDOWN_MS;
        boolean due = shows == 0 ? usedMs >= FIRST_MS : usedMs - askedAtMs >= AGAIN_MS;
        if (over() || shownThisProcess || since < 0 || !due || !safeHome || taskActive || now < busyUntil) {
            interrupt();
            return false;
        }
        if (quietSince < 0) quietSince = now;
        return now - quietSince >= QUIET_MS;
    }

    public void shown() {
        shows = Math.min(2, shows + 1);
        askedAtMs = usedMs;
        shownThisProcess = true;
        interrupt();
    }

    public void finish() { finished = true; interrupt(); }
}
