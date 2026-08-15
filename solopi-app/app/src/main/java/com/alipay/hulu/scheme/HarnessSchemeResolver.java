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
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.scheme.SchemeActionResolver;
import com.alipay.hulu.common.scheme.AdbSchemeActivity;
import com.alipay.hulu.common.scheme.SchemeResolver;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.service.CaseReplayManager;
import com.alipay.hulu.shared.io.bean.GeneralOperationLogBean;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.io.db.GreenDaoManager;
import com.alipay.hulu.shared.io.db.RecordCaseInfoDao;
import com.alipay.hulu.shared.io.util.OperationStepUtil;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.OperationNode;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 面向 AI Harness 的只读 HTTP 契约，以及仅限 ADB 的回放控制。
 */
@SchemeResolver("harness")
public class HarnessSchemeResolver implements SchemeActionResolver {
    private static final String PROTOCOL_VERSION = "2.0";
    private static final String KEY_TYPE = "type";
    private static final int MAX_ADB_CONNECT_RECEIPTS = 16;
    private static final String ADB_CONNECT_REQUIRED_USER_ACTION =
            "请确认 SoloPi 配置的内部 ADB 地址可连接，并在设备上确认 RSA 授权弹窗";
    private static Map<String, Object> lastImportResult;
    private static Map<String, Object> lastCaseDeleteResult;
    private static final Map<String, Map<String, Object>> ADB_CONNECT_RECEIPTS =
            new LinkedHashMap<>();
    private static String activeAdbConnectRequestId;

    @Override
    public boolean processScheme(Context context, Map<String, String> params,
                                 Callback<Map<String, Object>> callback) {
        String type = params.get(KEY_TYPE);
        if (StringUtil.isEmpty(type)) {
            callback.onResult(error("missing_type", "Parameter 'type' is required"));
            return true;
        }

        switch (type) {
            case "capabilities":
                callback.onResult(capabilities(context));
                return true;
            case "health":
                callback.onResult(health(context));
                return true;
            case "info":
                callback.onResult(info(context));
                return true;
            case "cases":
                callback.onResult(cases());
                return true;
            case "apps":
                callback.onResult(apps(context));
                return true;
            case "case":
                callback.onResult(caseDetails(params));
                return true;
            case "status":
            case "result":
                callback.onResult(HarnessState.snapshot());
                return true;
            case "case-import-status":
                callback.onResult(importStatus(params.get("requestId")));
                return true;
            case "case-delete-status":
                callback.onResult(caseDeleteStatus(params.get("requestId")));
                return true;
            case "adb-connect-status":
                callback.onResult(adbConnectStatus(params.get("requestId")));
                return true;
            case "adb-connect":
                callback.onResult(adbConnect(context, params.get("requestId")));
                return true;
            case "case-import":
                Map<String, Object> importResult = caseImport(context, params);
                rememberImportResult(params.get("requestId"), importResult);
                callback.onResult(importResult);
                return true;
            case "case-delete":
                Map<String, Object> deleteResult = caseDelete(context, params);
                rememberCaseDeleteResult(params.get("requestId"), deleteResult);
                callback.onResult(deleteResult);
                return true;
            case "cancel":
                callback.onResult(cancel(context, params.get("runId")));
                return true;
            default:
                callback.onResult(error("unsupported_type", "Unsupported harness type: " + type));
                return true;
        }
    }

