/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * 	http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.alipay.hulu.scheme;

import android.app.Activity;
import android.app.ProgressDialog;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.provider.Settings;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.serializer.SerializerFeature;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.scheme.AdbSchemeActivity;
import com.alipay.hulu.common.scheme.SchemeActionResolver;
import com.alipay.hulu.common.scheme.SchemeResolver;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.bean.AdvanceCaseSetting;
import com.alipay.hulu.shared.io.bean.GeneralOperationLogBean;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.io.db.GreenDaoManager;
import com.alipay.hulu.shared.io.db.RecordCaseInfoDao;
import com.alipay.hulu.shared.io.util.OperationStepUtil;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;
import com.alipay.hulu.util.CaseReplayUtil;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.nio.charset.Charset;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.regex.Pattern;

/**
 * Created by qiaoruikai on 2019/11/11 4:57 PM.
 */
@SchemeResolver("replay")
public class ReplaySchemeResolver implements SchemeActionResolver {
    public static final String REPLAY_MODE = "replayMode";
    public static final String CASE_NAME = "caseName";
    public static final String CASE_ID = "caseId";
    public static final String CASE_FINGERPRINT = "caseFingerprint";
    public static final String REQUEST_ID = "requestId";
    public static final String TARGET_APP = "targetApp";
    public static final String RESTART_APP = "restartApp";

