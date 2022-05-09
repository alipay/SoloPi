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

import android.app.ActivityManager;
import android.app.ActivityManager.MemoryInfo;
import android.content.Context;
import android.os.Build;
import android.os.Debug;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.bean.ProcessInfo;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.R;
import com.alipay.hulu.shared.display.items.base.DisplayItem;
import com.alipay.hulu.shared.display.items.base.Displayable;
import com.alipay.hulu.shared.display.items.base.FixedLengthCircularArray;
import com.alipay.hulu.shared.display.items.base.RecordPattern;
import com.alipay.hulu.shared.display.items.util.FinalR;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@DisplayItem(nameRes = FinalR.MEMORY, key = "Memory", permissions = "adb")
public class MemoryTools implements Displayable{

	private static String TAG = "MemoryTools";

	/**
	 * 每MB包含byte数
	 */
	public static final int BYTES_PER_MEGA = 1024 * 1024;

	private Context context;

	private ActivityManager activityManager;

	private Long totalMemory = null;

	private static Long startTime = 0L;

	private InjectorService injectorService;

	private static List<RecordPattern.RecordItem> usedMemory;

	private static Map<String, ArrayList<RecordPattern.RecordItem>[]> appMemory;

	private static Map<String, FixedLengthCircularArray<RecordPattern.RecordItem>> pssCachedData;
	private static Map<String, FixedLengthCircularArray<RecordPattern.RecordItem>> pDCachedData;

	private static boolean initFlag = false;

	static {
		System.loadLibrary("nativeModule");
	}

	private ProcessInfo pid = null;
	private String app;

	private static int cacheLength = 10;

	private static ProcessInfo previousPid = null;

	private static boolean processChangeFlag = true;

	private static int preserveCount = cacheLength;

	@Subscriber(@Param(SubscribeParamEnum.PID))
	public void setPid(ProcessInfo pid){
		if (pid != null && (this.pid == null || pid.getPid() != this.pid.getPid())) {
			previousPid = pid;
			processChangeFlag = true;
			preserveCount = cacheLength;
			this.pid = pid;
		}
	}

	@Subscriber(@Param(SubscribeParamEnum.APP))
	public void setApp(String app) {
		this.app = app;
	}

	private List<ProcessInfo> pids = null;

	@Subscriber(@Param(SubscribeParamEnum.PID_CHILDREN))
	public void setPids(List<ProcessInfo> pids){
		this.pids = pids;
	}

	@Override
	public void start() {
		injectorService = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
		injectorService.register(this);
		this.context = LauncherApplication.getContext();
		activityManager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
	}

	@Override
	public void stop() {
		injectorService.unregister(this);
		injectorService = null;
	}

	@Override
	public void clear() {
		activityManager = null;
		context = null;
		usedMemory = null;
		if (appMemory != null) {
			appMemory.clear();
		}
		if (pssCachedData != null) {
			pssCachedData.clear();
		}

		if (pDCachedData != null) {
			pDCachedData.clear();
		}

		appMemory = null;
		pssCachedData = null;
		pDCachedData = null;
	}

	@Override
	public void startRecord() {
		startTime = System.currentTimeMillis();
		usedMemory = new ArrayList<>();
		appMemory = new HashMap<>();
		pssCachedData = new HashMap<>();
		pDCachedData = new HashMap<>();
	}

