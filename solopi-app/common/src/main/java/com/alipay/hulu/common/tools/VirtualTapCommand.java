package com.alipay.hulu.common.tools;

/** Builds only a numeric, display-specific tap command. */
final class VirtualTapCommand {
    static String create(int displayId, int x, int y, int width, int height) {
        if (displayId <= 0 || width <= 0 || height <= 0 || width > 4096 || height > 4096
                || x < 0 || y < 0 || x >= width || y >= height) throw new IllegalArgumentException("invalid_virtual_tap");
        return "shell:input -d " + displayId + " tap " + x + " " + y + "; echo SOLOPI_TAP_EXIT:$?";
    }
    private VirtualTapCommand() { }
}
