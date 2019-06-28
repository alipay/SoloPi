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
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.injector.provider.Provider;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.mdit.library.Const;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Created by qiaoruikai on 2018/10/12 6:15 PM.
 */
public class ClassInfoCache {
    private static final String TAG = "ClassInfoCache";
    private Map<Class, ClassInfo> classInfoCache = new ConcurrentHashMap<>();

    /**
     * 读取并缓存类信息
     * @param type
     * @return
     */
    public ClassInfo getClassInfo(Class<?> type) {
        ClassInfo target = classInfoCache.get(type);
        if (target == null) {
            target = loadClassInfo(type);
            classInfoCache.put(type, target);
        }

        return target;
    }

    /**
     * 加载类信息
     * @param clazz
     * @return
     */
    private ClassInfo loadClassInfo(Class<?> clazz) {
        List<Method> allMethods = ClassUtil.getAllMethods(clazz);
        List<ProviderInfoMeta> providerInfoMetas = new ArrayList<>();
        List<InjectParamMeta> injectInfoMetas = new ArrayList<>();

        // 查找是否是类级的Provider
        Provider classAnnotation = clazz.getAnnotation(Provider.class);
        if (classAnnotation != null) {
            loadProvideTypes(classAnnotation, null);
        }

        // 查找依赖注入方法
        for (Method method: allMethods) {
            Subscriber param = method.getAnnotation(Subscriber.class);
            if (param != null) {
                List<InjectParam> types = loadParamType(param, method);
                if (types == null) {
                    continue;
                }

                // 分别添加
                for (InjectParam type: types) {
                    injectInfoMetas.add(new InjectParamMeta(method, type, param.thread()));
                }
            }

            Provider provider = method.getAnnotation(Provider.class);
            if (provider != null) {
                List<InjectParam> provideParams = loadProvideTypes(provider, method);

                // 无用方法，忽略
                if (provideParams == null) {
                    continue;
                }

                // 添加依赖
                ProviderInfoMeta providerInfo = new ProviderInfoMeta(provider.updatePeriod(), provideParams, provider.lazy(), provider.force(), method);
                providerInfoMetas.add(providerInfo);
            }
        }

        return new ClassInfo(providerInfoMetas, injectInfoMetas);
    }

    /**
     * 设置提供的类型
     * @param provider
     * @return
     */
    private List<InjectParam> loadProvideTypes(Provider provider, Method method) {
        if (provider == null) {
            return null;
        }

        // 初始化
        List<InjectParam> realTypes = new ArrayList<>(provider.value().length + 1);

        Class<?> realParam = null;
        if (method != null) {
            Class<?> defineParam = method.getReturnType();
            if (defineParam.isPrimitive()) {
                defineParam = Const.getPackedType(defineParam);
            }

            // 空返回值的方法，无法Provide
            if (defineParam == void.class || defineParam == Void.class) {
                return null;
            }

            // 如果返回的是List或Map，无法解析具体的类
            if (!Map.class.isAssignableFrom(defineParam)) {
                realParam = defineParam;
            }
        }

        // 提供默认参数
        if (provider.value().length > 0) {
            List<Param> provideList = Arrays.asList(provider.value());

            for (Param provide: provideList) {
                if (provide.type() != Void.class) {
                    if (realParam != null && !provide.type().isAssignableFrom(realParam)) {
                        LogUtil.e(TAG, "Param参数与方法参数不一致，无法注册Param【%s】, Method【%s】", provide, method);
                        continue;
                    }

                    InjectParam paramType = InjectParam.newInjectParamType(provide.value(), provide.type(), provide.sticky());
                    if (paramType != null) {
                        realTypes.add(paramType);
                    }
                } else if (realParam != null) {
                    InjectParam paramType = InjectParam.newInjectParamType(provide.value(), realParam, provide.sticky());
                    if (paramType != null) {
                        realTypes.add(paramType);
                    }
                } else if (!StringUtil.isEmpty(provide.value())) {
                    // 看缓存，没缓存无法注册，需要在Subscriber注册后才能使用
                    LogUtil.w(TAG, "未配置参数类，可能导致注册失败");
                    InjectParam cachedType = InjectParamTypeCache.getCacheInstance().getExistsParamType(provide.value());
                    if (cachedType != null) {
                        realTypes.add(cachedType);
                    } else {
                        realTypes.add(InjectParam.newInjectParamType(provide.value(), Void.class, provide.sticky()));
                    }
                    LogUtil.w(TAG, "加载参数【%s】为类型【%s】", provide.value(), cachedType);
                } else {
                    // 什么都没配置
                    LogUtil.e(TAG, "无法解析Provider【%s】", provide);
                }
            }
        }

        // 什么都不提供，返回空
        if (realTypes.size() == 0) {
            return null;
        }

        return realTypes;
    }

    /**
     * 加载参数类型
     * @param subscriber
     * @param method
     * @return
     */
    private List<InjectParam> loadParamType(Subscriber subscriber, Method method) {
        if (subscriber == null) {
            return null;
        }

        // 设置了预设参数
        Param[] params = subscriber.value();

        if (params.length == 0) {
            return null;
        }

        Class<?>[] defineParams = method.getParameterTypes();
        Class<?> realParam;
        // 参数长度不为1，无法使用
        if (defineParams.length != 1) {
            // 对于注册Void类型消息特殊处理
            if (defineParams.length == 0) {
                realParam = Void.class;
            } else {
                return null;
            }
        } else{
            realParam = defineParams[0];
            if (realParam.isPrimitive()) {
                realParam = Const.getPackedType(realParam);
            }
        }

        List<InjectParam> paramTypes = new ArrayList<>();
        for (Param param: params) {
            // 如果是自定义参数
            if (param.type() != Void.class) {
                if (realParam != null && !realParam.isAssignableFrom(param.type())) {
                    LogUtil.e(TAG, "Param参数与方法参数不一致，无法注册Param【%s】, Method【%s】", param, method);
                    continue;
                }

                InjectParam paramType = InjectParam.newInjectParamType(param.value(), param.type(), param.sticky());
                if (paramType != null) {
                    paramTypes.add(paramType);
                }
            } else if (realParam != null) {
                InjectParam paramType = InjectParam.newInjectParamType(param.value(), realParam, param.sticky());
                if (paramType != null) {
                    paramTypes.add(paramType);
                }
            } else {
                LogUtil.e(TAG, "无法解析Provider【%s】", param);
            }
        }

        if (paramTypes.size() == 0) {
            // 什么都没设置
            return null;
        }
        return paramTypes;
    }
}
