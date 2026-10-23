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

import android.app.ActivityManager;
import android.content.Context;

import com.alipay.hulu.common.application.LauncherApplication;

public class ProcessUtil {
    /**
     * 获取当前进程名
     */
    public static String getCurrentProcessName() {
        int pid = android.os.Process.myPid();
        String processName = "";
        ActivityManager manager = (ActivityManager) LauncherApplication.getContext().getApplicationContext().getSystemService
                (Context.ACTIVITY_SERVICE);
        for (ActivityManager.RunningAppProcessInfo process : manager.getRunningAppProcesses()) {
            if (process.pid == pid) {
                processName = process.processName;
            }
        }
        return processName;
    }

    /**
     * 检测进程是否在前台
     * @return
     */
    public static boolean isProgressForeground() {
        int pid = android.os.Process.myPid();
        ActivityManager.RunningAppProcessInfo targetProcess = null;
        ActivityManager manager = (ActivityManager) LauncherApplication.getContext().getApplicationContext().getSystemService
                (Context.ACTIVITY_SERVICE);
        for (ActivityManager.RunningAppProcessInfo process : manager.getRunningAppProcesses()) {
            if (process.pid == pid) {
                targetProcess = process;
            }
        }
        if (targetProcess != null) {
            return targetProcess.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
        }
        return false;
    }

    /**
     * 判断当前进程是否是主进程
     * @return
     */
    public static boolean isMainProcess() {
        return StringUtil.equals(LauncherApplication.getContext().getApplicationContext().getPackageName(), getCurrentProcessName());
    }
}
