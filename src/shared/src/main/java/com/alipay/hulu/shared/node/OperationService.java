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
package com.alipay.hulu.shared.node;

import android.content.Context;
import android.os.Build;
import androidx.annotation.NonNull;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.service.base.ExportService;
import com.alipay.hulu.common.service.base.LocalService;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.shared.node.action.OperationContext;
import com.alipay.hulu.shared.node.action.OperationExecutor;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.provider.ActionProviderManager;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.annotation.NodeProcessor;
import com.alipay.hulu.shared.node.tree.annotation.NodeProvider;
import com.alipay.hulu.shared.node.tree.export.BaseStepExporter;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Stack;
import java.util.concurrent.ConcurrentHashMap;

import static android.view.Surface.ROTATION_0;

/**
 * Created by qiaoruikai on 2018/10/8 5:02 PM.
 */
@LocalService
public class OperationService implements ExportService {
    private static final String TAG = "OperationService";

    private Map<String, AbstractProvider> providerMap;
    private Map<String, ProcessorWrapper> processorMap;

    private Class<? extends AbstractProvider> defaultProvider;

    private List<Class<? extends AbstractNodeProcessor>> defaultProcessors;

    private volatile AbstractNodeTree currentRoot;

    private ActionProviderManager actionProviderMng;

    private OperationExecutor executor;

    private Stack<HashMap<String, Object>> runtimeVariables;

    private ConcurrentHashMap<String, Object> temporaryVariables;

    private int currentOrientation = ROTATION_0;

    @Override
    public void onCreate(Context context) {
        providerMap = new HashMap<>();
        processorMap = new HashMap<>();

        // 加载所有的节点处理类
        List<Class<? extends AbstractNodeProcessor>> processorClasses = ClassUtil.findSubClass(AbstractNodeProcessor.class, NodeProcessor.class);
        for (Class<? extends AbstractNodeProcessor> processorClass: processorClasses) {
            processorMap.put(processorClass.getName(), new ProcessorWrapper(processorClass));
        }

        // 加载Provider
        actionProviderMng = new ActionProviderManager(context);

        InjectorService.g().register(this);
    }

    @Override
    public void onDestroy(Context context) {
        providerMap.clear();
        processorMap.clear();

        // 终止各个Provider
        actionProviderMng.onDestroy(context);
    }

    @Subscriber(@Param(LauncherApplication.SCREEN_ORIENTATION))
    public void setScreenOrientation(int orientation) {
        if (currentOrientation != orientation) {
            currentOrientation = orientation;
            invalidRoot();
        }
    }

    /**
     * 设置默认提供器
     * @param providerClass
     */
    public void configProvider(Class<? extends AbstractProvider> providerClass) {
        this.defaultProvider = providerClass;
    }

    /**
     * 设置默认节点处理器
     * @param processorClasses
     */
    public void configProcessors(List<Class<? extends AbstractNodeProcessor>> processorClasses) {
        this.defaultProcessors = processorClasses;
    }

    /**
     * 直接调用
     * @param method
     * @param targetNode
     * @return
     */
    public boolean doSomeAction(OperationMethod method, AbstractNodeTree targetNode) {
        return doSomeAction(method, targetNode, null);
    }

    /**
     * 执行特定操作
     * @param method
     * @param targetNode
     * @return 是否成功
     */
    public boolean doSomeAction(OperationMethod method, AbstractNodeTree targetNode, OperationContext.OperationListener listener) {
        if (executor == null) {
            executor = new OperationExecutor(this);
        }

        // 执行操作
        return executor.performAction(targetNode, method, listener);
    }

    /**
     * 回收节点
     */
    public void invalidRoot() {
        AbstractNodeTree tmp;
        synchronized (this) {
            tmp = currentRoot;
            currentRoot = null;
        }

        if (tmp != null) {
            tmp.recycle();
        }
    }

    /**
     * 执行并记录操作
     * @param method 操作方法
     * @param targetNode 目标控件
     * @param stepProvider 导出操作类型
     * @return
     */
    public <T> T doAndRecordAction(OperationMethod method, AbstractNodeTree targetNode, BaseStepExporter<T> stepProvider, OperationContext.OperationListener listener) {
        if (executor == null) {
            executor = new OperationExecutor(this);
        }

        // 记录操作
        T content = stepProvider.exportStep(currentRoot, targetNode, method);

        // 执行操作
        boolean valid = executor.performAction(targetNode, method, listener);

        // 如果操作失败，不返回记录数据
        return valid? content: null;
    }

    /**
     * 空监听器
     * @param method
     * @param targetNode
     * @param stepProvider
     * @param <T>
     * @return
     */
    public <T> T doAndRecordAction(OperationMethod method, AbstractNodeTree targetNode, BaseStepExporter<T> stepProvider) {
        return doAndRecordAction(method, targetNode, stepProvider, null);
    }

