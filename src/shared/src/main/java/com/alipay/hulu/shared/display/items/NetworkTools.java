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

import android.net.TrafficStats;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.bean.ProcessInfo;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.shared.R;
import com.alipay.hulu.shared.display.items.base.DisplayItem;
import com.alipay.hulu.shared.display.items.base.Displayable;
import com.alipay.hulu.shared.display.items.base.RecordPattern;
import com.alipay.hulu.shared.display.items.util.FinalR;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@DisplayItem(nameRes = FinalR.NETWORK, trigger = "清零")
public class NetworkTools implements Displayable{

	private static final float KB_MILLION_SECOND = 1000 / 1024f;

	private static final String TAG = "Network";

	private InjectorService injectorService;

	private static long lastRxTime = 0;
	private static long lastTxTime = 0;
	private static long lastRx = 0;
	private static long lastTx = 0;

	private static boolean triggerReload = false;

	private static long startRx = 0;
	private static long startTx = 0;

	private ProcessInfo currentProcess;

	private List<ProcessInfo> allChildrenProcesses;


	private static Map<Integer, long[]> appRecords = new HashMap<>();
	private static Long startTime;

	private static List<RecordPattern.RecordItem> downloadRecord;

	private static List<RecordPattern.RecordItem> downloadRecordAll;

	private static List<RecordPattern.RecordItem> uploadRecord;

	private static List<RecordPattern.RecordItem> uploadRecordAll;

	private static Map<String, List<RecordPattern.RecordItem>> downloadSpeedProcessRecords;
	private static Map<String, List<RecordPattern.RecordItem>> downloadSizeProcessRecords;
	private static Map<String, List<RecordPattern.RecordItem>> uploadSpeedProcessRecords;
	private static Map<String, List<RecordPattern.RecordItem>> uploadSizeProcessRecords;

	@Subscriber(@Param(SubscribeParamEnum.PID))
	public void setCurrentProcess(ProcessInfo process) {
		this.currentProcess = process;
	}

    @Subscriber(@Param(SubscribeParamEnum.PID_CHILDREN))
    public void setChildrenProcesses(List<ProcessInfo> processes) {
        this.allChildrenProcesses = processes;
    }

	@Override
	public String getCurrentInfo() {
		if (currentProcess != null && currentProcess.getPid() > 0) {
			float[] value = getProcessData(new int[] {currentProcess.getPid()});
			return String.format("%s:下%.1fK/累计%.1fK\n%s:上%.1fK/累计%.1fK", currentProcess.getProcessName(), value[0], value[1], currentProcess.getProcessName(), value[2], value[3]);
		}

		if (triggerReload) {
			startTx = lastTx;
			startRx = lastRx;

			triggerReload = false;
		}
		return String.format("total:下%.1fK/累计%.1fK\ntotal:上%.1fK/累计%.1fK", getRxTotal(), getRxAll(), getTxTotal(), getTxAll());
	}

	@Override
	public void start() {
		injectorService = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
		injectorService.register(this);
	}

	@Override
	public void stop() {
		injectorService.unregister(this);
		injectorService = null;
	}


	@Override
	public void startRecord() {
		startTime = System.currentTimeMillis();
		downloadRecord = new ArrayList<>();
		downloadRecordAll = new ArrayList<>();

		uploadRecord = new ArrayList<>();
		uploadRecordAll = new ArrayList<>();

		downloadSizeProcessRecords = new HashMap<>();
		downloadSpeedProcessRecords = new HashMap<>();
		uploadSizeProcessRecords = new HashMap<>();
		uploadSpeedProcessRecords = new HashMap<>();
		appRecords.clear();

		startRx = 0;
		startTx = 0;
	}

