package com.alipay.hulu.shared.node.action.provider;

import android.content.Context;

import com.alipay.hulu.shared.node.action.OperationContext;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;

import java.util.Map;

/**
 * Created by qiaoruikai on 2019/1/7 8:12 PM.
 */
public interface ActionProvider {
    void onCreate(Context context);

    void onDestroy(Context context);

    /**
     * 是否能够处理操作
     * @param action
     * @return
     */
    boolean canProcess(String action);

    /**
     * 处理操作
     * @param targetAction 目标方法
     * @param node 目标控件
     * @param method 操作相关参数
     * @param context 操作上下文
     * @return
     */
    boolean processAction(String targetAction, AbstractNodeTree node, OperationMethod method,
                          OperationContext context);

    /**
     * 提供操作
     * @param node 待操作节点（全局为空）
     * @return
     */
    Map<String, String> provideActions(AbstractNodeTree node);

    /**
     * 提供配置View
     * @param context 悬浮窗上下文
     * @param action 对应操作
     * @param method 操作参数方法
     * @param node 操作节点
     * @param callback 界面加载回调
     * @return 配置界面（无表示不需要配置）
     */
    void provideView(Context context, String action, OperationMethod method, AbstractNodeTree node,
                     ViewLoadCallback callback);
}
