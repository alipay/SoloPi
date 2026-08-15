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
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ListView;
import android.widget.TextView;

import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.R;
import com.alipay.hulu.activity.CaseParamEditActivity;
import com.alipay.hulu.bean.AdvanceCaseSetting;
import com.alipay.hulu.bean.CaseParamBean;
import com.alipay.hulu.bean.CaseRunningParam;
import com.alipay.hulu.common.utils.StringUtil;
import com.zhy.view.flowlayout.FlowLayout;
import com.zhy.view.flowlayout.TagAdapter;
import com.zhy.view.flowlayout.TagFlowLayout;

import java.util.ArrayList;
import java.util.List;

/**
 * Created by qiaoruikai on 2019-08-19 22:25.
 */
public class CaseParamUnionFragment extends CaseParamEditActivity.CaseParamFragment {
    private TagFlowLayout tagFlowLayout;
    private ListView paramList;
    private Button addBtn;

    // 用例参数设置
    private List<CaseParamBean> presetParams;
    private CaseRunningParam runningParam;
    private List<JSONObject> storedParams;


    /**
     * 设置高级设置
     *
     * @param advanceCaseSetting
     */
    @Override
    public void setAdvanceCaseSetting(@NonNull AdvanceCaseSetting advanceCaseSetting) {
        storedParams = null;
        presetParams = advanceCaseSetting.getParams();
        if (presetParams == null) {
            presetParams = new ArrayList<>();
        }

        runningParam = advanceCaseSetting.getRunningParam();
        if (runningParam == null) {
            runningParam = new CaseRunningParam();
        }
        if (presetParams == null) {
            presetParams = new ArrayList<>();
        }

        // 如果之前有存储p
        if (runningParam.getMode() == CaseRunningParam.ParamMode.UNION) {
            storedParams = new ArrayList<>(runningParam.getParamList());
        }

        if (storedParams == null) {
            storedParams = new ArrayList<>();
        }
    }

    @Override
    public CaseRunningParam getRunningParam() {
        runningParam.setMode(CaseRunningParam.ParamMode.UNION);
        runningParam.setParamList(storedParams);
        return runningParam;
    }

    @Nullable
    @Override
    public View onCreateView(LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View root = inflater.inflate(R.layout.fragment_union_param, container, false);
        tagFlowLayout = (TagFlowLayout) root.findViewById(R.id.union_param_group);
        paramList = (ListView) root.findViewById(R.id.union_param_list);
        addBtn = (Button) root.findViewById(R.id.union_param_add);

        return root;
    }

    @Override
    public void onActivityCreated(@Nullable Bundle savedInstanceState) {
        super.onActivityCreated(savedInstanceState);

        final LayoutInflater inflater = LayoutInflater.from(getActivity());

        tagFlowLayout.setAdapter(new TagAdapter<JSONObject>(storedParams) {
            @Override
            public View getView(FlowLayout parent, int position, JSONObject o) {
                View root = inflater.inflate(R.layout.item_param_info, parent, false);
                List<String> diffParams = new ArrayList<>();
                for (CaseParamBean paramBean: presetParams) {
                    diffParams.add(o.getString(paramBean.getParamName()));
                }

                TextView title = (TextView) root.findViewById(R.id.batch_execute_tag_name);
                title.setText(StringUtil.join(",", diffParams));
                return root;
            }
        });
        tagFlowLayout.setOnTagClickListener(new TagFlowLayout.OnTagClickListener() {
            @Override
            public boolean onTagClick(View view, int position, FlowLayout parent) {
                storedParams.remove(position);
                tagFlowLayout.getAdapter().notifyDataChanged();
                return true;
            }
        });

        final List<ParamHolder> holders = new ArrayList<>();
        for (CaseParamBean param: presetParams) {
            ParamHolder holder = new ParamHolder();
            holder.param = param;
            holders.add(holder);
        }
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
                EditText edit = (EditText) convertView.findViewById(R.id.item_case_step_edit);

                ParamHolder holder = (ParamHolder) getItem(position);
                CaseParamBean paramBean = holder.param;
                String desc = StringUtil.isEmpty(paramBean.getParamDesc())? paramBean.getParamName(): paramBean.getParamDesc();

                title.setText(desc);
                holder.edit = edit;

                return convertView;
            }
        });

        addBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                JSONObject obj = new JSONObject(holders.size() + 1);
                for (ParamHolder holder : holders) {
                    obj.put(holder.param.getParamName(), holder.edit.getText().toString());
                    holder.edit.setText("");
                }

                storedParams.add(obj);
                ((BaseAdapter)paramList.getAdapter()).notifyDataSetChanged();
                tagFlowLayout.getAdapter().notifyDataChanged();
            }
        });
    }

    private static class ParamHolder {
        private CaseParamBean param;
        private EditText edit;
    }
}
