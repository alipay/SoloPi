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
package com.alipay.hulu.common.utils;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Pair;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.constant.Constant;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.patch.PatchClassLoader;
import com.alipay.hulu.common.utils.patch.PatchLoadResult;

import java.io.File;
import java.io.IOException;
import java.lang.annotation.Annotation;
import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.Set;

import dalvik.system.DexFile;

/**
 * Created by qiaoruikai on 2018/9/29 12:08 PM.
 */
public class ClassUtil {
    private static final String PATCH_SP = "Patch";
    private static final String PATCH_KEY = "patch";
    private static final String PATCH_INFO_RES = "patchInfo";
    private static final String TAG = ClassUtil.class.getSimpleName();

    private static boolean init = false;

    private static List<Class> classes = new ArrayList<>();

    private static Map<String, Pair<Float, String>> avaliablePatches = new HashMap<>();

    private static Map<String, PatchLoadResult> mPatchInfo = new HashMap<>();

    private final static Map<String, List<Class>> mPatchClasses = new HashMap<>();

    /**
     * 用来区分内部类与外部类
     */
    private static String mFilter;

    /**
     * 根据是否加载过类判断是否初始化完毕
     * @return
     */
    public static boolean recordClasses() {
        return classes.isEmpty();
    }

    /**
     * 初始化类
     * @param context
     * @param filter
     */
    public static void initClasses(Context context, String filter) {
        if (init) {
            return;
        }

        init = true;
        if (StringUtil.isEmpty(filter)) {
            mFilter = LauncherApplication.getInstance().getApplicationInfo().packageName;
        } else {
            mFilter = filter;
        }

        // 加载内部代码
        try {
            DexFile dex = new DexFile(context.getPackageCodePath());

            Enumeration<String> classNames = dex.entries();
            while (classNames.hasMoreElements()) {
                String className = classNames.nextElement();
                if ((StringUtil.isEmpty(mFilter) || StringUtil.contains(className, mFilter))) {
                    try {
                        LogUtil.d(TAG, "Scan class for %s", className);
                        Class childClazz = Class.forName(className);
                        classes.add(childClazz);
                        // 不要影响类扫描
                    } catch (ClassNotFoundException e) {
                        LogUtil.e(TAG, e, "Can't get class instance of %s", className);
                    }
                }
            }
        } catch (IOException e) {
            LogUtil.e(TAG, e, "Catch java.io.IOException: %s", e.getMessage());
        }

        // 加载patch类信息
        List<PatchLoadResult> patches = loadStoredPatches();
        if (patches != null) {
            initPatches(patches);
        }
    }

    public static <T> T constructClass(Class<T> targetClass, Object... arguments) {
        Class<?>[] classes;
        if (arguments == null || arguments.length == 0) {
            classes = null;
        } else {
            classes = new Class[arguments.length];
            for (int i = 0; i < arguments.length; i++) {
                classes[i] = arguments[i].getClass();
            }
        }

        return constructClass(targetClass, classes, arguments);
    }

    /**
     * 过滤类名
     * @param className
     * @param filter
     * @return
     */
    private static boolean filterClass(String className, List<String> filter) {
        for (String accept: filter) {
            if (StringUtil.contains(className, accept)) {
                return true;
            }
        }

        return false;
    }

    /**
     * 构造类
     *
     * @param targetClass 待构造类
     * @param arguments 构造函数
     * @return
     */
    public static <T> T constructClass(Class<T> targetClass, Class<?>[] classes, Object[] arguments) {
        // targetClass为空，无法构造
        if (targetClass == null) {
            return null;
        }

        try {
            // 通过参数类查找构造函数
            Constructor<T> constructor = targetClass.getDeclaredConstructor(classes);

            // 对于private的构造函数
            if (!constructor.isAccessible()) {
                constructor.setAccessible(true);
            }
            return constructor.newInstance(arguments);
        } catch (InstantiationException e) {
            LogUtil.e(TAG, "Catch java.lang.InstantiationException: " + e.getMessage(), e);
        } catch (IllegalAccessException e) {
            LogUtil.e(TAG, "Catch java.lang.IllegalAccessException: " + e.getMessage(), e);
        } catch (InvocationTargetException e) {
            LogUtil.e(TAG, "Catch java.lang.reflect.InvocationTargetException: " + e.getMessage(), e);
        } catch (NoSuchMethodException e) {
            LogUtil.e(TAG, "Catch java.lang.NoSuchMethodException: " + e.getMessage(), e);
        }

        return null;
    }

