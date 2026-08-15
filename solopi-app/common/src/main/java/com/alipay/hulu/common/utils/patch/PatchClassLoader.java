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

import java.net.URL;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import dalvik.system.DexClassLoader;
import dalvik.system.PathClassLoader;

/**
 * Created by qiaoruikai on 2018/12/20 10:21 PM.
 */
public class PatchClassLoader extends DexClassLoader {
    private static final String TAG = "PathClassLoader";
    private Map<String, Class<?>> loadedClasses;

    private List<PatchClassLoader> dependencyClassLoaders;

    /**
     * 相关环境
     */
    private PatchContext context;

    public PatchClassLoader(PatchLoadResult patch, ClassLoader parent) {
        super(patch.jarPath, patch.root, patch.soPath, parent);
        this.context = new PatchContextImpl(patch);

        loadedClasses = new HashMap<>();
        dependencyClassLoaders = new ArrayList<>();
    }

    /**
     * 获取自身加载的类
     * @param name
     * @return
     */
    public Class loadSelfClass(String name) {
        return loadedClasses.get(name);
    }

    /**
     * 添加依赖的ClassLoader
     * @param classLoader
     */
    public void addDependentPatch(PatchClassLoader classLoader) {
        dependencyClassLoaders.add(classLoader);
    }

    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        Class<?> clz = super.findClass(name);
        if (clz != null) {
            loadedClasses.put(name, clz);
        }
        return clz;
    }

    @Override
    protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
        if (loadedClasses.containsKey(name)) {
            return loadedClasses.get(name);
        }

        if (dependencyClassLoaders != null) {
            for (PatchClassLoader depend: dependencyClassLoaders) {
                Class parent = depend.loadSelfClass(name);
                if (parent != null) {
                    return parent;
                }
            }
        }

        return super.loadClass(name, resolve);
    }

    /**
     * 获取patch关联的Context信息
     * @return
     */
    public PatchContext getContext() {
        return context;
    }

    @Override
    protected URL findResource(String name) {
        return super.findResource(name);
    }

    @Override
    protected Enumeration<URL> findResources(String name) {
        return super.findResources(name);
    }

    @Override
    public String findLibrary(String name) {
        return super.findLibrary(name);
    }

    @Override
    protected synchronized Package getPackage(String name) {
        return super.getPackage(name);
    }
}
