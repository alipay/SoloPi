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
package com.alipay.hulu.bean;

import com.alibaba.fastjson.JSONObject;

import java.util.List;

/**
 * Created by qiaoruikai on 2019-08-19 21:05.
 */
public class CaseRunningParam {
    private ParamMode mode;
    private List<JSONObject> paramList;

    public ParamMode getMode() {
        return mode;
    }

    public void setMode(ParamMode mode) {
        this.mode = mode;
    }

    public List<JSONObject> getParamList() {
        return paramList;
    }

    public void setParamList(List<JSONObject> paramList) {
        this.paramList = paramList;
    }

    /**
     * 可选模式
     */
    public enum ParamMode {
        SEPARATE,
        UNION
    }
}
