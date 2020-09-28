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
package com.alipay.hulu.shared.display.items;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.bean.ProcessInfo;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.shared.display.items.base.DisplayItem;
import com.alipay.hulu.shared.display.items.base.Displayable;
import com.alipay.hulu.shared.display.items.base.FixedLengthCircularArray;
import com.alipay.hulu.shared.display.items.base.RecordPattern;
import com.alipay.hulu.shared.display.items.util.FinalR;

import java.text.DecimalFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@DisplayItem(nameRes = FinalR.PROCESS_STATUS, key = "Status", permissions = "adb")
public class StatusTools implements Displayable {
    private static final String TAG = StatusTools.class.getSimpleName();

    private static Long startTime = 0L;

    private ProcessInfo pid = null;
    private List<ProcessInfo> pids = null;

    private static boolean processChanged = true;

    private static final int CACHE_LENGTH = 10;
    private static int preserveCount = CACHE_LENGTH;
    private static ProcessInfo previousPid = null;

    private static Map<String, List<RecordPattern.RecordItem>> appThreadCount;
    private static Map<String, List<RecordPattern.RecordItem>> appVmSize;
    private static Map<String, List<RecordPattern.RecordItem>> appVmRSS;
    private static Map<String, FixedLengthCircularArray<RecordPattern.RecordItem>> threadsCountCachedData;
    private static Map<String, FixedLengthCircularArray<RecordPattern.RecordItem>> appVmSizeCachedData;
    private static Map<String, FixedLengthCircularArray<RecordPattern.RecordItem>> appVmRSSCachedData;

    private InjectorService service;
    private DecimalFormat mFormat;

    @Subscriber(@Param(SubscribeParamEnum.PID))
    public void setPid(ProcessInfo pid){
        if (pid != null && (this.pid == null || pid.getPid() != this.pid.getPid())) {
            previousPid = pid;
            processChanged = true;
            preserveCount = CACHE_LENGTH;
            this.pid = pid;
        }
    }

    @Subscriber(@Param(SubscribeParamEnum.PID_CHILDREN))
    public void setPids(List<ProcessInfo> pids){
        this.pids = pids;
    }

    @Override
    public void start() {
        service = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
        service.register(this);
        String style = "0.00";
        mFormat = new DecimalFormat();
        mFormat.applyPattern(style);
    }

    @Override
    public void stop() {
        service.unregister(this);
        service = null;
    }

    @Override
    public String getCurrentInfo() throws Exception {
        if (pid != null && pid.getPid() > 0) {
            try {
                String content;
                StringBuilder cmd = new StringBuilder("grep -E 'VmSize|VmRSS|Threads' /proc/").append(pid.getPid()).append("/status");
                LogUtil.d(TAG, "cmd: %s", cmd);
                content = CmdTools.execAdbCmd(cmd.toString(), 0);
                LogUtil.d(TAG, "close reader, result: %s", content);
                if (content != null) {
                    String[] lines = content.split("\n");
                    StringBuilder sb = new StringBuilder();
                    for (String line: lines) {
                        String curContent = "";
                        if (line.trim().startsWith("VmSize")) {
                            curContent = line.replaceAll("\\D", "").trim();
                            float num = Float.parseFloat(curContent) / 1024f;
                            sb.append("VmSize: ").append(mFormat.format(num)).append("MB\n");
                        } else if (line.trim().startsWith("VmRSS")) {
                            curContent = line.replaceAll("\\D", "").trim();
                            float num = Float.parseFloat(curContent) / 1024f;
                            sb.append("VmRSS: ").append(mFormat.format(num)).append("MB\n");
                        } else if (line.trim().startsWith("Threads")) {
                            curContent = line.replaceAll("\\D", "").trim();
                            sb.append("ThreadCount: ").append(curContent);
                        }
                    }
                    return sb.toString();
                }
            } catch (Exception e) {
                LogUtil.e(TAG, "Catch Exception: " + e.getMessage(), e);
            }
        }
        return "未关联目标进程";
    }

    @Override
    public long getRefreshFrequency() {
        return 20;
    }

