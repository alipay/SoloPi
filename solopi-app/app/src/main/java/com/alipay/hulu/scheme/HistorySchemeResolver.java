/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
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

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.scheme.SchemeActionResolver;
import com.alipay.hulu.common.scheme.AdbSchemeActivity;
import com.alipay.hulu.common.scheme.SchemeResolver;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.SortedList;
import com.alipay.hulu.service.CaseReplayManager;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.charset.Charset;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Bounded, path-safe access to locally stored replay and performance history.
 *
 * <p>Callers address records by opaque IDs. Paths are never accepted as input, and every record
 * is resolved again from a canonical direct child of the corresponding SoloPi storage root.</p>
 */
@SchemeResolver("history")
public class HistorySchemeResolver implements SchemeActionResolver {
    private static final String TAG = HistorySchemeResolver.class.getSimpleName();

    private static final String PARAM_ACTION = "action";
    private static final String PARAM_ID = "id";
    private static final String PARAM_CONFIRM_ID = "confirmId";
    private static final String PARAM_REQUEST_ID = "requestId";
    private static final String PARAM_LIMIT = "limit";

    private static final String ACTION_LIST_REPLAY = "listReplay";
    private static final String ACTION_GET_REPLAY = "getReplay";
    private static final String ACTION_DELETE_REPLAY = "deleteReplay";
    private static final String ACTION_LIST_PERFORMANCE = "listPerformance";
    private static final String ACTION_GET_PERFORMANCE = "getPerformance";
    private static final String ACTION_DELETE_PERFORMANCE = "deletePerformance";
    private static final String ACTION_MUTATION_STATUS = "mutationStatus";

    private static final String KIND_REPLAY = "replay";
    private static final String KIND_PERFORMANCE = "performance";
    private static final String REPLAY_ID_PREFIX = "replay-";
    private static final String PERFORMANCE_ID_PREFIX = "performance-";

    private static final Charset UTF_8 = Charset.forName("UTF-8");
    private static final int DEFAULT_LIST_LIMIT = 100;
    private static final int MAX_LIST_LIMIT = 500;
    private static final int MAX_LIST_METRICS = 20;
    private static final int MAX_DETAIL_FILES = 64;
    private static final int MAX_FILE_DESCRIPTORS = 256;
    private static final int MAX_DELETE_ENTRIES = 2048;
    private static final int MAX_INFO_BYTES = 256 * 1024;
    private static final int MAX_DEVICE_BYTES = 128 * 1024;
    private static final int MAX_JSON_DETAIL_BYTES = 256 * 1024;
    private static final int MAX_LOG_PREVIEW_BYTES = 64 * 1024;
    private static final int MAX_CSV_PREVIEW_BYTES = 64 * 1024;
    private static final int MAX_CSV_TOTAL_PREVIEW_BYTES = 512 * 1024;
    private static final int MAX_RECEIPTS = 64;

