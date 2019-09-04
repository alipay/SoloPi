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
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.RelativeLayout;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;

import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/**
 * Created by lezhou.wyl on 2018/1/30.
 */

public class ReplayListAdapter extends BaseAdapter implements View.OnClickListener {

    private Context mContext;
    private List<RecordCaseInfo> mData = new ArrayList<>();
    private static Date sDate = new Date();

    private AdapterView.OnItemClickListener onItemClickListener;

    public ReplayListAdapter(Context context) {
        mContext = context;
    }

    public void updateData(List<RecordCaseInfo> data) {
        if (data == null) {
            return;
        }

        mData = data;
        notifyDataSetChanged();
    }

    @Override
    public int getCount() {
        return mData.size();
    }

    @Override
    public Object getItem(int position) {
        return mData.get(position);
    }

    @Override
    public long getItemId(int position) {
        return position;
    }

    @Override
    public View getView(int position, View convertView, ViewGroup parent) {
        ViewHolder holder;
        if (convertView == null) {
            convertView = LayoutInflater.from(mContext).inflate(R.layout.item_replay_list, parent, false);
            holder = new ViewHolder();
            holder.caseName = (TextView) convertView.findViewById(R.id.case_name);
            holder.caseDesc = (TextView) convertView.findViewById(R.id.case_desc);
            holder.createTime = (TextView) convertView.findViewById(R.id.create_time);
            holder.play = (RelativeLayout) convertView.findViewById(R.id.case_play);
            holder.play.setOnClickListener(this);
            convertView.setTag(holder);
        } else {
            holder = (ViewHolder) convertView.getTag();
        }

        RecordCaseInfo recordCaseInfo = (RecordCaseInfo) getItem(position);
        if (recordCaseInfo != null) {
            holder.caseName.setText(recordCaseInfo.getCaseName());
            sDate.setTime(recordCaseInfo.getGmtCreate());
            holder.createTime.setText(DateFormat.getDateTimeInstance().format(sDate));
            String caseDesc = recordCaseInfo.getCaseDesc();
            if (StringUtil.isEmpty(caseDesc)) {
                holder.caseDesc.setText(R.string.replay_list__no_desc);
            } else {
                holder.caseDesc.setText(recordCaseInfo.getCaseDesc());
            }
            holder.play.setTag(position);
        }
        return convertView;
    }

    @Override
    public void onClick(View v) {
        // 触发外部的listener
        if (onItemClickListener != null) {
            int position = (int) v.getTag();
            onItemClickListener.onItemClick(null, v, position, position);
        }
    }

    public void deleteCase(RecordCaseInfo caseInfo) {
        if (mData != null) {
            mData.remove(caseInfo);
            notifyDataSetChanged();
        }
    }

    public void deleteCaseById(long id) {
        if (mData != null) {
            boolean found = false;
            for (int i = 0; i < mData.size(); i++) {
                if (mData.get(i).getId() == id) {
                    mData.remove(i);
                    found = true;
                    break;
                }
            }
            if (found) {
                notifyDataSetChanged();
            }
        }
    }

    public void setOnPlayClickListener(AdapterView.OnItemClickListener onItemClickListener) {
        this.onItemClickListener = onItemClickListener;
    }

    static class ViewHolder {
        TextView caseName;
        TextView caseDesc;
        TextView createTime;
        RelativeLayout play;
    }

}
