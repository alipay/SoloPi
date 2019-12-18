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
package com.alipay.hulu.common.scheme;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Bundle;
import android.support.annotation.Nullable;

import com.alipay.hulu.common.R;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.SortedList;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Created by qiaoruikai on 2019/11/8 10:51 PM.
 */
public class SchemeActivity extends Activity {
    private static final String TAG = "SchemeActivity";

    @Override
    protected void onStart() {
        super.onStart();
        if (LauncherApplication.getInstance().hasFinishInit()) {
            doSchemeJump();
        } else {
            // 新启动进闪屏页2s
            setContentView(R.layout.scheme_wait_layout);
            waitForAppInitialize();
        }
    }

    protected void doSchemeJump() {
        Uri data = getIntent().getData();
        if (data == null) {
            startOrigin();
            return;
        }
        List<String> segments = data.getPathSegments();
        if (segments == null || segments.size() != 1) {
            startOrigin();
            return;
        }

        final String realAction = segments.get(0);
        Set<String> names = data.getQueryParameterNames();
        final Map<String, String> params = new HashMap<>(names.size() + 1);
        for (String name: names) {
            params.put(name, data.getQueryParameter(name));
        }

        if (LauncherApplication.getInstance().getSchemeResolver() != null) {
            doSchemeJump(LauncherApplication.getInstance().getSchemeResolver(), realAction, params);
        } else {
            BackgroundExecutor.execute(new Runnable() {
                @Override
                public void run() {
                    LauncherApplication.getInstance().initActionResolvers();
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            doSchemeJump(LauncherApplication.getInstance().getSchemeResolver(), realAction, params);
                        }
                    });
                }
            });
        }
    }

    /**
     * 实际跳转
     * @param resolvers
     * @param action
     * @param params
     */
    private void doSchemeJump(Map<String, SortedList<SchemeActionResolver>> resolvers, String action, Map<String, String> params) {
        if (resolvers == null || !resolvers.containsKey(action)) {
            startOrigin();
            return;
        }

        SortedList<SchemeActionResolver> resolverList = resolvers.get(action);
        for (SchemeActionResolver realResolver: resolverList) {
            if (realResolver.processScheme(this, params)) {
                finish();
                return;
            }
        }

        startOrigin();
    }

    private void startOrigin() {
        Intent intent = new Intent(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_LAUNCHER);
        intent.setPackage(LauncherApplication.getContext().getPackageName());
        ResolveInfo resolveInfo = LauncherApplication.getContext().getPackageManager().resolveActivity(intent, 0);
        if (resolveInfo == null) {
            finish();
            return;
        }

        String targetActivity = resolveInfo.activityInfo.name;
        try {
            Intent mainActivity = new Intent(this, Class.forName(targetActivity));
            startActivity(mainActivity);
            finish();
        } catch (ClassNotFoundException e) {
            LogUtil.e(TAG, "Catch java.lang.ClassNotFoundException: " + e.getMessage(), e);
        }
    }

    private void waitForAppInitialize() {
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                while (!LauncherApplication.getInstance().hasFinishInit()) {
                    MiscUtil.sleep(50);
                }

                // 主线程跳转下
                LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                    public void run() {
                        doSchemeJump();
                    }
                });
            }
        });
    }
}
