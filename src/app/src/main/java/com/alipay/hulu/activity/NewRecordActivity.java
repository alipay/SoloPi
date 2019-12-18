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

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.os.Bundle;
import android.provider.Settings;
import android.support.annotation.Nullable;
import android.support.v4.widget.DrawerLayout;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.R;
import com.alipay.hulu.activity.entry.EntryActivity;
import com.alipay.hulu.adapter.ReplayListAdapter;
import com.alipay.hulu.bean.AdvanceCaseSetting;
import com.alipay.hulu.bean.CaseStepHolder;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.GlideUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.replay.OperationStepProvider;
import com.alipay.hulu.service.CaseRecordManager;
import com.alipay.hulu.service.CaseReplayManager;
import com.alipay.hulu.shared.io.OperationStepService;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.io.db.GreenDaoManager;
import com.alipay.hulu.shared.io.db.OperationLogHandler;
import com.alipay.hulu.shared.io.db.RecordCaseInfoDao;
import com.alipay.hulu.shared.node.action.RunningModeEnum;
import com.alipay.hulu.shared.node.utils.AppUtil;
import com.alipay.hulu.shared.node.utils.PrepareUtil;
import com.alipay.hulu.ui.HeadControlPanel;
import com.alipay.hulu.util.CaseReplayUtil;
import com.alipay.hulu.util.SystemUtil;

import java.util.Arrays;
import java.util.List;

/**
 * Created by lezhou.wyl on 2018/2/1.
 */
@EntryActivity(icon = R.drawable.icon_luxiang, nameRes = R.string.activity__record, permissions = {"adb", "float", "background", "toast:请将SoloPi添加到后台白名单中"}, index = 1, cornerText = "New", cornerPersist = 3, cornerBg = 0xFFFF5900)
public class NewRecordActivity extends BaseActivity {

    private static final String TAG = NewRecordActivity.class.getSimpleName();
    public static final String NEED_REFRESH_PAGE = "NEED_REFRESH_PAGE";

    public static final String NEED_REFRESH_LOCAL_CASES_LIST = "NEED_REFRESH_LOCAL_CASES_LIST";

    private DrawerLayout mDrawerLayout;

    private View mAppListContainer;
    private ListView mAppListView;
    private AppAdapter mAdapter;

    private List<ApplicationInfo> mListPack;
    private ApplicationInfo mCurrentApp;

    private HeadControlPanel mPanel;

    private ImageView mAppIcon;
    private TextView mAppLabel;
    private TextView mAppPkgName;
    private View mSwitchApp;

    private ListView mRecentCaseListView;
    private View mEmptyView;
    private View mCheckAllCasesBtn;
    private ReplayListAdapter mRecentCaseAdapter;

    private EditText mCaseName;
    private EditText mCaseDesc;

    private String app;

    @Subscriber(@Param(SubscribeParamEnum.APP))
    public void setApp(String app) {
        this.app = app;
    }