    /**
     * 获取当前根节点
     *
     * @return
     */
    public AbstractNodeTree getCurrentRoot() {
        LogUtil.w(TAG, "开始加载跟结构");
        synchronized (this) {
            if (currentRoot == null) {
                LogUtil.w(TAG, "需要重载树结构");
                currentRoot = startLoadProvider(defaultProvider, defaultProcessors);
            }
        }
        return currentRoot;
    }

    /**
     * 刷新并返回根节点
     *
     * @return
     */
    public AbstractNodeTree refreshCurrentRoot() {
        // 先回收下
        synchronized (this) {
            if (currentRoot != null) {
                currentRoot.recycle();
                currentRoot = null;
            }
        }

        LogUtil.w(TAG, "强制重载根结构");
        return currentRoot = startLoadProvider(defaultProvider, defaultProcessors);
    }

    /**
     * 加载Provider树
     * @param providerClass
     * @param processorClasses
     * @return
     */
    public AbstractNodeTree startLoadProvider(Class<? extends AbstractProvider> providerClass, List<Class<? extends AbstractNodeProcessor>> processorClasses) {
        if (providerClass == null) {
            return null;
        }

        AbstractProvider provider = loadProvider(providerClass);
        List<ProcessorWrapper> wrappers = new ArrayList<>();

        // 根据注解找子类
        NodeProvider providerAnnotation = providerClass.getAnnotation(NodeProvider.class);
        if (providerAnnotation == null) {
            Collection<ProcessorWrapper> processorWrappers = processorMap.values();
            wrappers.addAll(processorWrappers);
        } else {
            Class<?> targetSourceClass = providerAnnotation.dataType();
            // 配置为空，使用默认processors
            if (processorClasses == null || processorClasses.size() == 0) {
                processorClasses = defaultProcessors;
            }

            // 默认也为空，使用全量Processor
            if (processorClasses == null || processorClasses.size() == 0) {
                // 过滤可处理该类型的Wrapper
                for (ProcessorWrapper wrapper : processorMap.values()) {
                    if (wrapper.canProcessClass(targetSourceClass)) {
                        wrappers.add(wrapper);
                    }
                }
            } else {
                for (Class<? extends AbstractNodeProcessor> processorClass: processorClasses) {
                    ProcessorWrapper wrapper = processorMap.get(processorClass.getName());
                    if (wrapper != null && wrapper.canProcessClass(targetSourceClass)) {
                        wrappers.add(wrapper);
                    }
                }
            }
        }

        // 按照level排序
        Collections.sort(wrappers);
        List<AbstractNodeProcessor> processors = new ArrayList<>(wrappers.size() + 1);
        for (ProcessorWrapper wrapper : wrappers) {
            // 部分未初始化的Processor
            if (!wrapper.isInit()) {
                wrapper.init();
            }

            processors.add(wrapper.processor);
        }

        // 初始化构造器
        NodeTreeGenerator generator = new NodeTreeGenerator(processors, provider, this);
        AbstractNodeTree tree;
        try {
            // 构造树结构
            tree = generator.generateNodeTree();
        }  catch (Exception e) {
            LogUtil.e(TAG, "构建树抛出异常，可能是正在切换页面，稍等片刻重试", e);
            MiscUtil.sleep(1000);

            try {
                tree = generator.generateNodeTree();
            } catch (Exception innerE) {
                LogUtil.e(TAG, "暂时无法生成树结构", e);
                tree = null;
            }
        }
        return tree;
    }

    /**
     * 加载树提供器实例
     * @param providerClass
     * @return
     */
    public AbstractProvider loadProvider(Class<? extends AbstractProvider> providerClass) {
        if (providerMap.containsKey(providerClass.getName())) {
            AbstractProvider provider = providerMap.get(providerClass.getName());

            // 刷新
            int count = 0;
            boolean result = false;
            while (count++ < 3) {
                result = provider.refresh();
                if (result) {
                    break;
                }
            }

            // 刷新
            if (!result) {
                return null;
            }

            return provider;
        }

        AbstractProvider provider = ClassUtil.constructClass(providerClass);

        // 初始化
        int count = 0;
        boolean result = provider.onStart();
        while (!result && count++ < 3) {
            result = provider.refresh();
        }

        // 初始化失败
        if (!result) {
            return null;
        }

        providerMap.put(providerClass.getName(), provider);
        return provider;
    }

    /**
     * 初始化运行环境
     */
    public void initParams() {
        if (temporaryVariables != null) {
            temporaryVariables.clear();
        } else {
            temporaryVariables = new ConcurrentHashMap<>();
        }
        if (runtimeVariables != null) {
            runtimeVariables.clear();
        } else {
            runtimeVariables = new Stack<>();
        }

        // 存放全局变量
        HashMap<String, Object> globalParam = new HashMap<>();
        String globalSettings = SPService.getString(SPService.KEY_GLOBAL_SETTINGS, "{}");
        JSONObject obj = JSON.parseObject(globalSettings);
        if (obj != null && obj.size() > 0) {
            for (String key : obj.keySet()) {
                globalParam.put(key, obj.getString(key));
            }
        }
        runtimeVariables.push(globalParam);

        runtimeVariables.push(new HashMap<String, Object>());
    }

