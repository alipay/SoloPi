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
    public NodeKeyBoard keyBoard;

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
        if (keyBoard != null) {
            keyBoard.disconnect();
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
