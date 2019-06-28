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
package com.alipay.hulu.shared.node.utils;

import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.shared.node.utils.prepare.PrepareWorker;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * 环境准备
 * Created by qiaoruikai on 2018/8/16 下午2:40.
 */
public class PrepareUtil {
    private static final String TAG = "PrepareUtil";

    private static volatile boolean initialized = false;
    private static List<PrepareWorker> PREPARE_WORKERS;

    public static boolean doPrepareWork(String targetApp) {
        return doPrepareWork(targetApp, null);
    }

    /**
     * 进行准备工作
     * @param targetApp
     * @return
     */
    public static boolean doPrepareWork(String targetApp, PrepareStatus status) {
        if (!initialized) {
            initialized = true;
            initPrepareWorkers();
        }

        // 遍历执行准备工作
        if (PREPARE_WORKERS != null && PREPARE_WORKERS.size() > 0) {
            for (PrepareWorker prepareWorker: PREPARE_WORKERS) {
                // 如果某步准备工作失败，停止准备
                try {
                    boolean result = prepareWorker.doPrepareWork(targetApp, status);

                    if (!result) {
                        return false;
                    }
                } catch (Throwable t) {
                    LogUtil.e(TAG, "准备失败，message=" + t.getMessage(), t);
                }
            }
        }
        return true;
    }

    private static void initPrepareWorkers() {
        try {
            // 查找PrepareWorker实例
            List<Class<? extends PrepareWorker>> prepareWorkerClzs = ClassUtil.findSubClass(PrepareWorker.class, PrepareWorker.PrepareTool.class);
            List<PrepareWorker> prepareWorkers = new ArrayList<>();

            if (prepareWorkerClzs != null && prepareWorkerClzs.size() > 0) {
                // 按照priority进行遍历
                Collections.sort(prepareWorkerClzs, new Comparator<Class<? extends PrepareWorker>>() {
                    @Override
                    public int compare(Class<? extends PrepareWorker> o1, Class<? extends PrepareWorker> o2) {
                        PrepareWorker.PrepareTool o1T = o1.getAnnotation(PrepareWorker.PrepareTool.class);
                        PrepareWorker.PrepareTool o2T = o2.getAnnotation(PrepareWorker.PrepareTool.class);
                        return o2T.priority() - o1T.priority();
                    }
                });

                // 实例化
                for (Class<? extends PrepareWorker> prepareWorkerClz : prepareWorkerClzs) {
                    PrepareWorker instance = ClassUtil.constructClass(prepareWorkerClz);

                    // 如果实例非空，添加该实例
                    if (instance != null) {
                        prepareWorkers.add(instance);
                    }
                }
            }
            PREPARE_WORKERS = prepareWorkers;
        } catch (Throwable t) {
            LogUtil.e(TAG, "加载PrepareWorker抛出异常,message=" + t.getMessage(), t);
        }
    }

    public interface PrepareStatus {
        void currentStatus(int progress, int total, String message, boolean status);
    }
}