    private Map<String, Object> capabilities(Context context) {
        Map<String, Object> result = success();
        result.put("protocolVersion", PROTOCOL_VERSION);
        result.put("packageName", context.getPackageName());
        result.put("devicePort", SPService.getInt(SPService.KEY_CONTROL_PORT, 23342));
        result.put("queries", Arrays.asList("capabilities", "health", "info", "apps", "cases", "case",
                "status", "result", "case-import-status", "case-delete-status",
                "adb-connect-status"));
        result.put("commands", Arrays.asList("replay", "cancel", "config", "case-import",
                "case-delete", "record", "stress", "screen-record", "video-analysis",
                "history", "plugin", "scan", "adb-connect"));
        result.put("performanceQueries", Arrays.asList("listItems", "status", "current"));
        result.put("performanceCommands", Arrays.asList("start", "stop"));
        result.put("performanceDisplayQueries", Arrays.asList("status"));
        result.put("performanceDisplayCommands", Arrays.asList("start", "stop"));
        result.put("screenRecordQueries", Arrays.asList("status"));
        result.put("screenRecordCommands", Arrays.asList("start", "stop"));
        result.put("scanQueries", Arrays.asList("status"));
        result.put("scanCommands", Arrays.asList("start", "cancel"));
        result.put("videoAnalysisQueries", Arrays.asList("status"));
        result.put("videoAnalysisCommands", Arrays.asList("start"));
        result.put("historyQueries", Arrays.asList("listReplay", "getReplay",
                "listPerformance", "getPerformance", "mutationStatus"));
        result.put("historyCommands", Arrays.asList("deleteReplay", "deletePerformance"));
        result.put("pluginQueries", Arrays.asList("list", "mutationStatus"));
        result.put("pluginCommands", Arrays.asList("import", "remove"));
        result.put("agentProtocolVersion", "1.0");
        result.put("agentQueries", Arrays.asList("capabilities", "start-status", "status",
                "observe", "receipt", "timeline"));
        result.put("agentCommands", Arrays.asList("start", "act", "pause", "resume",
                "end", "cancel"));
        result.put("transports", Arrays.asList("adb-forward-http", "adb-scheme"));
        return result;
    }

    private Map<String, Object> health(Context context) {
        Map<String, Object> permissions = new LinkedHashMap<>();
        permissions.put("adb", PermissionUtil.getPermissionStatus(context, "adb"));
        permissions.put("float", PermissionUtil.getPermissionStatus(context, "float"));
        permissions.put("background", PermissionUtil.getPermissionStatus(context, "background"));
        permissions.put("powerSave", PermissionUtil.getPermissionStatus(context, "powerSave"));
        permissions.put("accessibility", PermissionUtil.getPermissionStatus(
                context, Settings.ACTION_ACCESSIBILITY_SETTINGS));

        boolean permissionsReady = true;
        for (Object value : permissions.values()) {
            permissionsReady = permissionsReady && Boolean.TRUE.equals(value);
        }
        boolean autoStart = SPService.getBoolean(SPService.KEY_REPLAY_AUTO_START, false);

        Map<String, Object> result = success();
        result.put("protocolVersion", PROTOCOL_VERSION);
        result.put("appInitialized", LauncherApplication.getInstance().hasFinishInit());
        result.put("permissions", permissions);
        result.put("autoStart", autoStart);
        result.put("ready", LauncherApplication.getInstance().hasFinishInit()
                && permissionsReady && autoStart);
        result.put("run", HarnessState.snapshot());
        return result;
    }

    private Map<String, Object> info(Context context) {
        Map<String, Object> result = success();
        result.put("protocolVersion", PROTOCOL_VERSION);
        result.put("packageName", context.getPackageName());
        try {
            PackageInfo packageInfo = context.getPackageManager()
                    .getPackageInfo(context.getPackageName(), 0);
            result.put("versionName", packageInfo.versionName);
            result.put("versionCode", packageInfo.versionCode);
        } catch (PackageManager.NameNotFoundException ignored) {
            result.put("versionName", null);
            result.put("versionCode", null);
        }
        Map<String, Object> device = new LinkedHashMap<>();
        device.put("manufacturer", Build.MANUFACTURER);
        device.put("brand", Build.BRAND);
        device.put("model", Build.MODEL);
        device.put("product", Build.PRODUCT);
        device.put("androidVersion", Build.VERSION.RELEASE);
        device.put("sdk", Build.VERSION.SDK_INT);
        device.put("supportedAbis", Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP
                ? Arrays.asList(Build.SUPPORTED_ABIS) : Arrays.asList(Build.CPU_ABI));
        result.put("device", device);
        result.put("license", "Apache-2.0");
        return result;
    }

    private Map<String, Object> cases() {
        List<RecordCaseInfo> caseInfos = GreenDaoManager.getInstance().getRecordCaseInfoDao()
                .queryBuilder().orderDesc(RecordCaseInfoDao.Properties.GmtModify).list();
        List<Map<String, Object>> caseSummaries = new ArrayList<>();
        if (caseInfos != null) {
            for (RecordCaseInfo caseInfo : caseInfos) {
                Map<String, Object> summary = new LinkedHashMap<>();
                summary.put("id", caseInfo.getId());
                summary.put("name", caseInfo.getCaseName());
                summary.put("description", caseInfo.getCaseDesc());
                summary.put("targetAppPackage", caseInfo.getTargetAppPackage());
                summary.put("targetAppLabel", caseInfo.getTargetAppLabel());
                summary.put("recordMode", caseInfo.getRecordMode());
                summary.put("createdAt", caseInfo.getGmtCreate());
                summary.put("modifiedAt", caseInfo.getGmtModify());
                caseSummaries.add(summary);
            }
        }

        Map<String, Object> result = success();
        result.put("count", caseSummaries.size());
        result.put("cases", caseSummaries);
        return result;
    }

