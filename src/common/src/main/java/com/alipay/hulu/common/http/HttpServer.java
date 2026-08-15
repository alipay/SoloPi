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
package com.alipay.hulu.common.http;

import android.util.Log;

import com.alipay.hulu.common.utils.LogUtil;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import fi.iki.elonen.NanoHTTPD;

public class HttpServer extends NanoHTTPD {
    private static final String TAG = "Perf-HttpServer";
    private static final String FAIL_RESPONSE_NO_PROCESS = "{\"success\": false, \"error\": \"No Valid Listener\"}";

    private List<OnUrlRequestListener> listeners;

    public HttpServer(int port) {
        super(port);
        listeners = new ArrayList<>();
    }

    @Override
    public void start() throws IOException {
        try {
            super.start();
        } catch (IOException e) {
            Log.e(TAG, "Fail to start", e);
            throw e;
        }
    }

    public void addListener(OnUrlRequestListener listener) {
        if (listeners.contains(listener)) {
            return;
        }

        LogUtil.i(TAG, "注册URL监听器");
        this.listeners.add(listener);
    }

    public void removeListener(OnUrlRequestListener listener) {
        listeners.remove(listener);
    }

    /**
     * 获取当前所有监听器
     * @return
     */
    public List<OnUrlRequestListener> getAllListeners() {
        return new ArrayList<>(listeners);
    }

    /**
     * 移除所有监听器
     */
    public void removeAllListeners() {
        this.listeners.clear();
    }

    /**
     * 添加所有监听器
     * @param listeners
     */
    public void addAllListeners(List<OnUrlRequestListener> listeners) {
        this.listeners.addAll(listeners);
    }

    @Override
    public Response serve(IHTTPSession session) {
        String url = session.getUri();
        Map<String, String> requestParam = session.getParms();
        /*我在这里做了一个限制，只接受POST请求。这个是项目需求。*/
        if (Method.POST.equals(session.getMethod())) {
            Map<String, String> files = new HashMap<String, String>();
            /*获取header信息，NanoHttp的header不仅仅是HTTP的header，还包括其他信息。*/
            Map<String, String> header = session.getHeaders();
            try {
                /*这句尤为重要就是将将body的数据写入files中，大家可以看看parseBody具体实现，倒现在我也不明白为啥这样写。*/
                session.parseBody(files);
                /*看就是这里，POST请教的body数据可以完整读出*/

                String content = files.get("postData");

                LogUtil.i(TAG, "Receive Post message:::url[%s], requestParam[%s], content=%s", url, requestParam, content);

                for (OnUrlRequestListener listener: listeners) {
                    Response res = listener.onPost(url, requestParam, content);
                    if (res != null) {
                        return res;
                    }
                }
            } catch (IOException e) {
                Log.e(TAG, "Process request fail", e);
            } catch (ResponseException e) {
                Log.e(TAG, "Process request fail", e);
            }
            /*这里就是为客户端返回的信息了。我这里返回了一个200和一个HelloWorld*/
            return NanoHTTPD.newFixedLengthResponse(Response.Status.OK, "application/json", FAIL_RESPONSE_NO_PROCESS);
        } else {
            LogUtil.i(TAG, "Receive Get message:::url[%s], requestParam[%s]", url, requestParam);
            for (OnUrlRequestListener listener: listeners) {
                Response res = listener.onGet(url, requestParam);
                if (res != null) {
                    return res;
                }
            }
            return NanoHTTPD.newFixedLengthResponse(Response.Status.OK, "text/html", FAIL_RESPONSE_NO_PROCESS);
        }
    }

    public interface OnUrlRequestListener {
        /**
         * 处理POST请求
         * @param url
         * @param content
         * @return
         */
        NanoHTTPD.Response onPost(String url, Map<String, String> params, String content);

        /**
         * 处理GET请求
         * @param url
         * @return
         */
        NanoHTTPD.Response onGet(String url, Map<String, String> params);
    }
}