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
package com.alipay.hulu.adapter;

import android.support.v7.widget.RecyclerView;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.Pair;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.Spinner;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.bean.CaseParamBean;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.action.OperationExecutor;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.util.DialogUtils;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static com.alipay.hulu.shared.node.utils.LogicUtil.SCOPE;

/**
 * Created by qiaoruikai on 2019/2/21 9:17 PM.
 */
public class CaseStepMethodAdapter extends RecyclerView.Adapter {
    private static final String TAG = "CaseMethodAdapter";
    private List<CaseStepAdapter.MyDataWrapper> laterList;

    private OperationMethod method;

    private Map<String, String> paramKeyMap;

    List<String> keys;

    public CaseStepMethodAdapter(List<CaseStepAdapter.MyDataWrapper> laterList, OperationMethod method) {
        this.method = method;

        // 解析实际文案
        Map<String, Integer> paramMap = method.getActionEnum().getActionParams();
        paramKeyMap = new HashMap<>();
        for (String key: paramMap.keySet()) {
            Integer res = paramMap.get(key);
            if (res != null) {
                paramKeyMap.put(key, StringUtil.getString(res));
            }
        }

        this.laterList = laterList;

        // 组装下参数
        keys = new ArrayList<>(method.getParamKeys());

        // 局部操作坐标字段不展示
        keys.remove(OperationExecutor.LOCAL_CLICK_POS_KEY);
    }

    @Override
    public int getItemViewType(int position) {
        return StringUtil.equals(keys.get(position), SCOPE)? 1: 0;
    }

    @Override
    public RecyclerView.ViewHolder onCreateViewHolder(ViewGroup parent, int viewType) {
        if (parent == null) {
            return null;
        }

        if (viewType == 1) {
            View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_case_step_edit_select, parent, false);
            return new SelectAdapter(v, method);
        } else {
            View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_case_step_edit_input, parent, false);
            return new CaseStepParamHolder(view, method);
        }
    }

    @Override
    public void onBindViewHolder(RecyclerView.ViewHolder holder, int position) {
        if (holder instanceof CaseStepParamHolder) {
            String key = keys.get(position);
            String desc = paramKeyMap.containsKey(key)? paramKeyMap.get(key): key;
            String value = method.getParam(key);
            ((CaseStepParamHolder) holder).bindData(key, desc, value);
        } else {
            ((SelectAdapter) holder).wrapData(laterList, method.getParam(keys.get(position)));
        }
    }

    @Override
    public int getItemCount() {
        return keys.size();
    }

    private static class SelectAdapter extends RecyclerView.ViewHolder {
        Spinner spinner;
        TextView hint;
        private OperationMethod method;
        ArrayAdapter<String> adapter;

        public SelectAdapter(View itemView, OperationMethod method) {
            super(itemView);

            this.method = method;

            spinner = (Spinner) itemView.findViewById(R.id.case_step_edit_select_spinner);
            hint = (TextView) itemView.findViewById(R.id.case_step_edit_select_hint);

            spinner.setOnFocusChangeListener(new View.OnFocusChangeListener() {
                @Override
                public void onFocusChange(View v, boolean hasFocus) {
                    if (hasFocus) {
                        hint.setTextColor(v.getResources().getColor(R.color.colorAccent));
                    } else {

                        hint.setTextColor(v.getResources().getColor(R.color.colorHint));
                    }
                }
            });

            spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
                @Override
                public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                    SelectAdapter.this.method.putParam(SCOPE, Integer.toString(position + 1));
                }

                @Override
                public void onNothingSelected(AdapterView<?> parent) {

                }
            });

            // 设置Adapter
            adapter = new ArrayAdapter<>(spinner.getContext(), R.layout.item_case_step);
            adapter.setDropDownViewResource(R.layout.item_case_step_edit_select_dropdown);
            spinner.setAdapter(adapter);

            spinner.post(new Runnable() {
                @Override
                public void run() {
                    spinner.setDropDownVerticalOffset(spinner.getHeight());
                }
            });
        }

        public void wrapData(List<CaseStepAdapter.MyDataWrapper> list, String value) {
            String[] result = new String[list.size()];
            int idx = 0;
            for (CaseStepAdapter.MyDataWrapper item : list) {
                result[idx++] = item.currentStep.getOperationMethod().getActionEnum().getDesc();
            }

            // 更新数据
            adapter.clear();
            adapter.addAll(result);
            int select = Integer.parseInt(value) - 1;

            spinner.setSelection(select);
        }
    }



    /**
     * 用例参数Holder
     */
    public static class CaseStepParamHolder extends RecyclerView.ViewHolder implements TextWatcher, View.OnClickListener {
        private TextView title;
        private EditText editText;
        private TextView createParamText;

        private String key;
        private String value;
        private OperationMethod method;

        CaseStepParamHolder(View itemView, OperationMethod method) {
            super(itemView);

            this.method = method;
            title = (TextView) itemView.findViewById(R.id.item_case_step_name);
            editText = (EditText) itemView.findViewById(R.id.item_case_step_edit);
            editText.addTextChangedListener(this);

            createParamText = (TextView) itemView.findViewById(R.id.item_case_step_create_param);
            createParamText.setText(R.string.method_param__set_param);
            createParamText.setOnClickListener(this);
        }

        void bindData(String key, String desc, String value) {
            this.key = key;
            this.value = value;

            editText.setText(value);
            title.setText(desc);
            createParamText.setTag(key);
        }

        @Override
        public void beforeTextChanged(CharSequence s, int start, int count, int after) {

        }

        @Override
        public void onTextChanged(CharSequence s, int start, int before, int count) {

        }

        @Override
        public void afterTextChanged(Editable s) {
            value = s.toString();
            method.putParam(key, value);
        }

        @Override
        public void onClick(View v) {
            final String key = (String) v.getTag();
            DialogUtils.showMultipleEditDialog(v.getContext(), new DialogUtils.OnDialogResultListener() {
                @Override
                public void onDialogPositive(List<String> data) {
                    if (data == null || data.size() != 3) {
                        LogUtil.w(TAG, "");
                        return;
                    }
                    if (StringUtil.isEmpty(data.get(0))) {
                        LogUtil.w(TAG, "Param name is empty" + data);
                    }

                    CaseParamBean paramBean = new CaseParamBean();
                    paramBean.setParamName(data.get(0));
                    paramBean.setParamDesc(data.get(1));
                    paramBean.setParamDefaultValue(data.get(2));
                    InjectorService.g().pushMessage(null, paramBean);

                    value = "${" + data.get(0) + "}";
                    method.putParam(key, value);
                    editText.setText(value);
                }
            }, "配置参数", Arrays.asList(new Pair<>("参数名", ""), new Pair<>("参数描述", ""),
                    new Pair<>("默认值", value)));
        }
    }
}
