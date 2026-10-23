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
import android.util.Pair;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.constant.Constant;
import com.alipay.hulu.common.scheme.SchemeActionResolver;
import com.alipay.hulu.common.scheme.AdbSchemeActivity;
import com.alipay.hulu.common.scheme.SchemeResolver;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.PatchProcessUtil;
import com.alipay.hulu.common.utils.RuntimeSessionGuard;
import com.alipay.hulu.common.utils.SortedList;
import com.alipay.hulu.common.utils.patch.PatchDescription;
import com.alipay.hulu.common.utils.patch.PatchLoadResult;
import com.alipay.hulu.service.CaseRecordManager;
import com.alipay.hulu.service.CaseReplayManager;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipInputStream;

/**
 * SoloPi 补丁和插件的安全本地管理协议。
 *
 * <p>HTTP 只提供列表和回执查询。变更操作必须使用 ADB Scheme 传输提供的 Activity
 * 上下文。导入仅接受 SoloPi 补丁导入目录中已枚举的直接子文件，明确不支持 URL 和任意路径。</p>
 */
@SchemeResolver("plugin")
public class PluginSchemeResolver implements SchemeActionResolver {
    private static final String TAG = PluginSchemeResolver.class.getSimpleName();

    private static final String ACTION_LIST = "list";
    private static final String ACTION_IMPORT = "import";
    private static final String ACTION_INSTALL = "install";
    private static final String ACTION_REMOVE = "remove";
    private static final String ACTION_MUTATION_STATUS = "mutationStatus";

    private static final String PARAM_ACTION = "action";
    private static final String PARAM_FILE_NAME = "fileName";
    private static final String PARAM_FILE_ID = "fileId";
    private static final String PARAM_SHA256 = "sha256";
    private static final String PARAM_PLUGIN_ID = "pluginId";
    private static final String PARAM_CONFIRM_ID = "confirmId";
    private static final String PARAM_REQUEST_ID = "requestId";

    private static final Charset UTF_8 = Charset.forName("UTF-8");
    private static final int MAX_IMPORT_FILES = 100;
    private static final int MAX_RECEIPTS = 64;
    private static final int MAX_ARCHIVE_ENTRIES = 512;
    private static final int MAX_ASSET_ENTRIES = 1024;
    private static final int MAX_MANIFEST_BYTES = 64 * 1024;
    private static final long MAX_ARCHIVE_BYTES = 64L * 1024L * 1024L;
    private static final long MAX_ENTRY_BYTES = 96L * 1024L * 1024L;
    private static final long MAX_EXPANDED_BYTES = 256L * 1024L * 1024L;
    private static final long MAX_ASSET_ENTRY_BYTES = 64L * 1024L * 1024L;
    private static final long MAX_ASSET_EXPANDED_BYTES = 128L * 1024L * 1024L;
    private static final long MAX_COMPRESSION_RATIO = 250L;