    private Map<String, Object> apps(Context context) {
        List<Map<String, Object>> appSummaries = new ArrayList<>();
        List<ApplicationInfo> appInfos = MyApplication.getInstance().loadAppList();
        if (appInfos != null) {
            PackageManager packageManager = context.getPackageManager();
            for (ApplicationInfo appInfo : appInfos) {
                Map<String, Object> summary = new LinkedHashMap<>();
                summary.put("packageName", appInfo.packageName);
                summary.put("label", appInfo.loadLabel(packageManager).toString());
                summary.put("system", (appInfo.flags & ApplicationInfo.FLAG_SYSTEM) != 0);
                try {
                    PackageInfo packageInfo = packageManager.getPackageInfo(appInfo.packageName, 0);
                    summary.put("versionName", packageInfo.versionName);
                    summary.put("versionCode", packageInfo.versionCode);
                } catch (PackageManager.NameNotFoundException ignored) {
                    summary.put("versionName", null);
                    summary.put("versionCode", null);
                }
                appSummaries.add(summary);
            }
        }
        Map<String, Object> result = success();
        result.put("count", appSummaries.size());
        result.put("apps", appSummaries);
        result.put("includesSystemApps",
                SPService.getBoolean(SPService.KEY_DISPLAY_SYSTEM_APP, false));
        return result;
    }

    private Map<String, Object> caseDetails(Map<String, String> params) {
        String caseName = params.get("caseName");
        if (StringUtil.isEmpty(caseName)) {
            return error("missing_case_name", "Parameter 'caseName' is required");
        }
        List<RecordCaseInfo> caseInfos = findCases(caseName);
        if (caseInfos == null || caseInfos.isEmpty()) {
            return error("case_not_found", "Case not found: " + caseName);
        }

        RecordCaseInfo caseInfo;
        try {
            caseInfo = ReplaySchemeResolver.snapshotCase(caseInfos.get(0));
        } catch (IllegalArgumentException e) {
            return error("invalid_stored_case", "Stored case operation log cannot be loaded");
        }

        Map<String, Object> casePayload = new LinkedHashMap<>();
        casePayload.put("id", caseInfo.getId());
        casePayload.put("caseName", caseInfo.getCaseName());
        casePayload.put("caseDesc", caseInfo.getCaseDesc());
        casePayload.put("targetAppPackage", caseInfo.getTargetAppPackage());
        casePayload.put("targetAppLabel", caseInfo.getTargetAppLabel());
        casePayload.put("recordMode", caseInfo.getRecordMode());
        casePayload.put("advanceSettings", caseInfo.getAdvanceSettings());
        casePayload.put("operationLog", caseInfo.getOperationLog());
        casePayload.put("priority", caseInfo.getPriority());
        casePayload.put("gmtCreate", caseInfo.getGmtCreate());
        casePayload.put("gmtModify", caseInfo.getGmtModify());
        casePayload.put("caseFingerprint", ReplaySchemeResolver.caseFingerprint(caseInfo));

        Map<String, Object> result = success();
        result.put("case", casePayload);
        return result;
    }

