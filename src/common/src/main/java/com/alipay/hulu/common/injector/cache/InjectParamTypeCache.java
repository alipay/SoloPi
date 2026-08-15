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
package com.alipay.hulu.common.injector.cache;

import com.alipay.hulu.common.injector.param.InjectParam;
import com.mdit.library.Const;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Created by qiaoruikai on 2018/10/12 5:40 PM.
 */
public class InjectParamTypeCache {
    private static InjectParamTypeCache cacheInstance;
    private Map<String, InjectParam> injectParamTypeList = new ConcurrentHashMap<>();

    public static InjectParamTypeCache getCacheInstance() {
        if (cacheInstance == null) {
            // 避免后续都得加锁
            synchronized (InjectParamTypeCache.class) {
                if (cacheInstance == null) {
                    cacheInstance = new InjectParamTypeCache();
                }
            }
        }

        return cacheInstance;
    }


    public void addCache(InjectParam cache) {
        injectParamTypeList.put(cache.getName(), cache);
    }

    public InjectParam getExistsParamType(String name) {
        return injectParamTypeList.get(name);
    }

    public InjectParam getExistsParamType(Class clazz) {
        String name;
        if (clazz.isPrimitive()) {
            name = Const.getPackedType(clazz).getName();
        } else {
            name = clazz.getName();
        }
        return injectParamTypeList.get(name);
    }
}
