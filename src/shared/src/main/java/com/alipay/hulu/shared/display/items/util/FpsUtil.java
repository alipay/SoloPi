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
package com.alipay.hulu.shared.display.items.util;

import android.os.Build;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.bean.ProcessInfo;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.injector.provider.Provider;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

public class FpsUtil {
    private static final String TAG = "FpsUtil";

    public static final String FPS_DATA_EVENT = "fpsData";

    private static FpsUtil _instance;

    /**
     * 尝试初始化
     */
    public static synchronized void initIfNotInited() {
        if (_instance == null) {
            _instance = new FpsUtil();
        }
    }

    private InjectorService injectorService;

    /**
     * 添加监听器
     *
     * @param
     */
    public FpsUtil() {
        injectorService = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
        injectorService.register(this);
    }

    @Provider(value = @Param(FPS_DATA_EVENT), updatePeriod = 500)
    public List<FpsDataWrapper> provideFpsWrapper() {
        int referenceCount = injectorService.getReferenceCount(FPS_DATA_EVENT);

        // 当没有监听器，不运行
        if (referenceCount <= 0) {
            // 清理引用
            if (_instance != null) {
                injectorService.unregister(_instance);
                _instance = null;
            }

            return null;
        }

        long startTime = System.currentTimeMillis();

        // 根据监听器确定是否需要获取以往数据
        boolean requestPrevious = false;

        try {
            List<FpsDataWrapper> fpsDataWrappers = countUnrootFPS(appName, requestPrevious);

            LogUtil.d(TAG, "Fps 耗时 " + (System.currentTimeMillis() - startTime) + " 获得 " + fpsDataWrappers.size());
            return fpsDataWrappers;
        } catch (Exception e) {
            LogUtil.e(TAG, "Fps 抛出异常: " + e.getMessage(), e);
        } finally {
            runningFlag = false;
        }

        return null;
    }


    /**
     * 获取FPS相关数据执行器
     */
    private String appName = "";

    private String topActivity = "";

    private List<ProcessInfo> childrenPids = new ArrayList<>();

    private String proc = "";

    private String previousTopActivity = null;

    private String previousProc = null;

    private AtomicInteger reloadCount = new AtomicInteger(-1);

    /**
     * 是否正在执行
     */
    private static volatile boolean runningFlag = false;

    /**
     * 起始时间所在列
     */
    private int startPos = -1;

    /**
     * 结束时间所在列
     */
    private int endPos = -1;

    /**
     * 帧标准间隔
     */
    private static final double fpsPeriod = 16666D;


    @Subscriber(@Param(SubscribeParamEnum.APP))
    public void setApp(String app) {
        this.appName = app;
    }

    @Subscriber(@Param(SubscribeParamEnum.PID_CHILDREN))
    public void setPids(List<ProcessInfo> children) {
        this.childrenPids = children;
    }

    /**
     * 非Root环境获取Fps，jank，maxJank（也支持root环境）
     * @param app 应用名称
     * @return Fps,Jank,MaxJank,
     */
    private List<FpsDataWrapper> countUnrootFPS(String app, boolean requestPrevious) {
        Long startTime = System.currentTimeMillis();
        List<FpsDataWrapper> fpsDatas = new ArrayList<>();


        // 获取顶层Activity
        String[] actAndProc = getTopActivityAndProcess(app, childrenPids);
        LogUtil.w(TAG, "Fps get top Activity cost: " + (System.currentTimeMillis() - startTime) + "ms");

        String tmpActivity, tmpProcessName;
        if (actAndProc != null && actAndProc.length == 2) {
            tmpActivity = actAndProc[0];
            tmpProcessName = actAndProc[1];
        } else {
            tmpActivity = app;
            tmpProcessName = app;
        }

        // 发生进程切换
        if (!StringUtil.equals(tmpProcessName, proc)) {
            previousProc = proc;
            previousTopActivity = topActivity;
            reloadCount.set(4);
        }

        proc = tmpProcessName;
        topActivity = tmpActivity;

        if (requestPrevious && reloadCount.get() > 0) {
            LogUtil.w(TAG, "Load old content for " + StringUtil.hide(previousProc));
            fpsDatas.add(loadFpsDataForProc(previousTopActivity, previousProc));

            reloadCount.decrementAndGet();
        }

        LogUtil.w(TAG, "Load content for " + StringUtil.hide(proc));
        fpsDatas.add(loadFpsDataForProc(topActivity, proc));

        return fpsDatas;
    }

