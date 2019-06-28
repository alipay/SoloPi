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

import com.alipay.hulu.common.utils.StringUtil;

public enum RunningModeEnum {
    ACCESSIBILITY_MODE("accessibilityMode", "通用模式"),
    CAPTURE_MODE("captureMode", "图像查找模式"),
    ;
    private String code;
    private String desc;

    RunningModeEnum(String code, String desc) {
        this.code = code;
        this.desc = desc;
    }

    public String getCode() {
        return code;
    }

    public String getDesc() {
        return desc;
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
