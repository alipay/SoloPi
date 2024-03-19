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
package com.alipay.hulu.status.impl;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.common.utils.HttpUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.status.StatusListener;

import java.io.IOException;

import okhttp3.Call;
import okhttp3.MediaType;
import okhttp3.RequestBody;

/**
 * 基于HTTP的状态上报器
 */
public class HttpStatusListener implements StatusListener {
    private static final String TAG = HttpStatusListener.class.getSimpleName();
    private String reportUrl;

    private JSONObject reportExtra;

    private StatusListener wrapper;

    public HttpStatusListener(String reportUrl, JSONObject reportExtra) {
        this.reportUrl = reportUrl;
        this.reportExtra = new JSONObject();
        if (reportExtra != null) {
            this.reportExtra.putAll(reportExtra);
        }
    }

    @Override
    public void onStatusChange(String state, JSONObject extra) {
        if (wrapper != null) {
            wrapper.onStatusChange(state, extra);
        }
        JSONObject toReport = new JSONObject(reportExtra);
        toReport.put("type", state);
        toReport.put("value", extra);

        LogUtil.i(TAG, "Prepare to report status %s to url %s", state, reportUrl);

        HttpUtil.post(reportUrl, RequestBody.create(MediaType.get("application/json"),
                JSON.toJSONBytes(toReport)), new HttpUtil.Callback<String>(String.class) {
            @Override
            public void onFailure(Call call, IOException e) {
                LogUtil.e(TAG, "Report status failed, throw exception", e);
            }

            @Override
            public void onResponse(Call call, String result) throws IOException {
                LogUtil.i(TAG, "Report status finished, response:" + result);
            }
        });
    }

    public void setWrapper(StatusListener wrapper) {
        this.wrapper = wrapper;
    }
}
