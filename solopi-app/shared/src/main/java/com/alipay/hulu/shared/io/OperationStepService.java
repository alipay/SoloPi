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
package com.alipay.hulu.shared.io;

import android.content.Context;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.service.base.ExportService;
import com.alipay.hulu.common.service.base.LocalService;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.shared.io.bean.OperationStepMessage;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;

/**
 * Created by qiaoruikai on 2018/10/10 8:35 PM.
 */
@LocalService
public class OperationStepService implements ExportService {
    public static final String NOTIFY_OPERATION_STEP = "notifyRecordStep";

    private static final String TAG = "OperationStepService";

    OperationStepProcessor processor;
    InjectorService injectorService;

    @Override
    public void onCreate(Context context) {
        injectorService = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
        injectorService.register(this);
    }

    @Override
    public void onDestroy(Context context) {
        injectorService.unregister(this);
    }

    /**
     * 配置步骤处理器
     * @param processor
     */
    public void registerStepProcessor(OperationStepProcessor processor) {
        this.processor = processor;
    }

    /**
     * 启动用例录制
     * @param recordCaseInfo
     */
    public void startRecord(RecordCaseInfo recordCaseInfo) {
        if (processor == null) return;
        processor.onStartRecord(recordCaseInfo);
    }

    /**
     * 停止用例录制
     */
    public boolean stopRecord(Context context) {
        if (processor == null) return false;
        return processor.onStopRecord(context);
    }

    @Subscriber(@Param(NOTIFY_OPERATION_STEP))
    public void processRecordStep(OperationStepMessage message) {
        // 空消息不处理
        if (message == null) {
            LogUtil.e(TAG, "无法处理空消息");
            return;
        }

        if (processor == null) {
            LogUtil.e(TAG, "No step processor registered");
            return;
        }

        // 如果通常步骤非空
        if (message.getGeneralOperationStep() != null) {
            processor.onOperationStep(message.getStepIdx(), message.getGeneralOperationStep());
        } else {
            LogUtil.e(TAG, "无法处理空步骤: %s", message);
        }
    }
}