	@Override
	public void record() {
		if (pids != null && pids.size() > 0 && pid != null) {
			String[] processNames = new String[pids.size()];
			for (int i = 0; i < pids.size(); i++) {
				processNames[i] = pids.get(i).getProcessName() + "-" + pids.get(i).getPid();
			}

			int[] results = getPssAndPDList(pids);
			if (results != null && results.length == pids.size() * 2) {
				for (int i = 0; i < pids.size(); i++) {
					int pid = pids.get(i).getPid();
					FixedLengthCircularArray<RecordPattern.RecordItem> pssCache;
					FixedLengthCircularArray<RecordPattern.RecordItem> pDCache;
					if ((pssCache = pssCachedData.get(processNames[i])) == null) {
						pssCache = new FixedLengthCircularArray<>(cacheLength);
						pssCachedData.put(processNames[i], pssCache);
					}
					if ((pDCache = pDCachedData.get(processNames[i])) == null) {
						pDCache = new FixedLengthCircularArray<>(cacheLength);
						pDCachedData.put(processNames[i], pDCache);
					}

					// 当前记录
					RecordPattern.RecordItem[] record = new RecordPattern.RecordItem[]{
							new RecordPattern.RecordItem(System.currentTimeMillis(), results[2 * i] / 1024f, ""),
							new RecordPattern.RecordItem(System.currentTimeMillis(), results[2 * i + 1] / 1024f, "")};

					// 如果是当前pid
					if (pid == this.pid.getPid()) {
						// 保证记录存在
						ArrayList<RecordPattern.RecordItem>[] saveRecord;
						if ((saveRecord = appMemory.get(processNames[i])) == null) {
							saveRecord = new ArrayList[]{new ArrayList<RecordPattern.RecordItem>(), new ArrayList<RecordPattern.RecordItem>()};
							appMemory.put(processNames[i], saveRecord);
						}

						// 切换来的数据，需要填充前10个记录
						if (processChangeFlag) {
							RecordPattern.RecordItem[] pidPssCache = pssCache.getAllItems(new RecordPattern.RecordItem[0]);
							Collections.addAll(saveRecord[0], pidPssCache);

							RecordPattern.RecordItem[] pidPDCache = pDCache.getAllItems(new RecordPattern.RecordItem[0]);
							Collections.addAll(saveRecord[1], pidPDCache);
							processChangeFlag = false;
						}

						// 记录数据
						saveRecord[0].add(record[0]);
						saveRecord[1].add(record[1]);
					} else if (previousPid != null && pid == previousPid.getPid() && preserveCount > 0) {
						ArrayList<RecordPattern.RecordItem>[] saveRecord = appMemory.get(pid);

						// 数据丢失
						if (saveRecord == null) {
							LogUtil.e(TAG, "Previous pid " + pid + "'s record has gone");
							continue;
						}

						// 记录数据
						saveRecord[0].add(record[0]);
						saveRecord[1].add(record[1]);
						preserveCount --;
					}

					// 缓存当前记录
					pssCache.addItem(record[0]);
					pDCache.addItem(record[1]);
				}
			}
		}
		if (totalMemory == null) {
			totalMemory = getTotalMemory();
		}
		usedMemory.add(new RecordPattern.RecordItem(System.currentTimeMillis(), (float)(totalMemory - getAvailMemory(context)), ""));
	}

	/**
	 * 获取进程内存信息，兼容Android Q
	 * @param processes
	 * @return
	 */
	private int[] getPssAndPDList(List<ProcessInfo> processes) {
		if (processes == null || processes.size() == 0) {
			return null;
		}

		int[] result = new int[processes.size() * 2];
		if (Build.VERSION.SDK_INT < 29) {
			int[] pids = new int[processes.size()];
			int idx = 0;
			for (ProcessInfo processInfo: processes) {
				pids[idx++] = processInfo.getPid();
			}

			Debug.MemoryInfo[] memInfos = activityManager.getProcessMemoryInfo(pids);
			for (int i = 0; i < memInfos.length; i++) {
				result[2 * i] = memInfos[i].getTotalPss();
				result[2 * i + 1] = memInfos[i].getTotalPrivateDirty();
			}
		} else {
			for (int i = 0; i < processes.size(); i++) {
				ProcessInfo processInfo = processes.get(i);
				String content = CmdTools.execHighPrivilegeCmd("dumpsys meminfo " + processInfo.getPid() + " | grep TOTAL");
				if (StringUtil.isEmpty(content)) {
					return null;
				}

				LogUtil.d(TAG, "Get memory info::" + content);

				String[] group = content.trim().split("\\s+");
				if (group.length > 4) {
					result[2 * i] = Integer.parseInt(group[1]);
					result[2 * i + 1] = Integer.parseInt(group[2]);
				}
			}
		}

		return result;
	}

