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
package com.alipay.hulu.util;

import android.support.annotation.NonNull;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.bean.AdvanceCaseSetting;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.replay.BatchStepProvider;
import com.alipay.hulu.replay.MultiParamStepProvider;
import com.alipay.hulu.replay.OperationStepProvider;
import com.alipay.hulu.replay.RepeatStepProvider;
import com.alipay.hulu.service.CaseReplayManager;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;

import java.util.ArrayList;
import java.util.List;

/**
 * 用例回放管理器
 * Created by qiaoruikai on 2019-08-21 12:41.
 */
public class CaseReplayUtil {

    /**
     * 开始回放单条用例
     * @param recordCase
     */
    public static void startReplay(@NonNull RecordCaseInfo recordCase) {
        CaseReplayManager manager = LauncherApplication.getInstance().findServiceByName(CaseReplayManager.class.getName());
        String advanceSettings = recordCase.getAdvanceSettings();
        AdvanceCaseSetting setting = JSON.parseObject(advanceSettings, AdvanceCaseSetting.class);
        MyApplication.getInstance().updateAppAndNameTemp(recordCase.getTargetAppPackage(), recordCase.getTargetAppLabel());

        if (setting != null && setting.getRunningParam() != null) {
            MultiParamStepProvider stepProvider = new MultiParamStepProvider(recordCase);
            manager.start(stepProvider, MyApplication.MULTI_REPLAY_LISTENER);
        } else {
            OperationStepProvider stepProvider = new OperationStepProvider(recordCase);
            manager.start(stepProvider, MyApplication.SINGLE_REPLAY_LISTENER);
        }
    }

    /**
     * 开始重复回放用例
     * @param recordCase
     * @param times
     * @param restart 执行前重启
     */
    public static void startReplayMultiTimes(@NonNull RecordCaseInfo recordCase, int times, boolean restart) {
        RepeatStepProvider stepProvider = new RepeatStepProvider(recordCase, times, restart);
        MyApplication.getInstance().updateAppAndNameTemp(recordCase.getTargetAppPackage(), recordCase.getTargetAppLabel());
        CaseReplayManager manager = LauncherApplication.getInstance().findServiceByName(CaseReplayManager.class.getName());
        manager.start(stepProvider, MyApplication.MULTI_REPLAY_LISTENER);
    }

    /**
     * 开始回放多条用例
     * @param recordCases 用例列表
     * @param restart 执行前重启
     */
    public static void startReplayMultiCase(@NonNull List<RecordCaseInfo> recordCases, boolean restart) {
        BatchStepProvider provider = new BatchStepProvider(new ArrayList<>(recordCases), restart);
        CaseReplayManager manager = LauncherApplication.getInstance().findServiceByName(CaseReplayManager.class.getName());
        manager.start(provider, MyApplication.MULTI_REPLAY_LISTENER);
    }
}
