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
package com.alipay.hulu.shared.node.utils;

import android.app.ActivityManager;
import android.content.Intent;
import android.content.pm.ResolveInfo;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.StringUtil;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static android.content.Context.ACTIVITY_SERVICE;

public class AppUtil {
    private static final String TAG = "AppUtil";
    /**
     * 通过adb启动应用
     * @param appPackage
     * @return
     */
    public static boolean startApp(String appPackage) {
        Intent intent = new Intent(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_LAUNCHER);
        intent.setPackage(appPackage);
        List<ResolveInfo> resolveInfos = LauncherApplication.getContext().getPackageManager().queryIntentActivities(intent, 0);
        if (resolveInfos == null || resolveInfos.size() == 0) {
            return false;
        }

        // 多Launcher情景
        for (ResolveInfo resolveInfo : resolveInfos) {
            LogUtil.d(TAG, "resolveInfo:" + resolveInfo);
        }
        String targetActivity = resolveInfos.get(0).activityInfo.name;
        CmdTools.execAdbCmd("am start -n '" + appPackage + "/" + targetActivity + "'", 2000);
        return true;
    }


    private static final Pattern TASK_ID_PATTERN = Pattern.compile(".*\\s+#(\\d+)\\s+.*");

    /**
     * 启动目标应用
     * @param packageName
     */
    public static void launchTargetApp(String packageName) {
        //获得当前运行的task
        String result = CmdTools.execHighPrivilegeCmd("dumpsys activity activities | grep '* TaskRecord.*A=" + packageName + '\'');

        LogUtil.d(TAG,"task list Result: " + result);
        if (!StringUtil.isEmpty(result) && result.contains(packageName)) {
            String[] list = result.split("\n");
            String targetLine = list[0];
            Matcher matcher = TASK_ID_PATTERN.matcher(targetLine);
            if (matcher.matches()) {
                String matchRes = matcher.group(1);
                try {
                    final int taskId = Integer.parseInt(matchRes);
                    final CountDownLatch latch = new CountDownLatch(1);
                    LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            ActivityManager mAm = (ActivityManager) LauncherApplication.getInstance().getSystemService(ACTIVITY_SERVICE);
                            mAm.moveTaskToFront(taskId, 0);
                            latch.countDown();
                        }
                    });

                    latch.countDown();
                    MiscUtil.sleep(2000);
                    return;
                } catch (NumberFormatException e) {
                    LogUtil.e(TAG, "Can't format for content :" + matchRes, e);
                }
            }
        }

        // 没有目标应用进程，手动启动
        startApp(packageName);
    }

    /**
     * 强制停止APP
     * @param appPackage
     */
    public static void forceStopApp(String appPackage) {
        CmdTools.execAdbCmd("am force-stop " + appPackage, 2000);
    }

    /**
     * 清理App数据
     * @param appPackage
     */
    public static void clearAppData(String appPackage) {
        CmdTools.execAdbCmd("pm clear " + appPackage, 10 * 1000);
    }
}