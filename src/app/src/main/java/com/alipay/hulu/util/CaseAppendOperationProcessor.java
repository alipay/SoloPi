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

import android.content.Context;
import android.content.Intent;
import android.support.annotation.NonNull;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.activity.CaseEditActivity;
import com.alipay.hulu.bean.CaseStepHolder;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.shared.io.OperationStepProcessor;
import com.alipay.hulu.shared.io.bean.GeneralOperationLogBean;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.io.util.OperationStepUtil;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;

import java.util.ArrayList;
import java.util.List;

/**
 * Created by qiaoruikai on 2019-08-06 15:31.
 */
public class CaseAppendOperationProcessor implements OperationStepProcessor {
    private RecordCaseInfo originCase;
    private List<OperationStep> recordSteps;

    public CaseAppendOperationProcessor(@NonNull RecordCaseInfo originCase) {
        this.originCase = originCase;

        // 加载步骤信息
        GeneralOperationLogBean operationLogBean = JSON.parseObject(originCase.getOperationLog(), GeneralOperationLogBean.class);
        OperationStepUtil.afterLoad(operationLogBean);
        if (operationLogBean != null) {
            recordSteps = operationLogBean.getSteps();
        }
        if (recordSteps == null) {
            recordSteps = new ArrayList<>();
        }
    }

    @Override
    public void onStartRecord(RecordCaseInfo recordCaseInfo) {

    }

    @Override
    public boolean onStopRecord(final Context context) {
        GeneralOperationLogBean operationLogBean = new GeneralOperationLogBean();
        operationLogBean.setSteps(recordSteps);

        originCase.setOperationLog(JSON.toJSONString(operationLogBean));

        final int id = CaseStepHolder.storeCase(originCase);
        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Intent intent = new Intent(context, CaseEditActivity.class);
                intent.putExtra(CaseEditActivity.RECORD_CASE_EXTRA, id);
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            }
        });
        return true;
    }

    @Override
    public void onOperationStep(int operationIdx, OperationStep step) {
        recordSteps.add(step);
    }
}
