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

import android.content.Intent;
import android.os.Bundle;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.EditText;
import android.widget.ListView;
import android.widget.TextView;

import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.R;
import com.alipay.hulu.activity.CaseParamEditActivity;
import com.alipay.hulu.bean.AdvanceCaseSetting;
import com.alipay.hulu.bean.CaseParamBean;
import com.alipay.hulu.bean.CaseRunningParam;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Created by qiaoruikai on 2019-08-19 23:37.
 */
public class CaseParamSeparateFragment extends CaseParamEditActivity.CaseParamFragment {
    private static final String TAG = "CaseParamSeparateFragment";
    private ListView paramList;

    // 用例参数设置
    private List<CaseParamBean> presetParams;
    private List<ParamHolder> holders;
    private CaseRunningParam runningParam;
    private Map<String, String> storedParams;
    private ParamHolder waitingHolder;

    /**
     * 设置高级设置
     *
     * @param advanceCaseSetting
     */
    @Override
    public void setAdvanceCaseSetting(@NonNull AdvanceCaseSetting advanceCaseSetting) {
        storedParams = new LinkedHashMap<>();
        presetParams = advanceCaseSetting.getParams();
        runningParam = advanceCaseSetting.getRunningParam();
        if (runningParam == null) {
            runningParam = new CaseRunningParam();
        }

        // 如果之前有存储p
        if (runningParam.getMode() == CaseRunningParam.ParamMode.SEPARATE) {
            List<JSONObject> params = runningParam.getParamList();
            if (params != null) {
                for (JSONObject obj: params) {
                    for (String key: obj.keySet()) {
                        storedParams.put(key, obj.getString(key));
                    }
                }
            }
        }
    }

    @Override
    public CaseRunningParam getRunningParam() {
        int count = paramList.getCount();
        List<JSONObject> params = new ArrayList<>(count + 1);
        for (String key: storedParams.keySet()) {
            JSONObject paramInfo = new JSONObject(2);
            paramInfo.put(key, storedParams.get(key));
            params.add(paramInfo);
        }
        LogUtil.d(TAG,"message:" + params);

        runningParam.setMode(CaseRunningParam.ParamMode.SEPARATE);
        runningParam.setParamList(params);
        return runningParam;
    }


    @Nullable
    @Override
    public View onCreateView(LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View root = inflater.inflate(R.layout.dialog_param_edit, container, false);
        paramList = (ListView) root.findViewById(R.id.dialog_param_list);

        return root;
    }

    @Override
    public void onActivityCreated(@Nullable Bundle savedInstanceState) {
        super.onActivityCreated(savedInstanceState);

        if (presetParams != null) {
            holders = new ArrayList<>(presetParams.size() + 1);
            for (CaseParamBean param : presetParams) {
                ParamHolder holder = new ParamHolder();
                holder.param = param;
                holders.add(holder);
            }

            final LayoutInflater inflater = LayoutInflater.from(getActivity());

            paramList.setAdapter(new BaseAdapter() {
                @Override
                public int getCount() {
                    return holders.size();
                }

                @Override
                public Object getItem(int position) {
                    return holders.get(position);
                }

                @Override
                public long getItemId(int position) {
                    return position;
                }

                @Override
                public View getView(int position, View convertView, ViewGroup parent) {
                    if (convertView == null) {
                        convertView = inflater.inflate(R.layout.item_case_step_edit_input, parent, false);
                        convertView.findViewById(R.id.item_case_step_create_param).setVisibility(View.GONE);
                    }
                    TextView title = (TextView) convertView.findViewById(R.id.item_case_step_name);
                    final EditText edit = (EditText) convertView.findViewById(R.id.item_case_step_edit);

                    // 移除旧的textWatcher
                    TextWatcher oldTextWatcher = (TextWatcher) edit.getTag();
                    if (oldTextWatcher != null) {
                        edit.removeTextChangedListener(oldTextWatcher);
                    }

                    final ParamHolder holder = (ParamHolder) getItem(position);
                    final CaseParamBean paramBean = holder.param;
                    String desc = StringUtil.isEmpty(paramBean.getParamDesc()) ? paramBean.getParamName() : paramBean.getParamDesc();

                    String defaultValue = storedParams.get(paramBean.getParamName());
                    if (defaultValue == null) {
                        defaultValue = "";
                    }
                    edit.setText(defaultValue);
                    TextWatcher textWatcher = new TextWatcher() {
                        @Override
                        public void beforeTextChanged(CharSequence s, int start, int count, int after) {

                        }

                        @Override
                        public void onTextChanged(CharSequence s, int start, int before, int count) {
                            storedParams.put(paramBean.getParamName(), s.toString());
                        }

                        @Override
                        public void afterTextChanged(Editable s) {

                        }
                    };
                    edit.setTag(textWatcher);
                    edit.addTextChangedListener(textWatcher);

                    title.setText(desc);

                    return convertView;
                }
            });
        }
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        LogUtil.d(TAG, "On activity result: %d, %d, %s", requestCode, resultCode, data);
    }

    private static class ParamHolder {
        private CaseParamBean param;
    }
}
