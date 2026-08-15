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
package com.alipay.hulu.common.scheme;

import android.content.Context;

import com.alipay.hulu.common.utils.Callback;

import java.util.Map;

/**
 * Created by qiaoruikai on 2019/11/8 11:01 PM.
 */
public interface SchemeActionResolver {

    /**
     * 处理scheme消息
     * @param context Activity上下文
     * @param params 请求参数
     * @param callback 响应结果回调
     * @return
     */
    boolean processScheme(Context context, Map<String, String> params,
                          Callback<Map<String, Object>> callback);
}
