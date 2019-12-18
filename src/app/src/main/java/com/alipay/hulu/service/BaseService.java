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
package com.alipay.hulu.service;

import android.annotation.TargetApi;
import android.app.Service;
import android.content.Context;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.os.Build;
import android.os.LocaleList;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.service.SPService;

import java.util.Locale;

/**
 * 应用启动的Service，目前只需要FloatWinService来承载
 * Created by qiaoruikai on 2019/1/25 3:16 PM.
 */
public abstract class BaseService extends Service {
    @Override
    public void onCreate() {
        super.onCreate();

        LauncherApplication.getInstance().notifyCreate(this);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();

        LauncherApplication.getInstance().notifyDestroy(this);
    }

    @Override
    protected void attachBaseContext(Context newBase) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            newBase = updateResources(newBase);
        }
        super.attachBaseContext(newBase);
    }

    @TargetApi(Build.VERSION_CODES.N)
    private static Context updateResources(Context context) {
        Resources resources = context.getResources();
        Locale locale = LauncherApplication.getInstance().getLanguageLocale();

        Configuration configuration = resources.getConfiguration();
        configuration.setLocale(locale);
        configuration.setLocales(new LocaleList(locale));
        return context.createConfigurationContext(configuration);
    }
}
