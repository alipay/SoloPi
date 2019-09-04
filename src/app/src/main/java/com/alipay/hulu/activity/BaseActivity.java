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

import android.app.ProgressDialog;
import android.content.Context;
import android.os.Bundle;
import android.support.annotation.Nullable;
import android.support.annotation.StringRes;
import android.support.v4.app.Fragment;
import android.support.v4.app.FragmentManager;
import android.support.v7.app.AppCompatActivity;
import android.text.TextUtils;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.widget.Toast;

import com.alipay.hulu.R;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.utils.DeviceInfoUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;

import java.util.HashSet;
import java.util.Set;

/**
 * Created by lezhou.wyl on 2018/1/28.
 */

public abstract class BaseActivity extends AppCompatActivity {
    private static boolean initializeScreenInfo = false;

    private boolean canShowDialog;

    private Set<String> fragmentTags = new HashSet<>();

    private static Toast toast;

    private ProgressDialog progressDialog;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        // 如果还没初始化完，强行等待初始化
        if (!(this instanceof SplashActivity)) {
            long startTime = System.currentTimeMillis();

            // 主线程等待
            LauncherApplication.getInstance().prepareInMain();

            LogUtil.w("BaseActivity", "Activity: %s, waiting launcher to initialize: %dms", getClass().getSimpleName(), System.currentTimeMillis() - startTime);
        }

        // 为了正常初始化
        super.onCreate(savedInstanceState);
        LauncherApplication.getInstance().notifyCreate(this);

        // 如果屏幕信息还未初始化，初始化下
        if (!initializeScreenInfo) {
            getScreenSizeInfo();
            initializeScreenInfo = true;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        canShowDialog = true;
        LauncherApplication.getInstance().notifyResume(this);
    }

    @Override
    protected void onPause() {
        super.onPause();
        canShowDialog = false;

        LauncherApplication.getInstance().notifyPause(this);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();

        LauncherApplication.getInstance().notifyDestroy(this);
    }

    protected boolean canShowDialog() {
        return canShowDialog;
    }

    /**
     * 展开软键盘
     */
    public void showInputMethod() {
        InputMethodManager imManager = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        imManager.toggleSoftInput(0, InputMethodManager.SHOW_FORCED);
    }

    //隐藏输入法
    public void hideSoftInputMethod() {
        View view = getWindow().peekDecorView();
        if (view != null && view.getWindowToken() != null) {
            InputMethodManager imManager = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            imManager.hideSoftInputFromWindow(view.getWindowToken(), 0);
        }
    }

    /**
     * 短toast
     * @param stringRes
     */
    public void toastShort(@StringRes final int stringRes) {
        toastShort(getString(stringRes));
    }

    /**
     * 短toast
     * @param stringRes
     */
    public void toastShort(@StringRes final int stringRes, final Object... args) {
        toastShort(getString(stringRes, args));
    }

    /**
     * toast短时间提示
     *
     * @param msg
     */
    public void toastShort(final String msg) {
        if (TextUtils.isEmpty(msg)) {
            return;
        }
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (toast == null) {
                    toast = Toast.makeText(MyApplication.getContext(), msg, Toast.LENGTH_SHORT);
                } else {
                    toast.setText(msg);
                }
                toast.show();
            }
        });
    }

    public void toastShort(String msg, Object... args) {
        String formatMsg = String.format(msg, args);
        toastShort(formatMsg);
    }

    /**
     * 短toast
     * @param stringRes
     */
    public void toastLong(@StringRes final int stringRes) {
        toastLong(getString(stringRes));
    }

    /**
     * 短toast
     * @param stringRes
     */
    public void toastLong(@StringRes final int stringRes, final Object... args) {
        toastLong(getString(stringRes, args));
    }

    /**
     * toast长时间提示
     *
     * @param msg
     */
    public void toastLong(final String msg) {
        if (TextUtils.isEmpty(msg)) {
            return;
        }
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (toast == null) {
                    toast = Toast.makeText(MyApplication.getContext(), msg, Toast.LENGTH_LONG);
                } else {
                    toast.setText(msg);
                }
                toast.show();
            }
        });
    }

    public void showProgressDialog(final String str) {
        runOnUiThread(new Runnable() {
            public void run() {
                if (progressDialog == null) {
                    progressDialog = new ProgressDialog(BaseActivity.this, R.style.SimpleDialogTheme);
                    progressDialog.setMessage(str);
                    progressDialog.setProgressStyle(ProgressDialog.STYLE_SPINNER);
                    progressDialog.show();
                } else if (progressDialog.isShowing()) {
                    progressDialog.setMessage(str);
                } else {
                    progressDialog.setMessage(str);
                    progressDialog.show();
                }
            }
        });
    }

    public void dismissProgressDialog() {
        runOnUiThread(new Runnable() {
            public void run() {
                if (progressDialog != null) {
                    progressDialog.dismiss();
                }
            }
        });
    }

    public void updateProgressDialog(final int progress, final int totalProgress, final String message) {
        runOnUiThread(new Runnable() {
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

    private void getScreenSizeInfo() {
        getWindowManager().getDefaultDisplay().getRealSize(DeviceInfoUtil.realScreenSize);
        getWindowManager().getDefaultDisplay().getSize(DeviceInfoUtil.curScreenSize);
        getWindowManager().getDefaultDisplay().getMetrics(DeviceInfoUtil.metrics);
    }

    /**
     * 添加Fragment tag信息
     * @param tag
     */
    public void addFragmentTag(String tag) {
        fragmentTags.add(tag);
    }

    public Set<String> getAllFragmentTags() {
        return new HashSet<>(fragmentTags);
    }

    /**
     * 根据tag查找fragment
     * @param tag
     * @return
     */
    public Fragment getFragmentByTag(String tag) {
        FragmentManager supported = getSupportFragmentManager();
        if (supported != null) {
            return supported.findFragmentByTag(tag);
        }

        return null;
    }
}
