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
package com.alipay.hulu.common.utils;

import android.os.Build;

import com.alibaba.fastjson.JSONException;
import com.alibaba.fastjson.JSONReader;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.SSLContext;

import okhttp3.Call;
import okhttp3.ConnectionSpec;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okhttp3.TlsVersion;

/**
 * Created by qiaoruikai on 2019/3/12 3:30 PM.
 */
public class HttpUtil {
    private static final String TAG = "HttpUtil";
    private static OkHttpClient _instance;

    /**
     * 获取HttpClient
     * @return
     */
    public static OkHttpClient getHttpClient() {
        if (_instance == null) {
            OkHttpClient.Builder builder = new OkHttpClient.Builder()
                    .followRedirects(true)
                    .followSslRedirects(true)
                    .retryOnConnectionFailure(true)
                    .cache(null)
                    .connectTimeout(5, TimeUnit.SECONDS)
                    .writeTimeout(5, TimeUnit.SECONDS)
                    .readTimeout(5, TimeUnit.SECONDS);

            _instance = enableTls12OnPreLollipop(builder).build();
        }

        return _instance;
    }

    /**
     * get请求
     * @param url 请求地址
     * @param callback 回调
     */
    public static void get(String url, okhttp3.Callback callback) {
        if (StringUtil.isEmpty(url)) {
            LogUtil.e(TAG, "无法解析空连接");
            return;
        }

        OkHttpClient client = getHttpClient();
        Request request = new Request.Builder()
                .get().url(url).build();

        client.newCall(request).enqueue(callback);
    }

    /**
     * get请求
     * @param url 请求地址
     */
    public static String getSync(String url) throws IOException {
        if (StringUtil.isEmpty(url)) {
            LogUtil.e(TAG, "无法解析空连接");
            return null;
        }

        OkHttpClient client = getHttpClient();
        Request request = new Request.Builder()
                .get().url(url).build();

        ResponseBody body = client.newCall(request).execute().body();
        if (body == null) {
            return null;
        }
        return body.string();
    }

    /**
     * post请求
     * @param url 请求地址
     * @param body 参数
     * @param callback 回调
     */
    public static void post(String url, RequestBody body, okhttp3.Callback callback) {
        if (StringUtil.isEmpty(url)) {
            LogUtil.e(TAG, "无法解析空连接");
            return;
        }

        OkHttpClient client = getHttpClient();
        Request request = new Request.Builder()
                .post(body).url(url).build();

        client.newCall(request).enqueue(callback);
    }

    /**
     * 同步post
     * @param url
     * @param body
     * @return
     * @throws IOException
     */
    public static String postSync(String url, RequestBody body) throws IOException {
        if (StringUtil.isEmpty(url)) {
            LogUtil.e(TAG, "无法解析空连接");
            return null;
        }

        OkHttpClient client = getHttpClient();
        Request request = new Request.Builder()
                .post(body).url(url).build();

        ResponseBody resBody = client.newCall(request).execute().body();
        if (resBody == null) {
            return null;
        }
        return resBody.string();
    }

    /**
     * 对API19、20以及部分三星api 21的设备需要处理下TLS 1.2<br/>
     * <a href="https://github.com/square/okhttp/issues/2372#issuecomment-244807676">Fix连接</a>
     * @param client
     * @return
     */
    private static OkHttpClient.Builder enableTls12OnPreLollipop(OkHttpClient.Builder client) {
        if (Build.VERSION.SDK_INT < 22) {
            try {
                SSLContext sc = SSLContext.getInstance("TLSv1.2");
                sc.init(null, null, null);
                client.sslSocketFactory(new Tls12SocketFactory(sc.getSocketFactory()));

                ConnectionSpec cs = new ConnectionSpec.Builder(ConnectionSpec.MODERN_TLS)
                        .tlsVersions(TlsVersion.TLS_1_2)
                        .build();

                List<ConnectionSpec> specs = new ArrayList<>();
                specs.add(cs);
                specs.add(ConnectionSpec.COMPATIBLE_TLS);
                specs.add(ConnectionSpec.CLEARTEXT);

                client.connectionSpecs(specs);
            } catch (Exception exc) {
                LogUtil.e(TAG, "Error while setting TLS 1.2", exc);
            }
        }

        return client;
    }

    /**
     * 包装一层fastJSON解析
     * @param <T>
     */
    public static abstract class Callback<T> implements okhttp3.Callback {
        Class<T> tClass;

        public Callback(Class<T> targetClass) {
            this.tClass = targetClass;
        }

        @Override
        public void onResponse(Call call, Response response) throws IOException {
            if (!response.isSuccessful()) {
                onFailure(call, new IOException(String.format("Received http response code %d", response.code())));
                return;
            }

            ResponseBody body = response.body();

            // 空对象直接空返回
            if (body == null) {
                onResponse(call, (T)null);
            } else {
                JSONReader reader = null;
                try {
                    reader = new JSONReader(body.charStream());
                    T parsed = reader.readObject(tClass);
                    onResponse(call, parsed);
                } finally {
                    if (reader != null) {
                        try {
                            reader.close();
                        } catch (JSONException e) {
                            LogUtil.e(TAG, "Close reader failed: " + e.getMessage(), e);
                        }
                    }
                }
            }
        }

        public abstract void onResponse(Call call, T item) throws IOException;
    }
}
