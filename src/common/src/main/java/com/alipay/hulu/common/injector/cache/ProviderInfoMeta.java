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
import com.alipay.hulu.common.injector.provider.ProviderInfo;
import com.alipay.hulu.common.injector.provider.WeakInjectItem;

import java.lang.reflect.Method;
import java.util.List;

/**
 * Created by qiaoruikai on 2018/10/12 5:38 PM.
 */
public class ProviderInfoMeta {
    /**
     * 更新间隔
     */
    private long updatePeriod;

    /**
     * 提供参数
     */
    private List<InjectParam> provideParams;

    private boolean force;

    /**
     * 是否懒惰
     */
    private boolean lazy;

    private Method targetMethod;

    public ProviderInfo buildProvider() {
        return new ProviderInfo(updatePeriod, provideParams, lazy, force);
    }

    /**
     * 构建调用类
     * @param target
     * @return
     */
    public WeakInjectItem buildWeakInjectItem(Object target) {
        return new WeakInjectItem(targetMethod, target, provideParams);
    }

    public ProviderInfoMeta(long updatePeriod, List<InjectParam> provideParams, boolean lazy, boolean force, Method targetMethod) {
        this.updatePeriod = updatePeriod;
        this.provideParams = provideParams;
        this.lazy = lazy;
        this.force = force;
        this.targetMethod = targetMethod;
    }
}