    /**
     * 在顶层Activity列表中查找应用的Activity
     * @param app 应用
     * @return 应用在顶层的Activity，不存在返回空字符串
     */
    private static String[] getTopActivityAndProcess(String app, List<ProcessInfo> childrenPids) {

        String cmd = "dumpsys activity top | grep \"ACTIVITY " + app + "\"";
        String[] topActivityAndPackage;
        // 每行一个Activity，切换界面时可能存在多个Activity，无法用上一行的task，可能是自定义的
        topActivityAndPackage = CmdTools.execAdbCmd(cmd, 500).split("\n");

        String topActivity = "";

        // 当找到了数据
        if (topActivityAndPackage.length > 0 && !StringUtil.isEmpty(topActivityAndPackage[0])) {
            String[] contents = topActivityAndPackage[0].trim().split("\\s+");
            String activity = contents[1];

            String[] appAndAct = activity.split("/");
            if (appAndAct.length > 1 && StringUtil.startWith(appAndAct[1], ".")) {
                activity = appAndAct[0] + "/" + appAndAct[0] + appAndAct[1];
            }

            String packageName = app;

            // 确定下pid
            String pidInfo = contents[contents.length - 1];
            int pid = 0;
            if (StringUtil.startWith(pidInfo, "pid=")) {
                pid = Integer.parseInt(pidInfo.substring(4));
            }

            // 通过pid找下实际的子进程，没找到就直接用主进程
            if (childrenPids != null && childrenPids.size() > 0) {
                for (ProcessInfo process: childrenPids) {
                    if (process.getPid() == pid) {
                        packageName = app + (StringUtil.equals(process.getProcessName(), "main") ? "" : ":" + process.getProcessName());
                        break;
                    }
                }
            }

            LogUtil.d(TAG, "Target process: %s", packageName);

            topActivityAndPackage = new String[]{activity, packageName};

        } else {
            topActivityAndPackage = new String[0];
        }

        if (topActivityAndPackage.length == 2) {
            // 特殊处理
            switch (app) {
            }
        }

        LogUtil.d(TAG, "指定应用在当前界面上的top activity是：" + topActivity);
        return topActivityAndPackage;
    }


    /**
     * 加载特定进程与Activity的fps数据
     * @param activity 顶层Activity
     * @param processName 进程名
     * @return
     */
    private FpsDataWrapper loadFpsDataForProc(String activity, String processName) {
        String result;
        long startTime = System.currentTimeMillis();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {

            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
                // 如果topActivity存在，查找Activity对应的Profile Data
                result = CmdTools.execAdbCmd("dumpsys gfxinfo " + processName + " | grep '" + activity + "' -A129 | grep Draw -B1 -A128", 1000);
            } else {
                // 如果topActivity存在，并且版本在5.0及以上，可以通过visibility进行过滤，查找Activity对应的Profile Data
                result = CmdTools.execAdbCmd("dumpsys gfxinfo " + processName + " | grep '" + activity + ".*visibility=0' -A129 | grep Draw -B1 -A128", 1000);
            }
            LogUtil.w(TAG, "Fps get gfxinfo cost: " + (System.currentTimeMillis() - startTime) + "ms");

            /**
             * 结果样式：
             * XXXX/XXXX.AAA/VVVV (visibility=0) 对应Activity
             * Draw	    Prepare	Process	Execute
             * 7.31	    5.07	6.63	0.99 每一行数据加起来，为该帧耗时
             * 50.00	21.64	44.89	6.06
             * 50.00	10.52	6.58	2.79
             * 20.21	2.36	6.78	2.51
             * 33.46	0.62	13.44	1.24
             * 10.30	0.21	6.07	1.55
             * 50.00	11.42	10.51	3.61
             * 0.84	    7.79	15.48	32.71
             * 7.56	    0.80	11.23	1.56
             * 46.13	2.58	7.29	1.16
             * 50.00	3.66	12.06	1.49
             * 12.26	0.31	5.29	0.84
             * 2.97	    1.14	8.17	1.62
             * 6.26	    0.84	9.47	2.72
             * ......
             */
            //Log.e(TAG, result);
            String[] draws = result.split("\n");
            int start = 1;
            //Log.i(TAG, "receive response: " + Arrays.toString(draws));
            if (draws.length < 3) {
                return new FpsDataWrapper(processName, activity, 0, 0, 0, 0, null, null);
            }

            int currentState = 1;

            // 状态码
            // 1: 查找Draw
            // 2: 进入其他进程
            // 如果第二行不是4列数字，说明该Activity无数据，查找下一个有数据的Activity对应数据
            while (!draws[start + 1].contains(".")) {
                int previousStart = start;
                for (int i = start + 1; i < draws.length; i++) {
                    // 跳入其他pid
                    if (StringUtil.startWith(draws[i], "**")) {
                        if (!StringUtil.contains(draws[i], appName)) {
                            currentState = 2;
                        } else {
                            currentState = 1;
                        }
                        continue;
                    }
                    if (currentState == 1 && draws[i].contains("Draw")) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            // 对于5.0及以上设备，需保证ACTIVITY为可见状态
                            if (!draws[i - 1].contains("visibility=0")) {
                                continue;
                            }
                        }
                        start = i;
                        break;
                    }
                }

