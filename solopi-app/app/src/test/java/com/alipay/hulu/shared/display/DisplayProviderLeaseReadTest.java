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
package com.alipay.hulu.shared.display;

import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.shared.display.items.base.Displayable;
import com.alipay.hulu.shared.display.items.base.RecordPattern;

import org.junit.Test;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class DisplayProviderLeaseReadTest {
    @Test
    public void busyRecordingReturnsRecentContentWithoutWaiting() throws Exception {
        int originalLogLevel = LogUtil.LOG_LEVEL;
        LogUtil.LOG_LEVEL = Integer.MAX_VALUE;
        ExecutorService executor = Executors.newFixedThreadPool(2);
        BlockingDisplayable displayable = new BlockingDisplayable();
        try {
            final DisplayProvider provider = new DisplayProvider();
            final DisplayProvider.DisplayWrapper wrapper =
                    new DisplayProvider.DisplayWrapper(displayable);
            assertEquals("recent", wrapper.getContent());

            Map<String, DisplayProvider.DisplayWrapper> running =
                    new ConcurrentHashMap<>();
            running.put("CPU", wrapper);
            setField(provider, "runningDisplay", running);

            Map<String, DisplayProvider.DisplayWrapper> leasedDisplays =
                    new LinkedHashMap<>();
            leasedDisplays.put("CPU", wrapper);
            final DisplayProvider.RecordingLease activeLease = newRecordingLease(leasedDisplays);
            setField(provider, "activeRecordingLease", activeLease);

            Future<?> recording = executor.submit(new Runnable() {
                @Override
                public void run() {
                    wrapper.record();
                }
            });
            assertTrue(displayable.recordEntered.await(1, TimeUnit.SECONDS));

            Future<Map<String, String>> current = executor.submit(
                    new Callable<Map<String, String>>() {
                        @Override
                        public Map<String, String> call() {
                            return provider.getCurrentDisplayContents(activeLease);
                        }
                    });
            assertEquals("recent", current.get(1, TimeUnit.SECONDS).get("CPU"));

            displayable.releaseRecord.countDown();
            recording.get(1, TimeUnit.SECONDS);
        } finally {
            displayable.releaseRecord.countDown();
            executor.shutdownNow();
            assertTrue(executor.awaitTermination(1, TimeUnit.SECONDS));
            LogUtil.LOG_LEVEL = originalLogLevel;
        }
    }

    @Test
    public void slowLeaseReadDoesNotBlockStatusOrStop() throws Exception {
        int originalLogLevel = LogUtil.LOG_LEVEL;
        LogUtil.LOG_LEVEL = Integer.MAX_VALUE;
        ExecutorService executor = Executors.newFixedThreadPool(2);
        ExecutorService providerExecutor = Executors.newSingleThreadExecutor();
        BlockingCurrentDisplayable displayable = new BlockingCurrentDisplayable();
        try {
            final DisplayProvider provider = new DisplayProvider();
            DisplayProvider.DisplayWrapper wrapper =
                    new DisplayProvider.DisplayWrapper(displayable);

            Map<String, DisplayProvider.DisplayWrapper> running =
                    new ConcurrentHashMap<>();
            running.put("CPU", wrapper);
            setField(provider, "runningDisplay", running);
            setField(provider, "cachedContent", new ConcurrentHashMap<String, String>());
            setField(provider, "executorService", providerExecutor);

            Map<String, DisplayProvider.DisplayWrapper> leasedDisplays =
                    new LinkedHashMap<>();
            leasedDisplays.put("CPU", wrapper);
            final DisplayProvider.RecordingLease activeLease = newRecordingLease(leasedDisplays);
            setField(provider, "activeRecordingLease", activeLease);

            assertNull(provider.getCurrentDisplayContents(activeLease).get("CPU"));
            assertTrue(displayable.currentEntered.await(1, TimeUnit.SECONDS));

            Future<DisplayProvider.RecordingStopResult> stop = executor.submit(
                    new Callable<DisplayProvider.RecordingStopResult>() {
                        @Override
                        public DisplayProvider.RecordingStopResult call() {
                            return provider.stopRecordingSession(activeLease);
                        }
                    });
            assertTrue(awaitBooleanField(provider, "pauseFlag", true, 1, TimeUnit.SECONDS));

            Future<Set<String>> status = executor.submit(new Callable<Set<String>>() {
                @Override
                public Set<String> call() {
                    return provider.getRunningDisplayItems();
                }
            });
            assertEquals(Collections.singleton("CPU"),
                    status.get(1, TimeUnit.SECONDS));
            assertFalse(stop.isDone());

            displayable.releaseCurrent.countDown();
            DisplayProvider.RecordingStopResult stopResult =
                    stop.get(1, TimeUnit.SECONDS);
            assertTrue(stopResult.isMatched());
            assertTrue(stopResult.isCleanupComplete());
            assertTrue(stopResult.isRecordsComplete());
        } finally {
            displayable.releaseCurrent.countDown();
            executor.shutdownNow();
            providerExecutor.shutdownNow();
            assertTrue(executor.awaitTermination(1, TimeUnit.SECONDS));
            assertTrue(providerExecutor.awaitTermination(1, TimeUnit.SECONDS));
            LogUtil.LOG_LEVEL = originalLogLevel;
        }
    }

    @Test
    public void nameBasedReadsCannotAccessActiveDisplayLease() throws Exception {
        int originalLogLevel = LogUtil.LOG_LEVEL;
        LogUtil.LOG_LEVEL = Integer.MAX_VALUE;
        ExecutorService providerExecutor = Executors.newSingleThreadExecutor();
        try {
            DisplayProvider provider = new DisplayProvider();
            CountingDisplayable displayable = new CountingDisplayable();
            DisplayProvider.DisplayWrapper wrapper =
                    new DisplayProvider.DisplayWrapper(displayable);

            Map<String, DisplayProvider.DisplayWrapper> running =
                    new ConcurrentHashMap<>();
            running.put("CPU", wrapper);
            setField(provider, "runningDisplay", running);

            Map<String, String> cached = new ConcurrentHashMap<>();
            cached.put("CPU", "cached");
            setField(provider, "cachedContent", cached);
            setField(provider, "executorService", providerExecutor);

            Map<String, DisplayProvider.DisplayWrapper> leasedDisplays =
                    new LinkedHashMap<>();
            leasedDisplays.put("CPU", wrapper);
            Constructor<DisplayProvider.DisplayLease> constructor =
                    DisplayProvider.DisplayLease.class.getDeclaredConstructor(Map.class);
            constructor.setAccessible(true);
            DisplayProvider.DisplayLease lease = constructor.newInstance(leasedDisplays);
            setField(provider, "activeDisplayLease", lease);

            assertNull(provider.getDisplayContent("CPU"));
            assertNull(provider.getCurrentDisplayContent("CPU"));
            assertEquals(0, displayable.currentInfoCalls);

            assertNull(provider.getCurrentDisplayContents(lease).get("CPU"));
            providerExecutor.submit(new Runnable() {
                @Override
                public void run() {
                }
            }).get(1, TimeUnit.SECONDS);
            assertEquals(1, displayable.currentInfoCalls);
            assertEquals("leased", provider.getCurrentDisplayContents(lease).get("CPU"));
        } finally {
            providerExecutor.shutdownNow();
            assertTrue(providerExecutor.awaitTermination(1, TimeUnit.SECONDS));
            LogUtil.LOG_LEVEL = originalLogLevel;
        }
    }

    private static void setField(Object target, String name, Object value) throws Exception {
        Field field = target.getClass().getDeclaredField(name);
        field.setAccessible(true);
        field.set(target, value);
    }

    private static boolean awaitBooleanField(Object target, String name, boolean expected,
                                             long timeout, TimeUnit unit) throws Exception {
        Field field = target.getClass().getDeclaredField(name);
        field.setAccessible(true);
        long deadline = System.nanoTime() + unit.toNanos(timeout);
        do {
            if (field.getBoolean(target) == expected) {
                return true;
            }
            Thread.sleep(5L);
        } while (System.nanoTime() < deadline);
        return field.getBoolean(target) == expected;
    }

    private static DisplayProvider.RecordingLease newRecordingLease(
            Map<String, DisplayProvider.DisplayWrapper> displays) throws Exception {
        Constructor<DisplayProvider.RecordingLease> constructor =
                DisplayProvider.RecordingLease.class.getDeclaredConstructor(Map.class);
        constructor.setAccessible(true);
        return constructor.newInstance(displays);
    }

    private static final class CountingDisplayable implements Displayable {
        private int currentInfoCalls;

        @Override
        public void start() {
        }

        @Override
        public void stop() {
        }

        @Override
        public String getCurrentInfo() {
            currentInfoCalls += 1;
            return "leased";
        }

        @Override
        public long getRefreshFrequency() {
            return 0L;
        }

        @Override
        public void clear() {
        }

        @Override
        public void startRecord() {
        }

        @Override
        public void record() {
        }

        @Override
        public void trigger() {
        }

        @Override
        public Map<RecordPattern, List<RecordPattern.RecordItem>> stopRecord() {
            return Collections.emptyMap();
        }
    }

    private static final class BlockingDisplayable implements Displayable {
        private final CountDownLatch recordEntered = new CountDownLatch(1);
        private final CountDownLatch releaseRecord = new CountDownLatch(1);

        @Override
        public void start() {
        }

        @Override
        public void stop() {
        }

        @Override
        public String getCurrentInfo() {
            return "recent";
        }

        @Override
        public long getRefreshFrequency() {
            return 0L;
        }

        @Override
        public void clear() {
        }

        @Override
        public void startRecord() {
        }

        @Override
        public void record() {
            recordEntered.countDown();
            try {
                releaseRecord.await();
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
            }
        }

        @Override
        public void trigger() {
        }

        @Override
        public Map<RecordPattern, List<RecordPattern.RecordItem>> stopRecord() {
            return Collections.emptyMap();
        }
    }

    private static final class BlockingCurrentDisplayable implements Displayable {
        private final CountDownLatch currentEntered = new CountDownLatch(1);
        private final CountDownLatch releaseCurrent = new CountDownLatch(1);

        @Override
        public void start() {
        }

        @Override
        public void stop() {
        }

        @Override
        public String getCurrentInfo() {
            currentEntered.countDown();
            boolean interrupted = false;
            while (releaseCurrent.getCount() > 0L) {
                try {
                    releaseCurrent.await();
                } catch (InterruptedException exception) {
                    interrupted = true;
                }
            }
            if (interrupted) {
                Thread.currentThread().interrupt();
            }
            return "fresh";
        }

        @Override
        public long getRefreshFrequency() {
            return 0L;
        }

        @Override
        public void clear() {
        }

        @Override
        public void startRecord() {
        }

        @Override
        public void record() {
        }

        @Override
        public void trigger() {
        }

        @Override
        public Map<RecordPattern, List<RecordPattern.RecordItem>> stopRecord() {
            return Collections.emptyMap();
        }
    }
}