	@Override
	public void record() {
		if (allChildrenProcesses != null && allChildrenProcesses.size() > 0) {
			List<ProcessInfo> processes = allChildrenProcesses;
			int[] pids = new int[processes.size()];
			int idx = 0;
			for (ProcessInfo processInfo: processes) {
				pids[idx++] = processInfo.getPid();
			}
			float[] results = getProcessData(pids);
			for (int i = 0; i < processes.size(); i++) {
				ProcessInfo process = processes.get(i);
				String processName =  process.getProcessName() + "-" + process.getPid();
				List<RecordPattern.RecordItem> downloadSpeed = downloadSpeedProcessRecords.get(processName);
				if (downloadSpeed == null) {
					downloadSpeed = new ArrayList<>();
					downloadSpeedProcessRecords.put(processName, downloadSpeed);
				}
				downloadSpeed.add(new RecordPattern.RecordItem(System.currentTimeMillis(), results[4 * i], ""));
				List<RecordPattern.RecordItem> downloadSize = downloadSizeProcessRecords.get(processName);
				if (downloadSize == null) {
					downloadSize = new ArrayList<>();
					downloadSizeProcessRecords.put(processName, downloadSize);
				}
				downloadSize.add(new RecordPattern.RecordItem(System.currentTimeMillis(), results[4 * i + 1], ""));
				List<RecordPattern.RecordItem> uploadSpeed = uploadSpeedProcessRecords.get(processName);
				if (uploadSpeed == null) {
					uploadSpeed = new ArrayList<>();
					uploadSpeedProcessRecords.put(processName, uploadSpeed);
				}
				uploadSpeed.add(new RecordPattern.RecordItem(System.currentTimeMillis(), results[4 * i + 2], ""));
				List<RecordPattern.RecordItem> uploadSize = uploadSizeProcessRecords.get(processName);
				if (uploadSize == null) {
					uploadSize = new ArrayList<>();
					uploadSizeProcessRecords.put(processName, uploadSize);
				}
				uploadSize.add(new RecordPattern.RecordItem(System.currentTimeMillis(), results[4 * i + 3], ""));
			}
		}

		downloadRecordAll.add(new RecordPattern.RecordItem(System.currentTimeMillis(), getRxAll(), ""));
		downloadRecord.add(new RecordPattern.RecordItem(System.currentTimeMillis(), getRxTotal(), ""));


		uploadRecordAll.add(new RecordPattern.RecordItem(System.currentTimeMillis(), getTxAll(), ""));
		uploadRecord.add(new RecordPattern.RecordItem(System.currentTimeMillis(), getTxTotal(), ""));

	}

	@Override
	public Map<RecordPattern, List<RecordPattern.RecordItem>> stopRecord() {
		Long endTime = System.currentTimeMillis();
		Map<RecordPattern, List<RecordPattern.RecordItem>> result = new HashMap<>();
		RecordPattern pattern = new RecordPattern("累计全局下行流量", "KB", "Network");
		pattern.setEndTime(endTime);
		pattern.setStartTime(startTime);
		result.put(pattern, downloadRecordAll);
		pattern = new RecordPattern("全局下行速率", "KB", "Network");
		pattern.setEndTime(endTime);
		pattern.setStartTime(startTime);
		result.put(pattern, downloadRecord);
		if (downloadSizeProcessRecords != null && downloadSizeProcessRecords.size() > 0) {
			for (String name: downloadSizeProcessRecords.keySet()) {
				pattern = new RecordPattern("进程下行流量-" + name, "KB", "Network");
				pattern.setEndTime(endTime);
				pattern.setStartTime(startTime);
				result.put(pattern, downloadSizeProcessRecords.get(name));
			}
		}

		if (downloadSpeedProcessRecords != null && downloadSpeedProcessRecords.size() > 0) {
			for (String name: downloadSpeedProcessRecords.keySet()) {
				pattern = new RecordPattern("进程下行速率-" + name, "KB/S", "Network");
				pattern.setEndTime(endTime);
				pattern.setStartTime(startTime);
				result.put(pattern, downloadSpeedProcessRecords.get(name));
			}
		}

		pattern = new RecordPattern("累计全局上行流量", "KB", "Network");
		pattern.setEndTime(endTime);
		pattern.setStartTime(startTime);
		result.put(pattern, uploadRecordAll);
		pattern = new RecordPattern("全局上行速率", "KB", "Network");
		pattern.setEndTime(endTime);
		pattern.setStartTime(startTime);
		result.put(pattern, uploadRecord);
		if (uploadSizeProcessRecords != null && uploadSizeProcessRecords.size() > 0) {
			for (String name: uploadSizeProcessRecords.keySet()) {
				pattern = new RecordPattern("进程上行流量-" + name, "KB", "Network");
				pattern.setEndTime(endTime);
				pattern.setStartTime(startTime);
				result.put(pattern, uploadSizeProcessRecords.get(name));
			}
		}
		if (uploadSpeedProcessRecords != null && uploadSpeedProcessRecords.size() > 0) {
			for (String name: uploadSpeedProcessRecords.keySet()) {
				pattern = new RecordPattern("进程上行速率-" + name, "KB/S", "Network");
				pattern.setEndTime(endTime);
				pattern.setStartTime(startTime);
				result.put(pattern, uploadSpeedProcessRecords.get(name));
			}
		}

		downloadRecordAll = null;
		downloadRecord = null;
		uploadRecordAll = null;
		uploadRecord = null;

		downloadSizeProcessRecords = null;
		downloadSpeedProcessRecords = null;
		uploadSizeProcessRecords = null;
		uploadSpeedProcessRecords = null;

		return result;
	}

