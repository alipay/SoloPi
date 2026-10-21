package com.alipay.hulu.common.utils;

import com.alipay.hulu.common.application.LauncherApplication;

/** Runtime identity for side-by-side diagnostic builds; Java class names stay unchanged. */
public final class AppIdentity {
    private AppIdentity() {}

    public static String packageName() {
        return LauncherApplication.getContext().getPackageName();
    }

    public static String adbIme() {
        return packageName() + "/com.alipay.hulu.common.tools.AdbIME";
    }

    public static String adbImeShort() {
        return "com.alipay.hulu".equals(packageName())
                ? packageName() + "/.common.tools.AdbIME" : adbIme();
    }

    public static String accessibilityService() {
        return packageName() + "/com.alipay.hulu.shared.event.accessibility.AccessibilityServiceImpl";
    }

    public static String storageDirectory() {
        return "com.alipay.hulu".equals(packageName()) ? "solopi" : "solopi-" + packageName();
    }

    public static int controlPort() {
        return "com.alipay.hulu.trustbench".equals(packageName()) ? 23343 : 23342;
    }
}
