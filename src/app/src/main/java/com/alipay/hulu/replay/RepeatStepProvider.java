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
package com.alipay.hulu.replay;

import android.support.annotation.NonNull;

import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.bean.ReplayStepInfoBean;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;

import java.util.ArrayList;
import java.util.List;

/**
 * Created by qiaoruikai on 2018/10/29 11:06 AM.
 */
public class RepeatStepProvider extends AbstractStepProvider {
    private static final String TAG = "RepeatStepProvider";

    private RecordCaseInfo recordCase;

    private OperationStep prepareStep;

    private boolean prepare;

    private int currentIdx;
    private final int repeatCount;

    OperationStepProvider currentStepProvider;

    List<ReplayResultBean> resultBeans;

    @Override
    public void prepare() {
        loadStep();
    }

    public RepeatStepProvider(@NonNull RecordCaseInfo recordCase, int repeatCount, boolean prepare) {
        this.recordCase = recordCase;
        currentIdx = 0;

        this.repeatCount = repeatCount;
        this.prepare = prepare;

        resultBeans = new ArrayList<>(repeatCount + 1);
    }

    private void loadStep() {
        if (currentIdx <= repeatCount - 1) {
            currentStepProvider = new OperationStepProvider(recordCase);
            currentIdx++;

            if (prepare) {
                prepareStep = new OperationStep();
                prepareStep.setOperationMethod(new OperationMethod(PerformActionEnum.GOTO_INDEX));
            }

            currentStepProvider.prepare();
        } else {
            currentStepProvider = null;
        }
    }

    @Override
    public OperationStep provideStep() {
        if (prepareStep != null) {
            OperationStep step = prepareStep;
            prepareStep = null;
            return step;
        }
        return currentStepProvider == null? null: currentStepProvider.provideStep();
    }

    @Override
    public boolean hasNext() {
        if (currentStepProvider != null && !currentStepProvider.hasNext()) {
            resultBeans.addAll(currentStepProvider.genReplayResult());
            loadStep();
        }

        return currentStepProvider != null && currentStepProvider.hasNext();
    }

    @Override
    public boolean reportErrorStep(OperationStep step, String reason, List<String> stack) {
        boolean errorResult = currentStepProvider.reportErrorStep(step, reason, stack);

        // 如果是关键性错误
        if (errorResult) {
            // 记录下之前的问题
            resultBeans.addAll(currentStepProvider.genReplayResult());

            // 加载下一步
            loadStep();
        }

        return false;
    }

    @Override
    public void onStepInfo(ReplayStepInfoBean bean) {
        currentStepProvider.onStepInfo(bean);
    }

    @Override
    public List<ReplayResultBean> genReplayResult() {
        if (currentStepProvider != null) {
            resultBeans.addAll(currentStepProvider.genReplayResult());
            currentStepProvider = null;
        }

        return resultBeans;
    }
}