    /**
     * 配置临时变量
     * 内部用
     * @param key
     * @param value
     */
    public void putTemporaryParam(String key, Object value) {
        if (temporaryVariables == null) {
            temporaryVariables = new ConcurrentHashMap<>();
        }

        temporaryVariables.put(key, value);
    }

    /**
     * 移除临时变量
     * 内部用
     * @param key
     * @return
     */
    public Object removeTemporaryParam(String key) {
        if (temporaryVariables == null) {
            return null;
        }

        return temporaryVariables.remove(key);
    }

    /**
     * 设置全局变量
     * @param key
     * @param value
     */
    public synchronized void putRuntimeParam(String key, Object value) {
        if (runtimeVariables == null) {
            runtimeVariables = new Stack<>();
            runtimeVariables.push(new HashMap<String, Object>());
        } else if (runtimeVariables.isEmpty()) {
            runtimeVariables.push(new HashMap<String, Object>());
        }

        // already in param stack
        for (HashMap<String, Object> stack: runtimeVariables) {
            if (stack.containsKey(key)) {
                stack.put(key, value);
                return;
            }
        }

        runtimeVariables.peek().put(key, value);
    }

    /**
     * 设置全局变量
     * @param params
     */
    public synchronized void putAllRuntimeParamAtTop(Map<String, ?> params) {
        if (runtimeVariables == null) {
            runtimeVariables = new Stack<>();
            runtimeVariables.push(new HashMap<String, Object>());
        } else if (runtimeVariables.isEmpty()) {
            runtimeVariables.push(new HashMap<String, Object>());
        }

        runtimeVariables.peek().putAll(params);
    }

    /**
     * add new param stack
     */
    public synchronized void pushParamStack() {
        if (runtimeVariables == null) {
            runtimeVariables = new Stack<>();
        }

        runtimeVariables.push(new HashMap<String, Object>());
    }

    /**
     * remove top param stack
     */
    public synchronized void popParamStack() {
        if (runtimeVariables == null || runtimeVariables.isEmpty()) {
            return;
        }

        runtimeVariables.pop();
    }

    /**
     * 移除运行时变量
     * @param key
     * @return
     */
    public synchronized Object removeRuntimeParam(String key) {
        if (runtimeVariables == null) {
            return null;
        }

        for (HashMap<String, Object> stack: runtimeVariables) {
            if (stack.containsKey(key)) {
                return stack.remove(key);
            }
        }

        return null;
    }

    /**
     * 获取变量
     * @param key
     * @return
     */
    public synchronized Object getRuntimeParam(String key) {
        // 如果设置了临时变量，取临时变量值
        if (temporaryVariables != null) {
            Object tmpVal = temporaryVariables.get(key);
            if (tmpVal != null) {
                return tmpVal;
            }
        }

        if (runtimeVariables == null || runtimeVariables.isEmpty()){
            return null;
        }

        // 遍历栈
        for (HashMap<String, Object> stackParam: runtimeVariables) {
            if (stackParam.containsKey(key)) {
                return stackParam.get(key);
            }
        }

        return null;
    }

    public ActionProviderManager getActionProviderMng() {
        return actionProviderMng;
    }

    public void setActionProviderMng(ActionProviderManager actionProviderMng) {
        this.actionProviderMng = actionProviderMng;
    }

    private static final class ProcessorWrapper implements Comparable<ProcessorWrapper> {
        int level = 1;
        List<Class> acceptClasses = null;
        Class<? extends AbstractNodeProcessor> targetClass;
        AbstractNodeProcessor processor;

        private ProcessorWrapper(Class<? extends AbstractNodeProcessor> targetClass) {
            this.targetClass = targetClass;
            NodeProcessor processor = targetClass.getAnnotation(NodeProcessor.class);
            if (processor != null) {
                this.level = processor.level();
                this.acceptClasses = Arrays.asList(processor.acceptNodes());
            }
        }

        /**
         * 是否初始化完毕
         * @return
         */
        private boolean isInit() {
            return processor != null;
        }

        /**
         * 初始化类
         */
        private void init() {
            processor = ClassUtil.constructClass(targetClass);
        }

        /**
         * 判断是否可处理该类
         * @param clazz
         * @return
         */
        private boolean canProcessClass(Class clazz) {
            return acceptClasses != null && acceptClasses.contains(clazz);
        }

        @Override
        public int compareTo(@NonNull ProcessorWrapper o) {
            // 从大到小排列
            if (Build.VERSION.SDK_INT >= 19) {
                return -Integer.compare(level, o.level);
            } else {
                return -((Integer) this.level).compareTo(o.level);
            }
        }
    }
}