    /**
     * 加载多进程网络上下行数据
     * @param pids
     * @return
     */
    private static float[] getProcessData(int[] pids) {
        try {
            String appLines;
            StringBuilder cmd = new StringBuilder("grep 'wlan0' ");
            for (int pid: pids) {
                cmd.append("/proc/").append(pid).append("/net/dev ");
			}

			LogUtil.d(TAG, "cmd: %s", cmd);
			appLines = CmdTools.execAdbCmd(cmd.toString(), 0);
			long time = System.currentTimeMillis();
			LogUtil.d(TAG, "close reader, result: %s", appLines);

			String[] origin = appLines.split("\n");
			float[] result = new float[4 * pids.length];

			int pidPos = 0;
			for (int i = 0; i < origin.length && pidPos < pids.length; i+=1) {
				if (!origin[i].trim().startsWith("wlan0")) {
					continue;
				}
				String[] group = origin[i].split("wlan0")[1].trim().split("\\s+");
				long currentRx = Long.parseLong(group[1]);
				long currentTx = Long.parseLong(group[9]);
				long[] data = appRecords.get(pids[pidPos++]);
				if (data == null) {
					data = new long[] {currentRx, currentRx, currentTx, currentTx, time};
					appRecords.put(pids[i], data);
					result[4 * i] = 0;
					result[4 * i + 1] = 0;
					result[4 * i + 2] = 0;
					result[4 * i + 3] = 0;
				} else {
					long lastRx = data[0];
					long firstRx = data[1];
					long lastTx = data[2];
					long firstTx = data[3];
					long lastTime = data[4];
					result[4 * i] = (currentRx - lastRx) * KB_MILLION_SECOND / (time - lastTime);;
					result[4 * i + 1] = (currentRx - firstRx) / 1024F;
					result[4 * i + 2] = (currentTx - lastTx) * KB_MILLION_SECOND / (time - lastTime);;
					result[4 * i + 3] = (currentTx - firstTx) / 1024F;
					data[0] = currentRx;
					data[2] = currentTx;
					data[4] = time;
				}
			}

			return result;
		} catch (Exception e) {
			LogUtil.e(TAG, "Catch Exception: " + e.getMessage(), e);
			return new float[0];
		}
	}

	@Override
	public long getRefreshFrequency() {
		return 400;
	}

	@Override
	public void clear() {
		downloadRecordAll = null;
		downloadRecord = null;
		appRecords.clear();
	}

	public static float getRxTotal()
	{
		long currentTime = System.currentTimeMillis();
		long currentRx = TrafficStats.getTotalRxBytes();
		
		if (lastRxTime == 0 || lastRx == 0)
		{
			lastRxTime = currentTime;
			lastRx = currentRx;
			return 0;
		}
		
		float speed = (currentRx - lastRx) / (float)(currentTime - lastRxTime);
		lastRx = currentRx;
		lastRxTime = currentTime;
		
		return speed;
	}

	public static float getRxAll()
	{
		long currentRx = TrafficStats.getTotalRxBytes();

		if (triggerReload) {
			startRx = currentRx;
			triggerReload = false;
		}

		if(startRx == 0) {
			startRx = currentRx;
		}

		long speed = currentRx - startRx;

		return speed / 1024F;
	}

	public static float getTxAll()
	{
		long currentTx = TrafficStats.getTotalTxBytes();

		if(startTx == 0) {
			startTx = currentTx;
		}

		long speed = currentTx - startTx;

		if (triggerReload) {
			startTx = currentTx;
			triggerReload = false;
		}

		return speed / 1024F;
	}
	
	public static float getTxTotal()
	{
		long currentTime = System.currentTimeMillis();
		long currentTx = TrafficStats.getTotalTxBytes();

		if (lastTxTime == 0 || lastTx == 0)
		{
			lastTxTime = currentTime;
			lastTx = currentTx;
			return 0;
		}

		float speed = (currentTx - lastTx) / (float)(currentTime - lastTxTime);
		lastTx = currentTx;
		lastTxTime = currentTime;

		return speed;
	}

	@Override
	public void trigger() {
		triggerReload = true;
	}
}
