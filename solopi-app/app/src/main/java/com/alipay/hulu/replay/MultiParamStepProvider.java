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

import androidx.annotation.NonNull;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.bean.AdvanceCaseSetting;
import com.alipay.hulu.bean.CaseRunningParam;
import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.bean.ReplayStepInfoBean;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.node.OperationService;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Created by qiaoruikai on 2019-08-20 19:26.
 */
public class MultiParamStepProvider extends AbstractStepProvider {
    private static final String TAG = "RepeatStepProvider";

    private OperationService operationService;

    private RecordCaseInfo recordCase;
    private OperationStep prepareStep;

    private int currentIdx;
    private List<Map<String, String>> repeatParams = new ArrayList<>();

    OperationStepProvider currentStepProvider;

    List<ReplayResultBean> resultBeans;

    @Override
    public void prepare() {
        loadStep();
    }

    public MultiParamStepProvider(@NonNull RecordCaseInfo recordCase) {
        this.recordCase = recordCase;
        currentIdx = 0;
        operationService = LauncherApplication.service(OperationService.class);

        parseParams();
        resultBeans = new ArrayList<>(repeatParams.size() + 1);
    }

    private void parseParams() {
        AdvanceCaseSetting setting = JSON.parseObject(recordCase.getAdvanceSettings(), AdvanceCaseSetting.class);
        CaseRunningParam runningParam = setting.getRunningParam();
        if (runningParam == null) {
            repeatParams.add(Collections.EMPTY_MAP);
            return;
        }

        if (runningParam.getMode() == CaseRunningParam.ParamMode.UNION) {
            List<JSONObject> paramUnion = runningParam.getParamList();
            for (JSONObject param: paramUnion) {
                Map<String, String> realParams = new HashMap<>(param.size() + 1);
                for (String key: param.keySet()) {
                    realParams.put(key, param.getString(key));
                }

                repeatParams.add(realParams);
            }
        } else {
            Map<String, List<String>> paramSet = new HashMap<>();
            List<JSONObject> paramUnion = runningParam.getParamList();
            for (JSONObject param: paramUnion) {
                for (String key: param.keySet()) {
                    paramSet.put(key, Arrays.asList(StringUtil.split(param.getString(key), ",")));
                }
            }

            List<String> keys = new ArrayList<>(paramSet.keySet());
            if (keys.size() == 0) {
                return;
            }

            List<Map<String, String>> stackParam = new ArrayList<>();
            String initKey = keys.get(0);
            for (String param: paramSet.get(initKey)) {
                HashMap<String, String> realParams = new HashMap<>(keys.size() + 1);
                realParams.put(initKey, param);
                stackParam.add(realParams);
            }

            // 全连接网络
            for (int i = 1; i < keys.size(); i++) {
                List<Map<String, String>> newStackParam = new ArrayList<>();
                String key = keys.get(i);
                for (Map<String, String> realParam: stackParam) {
                    for (String param: paramSet.get(key)) {
                        Map<String, String> newLevelParam = new HashMap<>(realParam);
                        newLevelParam.put(key, param);
                        newStackParam.add(newLevelParam);
                    }
                }
                stackParam = newStackParam;
            }

            repeatParams.addAll(stackParam);
        }
    }

    private void loadStep() {
        if (currentIdx <= repeatParams.size() - 1) {
            currentStepProvider = new OperationStepProvider(recordCase);
            currentStepProvider.putParams(repeatParams.get(currentIdx));
            currentIdx++;

            currentStepProvider.prepare();

            prepareStep = new OperationStep();
            prepareStep.setOperationMethod(new OperationMethod(PerformActionEnum.GOTO_INDEX));
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
