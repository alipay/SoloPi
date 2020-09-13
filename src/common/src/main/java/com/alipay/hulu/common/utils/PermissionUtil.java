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

import android.annotation.TargetApi;
import android.app.Activity;
import android.app.AppOpsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.alipay.hulu.common.R;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.activity.PermissionDialogActivity;
import com.android.permission.FloatWindowManager;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Created by cathor on 2017/12/12.
 */

public class PermissionUtil {
    private static final String TAG = "PermissionUtil";

    private static Map<Integer, OnPermissionCallback> _callbackMap = new ConcurrentHashMap<>();

    private static long lastActionTime = 0;
    private static AtomicInteger callbackCount = new AtomicInteger(0);

    /**
     * 开始请求权限
     *
     * @param permissions
     * @param activity
     * @param callback
     */
    public static void requestPermissions(@NonNull final List<String> permissions, final Activity activity, @NonNull final OnPermissionCallback callback) {
        // 可能悬浮窗Dialog还没关闭，延后一下权限申请任务
        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (PermissionDialogActivity.runningStatus) {
                    LogUtil.w(TAG, "有其他任务正在申请权限");
                    callback.onPermissionResult(false, "正在申请其他权限");
                    return;
                }

//                if (System.currentTimeMillis() - lastActionTime < 1000) {
//                    LogUtil.w(TAG, "间隔时间过短，请稍后重试");
//                    callback.onPermissionResult(false, "请求过快");
//                    return;
//                }

                lastActionTime = System.currentTimeMillis();

                if (permissions.size() == 0) {
                    LogUtil.w(TAG, "请求权限为空");
                    callback.onPermissionResult(true, null);
                    return;
                }

                final Intent intent = new Intent(activity, PermissionDialogActivity.class);

                // 转化为ArrayList
                if (permissions instanceof ArrayList) {
                    intent.putStringArrayListExtra(PermissionDialogActivity.PERMISSIONS_KEY, (ArrayList<String>) permissions);
                } else {
                    intent.putStringArrayListExtra(PermissionDialogActivity.PERMISSIONS_KEY, new ArrayList<>(permissions));
                }

                // 设置回调idz
                int currentIdx = callbackCount.getAndIncrement();
                intent.putExtra(PermissionDialogActivity.PERMISSION_IDX_KEY, currentIdx);

                // 起了intent再设置callback
                activity.startActivity(intent);
                _callbackMap.put(currentIdx, callback);
            }
        });
    }

    /**
     * 处理权限
     * @param result
     * @param reason
     */
    public static void onPermissionResult(int idx, final boolean result, final String reason) {
        if (_callbackMap.isEmpty() || _callbackMap.get(idx) == null) {
            LogUtil.e(TAG, "callback引用消失");
            return;
        }

        final OnPermissionCallback _callback = _callbackMap.remove(idx);
        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                _callback.onPermissionResult(result, reason);

            }
        }, 1);
    }

    /**
     * 检查Accessibility权限
     * */
    public static boolean isAccessibilitySettingsOn(Context context) {
        int accessibilityEnabled = 0;
        try {
            accessibilityEnabled = Settings.Secure.getInt(context.getContentResolver(),
                    android.provider.Settings.Secure.ACCESSIBILITY_ENABLED);
        } catch (Settings.SettingNotFoundException e) {
            LogUtil.e(TAG, e.getMessage());
        }

        if (accessibilityEnabled == 1) {
            String services = Settings.Secure.getString(context.getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (services != null) {
                return services.toLowerCase().contains(context.getPackageName().toLowerCase());
            }
        }

        return false;
    }

    /**
     * 检查悬浮窗权限
     * @param context
     * @return
     */
    public static boolean isFloatWindowPermissionOn(Context context) {
        return FloatWindowManager.getInstance().checkFloatPermission(context);
    }

    /**
     * 检查使用状态权限
     * @param context
     * @return
     */
    @TargetApi(Build.VERSION_CODES.KITKAT)
    public static boolean isUsageStatPermissionOn(Context context) {
        AppOpsManager appOps = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
        int mode = appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(), context.getPackageName());
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    /**
     * 检查是否已有高权限
     * @param context
     * @return
     */
    public static boolean grantHighPrivilegePermission(Context context) {
        if (!CmdTools.isInitialized()) {
            BackgroundExecutor.execute(new Runnable() {
                @Override
                public void run() {
                    CmdTools.generateConnection();
                }
            });
            LauncherApplication.toast(R.string.open_adb_permission_failed);
            return false;
        }
        return true;
    }

    public static void grantHighPrivilegePermissionAsync(final CmdTools.GrantHighPrivPermissionCallback callback) {
        if (!CmdTools.isInitialized()) {
            BackgroundExecutor.execute(new Runnable() {
                @Override
                public void run() {
                    ExecutorService executor = Executors.newSingleThreadExecutor();
                    FutureTask<Boolean> future =
                            new FutureTask<>(new Callable<Boolean>() {//使用Callable接口作为构造参数
                                public Boolean call() {
                                    return CmdTools.generateConnection();
                                }});
                    executor.execute(future);
                    try {
                        if (future.get(5, TimeUnit.SECONDS)) {
                            callback.onGrantSuccess();
                        } else {
                            callback.onGrantFail("execute failed");
                        }
                    } catch (InterruptedException | ExecutionException | TimeoutException e) {
//                        future.cancel(true);
                        callback.onGrantFail("execute exeception");
                    } finally {
                        executor.shutdown();
                    }
                }
            });
        } else {
            callback.onGrantSuccess();
        }
    }

    /**
     * 检查需动态申请的权限，对未获取的权限进行申请
     * @param activity
     * @param neededPermissions
     * @return 是否已全部获取
     */
    @TargetApi(Build.VERSION_CODES.M)
    public static boolean checkAndGrantDynamicPermissionIfNeeded(Activity activity, String[] neededPermissions) {
        String[] notGrantedPermissions = new String[neededPermissions.length];
        int index = 0;

        // 检查每项权限是否已经获得，未获得的加入待申请队列
        for (String permission : neededPermissions) {
            if (permission != null && ContextCompat.checkSelfPermission(activity, permission) != PackageManager.PERMISSION_GRANTED) {
                notGrantedPermissions[index++] = permission;
            }
        }

        // 当存在未获得的权限，进行动态申请
        if (index > 0) {
            ActivityCompat.requestPermissions(activity, notGrantedPermissions, 0);
            return false;
        }

        return true;
    }

    /**
     * 检查需动态申请的权限，对未获取的权限进行申请
     * @param activity
     * @param neededPermissions
     * @return 是否已全部获取
     */
    @TargetApi(Build.VERSION_CODES.M)
    public static List<String> checkUngrantedPermission(Activity activity, String[] neededPermissions) {
        List<String> notGrantedPermissions = new ArrayList<>();
        int index = 0;

        // 检查每项权限是否已经获得，未获得的加入待申请队列
        for (String permission : neededPermissions) {
            if (permission != null && ContextCompat.checkSelfPermission(activity, permission) != PackageManager.PERMISSION_GRANTED) {
                notGrantedPermissions.add(permission);
            }
        }

        return notGrantedPermissions;
    }

    public interface OnPermissionCallback {
        void onPermissionResult(boolean result, String reason);
    }
}
