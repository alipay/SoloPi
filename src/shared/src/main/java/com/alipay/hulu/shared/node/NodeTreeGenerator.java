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

import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.MetaTree;
import com.alipay.hulu.shared.node.utils.NodeContext;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;
import java.util.Stack;

/**
 * Created by qiaoruikai on 2018/10/8 4:45 PM.
 */
public class NodeTreeGenerator {
    private static final String TAG = "NodeTreeGen";

    private NodeContext context;

    /**
     * 节点信息处理器
     */
    private List<AbstractNodeProcessor> nodeProcessors;

    /**
     * 元数据提供器
     */
    private AbstractProvider nodeProvider;

    private WeakReference<OperationService> manager;

    /**
     * 构建当前Provider的树
     * @return
     */
    public AbstractNodeTree generateNodeTree() {
        // 没有处理器，无法生成
        if (nodeProvider == null || nodeProcessors == null || nodeProcessors.size() == 0) {
            return null;
        }
        // 初始化上下文
        context = new NodeContext();
        long startTime = System.currentTimeMillis();

        LogUtil.d(TAG, "开始加载树结构");
        // 获取原始数据
        MetaTree metaTree = nodeProvider.provideMetaTree(context);
        if (metaTree == null) {
            LogUtil.e(TAG, "元数据为空");
            return null;
        }

        LogUtil.d(TAG, "加载元数据结束，总耗时=%dms", System.currentTimeMillis() - startTime);
        AbstractNodeTree rootTree = null;
        Stack<ProcessPair> childrenTree = new Stack<>();
        childrenTree.add(new ProcessPair(metaTree, null));

        // 处理Queue中所有节点
        while (!childrenTree.isEmpty()) {
            ProcessPair currentNode = childrenTree.pop();
            AbstractNodeTree targetTree = null;
            boolean replaceChildren = false;

            // 按照顺序调用处理器
            for (AbstractNodeProcessor processor : nodeProcessors) {
                Object target = processor.loadNode(currentNode.source.getCurrentNode(), currentNode.parentNode, context);

                // 进行了处理
                if (target != null) {
                    if (target instanceof AbstractNodeTree) {
                        targetTree = (AbstractNodeTree) target;
                        break;
                    } else if (target instanceof Class) {
                        // 如果是Provider类，需要调用子树
                        if (AbstractProvider.class.isAssignableFrom((Class) target)) {

                            // 重开一次加载树流程
                            targetTree = this.manager.get().startLoadProvider((Class<? extends AbstractProvider>) target, loadCurrentProviderClass());

                            // 生成成功，结束处理
                            if (targetTree != null) {
                                replaceChildren = true;
                                break;
                            }
                        }
                    }
                }
            }

            // 没有任何processor能处理
            if (targetTree == null) {
                LogUtil.e(TAG, "无法处理元数据：%s，使用处理器：%s", currentNode.source, nodeProcessors);
                continue;
            }

            // 设置父节点信息
            AbstractNodeTree parentNode = currentNode.parentNode;
            if (parentNode != null) {
                parentNode.addChildNode(targetTree);
            } else {
                rootTree = targetTree;
            }

            // 添加子节点待后续处理
            if (!replaceChildren) {
                List<ProcessPair> tmpList = new ArrayList<>(currentNode.source.getChildren().size() + 1);
                for (MetaTree child : currentNode.source.getChildren()) {
                    tmpList.add(new ProcessPair(child, targetTree));
                }

                // 反向push，保证解析出来的顺序不变
                for (int i = tmpList.size() - 1; i >= 0; i--) {
                    childrenTree.push(tmpList.get(i));
                }
            }
        }
        LogUtil.d(TAG, "加载树结构结束，总耗时=%dms", System.currentTimeMillis() - startTime);

        return rootTree;
    }

    /**
     * 加载当前Processor类
     * @return
     */
    private List<Class<? extends AbstractNodeProcessor>> loadCurrentProviderClass() {
        List<Class<? extends AbstractNodeProcessor>> providerClasses = new ArrayList<>(nodeProcessors.size() + 1);
        for (AbstractNodeProcessor processor: nodeProcessors) {
            providerClasses.add(processor.getClass());
        }

        return providerClasses;
    }

    public NodeTreeGenerator(List<AbstractNodeProcessor> nodeProcessors, AbstractProvider nodeProvider, OperationService manager) {
        this.nodeProcessors = nodeProcessors;
        this.nodeProvider = nodeProvider;
        this.manager = new WeakReference<>(manager);
    }

    private static class ProcessPair{
        private MetaTree source;
        private AbstractNodeTree parentNode;

        public ProcessPair(MetaTree source, AbstractNodeTree parentNode) {
            this.source = source;
            this.parentNode = parentNode;
        }
    }
}
