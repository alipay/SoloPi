package com.alipay.hulu.common.scheme;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class AdbSchemeActivityTest {
    @Test
    public void backgroundImportAndCancelRequireExactRouteAndReadyResolver() {
        for (String type : new String[] {"case-import", "cancel"}) {
            assertTrue(AdbSchemeActivity.canHarnessRunWithoutWindow("solopi", "startaction", "/harness", type, true, true));
            assertFalse(AdbSchemeActivity.canHarnessRunWithoutWindow("solopi", "startaction", "/harness", type, false, true));
            assertFalse(AdbSchemeActivity.canHarnessRunWithoutWindow("solopi", "startaction", "/harness", type, true, false));
            assertFalse(AdbSchemeActivity.canHarnessRunWithoutWindow("https", "startaction", "/harness", type, true, true));
            assertFalse(AdbSchemeActivity.canHarnessRunWithoutWindow("solopi", "wrong", "/harness", type, true, true));
            assertFalse(AdbSchemeActivity.canHarnessRunWithoutWindow("solopi", "startaction", "/record", type, true, true));
        }
        for (String type : new String[] {null, "", "adb-connect", "record", "health"}) {
            assertFalse(AdbSchemeActivity.canHarnessRunWithoutWindow("solopi", "startaction", "/harness", type, true, true));
        }
    }

    @Test
    public void onlyExplicitReadyHeadlessReplayUsesNoDisplay() {
        assertTrue(AdbSchemeActivity.canReplayWithoutWindow("solopi", "startaction", "/replay", "true", true, true));
        assertTrue(AdbSchemeActivity.canReplayWithoutWindow("solopi", "startaction", "/replay", "TRUE", true, true));
        assertFalse(AdbSchemeActivity.canReplayWithoutWindow("solopi", "startaction", "/replay", "true", false, true));
        assertFalse(AdbSchemeActivity.canReplayWithoutWindow("solopi", "startaction", "/replay", "true", true, false));
        for (String value : new String[] {null, "", "false", "yes", "1"}) {
            assertFalse(AdbSchemeActivity.canReplayWithoutWindow("solopi", "startaction", "/replay", value, true, true));
        }
        assertFalse(AdbSchemeActivity.canReplayWithoutWindow("solopi", "startaction", "/record", "true", true, true));
        assertFalse(AdbSchemeActivity.canReplayWithoutWindow("https", "startaction", "/replay", "true", true, true));
        assertFalse(AdbSchemeActivity.canReplayWithoutWindow("solopi", "another", "/replay", "true", true, true));
    }

    @Test
    public void noDisplayRequiresBothApplicationAndAgentResolverToBeReady() {
        assertTrue(AdbSchemeActivity.canRunWithoutWindow("solopi", "startaction", "/agent", true, true));
        assertFalse(AdbSchemeActivity.canRunWithoutWindow("solopi", "startaction", "/agent", false, true));
        assertFalse(AdbSchemeActivity.canRunWithoutWindow("solopi", "startaction", "/agent", true, false));
        assertFalse(AdbSchemeActivity.canRunWithoutWindow("solopi", "startaction", "/agent", false, false));
    }

    @Test
    public void otherSchemeFlowsNeverUseTheAgentWindowPolicy() {
        String[] paths = {null, "", "/", "/agent/", "/agent/act", "/record", "/performance", "/config"};
        for (String path : paths) {
            assertFalse(AdbSchemeActivity.canRunWithoutWindow("solopi", "startaction", path, true, true));
        }
        assertFalse(AdbSchemeActivity.canRunWithoutWindow("https", "startaction", "/agent", true, true));
        assertFalse(AdbSchemeActivity.canRunWithoutWindow("solopi", "another", "/agent", true, true));
        assertFalse(AdbSchemeActivity.canRunWithoutWindow("solopi", "user@startaction", "/agent", true, true));
        assertFalse(AdbSchemeActivity.canRunWithoutWindow("solopi", "startaction:1234", "/agent", true, true));
        assertFalse(AdbSchemeActivity.canRunWithoutWindow(null, null, null, true, true));
    }
}
