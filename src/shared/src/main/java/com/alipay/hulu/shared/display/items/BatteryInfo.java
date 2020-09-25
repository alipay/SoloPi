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
import android.content.Context;
import android.os.BatteryManager;
import android.os.Build;
import android.os.IBinder;
import android.os.MemoryFile;
import android.os.Parcel;
import android.os.ParcelFileDescriptor;
import android.os.Parcelable;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.R;
import com.alipay.hulu.shared.display.items.base.DisplayItem;
import com.alipay.hulu.shared.display.items.base.Displayable;
import com.alipay.hulu.shared.display.items.base.RecordPattern;
import com.alipay.hulu.shared.display.items.util.FinalR;

import java.io.File;
import java.io.FileDescriptor;
import java.io.FileFilter;
import java.io.FileInputStream;
import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@DisplayItem(nameRes = FinalR.BATTERY, key = "Battery", trigger = "清零")
public class BatteryInfo implements Displayable{

	private static String batteryPath = null;

	private final static String TAG = "BatteryInfo";


	private static Long startTime = 0L;

	private static final String[] acceptFiles = {"batt_current", "current_now", "batt_current_adc",
			"current_avg", "BatteryAverageCurrent"};

	private static List<RecordPattern.RecordItem> currentBattery;

	private static List<RecordPattern.RecordItem> avgBattery;

	/** 能否正常从系统调用获取数据 */
	private static boolean implementInterface = true;

	public static boolean needProcess = false;

	private static float lastCurrent = 0L;
	private static float point = 0;
	private static long loop = 0;

	@Override
	public String getCurrentInfo() {
		float current = getCurrent(LauncherApplication.getContext());
		if (current != -1) {
			return String.format("瞬时电流:%.1fmA/均值:%.1fmA", current, getAvg());
		} else {
			return "数据获取失败";
		}
	}

	@Override
	public void start() {

	}

	@Override
	public void stop() {

	}

	@Override
	public void startRecord() {
		startTime = System.currentTimeMillis();
		avgBattery = new ArrayList<>();
		currentBattery = new ArrayList<>();
	}

	@Override
	public void record() {
		currentBattery.add(new RecordPattern.RecordItem(System.currentTimeMillis(), getCurrent(LauncherApplication.getContext()), ""));
		avgBattery.add(new RecordPattern.RecordItem(System.currentTimeMillis(), getAvg(), ""));
	}

	@Override
	public Map<RecordPattern, List<RecordPattern.RecordItem>> stopRecord() {
		Long endTime = System.currentTimeMillis();
		Map<RecordPattern, List<RecordPattern.RecordItem>> result = new HashMap<>();
		RecordPattern pattern = new RecordPattern("实时电流", "mA", "Battery");
		pattern.setEndTime(endTime);
		pattern.setStartTime(startTime);
		result.put(pattern, currentBattery);
		pattern = new RecordPattern("平均电流", "mA", "Battery");
		pattern.setEndTime(endTime);
		pattern.setStartTime(startTime);
		result.put(pattern, avgBattery);
		avgBattery = null;
		currentBattery = null;
		return result;
	}

	@Override
	public void clear() {
		clearData();
	}

	@Override
	public long getRefreshFrequency() {
		return 250;
	}

	public static float getAvg() {
		return loop == 0 ? 0 : (point / loop);
	}

	public static void clearData()
	{
		avgBattery = null;
		currentBattery = null;
		point = 0;
		loop = 0;
	}

	private static boolean containsBattery(String filename) {
		for (String name: acceptFiles) {
			if (StringUtil.equals(name, filename)) {
				return true;
			}
		}
		return false;
	}

	public static float getCurrent(Context context) {
		float current = 0;
		// Android 5.0及以上接口正常可以直接通过系统调用获取当前电流值
		if (!implementInterface && Build.VERSION.SDK_INT >= 26) {
			return -1;
		}
		if (implementInterface && android.os.Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && context != null) {
			BatteryManager mBatteryManager = (BatteryManager) context.getSystemService(Context.BATTERY_SERVICE);
			if (mBatteryManager == null) {
			    LogUtil.e(TAG, "Can't get batteryManager");
			    implementInterface = false;
			    return -1;
            }

			current = mBatteryManager.getLongProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW);
			long remainingBattery = mBatteryManager.getLongProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_AVERAGE);

			LogUtil.w(TAG, "Battery left: %d, current: %f", remainingBattery, current);

			// 数据异常，说明系统调用存在问题，之后读文件获取
			if (current > 1000000000 || current < -1000000000) {
				LogUtil.e(TAG, "can't parse current for: %f", current);
				implementInterface = false;
				return 0;
			}

			// 保证用电时为正，充电时为负
			current = -current;

			LogUtil.d(TAG, "Current batter: " + current);

			// 微安为单位特殊处理
			if (current > 100000 || current < -100000) {
				needProcess = true;
			}

			if (needProcess) {
				current = current / 1000;
			}
		} else {
			// 对于Android5.0以下系统，只能读取 /sys/class/power_supply/ 下一个包含battery的文件夹中的包含 current_now文件读取当前电流值
			// 在HTC设备中发现文件名为 batt_current_now
			try {
				if (batteryPath == null) {
					File dir = new File("/sys/class/power_supply/");
					File[] subDirs = dir.listFiles(new FileFilter() {
						@Override
						public boolean accept(File pathname) {
							return pathname.isDirectory() && (pathname.getName().contains("battery") || pathname.getName().contains("Battery"));
						}
					});

					if (subDirs != null && subDirs.length > 0) {
						File batteryDir = subDirs[0];
						File[] subFiles = batteryDir.listFiles(new FileFilter() {
							@Override
							public boolean accept(File pathname) {
								return pathname.isFile() && containsBattery(pathname.getName());
							}
						});
						if (subFiles != null && subFiles.length > 0) {
							batteryPath = subFiles[0].getAbsolutePath();
						}
					}

					if (batteryPath == null) {
						batteryPath = "/sys/class/power_supply/battery/current_now";
					}
				}
				StringBuilder sb = CmdTools.execCmd("cat " + batteryPath);
				LogUtil.d(TAG, "[CurrentInfo] BatteryCurrent: " + sb.toString());
				current = Math.abs(Integer.parseInt(sb.toString().trim()));
				if (current > 100000 || current < -100000) {
					needProcess = true;
				}

				if (needProcess) {
					current /= 1000;
				}
			}catch (NumberFormatException e) {
				LogUtil.e(TAG, "Catch NumberFormatException: " + e.getMessage(), e);
			}
		}

		// 如果数值发生变化，计入新数值
		if (current != lastCurrent) {
			lastCurrent = current;
			point += current;
			loop++;
		}
		return current;
	}

	@Override
	public void trigger() {
		point = 0f;
		loop = 0;
	}
}
