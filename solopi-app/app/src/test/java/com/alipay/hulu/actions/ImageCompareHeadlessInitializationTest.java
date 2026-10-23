package com.alipay.hulu.actions;

import com.alipay.hulu.common.service.ScreenCaptureService;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class ImageCompareHeadlessInitializationTest {
    @Test
    public void initializationAndOptionalHighlightNeedNoOverlayOrUiContext() {
        final int[] captureLoads = {0};
        ImageCompareActionProvider provider = new ImageCompareActionProvider() {
            @Override protected ScreenCaptureService loadCaptureService() {
                captureLoads[0]++;
                return null;
            }
        };
        // No Application/Service context exists in this JVM test. Eager loading of the
        // highlight service or posting highlight work would fail before these calls finish.
        provider.onCreate(null);
        provider.highlightIfConfigured(null, 1000);
        provider.onDestroy(null);
        provider.highlightIfConfigured(null, 1000);
        assertEquals(1, captureLoads[0]);
    }
}
