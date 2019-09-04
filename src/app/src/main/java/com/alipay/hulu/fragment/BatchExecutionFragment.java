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
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import com.alipay.hulu.R;
import com.alipay.hulu.activity.BatchExecutionActivity;
import com.alipay.hulu.adapter.BatchExecutionListAdapter;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.replay.BatchStepProvider;
import com.alipay.hulu.service.CaseReplayManager;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.io.db.GreenDaoManager;
import com.alipay.hulu.shared.io.db.RecordCaseInfoDao;

import java.util.List;

/**
 * Created by lezhou.wyl on 2018/8/19.
 */

public class BatchExecutionFragment extends BaseFragment {
    private static final String TAG = "BatchExeFrag";
    private static final String KEY_ARG_FRAGMENT_TYPE = "KEY_ARG_FRAGMENT_TYPE";

    public static final int KEY_LIST_TYPE_LOCAL = 0;

    private ListView mListView;
    private View mEmptyView;
    private TextView mEmptyTextView;
    private BatchExecutionListAdapter mAdapter;
    private View mContentContainer;

    public static int[] getTypes() {
        return new int[] {KEY_LIST_TYPE_LOCAL};
    }

    public static String getTypeName(int type) {
        return "本地";
    }

    public static BatchExecutionFragment newInstance(int type) {
        BatchExecutionFragment fragment = new BatchExecutionFragment();
        Bundle args = new Bundle();
        args.putInt(KEY_ARG_FRAGMENT_TYPE, type);
        fragment.setArguments(args);
        return fragment;
    }

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    @Nullable
    @Override
    public View onCreateView(LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_batch_execution_list, container, false);
    }

    @Override
    public void onViewCreated(View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        initEmptyView(view);
        initListView(view);
        initOtherView(view);

        getReplayRecordsFromDB();
    }

    private void initOtherView(View view) {
        mContentContainer = view.findViewById(R.id.content_container);

    }

    private void getReplayRecordsFromDB() {
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                final List<RecordCaseInfo> mCases = GreenDaoManager.getInstance().getRecordCaseInfoDao()
                        .queryBuilder().orderDesc(RecordCaseInfoDao.Properties.GmtCreate).list();
                if (mCases != null && mCases.size() > 0) {
                    for (RecordCaseInfo caseInfo : mCases) {
                        caseInfo.setSelected(false);
                    }
                }

                getActivity().runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (mCases != null && mCases.size() > 0) {
                            mAdapter.updateData(mCases);
                            mContentContainer.setVisibility(View.VISIBLE);
                            mEmptyView.setVisibility(View.GONE);
                        } else {
                            mContentContainer.setVisibility(View.GONE);
                            mEmptyView.setVisibility(View.VISIBLE);
                        }
                    }
                });
            }
        });
    }

    private void initListView(View view) {
        mListView = (ListView) view.findViewById(R.id.replay_list);
        mAdapter = new BatchExecutionListAdapter(getContext());

        mListView.setAdapter(mAdapter);
        mAdapter.setDelegate((BatchExecutionActivity) getActivity());
    }

    private void initEmptyView(View view) {
        mEmptyView = view.findViewById(R.id.empty_view_container);
        mEmptyTextView = (TextView) view.findViewById(R.id.empty_text);
        mEmptyTextView.setText(R.string.batch__no_case);
    }

    private void showEnableAccessibilityServiceHint() {
        Toast.makeText(getContext(), "请在辅助功能中开启Soloπ", Toast.LENGTH_LONG).show();
    }
}
