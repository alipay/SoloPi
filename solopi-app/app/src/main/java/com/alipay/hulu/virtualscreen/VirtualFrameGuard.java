package com.alipay.hulu.virtualscreen;

import android.graphics.Bitmap;
import android.graphics.Rect;

/** Fail closed when the compositor supplies only black pixels for the relevant region. */
final class VirtualFrameGuard {
    static boolean allBlack(int[] pixels, int length) {
        if (pixels == null || length <= 0 || length > pixels.length) return true;
        for (int i = 0; i < length; i++) if ((pixels[i] & 0x00ffffff) != 0) return false;
        return true;
    }

    static boolean blackRegion(Bitmap bitmap, Rect region) {
        if (bitmap == null || bitmap.isRecycled() || region == null || region.left < 0 || region.top < 0
                || region.right > bitmap.getWidth() || region.bottom > bitmap.getHeight()
                || region.left >= region.right || region.top >= region.bottom) return true;
        int width = region.width();
        int[] row = new int[width];
        for (int y = region.top; y < region.bottom; y++) {
            bitmap.getPixels(row, 0, width, region.left, y, width, 1);
            if (!allBlack(row, width)) return false;
        }
        return true;
    }

    private VirtualFrameGuard() { }
}
