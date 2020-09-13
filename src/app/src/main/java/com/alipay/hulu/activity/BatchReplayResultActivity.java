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

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import androidx.annotation.Nullable;
import android.text.TextUtils;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.ListView;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.bean.CaseStepHolder;
import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.ui.HeadControlPanel;
import com.alipay.hulu.util.LargeObjectHolder;

import java.util.ArrayList;
import java.util.List;


/**
 * Created by lezhou.wyl on 2018/8/19.
 */

public class BatchReplayResultActivity extends BaseActivity {

    private ListView mResultList;
    private TextView mTotalNum;
    private TextView mSuccessNum;
    private TextView mFailNum;

    private HeadControlPanel mPanel;

    private ResultAdapter mAdapter;
    private List<ReplayResultBean> mResults;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_batch_replay_result);
        initView();
        initListeners();
        initState();
    }

    private void initState() {
        mResults = LargeObjectHolder.getInstance().getReplayResults();
        // 清理引用
        LargeObjectHolder.getInstance().setReplayResults(null);

        if (mResults == null) {
            finish();
            return;
        }

        int totalNum = 0;
        int successNum = 0;
        for (ReplayResultBean bean : mResults) {
            totalNum++;
            if (TextUtils.isEmpty(bean.getExceptionMessage())) {
                successNum++;
            }
        }

        mTotalNum.setText(getString(R.string.batch_replay_result__case_count, totalNum));
        mSuccessNum.setText(getString(R.string.batch_replay_result__success_count, successNum));
        mFailNum.setText(getString(R.string.batch_replay_result__failed_count, totalNum - successNum));

        mAdapter = new ResultAdapter(this, mResults);
        mResultList.setAdapter(mAdapter);
    }

    private void initListeners() {
        mResultList.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                ReplayResultBean bean = (ReplayResultBean) mAdapter.getItem(position);
                if (bean == null) {
                    return;
                }
                // 由holder保存
                Intent intent = new Intent(BatchReplayResultActivity.this, CaseReplayResultActivity.class);
                int resId = CaseStepHolder.storeResult(bean);
                intent.putExtra("data", resId);
                startActivity(intent);
            }
        });
    }

    private void initView() {
        mResultList = (ListView) findViewById(R.id.result_list);
        mTotalNum = (TextView) findViewById(R.id.total_num);
        mSuccessNum = (TextView) findViewById(R.id.success_num);
        mFailNum = (TextView) findViewById(R.id.fail_num);

        mPanel = (HeadControlPanel) findViewById(R.id.head_layout);
        mPanel.setBackIconClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });
        mPanel.setMiddleTitle(getString(R.string.activity__batch_replay_result));
    }

    private static class ResultAdapter extends BaseAdapter {

        private Context mContext;
        private List<ReplayResultBean> mData = new ArrayList<>();

        public ResultAdapter(Context context, List<ReplayResultBean> data) {
            mContext = context;
            mData = data;
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
                convertView = LayoutInflater.from(mContext).inflate(R.layout.item_replay_result, parent, false);

                holder = new ViewHolder();
                holder.caseName = (TextView) convertView.findViewById(R.id.case_name);
                holder.result = (TextView) convertView.findViewById(R.id.result);
                convertView.setTag(holder);
            } else  {
                holder = (ViewHolder) convertView.getTag();
            }

            ReplayResultBean bean = (ReplayResultBean) getItem(position);
            if (bean != null) {
                holder.caseName.setText(bean.getCaseName());
                if (TextUtils.isEmpty(bean.getExceptionMessage())) {
                    holder.result.setText(R.string.constant__success);
                    holder.result.setTextColor(0xff65c0ba);
                } else {
                    holder.result.setText(R.string.constant__fail);
                    holder.result.setTextColor(0xfff76262);
                }
            }
            return convertView;
        }

        class ViewHolder {
            TextView caseName;
            TextView result;
        }
    }



}
