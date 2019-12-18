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
package com.alipay.hulu.common.injector;

import android.content.Context;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.Message;
import android.support.annotation.NonNull;
import android.util.Pair;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.cache.ClassInfo;
import com.alipay.hulu.common.injector.cache.ClassInfoCache;
import com.alipay.hulu.common.injector.cache.InjectParamMeta;
import com.alipay.hulu.common.injector.cache.InjectParamTypeCache;
import com.alipay.hulu.common.injector.cache.ProviderInfoMeta;
import com.alipay.hulu.common.injector.param.InjectParam;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.ParamReference;
import com.alipay.hulu.common.injector.provider.Provider;
import com.alipay.hulu.common.injector.provider.ProviderInfo;
import com.alipay.hulu.common.injector.provider.WeakInjectItem;
import com.alipay.hulu.common.service.base.ExportService;
import com.alipay.hulu.common.service.base.LocalService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;

import java.lang.ref.WeakReference;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 消息注入管理器
 */
@LocalService(lazy = false)
public class InjectorService implements ExportService {
    public static final int REGISTER_SUCCESS = 0;
    public static final int REGISTER_NULL_OBJECT = 1;
    public static final int REGISTER_FAILED = 2;

    private static final String TAG = "InjectorService";
    private static ClassInfoCache cache;

    /**
     * 注入列表
     */
    private Map<String, ParamReference> referenceMap;

    private Queue<Pair<ProviderInfo, WeakInjectItem>> providers;

    /**
     * 临时等待队列
     */
    private Map<String, Queue<Callback>> paramWaitMap;

    /**
     * 消息队列
     */
    private MessageProcessHandler messageHandler;

    /**
     * 消息分发线程
     */
    private HandlerThread messageHandleThread;

    /**
     * 内容更新计划
     */
    private ScheduledExecutorService updateExecutor;

    /**
     * 更新特定内容
     */
    private ExecutorService loadProviderExecutor;

    private ExecutorService dispatchMessageExecutor;

    /**
     * 快捷获取
     * @return
     */
    public static InjectorService g() {
        return LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
    }

