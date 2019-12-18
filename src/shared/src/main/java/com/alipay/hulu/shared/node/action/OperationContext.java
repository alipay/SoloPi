package com.alipay.hulu.shared.node.action;

import com.alipay.hulu.common.utils.LogUtil;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 操作执行各类参数
 * Created by qiaoruikai on 2018/10/30 5:19 PM.
 */
public class OperationContext {
    private AtomicBoolean notifyStatus = new AtomicBoolean(false);
    public CmdExecutor executor;
    private OperationListener listener;
    public OperationExecutor opExecutor;

    public int screenWidth;
    public int screenHeight;

    /**
     * 后台执行并通知完成
     * @param runnable 待执行任务
     */
    public void notifyOnFinish(final Runnable runnable) {
        Runnable wrapper = new Runnable() {
            @Override
            public void run() {
                try {
                    runnable.run();
                } catch (Throwable e) {
                    LogUtil.e("OperationContext", "execute background action throw " + e.getMessage(), e);
                } finally {
                    // 清理当前结构
                    opExecutor.invalidRoot();
                    notifyOperationFinish();
                }
            }
        };

        executor.execute(wrapper);
    }

    /**
     * 通知执行完成
     */
    public void notifyOperationFinish() {
        if (listener != null && !notifyStatus.getAndSet(true)) {
            listener.notifyOperationFinish();
        }
    }

    public void setListener(OperationListener listener) {
        this.listener = listener;
    }

    /**
     * 操作执行回调
     */
    public interface OperationListener {
        /**
         * 通知执行完成
         */
        void notifyOperationFinish();
    }
}