    /**
     * 获取类包含的所有方法
     * @param clazz
     * @return
     */
    public static List<Method> getAllMethods(Class clazz) {
        return getAllMethods(clazz, null);
    }

    /**
     * 获取类包含包含特定注解的所有方法
     * @param clazz 类
     * @param annotation 注解
     * @return
     */
    public static List<Method> getAllMethods(Class clazz, Class<Annotation> annotation) {
        if (clazz == null) {
            LogUtil.e(TAG, "无法获取空对象的方法");
        }

        List<Method> allMethods = new ArrayList<>();
        Class currentClass = clazz;
        while (currentClass != null) {
            Method[] currentLevelMethods = currentClass.getDeclaredMethods();
            for (Method method : currentLevelMethods) {
                if (annotation != null) {
                    // 查找目标注解
                    Annotation targetAnnotation = method.getAnnotation(annotation);
                    if (targetAnnotation == null) {
                        continue;
                    }
                }

                // 添加该方法
                allMethods.add(method);
            }

            currentClass = currentClass.getSuperclass();
        }

        return allMethods;
    }

    /**
     * 查找子类，过滤掉接口类
     * @param parent 父类
     * @param annotation 包含的注解
     * @return
     */
    public static <T> List<Class<? extends T>> findSubClass(Class<T> parent, Class<? extends Annotation> annotation) {
        return findSubClass(parent, annotation, false);
    }

    /**
     * 根据名称查找目标类
     * @param name
     * @return
     */
    public static Class<?> getClassByName(String name) {
        synchronized (mPatchClasses) {
            // patch部分类
            for (List<Class> patchClasses : mPatchClasses.values()) {
                for (Class childClass : patchClasses) {
                    if (childClass != null && StringUtil.equals(childClass.getName(), name)) {
                        return childClass;
                    }
                }
            }
        }

        for (Class clz: classes) {
            if (clz != null && StringUtil.equals(clz.getName(), name)) {
                return clz;
            }
        }

        return null;
    }


    /**
     * 查找子类
     * @param parent 父类
     * @param annotation 需要包含的注解
     * @return 找到的子类列表
     */
    public static <T> List<Class<? extends T>> findSubClass(Class<T> parent, Class<? extends Annotation> annotation, boolean acceptInterface) {
        if (parent == null) {
            return null;
        }

        List<Class<? extends T>> childrenClasses = new ArrayList<>();
        // 遍历查找子类
        for (Class childClass : classes) {
            if (childClass != null && parent.isAssignableFrom(childClass)) {

                // 如果需要包含特定注解
                if (annotation != null) {
                    Annotation targetAnnotation = childClass.getAnnotation(annotation);
                    if (targetAnnotation == null) {
                        continue;
                    }
                }

                if (!acceptInterface) {
                    if (childClass.isInterface()) {
                        continue;
                    }
                }
                childrenClasses.add(childClass);
            }
        }

        synchronized (mPatchClasses) {
            // patch部分类
            for (List<Class> patchClasses : mPatchClasses.values()) {
                for (Class childClass : patchClasses) {
                    if (childClass != null && parent.isAssignableFrom(childClass)) {

                        // 如果需要包含特定注解
                        if (annotation != null) {
                            Annotation targetAnnotation = childClass.getAnnotation(annotation);
                            if (targetAnnotation == null) {
                                continue;
                            }
                        }

                        childrenClasses.add(childClass);
                    }
                }
            }
        }

        return childrenClasses;
    }

