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
package com.alipay.hulu.shared.node.utils;

import java.util.HashMap;
import java.util.Map;

/**
 * Created by qiaoruikai on 2018/10/8 4:30 PM.
 */
public class NodeContext extends HashMap<String, Object> {
    public <T> T getField(String name, T defaultValue) {
        T target = (T) get(name);
        if (target == null) {
            return defaultValue;
        }

        return target;
    }

    public NodeContext() {
    }

    public NodeContext(Map<String, ?> m) {
        super(m);
    }

    public <T> T getField(String name) {
        return getField(name, null);
    }
}
