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


	private static Long lastAppTime = 0L;
	private static long lastAppRx = 0;
	private static long lastAppTx = 0;

	private static long startAppRx = 0;
	private static long startAppTx = 0;

	private static Long startTime;

	private static List<RecordPattern.RecordItem> downloadRecord;

	private static List<RecordPattern.RecordItem> downloadRecordAll;

	private static List<RecordPattern.RecordItem> downloadAppRecord;

	private static List<RecordPattern.RecordItem> downloadAppRecordAll;

	private static List<RecordPattern.RecordItem> uploadRecord;

	private static List<RecordPattern.RecordItem> uploadRecordAll;

	private static List<RecordPattern.RecordItem> uploadAppRecord;

	private static List<RecordPattern.RecordItem> uploadAppRecordAll;

	private Integer uid = 0;

	@Subscriber(@Param(SubscribeParamEnum.UID))
	public void setUid(Integer uid) {
		this.uid = uid;
	}

	@Override
	public String getCurrentInfo() {
		if (uid != null && uid > 0) {
			float[] value = getAppResult(uid);
			return String.format("app:下%.1fK/累计%.1fK\napp:上%.1fK/累计%.1fK", value[0], value[1], value[2], value[3]);
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

	//	@TargetApi(Build.VERSION_CODES.M)
//	public long getMAppRx() {
//		NetworkStatsManager networkStatsManager = (NetworkStatsManager) context.getSystemService(NETWORK_STATS_SERVICE);
//		networkStatsManager.queryDetailsForUid()
//	}


	@Override
	public void startRecord() {
		startTime = System.currentTimeMillis();
		downloadRecord = new ArrayList<>();
		downloadRecordAll = new ArrayList<>();
		downloadAppRecordAll = new ArrayList<>();
		downloadAppRecord = new ArrayList<>();

		uploadRecord = new ArrayList<>();
		uploadRecordAll = new ArrayList<>();
		uploadAppRecordAll = new ArrayList<>();
		uploadAppRecord = new ArrayList<>();

		startRx = 0;
		startAppRx = 0;

		startTx = 0;
		startAppTx = 0;
	}

	@Override
	public void record() {
		if (uid != null && uid > 0) {
			float[] results = getAppResult(uid);
			downloadAppRecordAll.add(new RecordPattern.RecordItem(System.currentTimeMillis(), results[1], ""));
			downloadAppRecord.add(new RecordPattern.RecordItem(System.currentTimeMillis(), results[0], ""));

			uploadAppRecordAll.add(new RecordPattern.RecordItem(System.currentTimeMillis(), results[3], ""));
			uploadAppRecord.add(new RecordPattern.RecordItem(System.currentTimeMillis(), results[2], ""));

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
		pattern = new RecordPattern("累计应用下行流量", "KB", "Network");
		pattern.setEndTime(endTime);
		pattern.setStartTime(startTime);
		result.put(pattern, downloadAppRecordAll);
		pattern = new RecordPattern("应用下行速率", "KB", "Network");
		pattern.setEndTime(endTime);
		pattern.setStartTime(startTime);
		result.put(pattern, downloadAppRecord);

		pattern = new RecordPattern("累计全局上行流量", "KB", "Network");
		pattern.setEndTime(endTime);
		pattern.setStartTime(startTime);
		result.put(pattern, uploadRecordAll);
		pattern = new RecordPattern("全局上行速率", "KB", "Network");
		pattern.setEndTime(endTime);
		pattern.setStartTime(startTime);
		result.put(pattern, uploadRecord);
		pattern = new RecordPattern("累计应用上行流量", "KB", "Network");
		pattern.setEndTime(endTime);
		pattern.setStartTime(startTime);
		result.put(pattern, uploadAppRecordAll);
		pattern = new RecordPattern("应用上行速率", "KB", "Network");
		pattern.setEndTime(endTime);
		pattern.setStartTime(startTime);
		result.put(pattern, uploadAppRecord);

		downloadRecordAll = null;
		downloadRecord = null;
		downloadAppRecordAll = null;
		downloadAppRecord = null;
		uploadRecordAll = null;
		uploadRecord = null;
		uploadAppRecordAll = null;
		uploadAppRecord = null;
		return result;
	}

	public static float[] getAppResult(int uid) {
		String[] cmds;
		/**
		 * /proc/net/xt_qtaguid/stats 记录各应用网络自开机使用情况
		 * 每一行数据:
		 * 26 wlan0 0x0 10039 0 10143 20 3061 27 10143 20 0 0 0 0 3061 27 0 0 0 0
		 * 第一列为UID，第6和8列为 rx_bytes（接收数据）和tx_bytes（传输数据）
		 */
		cmds = CmdTools.execAdbCmd("cat /proc/net/xt_qtaguid/stats | grep " + uid, 0).split("\n");
		Long currentTime = System.currentTimeMillis();
		Long rxTotal = 0L;
		Long txTotal = 0L;
		for (String cmd: cmds) {
			String[] data = cmd.trim().split("\\s+");
			if (data.length > 8) {
				rxTotal += Long.parseLong(data[5]);
				txTotal += Long.parseLong(data[7]);
			}
		}

		LogUtil.i(TAG, "get Total Rx: " + rxTotal + " | get Total Tx: " + txTotal);

		float rxSpeed = (rxTotal - lastAppRx) * KB_MILLION_SECOND / (currentTime - lastAppTime);
		if (rxSpeed >= 0) {
			lastAppRx = rxTotal;
		} else {
			rxSpeed = 0F;
		}
		float txSpeed = (txTotal - lastAppTx) * KB_MILLION_SECOND / (currentTime - lastAppTime);
		if (txSpeed >= 0) {
			lastAppTx = txTotal;
		} else {
			txSpeed = 0F;
		}
		lastAppTime = currentTime;
		LogUtil.d(TAG, "加载Rx: %f, Tx: %f", rxSpeed, txSpeed);

		if (startAppRx == 0 || startAppTx == 0) {
			startAppRx = lastAppRx;
			startAppTx = lastAppTx;
		}

		if (triggerReload) {
			startAppRx = lastAppRx;
			startAppTx = lastAppTx;
			triggerReload = false;
		}

		return new float[]{rxSpeed, (lastAppRx - startAppRx) / 1024F, txSpeed, (lastAppTx - startAppTx) / 1024F};
	}

	@Override
	public long getRefreshFrequency() {
		return 400;
	}

	@Override
	public void clear() {
		downloadRecordAll = null;
		downloadRecord = null;
		downloadAppRecordAll = null;
		downloadAppRecord = null;
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
