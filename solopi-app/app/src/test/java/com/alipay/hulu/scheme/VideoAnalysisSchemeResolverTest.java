package com.alipay.hulu.scheme;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.FileOutputStream;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class VideoAnalysisSchemeResolverTest {
    @Rule
    public TemporaryFolder temporaryFolder = new TemporaryFolder();

    @Test
    public void numericParametersAreBounded() {
        assertEquals(250L, VideoAnalysisSchemeResolver.parseActionOffset("250"));
        assertEquals(0.2D,
                VideoAnalysisSchemeResolver.parseDifferenceThreshold("0.2"), 0.0D);
        assertInvalidOffset("-1");
        assertInvalidOffset("NaN");
        assertInvalidThreshold("0");
        assertInvalidThreshold("NaN");
        assertInvalidThreshold("1.1");
    }

    @Test
    public void videoMustBeNonEmptyDirectMp4Child() throws Exception {
        File root = temporaryFolder.newFolder("captures");
        File video = new File(root, "sample.mp4");
        FileOutputStream stream = new FileOutputStream(video);
        stream.write(1);
        stream.close();

        assertEquals(video.getCanonicalFile(),
                VideoAnalysisSchemeResolver.resolveVideo(root, video.getAbsolutePath()));

        File nested = new File(new File(root, "nested"), "nested.mp4");
        nested.getParentFile().mkdirs();
        FileOutputStream nestedStream = new FileOutputStream(nested);
        nestedStream.write(1);
        nestedStream.close();
        assertInvalidVideo(root, nested);
        assertInvalidVideo(root, new File(root, "missing.mp4"));
    }

    @Test
    public void activeReceiptSurvivesBoundedTrimming() {
        LinkedHashMap<String, Map<String, Object>> receipts = new LinkedHashMap<>();
        receipts.put("active", new LinkedHashMap<String, Object>());
        for (int index = 0; index < 32; index++) {
            receipts.put("request-" + index, new LinkedHashMap<String, Object>());
        }

        VideoAnalysisSchemeResolver.trimReceipts(receipts, "active", 32);

        assertEquals(32, receipts.size());
        assertTrue(receipts.containsKey("active"));
        assertFalse(receipts.containsKey("request-0"));
    }

    private static void assertInvalidOffset(String value) {
        try {
            VideoAnalysisSchemeResolver.parseActionOffset(value);
        } catch (IllegalArgumentException expected) {
            return;
        }
        throw new AssertionError("Expected invalid action offset");
    }

    private static void assertInvalidThreshold(String value) {
        try {
            VideoAnalysisSchemeResolver.parseDifferenceThreshold(value);
        } catch (IllegalArgumentException expected) {
            return;
        }
        throw new AssertionError("Expected invalid difference threshold");
    }

    private static void assertInvalidVideo(File root, File video) throws Exception {
        try {
            VideoAnalysisSchemeResolver.resolveVideo(root, video.getAbsolutePath());
        } catch (IllegalArgumentException expected) {
            return;
        }
        throw new AssertionError("Expected invalid video path");
    }
}
