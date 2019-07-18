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

import android.app.Activity;
import android.app.ProgressDialog;
import android.content.Context;
import android.os.Bundle;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.text.TextUtils;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.widget.Toast;

import com.alipay.hulu.R;
import com.alipay.hulu.activity.BaseActivity;
import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.utils.LogUtil;

public class BaseFragment extends Fragment {
    private boolean canShowDialog;

    private static Toast toast;

    private ProgressDialog progressDialog;

    @Override
    public void onResume() {
        super.onResume();
    }

    @Override
    public void onPause() {
        super.onPause();
    }

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        long startTime = System.currentTimeMillis();

        // 主线程等待
        LauncherApplication.getInstance().prepareInMain();

        LogUtil.w("BaseFragment", "Fragment: %s, 等待Launcher初始化耗时: %dms",
                getClass().getSimpleName(), System.currentTimeMillis() - startTime);
    }

    protected boolean canShowDialog() {
        return canShowDialog;
    }

    /**
     * 展开软键盘
     */
    public void showInputMethod() {
        InputMethodManager imManager = (InputMethodManager) getActivity().getSystemService(Context.INPUT_METHOD_SERVICE);
        imManager.toggleSoftInput(0, InputMethodManager.SHOW_FORCED);
    }

    //隐藏输入法
    public void hideSoftInputMethod() {
        View view = getActivity().getWindow().peekDecorView();
        if (view != null && view.getWindowToken() != null) {
            InputMethodManager imManager = (InputMethodManager) getActivity().getSystemService(Context.INPUT_METHOD_SERVICE);
            imManager.hideSoftInputFromWindow(view.getWindowToken(), 0);
        }
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
        getActivity().runOnUiThread(new Runnable() {
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

    @Override
    public void onActivityCreated(@Nullable Bundle savedInstanceState) {
        super.onActivityCreated(savedInstanceState);

        // 绑定下TAG信息
        Activity activity = getActivity();
        if (activity instanceof BaseActivity) {
            ((BaseActivity) activity).addFragmentTag(getTag());
        }
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
        getActivity().runOnUiThread(new Runnable() {
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

    public void toastLong(String msg, Object... args) {
        String formatMsg = String.format(msg, args);
        toastLong(formatMsg);
    }

    public void showProgressDialog(final String str) {
        getActivity().runOnUiThread(new Runnable() {
            public void run() {
                if (progressDialog == null) {
                    progressDialog = new ProgressDialog(getActivity(), R.style.SimpleDialogTheme);
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
        getActivity().runOnUiThread(new Runnable() {
            public void run() {
                if (progressDialog != null) {
                    progressDialog.dismiss();
                }
            }
        });
    }

    public void updateProgressDialog(final int progress, final int totalProgress, final String message) {
        getActivity().runOnUiThread(new Runnable() {
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
