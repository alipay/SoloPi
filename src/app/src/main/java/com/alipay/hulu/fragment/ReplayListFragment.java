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

import android.content.DialogInterface;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.support.annotation.Nullable;
import android.support.v4.widget.SwipeRefreshLayout;
import android.support.v7.app.AlertDialog;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.Pair;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ScrollView;
import android.widget.TextView;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.R;
import com.alipay.hulu.activity.CaseEditActivity;
import com.alipay.hulu.activity.CaseParamEditActivity;
import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.activity.NewRecordActivity;
import com.alipay.hulu.adapter.ReplayListAdapter;
import com.alipay.hulu.bean.AdvanceCaseSetting;
import com.alipay.hulu.bean.CaseParamBean;
import com.alipay.hulu.bean.CaseStepHolder;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.replay.OperationStepProvider;
import com.alipay.hulu.replay.RepeatStepProvider;
import com.alipay.hulu.service.CaseReplayManager;
import com.alipay.hulu.shared.io.bean.GeneralOperationLogBean;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.io.db.GreenDaoManager;
import com.alipay.hulu.shared.io.db.RecordCaseInfoDao;
import com.alipay.hulu.shared.io.util.OperationStepUtil;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.utils.AppUtil;
import com.alipay.hulu.util.CaseReplayUtil;
import com.alipay.hulu.util.DialogUtils;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Created by lezhou.wyl on 2018/7/30.
 */

public class ReplayListFragment extends BaseFragment {
    private static final String TAG = "ReplayListFrag";
    private static final String KEY_ARG_FRAGMENT_TYPE = "KEY_ARG_FRAGMENT_TYPE";

    public static final int KEY_LIST_TYPE_LOCAL = 0;

    private ListView mListView;
    private View mEmptyView;
    private TextView mEmptyTextView;
    private ReplayListAdapter mAdapter;
    private SwipeRefreshLayout refreshLayout;
    private String app;

    public static ReplayListFragment newInstance(int type) {
        return new ReplayListFragment();
    }

    public static int[] getAvailableTypes() {
        return new int[] { KEY_LIST_TYPE_LOCAL };
    }

