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

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.cache.InjectParamTypeCache;
import com.alipay.hulu.common.injector.param.InjectParam;
import com.alipay.hulu.common.injector.param.RunningThread;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.LogUtil;

import java.lang.ref.WeakReference;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * 避免引用带来内存泄漏
 */
public class WeakInjectItem {
    private static final String TAG = "WeakInjectItem";

    private List<InjectParam> invokationTypes;

    private boolean valid;

    private RunningThread invokeThread;

    /**
     * 注入类型
     */
    private Class targetType;

    // 调用方法
    private Method invocationMethod;
    // 注入对象
    private WeakReference<Object> targetItem;

    /**
     * 注入成功
     */
    public static final int INVOCATION_SUCCESS = 0;

    /**
     *  注入失败
     */
    public static final int INVOCATION_FAILED = 1;

    /**
     * 引用被回收
     */
    public static final int REFERENCE_GC = 2;

    /**
     * 调用方式错误
     */
    public static final int WRONG_INVOCATION = 3;

    /**
     *  调用为空
     */
    public static final int INVOCATION_NULL = 4;

    public WeakInjectItem(Method invocationMethod, Object target, List<InjectParam> params) {
        this(invocationMethod, target, params, RunningThread.MESSAGE_THREAD, null);
    }

    /**
     *
     * @param invocationMethod 调用方法
     * @param target 目标对象
     */
    public WeakInjectItem(Method invocationMethod, Object target, List<InjectParam> params, RunningThread invokeThread, Class<?> targetType) {
        this.invocationMethod = invocationMethod;
        this.targetItem = new WeakReference<>(target);
        this.invokationTypes = params;
        this.valid = true;
        this.invokeThread = invokeThread;
        this.targetType = targetType;
    }

    /**
     * 获取target类
     * @return
     */
    public String getDeclaredClass() {
        return this.invocationMethod.getDeclaringClass().getSimpleName();
    }

    /**
     * 调用注入
     * @param value 注入参数
     * @return 返回下列结果：
     * {@link WeakInjectItem#INVOCATION_SUCCESS} 成功
     * {@link WeakInjectItem#INVOCATION_FAILED} 失败
     * {@link WeakInjectItem#REFERENCE_GC} 引用被回收
     */
    public int invoke(final Object value) {
        final Object target = targetItem.get();
        if (target == null) {
            return REFERENCE_GC;
        }

        Runnable invokeRunnable = new Runnable() {
            @Override
            public void run() {
                try {
                    // 空消息，空注入
                    if (targetType == Void.class) {
                        WeakInjectItem.this.invocationMethod.invoke(target);
                    } else {
                        WeakInjectItem.this.invocationMethod.invoke(target, value);
                    }
                } catch (Exception e) {
                    LogUtil.e(TAG, "update Param get exception", e);
                }
            }
        };

        switch (invokeThread) {
            case MESSAGE_THREAD:
                try {
                    // 空消息，空注入
                    if (targetType == Void.class) {
                        WeakInjectItem.this.invocationMethod.invoke(target);
                    } else {
                        WeakInjectItem.this.invocationMethod.invoke(target, value);
                    }
                } catch (Exception e) {
                    LogUtil.e(TAG, "update Param get exception", e);
                    return INVOCATION_FAILED;
                }
                break;
            case BACKGROUND:
                BackgroundExecutor.execute(invokeRunnable);
                break;
            case MAIN_THREAD:
                LauncherApplication.getInstance().runOnUiThread(invokeRunnable);
                break;
        }

        return INVOCATION_SUCCESS;
    }

    /**
     * 调用获取依赖
     * @param result 注入参数
     * @return 返回下列结果：
     * {@link WeakInjectItem#INVOCATION_SUCCESS} 成功
     * {@link WeakInjectItem#INVOCATION_FAILED} 失败
     * {@link WeakInjectItem#REFERENCE_GC} 引用被回收
     */
    public int provides(Map<InjectParam, Object> result) {
        Object target = targetItem.get();
        if (target == null) {
            return REFERENCE_GC;
        }

        if (result == null) {
            return WRONG_INVOCATION;
        }

        try {
            // 执行调用
            Object returnContent = invocationMethod.invoke(target);
            if (returnContent == null) {
                // 如果只提供一个空消息
                if (invokationTypes.size() == 1 && invokationTypes.get(0).getType() == Void.class) {
                    result.put(invokationTypes.get(0), null);
                    return INVOCATION_SUCCESS;
                }
                return INVOCATION_NULL;
            }

            if (returnContent instanceof Map) {
                try {
                    InjectParamTypeCache cache = InjectParamTypeCache.getCacheInstance();
                    Map<String, Object> wrap = (Map<String, Object>) returnContent;
                    for (Map.Entry<String, Object> entry : wrap.entrySet()) {
                        InjectParam paramType = cache.getExistsParamType(entry.getKey());
                        if (paramType == null) {
                            LogUtil.e(TAG, "无法加载参数类型【%s】", entry.getKey());
                            continue;
                        }
                        result.put(paramType, entry.getValue());
                    }
                } catch (ClassCastException e) {
                    LogUtil.e(TAG, e, "Method: %s doesn't return suitable type", invocationMethod.getName());
                    return WRONG_INVOCATION;
                }
            } else {
                // 优化调用方式
                if (invokationTypes != null && invokationTypes.size() > 0) {
                    for (InjectParam param : invokationTypes) {
                        if (param.getType().isInstance(returnContent)) {
                            result.put(param, returnContent);
                            return INVOCATION_SUCCESS;
                        }
                    }
                }
                return INVOCATION_FAILED;
            }

        // 防止抛出异常导致Injector停止
        } catch (Throwable e) {
            LogUtil.e(TAG, "get provides throw exception", e);
            return INVOCATION_FAILED;
        }

        return INVOCATION_SUCCESS;
    }

    public Object getTarget() {
        return targetItem.get();
    }

    public boolean isValid() {
        return valid;
    }

    public void setValid(boolean valid) {
        this.valid = valid;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (o == null || getClass() != o.getClass()) {
            return false;
        }
        WeakInjectItem that = (WeakInjectItem) o;

        Object target = targetItem.get();
        Object thatTarget = that.targetItem.get();
        return invocationMethod.equals(that.invocationMethod) &&
                ((target == thatTarget) || (target != null && target.equals(thatTarget)));
    }

    @Override
    public int hashCode() {
        Object[] group = new Object[2];
        group[0] = invocationMethod;
        group[1] = targetItem.get();

        return Arrays.hashCode(group);
    }
}