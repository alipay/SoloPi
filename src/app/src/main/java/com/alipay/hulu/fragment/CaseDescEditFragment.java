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
import android.widget.ListView;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.adapter.ParamListAdapter;
import com.alipay.hulu.R;
import com.alipay.hulu.activity.CaseEditActivity;
import com.alipay.hulu.bean.AdvanceCaseSetting;
import com.alipay.hulu.bean.CaseParamBean;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.RunningThread;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;

import java.util.Collections;
import java.util.List;

public class CaseDescEditFragment extends BaseFragment implements CaseEditActivity.OnCaseSaveListener {
    private static final String TAG = "CaseStepEditFrag";

    private RecordCaseInfo mRecordCase;

    private AdvanceCaseSetting setting;

    private EditText mCaseName;

    private EditText mCaseDesc;
    private ListView mParams;

    private ParamListAdapter adapter;

    @Subscriber(value = @Param(sticky = false), thread = RunningThread.MAIN_THREAD)
    public void receiveNewParam(CaseParamBean param) {
        List<CaseParamBean> paramBeanList = adapter.getData();
        paramBeanList.add(param);
        adapter.setData(paramBeanList);
    }

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
        mParams = (ListView) root.findViewById(R.id.case_params);
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
        setting = JSON.parseObject(mRecordCase.getAdvanceSettings()
                , AdvanceCaseSetting.class);

        // 参数列表
        adapter = new ParamListAdapter(getActivity());
        mParams.setAdapter(adapter);

        if (setting != null) {
            adapter.setData(setting.getParams());
        } else {
            mParams.setVisibility(View.GONE);
        }
    }

    @Override
    public void onCaseSave() {
        mRecordCase.setCaseName(mCaseName.getText().toString());
        mRecordCase.setCaseDesc(mCaseDesc.getText().toString());

        if (setting == null) {
            setting = new AdvanceCaseSetting();
        }
        if (adapter != null && mParams.getVisibility() == View.VISIBLE) {
            setting.setParams(adapter.getData());
        }
        mRecordCase.setAdvanceSettings(JSON.toJSONString(setting));
    }

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        InjectorService.g().register(this);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        InjectorService.g().unregister(this);
    }
}
