package com.alipay.hulu.common.tools;

/** Formats only the fixed internal display-helper process, without a secret in argv. */
final class TrustedHelperCommand {
    private static final String ENTRY = "com.alipay.hulu.virtualscreen.TrustedDisplayHelperMain";

    static String create(String apkPath, String packageName, int appUid, String certificateSha256) {
        // Code security: apkPath and packageName must come from the installed app, and are strictly delimited.
        if (apkPath == null || apkPath.length() > 1024 || !apkPath.startsWith("/data/app/")
                || !apkPath.endsWith("/base.apk") || !apkPath.matches("/[A-Za-z0-9_./~+=-]+")
                || apkPath.contains("/../") || apkPath.contains("/./") || apkPath.contains("//")
                || packageName == null || !packageName.matches("[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)+")
                || appUid < 10000 || certificateSha256 == null || !certificateSha256.matches("[0-9a-f]{64}"))
            throw new IllegalArgumentException("invalid_trusted_helper_identity");
        return "shell:CLASSPATH=" + apkPath + " app_process /system/bin " + ENTRY + " " + packageName + " " + appUid + " " + certificateSha256;
    }

    private TrustedHelperCommand() { }
}
