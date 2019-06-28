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
package com.alipay.hulu.shared.io.bean;

import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;

/**
 * 操作数据
 * Created by qiaoruikai on 2018/10/10 8:53 PM.
 */
public class OperationStepMessage {
    private int stepIdx;
    private OperationStep generalOperationStep;

    public int getStepIdx() {
        return stepIdx;
    }

    public void setStepIdx(int stepIdx) {
        this.stepIdx = stepIdx;
    }

    public OperationStep getGeneralOperationStep() {
        return generalOperationStep;
    }

    public void setGeneralOperationStep(OperationStep generalOperationStep) {
        this.generalOperationStep = generalOperationStep;
    }
}
