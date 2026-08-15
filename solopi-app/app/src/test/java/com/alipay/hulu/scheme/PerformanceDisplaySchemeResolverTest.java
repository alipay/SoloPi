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

import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.tools.AppInfoProvider;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

public class PerformanceDisplaySchemeResolverTest {
    @Test
    public void normalizeItemsTrimsDeduplicatesAndPreservesOrder() {
        assertEquals(Arrays.asList("CPU", "Memory", "FPS"),
                PerformanceDisplaySchemeResolver.normalizeItems(
                        " CPU,Memory,CPU,, FPS "));
        assertEquals(Collections.emptyList(),
                PerformanceDisplaySchemeResolver.normalizeItems(" , "));
        assertEquals(Collections.emptyList(),
                PerformanceDisplaySchemeResolver.normalizeItems(null));
    }

    @Test
    public void activeAndTerminalStatesAreDisjoint() {
        for (String state : Arrays.asList("starting", "running", "stopping")) {
            assertTrue(PerformanceDisplaySchemeResolver.isActive(state));
            assertFalse(PerformanceDisplaySchemeResolver.isTerminal(state));
        }
        for (String state : Arrays.asList("stopped", "failed")) {
            assertFalse(PerformanceDisplaySchemeResolver.isActive(state));
            assertTrue(PerformanceDisplaySchemeResolver.isTerminal(state));
        }
        assertFalse(PerformanceDisplaySchemeResolver.isActive("idle"));
        assertFalse(PerformanceDisplaySchemeResolver.isTerminal("idle"));
        assertFalse(PerformanceDisplaySchemeResolver.isActive("recording"));
        assertFalse(PerformanceDisplaySchemeResolver.isTerminal("recording"));
    }

    @Test
    public void appInfoProviderIsReregisteredBeforeMetricStartup() {
        RecordingInjectorService injectorService = new RecordingInjectorService();
        AppInfoProvider provider = AppInfoProvider.getInstance();

        PerformanceDisplaySchemeResolver.refreshAppInfoProvider(
                injectorService, provider);

        assertEquals(Arrays.asList("unregister", "register"), injectorService.calls);
        assertSame(provider, injectorService.unregistered);
        assertSame(provider, injectorService.registered);
    }

    private static final class RecordingInjectorService extends InjectorService {
        private final List<String> calls = new ArrayList<>();
        private Object unregistered;
        private Object registered;

        @Override
        public void unregister(Object target) {
            calls.add("unregister");
            unregistered = target;
        }

        @Override
        public int register(Object target) {
            calls.add("register");
            registered = target;
            return REGISTER_SUCCESS;
        }
    }
}