    /**
     * 在Patch中查找子类
     * @param rs
     * @param parent
     * @param annotation
     * @param <T>
     * @return
     */
    public static <T> List<Class<? extends T>> findSubClassInPatch(PatchLoadResult rs, Class<T> parent, Class<? extends Annotation> annotation) {
        if (rs == null || !mPatchClasses.containsKey(rs.name)) {
            return Collections.emptyList();
        }

        List<Class<? extends T>> childrenClasses = new ArrayList<>();
        synchronized (mPatchClasses) {
            List<Class> patchClasses = mPatchClasses.get(rs.name);
            // patch部分类
            for (Class childClass : patchClasses) {
                if (childClass != null && parent.isAssignableFrom(childClass)) {

                    // 如果需要包含特定注解
                    if (annotation != null) {
                        Annotation targetAnnotation = childClass.getAnnotation(annotation);
                        if (targetAnnotation == null) {
                            continue;
                        }
                    }

                    childrenClasses.add(childClass);
                }
            }
        }

        return childrenClasses;
    }

    /**
     * 查找带有包含注解方法的类
     * @param annotation
     * @return
     */
    public static List<Class<?>> findClassWithMethodAnnotation(Class<? extends Annotation> annotation) {
        List<Class<?>> childrenClasses = new ArrayList<>();
        // 遍历查找子类
        for (Class childClass : classes) {
            if (childClass != null) {
                // 不找父类，因为父类也包含待注入方法
                for (Method method : childClass.getDeclaredMethods()) {
                    if (method.getAnnotation(annotation) != null) {
                        childrenClasses.add(childClass);
                        break;
                    }
                }
            }
        }

        // patch部分类
        synchronized (mPatchClasses) {
            for (List<Class> patchClasses : mPatchClasses.values()) {
                for (Class childClass : patchClasses) {
                    if (childClass != null) {
                        // 不找父类，因为父类也包含待注入方法
                        for (Method method : childClass.getDeclaredMethods()) {
                            if (method.getAnnotation(annotation) != null) {
                                childrenClasses.add(childClass);
                                break;
                            }
                        }
                    }
                }
            }
        }

        return childrenClasses;
    }

    /**
     * 获取patch信息
     * @return
     */
    private static List<PatchLoadResult> loadStoredPatches() {
        SharedPreferences sp = LauncherApplication.getInstance().getSharedPreferences(PATCH_SP, Context.MODE_PRIVATE);
        String patchInfo = sp.getString(PATCH_KEY, "[]");
        List<PatchLoadResult> currentPatches = JSON.parseArray(patchInfo, PatchLoadResult.class);

        // 加载缓存patch版本信息
        String storedPatch = sp.getString(PATCH_INFO_RES, "[]");
        List<PatchVersionInfo> infos = JSON.parseArray(storedPatch, PatchVersionInfo.class);
        for (PatchVersionInfo info: infos) {
            avaliablePatches.put(info.name, new Pair<>(info.version, info.url));
        }

        // 如果为空，添加hotpatch
        if (currentPatches == null || currentPatches.size() == 0) {
            currentPatches = Arrays.asList(loadDefaultHotPatch());
        } else {
            boolean findFlag = false;

            // 看看现有patch中是否包含hotpatch
            for (PatchLoadResult patch : currentPatches) {
                if (patch == null) {
                    continue;
                }

                if (StringUtil.equals(patch.name, Constant.HOTPATCH_NAME)) {
                    findFlag = true;
                    break;
                }
            }

            // 没找到，添加下
            if (!findFlag) {
                currentPatches.add(loadDefaultHotPatch());
            }
        }

        return currentPatches;
    }

    /**
     * 加载默认HOTPATCH
     * @return
     */
    private static PatchLoadResult loadDefaultHotPatch() {
        PatchLoadResult defaultHotPatch = new PatchLoadResult();
        defaultHotPatch.name = Constant.HOTPATCH_NAME;
        defaultHotPatch.version = Constant.HOTPATCH_VERSION;
        defaultHotPatch.filter = "";
        return defaultHotPatch;
    }

    /**
     * 获取插件信息
     * @param patchName
     * @return
     */
    public static PatchLoadResult getPatchInfo(String patchName) {
        if (StringUtil.isEmpty(patchName)) {
            return null;
        }

        return mPatchInfo.get(patchName);
    }

