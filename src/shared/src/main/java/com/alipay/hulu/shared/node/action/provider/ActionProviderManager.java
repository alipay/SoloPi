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
package com.alipay.hulu.shared.node.action.provider;

import android.content.Context;

import com.alipay.hulu.common.annotation.Enable;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.shared.node.action.OperationContext;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Created by qiaoruikai on 2018/10/8 8:40 PM.
 */
public class ActionProviderManager {
    private static final String TAG = "ActionPvdMng";
    public static final String KEY_TARGET_ACTION = "targetAction";
    public static final String KEY_TARGET_ACTION_DESC = "targetActionDesc";

    private List<ActionProvider> mProviders;
    private Map<String, Integer> actionMap = new HashMap<>();

    public ActionProviderManager() {
    }

    /**
     * 启动
     * @param context
     */
    public void start(final Context context) {
        List<ActionProvider> providers = new ArrayList<>();

        // 注册所有Provider
        List<Class<? extends ActionProvider>> providerClasses = ClassUtil.findSubClass(ActionProvider.class, Enable.class);
        for (Class<? extends ActionProvider> providerClz : providerClasses) {
            // 忽略掉interface
            if (providerClz.isInterface()) {
                continue;
            }

            ActionProvider provider = ClassUtil.constructClass(providerClz);
            providers.add(provider);
        }

        this.mProviders = providers;
        if (mProviders.size() > 0) {
            // ActionProvider初始化
            LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    for (ActionProvider provider: mProviders) {
                        provider.onCreate(context);
                    }
                }
            });
        }
    }

    public void stop(final Context context) {
        if (this.mProviders != null && this.mProviders.size() > 0) {
            LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    for (ActionProvider provider: mProviders) {
                        provider.onDestroy(context);
                    }

                    mProviders.clear();
                }
            });
        }
    }

    /**
     * 处理操作
     * @param node
     * @param operationMethod
     * @param context
     * @return
     */
    public boolean processAction(AbstractNodeTree node, OperationMethod operationMethod,
                                 OperationContext context) {
        if (operationMethod == null
                || (operationMethod.getActionEnum() != PerformActionEnum.OTHER_GLOBAL
                && operationMethod.getActionEnum() != PerformActionEnum.OTHER_NODE)) {
            LogUtil.i(TAG, "无法处理操作: " + operationMethod + ", 当前注册Provider：" + mProviders);
            return false;
        }

        // 查找目标处理工具
        String targetAction = operationMethod.getParam(KEY_TARGET_ACTION);
        for (ActionProvider provider: mProviders) {
            // 针对需要操作的方法
            if (provider.canProcess(targetAction)) {
                return provider.processAction(targetAction, node, operationMethod,
                        context);
            }
        }

        return false;
    }

    /**
     * 查找所有可用操作
     * @return
     */
    public Map<String, String> loadProvideActions(AbstractNodeTree node) {
        Map<String, String> actionGroup = new HashMap<>();
        actionMap.clear();

        if (mProviders != null) {
            for (int i = 0; i < mProviders.size(); i++) {
                ActionProvider provider = mProviders.get(i);

                // 获取当前可用操作
                Map<String, String> actions = provider.provideActions(node);

                if (actions != null) {
                    actionGroup.putAll(actions);
                    for (String key: actions.keySet()) {
                        // 配置操作处理
                        actionMap.put(key, i);
                    }
                }
            }
        }

        return actionGroup;
    }

    /**
     * 加载action的配置界面
     * @param method
     * @return
     */
    public void loadActionView(Context context, OperationMethod method, AbstractNodeTree node, final ViewLoadCallback callback) {
        String action = method.getParam(KEY_TARGET_ACTION);
        int idx = actionMap.get(action);

        ActionProvider provider = mProviders.get(idx);
        provider.provideView(context, action, method, node, callback);
    }
}
