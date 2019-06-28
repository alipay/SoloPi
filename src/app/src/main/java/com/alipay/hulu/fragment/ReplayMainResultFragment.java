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
import android.support.v4.app.Fragment;
import android.support.v7.widget.LinearLayoutManager;
import android.support.v7.widget.RecyclerView;
import android.util.Pair;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.common.utils.DeviceInfoUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;
import com.alipay.hulu.ui.RecycleViewDivider;

import java.util.ArrayList;
import java.util.List;


public class ReplayMainResultFragment extends Fragment {
    public static final String RESULT_BEAN_TAG = "resultBean";

    private ReplayResultBean resultBean;

    private List<Pair<String, String>> contents = null;

    private RecyclerView recyclerView;

    public static ReplayMainResultFragment newInstance(ReplayResultBean data) {
        ReplayMainResultFragment fragment = new ReplayMainResultFragment();
        Bundle args = new Bundle();
        args.putParcelable(RESULT_BEAN_TAG, data);
        fragment.setArguments(args);
        return fragment;
    }

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Bundle bundle = getArguments();
        if (bundle == null) {
            return;
        }

        resultBean = bundle.getParcelable(RESULT_BEAN_TAG);
        wrapDisplayData();
    }

    /**
     * 加载显示项
     */
    private void wrapDisplayData() {
        if (contents != null) {
            contents.clear();
        }

        contents = new ArrayList<>();

        contents.add(new Pair<>("设备信息", DeviceInfoUtil.generateDeviceInfo().toString()));

        List<OperationStep> operations = resultBean.getCurrentOperationLog();

        // 拼接流程信息
        StringBuilder operationString = new StringBuilder("总步骤数:").append(operations.size()).append("\n\n");
        for (int i = 0; i < operations.size(); i++) {
            OperationStep currentOperation = operations.get(i);
            operationString.append(i + 1).append(" ").append(currentOperation.getOperationMethod().getActionEnum().getDesc());

            // 如果有操作节点，记录相关信息
            if (currentOperation.getOperationNode() != null) {
                String className = currentOperation.getOperationNode().getClassName();
                if (!StringUtil.isEmpty(className)) {
                    int lastPointPos = className.lastIndexOf('.');
                    operationString.append(" ").append(className.substring(lastPointPos + 1));
                }

                String resourceId = currentOperation.getOperationNode().getResourceId();
                if (!StringUtil.isEmpty(resourceId)) {
                    int lastColonPost = resourceId.lastIndexOf(':');
                    operationString.append('[').append(resourceId.substring(lastColonPost + 1)).append(']');
                }
            }

            operationString.append("\n");
        }

        contents.add(new Pair<>("用例流程", operationString.toString()));

        // 如果回访失败，显示故障相关信息
        if (!StringUtil.isEmpty(resultBean.getExceptionMessage())) {
            contents.add(new Pair<>("故障步骤", Integer.toString(resultBean.getExceptionStep() + 1)));

            contents.add(new Pair<>("故障原因", resultBean.getExceptionMessage()));
        }
    }

    @Nullable
    @Override
    public View onCreateView(LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_replay_result_main, container, false);

    }

    @Override
    public void onViewCreated(View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        initViewUI(view);

        initViewData(view);
    }

    private void initViewUI(View v) {
        recyclerView = (RecyclerView) v.findViewById(R.id.recycler_view_result_main);
    }

    private void initViewData(View v) {
        recyclerView.setLayoutManager(new LinearLayoutManager(this.getActivity()));
        recyclerView.setAdapter(new RecyclerView.Adapter<ResultItemViewHolder>() {
            private LayoutInflater mInflater = LayoutInflater.from(ReplayMainResultFragment.this.getActivity());
            @Override
            public ResultItemViewHolder onCreateViewHolder(ViewGroup parent, int viewType) {
                return new ResultItemViewHolder(mInflater.inflate(R.layout.item_case_result, parent, false));
            }

            @Override
            public void onBindViewHolder(ResultItemViewHolder holder, int position) {
                Pair<String, String> data = contents.get(position);
                holder.bindData(data.first, data.second);
            }

            @Override
            public int getItemCount() {
                return contents == null? 0: contents.size();
            }
        });

        recyclerView.addItemDecoration(new RecycleViewDivider(getActivity(),
                LinearLayoutManager.HORIZONTAL, 1, getResources().getColor(R.color.divider_color)));
    }

    private static class ResultItemViewHolder extends RecyclerView.ViewHolder {
        TextView mTitle;
        TextView mContent;

        ResultItemViewHolder(View v) {
            super(v);
            mTitle = (TextView) v.findViewById(R.id.text_case_result_item_title);
            mContent = (TextView) v.findViewById(R.id.text_case_result_item_content);
        }

        void bindData(String title, String content) {
            mTitle.setText(title);
            mContent.setText(content);
        }
    }
}
