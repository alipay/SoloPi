/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * 	http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.alipay.hulu.shared.display.items.util;

import androidx.annotation.StringRes;

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
    PROCESS_STATUS(R.string.performance__process_status),
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