    private static final Pattern REQUEST_ID_PATTERN =
            Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,127}");
    private static final Pattern REPLAY_ID_PATTERN =
            Pattern.compile("replay-[0-9a-f]{64}");
    private static final Pattern PERFORMANCE_ID_PATTERN =
            Pattern.compile("performance-[0-9a-f]{64}");
    private static final Pattern PERFORMANCE_SESSION_FOLDER =
            Pattern.compile("performance-[A-Za-z0-9][A-Za-z0-9._-]{0,115}");
    private static final Pattern NEW_PERFORMANCE_FOLDER =
            Pattern.compile("\\d{14}_\\d{14}");
    private static final Pattern MID_PERFORMANCE_FOLDER = Pattern.compile(
            "\\d{2}月\\d{2}日\\d{2}:\\d{2}:\\d{2}-\\d{2}月\\d{2}日\\d{2}:\\d{2}:\\d{2}");
    private static final Pattern OLD_PERFORMANCE_FOLDER = Pattern.compile(
            "\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}_\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}");
    private static final Pattern STRICT_PERFORMANCE_FILE = Pattern.compile(
            "(.+?)_(.+?)_([0-9a-fA-F]{16})_(\\d+)_(\\d+)\\.csv");
    private static final Pattern LEGACY_PERFORMANCE_FILE = Pattern.compile(
            "(.+?)_(.+?)_(\\d+)_(\\d+)\\.csv");

    private static final Object RECEIPT_LOCK = new Object();
    private static final LinkedHashMap<String, Map<String, Object>> MUTATION_RECEIPTS =
            new LinkedHashMap<String, Map<String, Object>>(MAX_RECEIPTS, 0.75F, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Map<String, Object>> eldest) {
                    return size() > MAX_RECEIPTS;
                }
            };

    @Override
    public boolean processScheme(Context context, Map<String, String> params,
                                 Callback<Map<String, Object>> callback) {
        Map<String, Object> result;
        try {
            if (params == null) {
                result = error("missing_action", "Parameter 'action' is required");
            } else {
                String action = params.get(PARAM_ACTION);
                if (action == null || action.length() == 0) {
                    result = error("missing_action", "Parameter 'action' is required");
                } else if (ACTION_LIST_REPLAY.equals(action)) {
                    result = listReplay(params);
                } else if (ACTION_GET_REPLAY.equals(action)) {
                    result = getReplay(params.get(PARAM_ID));
                } else if (ACTION_LIST_PERFORMANCE.equals(action)) {
                    result = listPerformance(params);
                } else if (ACTION_GET_PERFORMANCE.equals(action)) {
                    result = getPerformance(params.get(PARAM_ID));
                } else if (ACTION_MUTATION_STATUS.equals(action)) {
                    result = mutationStatus(params.get(PARAM_REQUEST_ID));
                } else if (ACTION_DELETE_REPLAY.equals(action)) {
                    result = deleteRecord(context, params, KIND_REPLAY);
                } else if (ACTION_DELETE_PERFORMANCE.equals(action)) {
                    result = deleteRecord(context, params, KIND_PERFORMANCE);
                } else {
                    result = error("unsupported_action", "Unsupported history action: " + action);
                }
            }
        } catch (HistoryException e) {
            result = error(e.errorCode, e.getMessage());
        } catch (IOException e) {
            LogUtil.w(TAG, "Unable to access history storage", e);
            result = error("io_error", "Unable to access history storage");
        } catch (RuntimeException e) {
            LogUtil.e(TAG, "Unexpected history resolver failure", e);
            result = error("internal_error", "Unable to process history request");
        }
        callback.onResult(result);
        return true;
    }

    private Map<String, Object> listReplay(Map<String, String> params)
            throws IOException, HistoryException {
        int limit = parseLimit(params.get(PARAM_LIMIT));
        List<RecordRef> records = loadReplayRecords();
        sortRecords(records);

        List<Map<String, Object>> items = new ArrayList<Map<String, Object>>(
                Math.min(limit, records.size()));
        for (int i = 0; i < records.size() && i < limit; i++) {
            items.add(replaySummary(records.get(i)));
        }

        Map<String, Object> result = success();
        result.put("kind", KIND_REPLAY);
        result.put("records", items);
        result.put("total", records.size());
        result.put("returned", items.size());
        result.put("truncated", items.size() < records.size());
        return result;
    }

    private Map<String, Object> getReplay(String id) throws IOException, HistoryException {
        validateRecordId(id, KIND_REPLAY);
        RecordRef record = findRecord(loadReplayRecords(), id);
        if (record == null) {
            return error("record_not_found", "Replay history record was not found");
        }

        JSONObject info = readJsonObject(record.infoFile, MAX_INFO_BYTES,
                "replay metadata");
        record.info = info;
        record.metadataError = null;
        Map<String, Object> result = success();
        result.putAll(replaySummary(record));
        result.put("info", info);

        File[] children = record.folder.listFiles();
        if (children == null) {
            throw new IOException("Unable to enumerate replay record");
        }
        Arrays.sort(children, FILE_NAME_COMPARATOR);
        List<Map<String, Object>> files = new ArrayList<Map<String, Object>>();
        boolean descriptorsTruncated = false;
        for (File child : children) {
            if (!isSafeDirectFile(record.folder, child)) {
                continue;
            }
            if (files.size() >= MAX_FILE_DESCRIPTORS) {
                descriptorsTruncated = true;
                break;
            }
            files.add(fileDescriptor(record, child));
        }
        result.put("files", files);
        result.put("filesTruncated", descriptorsTruncated);

        File device = new File(record.folder, "device.json");
        if (device.exists()) {
            result.put("device", boundedJsonContent(record, device, MAX_DEVICE_BYTES));
        }
        File steps = new File(record.folder, "steps.json");
        if (steps.exists()) {
            result.put("steps", boundedJsonContent(record, steps, MAX_JSON_DETAIL_BYTES));
        }
        File actions = new File(record.folder, "actions.json");
        if (actions.exists()) {
            result.put("actions", boundedJsonContent(record, actions, MAX_JSON_DETAIL_BYTES));
        }
        File log = new File(record.folder, "running.log");
        if (log.exists()) {
            result.put("log", boundedTextPreview(record, log, UTF_8,
                    MAX_LOG_PREVIEW_BYTES));
        }
        return result;
    }

    private Map<String, Object> listPerformance(Map<String, String> params)
            throws IOException, HistoryException {
        int limit = parseLimit(params.get(PARAM_LIMIT));
        List<RecordRef> records = loadPerformanceRecords();
        sortRecords(records);

        List<Map<String, Object>> items = new ArrayList<Map<String, Object>>(
                Math.min(limit, records.size()));
        for (int i = 0; i < records.size() && i < limit; i++) {
            items.add(performanceSummary(records.get(i), true));
        }

        Map<String, Object> result = success();
        result.put("kind", KIND_PERFORMANCE);
        result.put("records", items);
        result.put("total", records.size());
        result.put("returned", items.size());
        result.put("truncated", items.size() < records.size());
        return result;
    }

    private Map<String, Object> getPerformance(String id)
            throws IOException, HistoryException {
        validateRecordId(id, KIND_PERFORMANCE);
        RecordRef record = findRecord(loadPerformanceRecords(), id);
        if (record == null) {
            return error("record_not_found", "Performance history record was not found");
        }

        Map<String, Object> result = success();
        result.putAll(performanceSummary(record, false));
        List<Map<String, Object>> files = new ArrayList<Map<String, Object>>();
        Charset charset = performanceCharset();
        int remainingPreviewBytes = MAX_CSV_TOTAL_PREVIEW_BYTES;
        boolean truncated = false;
        for (File file : record.dataFiles) {
            if (files.size() >= MAX_DETAIL_FILES) {
                truncated = true;
                break;
            }
            int previewLimit = Math.min(MAX_CSV_PREVIEW_BYTES, remainingPreviewBytes);
            Map<String, Object> item = performanceFileSummary(record, file);
            if (previewLimit > 0) {
                item.put("preview", boundedTextPreview(record, file, charset, previewLimit));
                remainingPreviewBytes -= Math.min(previewLimit,
                        file.length() > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) file.length());
            } else {
                item.put("preview", omittedContent(file, 0, "total_content_limit"));
                truncated = true;
            }
            files.add(item);
        }
        result.put("files", files);
        result.put("filesTruncated", truncated || files.size() < record.dataFiles.size());
        result.put("contentLimitBytes", MAX_CSV_TOTAL_PREVIEW_BYTES);
        return result;
    }

    private Map<String, Object> deleteRecord(Context context, Map<String, String> params,
                                              String kind)
            throws IOException, HistoryException {
        if (!(context instanceof AdbSchemeActivity)) {
            return error("mutation_transport_required",
                    "History deletion requires the ADB scheme transport");
        }
        String requestId = params.get(PARAM_REQUEST_ID);
        String id = params.get(PARAM_ID);
        String confirmId = params.get(PARAM_CONFIRM_ID);
        if (requestId == null || requestId.length() == 0) {
            return error("missing_request_id", "Parameter 'requestId' is required");
        }
        if (!REQUEST_ID_PATTERN.matcher(requestId).matches()) {
            return error("invalid_request_id", "Parameter 'requestId' is invalid");
        }
        validateRecordId(id, kind);
        if (confirmId == null || !id.equals(confirmId)) {
            return error("confirmation_mismatch", "Parameter 'confirmId' must exactly match 'id'");
        }

        String action = KIND_REPLAY.equals(kind)
                ? ACTION_DELETE_REPLAY : ACTION_DELETE_PERFORMANCE;
        MutationStart mutation = beginMutation(requestId, action, id, kind);
        if (mutation.conflict) {
            return error("request_id_conflict",
                    "The requestId is already associated with another mutation");
        }
        if (!mutation.created) {
            return mutation.receipt;
        }

        try {
            List<RecordRef> records = KIND_REPLAY.equals(kind)
                    ? loadReplayRecords() : loadPerformanceRecords();
            RecordRef record = findRecord(records, id);
            if (record == null) {
                return finishMutation(requestId, action, id, kind, false,
                        "record_not_found", "History record was not found", 0);
            }

            ActiveCheck active = KIND_REPLAY.equals(kind)
                    ? replayActiveCheck() : performanceActiveCheck(context);
            if (!active.known) {
                return finishMutation(requestId, action, id, kind, false,
                        "activity_status_unavailable",
                        "Unable to verify that the related activity is idle", 0);
            }
            if (active.active) {
                return finishMutation(requestId, action, id, kind, false,
                        KIND_REPLAY.equals(kind) ? "replay_active" : "performance_active",
                        "An active " + kind + " session prevents history deletion", 0);
            }

            DeleteResult deleted = deleteDirectRecord(record);
            if (!deleted.success) {
                return finishMutation(requestId, action, id, kind, false,
                        deleted.errorCode, deleted.error, deleted.deletedFiles);
            }
            return finishMutation(requestId, action, id, kind, true,
                    null, null, deleted.deletedFiles);
        } catch (IOException e) {
            LogUtil.w(TAG, "Unable to delete history record", e);
            return finishMutation(requestId, action, id, kind, false,
                    "delete_failed", "Unable to delete history record", 0);
        } catch (RuntimeException e) {
            LogUtil.e(TAG, "Unexpected history deletion failure", e);
            return finishMutation(requestId, action, id, kind, false,
                    "delete_failed", "Unable to delete history record", 0);
        }
    }

    private Map<String, Object> mutationStatus(String requestId) {
        if (requestId == null || requestId.length() == 0) {
            return error("missing_request_id", "Parameter 'requestId' is required");
        }
        if (!REQUEST_ID_PATTERN.matcher(requestId).matches()) {
            return error("invalid_request_id", "Parameter 'requestId' is invalid");
        }
        Map<String, Object> receipt;
        synchronized (RECEIPT_LOCK) {
            Map<String, Object> stored = MUTATION_RECEIPTS.get(requestId);
            receipt = stored == null ? null : new LinkedHashMap<String, Object>(stored);
        }
        if (receipt == null) {
            return error("receipt_not_found", "Mutation receipt was not found");
        }
        Map<String, Object> result = success();
        result.put("requestId", requestId);
        result.put("state", receipt.get("state"));
        result.put("mutation", receipt);
        return result;
    }

    private List<RecordRef> loadReplayRecords() throws IOException {
        File root = canonicalRoot("replay");
        File[] children = root.listFiles();
        if (children == null) {
            return Collections.emptyList();
        }
        List<RecordRef> records = new ArrayList<RecordRef>();
        for (File child : children) {
            if (!isSafeDirectDirectory(root, child)) {
                continue;
            }
            File info = new File(child, "info.json");
            if (!isSafeDirectFile(child, info)) {
                continue;
            }
            RecordRef record = new RecordRef(KIND_REPLAY, root, child,
                    stableId(KIND_REPLAY, child.getName()));
            record.infoFile = info;
            try {
                record.info = readJsonObject(info, MAX_INFO_BYTES, "replay metadata");
                record.sortTime = longValue(record.info.get("startTime"), child.lastModified());
            } catch (HistoryException e) {
                record.metadataError = e.errorCode;
                record.sortTime = child.lastModified();
            }
            records.add(record);
        }
        return records;
    }

    private List<RecordRef> loadPerformanceRecords() throws IOException {
        File root = canonicalRoot("records");
        File[] children = root.listFiles();
        if (children == null) {
            return Collections.emptyList();
        }
        List<RecordRef> records = new ArrayList<RecordRef>();
        for (File child : children) {
            if (!isSafeDirectDirectory(root, child)
                    || !isPerformanceFolderName(child.getName())) {
                continue;
            }
            List<File> csvFiles = performanceFiles(child);
            if (csvFiles.isEmpty()) {
                continue;
            }
            RecordRef record = new RecordRef(KIND_PERFORMANCE, root, child,
                    stableId(KIND_PERFORMANCE, child.getName()));
            record.dataFiles = csvFiles;
            record.sortTime = performanceEndTime(csvFiles, child.lastModified());
            records.add(record);
        }
        return records;
    }

    private Map<String, Object> replaySummary(RecordRef record) throws IOException {
        Map<String, Object> item = baseSummary(record);
        if (record.info == null) {
            item.put("metadataAvailable", false);
            item.put("metadataError", record.metadataError);
            return item;
        }
        item.put("metadataAvailable", true);
        copyIfPresent(record.info, item, "caseName");
        copyIfPresent(record.info, item, "targetApp");
        copyIfPresent(record.info, item, "targetAppPkg");
        copyIfPresent(record.info, item, "targetAppVersion");
        copyIfPresent(record.info, item, "startTime");
        copyIfPresent(record.info, item, "endTime");
        copyIfPresent(record.info, item, "exceptionMessage");
        copyIfPresent(record.info, item, "exceptionStep");
        copyIfPresent(record.info, item, "exceptionStepId");
        copyIfPresent(record.info, item, "platform");
        copyIfPresent(record.info, item, "platformVersion");
        item.put("status", record.info.get("exceptionMessage") == null ? "passed" : "failed");
        return item;
    }

    private Map<String, Object> performanceSummary(RecordRef record, boolean includeMetrics)
            throws IOException {
        Map<String, Object> item = baseSummary(record);
        long start = Long.MAX_VALUE;
        long end = Long.MIN_VALUE;
        long size = 0L;
        List<String> metrics = new ArrayList<String>();
        for (File file : record.dataFiles) {
            PerformanceFile parsed = parsePerformanceFile(file);
            if (parsed != null) {
                start = Math.min(start, parsed.startTime);
                end = Math.max(end, parsed.endTime);
                if (includeMetrics && metrics.size() < MAX_LIST_METRICS) {
                    metrics.add(parsed.name);
                }
            }
            size = safeAdd(size, file.length());
        }
        item.put("startTime", start == Long.MAX_VALUE ? null : start);
        item.put("endTime", end == Long.MIN_VALUE ? null : end);
        item.put("fileCount", record.dataFiles.size());
        item.put("sizeBytes", size);
        if (includeMetrics) {
            item.put("metrics", metrics);
            item.put("metricsTruncated", metrics.size() < record.dataFiles.size());
        }
        return item;
    }

    private Map<String, Object> baseSummary(RecordRef record) throws IOException {
        Map<String, Object> item = new LinkedHashMap<String, Object>();
        item.put("id", record.id);
        item.put("kind", record.kind);
        item.put("modifiedAt", record.folder.lastModified());
        String relativePath = controlledRelativePath(record.folder.getName());
        item.put("relativePath", relativePath);
        item.put("pathAvailable", relativePath != null);
        return item;
    }

    private Map<String, Object> performanceFileSummary(RecordRef record, File file)
            throws IOException {
        Map<String, Object> result = fileDescriptor(record, file);
        PerformanceFile parsed = parsePerformanceFile(file);
        if (parsed != null) {
            result.put("name", parsed.name);
            result.put("source", parsed.source);
            result.put("startTime", parsed.startTime);
            result.put("endTime", parsed.endTime);
        }
        return result;
    }

    private Map<String, Object> fileDescriptor(RecordRef record, File file)
            throws IOException {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("fileName", file.getName());
        result.put("sizeBytes", file.length());
        result.put("modifiedAt", file.lastModified());
        String relativePath = controlledRelativePath(record.folder.getName(), file.getName());
        result.put("relativePath", relativePath);
        result.put("pathAvailable", relativePath != null);
        return result;
    }

    private Map<String, Object> boundedJsonContent(RecordRef record, File file, int maxBytes)
            throws IOException {
        if (!isSafeDirectFile(record.folder, file)) {
            return contentError(file, "unsafe_file", "File is not a safe direct record child");
        }
        Map<String, Object> result = fileDescriptor(record, file);
        result.put("format", "json");
        if (file.length() > maxBytes) {
            result.putAll(omittedContent(file, maxBytes, "content_limit"));
            return result;
        }
        byte[] bytes = readPrefix(file, maxBytes + 1);
        if (bytes.length > maxBytes) {
            result.putAll(omittedContent(file, maxBytes, "content_limit"));
            return result;
        }
        try {
            result.put("content", JSON.parse(new String(bytes, UTF_8)));
        } catch (RuntimeException e) {
            result.put("contentAvailable", false);
            result.put("errorCode", "invalid_json");
            result.put("error", "Stored JSON content is invalid");
        }
        return result;
    }

    private Map<String, Object> boundedTextPreview(RecordRef record, File file, Charset charset,
                                                   int maxBytes) throws IOException {
        if (!isSafeDirectFile(record.folder, file)) {
            return contentError(file, "unsafe_file", "File is not a safe direct record child");
        }
        Map<String, Object> result = fileDescriptor(record, file);
        byte[] bytes = readPrefix(file, maxBytes + 1);
        boolean truncated = bytes.length > maxBytes || file.length() > maxBytes;
        int length = Math.min(bytes.length, maxBytes);
        result.put("text", new String(bytes, 0, length, charset));
        result.put("charset", charset.name());
        result.put("truncated", truncated);
        result.put("contentLimitBytes", maxBytes);
        return result;
    }

    private Map<String, Object> omittedContent(File file, int maxBytes, String reason) {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("sizeBytes", file.length());
        result.put("contentAvailable", false);
        result.put("omitted", true);
        result.put("reason", reason);
        result.put("contentLimitBytes", maxBytes);
        return result;
    }

    private Map<String, Object> contentError(File file, String errorCode, String message) {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("fileName", file.getName());
        result.put("contentAvailable", false);
        result.put("errorCode", errorCode);
        result.put("error", message);
        return result;
    }

    private DeleteResult deleteDirectRecord(RecordRef record) throws IOException {
        if (!isSafeDirectDirectory(record.root, record.folder)) {
            return DeleteResult.error("unsafe_record_layout", "Record directory is no longer safe", 0);
        }
        File[] children = record.folder.listFiles();
        if (children == null) {
            return DeleteResult.error("delete_failed", "Unable to enumerate history record", 0);
        }
        if (children.length > MAX_DELETE_ENTRIES) {
            return DeleteResult.error("unsafe_record_layout",
                    "Record contains too many entries to delete safely", 0);
        }
        for (File child : children) {
            if (!isSafeDirectFile(record.folder, child)) {
                return DeleteResult.error("unsafe_record_layout",
                        "Record contains a non-file or indirect entry", 0);
            }
        }

        final boolean replay = KIND_REPLAY.equals(record.kind);
        Arrays.sort(children, new Comparator<File>() {
            @Override
            public int compare(File left, File right) {
                if (replay) {
                    if ("info.json".equals(left.getName())) {
                        return 1;
                    }
                    if ("info.json".equals(right.getName())) {
                        return -1;
                    }
                } else {
                    boolean leftCsv = left.getName().endsWith(".csv");
                    boolean rightCsv = right.getName().endsWith(".csv");
                    if (leftCsv != rightCsv) {
                        return leftCsv ? 1 : -1;
                    }
                }
                return left.getName().compareTo(right.getName());
            }
        });
        int deleted = 0;
        for (File child : children) {
            if (!child.delete()) {
                return DeleteResult.error("delete_failed",
                        "Unable to delete every record file", deleted);
            }
            deleted++;
        }
        if (!record.folder.delete()) {
            return DeleteResult.error("delete_failed",
                    "Unable to delete record directory", deleted);
        }
        return DeleteResult.success(deleted);
    }

    private ActiveCheck replayActiveCheck() {
        if (HarnessState.isActive()) {
            return ActiveCheck.active();
        }
        try {
            CaseReplayManager manager = LauncherApplication.getInstance()
                    .findServiceByName(CaseReplayManager.class.getName());
            return manager != null && manager.isRunning()
                    ? ActiveCheck.active() : ActiveCheck.idle();
        } catch (RuntimeException e) {
            LogUtil.w(TAG, "Unable to verify replay activity", e);
            return ActiveCheck.unknown();
        }
    }

    private ActiveCheck performanceActiveCheck(Context context) {
        try {
            Map<String, SortedList<SchemeActionResolver>> registry =
                    LauncherApplication.getInstance().getSchemeResolver();
            SortedList<SchemeActionResolver> resolvers = registry == null
                    ? null : registry.get("performance");
            if (resolvers == null) {
                return ActiveCheck.unknown();
            }
            for (SchemeActionResolver resolver : resolvers) {
                if (!(resolver instanceof PerformanceSchemeResolver)) {
                    continue;
                }
                final Map<String, Object>[] holder = new Map[1];
                final boolean[] failed = new boolean[1];
                Map<String, String> params = Collections.singletonMap("mode", "status");
                boolean accepted = resolver.processScheme(context, params,
                        new Callback<Map<String, Object>>() {
                            @Override
                            public void onResult(Map<String, Object> item) {
                                holder[0] = item;
                            }

                            @Override
                            public void onFailed() {
                                failed[0] = true;
                            }
                        });
                if (!accepted || failed[0] || holder[0] == null
                        || Boolean.FALSE.equals(holder[0].get("success"))) {
                    return ActiveCheck.unknown();
                }
                return Boolean.TRUE.equals(holder[0].get("active"))
                        ? ActiveCheck.active() : ActiveCheck.idle();
            }
            return ActiveCheck.unknown();
        } catch (RuntimeException e) {
            LogUtil.w(TAG, "Unable to verify performance activity", e);
            return ActiveCheck.unknown();
        }
    }

    private MutationStart beginMutation(String requestId, String action, String id, String kind) {
        synchronized (RECEIPT_LOCK) {
            Map<String, Object> existing = MUTATION_RECEIPTS.get(requestId);
            if (existing != null) {
                boolean same = action.equals(existing.get("action")) && id.equals(existing.get("id"));
                return new MutationStart(false, !same,
                        new LinkedHashMap<String, Object>(existing));
            }
            Map<String, Object> receipt = new LinkedHashMap<String, Object>();
            receipt.put("success", true);
            receipt.put("requestId", requestId);
            receipt.put("action", action);
            receipt.put("kind", kind);
            receipt.put("id", id);
            receipt.put("state", "in_progress");
            receipt.put("requestedAt", System.currentTimeMillis());
            MUTATION_RECEIPTS.put(requestId, receipt);
            return new MutationStart(true, false,
                    new LinkedHashMap<String, Object>(receipt));
        }
    }

    private Map<String, Object> finishMutation(String requestId, String action, String id,
                                               String kind, boolean successful,
                                               String errorCode, String message,
                                               int deletedFiles) {
        Map<String, Object> receipt = new LinkedHashMap<String, Object>();
        receipt.put("success", successful);
        receipt.put("requestId", requestId);
        receipt.put("action", action);
        receipt.put("kind", kind);
        receipt.put("id", id);
        receipt.put("state", successful ? "completed" : "failed");
        receipt.put("deleted", successful);
        receipt.put("deletedFiles", deletedFiles);
        receipt.put("completedAt", System.currentTimeMillis());
        if (!successful) {
            receipt.put("errorCode", errorCode);
            receipt.put("error", message);
        }
        synchronized (RECEIPT_LOCK) {
            Map<String, Object> original = MUTATION_RECEIPTS.get(requestId);
            if (original != null && original.get("requestedAt") != null) {
                receipt.put("requestedAt", original.get("requestedAt"));
            }
            MUTATION_RECEIPTS.put(requestId, receipt);
        }
        return new LinkedHashMap<String, Object>(receipt);
    }

    private static File canonicalRoot(String name) throws IOException {
        File root = FileUtils.getSubDir(name).getCanonicalFile();
        if (!root.isDirectory()) {
            throw new IOException("History root is unavailable");
        }
        return root;
    }

    private static boolean isSafeDirectDirectory(File root, File child) throws IOException {
        if (root == null || child == null || !child.isDirectory()) {
            return false;
        }
        File canonicalRoot = root.getCanonicalFile();
        File canonicalChild = child.getCanonicalFile();
        File expected = new File(canonicalRoot, child.getName()).getAbsoluteFile();
        return canonicalRoot.equals(canonicalChild.getParentFile())
                && expected.equals(canonicalChild);
    }

    private static boolean isSafeDirectFile(File folder, File file) throws IOException {
        if (folder == null || file == null || !file.isFile()) {
            return false;
        }
        File canonicalFolder = folder.getCanonicalFile();
        File canonicalFile = file.getCanonicalFile();
        File expected = new File(canonicalFolder, file.getName()).getAbsoluteFile();
        return canonicalFolder.equals(canonicalFile.getParentFile())
                && expected.equals(canonicalFile);
    }

    private static String controlledRelativePath(String... parts) {
        StringBuilder path = new StringBuilder();
        for (String part : parts) {
            if (!isSafePathSegment(part)) {
                return null;
            }
            if (path.length() > 0) {
                path.append('/');
            }
            path.append(part);
        }
        return path.toString();
    }

    private static boolean isSafePathSegment(String value) {
        if (value == null || value.length() == 0 || ".".equals(value) || "..".equals(value)
                || value.indexOf('/') >= 0 || value.indexOf('\\') >= 0) {
            return false;
        }
        for (int i = 0; i < value.length(); i++) {
            char character = value.charAt(i);
            if (Character.isISOControl(character)) {
                return false;
            }
        }
        return true;
    }

    private static List<File> performanceFiles(File folder) throws IOException {
        File[] files = folder.listFiles();
        if (files == null) {
            return Collections.emptyList();
        }
        List<File> result = new ArrayList<File>();
        for (File file : files) {
            if (isSafeDirectFile(folder, file) && parsePerformanceFile(file) != null) {
                result.add(file);
            }
        }
        Collections.sort(result, FILE_NAME_COMPARATOR);
        return result;
    }

    private static boolean isPerformanceFolderName(String name) {
        return PERFORMANCE_SESSION_FOLDER.matcher(name).matches()
                || NEW_PERFORMANCE_FOLDER.matcher(name).matches()
                || MID_PERFORMANCE_FOLDER.matcher(name).matches()
                || OLD_PERFORMANCE_FOLDER.matcher(name).matches();
    }

    private static PerformanceFile parsePerformanceFile(File file) {
        Matcher strict = STRICT_PERFORMANCE_FILE.matcher(file.getName());
        if (strict.matches()) {
            return performanceFile(strict.group(1), strict.group(2),
                    strict.group(4), strict.group(5));
        }
        Matcher legacy = LEGACY_PERFORMANCE_FILE.matcher(file.getName());
        if (legacy.matches()) {
            return performanceFile(legacy.group(1), legacy.group(2),
                    legacy.group(3), legacy.group(4));
        }
        return null;
    }

    private static PerformanceFile performanceFile(String name, String source,
                                                   String start, String end) {
        try {
            return new PerformanceFile(name, source, Long.parseLong(start), Long.parseLong(end));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static long performanceEndTime(List<File> files, long fallback) {
        long result = Long.MIN_VALUE;
        for (File file : files) {
            PerformanceFile parsed = parsePerformanceFile(file);
            if (parsed != null) {
                result = Math.max(result, parsed.endTime);
            }
        }
        return result == Long.MIN_VALUE ? fallback : result;
    }

    private static void sortRecords(List<RecordRef> records) {
        Collections.sort(records, new Comparator<RecordRef>() {
            @Override
            public int compare(RecordRef left, RecordRef right) {
                int time = Long.valueOf(right.sortTime).compareTo(left.sortTime);
                return time == 0 ? left.id.compareTo(right.id) : time;
            }
        });
    }

    private static RecordRef findRecord(List<RecordRef> records, String id) {
        for (RecordRef record : records) {
            if (record.id.equals(id)) {
                return record;
            }
        }
        return null;
    }

    private static String stableId(String kind, String name) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] value = digest.digest((kind + "\u0000" + name).getBytes(UTF_8));
            StringBuilder result = new StringBuilder(value.length * 2);
            for (byte item : value) {
                result.append(String.format(java.util.Locale.US, "%02x", item & 0xff));
            }
            return (KIND_REPLAY.equals(kind) ? REPLAY_ID_PREFIX : PERFORMANCE_ID_PREFIX)
                    + result.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    private static JSONObject readJsonObject(File file, int maxBytes, String label)
            throws IOException, HistoryException {
        if (file.length() > maxBytes) {
            throw new HistoryException("content_too_large", "Stored " + label + " exceeds the limit");
        }
        byte[] bytes = readPrefix(file, maxBytes + 1);
        if (bytes.length > maxBytes) {
            throw new HistoryException("content_too_large", "Stored " + label + " exceeds the limit");
        }
        try {
            JSONObject result = JSON.parseObject(new String(bytes, UTF_8));
            if (result == null) {
                throw new HistoryException("invalid_metadata", "Stored " + label + " is invalid");
            }
            return result;
        } catch (HistoryException e) {
            throw e;
        } catch (RuntimeException e) {
            throw new HistoryException("invalid_metadata", "Stored " + label + " is invalid");
        }
    }

    private static byte[] readPrefix(File file, int maxBytes) throws IOException {
        FileInputStream input = null;
        ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(maxBytes, 8192));
        try {
            input = new FileInputStream(file);
            byte[] buffer = new byte[8192];
            int remaining = maxBytes;
            while (remaining > 0) {
                int read = input.read(buffer, 0, Math.min(buffer.length, remaining));
                if (read < 0) {
                    break;
                }
                output.write(buffer, 0, read);
                remaining -= read;
            }
            return output.toByteArray();
        } finally {
            if (input != null) {
                input.close();
            }
            output.close();
        }
    }

    private static Charset performanceCharset() {
        try {
            String configured = SPService.getString(SPService.KEY_OUTPUT_CHARSET, "GBK");
            return Charset.forName(configured);
        } catch (RuntimeException e) {
            try {
                return Charset.forName("GBK");
            } catch (RuntimeException ignored) {
                return UTF_8;
            }
        }
    }

    private static void validateRecordId(String id, String kind) throws HistoryException {
        if (id == null || id.length() == 0) {
            throw new HistoryException("missing_id", "Parameter 'id' is required");
        }
        Pattern expected = KIND_REPLAY.equals(kind) ? REPLAY_ID_PATTERN : PERFORMANCE_ID_PATTERN;
        if (!expected.matcher(id).matches()) {
            throw new HistoryException("invalid_id", "Parameter 'id' is invalid");
        }
    }

    private static int parseLimit(String value) throws HistoryException {
        if (value == null || value.length() == 0) {
            return DEFAULT_LIST_LIMIT;
        }
        try {
            int parsed = Integer.parseInt(value);
            if (parsed < 1 || parsed > MAX_LIST_LIMIT) {
                throw new HistoryException("invalid_limit",
                        "Parameter 'limit' must be between 1 and " + MAX_LIST_LIMIT);
            }
            return parsed;
        } catch (NumberFormatException e) {
            throw new HistoryException("invalid_limit", "Parameter 'limit' must be an integer");
        }
    }

    private static long longValue(Object value, long fallback) {
        if (value instanceof Number) {
            return ((Number) value).longValue();
        }
        if (value instanceof String) {
            try {
                return Long.parseLong((String) value);
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }

    private static long safeAdd(long left, long right) {
        if (right > 0L && left > Long.MAX_VALUE - right) {
            return Long.MAX_VALUE;
        }
        return left + Math.max(0L, right);
    }

    private static void copyIfPresent(JSONObject source, Map<String, Object> target, String key) {
        if (source.containsKey(key)) {
            target.put(key, source.get(key));
        }
    }

    private static Map<String, Object> success() {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("success", true);
        return result;
    }

    private static Map<String, Object> error(String errorCode, String message) {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("success", false);
        result.put("errorCode", errorCode);
        result.put("error", message);
        return result;
    }

    private static final Comparator<File> FILE_NAME_COMPARATOR = new Comparator<File>() {
        @Override
        public int compare(File left, File right) {
            return left.getName().compareTo(right.getName());
        }
    };

    private static final class RecordRef {
        final String kind;
        final File root;
        final File folder;
        final String id;
        File infoFile;
        JSONObject info;
        String metadataError;
        List<File> dataFiles = Collections.emptyList();
        long sortTime;

        RecordRef(String kind, File root, File folder, String id) {
            this.kind = kind;
            this.root = root;
            this.folder = folder;
            this.id = id;
        }
    }

    private static final class PerformanceFile {
        final String name;
        final String source;
        final long startTime;
        final long endTime;

        PerformanceFile(String name, String source, long startTime, long endTime) {
            this.name = name;
            this.source = source;
            this.startTime = startTime;
            this.endTime = endTime;
        }
    }

    private static final class MutationStart {
        final boolean created;
        final boolean conflict;
        final Map<String, Object> receipt;

        MutationStart(boolean created, boolean conflict, Map<String, Object> receipt) {
            this.created = created;
            this.conflict = conflict;
            this.receipt = receipt;
        }
    }

    private static final class ActiveCheck {
        final boolean known;
        final boolean active;

        private ActiveCheck(boolean known, boolean active) {
            this.known = known;
            this.active = active;
        }

        static ActiveCheck idle() {
            return new ActiveCheck(true, false);
        }

        static ActiveCheck active() {
            return new ActiveCheck(true, true);
        }

        static ActiveCheck unknown() {
            return new ActiveCheck(false, false);
        }
    }

    private static final class DeleteResult {
        final boolean success;
        final String errorCode;
        final String error;
        final int deletedFiles;

        private DeleteResult(boolean success, String errorCode, String error, int deletedFiles) {
            this.success = success;
            this.errorCode = errorCode;
            this.error = error;
            this.deletedFiles = deletedFiles;
        }

        static DeleteResult success(int deletedFiles) {
            return new DeleteResult(true, null, null, deletedFiles);
        }

        static DeleteResult error(String errorCode, String error, int deletedFiles) {
            return new DeleteResult(false, errorCode, error, deletedFiles);
        }
    }

    private static final class HistoryException extends Exception {
        final String errorCode;

        HistoryException(String errorCode, String message) {
            super(message);
            this.errorCode = errorCode;
        }
    }
}
