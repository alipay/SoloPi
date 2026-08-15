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
package com.alipay.hulu.common.utils.patch;

import com.alibaba.fastjson.annotation.JSONField;

import java.util.List;

/**
 * Created by qiaoruikai on 2018/12/18 10:44 PM.
 */
public final class PatchLoadResult {
    /**
     * so地址
     */
    public String soPath;

    /**
     * 需要预加载的SO
     */
    public String[] preloadSo;

    /**
     * jar包
     */
    public String jarPath;

    /**
     * Patch名称
     */
    public String name;

    /**
     * 类过滤器
     */
    public String filter;

    /**
     * 根目录
     */
    public String root;

    /**
     * 资源目录
     */
    public String assetsPath;

    /**
     * 版本信息
     */
    public float version = 1;

    /**
     * 入口类
     */
    public String entryClass;

    /**
     * 入口方法
     */
    public String entryMethod;

    /**
     * 依赖插件
     */
    public List<String> dependencies;

    /**
     * 类加载器
     */
    @JSONField(serialize = false)
    public PatchClassLoader classLoader;
}