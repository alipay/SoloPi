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
package com.alipay.hulu.fragment;

import android.os.Bundle;
import android.support.annotation.Nullable;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.R;
import com.alipay.hulu.activity.CaseEditActivity;
import com.alipay.hulu.bean.AdvanceCaseSetting;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;

public class CaseDescEditFragment extends BaseFragment implements CaseEditActivity.OnCaseSaveListener {
    private static final String TAG = "CaseStepEditFrag";

    public static final String RECORD_CASE_EXTRA = "record_case";

    private RecordCaseInfo mRecordCase;

    private EditText mCaseName;

    private EditText mCaseDesc;

    // 用例版本号
    private int caseVersion = 0;

    /**
     * 通过RecordCase初始化
     *
     * @param
     */
    public static CaseDescEditFragment getInstance(RecordCaseInfo recordCaseInfo) {
        CaseDescEditFragment fragment = new CaseDescEditFragment();
        fragment.mRecordCase = recordCaseInfo;
        return fragment;
    }

    @Nullable
    @Override
    public View onCreateView(LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View root = inflater.inflate(R.layout.fragment_case_desc_edit, container, false);
        // 获取各项控件
        mCaseName = (EditText) root.findViewById(R.id.case_name);
        mCaseDesc = (EditText) root.findViewById(R.id.case_desc);
        return root;
    }

    @Override
    public void onActivityCreated(@Nullable Bundle savedInstanceState) {
        super.onActivityCreated(savedInstanceState);
        initData();
    }

    /**
     * 初始化数据
     */
    private void initData() {
        // 如果Intent中没有
        if (mRecordCase == null) {
            LogUtil.e(TAG, "There is no record case");
            return;
        }

        mCaseName.setText(mRecordCase.getCaseName());
        mCaseDesc.setText(mRecordCase.getCaseDesc());

        // 如果有高级设置
        if (!StringUtil.isEmpty(mRecordCase.getAdvanceSettings())) {
            AdvanceCaseSetting setting = JSON.parseObject(mRecordCase.getAdvanceSettings(),
                    AdvanceCaseSetting.class);
            caseVersion = setting.getVersion();
        }
    }

    @Override
    public void onCaseSave() {
        mRecordCase.setCaseName(mCaseName.getText().toString());
        mRecordCase.setCaseDesc(mCaseDesc.getText().toString());

        AdvanceCaseSetting advanceCaseSetting = new AdvanceCaseSetting();
        advanceCaseSetting.setVersion(caseVersion);

        mRecordCase.setAdvanceSettings(JSON.toJSONString(advanceCaseSetting));
    }
}
