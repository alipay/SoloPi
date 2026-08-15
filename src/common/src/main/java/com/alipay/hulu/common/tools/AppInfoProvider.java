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
package com.alipay.hulu.common.tools;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.bean.ProcessInfo;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.injector.provider.Provider;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import android.os.Build;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class AppInfoProvider {
    private static final String TAG = "AppInfoProvider";
    public static final String MAIN = "main";

    private String appName;

    private volatile static AppInfoProvider _PROVIDER_INSTANCE;

    public static AppInfoProvider getInstance() {
        if (_PROVIDER_INSTANCE == null) {
            synchronized (AppInfoProvider.class) {
                if (_PROVIDER_INSTANCE == null) {
                    _PROVIDER_INSTANCE = new AppInfoProvider();
                }
            }
        }

        return _PROVIDER_INSTANCE;
    }

    private AppInfoProvider() {
    }

    @Subscriber(@Param(SubscribeParamEnum.APP))
    public void setAppName(String appName) {
        this.appName = appName;
    }

    @Provider(value = {@Param(SubscribeParamEnum.PACKAGE),
            @Param(SubscribeParamEnum.PACKAGE_CHILDREN),
            @Param(SubscribeParamEnum.PID), @Param(SubscribeParamEnum.PID_CHILDREN),
            @Param(SubscribeParamEnum.UID), @Param(SubscribeParamEnum.PUID),
            @Param(SubscribeParamEnum.TOP_ACTIVITY)}, updatePeriod = 4999)
    public Map<String, Object> provide() {
        Map<String, Object> result = new HashMap<>(8);

        ProcessInfo process = new ProcessInfo(0, MAIN);

        // 基础依赖
        result.put(SubscribeParamEnum.PACKAGE, appName);
        result.put(SubscribeParamEnum.UID, 0);
        result.put(SubscribeParamEnum.PID, process);
        result.put(SubscribeParamEnum.TOP_ACTIVITY, "");
        result.put(SubscribeParamEnum.PUID, "");

        Context context = LauncherApplication.getContext();
        // 全局选项，APP为空
        if (StringUtil.isEmpty(this.appName) || context == null) {
            return result;
        }

        // 根据包名查询UID
        try {
            @SuppressLint("WrongConstant")
            ApplicationInfo info = context.getPackageManager().getApplicationInfo(appName, PackageManager.GET_ACTIVITIES);

            result.put(SubscribeParamEnum.UID, info.uid);

        } catch (Exception e) {
            // 当catch到Interrupt，属于onDestroy调用，直接结束
            if (e instanceof InterruptedException) {
                LogUtil.e(TAG, "onDestroy called, Params can't update invocation methods", e);
                return result;
            }

            result.put(SubscribeParamEnum.UID, 0);
        }

        int filterPid;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            String activity = CmdTools.execAdbCmd("dumpsys window windows | grep -e \"Window #.*" + appName + "\" -A3", 1000);
            filterPid = findTopPidAfterQ(result, activity);
        } else {
            String activity = CmdTools.execAdbCmd("dumpsys activity top | grep \"ACTIVITY " + appName + "\"", 1000);
            filterPid = findTopPid(result, activity);
        }


        // 查询PID，针对该应用所有进程
        String[] pids = CmdTools.ps(appName);
        List<ProcessInfo> childrenPid = new ArrayList<>(pids.length + 1);
        List<String> childrenPackage = new ArrayList<>(pids.length + 1);

        //手动查找目标pid
        for (String lineContent : pids) {
            processPsLine(filterPid, lineContent, childrenPackage, childrenPid, result);
        }

        result.put(SubscribeParamEnum.PID_CHILDREN, childrenPid);
        result.put(SubscribeParamEnum.PACKAGE_CHILDREN, childrenPackage);

        return result;
    }

    /**
     * 通过顶层ACTIVITY查找pid
     * Android Q 之后
     * @param result
     * @param activity
     * @return
     */
    private int findTopPidAfterQ(Map<String, Object> result, String activity) {

        // 当顶层ACTIVITY存在时，以顶层PID过滤
        String trimmed;
        if (activity != null && StringUtil.isNotEmpty((trimmed = activity.trim()))) {
            String[] pidContent = trimmed.split("\\s*\n+\\s*");
            String targetLine = null;
            for (String line : pidContent) {
                if (line.contains("Session{")) {
                    targetLine = line;
                    break;
                }
            }
            String[] originActivityName = pidContent[0].split("\\s+");
            String[] topActivity = originActivityName[originActivityName.length - 1].split("/");

            LogUtil.i(TAG, "Activity:" + Arrays.toString(topActivity));
            if (topActivity.length > 1) {
                // 针对Activity是以"."开头的相对定位路径
                String mActivity = topActivity[1];
                // 尾缀fix
                if (mActivity.contains("}")) {
                    mActivity = mActivity.split("\\}")[0];
                }

                if (StringUtil.startWith(mActivity, ".")) {
                    mActivity = topActivity[0] + mActivity;
                }

                // 拼接会完整名称
                String activityName = topActivity[0] + "/" + mActivity;
                result.put(SubscribeParamEnum.TOP_ACTIVITY, activityName);

            }

            if (targetLine != null) {
                String[] pidStrs = targetLine.split("\\s+");
                String targetPidInfo = null;
                for (String pidStr: pidStrs) {
                    if (pidStr.contains(":")) {
                        targetPidInfo = pidStr.split("\\:")[0];
                    }
                }

                LogUtil.i(TAG, "Get pid info：" + targetPidInfo);
                return targetPidInfo != null? Integer.parseInt(targetPidInfo): -1;
            }

            return -1;
            // 记录过滤PID
        }
        return -1;
    }

    /**
     * 通过顶层ACTIVITY查找pid
     * @param result
     * @param activity
     * @return
     */
    private int findTopPid(Map<String, Object> result, String activity) {

        // 当顶层ACTIVITY存在时，以顶层PID过滤
        String trimmed;
        if (activity != null && !StringUtil.isEmpty((trimmed = activity.trim()))) {
            String[] pidContent = trimmed.split("\\s+");
            if (pidContent.length > 1 && pidContent[pidContent.length - 1].contains("pid=")) {
                String originActivityName = pidContent[1];
                String[] topActivity = originActivityName.split("/");

                LogUtil.i(TAG, "获取Top Activity：" + StringUtil.hide(topActivity));
                if (topActivity.length > 1) {
                    // 针对Activity是以"."开头的相对定位路径
                    String mActivity = topActivity[1];
                    if (StringUtil.startWith(mActivity, ".")) {
                        mActivity = topActivity[0] + mActivity;
                    }

                    // 拼接会完整名称
                    originActivityName = topActivity[0] + "/" + mActivity;
                }
                result.put(SubscribeParamEnum.TOP_ACTIVITY, originActivityName);

                // 记录过滤PID
                return Integer.parseInt(pidContent[pidContent.length - 1].substring(4));
            }
        }
        return -1;
    }

    /**
     * 处理单行ps
     * @param filterPid 过滤pid
     * @param lineContent ps行数据
     * @param childrenPackage 子进程package列表
     * @param childrenPid 子进程Pid列表
     * @param result 查找结果
     */
    private void processPsLine(int filterPid, String lineContent, List<String> childrenPackage, List<ProcessInfo> childrenPid, Map<String, Object> result) {
        String[] contents = lineContent.trim().split("\\s+");

        if (contents.length > 2) {
            try {
                int pid = Integer.valueOf(contents[1]);

                // 对于小程序而言，需要设置PACKAGE
                String packageName = contents[contents.length - 1];

                // 子进程名
                String target;
                if (StringUtil.startWith(packageName, appName)) {
                    target = packageName.substring(appName.length());
                    if (StringUtil.isEmpty(target)) {
                        target = MAIN;
                    } else {
                        target = target.substring(1);
                    }
                } else {
                    // 拿到grep 进程数据
                    return;
                }

                ProcessInfo processInfo = new ProcessInfo(pid, target);
                childrenPid.add(processInfo);
                childrenPackage.add(packageName);
                // 是否是目标进程
                boolean filterFlag;
                if (pid > -1) {
                    filterFlag = pid == filterPid;
                } else {
                    filterFlag = StringUtil.equals(target, MAIN);
                }

                // 如果是目标进程，保留PID，PACKAGE等信息
                if (filterFlag) {
                    result.put(SubscribeParamEnum.PID, processInfo);
                    result.put(SubscribeParamEnum.PACKAGE, packageName);

                    // PUID 指UID，与UID有不同，暂时无用
                    result.put(SubscribeParamEnum.PUID, contents[0].replace("_", ""));
                }

            } catch (Exception e) {
                LogUtil.e(TAG, "integer type of exception! contents: " + contents[1], e);
            }
        }
    }
}
