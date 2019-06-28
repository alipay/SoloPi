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

import android.os.Looper;

import com.alipay.hulu.BuildConfig;
import com.alipay.hulu.common.application.LauncherApplication;

/**
 * Created by lezhou.wyl on 2018/1/21.
 */
public class SystemUtil {
    private static final String TAG = "SystemUtil";

    public static boolean isUiThread() {
        return Looper.getMainLooper().getThread() == Thread.currentThread();
    }

    private static final String CURRENT_PACKAGE_NAME = LauncherApplication.getInstance().getPackageName();

    public static int getAppVersionCode() {
        return BuildConfig.VERSION_CODE;
    }

    public static String getAppVersionName() {
        return BuildConfig.VERSION_NAME;
    }

}
