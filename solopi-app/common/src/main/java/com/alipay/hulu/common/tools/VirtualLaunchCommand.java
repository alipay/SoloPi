package com.alipay.hulu.common.tools;

/** Formats a resolved package/component launch; class names may have a different Java package. */
final class VirtualLaunchCommand {
    static String create(int displayId, String pkg, String cls) {
        if (displayId <= 0 || pkg == null || cls == null
                || !pkg.matches("[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)+")
                || !cls.matches("[A-Za-z_][A-Za-z0-9_.$]*")) {
            throw new IllegalArgumentException("invalid_virtual_launch");
        }
        return "shell:am start --display " + displayId + " -n " + pkg + "/" + cls;
    }
    private VirtualLaunchCommand() { }
}
