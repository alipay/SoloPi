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
package com.alipay.hulu.util;

import android.content.Context;
import android.content.DialogInterface;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.support.annotation.NonNull;
import android.support.v7.app.AlertDialog;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.ImageView;
import android.widget.ListView;
import android.widget.TextView;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.R;
import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.bean.AdvanceCaseSetting;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.GlideUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.replay.BatchStepProvider;
import com.alipay.hulu.replay.MultiParamStepProvider;
import com.alipay.hulu.replay.OperationStepProvider;
import com.alipay.hulu.replay.RepeatStepProvider;
import com.alipay.hulu.service.CaseReplayManager;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.node.utils.AppUtil;

import java.util.ArrayList;
import java.util.List;

/**
 * 用例回放管理器
 * Created by qiaoruikai on 2019-08-21 12:41.
 */
public class CaseReplayUtil {
    private static final String TAG = CaseReplayUtil.class.getSimpleName();

    /**
     * 开始回放单条用例
     * @param recordCase
     */
    public static void startReplay(@NonNull final RecordCaseInfo recordCase) {
        final String advanceSettings = recordCase.getAdvanceSettings();
        final AdvanceCaseSetting setting = JSON.parseObject(advanceSettings, AdvanceCaseSetting.class);
        if (setting != null && !StringUtil.isEmpty(setting.getOverrideApp())) {
            recordCase.setTargetAppPackage(setting.getOverrideApp());
        } else if (SPService.getBoolean(SPService.KEY_ALLOW_REPLAY_DIFFERENT_APP, false)) {
            LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    selectJumpApp(LauncherApplication.getInstance().loadActivityOnTop(), new OnAppSelectListener() {
                        @Override
                        public void onAppSelect(String appPackage, String appName) {
                            recordCase.setTargetAppPackage(appPackage);
                            recordCase.setTargetAppLabel(appName);
                            AdvanceCaseSetting newSettings = new AdvanceCaseSetting(setting);
                            newSettings.setOverrideApp(appPackage);
                            recordCase.setAdvanceSettings(JSON.toJSONString(newSettings));
                            startReplay(recordCase);
                        }

                        @Override
                        public void onNothingSelect() {
                            AdvanceCaseSetting newSettings = new AdvanceCaseSetting(setting);
                            newSettings.setOverrideApp(recordCase.getTargetAppPackage());
                            recordCase.setAdvanceSettings(JSON.toJSONString(newSettings));
                            startReplay(recordCase);
                        }
                    });
                }
            }, 100);
            return;
        }
        CaseReplayManager manager = LauncherApplication.getInstance().findServiceByName(CaseReplayManager.class.getName());
        MyApplication.getInstance().updateAppAndNameTemp(recordCase.getTargetAppPackage(), recordCase.getTargetAppLabel());

        // 是否重启目标应用
        if (SPService.getBoolean(SPService.KEY_RESTART_APP_ON_PLAY, true)) {
            restartTargetApp(recordCase.getTargetAppPackage());
        } else {
            BackgroundExecutor.execute(new Runnable() {
                @Override
                public void run() {
                    AppUtil.launchTargetApp(recordCase.getTargetAppPackage());
                }
            });
        }

        if (setting != null && setting.getRunningParam() != null) {
            MultiParamStepProvider stepProvider = new MultiParamStepProvider(recordCase);
            manager.start(stepProvider, MyApplication.MULTI_REPLAY_LISTENER);
        } else {
            OperationStepProvider stepProvider = new OperationStepProvider(recordCase);
            manager.start(stepProvider, MyApplication.SINGLE_REPLAY_LISTENER);
        }
    }

    /**
     * 关闭后重启应用
     * @param packageName
     */
    public static void restartTargetApp(final String packageName) {
        PackageInfo pkgInfo = ContextUtil.getPackageInfoByName(
                LauncherApplication.getInstance(), packageName);
        if (pkgInfo == null) {
            return;
        }

        //如果是支付宝，点击后通过scheme跳到首页
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                AppUtil.forceStopApp(packageName);

                LogUtil.e(TAG, "强制终止应用");
                MiscUtil.sleep(500);
                AppUtil.startApp(packageName);
            }
        });
    }


    /**
     * 开始重复回放用例
     * @param recordCase
     * @param times
     * @param restart 执行前重启
     */
    public static void startReplayMultiTimes(@NonNull RecordCaseInfo recordCase, int times, boolean restart) {
        RepeatStepProvider stepProvider = new RepeatStepProvider(recordCase, times, restart);
        MyApplication.getInstance().updateAppAndNameTemp(recordCase.getTargetAppPackage(), recordCase.getTargetAppLabel());
        CaseReplayManager manager = LauncherApplication.getInstance().findServiceByName(CaseReplayManager.class.getName());
        manager.start(stepProvider, MyApplication.MULTI_REPLAY_LISTENER);
    }

    /**
     * 开始回放多条用例
     * @param recordCases 用例列表
     * @param restart 执行前重启
     */
    public static void startReplayMultiCase(@NonNull List<RecordCaseInfo> recordCases, boolean restart) {
        BatchStepProvider provider = new BatchStepProvider(new ArrayList<>(recordCases), restart);
        CaseReplayManager manager = LauncherApplication.getInstance().findServiceByName(CaseReplayManager.class.getName());
        manager.start(provider, MyApplication.MULTI_REPLAY_LISTENER);
    }

    /**
     * 选择回放应用
     * @param context
     * @param listener
     */
    public static void selectJumpApp(final Context context, final OnAppSelectListener listener) {
        try {
            View v = LayoutInflater.from(context).inflate(R.layout.dialog_select_app, null);
            final ListView list = (ListView) v.findViewById(R.id.dialog_jump_app_list);
            final List<ApplicationInfo> listPack = MyApplication.getInstance().loadAppList();

            list.setAdapter(new BaseAdapter() {
                @Override
                public int getCount() {
                    return listPack.size();
                }

                @Override
                public Object getItem(int position) {
                    return listPack.get(position);
                }

                @Override
                public long getItemId(int position) {
                    return position;
                }

                @Override
                public View getView(int position, View convertView, ViewGroup parent) {
                    View v;
                    if (convertView == null) {
                        convertView = LayoutInflater.from(context)
                                .inflate(R.layout.activity_choose_layout, parent, false);
                    }
                    v = convertView;

                    ApplicationInfo info = listPack.get(position);
                    ImageView img = (ImageView) v.findViewById(R.id.choose_icon);
                    GlideUtil.loadIcon(context, info.packageName, img);
                    TextView title = (TextView) v.findViewById(R.id.choose_title);
                    title.setText(info.loadLabel(context.getPackageManager()).toString());
                    TextView activity = (TextView) v.findViewById(R.id.choose_activity);
                    activity.setText(info.packageName);
                    return v;
                }
            });

            final AlertDialog dialog = new AlertDialog.Builder(context, R.style.AppDialogTheme)
                    .setView(v)
                    .setNegativeButton("取消", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            LogUtil.i(TAG, "Negative " + which);

                            dialog.dismiss();
                            listener.onNothingSelect();
                        }
                    })
                    .create();

            list.setOnItemClickListener(new AdapterView.OnItemClickListener() {
                @Override
                public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                    dialog.dismiss();
                    ApplicationInfo applicationInfo = listPack.get(position);
                    String name = applicationInfo.loadLabel(context.getPackageManager()).toString();
                    listener.onAppSelect(applicationInfo.packageName, name);
                }
            });

            dialog.setCanceledOnTouchOutside(false);                                   //点击外面区域不会让dialog消失
            dialog.setCancelable(false);
            dialog.show();

        } catch (Exception e) {
            LogUtil.e(TAG, "Jump app dialog throw exception: " + e.getMessage(), e);
        }
    }

    public interface OnAppSelectListener {
        void onAppSelect(String appPackage, String appName);

        void onNothingSelect();
    }
}
