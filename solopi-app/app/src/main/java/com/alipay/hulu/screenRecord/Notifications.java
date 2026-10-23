/*
 * Copyright (c) 2017 Yrom Wang <http://www.yrom.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.alipay.hulu.screenRecord;

import android.annotation.TargetApi;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;
import android.text.format.DateUtils;

import com.alipay.hulu.R;

/**
 * @author yrom
 * @version 2017/12/1
 */
@TargetApi(value = Build.VERSION_CODES.LOLLIPOP)
public class Notifications extends ContextWrapper {
    private static final String HULU_NOTIFICATIONS_CHANNEL_ID = "hulu-notifications";
    private static final int id = 0x1fff;
    private static final String ACTION_STOP = "com.hulu.alipay.ACTION_STOP";

    private long mLastFiredTime = 0;
    private NotificationManager mManager;
    private Notification.Action mStopAction;
    private Notification.Builder mBuilder;

    public Notifications(Context context) {
        super(context);
    }

    public void recording(long timeMs) {
//        if (SystemClock.elapsedRealtime() - mLastFiredTime < 1000) {
//            return;
//        }
//
//        //隐藏所有消息
//        getNotificationManager().cancelAll();
//        Notification notification = getBuilder()
//                .setContentText("Length: " + DateUtils.formatElapsedTime(timeMs / 1000))
//                .build();
//        getNotificationManager().notify(id, notification);
//        mLastFiredTime = SystemClock.elapsedRealtime();
    }

    private Notification.Builder getBuilder() {
        if (mBuilder == null) {
            mBuilder = generateNotificationBuilder(this)
                    .setContentTitle("屏幕录制中")
                    .setOngoing(true)
                    .setLocalOnly(true)
                    .setOnlyAlertOnce(true)
                    .addAction(stopAction())
                    .setWhen(System.currentTimeMillis())
                    .setSmallIcon(R.drawable.icon_recording)
                    .setUsesChronometer(true);
        }
        return mBuilder;
    }

    public static Notification.Builder generateNotificationBuilder(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            String channelId = HULU_NOTIFICATIONS_CHANNEL_ID;
            NotificationChannel channel = new NotificationChannel(channelId, channelId, NotificationManager.IMPORTANCE_DEFAULT);
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm.getNotificationChannel(channelId) == null) {
                nm.createNotificationChannel(channel);
            }
            return new Notification.Builder(context, channelId);
        } else {
            return new Notification.Builder(context);
        }
    }

    private Notification.Action stopAction() {
        if (mStopAction == null) {
            Intent intent = new Intent(ACTION_STOP).setPackage(getPackageName());
            PendingIntent pendingIntent = PendingIntent.getBroadcast(this, 1,
                    intent, PendingIntent.FLAG_ONE_SHOT);
            mStopAction = new Notification.Action(android.R.drawable.ic_media_pause, "Stop", pendingIntent);
        }
        return mStopAction;
    }

    public void clear() {
        mLastFiredTime = 0;
        mBuilder = null;
        mStopAction = null;
        getNotificationManager().cancelAll();
    }

    NotificationManager getNotificationManager() {
        if (mManager == null) {
            mManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        }
        return mManager;
    }
}
