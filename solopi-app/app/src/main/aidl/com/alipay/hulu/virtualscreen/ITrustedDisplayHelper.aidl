package com.alipay.hulu.virtualscreen;

import android.view.Surface;
import android.os.IBinder;

/** Narrow internal interface: a helper owns at most one display. */
interface ITrustedDisplayHelper {
    int create(in Surface surface, int width, int height, int densityDpi, IBinder ownerToken);
    void release(int displayId);
    void cleanup();
    void shutdown();
}
