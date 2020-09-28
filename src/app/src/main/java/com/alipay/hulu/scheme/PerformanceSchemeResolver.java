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
package com.alipay.hulu.scheme;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.provider.Settings;

import com.alipay.hulu.R;
import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.scheme.SchemeActionResolver;
import com.alipay.hulu.common.scheme.SchemeResolver;
import com.alipay.hulu.common.tools.AppInfoProvider;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.screenRecord.Notifications;
import com.alipay.hulu.shared.display.DisplayItemInfo;
import com.alipay.hulu.shared.display.DisplayProvider;
import com.alipay.hulu.shared.display.items.base.RecordPattern;
import com.alipay.hulu.util.RecordUtil;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Created by qiaoruikai on 2019/12/4 4:47 PM.
 */
@SchemeResolver("performance")
public class PerformanceSchemeResolver implements SchemeActionResolver {
    private static final String PERFORMANCE_MODE = "mode";
    private static final String MODE_NORMAL = "normal";
    private static final String TARGET_APP = "targetApp";
    private static final String NORMAL_ITEMS = "items";
    private static final String REPORT_URL = "url";
    private static final String ACTION = "action";

    private Notification notification;
    private static final int PERFORMANCE_RECORD_ID = 12201;
    private boolean isRecording = false;

    @Override
    public boolean processScheme(Context context, Map<String, String> params) {
        String mode = params.get(PERFORMANCE_MODE);
        if (StringUtil.isEmpty(mode)) {
            return false;
        }

        switch (mode) {
            case MODE_NORMAL:
                return processNormalRecord(context, params);
            default:
                return false;
        }
    }

    /**
     * 处理正常性能录制
     * @param context
     * @param params
     * @return
     */
    private boolean processNormalRecord(final Context context, Map<String, String> params) {
        String action = params.get(ACTION);
        if (StringUtil.equals(action, "start")) {
            String itemList = params.get(NORMAL_ITEMS);
            final String[] itemArray = StringUtil.split(itemList, ",");
            if (itemArray == null) {
                return false;
            }

            // 调整待测应用
            String targetApp = params.get(TARGET_APP);
            if (!StringUtil.isEmpty(targetApp)) {
                String appLabel = null;
                List<ApplicationInfo> appList = MyApplication.getInstance().loadAppList();
                for (ApplicationInfo appInfo : appList) {
                    if (StringUtil.equals(appInfo.packageName, targetApp)) {
                        appLabel = appInfo.loadLabel(context.getPackageManager()).toString();
                    }
                }
                // 没找到对应应用
                if (StringUtil.isEmpty(appLabel)) {
                    return false;
                }

                // 更新待测应用
                MyApplication.getInstance().updateAppAndNameTemp(targetApp, appLabel);
            }

            final List<String> items = Arrays.asList(itemArray);
            final DisplayProvider displayProvider = LauncherApplication.service(DisplayProvider.class);
            // 逐项开启
            List<DisplayItemInfo> displayItems = displayProvider.getAllDisplayItems();
            Set<String> allPermissions = new HashSet<>();
            for (DisplayItemInfo info: displayItems) {
                if (items.contains(info.getKey())) {
                    allPermissions.addAll(info.getPermissions());
                }
            }
            allPermissions.add("adb");

            PermissionUtil.requestPermissions(new ArrayList<>(allPermissions), (Activity) context, new PermissionUtil.OnPermissionCallback() {
                @Override
                public void onPermissionResult(boolean result, String reason) {
                    if (result) {
                        isRecording = true;

                        AppInfoProvider provider = AppInfoProvider.getInstance();
                        InjectorService.g().unregister(provider);
                        InjectorService.g().register(provider);

                        // 逐项开启
                        displayProvider.stopAllDisplay();
                        for (String key : items) {
                            displayProvider.startDisplayByKey(key);
                        }
                        displayProvider.startRecording();
                        notification = Notifications.generateNotificationBuilder(context)
                                .setContentTitle(context.getString(R.string.performance__recording))
                                .setOngoing(true)
                                .setOnlyAlertOnce(true)
                                .setWhen(System.currentTimeMillis())
                                .setPriority(Notification.PRIORITY_HIGH)
                                .setSmallIcon(R.drawable.icon_recording)
                                .setUsesChronometer(true)
                                .setContentText(context.getString(R.string.performance__recording_performance_data))
                                .build();
                        NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                        notificationManager.notify(PERFORMANCE_RECORD_ID, notification);
                    } else {
                        LauncherApplication.getInstance().showToast(context.getString(R.string.performance__start_performance_recording_fail));
                    }
                }
            });
        } else if (StringUtil.equals(action, "stop")) {
            final String reportUrl = params.get(REPORT_URL);
            if (!isRecording) {
                return false;
            }

            // 清理通知
            NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            notificationManager.cancel(PERFORMANCE_RECORD_ID);
            notification = null;

            DisplayProvider displayProvider = LauncherApplication.getInstance().findServiceByName(DisplayProvider.class.getName());
            final Map<RecordPattern, List<RecordPattern.RecordItem>> records = displayProvider.stopRecording();
            displayProvider.stopAllDisplay();

            isRecording = false;
            BackgroundExecutor.execute(new Runnable() {
                @Override
                public void run() {
                    if (StringUtil.isEmpty(reportUrl)) {
                        // 存储录制数据
                        File folder = RecordUtil.saveToFile(records);

                        // 显示提示框
                        LauncherApplication.getInstance().showToast(StringUtil.getString(R.string.performance__record_save, folder.getPath()));
                    } else {
                        String response = RecordUtil.uploadData(reportUrl, records);
                        LauncherApplication.getInstance().showToast(StringUtil.getString(R.string.performance__record_upload, reportUrl, response));
                    }
                }
            });

        }

        return true;
    }
}