                if (start == previousStart) {
                    break;
                }
            }

            // 没有找到数据
            if (start == draws.length - 1) {
                return new FpsDataWrapper(processName, activity, 0, 0, 0, 0, null, null);
            }

            String[] packageNameSplit = draws[start - 1].split("/");
            activity = draws[start - 1];
            if (packageNameSplit.length > 2) {
                activity = packageNameSplit[0] + "/" + packageNameSplit[1];
            } else if (activity.length() == 2) {
                activity = packageNameSplit[0];
            }

            List<Float> jankList = new ArrayList<>();
            try {
                for (int i = start + 1; i < draws.length; i++) {
                    String draw = draws[i];
                    String[] contents = draw.split("\\s+");
                    // 循环到不存在数据
                    if (contents.length < 3) {
                        break;
                    }
                    float jank = 0;

                    // 总耗时为一行数据的和
                    for (String content : contents) {
                        if (StringUtil.isEmpty(content)) {
                            continue;
                        }

                        jank += Float.parseFloat(content);
                    }
                    LogUtil.d(TAG, "jank: " + jank);
                    jankList.add(jank);
                }
            } catch (NumberFormatException e) {
                LogUtil.e(TAG, "Catch NumberFormatException: " + e.getMessage(), e);
            }
            float maxJank = 0;
            int leftFrame = 60;
            int jankFrame = 0;
            int totalCount = 0;
            int jankCount = 0;

            // 从最后一位向上计数，直到耗时满足60帧
            for (int position = jankList.size() - 1; position > -1; position--) {
                float jankTime = jankList.get(position);
                totalCount++;
                int count = (int) Math.ceil(jankTime * 1000 / fpsPeriod);
                if (jankTime > maxJank) {
                    maxJank = jankTime;
                }
                if (count > 1) {
                    jankCount++;
                }
                if (leftFrame > count) {
                    jankFrame += count - 1;
                    leftFrame -= count;
                } else {
                    jankFrame += leftFrame;
                    break;
                }
            }

            LogUtil.w(TAG, "Fps result cost: " + (System.currentTimeMillis() - startTime) + "ms");

            LogUtil.d(TAG, "Total period: " + totalCount + "/Expect period: " + jankList.size());
            if (jankList.size() == 0) {
                return new FpsDataWrapper(processName, activity, 0, 0, 0, 0, null, null);
            }

            return new FpsDataWrapper(processName, activity, 60 - jankFrame, jankCount, (int) maxJank, jankCount / (float) totalCount * 100, null, null);
        } else {
            result = CmdTools.execAdbCmd("dumpsys gfxinfo " + processName + " framestats| grep '" + activity + "' -A280", 1000);

            //Log.e(TAG, result);
            String[] draws = result.split("\n");
            int start = 0;

            if (draws.length < 3) {
                return new FpsDataWrapper(processName, activity, 0, 0, 0, 0, null, null);
            }

            int currentState = 1;

            // 状态码
            // 1: 查找Activity
            // 2: 查找---PROFILEDATA---开始
            // 3: 查找---PROFILEDATA---结束
            // 如果第二行不是4列数字，说明该Activity无数据，查找下一个有数据的Activity对应数据
            while (!draws[start].contains("---PROFILEDATA---")) {
                int previousStart = start;
                for (int i = start; i < draws.length; i++) {
                    // 跳入其他pid
                    if (currentState == 1 && draws[i].contains(activity)) {
                        currentState = 2;
                        continue;
                    }
                    if (currentState == 2 && draws[i].contains("---PROFILEDATA---")) {
                        start = i;
                        currentState = 3;
                        break;
                    }
                }

                if (start == previousStart) {
                    break;
                }
            }

            if (startPos == -1 || endPos == -1) {
                String[] titleLine = draws[start + 1].split(",");
                for (int i = 0; i < titleLine.length; i++) {
                    if (StringUtil.equals(titleLine[i], "IntendedVsync")) {
                        startPos = i;
                    } else if (StringUtil.equals(titleLine[i], "FrameCompleted")) {
                        endPos = i;
                    }
                }
            }

            List<Long> startRenderTimes = new ArrayList<>();
            List<Long> endRenderTimes = new ArrayList<>();
            long currentTime = System.currentTimeMillis();
            for (int i = start + 2; i < draws.length; i++) {
                String currentLine = draws[i];

                String[] splitted = StringUtil.split(currentLine, ",");

                if (splitted == null || splitted.length < 5) {
                    break;
                }

                if (!StringUtil.startWith(currentLine, "0")) {
                    continue;
                }

                long startRenderTime = Long.parseLong(splitted[startPos]) / 1000;
                long endRenderTime = Long.parseLong(splitted[endPos]) / 1000;

                startRenderTimes.add(startRenderTime);
                endRenderTimes.add(endRenderTime);
            }

            if (startRenderTimes.size() == 0) {
                return new FpsDataWrapper(processName, activity, 0, 0, 0, 0, startRenderTimes, endRenderTimes);
            }

            int lastPos = startRenderTimes.size() - 1;
            long filter = endRenderTimes.get(lastPos) - 1000000L;

            int totalCount = 0;
            long maxJank = 0;
            int jankCount = 0;
            int jankVsyncCount = 0;

            int position;
            // 从最后一位向上计数，直到耗时满足60帧
            for (position = lastPos; position > -1 && startRenderTimes.get(position) > filter; position--) {
                long jankTime = endRenderTimes.get(position) - startRenderTimes.get(position);
                totalCount++;
                int count = (int) Math.ceil(jankTime / fpsPeriod);
                if (jankTime > maxJank) {
                    maxJank = jankTime;
                }
                if (count > 1) {
                    jankCount++;
                }
                jankVsyncCount += count;
            }

            // 可能存在只有一部分数据的情况
            int fps = jankVsyncCount < 60?  60 - jankVsyncCount + totalCount: totalCount;

            return new FpsDataWrapper(processName, activity, fps, jankCount, (int) Math.ceil(maxJank / 1000F), jankCount / (float) totalCount * 100, startRenderTimes, endRenderTimes);
        }
    }

    public static class FpsDataWrapper {
        public String proc;
        public String activity;
        public int fps;
        public int junkCount;
        public int maxJunk;
        public float junkPercent;

        public List<Long> startRenderTime;
        public List<Long> finishRenderTime;

        public FpsDataWrapper(String proc, String activity, int fps, int junkCount, int maxJunk, float junkPercent, List<Long> startRenderTime, List<Long> finishRenderTime) {
            this.proc = proc;
            this.activity = activity;
            this.fps = fps;
            this.junkCount = junkCount;
            this.maxJunk = maxJunk;
            this.junkPercent = junkPercent;
            this.startRenderTime = startRenderTime;
            this.finishRenderTime = finishRenderTime;
        }
    }
}
