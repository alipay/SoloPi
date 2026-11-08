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

import org.junit.Test;
import static org.junit.Assert.*;

public class StarPromptPolicyTest {
    private StarPromptPolicy due() {
        StarPromptPolicy p = new StarPromptPolicy(StarPromptPolicy.FIRST_MS, 0, 0, false);
        p.resume(0);
        return p;
    }

    @Test public void waitsThirtyMinutesThenQuietPeriod() {
        StarPromptPolicy p = new StarPromptPolicy(0, 0, 0, false);
        p.resume(0);
        assertFalse(p.eligible(1799999, true, false));
        assertFalse(p.eligible(1800000, true, false));
        assertFalse(p.eligible(1802999, true, false));
        assertTrue(p.eligible(1803000, true, false));
    }

    @Test public void excludesBackgroundAndDoesNotResetOnDuplicateResume() {
        StarPromptPolicy p = new StarPromptPolicy(0, 0, 0, false);
        p.resume(0); p.resume(100); p.pause(500);
        p.checkpoint(10000);
        assertEquals(500, p.usedMs);
        p.resume(20000); p.pause(20500);
        assertEquals(1000, p.usedMs);
    }

    @Test public void interactionRestartsQuietPeriod() {
        StarPromptPolicy p = due();
        assertFalse(p.eligible(0, true, false));
        p.interrupt();
        assertFalse(p.eligible(3000, true, false));
        assertTrue(p.eligible(6000, true, false));
    }

    @Test public void unsafePageCannotPrompt() {
        StarPromptPolicy p = due();
        assertFalse(p.eligible(0, true, false));
        assertFalse(p.eligible(4000, false, false));
        assertFalse(p.eligible(5000, true, false));
        assertTrue(p.eligible(8000, true, false));
    }

    @Test public void taskRequiresCooldownAndQuietPeriod() {
        StarPromptPolicy p = due();
        assertFalse(p.eligible(0, true, true));
        assertFalse(p.eligible(119999, true, false));
        assertFalse(p.eligible(120000, true, false));
        assertTrue(p.eligible(123000, true, false));
    }

    @Test public void laterNeedsFiveMoreHoursAndNewProcess() {
        StarPromptPolicy p = due();
        p.shown();
        assertFalse(p.eligible(StarPromptPolicy.AGAIN_MS, true, false));
        StarPromptPolicy restored = new StarPromptPolicy(p.usedMs - 1, p.shows, p.askedAtMs, false);
        restored.resume(0);
        assertFalse(restored.eligible(0, true, false));
        assertFalse(restored.eligible(1, true, false));
        assertTrue(restored.eligible(3001, true, false));
        restored.shown();
        assertTrue(restored.over());
        assertTrue(new StarPromptPolicy(restored.usedMs, 2, restored.askedAtMs, false).over());
    }

    @Test public void optOutSurvivesRestart() {
        StarPromptPolicy p = due(); p.finish();
        StarPromptPolicy restored = new StarPromptPolicy(p.usedMs, p.shows, p.askedAtMs, p.finished);
        restored.resume(0);
        assertFalse(restored.eligible(99999999, true, false));
        assertTrue(restored.over());
    }

    @Test(expected = IllegalArgumentException.class) public void rejectsCorruptRecord() {
        new StarPromptPolicy(10, 1, 20, false);
    }

    @Test public void counterDoesNotOverflow() {
        StarPromptPolicy p = new StarPromptPolicy(Long.MAX_VALUE - 10, 0, 0, false);
        p.resume(0); p.pause(100);
        assertEquals(Long.MAX_VALUE, p.usedMs);
    }
}
