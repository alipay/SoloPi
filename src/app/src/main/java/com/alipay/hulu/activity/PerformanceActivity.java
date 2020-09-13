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
import android.database.DataSetObserver;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import androidx.annotation.Nullable;
import androidx.appcompat.widget.AppCompatSpinner;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.SpinnerAdapter;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.activity.entry.EntryActivity;
import com.alipay.hulu.adapter.PerformFloatAdapter;
import com.alipay.hulu.adapter.PerformStressAdapter;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.GlideUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.common.utils.patch.PatchLoadResult;
import com.alipay.hulu.screenRecord.RecorderConfigActivity;
import com.alipay.hulu.screenRecord.VideoAnalyzer;
import com.alipay.hulu.shared.node.utils.AssetsManager;
import com.alipay.hulu.shared.node.utils.PrepareUtil;
import com.alipay.hulu.ui.HeadControlPanel;

import java.util.List;

/**
 * Created by lezhou.wyl on 2018/1/28.
 */
@EntryActivity(iconName = "com.alipay.hulu.R$drawable.icon_xingneng", nameResName = "com.alipay.hulu.R$string.activity__performance_test", permissions = {"adb", "float", "background"}, index = 2)
public class PerformanceActivity extends BaseActivity {
    private String TAG = "PerformanceFragment";

    private ListView mFloatListView;
    private ListView mStressListView;
    private PerformFloatAdapter mPerfFloatAdapter;
    private PerformStressAdapter mPerfStressAdapter;

    private HeadControlPanel mPanel;

    /**
     * 目标应用包名
     */
    private String app;

    @Subscriber(@Param(SubscribeParamEnum.APP))
    public void setApp(String app) {
        this.app = app;
    }


    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        InjectorService injectorService = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
        injectorService.register(this);

        setContentView(R.layout.activity_performance);

        mPerfFloatAdapter = new PerformFloatAdapter(this);
        mPerfStressAdapter = new PerformStressAdapter(this);

