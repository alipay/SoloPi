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

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Looper;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.utils.ContextUtil;

/**
 * 应用启动的Service，目前只需要FloatWinService来承载
 * Created by qiaoruikai on 2019/1/25 3:16 PM.
 */
public abstract class BaseService extends Service {
    private static final String HULU_SERVICE_CHANNEL_ID = "hulu-service";
    protected NotificationManager mNotificationManager;

    @Override
    public void startActivity(final Intent intent) {
        if (Thread.currentThread() != Looper.getMainLooper().getThread()) {
            LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    BaseService.super.startActivity(intent);
                }
            });
        } else {
            super.startActivity(intent);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        mNotificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);;

        LauncherApplication.getInstance().notifyCreate(this);
    }

    @Override
    public void onDestroy() {
        super.onDestroy();

        LauncherApplication.getInstance().notifyDestroy(this);
    }

    @Override
    protected void attachBaseContext(Context newBase) {
        super.attachBaseContext(newBase);
        ContextUtil.updateResources(this);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        ContextUtil.updateResources(this);
    }

    public Notification.Builder generateNotificationBuilder() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            String channelId = HULU_SERVICE_CHANNEL_ID;
            NotificationChannel channel = new NotificationChannel(channelId, channelId, NotificationManager.IMPORTANCE_DEFAULT);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm.getNotificationChannel(channelId) == null) {
                nm.createNotificationChannel(channel);
            }
            return new Notification.Builder(this, channelId);
        } else {
            return new Notification.Builder(this);
        }
    }
}