    /**
     * 初始化依赖
     * @param patches
     */
    private static void initPatches(List<PatchLoadResult> patches) {
        Queue<PatchLoadResult> result = new LinkedList<>(patches);
        Set<String> names = new HashSet<>();
        for (PatchLoadResult patch: patches) {
            names.add(patch.name);
        }

        //FIXME 9102年了还有goto
        skip: while (!result.isEmpty()) {
            PatchLoadResult patch = result.poll();
            List<String> dependencies = patch.dependencies;

            boolean matchDependency = true;
            if (dependencies != null) {
                for (String name : dependencies) {
                    // 依赖不存在，放弃注入
                    if (!names.contains(name)) {
                        LogUtil.e(TAG, "Dependency [%s] is not found for patch [%s]", name, patch.name);
                        continue skip;
                    }

                    if (mPatchInfo.get(name) == null) {
                        matchDependency = false;
                        break;
                    }
                }
            }

            if (matchDependency) {
                loadPatch(patch);
            } else {
                result.add(patch);
            }
        }
    }

    /**
     * 加载patch
     * @param patch
     */
    private static void loadPatch(PatchLoadResult patch) {
        String patchName = patch.name;
        String patchFilter = patch.filter;
        if (!StringUtil.isEmpty(patch.jarPath)) {
            PatchClassLoader clzLoader = new PatchClassLoader(patch,
                    LauncherApplication.getContext().getClassLoader());
            patch.classLoader = clzLoader;

            // 添加依赖
            if (patch.dependencies != null) {
                for (String name: patch.dependencies) {
                    PatchLoadResult depend = mPatchInfo.get(name);
                    if (depend == null) {
                        LogUtil.e(TAG, "无法添加Patch，依赖%s不存在", name);
                        return;
                    }
                    clzLoader.addDependentPatch(depend.classLoader);
                }
            }

            // 加载全量类信息
            List<Class> patchClasses = new ArrayList<>();
            try {
                // 防止4.X系统抛dalvik-cache权限异常
                DexFile dexFile = DexFile.loadDex(patch.jarPath, patch.jarPath + ".odex", 0);
                Enumeration<String> classNames = dexFile.entries();
                while (classNames.hasMoreElements()) {
                    String className = classNames.nextElement();
                    if ((StringUtil.isEmpty(patchFilter) || StringUtil.contains(className, patchFilter))) {
                        try {
                            Class childClazz = clzLoader.loadClass(className);
                            LogUtil.d(TAG, "Scan class %s in patch %s", className, patchName);
                            patchClasses.add(childClazz);
                            // 不要影响类扫描
                        } catch (ClassNotFoundException e) {
                            LogUtil.e(TAG, e, "Can't get class instance of %s in patch %s",
                                    className, patchName);
                        }
                    }
                }
            } catch (IOException e) {
                LogUtil.e(TAG, "Catch java.io.IOException: " + e.getMessage(), e);
            }

            // 如果找到了需要添加的信息
            synchronized (mPatchClasses) {
                if (patchClasses.size() > 0) {
                    mPatchClasses.put(patchName, patchClasses);
                }
            }
        }

        mPatchInfo.put(patchName, patch);
    }

    /**
     * 升级可用插件
     * @param pairs
     */
    public static void updateAvailablePatches(Map<String, Pair<Float, String>> pairs) {
        if (pairs == null) {
            return;
        }

        boolean updateFlag = false;
        for (String name : pairs.keySet()) {
            Pair<Float, String> newItem = pairs.get(name);
            Pair<Float, String> origin = avaliablePatches.get(name);
            if (origin == null) {
                LogUtil.d(TAG, "添加patch %s 版本 %f", name, newItem.first);
                avaliablePatches.put(name, newItem);
                updateFlag = true;
            } else if (newItem != null) {
                if (origin.first < newItem.first) {
                    LogUtil.d(TAG, "更新patch %s 版本 %f -> %f", name, origin.first, newItem.first);
                    avaliablePatches.put(name, newItem);
                    updateFlag = true;
                }
            }
        }

        if (updateFlag) {
            savePatchInfoToSP();
        }
    }

