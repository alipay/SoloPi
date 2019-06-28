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

import java.util.HashMap;
import java.util.Map;

/**
 * Created by qiaoruikai on 2018/10/12 9:29 PM.
 */
public class UIOperationMessage {
    public static final int TYPE_DOWNLOAD = 0;
    public static final int TYPE_DEVICE_INFO = 1;
    public static final int TYPE_DIALOG = 2;
    public static final int TYPE_COUNT_DOWN = 3;
    public static final int TYPE_DISMISS = -1;

    public int eventType;
    public Map<String, Object> params = new HashMap<>();

    public void putParam(String key, Object value) {
        params.put(key, value);
    }

    public <T> T getParam(String key) {
        return (T) params.get(key);
    }
}