    @Override
    public void clear() {

        if (appVmSizeCachedData != null) {
            appVmSizeCachedData.clear();
        }
        appVmSizeCachedData = null;

        if (appVmSize != null) {
            appVmSize.clear();
        }
        appVmSize = null;

        if (appVmRSSCachedData != null) {
            appVmRSSCachedData.clear();
        }
        appVmRSSCachedData = null;

        if (appVmRSS != null) {
            appVmRSS.clear();
        }
        appVmRSS = null;

        if (threadsCountCachedData != null) {
            threadsCountCachedData.clear();
        }
        threadsCountCachedData = null;

        if (appThreadCount != null) {
            appThreadCount.clear();
        }
        appThreadCount = null;
    }

    @Override
    public void startRecord() {
        startTime = System.currentTimeMillis();

        appVmSizeCachedData = new HashMap<>();
        appVmSize = new HashMap<>();

        appVmRSSCachedData = new HashMap<>();
        appVmRSS = new HashMap<>();

        threadsCountCachedData = new HashMap<>();
        appThreadCount = new HashMap<>();
    }

    @Override
    public void record() {
        if (pids != null && pids.size() > 0 && pid != null) {
            int[] pidArray = new int[pids.size()];
            String[] processNames = new String[pids.size()];
            int count = 0;
            for (int i = 0; i < pids.size(); i++) {
                pidArray[i] = pids.get(i).getPid();
                processNames[i] = pids.get(i).getProcessName() + "-" + pidArray[i];
                count++;
            }

            if (count < pids.size()) {
                LogUtil.w(TAG, "Pid list resized, from " + pids.size() + " to " + count);
                int[] newArray = new int[count];
                System.arraycopy(pidArray, 0, newArray, 0, count);
                pidArray = newArray;
            }

            float[] result = getProcessesStatus(pidArray);

            if (result.length == 0) {
                return;
            }

            for (int i = 0; i < pidArray.length; i++) {
                int pid = pidArray[i];
                String processName = processNames[i];
                RecordPattern.RecordItem vmSizeRecord = new RecordPattern.RecordItem(System.currentTimeMillis(), result[i*3], "");
                RecordPattern.RecordItem vmRSSRecord = new RecordPattern.RecordItem(System.currentTimeMillis(), result[i*3+1], "");
                RecordPattern.RecordItem threadRecord = new RecordPattern.RecordItem(System.currentTimeMillis(), result[i*3+2], "");

                if (!appVmSizeCachedData.containsKey(processName)) {
                    appVmSizeCachedData.put(processName, new FixedLengthCircularArray<RecordPattern.RecordItem>(CACHE_LENGTH));
                }
                if (!appVmRSSCachedData.containsKey(processName)) {
                    appVmRSSCachedData.put(processName, new FixedLengthCircularArray<RecordPattern.RecordItem>(CACHE_LENGTH));
                }
                if (!threadsCountCachedData.containsKey(processName)) {
                    threadsCountCachedData.put(processName, new FixedLengthCircularArray<RecordPattern.RecordItem>(CACHE_LENGTH));
                }

                // 如果当前进程是目标进程
                if (pid == this.pid.getPid()) {
                    List<RecordPattern.RecordItem> vssRecord;
                    if ((vssRecord = appVmSize.get(processName)) == null) {
                        vssRecord = new ArrayList<>();
                        appVmSize.put(processName, vssRecord);
                    }

                    List<RecordPattern.RecordItem> rssRecord;
                    if ((rssRecord = appVmRSS.get(processName)) == null) {
                        rssRecord = new ArrayList<>();
                        appVmRSS.put(processName, rssRecord);
                    }

                    List<RecordPattern.RecordItem> threadCountRecord;
                    if ((threadCountRecord = appThreadCount.get(processName)) == null) {
                        threadCountRecord = new ArrayList<>();
                        appThreadCount.put(processName, threadCountRecord);
                    }

                    if (processChanged) {
                        Collections.addAll(vssRecord, appVmSizeCachedData.get(processName).getAllItems(new RecordPattern.RecordItem[0]));
                        Collections.addAll(rssRecord, appVmRSSCachedData.get(processName).getAllItems(new RecordPattern.RecordItem[0]));
                        Collections.addAll(threadCountRecord, threadsCountCachedData.get(processName).getAllItems(new RecordPattern.RecordItem[0]));
                        processChanged = false;
                    }

                    vssRecord.add(vmSizeRecord);
                    rssRecord.add(vmRSSRecord);
                    threadCountRecord.add(threadRecord);
                } else if (previousPid != null && pid == previousPid.getPid() && preserveCount > 0) {
                    List<RecordPattern.RecordItem> previousVssRecord = appVmSize.get(processName);
                    if (previousVssRecord == null) {
                        LogUtil.e(TAG, "Record item for pid " + pid +  " disappeared");
                        continue;
                    }
                    previousVssRecord.add(vmSizeRecord);

                    List<RecordPattern.RecordItem> previousRssRecord = appVmRSS.get(processName);
                    if (previousRssRecord == null) {
                        LogUtil.e(TAG, "Record item for pid " + pid +  " disappeared");
                        continue;
                    }
                    previousRssRecord.add(vmRSSRecord);

                    List<RecordPattern.RecordItem> previousThreadRecord = appThreadCount.get(processName);
                    if (previousThreadRecord == null) {
                        LogUtil.e(TAG, "Record item for pid " + pid +  " disappeared");
                        continue;
                    }
                    previousThreadRecord.add(threadRecord);

                    preserveCount--;
                }
                appVmSizeCachedData.get(processName).addItem(vmSizeRecord);
                appVmRSSCachedData.get(processName).addItem(vmRSSRecord);
                threadsCountCachedData.get(processName).addItem(threadRecord);
            }
        }
    }

