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

import androidx.annotation.NonNull;

import com.alipay.hulu.common.injector.param.InjectParam;
import com.alipay.hulu.common.utils.StringUtil;

import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

public class ProviderInfo implements Comparable<ProviderInfo> {
    /**
     * 更新间隔
     */
    private long updatePeriod;

    /**
     * 上次更新时间
     */
    private long lastUpdateTime = -1;

    /**
     * 是否需要由消息中心调用
     */
    private boolean lazy;

    /**
     * 运行状态标志
     */
    private AtomicBoolean isRunning;

    /**
     * 提供的参数
     */
    private List<InjectParam> provideParams;

    private boolean force;

    int rank = 0;


    public ProviderInfo(long updatePeriod, List<InjectParam> provideParams, boolean lazy, boolean force) {
        this.updatePeriod = updatePeriod;
        this.provideParams = provideParams;
        this.lazy = lazy;
        this.isRunning = new AtomicBoolean(false);
        this.force = force;
    }

    /**
     * 获取当前是否达到更新时间
     * @return
     */
    public boolean shouldUpdate() {
        return System.currentTimeMillis() - lastUpdateTime >= updatePeriod;
    }

    /**
     * 开始运行
     */
    public void start() {
        this.isRunning.set(true);
        this.lastUpdateTime = System.currentTimeMillis();
    }

    /**
     * 结束运行
     */
    public void finish() {
        this.isRunning.set(false);
    }

    /**
     * 查找可提供的参数
     * @param name
     * @param value
     * @return
     */
    public InjectParam findParam(String name, Object value) {
        for (InjectParam paramType: provideParams) {
            if (StringUtil.equals(paramType.getName(), name)) {
                if (paramType.isValueValid(value)) {
                    return paramType;
                }
                return null;
            }
        }

        return null;
    }

    /**
     * 获取是否正在运行
     * @return
     */
    public boolean isRunning() {
        return this.isRunning.get();
    }

    @Override
    public int compareTo(@NonNull ProviderInfo o) {
        return rank - o.rank;
    }

    public int getRank() {
        return rank;
    }

    public void setRank(int rank) {
        this.rank = rank;
    }

    public boolean isLazy() {
        return lazy;
    }

    public void setLazy(boolean lazy) {
        this.lazy = lazy;
    }

    public boolean isForce() {
        return force;
    }

    public void setForce(boolean force) {
        this.force = force;
    }
}
