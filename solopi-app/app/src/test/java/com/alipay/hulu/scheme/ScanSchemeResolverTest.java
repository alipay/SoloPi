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

import org.junit.Test;

import java.util.Arrays;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class ScanSchemeResolverTest {
    @Test
    public void activeAndTerminalStatesAreDisjoint() {
        for (String state : Arrays.asList("starting", "pending-camera-permission", "scanning")) {
            assertTrue(ScanSchemeResolver.isActive(state));
            assertFalse(ScanSchemeResolver.isTerminal(state));
        }
        for (String state : Arrays.asList("completed", "cancelled", "failed")) {
            assertFalse(ScanSchemeResolver.isActive(state));
            assertTrue(ScanSchemeResolver.isTerminal(state));
        }
        assertFalse(ScanSchemeResolver.isActive("idle"));
        assertFalse(ScanSchemeResolver.isTerminal("idle"));
    }

    @Test
    public void sessionIdsAreStrictAndBounded() {
        assertTrue(ScanSchemeResolver.isValidSessionId("scan-123_ABC.test"));
        assertFalse(ScanSchemeResolver.isValidSessionId(null));
        assertFalse(ScanSchemeResolver.isValidSessionId(""));
        assertFalse(ScanSchemeResolver.isValidSessionId(" scan-1"));
        assertFalse(ScanSchemeResolver.isValidSessionId("scan/1"));
        assertFalse(ScanSchemeResolver.isValidSessionId(
                "a1234567890123456789012345678901234567890123456789012345678901234567890"
                        + "123456789012345678901234567890123456789012345678901234567890"));
    }
}
