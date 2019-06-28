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
import android.provider.Settings;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.CompoundButton;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import com.alipay.hulu.R;
import com.alipay.hulu.activity.BaseActivity;
import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.adapter.BatchExecutionListAdapter;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.replay.BatchStepProvider;
import com.alipay.hulu.service.CaseReplayManager;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.io.db.GreenDaoManager;
import com.alipay.hulu.shared.io.db.RecordCaseInfoDao;

import java.util.Arrays;
import java.util.List;

/**
 * Created by lezhou.wyl on 2018/8/19.
 */

public class BatchExecutionFragment extends Fragment implements CompoundButton.OnCheckedChangeListener
        , BatchExecutionListAdapter.Delegate{
    private static final String TAG = "BatchExeFrag";
    private static final String KEY_ARG_FRAGMENT_TYPE = "KEY_ARG_FRAGMENT_TYPE";

    public static final int KEY_LIST_TYPE_LOCAL = 0;

    private ListView mListView;
    private View mEmptyView;
    private TextView mEmptyTextView;
    private BatchExecutionListAdapter mAdapter;
    private CheckBox mSelectAllCheckbox;
    private Button mConfirmBtn;
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
        mSelectAllCheckbox = (CheckBox) view.findViewById(R.id.select_all_checkbox);
        mConfirmBtn = (Button) view.findViewById(R.id.confirm_btn);

        mSelectAllCheckbox.setOnCheckedChangeListener(this);

        mConfirmBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                final List<RecordCaseInfo> recordCases = mAdapter.getCurrentSelectedCases();
                if (recordCases.size() == 0) {
                    ((BaseActivity)(getActivity())).toastShort("请选择用例");
                    return;
                }

                PermissionUtil.OnPermissionCallback callback = new PermissionUtil.OnPermissionCallback() {
                    @Override
                    public void onPermissionResult(boolean result, String reason) {
                        if (result) {
                            BatchStepProvider provider = new BatchStepProvider(recordCases);
                            CaseReplayManager manager = LauncherApplication.getInstance().findServiceByName(CaseReplayManager.class.getName());
                            manager.start(provider, MyApplication.MULTI_REPLAY_LISTENER);
                        }
                    }
                };
                checkPermissions(callback);
            }
        });
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
        mAdapter.setDelegate(this);
    }

    private void initEmptyView(View view) {
        mEmptyView = view.findViewById(R.id.empty_view_container);
        mEmptyTextView = (TextView) view.findViewById(R.id.empty_text);
        mEmptyTextView.setText("没有发现用例");
    }

    private void showEnableAccessibilityServiceHint() {
        Toast.makeText(getContext(), "请在辅助功能中开启Soloπ", Toast.LENGTH_LONG).show();
    }

    private void checkPermissions(PermissionUtil.OnPermissionCallback callback) {
        // 高权限，悬浮窗权限判断
        PermissionUtil.requestPermissions(Arrays.asList("adb", Settings.ACTION_ACCESSIBILITY_SETTINGS), getActivity(), callback);
    }

    @Override
    public void onCheckedChanged(CompoundButton buttonView, boolean isChecked) {
        mAdapter.onSelectAllClick(mSelectAllCheckbox.isChecked());
    }

    @Override
    public void onItemChecked(boolean isAllSelected) {
        mSelectAllCheckbox.setOnCheckedChangeListener(null);
        mSelectAllCheckbox.setChecked(mAdapter.isAllSelected());
        mSelectAllCheckbox.setOnCheckedChangeListener(this);
    }
}
