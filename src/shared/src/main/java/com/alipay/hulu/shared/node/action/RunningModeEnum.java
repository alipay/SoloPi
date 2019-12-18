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
package com.alipay.hulu.shared.node.action;

import android.support.annotation.StringRes;

import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.R;

public enum RunningModeEnum {
    ACCESSIBILITY_MODE("accessibilityMode", R.string.running_mode__accessibility_mode),
    CAPTURE_MODE("captureMode", R.string.running_mode__capture_mode),
    ;
    private String code;
    private int desc;

    RunningModeEnum(String code, @StringRes int desc) {
        this.code = code;
        this.desc = desc;
    }

    public String getCode() {
        return code;
    }

    public String getDesc() {
        return StringUtil.getString(desc);
    }

    /**
     * 通过code获取运行模式
     * @param code
     * @return
     */
    public static RunningModeEnum getModeByCode(String code) {
        for (RunningModeEnum item: values()) {
            if(StringUtil.equals(item.code, code)) {
                return item;
            }
        }

        return null;
    }
}
