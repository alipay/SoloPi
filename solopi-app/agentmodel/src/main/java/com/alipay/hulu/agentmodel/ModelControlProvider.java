package com.alipay.hulu.agentmodel;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.BatteryManager;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

public final class ModelControlProvider extends ContentProvider {
    public static final String AUTHORITY = "com.alipay.hulu.agentmodel.control";
    private static final String SCHEMA = "solopi.ai.model-manifest/v1";
    private static final String KEY_ID = "solopi-poc-2026";
    private static final String TRUSTED_PUBLIC_KEY =
            "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAv1yULfXXf1aDbE9sZqRsFSW6Zesu1fGALsUODSLn1Irx86DmQcqc+H+nUvHJS44WvSShkJLaajHqEku2c2hpQ4XRIeWKFuwNozE9ub3zrTxzbVmD1ZyEuEOf/IoPQQL1cQgYCE7YjD21xpjftQpctfb0yOYZCxLP9hn0wDNbLOVsprP5uxypGc+u4Jep3B6d+KNS/3Eu4IHJTC695GIuNlI/Ew0kaOpSv7H3NIraC4QIO1RoVAe98mCvMvLK2MIl/a79Bk/TfQJ7GHbzs78gqzRQv3iDhHqLMA4jz/GAAIO6RqxgXPm8eoZ41A2QhFfBY0TJtmihYsA09XRc/biuMwIDAQAB";
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,127}");
    private static final Pattern VERSION = Pattern.compile(
            "[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?");
    private static final Pattern TOKEN = Pattern.compile("[a-f0-9]{32}");
    private static final Set<String> METHODS = new HashSet<>(Arrays.asList(
            "health", "install", "status", "activate", "rollback", "infer", "benchmark"));
    private static final long MAX_MANIFEST = 1024L * 1024L;
    private static final long MAX_SIGNATURE = 64L * 1024L;
    private static final long MAX_MODEL = 8L * 1024L * 1024L * 1024L;

    private final ModelRuntimeEngine runtime = new ModelRuntimeEngine();

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Bundle call(String method, String arg, Bundle extras) {
        if (!METHODS.contains(method)) {
            return response(failure("unsupported_method", "Unsupported model control method"));
        }
        try {
            JSONObject result;
            if ("health".equals(method)) {
                result = health();
            } else if ("install".equals(method)) {
                result = install(required(extras, "token"));
            } else if ("status".equals(method)) {
                result = status(optional(extras, "modelId"));
            } else if ("activate".equals(method)) {
                result = activate(required(extras, "modelId"), required(extras, "version"));
            } else if ("rollback".equals(method)) {
                result = rollback(required(extras, "modelId"));
            } else if ("infer".equals(method)) {
                result = infer(required(extras, "modelId"), optional(extras, "version"),
                        required(extras, "inputsJson"));
            } else {
                result = benchmark(required(extras, "modelId"), optional(extras, "version"),
                        required(extras, "inputsJson"), integer(extras, "warmup", 2, 0, 100),
                        integer(extras, "iterations", 20, 1, 1000));
            }
            return response(result);
        } catch (ModelException error) {
            return response(failure(error.code, error.getMessage()));
        } catch (Throwable error) {
            return response(failure("runtime_failure", safeMessage(error)));
        }
    }

    private JSONObject health() throws JSONException {
        JSONObject result = success()
                .put("package", getContext().getPackageName())
                .put("runtime", "executorch")
                .put("runtimeVersion", "1.4.0")
                .put("apiLevel", Build.VERSION.SDK_INT)
                .put("abi", Build.SUPPORTED_ABIS[0])
                .put("backends", new JSONArray().put("xnnpack"))
                .put("optionalAccelerators", new JSONObject()
                        .put("gpu", false).put("npu", false));
        return result.put("models", status(null).get("models"));
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"w".equals(mode) && !"wt".equals(mode)) {
            throw new SecurityException("Staging is write-only");
        }
        if (!AUTHORITY.equals(uri.getAuthority()) || uri.getPathSegments().size() != 3
                || !"staging".equals(uri.getPathSegments().get(0))) {
            throw new SecurityException("Invalid staging URI");
        }
        String token = uri.getPathSegments().get(1);
        String name = uri.getPathSegments().get(2);
        if (!TOKEN.matcher(token).matches()
                || !("manifest.json".equals(name) || "manifest.sig".equals(name)
                || "model.pte".equals(name))) {
            throw new SecurityException("Invalid staging target");
        }
        File directory = new File(getContext().getCacheDir(), "staging/" + token);
        if (!directory.exists() && !directory.mkdirs()) {
            throw new FileNotFoundException("Unable to create staging directory");
        }
        File target = new File(directory, name);
        return ParcelFileDescriptor.open(target,
                ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE
                        | ParcelFileDescriptor.MODE_WRITE_ONLY);
    }

    private synchronized JSONObject install(String token) throws Exception {
        if (!TOKEN.matcher(token).matches()) {
            throw new ModelException("invalid_token", "Invalid staging token");
        }
        File staging = new File(getContext().getCacheDir(), "staging/" + token);
        File manifestFile = new File(staging, "manifest.json");
        File signatureFile = new File(staging, "manifest.sig");
        File modelFile = new File(staging, "model.pte");
        try {
            byte[] manifestBytes = readBounded(manifestFile, MAX_MANIFEST, "manifest");
            JSONObject manifest = validateManifest(new JSONObject(new String(manifestBytes, "UTF-8")));
            readBounded(signatureFile, MAX_SIGNATURE, "signature");
            if (!verifySignature(manifestBytes, signatureFile)) {
                throw new ModelException("invalid_signature", "Model signature is invalid");
            }
            JSONObject artifact = manifest.getJSONObject("artifact");
            if (modelFile.length() != artifact.getLong("sizeBytes")) {
                throw new ModelException("size_mismatch", "Model size does not match manifest");
            }
            String digest = sha256(modelFile);
            if (!digest.equals(artifact.getString("sha256"))) {
                throw new ModelException("checksum_mismatch", "Model checksum does not match manifest");
            }
            String modelId = manifest.getString("modelId");
            String version = manifest.getString("version");
            File modelRoot = new File(getContext().getFilesDir(), "models/" + modelId);
            File destination = new File(modelRoot, version);
            if (destination.exists()) {
                validateInstalledPackage(modelId, version);
                if (!sha256(new File(destination, "manifest.json")).equals(sha256(manifestFile))
                        || !sha256(new File(destination, "manifest.sig")).equals(sha256(signatureFile))
                        || !sha256(new File(destination, "model.pte")).equals(digest)) {
                    throw new ModelException("version_conflict", "Installed version has different content");
                }
                return success().put("modelId", modelId).put("version", version)
                        .put("installed", false).put("idempotent", true);
            }
            if (!modelRoot.exists() && !modelRoot.mkdirs()) {
                throw new IOException("Unable to create model directory");
            }
            File temporary = new File(modelRoot, ".install.tmp-" + UUID.randomUUID().toString());
            if (!temporary.mkdir()) {
                throw new IOException("Unable to create install transaction");
            }
            boolean committed = false;
            try {
                copy(manifestFile, new File(temporary, "manifest.json"));
                copy(signatureFile, new File(temporary, "manifest.sig"));
                copy(modelFile, new File(temporary, "model.pte"));
                if (!destination.exists() && !temporary.renameTo(destination)) {
                    throw new IOException("Unable to commit model installation");
                }
                committed = true;
            } finally {
                if (!committed) {
                    deleteRecursively(temporary);
                }
            }
            return success().put("modelId", modelId).put("version", version)
                    .put("installed", true).put("idempotent", false).put("sha256", digest);
        } finally {
            deleteRecursively(staging);
        }
    }

    private synchronized JSONObject activate(String modelId, String version) throws Exception {
        validateIdentity(modelId, version);
        File versionRoot = installedRoot(modelId, version);
        if (!versionRoot.isDirectory()) {
            throw new ModelException("model_not_installed", "Requested model version is not installed");
        }
        validateInstalledPackage(modelId, version);
        JSONObject load = runtime.load(new File(versionRoot, "model.pte"), modelId, version);
        SharedPreferences preferences = preferences();
        RegistryState state = new RegistryState(preferences.getString(activeKey(modelId), null),
                preferences.getString(previousKey(modelId), null)).activate(version);
        preferences.edit().putString(activeKey(modelId), state.activeVersion)
                .putString(previousKey(modelId), state.previousVersion).commit();
        return success().put("modelId", modelId).put("activeVersion", state.activeVersion)
                .put("previousVersion", nullable(state.previousVersion)).put("load", load);
    }

    private synchronized JSONObject rollback(String modelId) throws Exception {
        validateIdentity(modelId, null);
        SharedPreferences preferences = preferences();
        RegistryState current = new RegistryState(preferences.getString(activeKey(modelId), null),
                preferences.getString(previousKey(modelId), null));
        RegistryState target;
        try {
            target = current.rollback();
        } catch (IllegalStateException error) {
            throw new ModelException("rollback_unavailable", error.getMessage());
        }
        File targetRoot = installedRoot(modelId, target.activeVersion);
        if (!targetRoot.isDirectory()) {
            throw new ModelException("rollback_unavailable", "Previous model package is missing");
        }
        validateInstalledPackage(modelId, target.activeVersion);
        File model = new File(targetRoot, "model.pte");
        JSONObject load = runtime.load(model, modelId, target.activeVersion);
        preferences.edit().putString(activeKey(modelId), target.activeVersion)
                .putString(previousKey(modelId), target.previousVersion).commit();
        return success().put("modelId", modelId).put("activeVersion", target.activeVersion)
                .put("previousVersion", nullable(target.previousVersion)).put("load", load);
    }

    private JSONObject infer(String modelId, String version, String inputsJson) throws Exception {
        validateIdentity(modelId, version);
        String active = preferences().getString(activeKey(modelId), null);
        if (active == null || (version != null && !version.equals(active))) {
            throw new ModelException("model_not_active", "Requested model version is not active");
        }
        File model = new File(installedRoot(modelId, active), "model.pte");
        runtime.load(model, modelId, active);
        return runtime.infer(new JSONArray(inputsJson));
    }

    private JSONObject benchmark(String modelId, String version, String inputsJson,
                                 int warmup, int iterations) throws Exception {
        JSONArray samples = new JSONArray();
        BatteryManager battery = (BatteryManager) getContext().getSystemService(Context.BATTERY_SERVICE);
        long chargeBefore = battery == null ? Long.MIN_VALUE
                : battery.getLongProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER);
        for (int index = 0; index < warmup; index++) {
            infer(modelId, version, inputsJson);
        }
        JSONObject first = null;
        double maxMemory = 0.0d;
        for (int index = 0; index < iterations; index++) {
            long started = SystemClock.elapsedRealtimeNanos();
            JSONObject receipt = infer(modelId, version, inputsJson);
            double duration = (SystemClock.elapsedRealtimeNanos() - started) / 1_000_000.0d;
            samples.put(duration);
            if (first == null) {
                first = receipt;
            }
            maxMemory = Math.max(maxMemory, receipt.optDouble("memoryMb", 0.0d));
        }
        double[] ordered = new double[samples.length()];
        for (int index = 0; index < samples.length(); index++) {
            ordered[index] = samples.getDouble(index);
        }
        Arrays.sort(ordered);
        long chargeAfter = battery == null ? Long.MIN_VALUE
                : battery.getLongProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER);
        boolean powerAvailable = chargeBefore != Long.MIN_VALUE && chargeAfter != Long.MIN_VALUE;
        Object powerMah = powerAvailable
                ? Math.abs(chargeAfter - chargeBefore) / 1000.0d : JSONObject.NULL;
        return success().put("modelId", modelId)
                .put("version", first.getString("version"))
                .put("backend", "xnnpack")
                .put("samples", iterations).put("warmup", warmup)
                .put("coldStartMs", first.getDouble("loadMs"))
                .put("firstDecisionMs", samples.getDouble(0))
                .put("p50StepMs", percentile(ordered, 0.50d))
                .put("p95StepMs", percentile(ordered, 0.95d))
                .put("memoryMb", maxMemory)
                .put("powerMah", powerMah)
                .put("powerAvailable", powerAvailable)
                .put("latencySamplesMs", samples);
    }

    private JSONObject status(String requestedModelId) throws JSONException {
        JSONObject models = new JSONObject();
        File root = new File(getContext().getFilesDir(), "models");
        File[] modelDirectories = root.listFiles();
        if (modelDirectories != null) {
            for (File modelDirectory : modelDirectories) {
                if (!modelDirectory.isDirectory() || !ID.matcher(modelDirectory.getName()).matches()) {
                    continue;
                }
                String modelId = modelDirectory.getName();
                if (requestedModelId != null && !requestedModelId.equals(modelId)) {
                    continue;
                }
                JSONArray versions = new JSONArray();
                File[] versionDirectories = modelDirectory.listFiles();
                if (versionDirectories != null) {
                    for (File versionDirectory : versionDirectories) {
                        if (versionDirectory.isDirectory()
                                && VERSION.matcher(versionDirectory.getName()).matches()) {
                            versions.put(versionDirectory.getName());
                        }
                    }
                }
                models.put(modelId, new JSONObject()
                        .put("activeVersion", nullable(preferences().getString(activeKey(modelId), null)))
                        .put("previousVersion", nullable(preferences().getString(previousKey(modelId), null)))
                        .put("versions", versions));
            }
        }
        if (requestedModelId != null && !models.has(requestedModelId)) {
            throw new ModelException("model_not_found", "Model is not installed");
        }
        return success().put("models", models);
    }

    private JSONObject validateManifest(JSONObject manifest) throws Exception {
        if (!SCHEMA.equals(manifest.optString("schemaVersion"))) {
            throw new ModelException("invalid_manifest", "Unsupported manifest schema");
        }
        String modelId = manifest.getString("modelId");
        String version = manifest.getString("version");
        validateIdentity(modelId, version);
        JSONObject runtime = manifest.getJSONObject("runtime");
        if (!"executorch".equals(runtime.optString("name"))
                || !"1.4.0".equals(runtime.optString("version"))
                || !"xnnpack".equals(runtime.optString("backend"))) {
            throw new ModelException("unsupported_runtime", "Runtime is not approved");
        }
        JSONObject signature = manifest.getJSONObject("signature");
        if (!KEY_ID.equals(signature.optString("keyId"))
                || !"SHA256withRSA".equals(signature.optString("algorithm"))
                || !"manifest.sig".equals(signature.optString("file"))) {
            throw new ModelException("untrusted_key", "Manifest signing key is not trusted");
        }
        JSONObject artifact = manifest.getJSONObject("artifact");
        if (!"model.pte".equals(artifact.optString("file"))
                || artifact.getLong("sizeBytes") <= 0 || artifact.getLong("sizeBytes") > MAX_MODEL
                || !artifact.getString("sha256").matches("[0-9a-f]{64}")) {
            throw new ModelException("invalid_manifest", "Artifact contract is invalid");
        }
        JSONObject compatibility = manifest.getJSONObject("compatibility");
        if (Build.VERSION.SDK_INT < compatibility.getInt("minSdk")
                || Build.VERSION.SDK_INT > compatibility.getInt("maxSdk")) {
            throw new ModelException("incompatible_device", "Android API is incompatible");
        }
        JSONArray abis = compatibility.getJSONArray("abis");
        boolean abiMatch = false;
        for (String deviceAbi : Build.SUPPORTED_ABIS) {
            for (int index = 0; index < abis.length(); index++) {
                abiMatch |= deviceAbi.equals(abis.getString(index));
            }
        }
        if (!abiMatch) {
            throw new ModelException("incompatible_device", "Device ABI is incompatible");
        }
        JSONArray capabilities = compatibility.getJSONArray("requiredCapabilities");
        for (int index = 0; index < capabilities.length(); index++) {
            if (!"cpu".equals(capabilities.getString(index))) {
                throw new ModelException("incompatible_device", "Required capability is unavailable");
            }
        }
        return manifest;
    }

    private JSONObject validateInstalledPackage(String modelId, String version) throws Exception {
        File root = installedRoot(modelId, version);
        File manifestFile = new File(root, "manifest.json");
        File signatureFile = new File(root, "manifest.sig");
        File modelFile = new File(root, "model.pte");
        byte[] manifestBytes = readBounded(manifestFile, MAX_MANIFEST, "manifest");
        JSONObject manifest = validateManifest(new JSONObject(new String(manifestBytes, "UTF-8")));
        if (!modelId.equals(manifest.getString("modelId"))
                || !version.equals(manifest.getString("version"))) {
            throw new ModelException("identity_mismatch", "Installed package identity is invalid");
        }
        readBounded(signatureFile, MAX_SIGNATURE, "signature");
        if (!verifySignature(manifestBytes, signatureFile)) {
            throw new ModelException("invalid_signature", "Installed model signature is invalid");
        }
        JSONObject artifact = manifest.getJSONObject("artifact");
        if (modelFile.length() != artifact.getLong("sizeBytes")) {
            throw new ModelException("size_mismatch", "Installed model size is invalid");
        }
        if (!sha256(modelFile).equals(artifact.getString("sha256"))) {
            throw new ModelException("checksum_mismatch", "Installed model checksum is invalid");
        }
        return manifest;
    }

    private boolean verifySignature(byte[] manifest, File signatureFile) throws Exception {
        byte[] keyBytes = Base64.decode(TRUSTED_PUBLIC_KEY, Base64.DEFAULT);
        PublicKey publicKey = KeyFactory.getInstance("RSA")
                .generatePublic(new X509EncodedKeySpec(keyBytes));
        Signature verifier = Signature.getInstance("SHA256withRSA");
        verifier.initVerify(publicKey);
        verifier.update(manifest);
        return verifier.verify(readBounded(signatureFile, MAX_SIGNATURE, "signature"));
    }

    private static byte[] readBounded(File file, long maximum, String label) throws IOException {
        if (!file.isFile() || file.length() <= 0 || file.length() > maximum) {
            throw new IOException(label + " has an invalid size");
        }
        ByteArrayOutputStream output = new ByteArrayOutputStream((int) Math.min(file.length(), 65536));
        FileInputStream input = new FileInputStream(file);
        try {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                output.write(buffer, 0, count);
            }
        } finally {
            input.close();
        }
        return output.toByteArray();
    }

    private static void copy(File source, File destination) throws IOException {
        FileInputStream input = new FileInputStream(source);
        FileOutputStream output = new FileOutputStream(destination);
        try {
            byte[] buffer = new byte[1024 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                output.write(buffer, 0, count);
            }
            output.getFD().sync();
        } finally {
            input.close();
            output.close();
        }
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        FileInputStream input = new FileInputStream(file);
        try {
            byte[] buffer = new byte[1024 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                digest.update(buffer, 0, count);
            }
        } finally {
            input.close();
        }
        StringBuilder result = new StringBuilder();
        for (byte value : digest.digest()) {
            result.append(String.format(Locale.US, "%02x", value & 0xff));
        }
        return result.toString();
    }

    private static void deleteRecursively(File file) {
        if (file == null || !file.exists()) {
            return;
        }
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) {
                deleteRecursively(child);
            }
        }
        file.delete();
    }

    private File installedRoot(String modelId, String version) {
        return new File(getContext().getFilesDir(), "models/" + modelId + "/" + version);
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences("model-registry", Context.MODE_PRIVATE);
    }

    private static String activeKey(String modelId) {
        return "active." + modelId;
    }

    private static String previousKey(String modelId) {
        return "previous." + modelId;
    }

    private static void validateIdentity(String modelId, String version) {
        if (modelId == null || !ID.matcher(modelId).matches()
                || (version != null && !VERSION.matcher(version).matches())) {
            throw new ModelException("invalid_identity", "Invalid model identity or version");
        }
    }

    private static String required(Bundle extras, String key) {
        String value = optional(extras, key);
        if (value == null || value.length() == 0) {
            throw new ModelException("missing_argument", key + " is required");
        }
        return value;
    }

    private static String optional(Bundle extras, String key) {
        return extras == null ? null : extras.getString(key);
    }

    private static int integer(Bundle extras, String key, int fallback, int minimum, int maximum) {
        int value = extras == null ? fallback : extras.getInt(key, fallback);
        if (value < minimum || value > maximum) {
            throw new ModelException("invalid_argument", key + " is outside its allowed range");
        }
        return value;
    }

    private static JSONObject success() throws JSONException {
        return new JSONObject().put("success", true);
    }

    private static JSONObject failure(String code, String message) {
        try {
            return new JSONObject().put("success", false).put("errorCode", code)
                    .put("error", message);
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static Bundle response(JSONObject result) {
        Bundle bundle = new Bundle();
        bundle.putString("json", result.toString());
        return bundle;
    }

    private static Object nullable(String value) {
        return value == null ? JSONObject.NULL : value;
    }

    private static String safeMessage(Throwable error) {
        String message = error.getMessage();
        return message == null || message.length() == 0 ? error.getClass().getSimpleName() : message;
    }

    private static double percentile(double[] values, double percentile) {
        int index = Math.max(0, Math.min(values.length - 1,
                (int) Math.ceil(values.length * percentile) - 1));
        return values[index];
    }

    @Override public String getType(Uri uri) { return "application/octet-stream"; }
    @Override public Cursor query(Uri uri, String[] projection, String selection,
                                  String[] selectionArgs, String sortOrder) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection,
                                String[] selectionArgs) { return 0; }

    private static final class ModelException extends RuntimeException {
        final String code;

        ModelException(String code, String message) {
            super(message);
            this.code = code;
        }
    }
}
