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
package com.alipay.hulu.activity;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.support.annotation.Nullable;
import android.support.v4.content.ContextCompat;
import android.text.TextUtils;
import android.util.Log;
import android.view.View;
import android.widget.AdapterView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.R;
import com.alipay.hulu.bean.AdvanceCaseSetting;
import com.alipay.hulu.bean.CaseStepHolder;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.io.db.GreenDaoManager;
import com.alipay.hulu.ui.HeadControlPanel;

/**
 * 用例编辑Activity
 */
public class CaseEditActivity extends BaseActivity implements AdapterView.OnItemSelectedListener {
    private static final String TAG = "CaseEditActivity";

    public static final String RECORD_CASE_EXTRA = "record_case";

    private HeadControlPanel mHeadPanel;

    private EditText mCaseName;

    private EditText mCaseDesc;

    private Button updateButton;

    private RecordCaseInfo mRecordCase;

    private String operationMode = null;

    private int caseVersion = 0;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        initView();

        initData();
    }

    /**
     * 初始化界面
     */
    private void initView() {
        setContentView(R.layout.activity_edit_case);

        // 获取各项控件
        mHeadPanel = (HeadControlPanel) findViewById(R.id.head_edit_case);
        mCaseName = (EditText) findViewById(R.id.case_name);
        mCaseDesc = (EditText) findViewById(R.id.case_desc);

        // 获取button
        updateButton = (Button) findViewById(R.id.button_update_case);
    }

    /**
     * 初始化数据
     */
    private void initData() {
        int caseId = getIntent().getIntExtra(RECORD_CASE_EXTRA, 0);
        mRecordCase = CaseStepHolder.getCase(caseId);

        mHeadPanel.setMiddleTitle("用例编辑");
        mHeadPanel.setBackIconClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                CaseEditActivity.this.finish();
            }
        });

        if (mRecordCase == null) {
            LogUtil.e(TAG, "There is no record case");
            return;
        }

        // 如果有高级设置
        if (!StringUtil.isEmpty(mRecordCase.getAdvanceSettings())) {
            AdvanceCaseSetting setting = JSON.parseObject(mRecordCase.getAdvanceSettings(),
                    AdvanceCaseSetting.class);
            caseVersion = setting.getVersion();
            operationMode = setting.getDescriptorMode();
        }


        mCaseName.setText(mRecordCase.getCaseName());
        mCaseDesc.setText(mRecordCase.getCaseDesc());

        updateButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (TextUtils.isEmpty(mCaseName.getText())) {
                    toastShort("用例名称不能为空");
                    return;
                }

                wrapRecordCase();
                doUpdateCase();
            }
        });
    }

    /**
     * 包装用例信息
     */
    private void wrapRecordCase() {
        mRecordCase.setCaseName(mCaseName.getText().toString());
        mRecordCase.setCaseDesc(mCaseDesc.getText().toString());

        AdvanceCaseSetting advanceCaseSetting = new AdvanceCaseSetting();
        advanceCaseSetting.setDescriptorMode(operationMode);
        advanceCaseSetting.setVersion(caseVersion);

        mRecordCase.setAdvanceSettings(JSON.toJSONString(advanceCaseSetting));
    }

    private void doUpdateCase() {
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                mRecordCase.setGmtModify(System.currentTimeMillis());
                GreenDaoManager.getInstance().getRecordCaseInfoDao().save(mRecordCase);
                toastShort("更新成功");
                InjectorService.g().pushMessage(NewRecordActivity.NEED_REFRESH_CASES_LIST);
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (resultCode != RESULT_OK) {
            return;
        }
    }

    @Override
    public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
        if (position == 0) {
            ((TextView) view).setTextColor(ContextCompat
                    .getColor(this, R.color.hint_color));
        } else {
            ((TextView) view).setTextColor(Color.BLACK);
        }
    }

    @Override
    public void onNothingSelected(AdapterView<?> parent) {

    }
}