    public static final String MODE_NORMAL = "normal";
    private static final Charset UTF_8 = Charset.forName("UTF-8");
    private static final Pattern CASE_FINGERPRINT_PATTERN = Pattern.compile("[0-9a-f]{64}");
    private static final Pattern REQUEST_ID_PATTERN =
            Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,127}");

    @Override
    public boolean processScheme(Context context, Map<String, String> params, Callback<Map<String, Object>> callback) {
        if (!(context instanceof AdbSchemeActivity)) {
            callback.onResult(Collections.<String, Object>singletonMap("error",
                    "Replay is only available through the ADB scheme transport"));
            return true;
        }

        String mode = params.get(REPLAY_MODE);
        if (StringUtil.isEmpty(mode)) {
            callback.onResult(Collections.<String, Object>singletonMap(
                    "error", "Parameter 'replayMode' is required"));
            return true;
        }

        switch (mode) {
            case MODE_NORMAL:
                return startNormalMode(context, params, callback);
        }
        callback.onResult(Collections.<String, Object>singletonMap(
                "error", "Unsupported replay mode: " + mode));
        return true;
    }

    /**
     * 通常模式启动录制
     * @param context
     * @param params
     * @return
     */
    private boolean startNormalMode(final Context context, Map<String, String> params,
                                    Callback<Map<String, Object>> callback) {
        String caseName = params.get(CASE_NAME);
        if (StringUtil.isEmpty(caseName)) {
            callback.onResult(Collections.<String, Object>singletonMap(
                    "error", "Parameter 'caseName' is required"));
            return true;
        }
        final String requestId = params.get(REQUEST_ID);
        if (StringUtil.isEmpty(requestId)
                || !REQUEST_ID_PATTERN.matcher(requestId).matches()) {
            callback.onResult(Collections.<String, Object>singletonMap(
                    "error", "Parameter 'requestId' is invalid"));
            return true;
        }
        final long expectedCaseId;
        final String expectedFingerprint = params.get(CASE_FINGERPRINT);
        try {
            expectedCaseId = parseCaseId(params.get(CASE_ID));
        } catch (IllegalArgumentException exception) {
            callback.onResult(Collections.<String, Object>singletonMap(
                    "error", exception.getMessage()));
            return true;
        }
        if (StringUtil.isEmpty(expectedFingerprint)
                || !CASE_FINGERPRINT_PATTERN.matcher(expectedFingerprint).matches()) {
            callback.onResult(Collections.<String, Object>singletonMap(
                    "error", "Parameter 'caseFingerprint' must be a lowercase SHA-256 value"));
            return true;
        }
        if (HarnessState.isActive()) {
            callback.onResult(Collections.<String, Object>singletonMap("error", "A replay is already running"));
            return true;
        }
        final Boolean restartApp;
        try {
            restartApp = parseOptionalBoolean(params.get(RESTART_APP), RESTART_APP);
        } catch (IllegalArgumentException exception) {
            callback.onResult(Collections.<String, Object>singletonMap(
                    "error", exception.getMessage()));
            return true;
        }

        final String runId = HarnessState.start(caseName, requestId);
        if (runId == null) {
            if (HarnessState.isActive()) {
                Map<String, Object> conflict = new java.util.LinkedHashMap<>();
                conflict.put("success", false);
                conflict.put("errorCode", "replay_conflict");
                conflict.put("error", "A replay is already running");
                conflict.put("run", HarnessState.snapshot());
                callback.onResult(conflict);
            } else {
                callback.onResult(HarnessState.snapshot());
            }
            return true;
        }
        final String replayOwner = HarnessState.getReplayLeaseOwner(runId);
        if (replayOwner == null) {
            HarnessState.failToStart(runId, "Replay session reservation was lost");
            callback.onResult(Collections.<String, Object>singletonMap("runId", runId));
            return true;
        }

        List<RecordCaseInfo> caseInfos = GreenDaoManager.getInstance().getRecordCaseInfoDao().queryBuilder()
                .where(RecordCaseInfoDao.Properties.Id.eq(expectedCaseId)).limit(1).list();
        if (caseInfos == null || caseInfos.size() < 1) {
            HarnessState.failToStart(runId, "Case snapshot no longer exists: " + caseName);
            callback.onResult(Collections.<String, Object>singletonMap("runId", runId));
            return true;
        }
        // GreenDAO 可能返回标识作用域内的缓存实体。回放专用设置不能修改该共享实例，
        // 以免影响后续 CLI 或界面运行。
        final RecordCaseInfo caseInfo;
        try {
            caseInfo = snapshotCase(caseInfos.get(0));
        } catch (IllegalArgumentException exception) {
            HarnessState.failToStart(runId, exception.getMessage());
            callback.onResult(Collections.<String, Object>singletonMap("runId", runId));
            return true;
        }
        if (!StringUtil.equals(caseName, caseInfo.getCaseName())
                || !StringUtil.equals(expectedFingerprint, caseFingerprint(caseInfo))) {
            HarnessState.failToStart(runId, "Case changed after CLI safety validation: " + caseName);
            callback.onResult(Collections.<String, Object>singletonMap("runId", runId));
            return true;
        }
        String targetError = resolveAndApplyTargetOverride(
                context, caseInfo, params.get(TARGET_APP));
        if (targetError != null) {
            HarnessState.failToStart(runId, targetError);
            callback.onResult(Collections.<String, Object>singletonMap("runId", runId));
            return true;
        }
        callback.onResult(Collections.<String, Object>singletonMap("runId", runId));
        PermissionUtil.requestPermissions(Arrays.asList("adb", "float", "background", Settings.ACTION_ACCESSIBILITY_SETTINGS), (Activity) context, new PermissionUtil.OnPermissionCallback() {
            @Override
            public void onPermissionResult(final boolean result, String reason) {
                if (!HarnessState.isRunning(runId)) {
                    return;
                }
                if (result) {
                    LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (!HarnessState.isRunning(runId)) {
                                return;
                            }
                            try {
                                CaseReplayUtil.startReplay(caseInfo, replayOwner, restartApp);
                            } catch (RuntimeException exception) {
                                HarnessState.failToStart(runId,
                                        "Unable to start replay: " + exception.getMessage());
                            }
                        }
                    });
                } else {
                    HarnessState.failToStart(runId, "Permission denied: " + reason);
                }
            }
        });
        return true;
    }

    /**
     * 协议回放必须使用确定的目标应用，不能落入需要人工点击的跨应用选择器。
     */
    private static String resolveAndApplyTargetOverride(Context context,
                                                        RecordCaseInfo caseInfo,
                                                        String requestedTarget) {
        String target = requestedTarget == null
                ? caseInfo.getTargetAppPackage() : requestedTarget.trim();
        String basicTargetError = validateTargetPackage(
                context.getPackageName(), target, true, true);
        if (basicTargetError != null) {
            return basicTargetError;
        }
        PackageInfo packageInfo = ContextUtil.getPackageInfoByName(context, target);
        String targetError = validateTargetPackage(
                context.getPackageName(), target, packageInfo != null,
                context.getPackageManager().getLaunchIntentForPackage(target) != null);
        if (targetError != null) {
            return targetError;
        }

        String label = null;
        if (packageInfo.applicationInfo != null) {
            CharSequence applicationLabel = packageInfo.applicationInfo.loadLabel(
                    context.getPackageManager());
            if (applicationLabel != null) {
                label = applicationLabel.toString();
            }
        }
        return applyTargetOverride(caseInfo, target, label);
    }

    static Boolean parseOptionalBoolean(String value, String name) {
        if (value == null) {
            return null;
        }
        if ("true".equalsIgnoreCase(value)) {
            return Boolean.TRUE;
        }
        if ("false".equalsIgnoreCase(value)) {
            return Boolean.FALSE;
        }
        throw new IllegalArgumentException("Parameter '" + name + "' must be true or false");
    }

    static long parseCaseId(String value) {
        if (StringUtil.isEmpty(value)) {
            throw new IllegalArgumentException("Parameter 'caseId' is required");
        }
        try {
            long result = Long.parseLong(value);
            if (result <= 0L) {
                throw new NumberFormatException("not positive");
            }
            return result;
        } catch (NumberFormatException exception) {
            throw new IllegalArgumentException("Parameter 'caseId' must be a positive integer");
        }
    }

    static String caseFingerprint(RecordCaseInfo caseInfo) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            updateFingerprint(digest, caseInfo.getId());
            updateFingerprint(digest, caseInfo.getCaseName());
            updateFingerprint(digest, caseInfo.getCaseDesc());
            updateFingerprint(digest, caseInfo.getTargetAppPackage());
            updateFingerprint(digest, caseInfo.getTargetAppLabel());
            updateFingerprint(digest, caseInfo.getRecordMode());
            updateFingerprint(digest, caseInfo.getAdvanceSettings());
            updateFingerprint(digest, caseInfo.getOperationLog());
            updateFingerprint(digest, caseInfo.getPriority());
            updateFingerprint(digest, caseInfo.getGmtCreate());
            updateFingerprint(digest, caseInfo.getGmtModify());
            StringBuilder result = new StringBuilder(64);
            for (byte value : digest.digest()) {
                result.append(String.format(java.util.Locale.US, "%02x", value & 0xff));
            }
            return result.toString();
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    /** 将外部步骤文件内联，确保校验和回放消费同一份不可变内容。 */
    static RecordCaseInfo snapshotCase(RecordCaseInfo source) {
        if (source == null) {
            throw new IllegalArgumentException("Stored case is missing");
        }
        RecordCaseInfo snapshot = source.clone();
        GeneralOperationLogBean operationLog;
        try {
            operationLog = JSON.parseObject(snapshot.getOperationLog(),
                    GeneralOperationLogBean.class);
            OperationStepUtil.afterLoad(operationLog);
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException("Stored case operation log cannot be loaded");
        }
        if (operationLog == null || operationLog.getSteps() == null) {
            throw new IllegalArgumentException("Stored case does not contain readable steps");
        }
        for (OperationStep step : operationLog.getSteps()) {
            if (step == null || step.getOperationMethod() == null) {
                continue;
            }
            Map<String, String> decodedParams = new LinkedHashMap<>();
            for (String key : step.getOperationMethod().getParamKeys()) {
                decodedParams.put(key, step.getOperationMethod().getParam(key));
            }
            step.getOperationMethod().setOperationParam(decodedParams);
            step.getOperationMethod().setEncrypt(false);
        }
        operationLog.setStorePath(null);
        snapshot.setOperationLog(JSON.toJSONString(
                operationLog, SerializerFeature.MapSortField));
        return snapshot;
    }

    private static void updateFingerprint(MessageDigest digest, Object value) {
        if (value == null) {
            digest.update((byte) 0xff);
            return;
        }
        byte[] encoded = String.valueOf(value).getBytes(UTF_8);
        digest.update(String.valueOf(encoded.length).getBytes(UTF_8));
        digest.update((byte) ':');
        digest.update(encoded);
    }

    static String validateTargetPackage(String selfPackage, String target,
                                        boolean installed, boolean launchable) {
        if (StringUtil.isEmpty(target)) {
            return "Replay target application is missing";
        }
        if (StringUtil.equals(selfPackage, target)) {
            return "Replay target application cannot be SoloPi itself";
        }
        if (!installed) {
            return "Target application is not installed: " + target;
        }
        if (!launchable) {
            return "Target application has no launchable activity: " + target;
        }
        return null;
    }

    static String applyTargetOverride(RecordCaseInfo caseInfo, String target, String label) {
        if (StringUtil.isEmpty(target)) {
            return "Replay target application is missing";
        }
        AdvanceCaseSetting setting;
        try {
            String rawSettings = caseInfo.getAdvanceSettings();
            setting = StringUtil.isEmpty(rawSettings)
                    ? new AdvanceCaseSetting()
                    : JSON.parseObject(rawSettings, AdvanceCaseSetting.class);
        } catch (RuntimeException exception) {
            return "Case advanceSettings is invalid";
        }
        if (setting == null) {
            setting = new AdvanceCaseSetting();
        }
        setting.setOverrideApp(target);
        caseInfo.setAdvanceSettings(JSON.toJSONString(setting));
        caseInfo.setTargetAppPackage(target);
        if (!StringUtil.isEmpty(label)) {
            caseInfo.setTargetAppLabel(label);
        }
        return null;
    }

    public void dismissProgressDialog(final ProgressDialog progressDialog) {
        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            public void run() {
                if (progressDialog != null && progressDialog.isShowing()) {
                    progressDialog.dismiss();
                }
            }
        });
    }

    public void updateProgressDialog(final ProgressDialog progressDialog, final int progress, final int totalProgress, final String message) {
        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (progressDialog == null || !progressDialog.isShowing()) {
                    return;
                }

                // 更新progressDialog的状态
                progressDialog.setProgress(progress);
                progressDialog.setMax(totalProgress);
                progressDialog.setMessage(message);
            }
        });
    }
}
