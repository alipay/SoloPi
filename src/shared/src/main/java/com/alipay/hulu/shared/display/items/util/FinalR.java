package com.alipay.hulu.shared.display.items.util;

import android.content.Intent;
import android.support.annotation.StringRes;

import com.alipay.hulu.shared.R;

/**
 * Created by qiaoruikai on 2019/10/30 4:12 PM.
 */
public enum FinalR {
    RESPONSE_TIME(R.string.performance__response_time),
    FPS(R.string.performance__framerate),
    GAME_FPS(R.string.performance__game_fps),
    BATTERY(R.string.performance__battery),
    MEMORY(R.string.performance__memory),
    NETWORK(R.string.performance__network),
    NULL(-1)
    ;
    
    @StringRes
    private final int realVal;
    
    private FinalR(@StringRes int res) {
        this.realVal = res;
    }

    public int getRealVal() {
        return realVal;
    }
}
