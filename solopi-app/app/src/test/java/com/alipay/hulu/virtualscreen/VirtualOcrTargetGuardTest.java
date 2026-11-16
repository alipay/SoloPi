package com.alipay.hulu.virtualscreen;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;
import static org.junit.Assert.*;

public class VirtualOcrTargetGuardTest {
    private final VirtualActionGuard.Box box = new VirtualActionGuard.Box(10, 20, 40, 60);
    private VirtualOcrTargetGuard.Line line(String id, String text, VirtualActionGuard.Box bounds, boolean pixels, boolean protectedText) {
        return new VirtualOcrTargetGuard.Line(id, text, bounds, pixels, protectedText);
    }
    @Test public void acceptsOnlyUniqueMatchingTextAtTheSameRegion() {
        VirtualOcrTargetGuard.Line original = line("ocr-1", "发现", box, true, false);
        VirtualOcrTargetGuard.Line current = line("ocr-7", "发现", box, true, false);
        assertNull(VirtualOcrTargetGuard.check(Collections.singletonList(original), Collections.singletonList(current), "ocr-1"));
        assertEquals("ambiguous_ocr_target", VirtualOcrTargetGuard.check(Collections.singletonList(original), Arrays.asList(current, current), "ocr-1"));
        assertEquals("stale_ocr_target", VirtualOcrTargetGuard.check(Collections.singletonList(original),
                Collections.singletonList(line("ocr-7", "发现", new VirtualActionGuard.Box(11, 20, 41, 60), true, false)), "ocr-1"));
        assertEquals("stale_ocr_target", VirtualOcrTargetGuard.check(Collections.singletonList(original),
                Collections.singletonList(line("ocr-7", "发现", box, false, false)), "ocr-1"));
        assertEquals("ocr_target_unavailable", VirtualOcrTargetGuard.check(
                Collections.singletonList(line("ocr-1", "发现", box, true, true)), Collections.singletonList(current), "ocr-1"));
    }
}