    private Map<String, Object> caseDelete(Context context, Map<String, String> params) {
        if (!(context instanceof AdbSchemeActivity)) {
            return error("adb_required", "Case deletion is only available through the ADB scheme transport");
        }
        String requestId = params.get("requestId");
        String requestedCaseName = params.get("caseName");
        String confirmation = params.get("confirmCaseName");
        if (StringUtil.isEmpty(requestId)) {
            return error("missing_request_id", "Parameter 'requestId' is required");
        }
        if (StringUtil.isEmpty(requestedCaseName)) {
            return error("missing_case_name", "Parameter 'caseName' is required");
        }
        if (!StringUtil.equals(requestedCaseName, confirmation)) {
            return error("confirmation_mismatch", "confirmCaseName must exactly match caseName");
        }
        Map<String, Object> run = HarnessState.snapshot();
        if (Boolean.TRUE.equals(run.get("active"))
                && StringUtil.equals(requestedCaseName, String.valueOf(run.get("caseName")))) {
            return error("case_active", "The case is currently running and cannot be deleted");
        }

        List<RecordCaseInfo> cases = findCases(requestedCaseName);
        if (cases == null || cases.isEmpty()) {
            return error("case_not_found", "Case not found: " + requestedCaseName);
        }
        RecordCaseInfo target = cases.get(0);
        try {
            GreenDaoManager.getInstance().getRecordCaseInfoDao().delete(target);
            deleteStoredSteps(target);
        } catch (RuntimeException e) {
            return error("case_delete_failed", "SoloPi could not delete the case");
        }

        Map<String, Object> result = success();
        result.put("requestId", requestId);
        result.put("deleted", true);
        result.put("caseId", target.getId());
        result.put("caseName", target.getCaseName());
        return result;
    }

    private Map<String, Object> caseImport(Context context, Map<String, String> params) {
        if (!(context instanceof AdbSchemeActivity)) {
            return error("adb_required", "Case import is only available through the ADB scheme transport");
        }
        String requestId = params.get("requestId");
        String path = params.get("path");
        if (StringUtil.isEmpty(requestId)) {
            return error("missing_request_id", "Parameter 'requestId' is required");
        }
        if (StringUtil.isEmpty(path)) {
            return error("missing_path", "Parameter 'path' is required");
        }

        File importRoot = context.getExternalFilesDir("harness-import");
        if (importRoot == null) {
            return error("storage_unavailable", "SoloPi external import storage is unavailable");
        }
        File source = new File(path);
        try {
            String rootPath = importRoot.getCanonicalPath();
            String sourcePath = source.getCanonicalPath();
            if (!sourcePath.startsWith(rootPath + File.separator)) {
                return error("invalid_import_path", "Import path must be inside SoloPi harness storage");
            }
        } catch (IOException e) {
            return error("invalid_import_path", "Import path cannot be resolved");
        }
        if (!source.isFile()) {
            return error("case_file_not_found", "Case import file was not found");
        }

        String content = FileUtils.readFile(source);
        source.delete();
        if (StringUtil.isEmpty(content)) {
            return error("empty_case_file", "Case import file is empty or unreadable");
        }

        RecordCaseInfo caseInfo;
        GeneralOperationLogBean operationLog;
        try {
            caseInfo = JSON.parseObject(content, RecordCaseInfo.class);
            operationLog = caseInfo == null ? null
                    : JSON.parseObject(caseInfo.getOperationLog(), GeneralOperationLogBean.class);
        } catch (Exception e) {
            return error("invalid_case_json", "Case JSON cannot be parsed by SoloPi");
        }
        Map<String, Object> validationError = validateCase(caseInfo, operationLog);
        if (validationError != null) {
            return validationError;
        }

        boolean replace = Boolean.parseBoolean(params.get("replace"));
        List<RecordCaseInfo> existingCases = findCases(caseInfo.getCaseName());
        if (existingCases != null && !existingCases.isEmpty() && !replace) {
            return error("duplicate_case", "Case already exists; pass --replace to overwrite it");
        }

        long now = System.currentTimeMillis();
        caseInfo.setId(null);
        caseInfo.setGmtCreate(now);
        caseInfo.setGmtModify(now);
        if (StringUtil.isEmpty(caseInfo.getRecordMode())) {
            caseInfo.setRecordMode("local");
        }
        if (StringUtil.isEmpty(caseInfo.getTargetAppLabel())) {
            caseInfo.setTargetAppLabel(caseInfo.getTargetAppPackage());
        }
        if (caseInfo.getCaseDesc() == null) {
            caseInfo.setCaseDesc("");
        }
        if (caseInfo.getAdvanceSettings() == null) {
            caseInfo.setAdvanceSettings("");
        }

        int stepCount = operationLog.getSteps().size();
        operationLog.setStorePath(null);
        OperationStepUtil.beforeStore(operationLog);
        if (StringUtil.isEmpty(operationLog.getStorePath())) {
            return error("step_storage_failed", "SoloPi could not persist imported case steps");
        }
        caseInfo.setOperationLog(JSON.toJSONString(operationLog));

        final RecordCaseInfoDao dao = GreenDaoManager.getInstance().getRecordCaseInfoDao();
        try {
            final RecordCaseInfo importedCase = caseInfo;
            final List<RecordCaseInfo> replacedCases = existingCases;
            dao.getSession().runInTx(new Runnable() {
                @Override
                public void run() {
                    dao.insert(importedCase);
                    if (replacedCases != null && !replacedCases.isEmpty()) {
                        dao.deleteInTx(replacedCases);
                    }
                }
            });
            if (existingCases != null) {
                for (RecordCaseInfo existingCase : existingCases) {
                    deleteStoredSteps(existingCase);
                }
            }
        } catch (Exception e) {
            deleteStoredSteps(caseInfo);
            return error("case_import_failed", "SoloPi could not insert the imported case");
        }

        Map<String, Object> result = success();
        result.put("requestId", requestId);
        result.put("imported", true);
        result.put("caseName", caseInfo.getCaseName());
        result.put("caseId", caseInfo.getId());
        result.put("replaced", existingCases == null ? 0 : existingCases.size());
        result.put("stepCount", stepCount);
        return result;
    }

