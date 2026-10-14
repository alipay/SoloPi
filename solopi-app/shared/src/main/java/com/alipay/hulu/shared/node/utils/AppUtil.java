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
import android.os.Looper;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
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


    private static final Pattern TASK_HEADER_PATTERN = Pattern.compile(
            "^\\s*(?:\\*\\s+)?(?:TaskRecord|Task)\\{[^\\s}]+\\s+#(\\d+)\\s+([^}]*)\\}.*$");
    private static final Pattern TASK_AFFINITY_PATTERN = Pattern.compile(
            "(?:^|\\s)A=(?:\\d+:)?([^\\s}]+)(?=\\s|$)");
    private static final long TASK_MOVE_TIMEOUT_MS = 5_000L;

    /**
     * 启动目标应用
     * @param packageName
     */
    public static void launchTargetApp(String packageName) {
        launchTargetApp(packageName, true);
    }

    /** Returns false when an existing task cannot be restored, or a new launch is forbidden. */
    public static boolean launchTargetApp(String packageName, boolean allowStart) {
        // Code security: CmdTools logs stdout; retain only task headers, never Activity intents.
        // The command is fixed: package names are matched as data below, not shell input.
        String result = CmdTools.execHighPrivilegeCmd("dumpsys activity activities | grep -Eo "
                + "'^[[:space:]]*(\\*[[:space:]]+)?(TaskRecord|Task)\\{[^}]*\\}'");
        final Integer taskId = findTaskId(result, packageName);
        if (taskId != null) {
            final LauncherApplication application = LauncherApplication.getInstance();
            try {
                boolean moved = moveTaskAndWait(new Runnable() {
                    @Override
                    public void run() {
                        ActivityManager manager = (ActivityManager) application.getSystemService(ACTIVITY_SERVICE);
                        manager.moveTaskToFront(taskId, 0);
                    }
                }, new Executor() {
                    @Override
                    public void execute(Runnable command) {
                        application.runOnUiThread(command);
                    }
                }, Looper.myLooper() == Looper.getMainLooper(), TASK_MOVE_TIMEOUT_MS);
                if (moved) {
                    MiscUtil.sleep(2000);
                    return true;
                } else {
                    LogUtil.w(TAG, "Existing task could not be moved to the foreground");
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                LogUtil.w(TAG, "Interrupted while bringing the existing task to the foreground");
            }
            // An existing task must not fall back to its launcher and lose the current page.
            return false;
        }

        // A no-restart caller must not replace a missing task with a new launcher page.
        return allowStart && startApp(packageName);
    }

    static Integer findTaskId(String activityDump, String packageName) {
        if (activityDump == null || packageName == null || packageName.isEmpty()) {
            return null;
        }
        for (String line : activityDump.split("\\r?\\n")) {
            Matcher task = TASK_HEADER_PATTERN.matcher(line);
            if (!task.matches()) {
                continue;
            }
            Matcher affinity = TASK_AFFINITY_PATTERN.matcher(task.group(2));
            // Code security: match a task's complete default affinity, never a package prefix.
            if (!affinity.find() || !packageName.equals(affinity.group(1))) {
                continue;
            }
            try {
                return Integer.parseInt(task.group(1));
            } catch (NumberFormatException ignored) {
                // Malformed task IDs must not hide a later valid task header.
            }
        }
        return null;
    }

    static boolean moveTaskAndWait(final Runnable moveTask, Executor uiExecutor,
                                   boolean onMainThread, long timeoutMs) throws InterruptedException {
        final CountDownLatch completed = new CountDownLatch(1);
        final AtomicBoolean moved = new AtomicBoolean();
        final AtomicBoolean cancelled = new AtomicBoolean();
        Runnable action = new Runnable() {
            @Override
            public void run() {
                try {
                    if (!cancelled.get()) {
                        moveTask.run();
                        moved.set(true);
                    }
                } catch (RuntimeException ignored) {
                    // A denied or removed task must not crash the UI thread or relaunch the app.
                } finally {
                    completed.countDown();
                }
            }
        };
        try {
            if (onMainThread) {
                action.run();
            } else {
                uiExecutor.execute(action);
            }
            return completed.await(timeoutMs, TimeUnit.MILLISECONDS) && moved.get();
        } catch (RuntimeException ignored) {
            return false;
        } finally {
            // Prevent a queued UI action from running after timeout or interruption.
            cancelled.set(true);
        }
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