    @Override
    public void trigger() {

    }

    @Override
    public Map<RecordPattern, List<RecordPattern.RecordItem>> stopRecord() {
        Map<RecordPattern, List<RecordPattern.RecordItem>> result = new HashMap<>();
        Long endTime = System.currentTimeMillis();
        RecordPattern pattern;

        if (appVmSize != null && appVmSize.size() > 0) {
            for (String processName : appVmSize.keySet()) {
                List<RecordPattern.RecordItem> appCurrent = appVmSize.get(processName);
                pattern = new RecordPattern("应用进程-" + processName, "MB", "VmSize");
                pattern.setStartTime(startTime);
                pattern.setEndTime(endTime);
                result.put(pattern, appCurrent);
            }
            appVmSize.clear();
            appVmSizeCachedData.clear();
        }

        if (appVmRSS != null && appVmRSS.size() > 0) {
            for (String processName : appVmRSS.keySet()) {
                List<RecordPattern.RecordItem> appCurrent = appVmRSS.get(processName);
                pattern = new RecordPattern("应用进程-" + processName, "MB", "VmRSS");
                pattern.setStartTime(startTime);
                pattern.setEndTime(endTime);
                result.put(pattern, appCurrent);
            }
            appVmRSS.clear();
            appVmRSSCachedData.clear();
        }

        if (appThreadCount != null && appThreadCount.size() > 0) {
            for (String processName : appThreadCount.keySet()) {
                List<RecordPattern.RecordItem> appCurrent = appThreadCount.get(processName);
                pattern = new RecordPattern("应用进程-" + processName, "个", "ThreadCount");
                pattern.setStartTime(startTime);
                pattern.setEndTime(endTime);
                result.put(pattern, appCurrent);
            }
            appThreadCount.clear();
            threadsCountCachedData.clear();
        }
        return result;
    }


    private static float[] getProcessesStatus(int[] pids) {
        try {
            String appLines;
            StringBuilder cmd = new StringBuilder("grep -E 'VmSize|VmRSS|Threads' ");
            for (int pid: pids) {
                cmd.append("/proc/").append(pid).append("/status ");
            }

            LogUtil.d(TAG, "cmd: %s", cmd);
            appLines = CmdTools.execAdbCmd(cmd.toString(), 0);
            LogUtil.d(TAG, "close reader, result: %s", appLines);

            String[] origin = appLines.split("\n");
            float[] result = new float[3 * pids.length];
            for (int i = 0; i < origin.length; i+=3) {
                result[i] = Float.parseFloat(origin[i].split("\t")[1].replaceAll("\\D", "").trim()) / 1024f;
                result[i+1]= Float.parseFloat(origin[i+1].split("\t")[1].replaceAll("\\D", "").trim()) / 1024f;
                result[i+2] = Float.parseFloat(origin[i+2].split("\t")[1].replaceAll("\\D", "").trim());
            }
            return result;
        } catch (Exception e) {
            LogUtil.e(TAG, "Catch Exception: " + e.getMessage(), e);
            return new float[0];
        }
    }

}
