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

import android.support.annotation.NonNull;

import com.alipay.hulu.common.injector.param.InjectParam;
import com.alipay.hulu.common.injector.param.RunningThread;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.mdit.library.Const;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 依赖引用列表
 * @author Cathor
 */
public class ParamReference {
    private static String TAG = "ParamReference";

    private InjectParam targetParam;

    /**
     * 当前消息
     */
    private Object currentValue = null;

    /** 依赖对象与注入方法 */
    private Map<WeakInjectItem, Integer> referenceItems;

    private volatile boolean initialized = false;

    public ParamReference(InjectParam targetParam) {
        this.targetParam = targetParam;
        this.referenceItems = new ConcurrentHashMap<>();
    }

    /**
     * 推送消息
     * @param value
     * @param force
     */
    public boolean messageValid(Object value, boolean force) {
        if (!force) {
            // 空注入值
            if (value == null && targetParam.getType() == Void.class) {
                return true;
            }

            // 当原值与新值均为空，不更新
            if (value == null && this.currentValue == null) {
                LogUtil.w(TAG, "推送空消息【ParamType=%s】", targetParam);
                return false;
            }
            // 当原值与新值都不为空且相等
            if (value != null && this.currentValue != null && (this.currentValue == value || this.currentValue.equals(value))) {
                LogUtil.d(TAG, "推送重复消息【ParamType=%s，value=%s】", targetParam,
                        StringUtil.hide(value));
                return false;
            }
        }

        if (!targetParam.isValueValid(value)) {
            LogUtil.e(TAG, "消息格式不合法【ParamType=%s，value=%s】", targetParam,
                    StringUtil.hide(value));
            return false;
        }
        return true;
    }

    /**
     * 移除引用
     * @param target
     */
    public void removeReference(@NonNull Object target, Method method) {
        WeakInjectItem fakeItem = new WeakInjectItem(method, target, null);
        referenceItems.remove(fakeItem);
    }

    /**
     * 计算引用数量
     * @return
     */
    public int countReference() {
        return referenceItems.size();
    }

    /**
     * 添加一个引用对象
     * @param target 引用对象
     * @param method 注入方法
     * @return 是否成功添加
     */
    public boolean addReference(Object target, Method method, RunningThread runningThread){
        if (target != null) {
            Class[] classes = method.getParameterTypes();
            WeakInjectItem invoke;

            // 对于需要一个参数的方法
            if (classes.length == 1) {
                Class<?> paramClass = classes[0];
                if (paramClass.isPrimitive()) {
                    paramClass = Const.getPackedType(paramClass);
                }
                if (paramClass.isAssignableFrom(targetParam.getType())) {
                    invoke = new WeakInjectItem(method, target, Arrays.asList(targetParam), runningThread, targetParam.getType());
                } else {
                    return false;
                }
            // 对于空参数方法
            } else if (classes.length == 0 && targetParam.getType() == Void.class){
                invoke = new WeakInjectItem(method, target, Arrays.asList(targetParam), runningThread, targetParam.getType());
            } else {
                return false;
            }

            // 防止重复添加
            if (referenceItems.containsKey(invoke)) {
                return false;
            }

            this.referenceItems.put(invoke, 0);

            // 未初始化，不用注入
            if (initialized) {
                try {
                    // 将依赖值注入到对应对象
                    invoke.invoke(currentValue);
                } catch (Exception e) {
                    LogUtil.e(TAG, "add reference failed", e);
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    /**
     * 下发消息
     * @return 是否成功更新
     */
    public boolean updateParam(Object value){
        if (targetParam.isSticky()) {
            initialized = true;
            currentValue = value;
        }
        Iterator<WeakInjectItem> iterator = referenceItems.keySet().iterator();
        // 遍历所有引用对象，调用注入方法改变依赖值
        while (iterator.hasNext()) {
            WeakInjectItem item = iterator.next();
            // 如果Item不可用
            if (!item.isValid()) {
                iterator.remove();
                continue;
            }

            int result = item.invoke(value);

            // 对于已被回收的对象，直接清理
            if (result == WeakInjectItem.REFERENCE_GC) {
                iterator.remove();
                LogUtil.w(TAG, "Reference of " + item.getDeclaredClass() + " has been cleared");
            } else if (result == WeakInjectItem.INVOCATION_FAILED) {
                LogUtil.e(TAG, "Invocation for instance of " + item.getDeclaredClass() + " failed");
            }
        }

        return true;
    }

    /**
     * 获取当前值
     * @return
     */
    public Object getCurrentValue() {
        return currentValue;
    }
}