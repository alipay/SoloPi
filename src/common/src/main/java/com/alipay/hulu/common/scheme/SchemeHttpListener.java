package com.alipay.hulu.common.scheme;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.http.HttpServer;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.SortedList;
import com.alipay.hulu.common.utils.StringUtil;

import java.util.Map;

import fi.iki.elonen.NanoHTTPD;

import static fi.iki.elonen.NanoHTTPD.newFixedLengthResponse;

public class SchemeHttpListener implements HttpServer.OnUrlRequestListener {
    private static final String TAG = SchemeHttpListener.class.getSimpleName();
    public static final String LISTEN_PATH = "/scheme/";

    @Override
    public NanoHTTPD.Response onPost(String url, Map<String, String> params, String content) {
        return null;
    }

    @Override
    public NanoHTTPD.Response onGet(String url, Map<String, String> params) {
        if (StringUtil.startWith(url, LISTEN_PATH)) {
            String realPath = url.substring(LISTEN_PATH.length());
            return doSchemeJump(LauncherApplication.getInstance().getSchemeResolver(), realPath, params);
        }
        return null;
    }

    /**
     * 实际跳转
     * @param resolvers
     * @param action
     * @param params
     */
    private NanoHTTPD.Response doSchemeJump(Map<String, SortedList<SchemeActionResolver>> resolvers, String action, Map<String, String> params) {
        if (resolvers == null || !resolvers.containsKey(action)) {
            return null;
        }

        LogUtil.i(TAG, "Begin to process scheme, action: %s, params: %s", action, params);

        try {
            SortedList<SchemeActionResolver> resolverList = resolvers.get(action);
            final JSONObject callback = new JSONObject();
            Callback<Map<String, Object>> emptyCallback = new Callback<Map<String, Object>>() {
                @Override
                public void onResult(Map<String, Object> item) {
                    callback.putAll(item);
                }

                @Override
                public void onFailed() {
                    LogUtil.w(TAG, "Receive fail callback");
                }
            };
            if (resolverList != null) {
                for (SchemeActionResolver realResolver : resolverList) {
                    if (realResolver.processScheme(LauncherApplication.getContext(), params, emptyCallback)) {
                        LogUtil.i(TAG, "Processed by " + realResolver.getClass().getSimpleName());
                        if (callback.isEmpty()) {
                            callback.put("status", "success");
                        }
                        return newFixedLengthResponse(NanoHTTPD.Response.Status.OK, "application/json", JSON.toJSONString(callback));
                    }
                }
            }
        } catch (Throwable t) {
            LogUtil.e(TAG, "handle resolver failed: " + t.getMessage(), t);
            return newFixedLengthResponse(NanoHTTPD.Response.Status.OK, "application/json", "{\"success\": false, \"error\": \"Process failed, throw exception: " + t.getMessage() + "\"}");
        }
        return null;
    }
}