    private Map<String, Object> validateCase(RecordCaseInfo caseInfo,
                                             GeneralOperationLogBean operationLog) {
        if (caseInfo == null || StringUtil.isEmpty(caseInfo.getCaseName())) {
            return error("invalid_case", "Case name is required");
        }
        if (StringUtil.isEmpty(caseInfo.getTargetAppPackage())) {
            return error("invalid_case", "Target app package is required");
        }
        if (caseInfo.getPriority() < RecordCaseInfo.HIGHEST_PRIORITY
                || caseInfo.getPriority() > RecordCaseInfo.LOWEST_PRIORITY) {
            return error("invalid_case", "Case priority must be between 0 and 2");
        }
        if (operationLog == null || operationLog.getSteps() == null
                || operationLog.getSteps().isEmpty()) {
            return error("invalid_case", "Case must contain at least one inline operation step");
        }
        Set<String> stepIds = new HashSet<>();
        for (int i = 0; i < operationLog.getSteps().size(); i++) {
            OperationStep step = operationLog.getSteps().get(i);
            if (step == null || step.getOperationMethod() == null
                    || step.getOperationMethod().getActionEnum() == null) {
                return error("invalid_case", "Case step " + i + " has no supported action");
            }
            if (StringUtil.isEmpty(step.getOperationId()) || StringUtil.isEmpty(step.getStepId())) {
                return error("invalid_case", "Case step " + i + " has no operationId or stepId");
            }
            if (step.getOperationIndex() < 0) {
                return error("invalid_case", "Case step " + i + " has a negative operationIndex");
            }
            if (!stepIds.add(step.getStepId())) {
                return error("invalid_case", "Case step " + i + " has a duplicate stepId");
            }
            if (step.getOperationMethod().getActionEnum().getCategory()
                    == PerformActionEnum.CATEGORY_NODE_OPERATION) {
                OperationNode node = step.getOperationNode();
                if (node == null || !hasNodeSelector(node)) {
                    return error("invalid_case", "Case step " + i + " has no grounded node selector");
                }
            }
        }
        return null;
    }

    private boolean hasNodeSelector(OperationNode node) {
        return !StringUtil.isEmpty(node.getResourceId())
                || !StringUtil.isEmpty(node.getText())
                || !StringUtil.isEmpty(node.getDescription())
                || !StringUtil.isEmpty(node.getXpath())
                || !StringUtil.isEmpty(node.getId());
    }

    private List<RecordCaseInfo> findCases(String caseName) {
        return GreenDaoManager.getInstance().getRecordCaseInfoDao().queryBuilder()
                .where(RecordCaseInfoDao.Properties.CaseName.eq(caseName))
                .orderDesc(RecordCaseInfoDao.Properties.Id).list();
    }

    private void deleteStoredSteps(RecordCaseInfo caseInfo) {
        try {
            GeneralOperationLogBean log = JSON.parseObject(
                    caseInfo.getOperationLog(), GeneralOperationLogBean.class);
            if (log != null && !StringUtil.isEmpty(log.getStorePath())) {
                FileUtils.deleteFile(new File(log.getStorePath()));
            }
        } catch (Exception ignored) {
            // 格式错误的旧用例不能阻止替换对应数据库记录。
        }
    }

