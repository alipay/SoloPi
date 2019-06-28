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
import com.alipay.hulu.common.injector.param.RunningThread;
import com.alipay.hulu.common.injector.provider.ParamReference;
import com.alipay.hulu.common.utils.LogUtil;

import java.lang.reflect.Method;

/**
 * Created by qiaoruikai on 2018/10/12 5:42 PM.
 */
public class InjectParamMeta {
    private Method targetMethod;
    private InjectParam paramType;
    private RunningThread thread;

    public InjectParamMeta(Method targetMethod, InjectParam paramType, RunningThread thread) {
        this.targetMethod = targetMethod;
        this.paramType = paramType;
        this.thread = thread;
    }

    public void addToReference(ParamReference reference, Object item) {
        if (!reference.addReference(item, targetMethod, thread)) {
            throw new RuntimeException(String.format("添加引用失败，reference=%s，target=%s", reference, item));
        }
    }

    public InjectParam getParamType() {
        return paramType;
    }

    public Method getTargetMethod() {
        return targetMethod;
    }
}
