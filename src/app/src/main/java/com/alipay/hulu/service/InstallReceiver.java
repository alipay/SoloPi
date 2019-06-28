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

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;

/**
 * 安装事件接受服务
 * Created by qiaoruikai on 2018/11/8 3:13 PM.
 */
public class InstallReceiver extends BroadcastReceiver {
    private static final String TAG = "InstallReceiver";
    @Override
    public void onReceive(Context context, Intent intent) {

        if (intent.getAction().equals("android.intent.action.PACKAGE_ADDED")) {		// install
            String packageName = intent.getDataString();

            LogUtil.i(TAG, "安装了 :" + StringUtil.hide(packageName));

            // 通知更新下应用
            MyApplication.getInstance().notifyAppChangeEvent();
        }

        if (intent.getAction().equals("android.intent.action.PACKAGE_REMOVED")) {	// uninstall
            String packageName = intent.getDataString();

            LogUtil.i(TAG, "卸载了 :" + StringUtil.hide(packageName));

            if (MyApplication.getInstance() != null) {
                MyApplication.getInstance().notifyAppChangeEvent();
            }
        }
    }
}