    private void rememberImportResult(String requestId, Map<String, Object> result) {
        synchronized (HarnessSchemeResolver.class) {
            lastImportResult = new LinkedHashMap<>(result);
            lastImportResult.put("requestId", requestId);
        }
    }

    private Map<String, Object> importStatus(String requestId) {
        if (StringUtil.isEmpty(requestId)) {
            return error("missing_request_id", "Parameter 'requestId' is required");
        }
        synchronized (HarnessSchemeResolver.class) {
            if (lastImportResult == null || !requestId.equals(lastImportResult.get("requestId"))) {
                Map<String, Object> result = error(
                        "import_receipt_not_found", "No matching case import receipt is available");
                result.put("requestId", requestId);
                return result;
            }
            return new LinkedHashMap<>(lastImportResult);
        }
    }

    private void rememberCaseDeleteResult(String requestId, Map<String, Object> result) {
        synchronized (HarnessSchemeResolver.class) {
            lastCaseDeleteResult = new LinkedHashMap<>(result);
            lastCaseDeleteResult.put("requestId", requestId);
        }
    }

    private Map<String, Object> caseDeleteStatus(String requestId) {
        if (StringUtil.isEmpty(requestId)) {
            return error("missing_request_id", "Parameter 'requestId' is required");
        }
        synchronized (HarnessSchemeResolver.class) {
            if (lastCaseDeleteResult == null
                    || !requestId.equals(lastCaseDeleteResult.get("requestId"))) {
                Map<String, Object> result = error(
                        "case_delete_receipt_not_found",
                        "No matching case delete receipt is available");
                result.put("requestId", requestId);
                return result;
            }
            return new LinkedHashMap<>(lastCaseDeleteResult);
        }
    }

    private Map<String, Object> adbConnect(final Context context, final String requestId) {
        if (!(context instanceof AdbSchemeActivity)) {
            return adbConnectError(requestId, "adb_required",
                    "ADB connection is only available through the ADB scheme transport", false);
        }
        if (StringUtil.isEmpty(requestId)) {
            return adbConnectError(null, "missing_request_id",
                    "Parameter 'requestId' is required", false);
        }

        final long startedAt = System.currentTimeMillis();
        synchronized (HarnessSchemeResolver.class) {
            Map<String, Object> existing = ADB_CONNECT_RECEIPTS.get(requestId);
            if (existing != null) {
                return new LinkedHashMap<>(existing);
            }
            if (CmdTools.getConnectionStatus()) {
                Map<String, Object> connected = adbConnectReceipt(
                        requestId, "connected", true, true, false, null,
                        startedAt, startedAt);
                rememberAdbConnectReceipt(requestId, connected);
                return new LinkedHashMap<>(connected);
            }
            if (!StringUtil.isEmpty(activeAdbConnectRequestId)) {
                Map<String, Object> busy = adbConnectError(requestId,
                        "adb_connection_busy", "Another ADB connection request is active", false);
                busy.put("activeRequestId", activeAdbConnectRequestId);
                rememberAdbConnectReceipt(requestId, busy);
                return new LinkedHashMap<>(busy);
            }

            activeAdbConnectRequestId = requestId;
            rememberAdbConnectReceipt(requestId, adbConnectReceipt(
                    requestId, "connecting", false, false, false, null,
                    startedAt, null));
        }

        try {
            BackgroundExecutor.execute(new Runnable() {
                @Override
                public void run() {
                    boolean connected = false;
                    try {
                        connected = CmdTools.generateConnection()
                                && CmdTools.getConnectionStatus();
                    } catch (RuntimeException ignored) {
                        connected = false;
                    }

                    synchronized (HarnessSchemeResolver.class) {
                        if (!requestId.equals(activeAdbConnectRequestId)) {
                            return;
                        }
                        activeAdbConnectRequestId = null;
                        long finishedAt = System.currentTimeMillis();
                        Map<String, Object> result;
                        if (connected) {
                            result = adbConnectReceipt(requestId, "connected", true,
                                    true, false, null, startedAt, finishedAt);
                        } else {
                            result = adbConnectError(requestId, "adb_connection_failed",
                                    "SoloPi internal ADB connection failed", true);
                            result.put("startedAt", startedAt);
                            result.put("finishedAt", finishedAt);
                        }
                        rememberAdbConnectReceipt(requestId, result);
                    }
                }
            });
        } catch (RuntimeException exception) {
            synchronized (HarnessSchemeResolver.class) {
                if (requestId.equals(activeAdbConnectRequestId)) {
                    activeAdbConnectRequestId = null;
                }
                Map<String, Object> failed = adbConnectError(requestId,
                        "adb_connection_schedule_failed",
                        "SoloPi could not schedule the internal ADB connection", false);
                failed.put("startedAt", startedAt);
                failed.put("finishedAt", System.currentTimeMillis());
                rememberAdbConnectReceipt(requestId, failed);
                return new LinkedHashMap<>(failed);
            }
        }

        return adbConnectStatus(requestId);
    }

