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
package com.alipay.hulu.scheme;

import android.app.Activity;
import android.app.ProgressDialog;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.provider.Settings;

import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.scheme.SchemeActionResolver;
import com.alipay.hulu.common.scheme.SchemeResolver;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.service.CaseRecordManager;
import com.alipay.hulu.shared.io.OperationStepService;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.io.db.OperationLogHandler;
import com.alipay.hulu.shared.node.utils.PrepareUtil;
import com.alipay.hulu.util.DialogUtils;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Created by qiaoruikai on 2019/11/11 11:47 AM.
 */
@SchemeResolver("record")
public class RecordSchemeResolver implements SchemeActionResolver {
    public static final String RECORD_MODE = "recordMode";
    public static final String CASE_NAME = "caseName";
    public static final String CASE_DESC = "caseDesc";
    public static final String TARGET_APP = "targetApp";

    public static final String MODE_NORMAL = "normal";

    @Override
    public boolean processScheme(Context context, Map<String, String> params) {
        String mode = params.get(RECORD_MODE);
        if (StringUtil.isEmpty(mode)) {
            return false;
        }

        switch (mode) {
            case MODE_NORMAL:
                return startNormalMode(context, params);
        }
        return false;
    }

    /**
     * 通常模式启动录制
     * @param context
     * @param params
     * @return
     */
    private boolean startNormalMode(final Context context, Map<String, String> params) {
        final RecordCaseInfo caseInfo = loadBaseInfo(context, params);
        if (caseInfo == null) {
            return false;
        }
        caseInfo.setRecordMode("local");

        PermissionUtil.requestPermissions(Arrays.asList("adb", "float", Settings.ACTION_ACCESSIBILITY_SETTINGS), (Activity) context, new PermissionUtil.OnPermissionCallback() {
            @Override
            public void onPermissionResult(boolean result, String reason) {
                if (result) {

                    final ProgressDialog dialog = DialogUtils.showProgressDialog(LauncherApplication.getContext(), "正在加载中");
                    MyApplication.getInstance().updateAppAndName(caseInfo.getTargetAppPackage(), caseInfo.getTargetAppLabel());

                    BackgroundExecutor.execute(new Runnable() {
                        @Override
                        public void run() {
                            boolean prepareResult = PrepareUtil.doPrepareWork(caseInfo.getTargetAppPackage(), new PrepareUtil.PrepareStatus() {
                                @Override
                                public void currentStatus(int progress, int total, String message, boolean status) {
                                    updateProgressDialog(dialog, progress, total, message);
                                }
                            });

                            if (prepareResult) {
                                dismissProgressDialog(dialog);

                                LauncherApplication.service(OperationStepService.class).registerStepProcessor(new OperationLogHandler());
                                CaseRecordManager caseRecordManager = LauncherApplication.service(CaseRecordManager.class);
                                caseRecordManager.setRecordCase(caseInfo);
                            } else {
                                dismissProgressDialog(dialog);
                                LauncherApplication.getInstance().showToast("环境加载失败");
                            }
                        }
                    });
                }
            }
        });

        return true;
    }

    private static RecordCaseInfo loadBaseInfo(Context context, Map<String, String> params) {
        if (params == null) {
            return null;
        }
        String app = params.get(TARGET_APP);
        if (StringUtil.isEmpty(app)) {
            return null;
        }
        String appLabel = null;
        List<ApplicationInfo> appList = MyApplication.getInstance().loadAppList();
        for (ApplicationInfo appInfo: appList) {
            if (StringUtil.equals(appInfo.packageName, app)) {
                appLabel = appInfo.loadLabel(context.getPackageManager()).toString();
            }
        }
        // 没找到对应应用
        if (StringUtil.isEmpty(appLabel)) {
            return null;
        }

        RecordCaseInfo caseInfo = new RecordCaseInfo();
        caseInfo.setCaseName(params.get(CASE_NAME));
        caseInfo.setCaseDesc(params.get(CASE_DESC));
        caseInfo.setTargetAppPackage(app);
        caseInfo.setTargetAppLabel(appLabel);
        return caseInfo;
    }

    public void dismissProgressDialog(final ProgressDialog progressDialog) {
        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            public void run() {
                if (progressDialog != null && progressDialog.isShowing()) {
                    progressDialog.dismiss();
                }
            }
        });
    }

    public void updateProgressDialog(final ProgressDialog progressDialog, final int progress, final int totalProgress, final String message) {
        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (progressDialog == null || !progressDialog.isShowing()) {
                    return;
                }

                // 更新progressDialog的状态
                progressDialog.setProgress(progress);
                progressDialog.setMax(totalProgress);
                progressDialog.setMessage(message);
            }
        });
    }
}