    /**
     * 存储patch信息到sp
     */
    private static void savePatchInfoToSP() {
        List<PatchVersionInfo> patchVersionInfos = new ArrayList<>(avaliablePatches.size() + 1);
        for (String key: avaliablePatches.keySet()) {
            Pair<Float, String> pair = avaliablePatches.get(key);
            patchVersionInfos.add(new PatchVersionInfo(key, pair.first, pair.second));
        }

        String newPatchStr = JSON.toJSONString(patchVersionInfos);
        SharedPreferences sp = LauncherApplication.getInstance()
                .getSharedPreferences(PATCH_SP, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = sp.edit();
        editor.putString(PATCH_INFO_RES, newPatchStr);
        editor.apply();
    }


    public static Pair<Float, String> getAvaliablePatchInfo(String name) {
        if (avaliablePatches == null || name == null) {
            return null;
        }

        return avaliablePatches.get(name);
    }

    /**
     * 安装插件
     * @param patch
     * @return
     */
    public static void installPatch(PatchLoadResult patch) {
        if (patch == null) {
            return;
        }

        PatchLoadResult installed = mPatchInfo.get(patch.name);
        boolean upgradeFlag = false;

        if (installed != null) {
            if (installed.version < patch.version) {
                mPatchInfo.remove(patch.name);
                synchronized (mPatchClasses) {
                    mPatchClasses.remove(patch.name);
                }
                upgradeFlag = true;
            } else {
                // 老版本，不安装
                return;
            }
        }

        loadPatch(patch);

        // 更新SP
        SharedPreferences sp = LauncherApplication.getInstance().getSharedPreferences(PATCH_SP, Context.MODE_PRIVATE);
        String patchInfo = sp.getString(PATCH_KEY, "[]");
        List<PatchLoadResult> patches = JSON.parseArray(patchInfo, PatchLoadResult.class);

        // 先卸载
        if (upgradeFlag) {
            Iterator<PatchLoadResult> resultIterator = patches.iterator();

            // SP中移除掉该patch
            while (resultIterator.hasNext()) {
                PatchLoadResult item = resultIterator.next();
                if (item != null && StringUtil.equals(item.name, patch.name)) {
                    resultIterator.remove();
                    break;
                }
            }
        }

        patches.add(patch);
        SharedPreferences.Editor editor = sp.edit();
        editor.putString(PATCH_KEY, JSON.toJSONString(patches));
        editor.apply();

        // 最后再更新Patch中的Services信息
        LauncherApplication.getInstance().registerPatchServices(patch);
    }

    /**
     * 移除patch
     * @param patch
     */
    public static void removePatch(String patch) {
        PatchLoadResult installed = mPatchInfo.get(patch);
        if (installed != null) {
            mPatchInfo.remove(patch);
            synchronized (mPatchClasses) {
                mPatchClasses.remove(patch);
            }
        } else {
            return;
        }

        // 更新SP
        SharedPreferences sp = LauncherApplication.getInstance().getSharedPreferences(PATCH_SP, Context.MODE_PRIVATE);
        String patchInfo = sp.getString(PATCH_KEY, "[]");
        List<PatchLoadResult> patches = JSON.parseArray(patchInfo, PatchLoadResult.class);
        Iterator<PatchLoadResult> resultIterator = patches.iterator();

        // SP中移除掉该patch
        while (resultIterator.hasNext()) {
            PatchLoadResult item = resultIterator.next();
            if (item != null && StringUtil.equals(item.name, patch)) {
                resultIterator.remove();
                break;
            }
        }

        SharedPreferences.Editor editor = sp.edit();
        editor.putString(PATCH_KEY, JSON.toJSONString(patches));
        editor.apply();
    }


    /**
     * 存储格式
     */
    public static class PatchVersionInfo {
        String name;
        float version;
        String url;

        public PatchVersionInfo() {
        }

        public PatchVersionInfo(String name, float version, String url) {
            this.name = name;
            this.version = version;
            this.url = url;
        }

        public String getName() {
            return name;
        }

        public void setName(String name) {
            this.name = name;
        }

        public float getVersion() {
            return version;
        }

        public void setVersion(float version) {
            this.version = version;
        }

        public String getUrl() {
            return url;
        }

        public void setUrl(String url) {
            this.url = url;
        }
    }
}
