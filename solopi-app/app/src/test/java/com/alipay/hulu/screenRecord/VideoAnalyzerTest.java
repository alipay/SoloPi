package com.alipay.hulu.screenRecord;

import org.junit.Test;

import java.lang.reflect.InvocationTargetException;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;

public class VideoAnalyzerTest {
    @Test
    public void fallsBackOnlyWhenModernMethodIsMissing() throws Exception {
        assertEquals(250L, VideoAnalyzer.invokeAnalyzer(
                LegacyAnalyzer.class, "legacy", "video.mp4", 0.2D, 100L));

        try {
            VideoAnalyzer.invokeAnalyzer(
                    FailingModernAnalyzer.class, "legacy", "video.mp4", 0.2D, 100L);
            fail("Expected the modern analyzer failure to propagate");
        } catch (InvocationTargetException expected) {
            assertEquals("modern failed", expected.getCause().getMessage());
            assertEquals(0, FailingModernAnalyzer.legacyCalls);
        }
    }

    public static class LegacyAnalyzer {
        public static Double legacy(String path, double threshold) {
            return 250D;
        }
    }

    public static class FailingModernAnalyzer {
        static int legacyCalls;

        public static Double compVideoImageWithStart(
                String path, double threshold, long actionOffset) {
            throw new IllegalStateException("modern failed");
        }

        public static Double legacy(String path, double threshold) {
            legacyCalls++;
            return 999D;
        }
    }
}