        mPanel = (HeadControlPanel) findViewById(R.id.head_layout);
        mPanel.setMiddleTitle(getString(R.string.activity__performance_test));
        mPanel.setBackIconClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });

        //性能监听列表
        mFloatListView = (ListView) findViewById(R.id.perform_float_list);
        mFloatListView.setAdapter(mPerfFloatAdapter);
        mFloatListView.setDivider(new ColorDrawable(getResources().getColor(R.color.divider_color)));
        mFloatListView.setDividerHeight(1);
        mFloatListView.setFooterDividersEnabled(false);
        mFloatListView.setHeaderDividersEnabled(false);

        final List<ApplicationInfo> listPack = MyApplication.getInstance().loadAppList();

        AppCompatSpinner spinner = (AppCompatSpinner) findViewById(R.id.perform_param_spinner);
        spinner.setAdapter(new SpinnerAdapter() {
            @Override
            public View getDropDownView(int position, View convertView, ViewGroup parent) {
                View v = convertView;
                if (v == null) {
                    v = LayoutInflater.from(PerformanceActivity.this).inflate(R.layout.activity_choose_layout, null);
                }
                if (position == 0) {
                    ImageView img = (ImageView) v.findViewById(R.id.choose_icon);
                    img.setImageResource(R.drawable.icon_global);
                    TextView title = (TextView) v.findViewById(R.id.choose_title);
                    title.setText(R.string.constant_global);
                    TextView activity = (TextView) v.findViewById(R.id.choose_activity);
                    activity.setText("");
                } else {
                    ApplicationInfo info = listPack.get(position - 1);
                    ImageView img = (ImageView) v.findViewById(R.id.choose_icon);
                    GlideUtil.loadIcon(PerformanceActivity.this, info.packageName, img);
                    TextView title = (TextView) v.findViewById(R.id.choose_title);
                    title.setText(info.loadLabel(getPackageManager()).toString());
                    TextView activity = (TextView) v.findViewById(R.id.choose_activity);
                    activity.setText(info.packageName);
                }
                return v;
            }

            @Override
            public void registerDataSetObserver(DataSetObserver observer) {

            }

            @Override
            public void unregisterDataSetObserver(DataSetObserver observer) {

            }

            @Override
            public int getCount() {
                return listPack.size() + 1;
            }

            @Override
            public Object getItem(int position) {
                if (position == 0) {
                    return 0;
                }
                return listPack.get(position - 1);
            }

            @Override
            public long getItemId(int position) {
                return position;
            }

            @Override
            public boolean hasStableIds() {
                return false;
            }

            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                return getDropDownView(position, convertView, parent);
            }

            @Override
            public int getItemViewType(int position) {
                return 0;
            }

            @Override
            public int getViewTypeCount() {
                return 1;
            }

            @Override
            public boolean isEmpty() {
                return false;
            }
        });

        int position = -1;

        if (!StringUtil.isEmpty(app)) {
            for (int i = 0; i < listPack.size(); i++) {
                if (StringUtil.equals(app, listPack.get(i).packageName)) {
                    position = i;
                    break;
                }
            }
        }

        spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                // 全局特殊处理
                if (position == 0) {
                    ((MyApplication)getApplication()).updateAppAndName("-", getString(com.alipay.hulu.common.R.string.constant__global));
                } else {
                    ApplicationInfo info = listPack.get(position - 1);
                    LogUtil.i(TAG, "Select info: " + StringUtil.hide(info.packageName));

                    ((MyApplication)getApplication()).updateAppAndName(info.packageName, info.loadLabel(getPackageManager()).toString());
                }
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {

            }
        });

        spinner.setSelection(position + 1);

        final View screenRecordBtn = findViewById(R.id.screen_record_btn);

        screenRecordBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
                    toastShort(getString(R.string.performance__not_support_for_android_l));
                    return;
                }

                if (ClassUtil.getPatchInfo(VideoAnalyzer.SCREEN_RECORD_PATCH) == null) {
                    LauncherApplication.getInstance().showDialog(PerformanceActivity.this, getString(R.string.performance__load_record_plugin), getString(R.string.constant__yes), new Runnable() {
                        @Override
                        public void run() {
                            showProgressDialog(getString(R.string.performance__downloading_plugin));
                            BackgroundExecutor.execute(new Runnable() {
                                @Override
                                public void run() {
                                    PatchLoadResult rs = AssetsManager.loadPatchFromServer(VideoAnalyzer.SCREEN_RECORD_PATCH, new PrepareUtil.PrepareStatus() {
                                        @Override
                                        public void currentStatus(int progress, int total, String message, boolean status) {
                                            updateProgressDialog(progress, total, message);
                                        }
                                    });
                                    if (rs == null) {
                                        // 降级到网络模式
                                        dismissProgressDialog();
                                        toastLong(getString(R.string.performance__load_plugin_failed));
                                        return;
                                    }

                                    dismissProgressDialog();
                                    screenRecordBtn.callOnClick();
                                }
                            });

                        }
                    }, getString(R.string.constant__no), null);
                    return;
                }

                if (!PermissionUtil.isFloatWindowPermissionOn(PerformanceActivity.this)) {
                    return;
                }

                PermissionUtil.grantHighPrivilegePermissionAsync(new CmdTools.GrantHighPrivPermissionCallback() {
                    @Override
                    public void onGrantSuccess() {
                        startActivity(new Intent(PerformanceActivity.this, RecorderConfigActivity.class));
                    }

                    @Override
                    public void onGrantFail(String msg) {
                        toastLong(getString(R.string.performance__grant_adb));
                    }
                });
            }
        });

        LinearLayout button = (LinearLayout) findViewById(R.id.chart_button);
        button.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent intent = new Intent(PerformanceActivity.this, PerformanceChartActivity.class);
                startActivity(intent);
            }
        });

        //环境加压列表列表
        mStressListView = (ListView) findViewById(R.id.perform_stress_list);
        mStressListView.setAdapter(mPerfStressAdapter);
        mStressListView.setDivider(new ColorDrawable(getResources().getColor(R.color.divider_color)));
        mStressListView.setDividerHeight(1);
        mStressListView.setFooterDividersEnabled(false);
        mStressListView.setHeaderDividersEnabled(false);

    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        mPerfStressAdapter.stop();
    }
}