    @Override
    public void onCreate(Context context) {
        referenceMap = new ConcurrentHashMap<>();
        providers = new ConcurrentLinkedQueue<>();
        paramWaitMap = new ConcurrentHashMap<>();
        cache = new ClassInfoCache();

        // 消息分发线程
        messageHandleThread = new HandlerThread("MessageHandle");
        messageHandleThread.start();
        messageHandler = new MessageProcessHandler(this, messageHandleThread.getLooper());

        LogUtil.i(TAG, "启动定时注入!!!");

        if (updateExecutor != null && !updateExecutor.isShutdown()) {
            updateExecutor.shutdownNow();
        }
        updateExecutor = Executors.newSingleThreadScheduledExecutor();

        if (loadProviderExecutor != null && !loadProviderExecutor.isShutdown()) {
            loadProviderExecutor.shutdownNow();
        }
        loadProviderExecutor = Executors.newCachedThreadPool();

        if (dispatchMessageExecutor != null && !dispatchMessageExecutor.isShutdown()) {
            dispatchMessageExecutor.shutdownNow();
        }
        // 单线程分发
        dispatchMessageExecutor = Executors.newSingleThreadExecutor();

        updateExecutor.scheduleAtFixedRate(updateProviders, 500, 500, TimeUnit.MILLISECONDS);

        // 注册下有provider的类
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                long startTime = System.currentTimeMillis();
                List<Class<?>> providerClasses = ClassUtil.findSubClass(Object.class, Provider.class);
                Set<Class<?>> classes = new HashSet<>(providerClasses);
                LogUtil.d(TAG, "查找Provider类： %dms", System.currentTimeMillis() - startTime);

                providerClasses = ClassUtil.findClassWithMethodAnnotation(Provider.class);
                classes.addAll(providerClasses);
                LogUtil.d(TAG, "查找Provider方法类： %dms", System.currentTimeMillis() - startTime);

                List<Class<?>> subscriberClasses = ClassUtil.findClassWithMethodAnnotation(Subscriber.class);
                classes.addAll(subscriberClasses);
                LogUtil.d(TAG, "查找Subscriber类： %dms", System.currentTimeMillis() - startTime);

                for (Class<?> provider : classes) {
                    registerClass(provider);
                }
            }
        });
    }

    @Override
    public void onDestroy(Context context) {
        LogUtil.w(TAG, "终止定时注入!!!");
        if (updateExecutor != null && !updateExecutor.isShutdown()) {
            updateExecutor.shutdownNow();
        }
        updateExecutor = null;

        if (loadProviderExecutor != null && !loadProviderExecutor.isShutdown()) {
            loadProviderExecutor.shutdownNow();
        }
        loadProviderExecutor = null;

        if (dispatchMessageExecutor != null && !dispatchMessageExecutor.isShutdown()) {
            dispatchMessageExecutor.shutdownNow();
        }
        dispatchMessageExecutor = null;

        if (messageHandleThread != null && messageHandleThread.isAlive()) {
            messageHandleThread.interrupt();
        }

    }

    /**
     * 取消注册（非必须）
     * @param any
     */
    public void unregister(Object any) {
        if (any == null) {
            LogUtil.e(TAG, "无法移除空对象");
            return;
        }

        ClassInfo info = cache.getClassInfo(any.getClass());

        // 又包含provider信息
        if (info.getCachedProviderInfo() != null && info.getCachedProviderInfo().size() > 0) {
            Iterator<Pair<ProviderInfo, WeakInjectItem>> iterator = providers.iterator();
            // 检查消息提供器
            while (iterator.hasNext()) {
                Pair<ProviderInfo, WeakInjectItem> provider = iterator.next();
                if (any.equals(provider.second.getTarget())) {
                    iterator.remove();
                }
            }
        }

        // 查找注册过的引用
        if (info.getCachedInjectInfo() != null && info.getCachedInjectInfo().size() > 0) {
            for (InjectParamMeta meta: info.getCachedInjectInfo()) {
                ParamReference reference = referenceMap.get(meta.getParamType().getName());
                if (reference != null) {
                    // 移除引用
                    reference.removeReference(any, meta.getTargetMethod());
                }
            }
        }
    }

    /**
     * 立刻发出消息
     * @param paramName
     * @param value
     */
    public void pushMessage(String paramName, Object value) {
        pushMessage(paramName, value, false, 0);
    }

    /**
     * 立刻发出消息
     * @param paramName
     * @param value
     */
    public void pushMessage(String paramName, Object value, long delay) {
        pushMessage(paramName, value, true, delay);
    }

    /**
     * 立刻发出空消息
     * @param paramName
     */
    public void pushMessage(String paramName) {
        pushMessage(paramName, null, false, 0);
    }

    public void pushMessage(String paramName, Object value, boolean enqueue) {
        pushMessage(paramName, value, enqueue, 0);
    }

    /**
     * 主动推送消息
     *
     * @param paramName
     * @param value
     */
    public void pushMessage(String paramName, Object value, boolean enqueue, long delay) {
        InjectParam targetParam = null;
        if (!StringUtil.isEmpty(paramName)) {
            targetParam = InjectParamTypeCache.getCacheInstance().getExistsParamType(paramName);
        } else if (value != null) {
            targetParam = InjectParamTypeCache.getCacheInstance().getExistsParamType(value.getClass());
        } else {
            LogUtil.e(TAG, "没名字的空消息，不知道发给谁");
            return;
        }

        // 未找到，返回
        if (targetParam == null) {
            LogUtil.d(TAG, "未能找到合适的参数【paramName=%s, value=%s】", paramName, value);
            return;
        }

        LogUtil.d(TAG, "开始发送消息name=%s,type=%s", targetParam.getName(), targetParam.getType());

        ParamReference reference = referenceMap.get(targetParam.getName());
        // 没有注册项，生成新的队列
        if (reference == null) {
            LogUtil.w(TAG, "【name=%s】未找到引用项", targetParam.getName());
            reference = new ParamReference(targetParam);
            referenceMap.put(targetParam.getName(), reference);
        }

        LogUtil.d(TAG, "向引用队列【%s】发送【%s】，接收数量【%d】", targetParam.getName(), value, reference.countReference());

        // 判断是否消息合法
        if (reference.messageValid(value, true)) {
            // 如果有等待消息队列
            Queue<Callback> callbacks = paramWaitMap.remove(targetParam.getName());
            if (callbacks != null) {
                for (Callback callback: callbacks) {
                    try {
                        callback.onResult(value);
                    } catch (Exception e) {
                        LogUtil.e(TAG, "Callback fail", e);
                    }
                }
            }

            if (enqueue) {
                // 通过handler处理
                Message message = messageHandler.obtainMessage(MessageProcessHandler.message);
                message.obj = new Pair<>(targetParam.getName(), value);
                messageHandler.sendMessageDelayed(message, delay);
            } else {
                reference.updateParam(value);
            }
        } else {
            LogUtil.w(TAG, "消息【%s】不合法", StringUtil.hide(value));
        }
    }

    /**
     * 获取目标参数
     *
     * @param key 类名
     * @param targetType 目标类型
     * @param <T>
     * @return
     */
    public <T> T getMessage(String key, Class<T> targetType) {
        InjectParam param;

        // 查找目标参数
        if (targetType == null) {
            if (key == null) {
                LogUtil.w(TAG, "请求字段为空");
                return null;
            }

            param = InjectParamTypeCache.getCacheInstance().getExistsParamType(key);
            if (param == null) {
                LogUtil.w(TAG, "无法找到名称【%s】对应的参数", key);
                return null;
            }
        } else if (key == null) {
            param = InjectParamTypeCache.getCacheInstance().getExistsParamType(targetType);


            if (param == null) {
                LogUtil.w(TAG, "无法找到类【%s】对应的参数", targetType);
                return null;
            }
        } else {
            param = InjectParamTypeCache.getCacheInstance().getExistsParamType(key);
            if (param == null) {
                LogUtil.w(TAG, "无法找到名称【%s】对应的参数", key);
                return null;
            }

            if (!targetType.isAssignableFrom(param.getType())) {
                LogUtil.w(TAG, "名称【%s】对应的参数【%s】无法匹配目标类型【%s】", key, param.getType(), targetType);
                return null;
            }
        }

        if (!param.isSticky()) {
            LogUtil.w(TAG, "无法获取非持久对象【%s】的值", param.getName());
            return null;
        }

        ParamReference reference = referenceMap.get(param.getName());
        if (reference == null) {
            LogUtil.w(TAG, "参数【%s】尚未注册值", param.getName());
            return null;
        }

        return (T) reference.getCurrentValue();
    }

    /**
     *
     * @param name
     * @param callable
     * @param <T>
     */
    public <T> void waitForMessage(@NonNull String name, @NonNull Callback<T> callable) {
        InjectParam param = InjectParamTypeCache.getCacheInstance().getExistsParamType(name);
        if (param == null) {
            LogUtil.e(TAG, "Unregistered param %s, failed to wait", name);
            callable.onFailed();
            return;
        }

        Queue<Callback> waitQueue = paramWaitMap.get(name);
        if (waitQueue == null) {
            waitQueue = new ConcurrentLinkedQueue<>();
            paramWaitMap.put(name, waitQueue);
        }
        waitQueue.add(callable);
    }

    /**
     * 查找特定参数注册数量，-1表示该参数不存在
     * @param paramName
     * @return
     */
    public int getReferenceCount(String paramName) {
        ParamReference reference = referenceMap.get(paramName);
        if (reference != null) {
            return reference.countReference();
        }

        return -1;
    }

    /**
     * 注册类信息
     * @param target
     */
    public void registerClass(Class<?> target) {
        if (target == null) {
            LogUtil.w(TAG, "无法注册空类");
            return;
        }

        // 扫描并注册类信息
        cache.getClassInfo(target);
    }

    /**
     * 注册provider或者receiver对象
     * @param any
     */
    public int register(Object any) {
        if (any == null) {
            LogUtil.w(TAG, "无法注册空对象");
            return REGISTER_NULL_OBJECT;
        }

        ClassInfo targetClassInfo = cache.getClassInfo(any.getClass());

        if (targetClassInfo == null) {
            LogUtil.w(TAG, "未找到可注册内容，%s", any.getClass().getSimpleName());
            return REGISTER_FAILED;
        }

        if (targetClassInfo.getCachedInjectInfo() != null) {
            for (InjectParamMeta paramMeta: targetClassInfo.getCachedInjectInfo()) {
                InjectParam type = paramMeta.getParamType();
                ParamReference reference = referenceMap.get(type.getName());

                // 若Provider尚未初始化，则使用null注入
                if (reference == null) {
                    reference = new ParamReference(type);
                    referenceMap.put(type.getName(), reference);
                }

                // 添加到reference中
                paramMeta.addToReference(reference, any);
            }
        }

        // 查找依赖注入方法
        if (targetClassInfo.getCachedProviderInfo() != null) {
            for (ProviderInfoMeta providerMeta: targetClassInfo.getCachedProviderInfo()) {
                WeakInjectItem weakInjectItem= providerMeta.buildWeakInjectItem(any);
                ProviderInfo providerInfo = providerMeta.buildProvider();
                providers.add(new Pair<>(providerInfo, weakInjectItem));
            }
        }

        LogUtil.d(TAG, "注册【%s】成功，提供%d个，需要%d个参数", any.getClass().getSimpleName(),
                targetClassInfo.getCachedProviderInfo().size(), targetClassInfo.getCachedInjectInfo().size());

        return REGISTER_SUCCESS;
    }

    /**
     * 消息分发
     */
    private static class MessageProcessHandler extends Handler {
        WeakReference<InjectorService> serviceRef;

        MessageProcessHandler(InjectorService service, Looper looper) {
            super(looper);
            serviceRef = new WeakReference<>(service);
        }

        private static final int message = 1;
        @Override
        public void handleMessage(Message msg) {
            super.handleMessage(msg);
            InjectorService service = serviceRef.get();
            if (service == null) {
                LogUtil.e(TAG, "服务为空，无法分发消息");
                return;
            }

            if (msg.what == message) {
                Pair<String, Object> param = (Pair<String, Object>) msg.obj;
                if (param == null) {
                    LogUtil.e(TAG, "无法更新空对象");
                    return;
                }

                ParamReference reference = service.referenceMap.get(param.first);

                // 非空判断
                if (reference == null) {
                    InjectParam typeParam = InjectParamTypeCache.getCacheInstance().getExistsParamType(param.first);
                    reference = new ParamReference(typeParam);
                    service.referenceMap.put(param.first, reference);
                }

                reference.updateParam(param.second);
            }
        }
    }

    /**
     * Provider更新Runnable
     */
    private final Runnable updateProviders = new Runnable() {
        @Override
        public void run() {
            try {
                if (providers == null) {
                    return;
                }

                Iterator<Pair<ProviderInfo, WeakInjectItem>> iterator = providers.iterator();
                while (iterator.hasNext()) {
                    Pair<ProviderInfo, WeakInjectItem> item = iterator.next();
                    if (item.first.isLazy() && item.first.shouldUpdate() && !item.first.isRunning()) {
                        item.first.start();
                        WeakInjectItem provider = item.second;
                        if (!provider.isValid()) {
                            iterator.remove();
                            continue;
                        }

                        // 异步更新消息
                        UpdateProviderRunnable runnable = new UpdateProviderRunnable(item.first, provider, InjectorService.this);
                        loadProviderExecutor.execute(runnable);
                    }
                }
            } catch (Throwable t) {
                LogUtil.e(TAG, "InjectorService Thrown Throwable: " + t.getMessage(), t);
            }
        }
    };

    /**
     * 更新特定Provider Runnable
     */
    private static class UpdateProviderRunnable implements Runnable {
        ProviderInfo providerInfo;
        InjectorService service;
        WeakInjectItem provider;

        UpdateProviderRunnable(ProviderInfo providerInfo, WeakInjectItem provider, InjectorService service) {
            this.providerInfo = providerInfo;
            this.provider = provider;
            this.service = service;
        }

        @Override
        public void run() {
            // 调用provide方法
            long startTime = System.currentTimeMillis();
            Map<InjectParam, Object> result = new HashMap<>();
            int provideResult = provider.provides(result);
            LogUtil.d(TAG, "Provider " + provider.getDeclaredClass() + " return response, costs: " + (System.currentTimeMillis() - startTime));

            // 根据结果执行
            switch (provideResult) {
                case WeakInjectItem.REFERENCE_GC:
                    LogUtil.e(TAG, "Item " + provider.getDeclaredClass() + " has been released");
                    provider.setValid(false);
                case WeakInjectItem.INVOCATION_FAILED:
                case WeakInjectItem.WRONG_INVOCATION:
                    LogUtil.e(TAG, "Invocation failed");
                    break;
                case WeakInjectItem.INVOCATION_SUCCESS:
                    for (Map.Entry<InjectParam, Object> provideItem : result.entrySet()) {
                        ParamReference reference = service.referenceMap.get(provideItem.getKey().getName());
                        if (reference == null) {
                            LogUtil.d(TAG, "参数【%s】引用不存在", provideItem.getKey());
                            reference = new ParamReference(provideItem.getKey());
                            service.referenceMap.put(provideItem.getKey().getName(), reference);
                        }
                        if (reference.messageValid(provideItem.getValue(), providerInfo.isForce())) {
                            //LogUtil.d(TAG, "Update param " + provideItem.getKey().getName() + " to " + provideItem.getValue());

                            Message msg = service.messageHandler.obtainMessage(MessageProcessHandler.message);
                            msg.obj = new Pair<>(provideItem.getKey().getName(), provideItem.getValue());

                            service.messageHandler.sendMessage(msg);
                            LogUtil.i(TAG, "消息【%s::%s】注入成功", provideItem.getKey(), StringUtil.hide(provideItem.getValue()));
                        } else {
                            LogUtil.d(TAG, "消息【%s::%s】不合法，无法注入", provideItem.getKey(), StringUtil.hide(provideItem.getValue()));
                        }
                    }
                    break;
                case WeakInjectItem.INVOCATION_NULL:
                    LogUtil.d(TAG, "调用返回空");
                    break;
            }
            providerInfo.finish();
        }
    }
}
