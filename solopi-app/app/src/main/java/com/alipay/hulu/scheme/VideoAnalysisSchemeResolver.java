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

import android.content.Context;

import com.alipay.hulu.common.scheme.AdbSchemeActivity;
import com.alipay.hulu.common.scheme.SchemeActionResolver;
import com.alipay.hulu.common.scheme.SchemeResolver;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.screenRecord.SimpleRecordService;
import com.alipay.hulu.screenRecord.VideoAnalyzer;

import java.io.File;
import java.io.IOException;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/** 分析由 SoloPi 管理的已完成 MP4 文件，不接受任意设备路径。 */
@SchemeResolver("video-analysis")
public class VideoAnalysisSchemeResolver implements SchemeActionResolver {
    private static final int MAX_RECEIPTS = 32;
    private static final int ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000;
    private static final long MAX_ACTION_OFFSET_MS = 60L * 60L * 1000L;
    private static final Pattern REQUEST_ID_PATTERN =
            Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,127}");
    private static final Object LOCK = new Object();
    private static String activeRequestId;
    private static Map<String, Object> activeReceipt;
    private static final LinkedHashMap<String, Map<String, Object>> RECEIPTS =
            new LinkedHashMap<>(MAX_RECEIPTS, 0.75F, true);

    @Override
    public boolean processScheme(Context context, Map<String, String> params,
                                 Callback<Map<String, Object>> callback) {
        String action = params == null ? null : params.get("action");
        if (StringUtil.isEmpty(action)) {
            callback.onResult(error("missing_action", "Parameter 'action' is required"));
            return true;
        }
        if ("status".equals(action)) {
            callback.onResult(status(params.get("requestId")));
            return true;
        }
        if (!"start".equals(action)) {
            callback.onResult(error("unsupported_action",
                    "Unsupported video analysis action: " + action));
            return true;
        }
        if (!(context instanceof AdbSchemeActivity)) {
            callback.onResult(error("adb_required",
                    "Video analysis start is only available through the protected ADB transport"));
            return true;
        }
        callback.onResult(start(params));
        return true;
    }

    private Map<String, Object> start(Map<String, String> params) {
        final String requestId = params.get("requestId");
        if (!validRequestId(requestId)) {
            return error("invalid_request_id", "Parameter 'requestId' is invalid");
        }
        synchronized (LOCK) {
            Map<String, Object> existing = RECEIPTS.get(requestId);
            if (existing != null) {
                return new LinkedHashMap<String, Object>(existing);
            }
        }

        final long actionOffsetMs;
        final double differenceThreshold;
        final File video;
        try {
            actionOffsetMs = parseActionOffset(params.get("actionOffsetMs"));
            differenceThreshold = parseDifferenceThreshold(params.get("differenceThreshold"));
            video = resolveVideo(
                    FileUtils.getSubDir(SimpleRecordService.VIDEO_DIR), params.get("videoPath"));
        } catch (IllegalArgumentException exception) {
            return rememberError(requestId, "invalid_parameter", exception.getMessage());
        } catch (IOException exception) {
            return rememberError(requestId, "unsafe_video_path",
                    "Unable to resolve the requested video path");
        }
        if (ClassUtil.getPatchInfo(VideoAnalyzer.SCREEN_RECORD_PATCH) == null) {
            return rememberError(requestId, "plugin_missing",
                    "Screen recording analyzer plugin is not installed");
        }

        final Map<String, Object> receipt;
        synchronized (LOCK) {
            Map<String, Object> existing = RECEIPTS.get(requestId);
            if (existing != null) {
                return new LinkedHashMap<String, Object>(existing);
            }
            if (activeRequestId != null) {
                Map<String, Object> conflict = requestError(requestId,
                        "analysis_busy", "Another video analysis is already active");
                conflict.put("activeRequestId", activeRequestId);
                rememberReceiptLocked(requestId, conflict);
                return conflict;
            }
            activeRequestId = requestId;
            receipt = success();
            receipt.put("requestId", requestId);
            receipt.put("state", "analyzing");
            receipt.put("terminal", false);
            receipt.put("videoFileName", video.getName());
            receipt.put("videoPath", FileUtils.getPathInShell(video));
            receipt.put("sizeBytes", video.length());
            receipt.put("actionOffsetMs", actionOffsetMs);
            receipt.put("differenceThreshold", differenceThreshold);
            receipt.put("startedAt", System.currentTimeMillis());
            activeReceipt = new LinkedHashMap<String, Object>(receipt);
            rememberReceiptLocked(requestId, receipt);
        }

        try {
            BackgroundExecutor.execute(new Runnable() {
                @Override
                public void run() {
                    finish(requestId, false, null,
                            "Video analysis timed out after " + ANALYSIS_TIMEOUT_MS + " ms");
                }
            }, ANALYSIS_TIMEOUT_MS);
            VideoAnalyzer.getInstance().doAnalyze(
                    actionOffsetMs, differenceThreshold, video.getAbsolutePath(),
                    new VideoAnalyzer.AnalyzeListener() {
                        @Override
                        public void onAnalyzeFinished(long result) {
                            if (result < 0L) {
                                finish(requestId, false, result,
                                        "Video analyzer returned an invalid response time");
                            } else {
                                finish(requestId, true, result, null);
                            }
                        }

                        @Override
                        public void onAnalyzeFailed(String message) {
                            finish(requestId, false, null, message);
                        }
                    });
        } catch (RuntimeException exception) {
            finish(requestId, false, null,
                    "Unable to schedule screen recording analysis: " + exception.getMessage());
        }
        return receipt;
    }

    private Map<String, Object> status(String requestId) {
        if (!validRequestId(requestId)) {
            return error("invalid_request_id", "Parameter 'requestId' is invalid");
        }
        synchronized (LOCK) {
            Map<String, Object> receipt = RECEIPTS.get(requestId);
            if (receipt == null && requestId.equals(activeRequestId)) {
                receipt = activeReceipt;
            }
            if (receipt == null) {
                return error("analysis_not_found", "Video analysis request was not found");
            }
            return new LinkedHashMap<String, Object>(receipt);
        }
    }

    private static void finish(String requestId, boolean successful, Long result,
                               String message) {
        synchronized (LOCK) {
            if (!requestId.equals(activeRequestId)) {
                return;
            }
            Map<String, Object> receipt = activeReceipt;
            if (receipt == null) {
                receipt = RECEIPTS.get(requestId);
            }
            if (receipt == null) {
                activeRequestId = null;
                activeReceipt = null;
                return;
            }
            receipt.put("success", successful);
            receipt.put("state", successful ? "completed" : "failed");
            receipt.put("terminal", true);
            receipt.put("completedAt", System.currentTimeMillis());
            if (successful) {
                receipt.put("visualResponseTimeMs", result);
                receipt.put("measurement", "SoloPi screen-recording video difference");
            } else {
                receipt.put("errorCode", "analysis_failed");
                receipt.put("error", StringUtil.isEmpty(message)
                        ? "Unable to analyze screen recording" : message);
            }
            activeRequestId = null;
            activeReceipt = null;
            rememberReceiptLocked(requestId, receipt);
        }
    }

    private static void rememberReceiptLocked(String requestId,
                                              Map<String, Object> receipt) {
        RECEIPTS.put(requestId, new LinkedHashMap<String, Object>(receipt));
        trimReceipts(RECEIPTS, activeRequestId, MAX_RECEIPTS);
    }

    static void trimReceipts(LinkedHashMap<String, Map<String, Object>> receipts,
                             String protectedRequestId, int maximum) {
        while (receipts.size() > maximum) {
            boolean removed = false;
            Iterator<Map.Entry<String, Map<String, Object>>> iterator =
                    receipts.entrySet().iterator();
            while (iterator.hasNext()) {
                Map.Entry<String, Map<String, Object>> entry = iterator.next();
                if (!entry.getKey().equals(protectedRequestId)) {
                    iterator.remove();
                    removed = true;
                    break;
                }
            }
            if (!removed) {
                return;
            }
        }
    }

    static long parseActionOffset(String value) {
        try {
            long parsed = Long.parseLong(value);
            if (parsed < 0L || parsed > MAX_ACTION_OFFSET_MS) {
                throw new IllegalArgumentException();
            }
            return parsed;
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException(
                    "actionOffsetMs must be between 0 and " + MAX_ACTION_OFFSET_MS);
        }
    }

    static double parseDifferenceThreshold(String value) {
        try {
            double parsed = Double.parseDouble(value);
            if (Double.isNaN(parsed) || Double.isInfinite(parsed)
                    || parsed <= 0.0D || parsed > 1.0D) {
                throw new IllegalArgumentException();
            }
            return parsed;
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException(
                    "differenceThreshold must be greater than 0 and at most 1");
        }
    }

    static File resolveVideo(File root, String requestedPath) throws IOException {
        if (root == null || StringUtil.isEmpty(requestedPath)) {
            throw new IllegalArgumentException("videoPath is required");
        }
        File canonicalRoot = root.getCanonicalFile();
        File video = new File(requestedPath).getCanonicalFile();
        File parent = video.getParentFile();
        if (parent == null || !canonicalRoot.equals(parent.getCanonicalFile())
                || !video.isFile() || video.isHidden()
                || !video.getName().toLowerCase(java.util.Locale.US).endsWith(".mp4")
                || video.length() <= 0L) {
            throw new IllegalArgumentException(
                    "videoPath must be a non-empty direct MP4 child of capturesRoot");
        }
        return video;
    }

    private static boolean validRequestId(String requestId) {
        return requestId != null && REQUEST_ID_PATTERN.matcher(requestId).matches();
    }

    private static Map<String, Object> success() {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("success", true);
        return result;
    }

    private static Map<String, Object> error(String code, String message) {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("success", false);
        result.put("errorCode", code);
        result.put("error", message);
        return result;
    }

    private static Map<String, Object> requestError(String requestId, String code,
                                                    String message) {
        Map<String, Object> result = error(code, message);
        result.put("requestId", requestId);
        return result;
    }

    private static Map<String, Object> rememberError(String requestId, String code,
                                                     String message) {
        synchronized (LOCK) {
            Map<String, Object> existing = RECEIPTS.get(requestId);
            if (existing != null) {
                return new LinkedHashMap<String, Object>(existing);
            }
            Map<String, Object> result = requestError(requestId, code, message);
            rememberReceiptLocked(requestId, result);
            return result;
        }
    }
}
