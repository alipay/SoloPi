package com.alipay.hulu.scheme;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.io.bean.GeneralOperationLogBean;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;

import org.junit.Test;

import java.io.File;
import java.io.FileWriter;
import java.util.Collections;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class ReplaySchemeResolverTest {
    @Test
    public void optionalBooleanAcceptsOnlyExplicitValues() {
        assertNull(ReplaySchemeResolver.parseOptionalBoolean(null, "restartApp"));
        assertTrue(ReplaySchemeResolver.parseOptionalBoolean("true", "restartApp"));
        assertFalse(ReplaySchemeResolver.parseOptionalBoolean("FALSE", "restartApp"));

        try {
            ReplaySchemeResolver.parseOptionalBoolean("1", "restartApp");
        } catch (IllegalArgumentException exception) {
            assertEquals("Parameter 'restartApp' must be true or false", exception.getMessage());
            return;
        }
        throw new AssertionError("Expected invalid boolean to be rejected");
    }

    @Test
    public void replaySnapshotRequiresPositiveCaseIdAndStableFingerprint() {
        assertEquals(7L, ReplaySchemeResolver.parseCaseId("7"));
        for (String invalid : new String[] {null, "", "0", "-1", "not-a-number"}) {
            try {
                ReplaySchemeResolver.parseCaseId(invalid);
            } catch (IllegalArgumentException expected) {
                continue;
            }
            throw new AssertionError("Expected invalid caseId to be rejected: " + invalid);
        }

        RecordCaseInfo caseInfo = new RecordCaseInfo(
                7L, "smoke", "desc", "com.example.target", "Target",
                "local", "{}", "{\"steps\":[]}", 2, 10L, 20L);
        String original = ReplaySchemeResolver.caseFingerprint(caseInfo);
        assertTrue(original.matches("[0-9a-f]{64}"));
        assertEquals(original, ReplaySchemeResolver.caseFingerprint(caseInfo.clone()));

        caseInfo.setOperationLog("{\"steps\":[{\"unsafe\":true}]}");
        assertFalse(original.equals(ReplaySchemeResolver.caseFingerprint(caseInfo)));
    }

    @Test
    public void replaySnapshotFingerprintsLoadedStepsAndDoesNotRetainStorePath()
            throws Exception {
        File stepsFile = File.createTempFile("solopi-replay-steps", ".json");
        try {
            writeSteps(stepsFile, PerformActionEnum.CLICK);
            GeneralOperationLogBean storedLog = new GeneralOperationLogBean();
            storedLog.setStorePath(stepsFile.getAbsolutePath());
            RecordCaseInfo caseInfo = new RecordCaseInfo(
                    8L, "snapshot", "desc", "com.example.target", "Target",
                    "local", "{}", JSON.toJSONString(storedLog), 2, 10L, 20L);

            RecordCaseInfo firstSnapshot = ReplaySchemeResolver.snapshotCase(caseInfo);
            String firstFingerprint = ReplaySchemeResolver.caseFingerprint(firstSnapshot);
            assertFalse(firstSnapshot.getOperationLog().contains(stepsFile.getAbsolutePath()));

            writeSteps(stepsFile, PerformActionEnum.LONG_CLICK);
            RecordCaseInfo secondSnapshot = ReplaySchemeResolver.snapshotCase(caseInfo);
            assertFalse(firstFingerprint.equals(
                    ReplaySchemeResolver.caseFingerprint(secondSnapshot)));
            assertEquals(firstFingerprint,
                    ReplaySchemeResolver.caseFingerprint(firstSnapshot));
        } finally {
            assertTrue(stepsFile.delete() || !stepsFile.exists());
        }
    }

    private static void writeSteps(File target, PerformActionEnum action) throws Exception {
        OperationStep step = new OperationStep();
        step.setOperationMethod(new OperationMethod(action));
        FileWriter writer = new FileWriter(target, false);
        try {
            writer.write(JSON.toJSONString(Collections.singletonList(step)));
        } finally {
            writer.close();
        }
    }

    @Test
    public void replayTargetMustBeExternalInstalledAndLaunchable() {
        assertEquals(
                "Replay target application is missing",
                ReplaySchemeResolver.validateTargetPackage(
                        "com.alipay.hulu", "", false, false));
        assertEquals(
                "Replay target application cannot be SoloPi itself",
                ReplaySchemeResolver.validateTargetPackage(
                        "com.alipay.hulu", "com.alipay.hulu", true, true));
        assertEquals(
                "Target application is not installed: com.example.target",
                ReplaySchemeResolver.validateTargetPackage(
                        "com.alipay.hulu", "com.example.target", false, false));
        assertEquals(
                "Target application has no launchable activity: com.example.target",
                ReplaySchemeResolver.validateTargetPackage(
                        "com.alipay.hulu", "com.example.target", true, false));
        assertNull(ReplaySchemeResolver.validateTargetPackage(
                "com.alipay.hulu", "com.example.target", true, true));
    }

    @Test
    public void targetOverridePreservesOtherAdvanceSettings() {
        RecordCaseInfo caseInfo = new RecordCaseInfo();
        caseInfo.setTargetAppPackage("com.example.original");
        caseInfo.setTargetAppLabel("Original");
        caseInfo.setAdvanceSettings(
                "{\"descriptorMode\":\"accessibility\",\"version\":2}");

        String error = ReplaySchemeResolver.applyTargetOverride(
                caseInfo, "com.example.override", "Override");

        assertNull(error);
        assertEquals("com.example.override", caseInfo.getTargetAppPackage());
        assertEquals("Override", caseInfo.getTargetAppLabel());
        JSONObject settings = JSON.parseObject(caseInfo.getAdvanceSettings());
        assertEquals("com.example.override", settings.getString("overrideApp"));
        assertEquals("accessibility", settings.getString("descriptorMode"));
        assertEquals(2, settings.getIntValue("version"));
    }

    @Test
    public void targetOverrideRejectsInvalidSettings() {
        RecordCaseInfo caseInfo = new RecordCaseInfo();
        caseInfo.setAdvanceSettings("not-json");

        assertEquals(
                "Case advanceSettings is invalid",
                ReplaySchemeResolver.applyTargetOverride(
                        caseInfo, "com.example.override", "Override"));
    }
}
