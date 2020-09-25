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
package com.alipay.hulu.shared.display.items.base;

import androidx.annotation.StringRes;

import com.alipay.hulu.shared.display.items.util.FinalR;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Created by cathor on 17/7/26.
 */

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface DisplayItem {
    /**
     * 显示名称
     * @return
     */
    String name() default "";

    /**
     * 显示名称
     * @return
     */
    String key();

//    @StringRes
    FinalR nameRes() default FinalR.NULL;

    /**
     * 需动态申请权限
     * @return
     */
    String[] permissions() default {};

    String tip() default "";

    /**
     * 显示图标
     * @return
     */
    int icon() default 0;

    String trigger() default "";

    int level() default 1;
}
