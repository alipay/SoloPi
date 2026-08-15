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
import android.provider.Settings;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.scheme.SchemeActionResolver;
import com.alipay.hulu.common.scheme.SchemeResolver;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.io.db.GreenDaoManager;
import com.alipay.hulu.shared.io.db.RecordCaseInfoDao;
import com.alipay.hulu.util.CaseReplayUtil;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Created by qiaoruikai on 2019/11/11 4:57 PM.
 */
@SchemeResolver("replay")
public class ReplaySchemeResolver implements SchemeActionResolver {
    public static final String REPLAY_MODE = "replayMode";
    public static final String CASE_NAME = "caseName";
    public static final String TARGET_APP = "targetApp";

    public static final String MODE_NORMAL = "normal";

    @Override
    public boolean processScheme(Context context, Map<String, String> params, Callback<Map<String, Object>> callback) {
        String mode = params.get(REPLAY_MODE);
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
        String caseName = params.get(CASE_NAME);
        if (StringUtil.isEmpty(caseName)) {
            return false;
        }

        List<RecordCaseInfo> caseInfos = GreenDaoManager.getInstance().getRecordCaseInfoDao().queryBuilder()
                .where(RecordCaseInfoDao.Properties.CaseName.eq(caseName))
                .orderDesc(RecordCaseInfoDao.Properties.Id).limit(1).list();
        if (caseInfos == null || caseInfos.size() < 1) {
            return false;
        }
        final RecordCaseInfo caseInfo = caseInfos.get(0);
        PermissionUtil.requestPermissions(Arrays.asList("adb", "float", "background", Settings.ACTION_ACCESSIBILITY_SETTINGS), (Activity) context, new PermissionUtil.OnPermissionCallback() {
            @Override
            public void onPermissionResult(final boolean result, String reason) {
                if (result) {
                    LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            CaseReplayUtil.startReplay(caseInfo);
                        }
                    });
                }
            }
        });
        return true;
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
