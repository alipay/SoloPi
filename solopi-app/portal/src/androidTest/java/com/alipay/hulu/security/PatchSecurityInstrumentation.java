package com.alipay.hulu.security;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Bundle;
import android.os.SystemClock;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.constant.Constant;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.PatchProcessUtil;
import com.alipay.hulu.common.utils.patch.PatchLoadResult;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Enumeration;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/** Device regression runner. Supply an official signed archive in target files/security226/signed.zip. */
public final class PatchSecurityInstrumentation extends Instrumentation {
    private boolean restartOnly;
    @Override public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        restartOnly = arguments != null && "true".equals(arguments.getString("restartOnly"));
        start();
    }

    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            require("com.alipay.hulu.issue226".equals(getTargetContext().getPackageName()),
                    "run only against the isolated com.alipay.hulu.issue226 validation build");
            long deadline = SystemClock.uptimeMillis() + 30000;
            while (LauncherApplication.getInstance() == null
                    || !LauncherApplication.getInstance().hasFinishInit()) {
                require(SystemClock.uptimeMillis() < deadline, "application initialization timed out");
                SystemClock.sleep(100);
            }
            FileUtils.setSolopiBaseDir(new File(getTargetContext().getFilesDir(), "security226/data").getPath());
            verifyCachedPatches();
            if (restartOnly) {
                PatchLoadResult restored = ClassUtil.getPatchInfo("hulu_screenRecord");
                require(restored != null && restored.classLoader != null
                        && PatchProcessUtil.isTrustedInstalledPatch(restored), "signed patch did not reload after restart");
            } else {
                verifyArchives();
            }
            verifyControlInterface();
            result.putString("result", restartOnly
                    ? "PASS: signed patch reloaded after restart; unsigned cached patches rejected; HTTP boundaries preserved"
                    : "PASS: stale cache, signed install, unsigned/tampered archive, metadata binding, HTTP read/write boundaries");
            finish(Activity.RESULT_OK, result);
        } catch (Throwable failure) {
            result.putString("failure", android.util.Log.getStackTraceString(failure));
            finish(Activity.RESULT_CANCELED, result);
        }
    }

    private void verifyCachedPatches() {
        PatchLoadResult builtIn = ClassUtil.getPatchInfo(Constant.HOTPATCH_NAME);
        require(builtIn != null && builtIn.root == null && builtIn.jarPath == null,
                "cached hotpatch replaced the built-in placeholder");
        require(ClassUtil.getPatchInfo("unsigned_probe") == null, "unsigned cached patch was loaded");
    }

    private void verifyArchives() throws Exception {
        File signed = new File(getTargetContext().getFilesDir(), "security226/signed.zip");
        require(signed.isFile(), "missing official signed archive fixture");
        require(PatchProcessUtil.dynamicLoadPatch(rewrite(signed, "unsigned", "manifest.sig")) == null,
                "unsigned archive accepted");
        require(PatchProcessUtil.dynamicLoadPatch(rewrite(signed, "descriptor", "desc.json")) == null,
                "modified signed descriptor accepted");
        require(PatchProcessUtil.dynamicLoadPatch(rewrite(signed, "payload", "test.jar")) == null,
                "modified executable accepted");
        PatchLoadResult patch = PatchProcessUtil.dynamicLoadPatch(signed);
        require(patch != null && PatchProcessUtil.isTrustedInstalledPatch(patch), "official signed archive rejected");
        String expectedJar = patch.jarPath;
        patch.jarPath = new File(patch.root, "unsigned.dex").getPath();
        require(!PatchProcessUtil.isTrustedInstalledPatch(patch), "cached executable path override accepted");
        patch.jarPath = expectedJar;
        ClassUtil.installPatch(patch);
        require(ClassUtil.getPatchInfo(patch.name) == patch, "valid signed patch not installed");
    }

    private File rewrite(File original, String name, String modified) throws IOException {
        File output = new File(getTargetContext().getCacheDir(), "security226-" + name + ".zip");
        try (ZipFile input = new ZipFile(original); ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(output))) {
            Enumeration<? extends ZipEntry> entries = input.entries();
            byte[] buffer = new byte[8192];
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                if (entry.getName().endsWith("/manifest.sig") && modified.equals("manifest.sig")) continue;
                zip.putNextEntry(new ZipEntry(entry.getName()));
                if (entry.getName().endsWith("/" + modified)) {
                    zip.write("tampered".getBytes("UTF-8"));
                } else if (!entry.isDirectory()) {
                    try (InputStream source = input.getInputStream(entry)) {
                        int size;
                        while ((size = source.read(buffer)) != -1) zip.write(buffer, 0, size);
                    }
                }
                zip.closeEntry();
            }
        }
        return output;
    }

    private void verifyControlInterface() throws Exception {
        int port = SPService.getInt(SPService.KEY_CONTROL_PORT, 23342);
        String original = SPService.getString(SPService.KEY_PATCH_URL, "unset");
        long deadline = SystemClock.uptimeMillis() + 15000;
        String list;
        while (true) {
            try { list = get(port, "/scheme/config?action=list"); break; }
            catch (IOException exception) {
                if (SystemClock.uptimeMillis() >= deadline) throw exception;
                SystemClock.sleep(200);
            }
        }
        require(list.contains("configs"), "normal config query failed");
        String rejection = get(port, "/scheme/config?key=KEY_PATCH_URL&value=http%3A%2F%2F127.0.0.1%3A9%2Fprobe.json");
        require(rejection.contains("mutation_transport_required"),
                "HTTP config mutation was not explicitly rejected: " + rejection);
        require(original.equals(SPService.getString(SPService.KEY_PATCH_URL, "unset")), "HTTP changed patch URL");
    }

    private static String get(int port, String path) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection();
        connection.setConnectTimeout(1000);
        connection.setReadTimeout(3000);
        try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] bytes = new byte[4096];
            int size;
            while ((size = input.read(bytes)) != -1) output.write(bytes, 0, size);
            return output.toString("UTF-8");
        } finally { connection.disconnect(); }
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