	@Override
	public Map<RecordPattern, List<RecordPattern.RecordItem>> stopRecord() {
		Long endTime = System.currentTimeMillis();
		Map<RecordPattern, List<RecordPattern.RecordItem>> result = new HashMap<>();
		RecordPattern pattern = new RecordPattern(StringUtil.getString(R.string.display_memory__total_usage), "MB", "Memory");
		pattern.setStartTime(startTime);
		pattern.setEndTime(endTime);
		result.put(pattern, usedMemory);

		// 对每个进程的数据都进行记录
		for (String pid : appMemory.keySet()) {
			ArrayList<RecordPattern.RecordItem>[] pidRecord = appMemory.get(pid);

			pattern = new RecordPattern("PSS-" + pid, "MB", "Memory");
			pattern.setStartTime(startTime);
			pattern.setEndTime(endTime);
			result.put(pattern, pidRecord[0]);
			pattern = new RecordPattern("PrivateDirty-" + pid, "MB", "Memory");
			pattern.setStartTime(startTime);
			pattern.setEndTime(endTime);
			result.put(pattern, pidRecord[1]);
		}
		usedMemory = null;
		appMemory.clear();
		pssCachedData.clear();
		pDCachedData.clear();
		return result;
	}

	@Override
	public String getCurrentInfo() {
		if (pid != null && pid.getPid() > 0) {
			int[] result = getPssAndPDList(Collections.singletonList(pid));
			if (result != null && result.length == 2) {
				return String.format(Locale.CHINA, "pss:%.2fMB/privateDirty:%.2fMB", result[0] / 1024f, result[1] / 1024f);
			}
		}
		if (totalMemory == null) {
			totalMemory = getTotalMemory();
		}
		return StringUtil.getString(R.string.display_memory__current_info, getAvailMemory(context), totalMemory);
	}

	@Override
	public long getRefreshFrequency() {
		if (Build.VERSION.SDK_INT >= 29) {
			return 1000;
		}
		return 10;
	}

	public static Long getAvailMemory(Context cx) {// 获取android当前可用内存大小
		if (cx == null) {
			return 0L;
		}

		ActivityManager am = (ActivityManager) cx.getSystemService(Context.ACTIVITY_SERVICE);
		MemoryInfo mi = new MemoryInfo();
		am.getMemoryInfo(mi);
		LogUtil.i(TAG, "Available memory: " + mi.availMem);
		// mi.availMem; 当前系统的可用内存

		return mi.availMem / BYTES_PER_MEGA;// 将获取的内存大小规格化
	}

	public static Long getTotalMemory(Context cx) {// 获取android全部内存大小
		if (cx == null) {
			return 0L;
		}

		ActivityManager am = (ActivityManager) cx.getSystemService(Context.ACTIVITY_SERVICE);
		MemoryInfo mi = new MemoryInfo();
		am.getMemoryInfo(mi);
		LogUtil.i(TAG, "Total memory: " + mi.totalMem);
		// mi.totalMem; 当前系统的全部内存

		return mi.totalMem / BYTES_PER_MEGA;// 将获取的内存大小规格化
	}

	/**
	 * 获取总内存数据
	 * @return
	 */
	private Long getTotalMemory() {
		if (activityManager == null) {
			return 0L;
		}

		MemoryInfo info = new MemoryInfo();

		activityManager.getMemoryInfo(info);

		return info.totalMem / BYTES_PER_MEGA;
	}

	/**
	 * 占用内存
	 * @param mega MB数
	 * @return 实际声明的内存
	 */
	public static int dummyMem(long mega)
	{

		if (initFlag) {
			releaseMemory();
		}
		int result = fillMemory((int)mega);
		initFlag = true;

		return result;
	}

	@Override
	public void trigger() {

	}

	private static native int fillMemory(int memory);

	private static native int releaseMemory();

}