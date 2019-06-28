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
package com.alipay.hulu.common.utils;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.support.v7.view.ContextThemeWrapper;

/**
 * Context工具类
 * Created by cathor on 2017/12/15.
 */
public class ContextUtil {
    private static final String TAG = "ContextUtil";

    /**
     * dp转pix
     * @param context
     * @param dpValue
     * @return
     */
    public static int dip2px(Context context, float dpValue) {
        final float scale = context.getResources().getDisplayMetrics().density;
        return (int) (dpValue * scale + 0.5f);
    }

    /**
     * 加载特定Theme的Context
     * @param context
     * @param theme
     * @return
     */
    @SuppressLint("RestrictedApi")
    public static Context getContextThemeWrapper(Context context, int theme) {
        return new ContextThemeWrapper(context, theme);
    }

    public static PackageInfo getPackageInfoByName(Context context, String packageName) {
        if (context == null) {
            return null;
        }
        PackageInfo packageInfo = null;
        try {
            packageInfo = context.getPackageManager().getPackageInfo(packageName, 0);
        } catch (PackageManager.NameNotFoundException e) {
            LogUtil.e(TAG, "Catch PackageManager.NameNotFoundException: " + e.getMessage(), e);
        }
        return packageInfo;
    }
}