    private Map<String, Object> adbConnectStatus(String requestId) {
        if (StringUtil.isEmpty(requestId)) {
            return adbConnectError(null, "missing_request_id",
                    "Parameter 'requestId' is required", false);
        }
        synchronized (HarnessSchemeResolver.class) {
            Map<String, Object> receipt = ADB_CONNECT_RECEIPTS.get(requestId);
            if (receipt == null) {
                return adbConnectError(requestId, "adb_connect_receipt_not_found",
                        "No matching ADB connection receipt is available", false);
            }
            return new LinkedHashMap<>(receipt);
        }
    }

    private static Map<String, Object> adbConnectReceipt(String requestId, String state,
                                                          boolean connected, boolean terminal,
                                                          boolean userActionRequired,
                                                          String requiredUserAction,
                                                          Long startedAt, Long finishedAt) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", !"failed".equals(state));
        result.put("requestId", requestId);
        result.put("state", state);
        result.put("connected", connected);
        result.put("terminal", terminal);
        result.put("userActionRequired", userActionRequired);
        result.put("requiredUserAction", requiredUserAction);
        result.put("startedAt", startedAt);
        result.put("finishedAt", finishedAt);
        return result;
    }

    private static Map<String, Object> adbConnectError(String requestId, String code,
                                                        String message,
                                                        boolean userActionRequired) {
        Map<String, Object> result = adbConnectReceipt(requestId, "failed", false,
                true, userActionRequired,
                userActionRequired ? ADB_CONNECT_REQUIRED_USER_ACTION : null,
                null, System.currentTimeMillis());
        result.put("success", false);
        result.put("errorCode", code);
        result.put("error", message);
        return result;
    }

    private static void rememberAdbConnectReceipt(String requestId,
                                                   Map<String, Object> receipt) {
        ADB_CONNECT_RECEIPTS.put(requestId, new LinkedHashMap<>(receipt));
        while (ADB_CONNECT_RECEIPTS.size() > MAX_ADB_CONNECT_RECEIPTS) {
            String removable = null;
            for (String candidate : ADB_CONNECT_RECEIPTS.keySet()) {
                if (!candidate.equals(activeAdbConnectRequestId)) {
                    removable = candidate;
                    break;
                }
            }
            if (removable == null) {
                break;
            }
            ADB_CONNECT_RECEIPTS.remove(removable);
        }
    }

    private Map<String, Object> cancel(Context context, String expectedRunId) {
        if (!(context instanceof AdbSchemeActivity)) {
            return error("adb_required", "Cancel is only available through the ADB scheme transport");
        }
        if (StringUtil.isEmpty(expectedRunId)) {
            return error("missing_run_id", "Parameter 'runId' is required");
        }
        Map<String, Object> before = HarnessState.snapshot();
        if (!expectedRunId.equals(before.get("runId"))) {
            Map<String, Object> result = error(
                    "run_id_mismatch", "Harness runId does not match the active run");
            result.put("run", before);
            return result;
        }
        if (!HarnessState.requestCancel(expectedRunId)) {
            return error("no_active_run", "There is no active harness run");
        }

        CaseReplayManager manager = LauncherApplication.getInstance()
                .findServiceByName(CaseReplayManager.class.getName());
        if (manager == null || !manager.isRunning()) {
            HarnessState.finishCancellation(expectedRunId);
        } else {
            manager.stopRunning();
        }

        Map<String, Object> result = success();
        result.put("accepted", true);
        result.put("run", HarnessState.snapshot());
        return result;
    }

    private Map<String, Object> success() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        return result;
    }

    private Map<String, Object> error(String code, String message) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", false);
        result.put("errorCode", code);
        result.put("error", message);
        return result;
    }
}