    public static String getTypeName(int type) {
        return StringUtil.getString(R.string.replay_list__local);
    }

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        InjectorService.g().register(this);
    }

    @Subscriber(@Param(SubscribeParamEnum.APP))
    public void setApp(String app) {
        this.app = app;
    }

    @Nullable
    @Override
    public View onCreateView(LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_replay_list, container, false);
    }

    @Override
    public void onViewCreated(View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        initEmptyView(view);
        initListView(view);

        getReplayRecordsFromDB(null);
    }

    /**
     * 重载下用例
     */
    @Subscriber(value = @Param(value = NewRecordActivity.NEED_REFRESH_LOCAL_CASES_LIST, sticky = false))
    public void reloadLocalCases() {
        getReplayRecordsFromDB(null);
    }

    private void getReplayRecordsFromDB(final Runnable r) {
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                final List<RecordCaseInfo> mCases = GreenDaoManager.getInstance().getRecordCaseInfoDao()
                        .queryBuilder().orderDesc(RecordCaseInfoDao.Properties.GmtCreate).list();

                getActivity().runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (r != null) {
                            r.run();
                        }
                        if (mCases != null && mCases.size() > 0) {
                            mAdapter.updateData(mCases);
                            mListView.setVisibility(View.VISIBLE);
                            mEmptyView.setVisibility(View.GONE);
                        } else {
                            mListView.setVisibility(View.GONE);
                            mEmptyView.setVisibility(View.VISIBLE);
                        }
                    }
                });
            }
        });
    }

    private void initListView(View view) {
        refreshLayout = (SwipeRefreshLayout) view.findViewById(R.id.replay_swipe_refresh);
        refreshLayout.setOnRefreshListener(new SwipeRefreshLayout.OnRefreshListener() {
            @Override
            public void onRefresh() {
                Runnable r = new Runnable() {
                    @Override
                    public void run() {
                        refreshLayout.setRefreshing(false);
                    }
                };

                // 读取用例
                getReplayRecordsFromDB(r);
            }
        });

        mListView = (ListView) view.findViewById(R.id.replay_list);
        mAdapter = new ReplayListAdapter(getContext());

        mListView.setAdapter(mAdapter);

        // 设置播放按键监听器
        mAdapter.setOnPlayClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                final RecordCaseInfo caseInfo = (RecordCaseInfo) mAdapter.getItem(position);
                if (caseInfo == null) {
                    return;
                }

                PermissionUtil.requestPermissions(Arrays.asList("adb", Settings.ACTION_ACCESSIBILITY_SETTINGS), getActivity(), new PermissionUtil.OnPermissionCallback() {
                    @Override
                    public void onPermissionResult(final boolean result, String reason) {
                        if (result) {
                            CaseReplayUtil.startReplay(caseInfo);
                            startTargetApp(caseInfo.getTargetAppPackage());
                        }
                    }
                });
            }
        });

        // 默认点击编辑
        mListView.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                editCase(position);
            }
        });

        mListView.setOnItemLongClickListener(new AdapterView.OnItemLongClickListener() {
            @Override
            public boolean onItemLongClick(AdapterView<?> parent, View view, final int position, long id) {
                // 用例操作模式
                List<PerformActionEnum> actions = PerformActionEnum.getActionsByCatagory(PerformActionEnum.CATEGORY_CASE_OPERATION);
                DialogUtils.showFunctionView(getActivity(), actions, new DialogUtils.FunctionViewCallback<PerformActionEnum>() {
                    @Override
                    public void onExecute(DialogInterface dialog, PerformActionEnum action) {
                        switch (action) {
                            case DELETE_CASE:
                                deleteCase(position);
                                break;
                            case EXPORT_CASE:
                                exportCase(position);
                                break;
                            case PLAY_MULTI_TIMES:
                                repeatPrepare(position);
                                break;
                            case GEN_MULTI_PARAM:
                                genMultiParams(position);
                                break;
                        }
                    }

                    @Override
                    public void onCancel(DialogInterface dialog) {

                    }

                    @Override
                    public void onDismiss(DialogInterface dialog) {

                    }
                });

                return true;
            }
        });
    }

    /**
     * 编辑用例描述信息
     * @param position
     */
    private void editCase(int position) {
        RecordCaseInfo caseInfo = (RecordCaseInfo) mAdapter.getItem(position);
        if (caseInfo == null) {
            return;
        }
        caseInfo = caseInfo.clone();
        // 启动编辑页
        Intent intent = new Intent(getActivity(), CaseEditActivity.class);
        int caseId = CaseStepHolder.storeCase(caseInfo);
        intent.putExtra(CaseEditActivity.RECORD_CASE_EXTRA, caseId);
        startActivity(intent);
    }

    private void genMultiParams(final int position) {
        RecordCaseInfo caseInfo = (RecordCaseInfo) mAdapter.getItem(position);
        if (caseInfo == null) {
            return;
        }
        caseInfo = caseInfo.clone();

        Intent intent = new Intent(getActivity(), CaseParamEditActivity.class);
        int caseId = CaseStepHolder.storeCase(caseInfo);
        intent.putExtra(CaseParamEditActivity.RECORD_CASE_EXTRA, caseId);
        startActivity(intent);
    }

    /**
     * 删除用例
     * @param position
     */
    private void deleteCase(final int position) {
        AlertDialog dialog = new AlertDialog.Builder(getContext(), R.style.SimpleDialogTheme)
                .setCancelable(false)
                .setMessage(R.string.replay__delete_case)
                .setPositiveButton(R.string.constant__confirm, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(final DialogInterface dialog, int which) {
                        final RecordCaseInfo recordCaseInfo = (RecordCaseInfo) mAdapter.getItem(position);
                        if (recordCaseInfo == null) {
                            return;
                        }

                        // delete step file
                        BackgroundExecutor.execute(new Runnable() {
                            @Override
                            public void run() {
                                String operationLog = recordCaseInfo.getOperationLog();
                                if (!StringUtil.isEmpty(operationLog)) {
                                    GeneralOperationLogBean logBean = JSON.parseObject(operationLog, GeneralOperationLogBean.class);
                                    if (logBean != null && !StringUtil.isEmpty(logBean.getStorePath())) {
                                        File steps = new File(logBean.getStorePath());
                                        if (steps.exists()) {
                                            FileUtils.deleteFile(steps);
                                        }
                                    }
                                }
                                GreenDaoManager.getInstance().getRecordCaseInfoDao().deleteByKey(recordCaseInfo.getId());
                                InjectorService.g().pushMessage(NewRecordActivity.NEED_REFRESH_LOCAL_CASES_LIST);

                                dialog.dismiss();
                            }
                        });

                    }
                }).setNegativeButton(R.string.constant__cancel, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        dialog.dismiss();
                    }
                })
                .create();
        dialog.show();
    }

    /**
     * 导出用例
     * @param position
     */
    private void exportCase(int position) {
        final RecordCaseInfo caseInfo = (RecordCaseInfo) mAdapter.getItem(position);
        if (caseInfo == null) {
            return;
        }
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                // 读取实际用例信息
                String operationLog = caseInfo.getOperationLog();
                GeneralOperationLogBean logBean = JSON.parseObject(operationLog, GeneralOperationLogBean.class);
                OperationStepUtil.afterLoad(logBean);
                logBean.setStorePath(null);
                caseInfo.setOperationLog(JSON.toJSONString(logBean));

                String content = JSON.toJSONString(caseInfo);

                // 导出文件
                File targetFile = new File(FileUtils.getSubDir("export"), caseInfo.getCaseName() + "-" + caseInfo.getGmtCreate() + ".json");
                try {
                    BufferedWriter writer = new BufferedWriter(new FileWriter(targetFile));
                    writer.write(content);
                    writer.flush();
                    writer.close();

                    // 显示提示窗
                    MyApplication.getInstance().showDialog(getActivity(), "文件已导出到 " + targetFile.getAbsolutePath(), "确定", null);
                } catch (IOException e) {
                    LogUtil.e(TAG, "Catch java.io.IOException: " + e.getMessage(), e);

                    MyApplication.getInstance().showDialog(getActivity(), "文件导出失败", "确定", null);
                }
            }
        });
    }

    /**
     * 重复次数
     */
    protected void repeatPrepare(final int position) {
         View v = LayoutInflater.from(ContextUtil.getContextThemeWrapper(getActivity(), R.style.AppDialogTheme)).inflate(R.layout.dialog_repeat_count, null);
        final EditText edit = (EditText) v.findViewById(R.id.dialog_repeat_edit);
        final CheckBox restart = (CheckBox) v.findViewById(R.id.dialog_repeat_restart);
        final Pattern textPattern;
        textPattern = Pattern.compile("\\d{1,3}");

        final AlertDialog dialog = new AlertDialog.Builder(getActivity(), R.style.AppDialogTheme)
                .setTitle(R.string.replay__set_replay_count)
                .setView(v)
                .setPositiveButton(R.string.constant__start_execution, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        LogUtil.i(TAG, "Positive " + which);
                        String data = edit.getText().toString();
                        int repeatCount = Integer.parseInt(data);

                        // 隐藏Dialog
                        dialog.dismiss();

                       playMultiTimeCase(position, repeatCount, restart.isChecked());
                    }
                }).create();

        dialog.setCanceledOnTouchOutside(false);                                   //点击外面区域不会让dialog消失
        dialog.setCancelable(false);
        dialog.show();

        // 校验输入
        edit.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {

            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {

            }

            @Override
            public void afterTextChanged(Editable s) {
                Button positiveButton = dialog.getButton(DialogInterface.BUTTON_POSITIVE);
                boolean enable = true;
                if (textPattern != null) {
                    String content = s.toString();
                    enable = textPattern.matcher(content).matches();
                }

                // 如果不是目标状态，改变下
                if (positiveButton.isEnabled() != enable) {
                    positiveButton.setEnabled(enable);
                }
            }
        });

    }

    /**
     * 重复执行
     * @param position
     * @param count
     * @param prepare
     */
    private void playMultiTimeCase(final int position, final int count, final boolean prepare) {
        final RecordCaseInfo caseInfo = (RecordCaseInfo) mAdapter.getItem(position);
        if (caseInfo == null) {
            return;
        }

        PermissionUtil.requestPermissions(Arrays.asList("adb", Settings.ACTION_ACCESSIBILITY_SETTINGS), getActivity(), new PermissionUtil.OnPermissionCallback() {
            @Override
            public void onPermissionResult(final boolean result, String reason) {
                if (result) {
                    CaseReplayUtil.startReplayMultiTimes(caseInfo, count, prepare);
                    startTargetApp(caseInfo.getTargetAppPackage());
                }
            }
        });
    }

    private void initEmptyView(View view) {
        mEmptyView = view.findViewById(R.id.empty_view_container);
        mEmptyTextView = (TextView) view.findViewById(R.id.empty_text);
        mEmptyTextView.setText(R.string.record__no_local_case);
    }

    /**
     * 重启应用
     * @param packageName
     */
    private void startTargetApp(final String packageName) {
        if (packageName == null) {
            return;
        }

        //先强制关闭后启动
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                AppUtil.forceStopApp(packageName);

                LogUtil.w(TAG, "强制终止");
                MiscUtil.sleep(500);
                AppUtil.startApp(packageName);
            }
        });
    }

    @Override
    public void onDestroy() {
        InjectorService.g().unregister(this);
        super.onDestroy();
    }
}
