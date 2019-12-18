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
package com.alipay.hulu.activity.entry;

import android.support.annotation.StringRes;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Created by qiaoruikai on 2018/10/22 12:53 AM.
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface EntryActivity {
    /**
     * 图标
     * @return
     */
    int icon();

    /**
     * 显示名称
     *
     * @return
     */
    String name() default "";

    /**
     * name string res
     * @return
     */
    @StringRes
    int nameRes() default 0;

    /**
     * 依赖权限
     *
     * @return
     */
    String[] permissions() default {};

    /**
     * 标签优先级
     *
     * @return
     */
    int level() default 1;

    /**
     * 顺序
     *
     * @return
     */
    int index();

    /**
     * 角标背景色
     *
     * @return
     */
    int cornerBg() default 0;

    /**
     * 角标文字
     * 空不显示
     * @return
     */
    String cornerText() default "";

    /**
     * 角标显示时长
     * 1: 点击一次消失
     * 0: 长期显示
     *
     * @return
     */
    int cornerPersist() default 1;

    /**
     * 色彩饱和度
     *
     * @return
     */
    float saturation() default 1F;
}
