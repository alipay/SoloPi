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
package com.alipay.hulu.common.injector.provider;

import com.alipay.hulu.common.injector.param.SubscribeParamEnum;

import java.lang.annotation.ElementType;
import java.lang.annotation.Inherited;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 依赖注入方法注解
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Inherited
public @interface Provider {

    /**
     * 参数名称，可提供的参数列表 <br/>
     * {@link SubscribeParamEnum#APP} 应用名称，类型 {@link String} <br/>
     * {@link SubscribeParamEnum#UID} 应用UID，类型 {@link Integer} <br/>
     * {@link SubscribeParamEnum#PID} 应用PID，类型 {@link Integer} <br/>
     * {@link SubscribeParamEnum#EXTRA} 是否显示额外信息，类型 {@link Boolean} <br/>
     * {@link SubscribeParamEnum#PUID} ps获取的UID，类型 {@link String} <br/>
     */
    Param[] value() default {};

    long updatePeriod() default 1000;

    boolean lazy() default true;

    boolean force() default false;
}
