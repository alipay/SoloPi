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
package com.alipay.hulu.bean;

import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;

import java.util.List;

/**
 * Created by lezhou.wyl on 2018/7/16.
 */
public class AdvanceCaseSetting {

    private String descriptorMode;
    private int version;
    private List<CaseParamBean> params;
    private String overrideApp;
    private CaseRunningParam runningParam;

    /**
     * 准备步骤（不录制）
     */
    private List<OperationStep> prepareActions;

    /**
     * 后续步骤（不录制）
     */
    private List<OperationStep> suffixActions;

    public AdvanceCaseSetting() {

    }

    public AdvanceCaseSetting(AdvanceCaseSetting old) {
        if (old == null) {
            return;
        }
        this.overrideApp = old.overrideApp;
        this.descriptorMode = old.descriptorMode;
        this.params = old.params;
        this.runningParam = old.runningParam;
        this.version = old.version;
    }

    public String getDescriptorMode() {
        return descriptorMode;
    }

    public void setDescriptorMode(String descriptorMode) {
        this.descriptorMode = descriptorMode;
    }

    public int getVersion() {
        return version;
    }

    public void setVersion(int version) {
        this.version = version;
    }

    public String getOverrideApp() {
        return overrideApp;
    }

    public void setOverrideApp(String overrideApp) {
        this.overrideApp = overrideApp;
    }

    public List<CaseParamBean> getParams() {
        return params;
    }

    public void setParams(List<CaseParamBean> params) {
        this.params = params;
    }

    public CaseRunningParam getRunningParam() {
        return runningParam;
    }

    public void setRunningParam(CaseRunningParam runningParam) {
        this.runningParam = runningParam;
    }

    public List<OperationStep> getPrepareActions() {
        return prepareActions;
    }

    public void setPrepareActions(List<OperationStep> prepareActions) {
        this.prepareActions = prepareActions;
    }

    public List<OperationStep> getSuffixActions() {
        return suffixActions;
    }

    public void setSuffixActions(List<OperationStep> suffixActions) {
        this.suffixActions = suffixActions;
    }
}