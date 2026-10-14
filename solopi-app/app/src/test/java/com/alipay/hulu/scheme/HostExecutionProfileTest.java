package com.alipay.hulu.scheme;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.Assert.assertEquals;

public class HostExecutionProfileTest {
    @Test
    public void hostIsReadyWithoutOverlayBatteryExemptionOrUiAutoStart() {
        Map<String, Object> permissions = readyPermissions();
        permissions.put("float", false);
        permissions.put("powerSave", false);
        permissions.put("background", false);
        Map<String, Object> profile = HarnessSchemeResolver.hostExecutionProfile(true, permissions);
        assertEquals(true, profile.get("ready"));
        assertEquals("headless", profile.get("replayMode"));
        assertEquals(Arrays.asList("adb", "accessibility"), profile.get("requiredPermissions"));
        assertEquals(Collections.singletonList("powerSave"), profile.get("advisoryPermissions"));
    }

    @Test
    public void hostRejectsMissingRequiredControlAndIncompleteInitialization() {
        assertEquals(false, HarnessSchemeResolver.hostExecutionProfile(false, readyPermissions()).get("ready"));
        for (String key : Arrays.asList("adb", "accessibility")) {
            for (Object value : Arrays.asList(false, null, "true")) {
                Map<String, Object> permissions = readyPermissions();
                permissions.put(key, value);
                assertEquals(false, HarnessSchemeResolver.hostExecutionProfile(true, permissions).get("ready"));
            }
        }
        assertEquals(false, HarnessSchemeResolver.hostExecutionProfile(true,
                Collections.<String, Object>emptyMap()).get("ready"));
    }

    private static Map<String, Object> readyPermissions() {
        Map<String, Object> permissions = new LinkedHashMap<>();
        permissions.put("adb", true);
        permissions.put("accessibility", true);
        return permissions;
    }
}
