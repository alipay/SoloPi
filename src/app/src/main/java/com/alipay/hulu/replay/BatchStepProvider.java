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

import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.bean.ReplayStepInfoBean;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;

import java.util.ArrayList;
import java.util.List;

/**
 * Created by qiaoruikai on 2018/10/16 2:04 AM.
 */
public class BatchStepProvider extends AbstractStepProvider {
    private static final String TAG = "BatchStepProvider";

    private List<RecordCaseInfo> mRecordCases;
    private int currentCaseIdx;

    private OperationStep prepareStep;
    private boolean restart;

    OperationStepProvider currentStepProvider;

    List<ReplayResultBean> resultBeans;

    @Override
    public void prepare() {
        // 加载当前Step
        loadProvider(currentCaseIdx);
    }

    public BatchStepProvider(List<RecordCaseInfo> recordCaseInfos, boolean restart) {
        mRecordCases = recordCaseInfos;
        currentCaseIdx = 0;
        this.restart = restart;

        resultBeans = new ArrayList<>(recordCaseInfos.size() + 1);
    }

    /**
     * 加载Provider
     * @param startPos
     */
    private void loadProvider(int startPos) {
        int pos = startPos;
        RecordCaseInfo currentCase = null;
        currentStepProvider = null;
        while (pos < mRecordCases.size() && (currentCase = mRecordCases.get(pos)) == null) {
            pos ++;
        }

        currentCaseIdx = pos;

        if (currentCase == null) {
            return;
        }

        currentStepProvider = new OperationStepProvider(currentCase);

        // 重启应用
        if (restart) {
            prepareStep = new OperationStep();
            prepareStep.setOperationMethod(new OperationMethod(PerformActionEnum.GOTO_INDEX));
        }

        currentStepProvider.prepare();
    }

    @Override
    public OperationStep provideStep() {
        if (!currentStepProvider.hasNext()) {
            if (currentCaseIdx >= mRecordCases.size() - 1) {
                return null;
            } else {
                // 记录下之前的问题
                resultBeans.addAll(currentStepProvider.genReplayResult());

                // 加载下一步
                loadProvider(currentCaseIdx + 1);
            }
        }

        if (prepareStep != null) {
            OperationStep step = prepareStep;
            prepareStep = null;
            return step;
        }
        return currentStepProvider == null? null: currentStepProvider.provideStep();
    }

    @Override
    public boolean hasNext() {
        return (currentStepProvider != null && currentStepProvider.hasNext()) || (currentCaseIdx < mRecordCases.size() - 1);
    }

    @Override
    public boolean reportErrorStep(OperationStep step, String reason, List<String> stack) {
        boolean errorResult = currentStepProvider.reportErrorStep(step, reason, stack);

        // 如果是关键性错误
        if (errorResult) {
            // 记录下之前的问题
            resultBeans.addAll(currentStepProvider.genReplayResult());

            // 加载下一步
            loadProvider(currentCaseIdx + 1);
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
