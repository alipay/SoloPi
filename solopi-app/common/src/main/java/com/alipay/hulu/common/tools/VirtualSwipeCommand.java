package com.alipay.hulu.common.tools;

/** Builds a bounded, display-specific swipe from locally verified coordinates. */
final class VirtualSwipeCommand {
    static String create(int displayId, int x1, int y1, int x2, int y2, int width, int height) {
        if (displayId <= 0 || width <= 0 || height <= 0 || width > 4096 || height > 4096
                || x1 < 0 || x1 >= width || x2 < 0 || x2 >= width
                || y1 < 0 || y1 >= height || y2 < 0 || y2 >= height
                || (x1 == x2 && y1 == y2)) throw new IllegalArgumentException("invalid_virtual_swipe");
        return "shell:input -d " + displayId + " swipe " + x1 + " " + y1 + " " + x2 + " " + y2
                + " 350; echo SOLOPI_SWIPE_EXIT:$?";
    }
    private VirtualSwipeCommand() { }
}
