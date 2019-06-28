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

import android.app.Service;

import com.alipay.hulu.common.application.LauncherApplication;

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
}