    @Subscriber(@Param(value = NEED_REFRESH_LOCAL_CASES_LIST, sticky = false))
    public void notifyCaseListChange() {
        if (!isDestroyed()) {
            getRecentCaseList();
        }
    }

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_record_new);
        InjectorService.g().register(this);

        initDrawerLayout();
        initAppList();
        initHeadPanel();
        initAppHeadView();
        initRecentCaseLayout();
        getRecentCaseList();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null && intent.getBooleanExtra(NEED_REFRESH_PAGE, false)) {
            if (mCaseName != null) {
                mCaseName.setText("");
                mCaseName.clearFocus();
            }

            if (mCaseDesc != null) {
                mCaseDesc.setText("");
                mCaseDesc.clearFocus();
            }
        }
        getRecentCaseList();
    }


    private void initRecentCaseLayout() {
        mRecentCaseListView = (ListView) findViewById(R.id.recent_case_list);
        mEmptyView = findViewById(R.id.empty_hint);
        mCheckAllCasesBtn = findViewById(R.id.check_all_cases);
        mRecentCaseAdapter = new ReplayListAdapter(this);
        mRecentCaseAdapter.setOnPlayClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                RecordCaseInfo caseInfo = (RecordCaseInfo) mRecentCaseAdapter.getItem(position);
                playCase(caseInfo);
            }
        });
        mRecentCaseListView.setAdapter(mRecentCaseAdapter);

        mCheckAllCasesBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(NewRecordActivity.this, NewReplayListActivity.class));
            }
        });

        mRecentCaseListView.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                RecordCaseInfo caseInfo = (RecordCaseInfo) mRecentCaseAdapter.getItem(position);
                editCase(caseInfo);
            }
        });


    }

    /**
     * 编辑用例
     * @param caseInfo
     */
    private void editCase(RecordCaseInfo caseInfo) {
        if (caseInfo == null) {
            return;
        }

        caseInfo = caseInfo.clone();

        // 启动编辑页
        Intent intent = new Intent(NewRecordActivity.this, CaseEditActivity.class);
        int storeId = CaseStepHolder.storeCase(caseInfo);
        intent.putExtra(CaseEditActivity.RECORD_CASE_EXTRA, storeId);
        startActivity(intent);
    }

    /**
     * 执行用例
     * @param caseInfo
     */
    private void playCase(final RecordCaseInfo caseInfo) {
        if (caseInfo == null) {
            return;
        }
// 检查权限
        PermissionUtil.requestPermissions(Arrays.asList("adb", Settings.ACTION_ACCESSIBILITY_SETTINGS), NewRecordActivity.this, new PermissionUtil.OnPermissionCallback() {
            @Override
            public void onPermissionResult(boolean result, String reason) {
                if (result) {
                    showProgressDialog(getString(R.string.record__preparing));
                    BackgroundExecutor.execute(new Runnable() {
                        @Override
                        public void run() {
                            boolean prepareResult = PrepareUtil.doPrepareWork(caseInfo.getTargetAppPackage(), new PrepareUtil.PrepareStatus() {
                                @Override
                                public void currentStatus(int progress, int total, String message, boolean status) {
                                    updateProgressDialog(progress, total, message);
                                }
                            });

                            if (prepareResult) {
                                runOnUiThread(new Runnable() {
                                    @Override
                                    public void run() {
                                        dismissProgressDialog();
                                        CaseReplayUtil.startReplay(caseInfo);
                                        startTargetApp(caseInfo.getTargetAppPackage());
                                    }
                                });
                            } else {
                                runOnUiThread(new Runnable() {
                                    @Override
                                    public void run() {
                                        dismissProgressDialog();
                                        toastShort(getString(R.string.record__prepare_env_fail));
                                    }
                                });
                            }
                        }
                    });
                }
            }
        });

    }

    private void initHeadPanel() {
        mPanel = (HeadControlPanel) findViewById(R.id.head_layout);
        mPanel.setMiddleTitle(getString(R.string.activity__record));
        mPanel.setBackIconClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });
    }

    private void initDrawerLayout() {
        mDrawerLayout = (DrawerLayout) findViewById(R.id.drawer_layout);
        mDrawerLayout.setDrawerLockMode(DrawerLayout.LOCK_MODE_LOCKED_CLOSED);
        mAppListContainer = findViewById(R.id.app_list_container);
    }


    private void getRecentCaseList() {
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                final List<RecordCaseInfo> cases = GreenDaoManager.getInstance().getRecordCaseInfoDao().queryBuilder()
                        .orderDesc(RecordCaseInfoDao.Properties.GmtCreate)
                        .limit(5)
                        .build().list();

                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (cases == null || cases.size() <= 0) {
                            mRecentCaseListView.setVisibility(View.GONE);
                            mEmptyView.setVisibility(View.VISIBLE);
                        } else {
                            mRecentCaseListView.setVisibility(View.VISIBLE);
                            mEmptyView.setVisibility(View.GONE);
                            mRecentCaseAdapter.updateData(cases);
                        }
                    }
                });
            }
        });
    }

    private void initAppList() {
        mAppListView = (ListView) findViewById(R.id.app_list);

        mAppListView.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                mDrawerLayout.closeDrawer(mAppListContainer);

                mCurrentApp = (ApplicationInfo) mAdapter.getItem(position);

                ((MyApplication)getApplication()).updateAppAndName(mCurrentApp.packageName, mCurrentApp.loadLabel(getPackageManager()).toString());
                updateHeadView();
            }
        });

        mSwitchApp = findViewById(R.id.switch_app);
        mSwitchApp.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                mDrawerLayout.openDrawer(mAppListContainer);
            }
        });

        mListPack = MyApplication.getInstance().loadAppList();

        int position = 0;
        if (!StringUtil.isEmpty(app)) {
            for (int i = 0; i < mListPack.size(); i++) {
                if (StringUtil.equals(mListPack.get(i).packageName, app)) {
                    position = i;
                    break;
                }
            }
        }

        mAdapter = new AppAdapter();
        mAppListView.setAdapter(mAdapter);

        mCurrentApp = mListPack.get(position);
        updateHeadView();
    }


    private void initAppHeadView() {
        mCaseName = (EditText) findViewById(R.id.case_name);
        mCaseDesc = (EditText) findViewById(R.id.case_desc);

        int position = 0;
        if (!StringUtil.isEmpty(app)) {
            for (int i = 0; i < mListPack.size(); i++) {
                if (StringUtil.equals(mListPack.get(i).packageName, app)) {
                    position = i;
                    break;
                }
            }
        }
        mCurrentApp = mListPack.get(position);

        updateHeadView();

        Button startRecord = (Button) findViewById(R.id.start_record);
        startRecord.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (StringUtil.isEmpty(mCaseName.getText().toString().trim())) {
                    toastShort(R.string.record__case_name_empty);
                    return;
                }

                if (mCurrentApp == null) {
                    return;
                }

                PackageInfo packageInfo = ContextUtil.getPackageInfoByName(
                        NewRecordActivity.this, mCurrentApp.packageName);
                if (packageInfo == null) {
                    return;
                }

                AdvanceCaseSetting setting = new AdvanceCaseSetting();

                RunningModeEnum currentRunningMode = RunningModeEnum.ACCESSIBILITY_MODE;
                setting.setDescriptorMode(currentRunningMode.getCode());
                setting.setVersion(SystemUtil.getAppVersionCode());

                final RecordCaseInfo caseInfo = new RecordCaseInfo();
                caseInfo.setCaseName(mCaseName.getText().toString().trim());
                caseInfo.setCaseDesc(mCaseDesc.getText().toString().trim());
                caseInfo.setTargetAppPackage(packageInfo.packageName);
                caseInfo.setTargetAppLabel(mCurrentApp.loadLabel(getPackageManager()).toString());
                caseInfo.setRecordMode("local");
                caseInfo.setAdvanceSettings(JSON.toJSONString(setting));

                // 检查权限
                PermissionUtil.requestPermissions(Arrays.asList("adb", Settings.ACTION_ACCESSIBILITY_SETTINGS), NewRecordActivity.this, new PermissionUtil.OnPermissionCallback() {
                    @Override
                    public void onPermissionResult(boolean result, String reason) {
                        if (result) {
                            showProgressDialog(getString(R.string.record__preparing));

                            BackgroundExecutor.execute(new Runnable() {
                                @Override
                                public void run() {
                                    boolean prepareResult = PrepareUtil.doPrepareWork(caseInfo.getTargetAppPackage(), new PrepareUtil.PrepareStatus() {
                                        @Override
                                        public void currentStatus(int progress, int total, String message, boolean status) {
                                            updateProgressDialog(progress, total, message);
                                        }
                                    });

                                    if (prepareResult) {
                                        runOnUiThread(new Runnable() {
                                            @Override
                                            public void run() {
                                                dismissProgressDialog();

                                                LauncherApplication.service(OperationStepService.class).registerStepProcessor(new OperationLogHandler());

                                                startRecord(caseInfo);
                                                startTargetApp(caseInfo.getTargetAppPackage());
                                            }
                                        });
                                    } else {
                                        runOnUiThread(new Runnable() {
                                            @Override
                                            public void run() {
                                                dismissProgressDialog();
                                                toastShort(R.string.record__prepare_failed);
                                            }
                                        });
                                    }
                                }
                            });
                        }
                    }
                });
            }
        });

    }

    private void updateHeadView() {
        mAppIcon = (ImageView) findViewById(R.id.test_app_icon);
        mAppIcon.setImageDrawable(mCurrentApp.loadIcon(getPackageManager()));
        mAppLabel = (TextView) findViewById(R.id.test_app_label);
        mAppLabel.setText(mCurrentApp.loadLabel(getPackageManager()));
        mAppPkgName = (TextView) findViewById(R.id.test_app_pkg_name);
        mAppPkgName.setText(mCurrentApp.packageName);
    }

    private class AppAdapter extends BaseAdapter {

        @Override
        public int getCount() {
            return mListPack.size();
        }

        @Override
        public Object getItem(int position) {
            return mListPack.get(position);
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            ViewHolder holder;
            if (convertView == null) {
                convertView = LayoutInflater.from(NewRecordActivity.this).inflate(R.layout.item_app_list, parent, false);
                holder = new ViewHolder();
                holder.icon = (ImageView) convertView.findViewById(R.id.app_icon);
                holder.name = (TextView) convertView.findViewById(R.id.app_name);
                convertView.setTag(holder);
            } else {
                holder = (ViewHolder) convertView.getTag();
            }

            ApplicationInfo info = (ApplicationInfo) getItem(position);
            GlideUtil.loadIcon(NewRecordActivity.this, info.packageName, holder.icon);
            holder.name.setText(info.loadLabel(getPackageManager()));
            return convertView;
        }

        class ViewHolder {
            ImageView icon;
            TextView name;
        }

    }

    private void startRecord(RecordCaseInfo caseInfo) {
        CaseRecordManager manager = LauncherApplication.getInstance().findServiceByName(CaseRecordManager.class.getName());
        manager.setRecordCase(caseInfo);
    }

    private void startReplay(RecordCaseInfo caseInfo) {
        CaseReplayManager manager = LauncherApplication.getInstance().findServiceByName(CaseReplayManager.class.getName());
        OperationStepProvider stepProvider = new OperationStepProvider(caseInfo);
        MyApplication.getInstance().updateAppAndNameTemp(caseInfo.getTargetAppPackage(), caseInfo.getTargetAppLabel());

        manager.start(stepProvider, MyApplication.SINGLE_REPLAY_LISTENER);
    }

    /**
     * 关闭后重启应用
     *
     * @param packageName
     */
    private void startTargetApp(final String packageName) {
        PackageInfo pkgInfo = ContextUtil.getPackageInfoByName(
                NewRecordActivity.this, packageName);
        if (pkgInfo == null) {
            return;
        }

        //先强制关闭后开启
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                AppUtil.forceStopApp(packageName);

                LogUtil.w(TAG, "强制终止应用");
                MiscUtil.sleep(500);
                AppUtil.startApp(packageName);
            }
        });
        return;
    }

    @Override
    public void onBackPressed() {
        if (mDrawerLayout.isDrawerOpen(mAppListContainer)) {
            mDrawerLayout.closeDrawer(mAppListContainer);
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        InjectorService.g().unregister(this);
    }

    @Override
    protected void onStart() {
        super.onStart();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (resultCode == RESULT_OK) {
            startActivity(new Intent(NewRecordActivity.this, NewReplayListActivity.class));
        }
    }

}




