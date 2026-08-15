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

import android.content.Context;
import android.util.Pair;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.bean.CaseParamBean;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.util.DialogUtils;

import java.util.Arrays;
import java.util.List;

public class ParamListAdapter extends SoloBaseAdapter<CaseParamBean> implements View.OnClickListener {
    private static final String TAG = "ParamListAdapter";

    private Context context;

    public ParamListAdapter(Context context) {
        super(context);
        this.context = context;
    }

    @Override
    public View getView(int position, View convertView, ViewGroup parent) {
        if (convertView == null) {
            convertView = LayoutInflater.from(context).inflate(R.layout.item_case_param, parent, false);
            convertView.setOnClickListener(this);
        }

        convertView.setTag(position);

        TextView title = convertView.findViewById(R.id.param_item_title);
        TextView desc = convertView.findViewById(R.id.param_item_desc);
        TextView defaultValue = convertView.findViewById(R.id.param_item_default_value);

        CaseParamBean param = getItem(position);
        title.setText(param.getParamName());
        desc.setText(param.getParamDesc());
        defaultValue.setText(param.getParamDefaultValue());

        return convertView;
    }

    @Override
    public void onClick(View v) {
        int position = (int) v.getTag();
        final CaseParamBean param = getItem(position);

        DialogUtils.showMultipleEditDialog(context, new DialogUtils.OnDialogResultListener() {
                    @Override
                    public void onDialogPositive(List<String> data) {
                        if (data == null || data.size() != 2) {
                            LogUtil.w(TAG, "Edit param %s failed, not suitable result %s", param, data);
                            return;
                        }

                        param.setParamDesc(data.get(0));
                        param.setParamDefaultValue(data.get(1));

                        notifyDataSetChanged();
                    }
                }, "编辑参数-" + param.getParamName(),
                Arrays.asList(new Pair<>("参数描述", param.getParamDesc()),
                        new Pair<>("默认值", param.getParamDefaultValue())));
    }
}