    private static final Pattern REQUEST_ID_PATTERN =
            Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,127}");
    private static final Pattern IMPORT_FILE_PATTERN =
            Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,126}\\.zip");
    private static final Pattern IMPORT_ID_PATTERN =
            Pattern.compile("plugin-import-[0-9a-f]{64}");
    private static final Pattern PLUGIN_ID_PATTERN =
            Pattern.compile("plugin-[0-9a-f]{64}");
    private static final Pattern SHA256_PATTERN = Pattern.compile("[0-9a-fA-F]{64}");
    private static final Pattern MD5_PATTERN = Pattern.compile("[0-9a-fA-F]{32}");
    private static final Pattern PLUGIN_NAME_PATTERN =
            Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,63}");
    private static final Pattern JAVA_CLASS_PATTERN = Pattern.compile(
            "[A-Za-z_$][A-Za-z0-9_$]*(\\.[A-Za-z_$][A-Za-z0-9_$]*)*");
    private static final Pattern JAVA_METHOD_PATTERN =
            Pattern.compile("[A-Za-z_$][A-Za-z0-9_$]*");

    private static final Object RECEIPT_LOCK = new Object();
    private static final Object MUTATION_EXECUTION_LOCK = new Object();
    private static final LinkedHashMap<String, Map<String, Object>> RECEIPTS =
            new LinkedHashMap<String, Map<String, Object>>(MAX_RECEIPTS, 0.75F, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Map<String, Object>> eldest) {
                    return size() > MAX_RECEIPTS;
                }
            };

    @Override
    public boolean processScheme(final Context context, Map<String, String> params,
                                 Callback<Map<String, Object>> callback) {
        Map<String, Object> result;
        try {
            if (params == null || isEmpty(params.get(PARAM_ACTION))) {
                result = error("missing_action", "Parameter 'action' is required");
            } else {
                String action = params.get(PARAM_ACTION);
                if (ACTION_LIST.equals(action)) {
                    result = listPlugins();
                } else if (ACTION_MUTATION_STATUS.equals(action)) {
                    result = mutationStatus(params.get(PARAM_REQUEST_ID));
                } else if (ACTION_IMPORT.equals(action) || ACTION_INSTALL.equals(action)) {
                    result = startImport(context, params);
                } else if (ACTION_REMOVE.equals(action)) {
                    result = startRemove(context, params);
                } else {
                    result = error("unsupported_action", "Unsupported plugin action: " + action);
                }
            }
        } catch (PluginException e) {
            result = error(e.errorCode, e.getMessage());
        } catch (IOException e) {
            LogUtil.w(TAG, "Unable to access plugin storage", e);
            result = error("io_error", "Unable to access plugin storage");
        } catch (RuntimeException e) {
            LogUtil.e(TAG, "Unexpected plugin resolver failure", e);
            result = error("internal_error", "Unable to process plugin request");
        }
        callback.onResult(result);
        return true;
    }

    private Map<String, Object> listPlugins() throws IOException {
        List<PatchLoadResult> installed = ClassUtil.getAllPatches();
        Collections.sort(installed, new Comparator<PatchLoadResult>() {
            @Override
            public int compare(PatchLoadResult left, PatchLoadResult right) {
                return safeString(left == null ? null : left.name)
                        .compareTo(safeString(right == null ? null : right.name));
            }
        });

        List<Map<String, Object>> plugins = new ArrayList<Map<String, Object>>();
        for (PatchLoadResult patch : installed) {
            if (patch != null && !isEmpty(patch.name)) {
                plugins.add(pluginSummary(patch));
            }
        }

        File importRoot = canonicalImportRoot();
        List<ImportFile> importFiles = enumerateImportFiles(importRoot);
        List<Map<String, Object>> imports = new ArrayList<Map<String, Object>>();
        for (int i = 0; i < importFiles.size() && i < MAX_IMPORT_FILES; i++) {
            ImportFile candidate = importFiles.get(i);
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("fileId", candidate.id);
            item.put("fileName", candidate.file.getName());
            item.put("sizeBytes", candidate.file.length());
            item.put("modifiedAt", candidate.file.lastModified());
            item.put("sha256Required", true);
            imports.add(item);
        }

        Map<String, Object> result = success();
        result.put("plugins", plugins);
        result.put("total", plugins.size());
        result.put("importDirectory", "patch");
        result.put("importPath", importRoot.getCanonicalPath());
        result.put("pathAvailable", true);
        result.put("importFiles", imports);
        result.put("importFilesTruncated", imports.size() < importFiles.size());
        result.put("mutationTransport", "adb");
        return result;
    }

    private Map<String, Object> pluginSummary(PatchLoadResult patch) {
        boolean core = Constant.HOTPATCH_NAME.equals(patch.name);
        Map<String, Object> item = new LinkedHashMap<String, Object>();
        item.put("id", pluginId(patch.name));
        item.put("name", patch.name);
        item.put("version", patch.version);
        item.put("status", core ? "built_in"
                : (patch.classLoader == null ? "installed" : "loaded"));
        item.put("source", core ? "built_in" : sourceOf(patch));
        item.put("core", core);
        item.put("removable", !core);
        item.put("runtimeLoaded", patch.classLoader != null);
        item.put("hasCode", !isEmpty(patch.jarPath));
        item.put("hasNativeLibraries", !isEmpty(patch.soPath));
        item.put("hasAssets", directoryHasEntries(patch.assetsPath));
        item.put("filter", patch.filter);
        item.put("dependencies", patch.dependencies == null
                ? Collections.emptyList() : new ArrayList<String>(patch.dependencies));

        Pair<Float, String> catalog = ClassUtil.getAvaliablePatchInfo(patch.name);
        item.put("catalogAvailable", catalog != null);
        if (catalog != null && catalog.first != null) {
            item.put("catalogVersion", catalog.first);
            item.put("updateAvailable", catalog.first > patch.version);
        }
        return item;
    }

    private Map<String, Object> startImport(Context context, Map<String, String> params)
            throws IOException, PluginException {
        if (!(context instanceof AdbSchemeActivity)) {
            return error("mutation_transport_required",
                    "Plugin installation requires the ADB scheme transport");
        }
        if (!isEmpty(params.get("url"))) {
            return error("url_not_allowed", "Plugin URLs are not accepted by this protocol");
        }
        final String requestId = validateRequestId(params.get(PARAM_REQUEST_ID));
        final String expectedSha256 = params.get(PARAM_SHA256);
        if (isEmpty(expectedSha256)) {
            return error("missing_sha256", "Parameter 'sha256' is required");
        }
        if (!SHA256_PATTERN.matcher(expectedSha256).matches()) {
            return error("invalid_sha256", "Parameter 'sha256' must contain 64 hexadecimal characters");
        }

        String fileName = params.get(PARAM_FILE_NAME);
        String fileId = params.get(PARAM_FILE_ID);
        final ImportFile candidate = resolveImportFile(fileName, fileId);
        final String normalizedSha256 = expectedSha256.toLowerCase(java.util.Locale.US);
        String subject = candidate.id + ":" + normalizedSha256;
        MutationStart mutation = beginMutation(requestId, ACTION_IMPORT, subject);
        if (mutation.conflict) {
            return error("request_id_conflict",
                    "The requestId is already associated with another mutation");
        }
        if (mutation.busy) {
            return error("mutation_busy", "Another plugin mutation is still in progress");
        }
        if (mutation.sessionBusy) {
            return error("plugin_in_use",
                    "An active SoloPi session prevents plugin installation");
        }
        if (!mutation.created) {
            return mutation.receipt;
        }

        try {
            BackgroundExecutor.execute(new Runnable() {
                @Override
                public void run() {
                    synchronized (MUTATION_EXECUTION_LOCK) {
                        performImport(requestId, candidate, normalizedSha256);
                    }
                }
            });
        } catch (RuntimeException e) {
            finishFailure(requestId, "executor_unavailable",
                    "Plugin installation could not be scheduled");
            return mutationStatus(requestId);
        }
        return mutation.receipt;
    }

    private void performImport(String requestId, ImportFile candidate, String expectedSha256) {
        File snapshot = null;
        try {
            ActiveCheck active = activeUseCheck(null);
            if (!active.known) {
                finishFailure(requestId, "activity_status_unavailable",
                        "Unable to verify that plugin consumers are idle");
                return;
            }
            if (active.active) {
                finishFailure(requestId, "plugin_in_use",
                        "An active SoloPi session prevents plugin installation");
                return;
            }

            Snapshot copied = snapshotImport(candidate.file, expectedSha256);
            snapshot = copied.file;
            PatchManifest manifest = validatePluginArchive(snapshot);
            active = activeUseCheck(null);
            if (!active.known || active.active) {
                finishFailure(requestId, active.known ? "plugin_in_use"
                                : "activity_status_unavailable",
                        active.known ? "A SoloPi session started while the plugin was validated"
                                : "Unable to revalidate that plugin consumers are idle");
                return;
            }
            PatchLoadResult installed = ClassUtil.getPatchInfo(manifest.description.getName());
            if (installed != null && installed.version >= manifest.description.getVersion()) {
                finishFailure(requestId, "version_not_newer",
                        "The imported plugin version must be newer than the installed version");
                return;
            }

            PatchLoadResult loaded = PatchProcessUtil.dynamicLoadPatch(snapshot);
            if (loaded == null) {
                finishFailure(requestId, "plugin_validation_failed",
                        "The existing patch loader rejected the plugin package");
                return;
            }
            if (!manifest.description.getName().equals(loaded.name)
                    || Float.compare(manifest.description.getVersion(), loaded.version) != 0) {
                finishFailure(requestId, "plugin_identity_mismatch",
                        "Loaded plugin identity does not match its validated descriptor");
                return;
            }

            active = activeUseCheck(null);
            if (!active.known || active.active) {
                finishFailure(requestId, active.known ? "plugin_in_use"
                                : "activity_status_unavailable",
                        active.known ? "A SoloPi session started before plugin installation"
                                : "Unable to revalidate that plugin consumers are idle");
                return;
            }

            ClassUtil.installPatch(loaded);
            PatchLoadResult current = ClassUtil.getPatchInfo(loaded.name);
            if (current == null || Float.compare(current.version, loaded.version) != 0) {
                finishFailure(requestId, "install_failed", "Plugin installation did not complete");
                return;
            }

            Map<String, Object> fields = new LinkedHashMap<String, Object>();
            fields.put("plugin", pluginSummary(current));
            fields.put("sha256", copied.sha256);
            fields.put("sizeBytes", copied.sizeBytes);
            fields.put("sourceFileId", candidate.id);
            fields.put("sourceFileRetained", true);
            fields.put("restartRequired", true);
            fields.put("activation", "restart_required_for_full_activation");
            finishSuccess(requestId, "completed_restart_required", fields);
        } catch (PluginException e) {
            finishFailure(requestId, e.errorCode, e.getMessage());
        } catch (IOException e) {
            LogUtil.w(TAG, "Unable to import plugin", e);
            finishFailure(requestId, "install_io_error", "Unable to read or stage plugin package");
        } catch (Throwable e) {
            LogUtil.e(TAG, "Unexpected plugin installation failure", e);
            finishFailure(requestId, "install_failed", "Plugin installation failed");
        } finally {
            if (snapshot != null && snapshot.exists() && !snapshot.delete()) {
                LogUtil.w(TAG, "Unable to remove plugin staging file");
            }
        }
    }

    private Map<String, Object> startRemove(Context context, Map<String, String> params)
            throws PluginException {
        if (!(context instanceof AdbSchemeActivity)) {
            return error("mutation_transport_required",
                    "Plugin removal requires the ADB scheme transport");
        }
        final String requestId = validateRequestId(params.get(PARAM_REQUEST_ID));
        final String id = params.get(PARAM_PLUGIN_ID);
        if (isEmpty(id)) {
            return error("missing_plugin_id", "Parameter 'pluginId' is required");
        }
        if (!PLUGIN_ID_PATTERN.matcher(id).matches()) {
            return error("invalid_plugin_id", "Parameter 'pluginId' is invalid");
        }
        if (!id.equals(params.get(PARAM_CONFIRM_ID))) {
            return error("confirmation_mismatch",
                    "Parameter 'confirmId' must exactly match 'pluginId'");
        }

        MutationStart mutation = beginMutation(requestId, ACTION_REMOVE, id);
        if (mutation.conflict) {
            return error("request_id_conflict",
                    "The requestId is already associated with another mutation");
        }
        if (mutation.busy) {
            return error("mutation_busy", "Another plugin mutation is still in progress");
        }
        if (mutation.sessionBusy) {
            return error("plugin_in_use",
                    "An active SoloPi session prevents plugin removal");
        }
        if (!mutation.created) {
            return mutation.receipt;
        }

        try {
            BackgroundExecutor.execute(new Runnable() {
                @Override
                public void run() {
                    synchronized (MUTATION_EXECUTION_LOCK) {
                        performRemove(requestId, id);
                    }
                }
            });
        } catch (RuntimeException e) {
            finishFailure(requestId, "executor_unavailable",
                    "Plugin removal could not be scheduled");
            return mutationStatus(requestId);
        }
        return mutation.receipt;
    }

    private void performRemove(String requestId, String id) {
        try {
            PatchLoadResult patch = findPlugin(id);
            if (patch == null) {
                finishFailure(requestId, "plugin_not_found", "Installed plugin was not found");
                return;
            }
            if (Constant.HOTPATCH_NAME.equals(patch.name)) {
                finishFailure(requestId, "core_plugin_protected",
                        "Built-in core plugins cannot be removed");
                return;
            }
            List<String> dependents = dependentPlugins(patch.name);
            if (!dependents.isEmpty()) {
                Map<String, Object> fields = new LinkedHashMap<String, Object>();
                fields.put("dependents", dependents);
                finishFailure(requestId, "plugin_has_dependents",
                        "Other installed plugins depend on this plugin", fields);
                return;
            }

            ActiveCheck active = activeUseCheck(patch);
            if (!active.known) {
                finishFailure(requestId, "activity_status_unavailable",
                        "Unable to verify that plugin consumers are idle");
                return;
            }
            if (active.active) {
                finishFailure(requestId, "plugin_in_use",
                        "An active SoloPi session is using plugin-capable runtime services");
                return;
            }

            active = activeUseCheck(patch);
            if (!active.known || active.active) {
                finishFailure(requestId, active.known ? "plugin_in_use"
                                : "activity_status_unavailable",
                        active.known ? "A SoloPi session started before plugin removal"
                                : "Unable to revalidate that plugin consumers are idle");
                return;
            }

            ClassUtil.removePatch(patch.name);
            if (ClassUtil.getPatchInfo(patch.name) != null) {
                finishFailure(requestId, "remove_failed",
                        "Plugin could not be removed from the installed registry");
                return;
            }
            Map<String, Object> fields = new LinkedHashMap<String, Object>();
            fields.put("pluginId", id);
            fields.put("name", patch.name);
            fields.put("version", patch.version);
            fields.put("removedFromRegistry", true);
            fields.put("filesRetained", true);
            fields.put("restartRequired", true);
            fields.put("runtimeEffect", "restart_required_for_full_removal");
            finishSuccess(requestId, "completed_restart_required", fields);
        } catch (Throwable e) {
            LogUtil.e(TAG, "Unexpected plugin removal failure", e);
            finishFailure(requestId, "remove_failed", "Plugin removal failed");
        }
    }

    private Map<String, Object> mutationStatus(String requestId) throws PluginException {
        validateRequestId(requestId);
        Map<String, Object> receipt;
        synchronized (RECEIPT_LOCK) {
            Map<String, Object> stored = RECEIPTS.get(requestId);
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

    private Snapshot snapshotImport(File source, String expectedSha256)
            throws IOException, PluginException {
        if (!isSafeDirectFile(canonicalImportRoot(), source)) {
            throw new PluginException("unsafe_import_file",
                    "Import file is no longer a safe direct child");
        }
        if (source.length() <= 0L || source.length() > MAX_ARCHIVE_BYTES) {
            throw new PluginException("invalid_archive_size",
                    "Plugin package must be between 1 byte and 64 MiB");
        }

        File stagingRoot = FileUtils.getInnerSubDir("plugin_import_staging").getCanonicalFile();
        if (!stagingRoot.isDirectory()) {
            throw new IOException("Plugin staging directory is unavailable");
        }
        File target = new File(stagingRoot,
                "plugin_import_" + UUID.randomUUID().toString() + ".zip");
        MessageDigest digest = messageDigest("SHA-256");
        FileInputStream input = null;
        FileOutputStream output = null;
        long total = 0L;
        boolean complete = false;
        try {
            input = new FileInputStream(source);
            output = new FileOutputStream(target);
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read == 0) {
                    continue;
                }
                total += read;
                if (total > MAX_ARCHIVE_BYTES) {
                    throw new PluginException("invalid_archive_size",
                            "Plugin package exceeds the 64 MiB limit");
                }
                digest.update(buffer, 0, read);
                output.write(buffer, 0, read);
            }
            output.getFD().sync();
            String actual = hex(digest.digest());
            if (!actual.equals(expectedSha256)) {
                throw new PluginException("sha256_mismatch",
                        "Plugin package SHA-256 does not match the requested digest");
            }
            complete = true;
            return new Snapshot(target, actual, total);
        } finally {
            if (output != null) {
                output.close();
            }
            if (input != null) {
                input.close();
            }
            if (!complete && target.exists() && !target.delete()) {
                LogUtil.w(TAG, "Unable to remove incomplete plugin staging file");
            }
        }
    }

    private PatchManifest validatePluginArchive(File archive)
            throws IOException, PluginException {
        ZipFile zip = null;
        try {
            zip = new ZipFile(archive);
            Map<String, ZipEntry> entries = validateOuterEntries(zip);
            String manifestPath = findManifestPath(entries);
            String rootPrefix = manifestPath.substring(0,
                    manifestPath.length() - "desc.json".length());
            validateWrapperLayout(entries.keySet(), rootPrefix);

            byte[] manifestBytes = readEntry(zip, entries.get(manifestPath),
                    MAX_MANIFEST_BYTES, "manifest_too_large");
            PatchDescription description;
            try {
                description = JSON.parseObject(new String(manifestBytes, UTF_8),
                        PatchDescription.class);
            } catch (RuntimeException e) {
                throw new PluginException("invalid_manifest", "Plugin desc.json is invalid JSON");
            }
            validateDescription(zip, entries, rootPrefix, description);
            return new PatchManifest(description);
        } finally {
            if (zip != null) {
                zip.close();
            }
        }
    }

    private Map<String, ZipEntry> validateOuterEntries(ZipFile zip)
            throws IOException, PluginException {
        Map<String, ZipEntry> entries = new LinkedHashMap<String, ZipEntry>();
        Enumeration<? extends ZipEntry> enumeration = zip.entries();
        long expanded = 0L;
        int count = 0;
        byte[] buffer = new byte[16 * 1024];
        while (enumeration.hasMoreElements()) {
            ZipEntry entry = enumeration.nextElement();
            count++;
            if (count > MAX_ARCHIVE_ENTRIES) {
                throw new PluginException("archive_entry_limit",
                        "Plugin package contains too many entries");
            }
            String name = validateZipEntryName(entry.getName());
            if (entries.put(name, entry) != null) {
                throw new PluginException("duplicate_archive_entry",
                        "Plugin package contains duplicate entries");
            }
            if (entry.isDirectory()) {
                continue;
            }
            long declared = entry.getSize();
            if (declared > MAX_ENTRY_BYTES) {
                throw new PluginException("archive_entry_too_large",
                        "Plugin package contains an oversized entry");
            }
            long compressed = entry.getCompressedSize();
            if (declared > 0L && compressed == 0L) {
                throw new PluginException("archive_compression_limit",
                        "Plugin package has an invalid compression ratio");
            }
            if (declared > 0L && compressed > 0L
                    && declared / compressed > MAX_COMPRESSION_RATIO) {
                throw new PluginException("archive_compression_limit",
                        "Plugin package exceeds the compression ratio limit");
            }

            InputStream input = null;
            long entryBytes = 0L;
            try {
                input = zip.getInputStream(entry);
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    if (read == 0) {
                        continue;
                    }
                    entryBytes += read;
                    expanded += read;
                    if (entryBytes > MAX_ENTRY_BYTES || expanded > MAX_EXPANDED_BYTES) {
                        throw new PluginException("archive_expansion_limit",
                                "Plugin package exceeds the expanded size limit");
                    }
                }
            } finally {
                if (input != null) {
                    input.close();
                }
            }
        }
        if (entries.isEmpty()) {
            throw new PluginException("empty_archive", "Plugin package is empty");
        }
        return entries;
    }

    private void validateDescription(ZipFile zip, Map<String, ZipEntry> entries,
                                     String rootPrefix, PatchDescription description)
            throws IOException, PluginException {
        if (description == null) {
            throw new PluginException("invalid_manifest", "Plugin desc.json is empty");
        }
        String name = description.getName();
        if (isEmpty(name) || !PLUGIN_NAME_PATTERN.matcher(name).matches()) {
            throw new PluginException("invalid_plugin_name", "Plugin name is invalid");
        }
        if (Constant.HOTPATCH_NAME.equals(name)) {
            throw new PluginException("core_plugin_protected",
                    "The built-in core plugin cannot be replaced");
        }
        float version = description.getVersion();
        if (Float.isNaN(version) || Float.isInfinite(version) || version <= 0F) {
            throw new PluginException("invalid_plugin_version", "Plugin version must be positive");
        }
        if (!isBoundedText(description.getFilter(), 256)) {
            throw new PluginException("invalid_plugin_filter", "Plugin class filter is invalid");
        }

        boolean hasPayload = false;
        String jar = description.getJar();
        if (!isEmpty(jar)) {
            hasPayload = true;
            validatePayload(zip, entries, rootPrefix, jar, description.getJarMd5(), "jar");
        } else if (!isEmpty(description.getJarMd5())) {
            throw new PluginException("invalid_manifest", "jarMd5 requires a jar entry");
        }

        String[] soList = description.getSoList();
        String[] soMd5s = description.getSoMd5s();
        Set<String> nativeLibraries = new HashSet<String>();
        if (soList != null && soList.length > 0) {
            hasPayload = true;
            if (soList.length > 64 || soMd5s == null || soMd5s.length != soList.length) {
                throw new PluginException("invalid_manifest",
                        "Native library names and hashes must have matching bounded lengths");
            }
            for (int i = 0; i < soList.length; i++) {
                if (!nativeLibraries.add(soList[i])) {
                    throw new PluginException("invalid_manifest",
                            "Native library entries must be unique");
                }
                validatePayload(zip, entries, rootPrefix, soList[i], soMd5s[i],
                        "native library");
            }
        } else if (soMd5s != null && soMd5s.length > 0) {
            throw new PluginException("invalid_manifest",
                    "soMd5s requires native library entries");
        }

        String[] preload = description.getPreloadSo();
        if (preload != null) {
            if (preload.length > 64) {
                throw new PluginException("invalid_manifest", "preloadSo contains too many entries");
            }
            for (String library : preload) {
                if (!isSafeLeafName(library) || !nativeLibraries.contains(library)) {
                    throw new PluginException("invalid_manifest",
                            "Every preloadSo entry must reference a declared native library");
                }
            }
        }

        String assets = description.getAssetsZip();
        if (!isEmpty(assets)) {
            hasPayload = true;
            ZipEntry assetEntry = validatePayload(zip, entries, rootPrefix, assets,
                    description.getAssetsMd5(), "assets archive");
            validateNestedAssetArchive(zip, assetEntry);
        } else if (!isEmpty(description.getAssetsMd5())) {
            throw new PluginException("invalid_manifest", "assetsMd5 requires an assets archive");
        }

        String mainClass = description.getMainClass();
        String mainMethod = description.getMainMethod();
        if (isEmpty(mainClass) != isEmpty(mainMethod)) {
            throw new PluginException("invalid_manifest",
                    "mainClass and mainMethod must be provided together");
        }
        if (!isEmpty(mainClass)) {
            if (isEmpty(jar) || !JAVA_CLASS_PATTERN.matcher(mainClass).matches()
                    || !JAVA_METHOD_PATTERN.matcher(mainMethod).matches()) {
                throw new PluginException("invalid_manifest", "Plugin entry point is invalid");
            }
        }
        if (!hasPayload) {
            throw new PluginException("empty_plugin", "Plugin descriptor contains no payload");
        }
    }

    private ZipEntry validatePayload(ZipFile zip, Map<String, ZipEntry> entries,
                                     String rootPrefix, String fileName,
                                     String expectedMd5, String label)
            throws IOException, PluginException {
        if (!isSafeLeafName(fileName)) {
            throw new PluginException("invalid_manifest", "Plugin " + label + " name is invalid");
        }
        if (isEmpty(expectedMd5) || !MD5_PATTERN.matcher(expectedMd5).matches()) {
            throw new PluginException("invalid_manifest", "Plugin " + label + " MD5 is invalid");
        }
        ZipEntry entry = entries.get(rootPrefix + fileName);
        if (entry == null || entry.isDirectory()) {
            throw new PluginException("missing_payload", "Plugin " + label + " entry is missing");
        }
        String actual = digestEntry(zip, entry, "MD5");
        if (!actual.equals(expectedMd5.toLowerCase(java.util.Locale.US))) {
            throw new PluginException("payload_digest_mismatch",
                    "Plugin " + label + " MD5 does not match desc.json");
        }
        return entry;
    }

    private void validateNestedAssetArchive(ZipFile outer, ZipEntry assetEntry)
            throws IOException, PluginException {
        InputStream raw = null;
        ZipInputStream zip = null;
        try {
            raw = outer.getInputStream(assetEntry);
            zip = new ZipInputStream(raw);
            Set<String> names = new HashSet<String>();
            byte[] buffer = new byte[16 * 1024];
            long total = 0L;
            int count = 0;
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                count++;
                if (count > MAX_ASSET_ENTRIES) {
                    throw new PluginException("asset_entry_limit",
                            "Plugin assets archive contains too many entries");
                }
                String name = validateZipEntryName(entry.getName());
                if (!names.add(name)) {
                    throw new PluginException("duplicate_asset_entry",
                            "Plugin assets archive contains duplicate entries");
                }
                if (entry.isDirectory()) {
                    continue;
                }
                long entryBytes = 0L;
                int read;
                while ((read = zip.read(buffer)) >= 0) {
                    if (read == 0) {
                        continue;
                    }
                    entryBytes += read;
                    total += read;
                    if (entryBytes > MAX_ASSET_ENTRY_BYTES
                            || total > MAX_ASSET_EXPANDED_BYTES) {
                        throw new PluginException("asset_expansion_limit",
                                "Plugin assets archive exceeds the expanded size limit");
                    }
                }
            }
            if (count == 0) {
                throw new PluginException("empty_assets_archive",
                        "Plugin assets archive is empty");
            }
        } finally {
            if (zip != null) {
                zip.close();
            } else if (raw != null) {
                raw.close();
            }
        }
    }

    private static String findManifestPath(Map<String, ZipEntry> entries)
            throws PluginException {
        String found = null;
        for (Map.Entry<String, ZipEntry> item : entries.entrySet()) {
            if (item.getValue().isDirectory()) {
                continue;
            }
            String name = item.getKey();
            if ("desc.json".equals(name)
                    || (name.endsWith("/desc.json") && slashCount(name) == 1)) {
                if (found != null) {
                    throw new PluginException("ambiguous_manifest",
                            "Plugin package contains multiple desc.json files");
                }
                found = name;
            }
        }
        if (found == null) {
            throw new PluginException("missing_manifest", "Plugin package does not contain desc.json");
        }
        return found;
    }

    private static void validateWrapperLayout(Set<String> entries, String rootPrefix)
            throws PluginException {
        if (rootPrefix.length() == 0) {
            return;
        }
        for (String name : entries) {
            if (name.startsWith("__MACOSX/") || name.equals("__MACOSX/")) {
                continue;
            }
            if (!name.startsWith(rootPrefix)) {
                throw new PluginException("invalid_archive_layout",
                        "A wrapped plugin package must use one top-level directory");
            }
        }
    }

    private static String validateZipEntryName(String value) throws PluginException {
        if (isEmpty(value) || value.length() > 512 || value.charAt(0) == '/'
                || value.charAt(0) == '\\' || value.indexOf('\\') >= 0
                || value.indexOf(':') >= 0 || containsControl(value)) {
            throw new PluginException("unsafe_archive_path",
                    "Plugin package contains an unsafe entry path");
        }
        String normalized = value.endsWith("/")
                ? value.substring(0, value.length() - 1) : value;
        if (normalized.length() == 0) {
            throw new PluginException("unsafe_archive_path",
                    "Plugin package contains an unsafe entry path");
        }
        String[] segments = normalized.split("/", -1);
        for (String segment : segments) {
            if (segment.length() == 0 || ".".equals(segment) || "..".equals(segment)) {
                throw new PluginException("unsafe_archive_path",
                        "Plugin package contains path traversal");
            }
        }
        return value;
    }

    private static byte[] readEntry(ZipFile zip, ZipEntry entry, int maxBytes, String errorCode)
            throws IOException, PluginException {
        if (entry == null || entry.isDirectory()) {
            throw new PluginException("missing_archive_entry", "Required archive entry is missing");
        }
        InputStream input = null;
        ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(maxBytes, 8192));
        try {
            input = zip.getInputStream(entry);
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read == 0) {
                    continue;
                }
                total += read;
                if (total > maxBytes) {
                    throw new PluginException(errorCode, "Required archive entry exceeds its size limit");
                }
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        } finally {
            if (input != null) {
                input.close();
            }
            output.close();
        }
    }

    private static String digestEntry(ZipFile zip, ZipEntry entry, String algorithm)
            throws IOException {
        MessageDigest digest = messageDigest(algorithm);
        InputStream input = null;
        try {
            input = zip.getInputStream(entry);
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read > 0) {
                    digest.update(buffer, 0, read);
                }
            }
            return hex(digest.digest());
        } finally {
            if (input != null) {
                input.close();
            }
        }
    }

    private ActiveCheck activeUseCheck(PatchLoadResult target) {
        try {
            if (HarnessState.isActive()) {
                return ActiveCheck.active();
            }
            CaseReplayManager replay = LauncherApplication.getInstance()
                    .findServiceByName(CaseReplayManager.class.getName());
            if (replay != null && replay.isRunning()) {
                return ActiveCheck.active();
            }
            CaseRecordManager record = LauncherApplication.getInstance()
                    .findServiceByName(CaseRecordManager.class.getName());
            if (record != null && (record.isRecording() || record.hasPreparedRecordCase())) {
                return ActiveCheck.active();
            }
            if (target != null && target.classLoader != null) {
                Context top = LauncherApplication.getInstance().loadActivityOnTop();
                if (top != null && top.getClass().getClassLoader() == target.classLoader) {
                    return ActiveCheck.active();
                }
            }

            ActiveCheck recordState = querySchemeActive("record",
                    Collections.singletonMap("recordMode", "status"));
            ActiveCheck performanceState = querySchemeActive("performance",
                    Collections.singletonMap("mode", "status"));
            ActiveCheck stressState = querySchemeActive("stress",
                    Collections.singletonMap("action", "status"));
            ActiveCheck screenRecordState = querySchemeActive("screen-record",
                    Collections.singletonMap("action", "status"));
            if (!recordState.known || !performanceState.known || !stressState.known
                    || !screenRecordState.known) {
                return ActiveCheck.unknown();
            }
            return recordState.active || performanceState.active || stressState.active
                    || screenRecordState.active
                    ? ActiveCheck.active() : ActiveCheck.idle();
        } catch (RuntimeException e) {
            LogUtil.w(TAG, "Unable to verify plugin activity", e);
            return ActiveCheck.unknown();
        }
    }

    private ActiveCheck querySchemeActive(String scheme, Map<String, String> params) {
        Map<String, SortedList<SchemeActionResolver>> registry =
                LauncherApplication.getInstance().getSchemeResolver();
        SortedList<SchemeActionResolver> resolvers = registry == null ? null : registry.get(scheme);
        if (resolvers == null) {
            return ActiveCheck.idle();
        }
        for (SchemeActionResolver resolver : resolvers) {
            ResultHolder holder = new ResultHolder();
            boolean accepted = resolver.processScheme(LauncherApplication.getContext(), params, holder);
            if (!accepted || holder.failed || holder.result == null
                    || Boolean.FALSE.equals(holder.result.get("success"))) {
                return ActiveCheck.unknown();
            }
            return Boolean.TRUE.equals(holder.result.get("active"))
                    ? ActiveCheck.active() : ActiveCheck.idle();
        }
        return ActiveCheck.idle();
    }

    private List<String> dependentPlugins(String pluginName) {
        List<String> result = new ArrayList<String>();
        for (PatchLoadResult candidate : ClassUtil.getAllPatches()) {
            if (candidate == null || candidate.dependencies == null) {
                continue;
            }
            if (candidate.dependencies.contains(pluginName)) {
                result.add(candidate.name);
            }
        }
        Collections.sort(result);
        return result;
    }

    private PatchLoadResult findPlugin(String id) {
        for (PatchLoadResult patch : ClassUtil.getAllPatches()) {
            if (patch != null && !isEmpty(patch.name) && pluginId(patch.name).equals(id)) {
                return patch;
            }
        }
        return null;
    }

    private List<ImportFile> enumerateImportFiles() throws IOException {
        return enumerateImportFiles(canonicalImportRoot());
    }

    private List<ImportFile> enumerateImportFiles(File root) throws IOException {
        File[] files = root.listFiles();
        if (files == null) {
            return Collections.emptyList();
        }
        List<ImportFile> result = new ArrayList<ImportFile>();
        for (File file : files) {
            if (!IMPORT_FILE_PATTERN.matcher(file.getName()).matches()
                    || !isSafeDirectFile(root, file)
                    || file.length() <= 0L || file.length() > MAX_ARCHIVE_BYTES) {
                continue;
            }
            result.add(new ImportFile(file, importFileId(file.getName())));
        }
        Collections.sort(result, new Comparator<ImportFile>() {
            @Override
            public int compare(ImportFile left, ImportFile right) {
                int modified = Long.valueOf(right.file.lastModified())
                        .compareTo(left.file.lastModified());
                return modified == 0
                        ? left.file.getName().compareTo(right.file.getName()) : modified;
            }
        });
        return result;
    }

    private ImportFile resolveImportFile(String fileName, String fileId)
            throws IOException, PluginException {
        if (isEmpty(fileName) && isEmpty(fileId)) {
            throw new PluginException("missing_import_selector",
                    "Parameter 'fileName' or 'fileId' is required");
        }
        if (!isEmpty(fileName) && !IMPORT_FILE_PATTERN.matcher(fileName).matches()) {
            throw new PluginException("invalid_file_name", "Parameter 'fileName' is invalid");
        }
        if (!isEmpty(fileId) && !IMPORT_ID_PATTERN.matcher(fileId).matches()) {
            throw new PluginException("invalid_file_id", "Parameter 'fileId' is invalid");
        }
        for (ImportFile candidate : enumerateImportFiles()) {
            boolean nameMatches = isEmpty(fileName) || candidate.file.getName().equals(fileName);
            boolean idMatches = isEmpty(fileId) || candidate.id.equals(fileId);
            if (nameMatches && idMatches) {
                return candidate;
            }
        }
        throw new PluginException("import_file_not_found",
                "Plugin package was not found in the controlled import directory");
    }

    private MutationStart beginMutation(String requestId, String action, String subject) {
        synchronized (RECEIPT_LOCK) {
            Map<String, Object> existing = RECEIPTS.get(requestId);
            if (existing != null) {
                boolean same = action.equals(existing.get("action"))
                        && subject.equals(existing.get("subject"));
                return new MutationStart(false, !same, false, false,
                        new LinkedHashMap<String, Object>(existing));
            }
            for (Map<String, Object> receipt : RECEIPTS.values()) {
                if ("in_progress".equals(receipt.get("state"))) {
                    return new MutationStart(false, false, true, false, null);
                }
            }
            if (!RuntimeSessionGuard.beginMaintenance(maintenanceOwner(requestId))) {
                return new MutationStart(false, false, false, true, null);
            }
            Map<String, Object> receipt = new LinkedHashMap<String, Object>();
            receipt.put("success", true);
            receipt.put("accepted", true);
            receipt.put("requestId", requestId);
            receipt.put("action", action);
            receipt.put("subject", subject);
            receipt.put("state", "in_progress");
            receipt.put("requestedAt", System.currentTimeMillis());
            RECEIPTS.put(requestId, receipt);
            return new MutationStart(true, false, false, false,
                    new LinkedHashMap<String, Object>(receipt));
        }
    }

    private void finishSuccess(String requestId, String state, Map<String, Object> fields) {
        Map<String, Object> updates = new LinkedHashMap<String, Object>();
        updates.put("success", true);
        updates.put("state", state);
        updates.put("completedAt", System.currentTimeMillis());
        if (fields != null) {
            updates.putAll(fields);
        }
        finishReceipt(requestId, updates);
    }

    private void finishFailure(String requestId, String errorCode, String message) {
        finishFailure(requestId, errorCode, message, null);
    }

    private void finishFailure(String requestId, String errorCode, String message,
                               Map<String, Object> fields) {
        Map<String, Object> updates = new LinkedHashMap<String, Object>();
        updates.put("success", false);
        updates.put("state", "failed");
        updates.put("errorCode", errorCode);
        updates.put("error", message);
        updates.put("completedAt", System.currentTimeMillis());
        if (fields != null) {
            updates.putAll(fields);
        }
        finishReceipt(requestId, updates);
    }

    private void finishReceipt(String requestId, Map<String, Object> updates) {
        synchronized (RECEIPT_LOCK) {
            Map<String, Object> current = RECEIPTS.get(requestId);
            if (current == null) {
                return;
            }
            Map<String, Object> finished = new LinkedHashMap<String, Object>(current);
            finished.putAll(updates);
            RECEIPTS.put(requestId, finished);
        }
        RuntimeSessionGuard.endMaintenance(maintenanceOwner(requestId));
    }

    private static String maintenanceOwner(String requestId) {
        return "plugin-maintenance:" + requestId;
    }

    private static File canonicalImportRoot() throws IOException {
        File root = FileUtils.getSubDir("patch").getCanonicalFile();
        if (!root.isDirectory()) {
            throw new IOException("Plugin import directory is unavailable");
        }
        return root;
    }

    private static boolean isSafeDirectFile(File root, File file) throws IOException {
        if (root == null || file == null || !file.isFile()) {
            return false;
        }
        File canonicalRoot = root.getCanonicalFile();
        File canonicalFile = file.getCanonicalFile();
        File expected = new File(canonicalRoot, file.getName()).getAbsoluteFile();
        return canonicalRoot.equals(canonicalFile.getParentFile())
                && expected.equals(canonicalFile);
    }

    private static String sourceOf(PatchLoadResult patch) {
        if (!isEmpty(patch.root)) {
            try {
                File managedRoot = FileUtils.getInnerSubDir("patch").getCanonicalFile();
                File patchRoot = new File(patch.root).getCanonicalFile();
                if (managedRoot.equals(patchRoot.getParentFile())) {
                    return "managed_patch_store";
                }
            } catch (IOException ignored) {
                // 继续使用唯一剩余的来源信息。
            }
        }
        return "runtime_registry";
    }

    private static boolean directoryHasEntries(String path) {
        if (isEmpty(path)) {
            return false;
        }
        File directory = new File(path);
        String[] entries = directory.isDirectory() ? directory.list() : null;
        return entries != null && entries.length > 0;
    }

    private static String validateRequestId(String requestId) throws PluginException {
        if (isEmpty(requestId)) {
            throw new PluginException("missing_request_id", "Parameter 'requestId' is required");
        }
        if (!REQUEST_ID_PATTERN.matcher(requestId).matches()) {
            throw new PluginException("invalid_request_id", "Parameter 'requestId' is invalid");
        }
        return requestId;
    }

    private static boolean isSafeLeafName(String value) {
        return !isEmpty(value) && value.length() <= 128
                && value.indexOf('/') < 0 && value.indexOf('\\') < 0
                && value.indexOf(':') < 0 && !".".equals(value) && !"..".equals(value)
                && !containsControl(value);
    }

    private static boolean isBoundedText(String value, int maxLength) {
        return value == null || (value.length() <= maxLength && !containsControl(value));
    }

    private static boolean containsControl(String value) {
        if (value == null) {
            return false;
        }
        for (int i = 0; i < value.length(); i++) {
            if (Character.isISOControl(value.charAt(i))) {
                return true;
            }
        }
        return false;
    }

    private static int slashCount(String value) {
        int result = 0;
        for (int i = 0; i < value.length(); i++) {
            if (value.charAt(i) == '/') {
                result++;
            }
        }
        return result;
    }

    private static MessageDigest messageDigest(String algorithm) {
        try {
            return MessageDigest.getInstance(algorithm);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(algorithm + " is unavailable", e);
        }
    }

    private static String pluginId(String name) {
        return "plugin-" + stableHash("plugin\u0000" + name);
    }

    private static String importFileId(String name) {
        return "plugin-import-" + stableHash("plugin-import\u0000" + name);
    }

    private static String stableHash(String value) {
        MessageDigest digest = messageDigest("SHA-256");
        return hex(digest.digest(value.getBytes(UTF_8)));
    }

    private static String hex(byte[] value) {
        char[] alphabet = "0123456789abcdef".toCharArray();
        char[] result = new char[value.length * 2];
        for (int i = 0; i < value.length; i++) {
            int item = value[i] & 0xff;
            result[i * 2] = alphabet[item >>> 4];
            result[i * 2 + 1] = alphabet[item & 0x0f];
        }
        return new String(result);
    }

    private static String safeString(String value) {
        return value == null ? "" : value;
    }

    private static boolean isEmpty(String value) {
        return value == null || value.length() == 0;
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

    private static final class ImportFile {
        final File file;
        final String id;

        ImportFile(File file, String id) {
            this.file = file;
            this.id = id;
        }
    }

    private static final class Snapshot {
        final File file;
        final String sha256;
        final long sizeBytes;

        Snapshot(File file, String sha256, long sizeBytes) {
            this.file = file;
            this.sha256 = sha256;
            this.sizeBytes = sizeBytes;
        }
    }

    private static final class PatchManifest {
        final PatchDescription description;

        PatchManifest(PatchDescription description) {
            this.description = description;
        }
    }

    private static final class MutationStart {
        final boolean created;
        final boolean conflict;
        final boolean busy;
        final boolean sessionBusy;
        final Map<String, Object> receipt;

        MutationStart(boolean created, boolean conflict, boolean busy, boolean sessionBusy,
                      Map<String, Object> receipt) {
            this.created = created;
            this.conflict = conflict;
            this.busy = busy;
            this.sessionBusy = sessionBusy;
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

    private static final class ResultHolder implements Callback<Map<String, Object>> {
        Map<String, Object> result;
        boolean failed;

        @Override
        public void onResult(Map<String, Object> item) {
            result = item;
        }

        @Override
        public void onFailed() {
            failed = true;
        }
    }

    private static final class PluginException extends Exception {
        final String errorCode;

        PluginException(String errorCode, String message) {
            super(message);
            this.errorCode = errorCode;
        }
    }
}
