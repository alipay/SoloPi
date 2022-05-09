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

import android.os.Build;
import android.util.SparseArray;

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
import com.android.permission.rom.RomUtils;

import java.io.BufferedReader;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileFilter;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.text.DecimalFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@DisplayItem(name = "CPU", key = "CPU", permissions = "adb")
public class CPUTools implements Displayable{

	private static final String TAG = "CPUTools";

	private static long currentJiffies = 0;
	private static long lastJiffies = 0;
	private static long currentIdle = 0;
	private static long lastIdle = 0;
	private static SparseArray<Long> appProcessTime = new SparseArray<Long>();
	private InjectorService injectorService;

	private static long lastTime = 0;

	private static Map<String, List<RecordPattern.RecordItem>> appCurrents;

	private static List<RecordPattern.RecordItem> totalCurrent;

	private static Long startTime = -1L;

	private Integer pid = 0;

	private String processName = null;

	private int previousPid = 0;

	private List<ProcessInfo> pids = null;

	private Map<String, FixedLengthCircularArray<RecordPattern.RecordItem>> cachedData;

	private int cacheLenght = 10;

	private int saveLastPidCount = 10;

	private boolean newChange = true;

	private static int coreNum = 0;

	static {
		System.loadLibrary("nativeModule");
	}

	@Subscriber(@Param(SubscribeParamEnum.PID))
	public void setPid(ProcessInfo pid) {
		if (pid == null) {
			this.pid = 0;
		} else {
            if (pid.getPid() != this.pid) {

                // 设置之前的pid
                newChange = true;
                previousPid = this.pid;
                this.pid = pid.getPid();
                this.processName = pid.getProcessName();
                saveLastPidCount = cacheLenght;
            }
		}
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

	@Subscriber(@Param(SubscribeParamEnum.PID_CHILDREN))
	public void setPids(List<ProcessInfo> pids) {
		this.pids = pids;
	}

	@Override
	public String getCurrentInfo() {
		String style = "0.00";
		DecimalFormat df = new DecimalFormat();
		df.applyPattern(style);
		// 根据注入情况
		if (pid > 0) {
			try {
				float[] result = getPidsUsage(new int[]{pid});
				if (result.length == 1) {
					return StringUtil.getString(R.string.constant__global) + ':' +df.format(result[0]) + '%';
				} else if (result.length == 2) {
					return StringUtil.getString(R.string.constant__app) + ':' + df.format(result[0]) + '%' + StringUtil.getString(R.string.constant__global) + ':' + df.format(result[1]) + '%';
				}
				return "-";
			} catch (Exception e) {
				LogUtil.e(TAG, "抛出异常", e);
				return "-";
			}
		}
		float result = getUsage();
        if (result < 0) {
            return "-";
        }
		return StringUtil.getString(R.string.constant__global) + ':' + df.format(result) + '%';
	}

	@Override
	public long getRefreshFrequency() {
		return 20;
	}

	@Override
	public void clear() {
	    if (appCurrents != null) {
            appCurrents.clear();
        }

        if (cachedData != null) {
	        cachedData.clear();
        }

        cachedData = null;
		appCurrents = null;
		totalCurrent = null;
	}

	@Override
	public void startRecord() {
	    if (appCurrents == null || appCurrents.size() > 0) {
            appCurrents = new HashMap<>();
        }
        if (cachedData == null || cachedData.size() > 0) {
	        cachedData = new HashMap<>();
        }
		totalCurrent = new ArrayList<>();
		startTime = System.currentTimeMillis();
	}

	@Override
	public void record() {
		if (pids != null && pids.size() > 0) {
            int[] pidArray = new int[pids.size()];
            String[] processArray = new String[pids.size()];
            int count = 0;
            for (ProcessInfo pid: pids) {
                if (pid != null) {
					pidArray[count] = pid.getPid();
					processArray[count] = pid.getProcessName() + "-" + pid.getPid();
					count++;
                }
            }

            // 当实际可用的pid小于给定长度，缩小Array
            if (count < pids.size()) {
                LogUtil.w(TAG, "Pid list resized, from " + pids.size() + " to " + count);
                int[] newArray = new int[count];
                System.arraycopy(pidArray, 0, newArray, 0, count);
                pidArray = newArray;
            }

			float[] result = getPidsUsage(pidArray);
			if (result.length == 1) {
				totalCurrent.add(new RecordPattern.RecordItem(System.currentTimeMillis(), result[0], ""));
			} else if (result.length > 1) {
                totalCurrent.add(new RecordPattern.RecordItem(System.currentTimeMillis(), result[result.length - 1], ""));

                // 对每一个pid，设置数据
                for (int i = 0; i < pidArray.length; i++) {
                    int pid = pidArray[i];
                    String processName = processArray[i];
                    RecordPattern.RecordItem currentRecord = new RecordPattern.RecordItem(System.currentTimeMillis(), result[i], "");

                    if (!cachedData.containsKey(processName)) {
                        cachedData.put(processName, new FixedLengthCircularArray<RecordPattern.RecordItem>(cacheLenght));
                    }

                    // 如果当前进程是目标进程
                    if (pid == this.pid) {
                        List<RecordPattern.RecordItem> pidRecord;
                        if ((pidRecord = appCurrents.get(processName)) == null) {
                            pidRecord = new ArrayList<>();
                            appCurrents.put(processName, pidRecord);
                        }

                        // 如果是刚变化的，可以添加以往数据到记录数据中
                        if (newChange) {
                            Collections.addAll(pidRecord, cachedData.get(processName).getAllItems(new RecordPattern.RecordItem[0]));
                            newChange = false;
                        }

                        // 添加该条数据
                        pidRecord.add(currentRecord);
                    } else if (pid == previousPid && saveLastPidCount > 0) {
                        List<RecordPattern.RecordItem> pidRecord = appCurrents.get(processName);
                        if (pidRecord == null) {
                            LogUtil.e(TAG, "Record item for pid " + pid +  " disappeared");
                            continue;
                        }
                        // 添加该条数据
                        pidRecord.add(currentRecord);

                        // 只保留切换后一定数量的数据
                        saveLastPidCount--;
                    }

                    // 对所有数据都进行缓存
                    cachedData.get(processName).addItem(currentRecord);
                }
			}
		} else {
			float result = getUsage();

			// 异常数据就不显示了
            if (result > 0) {
                totalCurrent.add(new RecordPattern.RecordItem(System.currentTimeMillis(), result, ""));
            }
        }
	}

	@Override
	public Map<RecordPattern, List<RecordPattern.RecordItem>> stopRecord() {
		Map<RecordPattern, List<RecordPattern.RecordItem>> result = new HashMap<>();
		Long endTime = System.currentTimeMillis();
        RecordPattern pattern;

        // 如果app层级有数据
        if (appCurrents != null && appCurrents.size() > 0) {
			for (String processName : appCurrents.keySet()) {
				List<RecordPattern.RecordItem> appCurrent = appCurrents.get(processName);
				pattern = new RecordPattern(StringUtil.getString(R.string.display_cpu__app_process) + processName, "%", "CPU");
				pattern.setStartTime(startTime);
				pattern.setEndTime(endTime);
				result.put(pattern, appCurrent);
			}
			appCurrents.clear();
			cachedData.clear();
		}

		pattern = new RecordPattern(StringUtil.getString(R.string.display_cpu__global_usage), "%", "CPU");
		pattern.setStartTime(startTime);
		pattern.setEndTime(endTime);
		result.put(pattern, totalCurrent);
		totalCurrent = null;
		return result;
	}

	/**
	 * 获取CPU总占用率与应用CPU占用率
	 * @param pids 应用所有子进程PID
	 * @return
	 */
	private static float[] getPidsUsage(int[] pids) {
		LogUtil.i(TAG, "Start get CPU info");

		// 对于Android 6.0 及以下，数据获取不需要高权限，直接通过jni获取
		// OPPO通过C实现获取会失败，需要降级到adb走
		if (!RomUtils.isOppoSystem() && Build.VERSION.SDK_INT <= Build.VERSION_CODES.M) {
			float[] data = getAppTotalUsage(pids);

			// 系统CPU总占用在0.01%一下？说明数据获取出现异常
			if (data[data.length - 1] <= 0.01) {
				return new float[0];
			}
			return data;
		}

		String[] cpuInfos;
		try {
			if (coreNum == 0) {
				/**
				 * 取设备CPU核心数，名称形如
				 * cpu0
				 * cpu1
				 * cpu2
				 * cpu3
				 * cpu4
				 * cpu5
				 * cpu6
				 * cpu7
				 * 文件总数为核心数
				 */
				coreNum = new File("/sys/devices/system/cpu/").listFiles(new FileFilter() {
					@Override
					public boolean accept(File pathname) {
						String fileName = pathname.getName();
						if (pathname.isDirectory() && fileName.startsWith("cpu")) {
							for (int i = 3; i < fileName.length(); i++) {
								if (fileName.charAt(i) < '0' || fileName.charAt(i) > '9') {
									return false;
								}
							}
							return true;
						}
						return false;
					}
				}).length;
			}
			//LogUtil.d(TAG, "core num: " + coreNum);
			String appLines;
			Long time;
			/**
			 * /proc/stat CPU总时间为： cpu  569146 66246 275756 15100026 11684 81 11376 0 0 0
			 * 第5位为Idle时间
			 * 第2-8位之和为CPU总耗时
			 * 占用率为(sum - Idel) / sum
			 */

            StringBuilder cmd = new StringBuilder("grep \"cpu \" /proc/stat && cat ");
            for (int pid: pids) {
                cmd.append("/proc/").append(pid).append("/stat ");
            }

			if (CmdTools.isRooted()) {
				// 尽量保证两者数据取的时间一致
				Process p = CmdTools.getRootCmd();
				DataInputStream in = new DataInputStream(p.getInputStream());
				DataOutputStream out = new DataOutputStream(p.getOutputStream());
				out.writeBytes(cmd.append('\n').toString());
				out.flush();
				out.writeBytes("exit\n");
				out.flush();
				StringBuilder builder = new StringBuilder();
				while ((appLines = in.readLine()) != null) {
                    builder.append(appLines).append('\n');
                }
                appLines = builder.toString();
				in.close();
				out.close();
				p.waitFor();
				LogUtil.i(TAG, "start flush");
				//LogUtil.d(TAG, cmd);
				time = System.currentTimeMillis();
			} else {
				time = System.currentTimeMillis();
				appLines = CmdTools.execAdbCmd(cmd.toString(), 0);
			}
			//LogUtil.d(TAG, "finish flush");
			LogUtil.i(TAG, "Finish Read Proc Info");
			String[] origin = appLines.split("\n");
			String load = origin[0];

            /**
             * 全局CPU数据处理
             */
			//LogUtil.d(TAG, load);
			cpuInfos = load.split("\\s+");

			LogUtil.d(TAG, "CPU Data: %s", Arrays.toString(cpuInfos));
			currentJiffies = Long.parseLong(cpuInfos[1]) + Long.parseLong(cpuInfos[2]) + Long.parseLong(cpuInfos[3])
					+ Long.parseLong(cpuInfos[4]) + Long.parseLong(cpuInfos[5]) + Long.parseLong(cpuInfos[6])
					+ Long.parseLong(cpuInfos[7]);
			Long cpuRunning = currentJiffies - lastJiffies;
			currentIdle = Long.parseLong(cpuInfos[4]);

			LogUtil.d(TAG, "Get Total cpu info: " + currentJiffies);
			LogUtil.d(TAG, "Get Total cpu idle: " + currentIdle);
			long gapIdle = currentIdle - lastIdle;
			LogUtil.d(TAG, "Get time gap: " + cpuRunning);
			LogUtil.d(TAG, "Get idle gap: " + gapIdle);
			float totalUsage = 100 * (cpuRunning - gapIdle) / (float) cpuRunning;

			// 数据异常
            if (gapIdle < 0 | cpuRunning < 0 | lastTime <= 0) {
				lastIdle = currentIdle;
				lastJiffies = currentJiffies;
                lastTime = time;
                return new float[0];
            }

			lastIdle = currentIdle;
			lastJiffies = currentJiffies;
            lastTime = time;

			/**
             * 应用CPU处理
			 * /proc/<b>pid</b>/stat 应用占用情况
			 * 2265 (id.XXX) S 610 609 0 0 -1 1077952832 130896 1460 185 0 683 329 3 10 14 -6 63 0 1982194 2124587008 28421 18446744073709551615 1 1 0 0 0 0 4612 0 1073798392 18446744073709551615 0 0 17 3 0 0 0 0 0 0 0 0 0 0 0 0 0
			 * 第14-17位之和为应用占用CPU时间之和
			 */
			SparseArray<Float> appResult = new SparseArray<>(pids.length + 1);

			// 第一行是全局cpu数据
			String[] splitLines = new String[origin.length - 1];
			System.arraycopy(origin, 1, splitLines, 0, origin.length - 1);

			// 处理每行获取到的数据
			SparseArray<Long> newAppProcessTime = new SparseArray<>(appProcessTime.size() + 1);
			for (String line: splitLines) {
			    String[] processInfos = line.trim().split("\\s+");
                LogUtil.d(TAG, Arrays.toString(processInfos));
                // 获取失败的状态
                if (processInfos.length < 17) {
                    continue;
                }

                try {
                    int pid = Integer.parseInt(processInfos[0]);
                    Long pidProcessTime = Long.parseLong(processInfos[13]) + Long.parseLong(processInfos[14]) + Long.parseLong(processInfos[15]) + Long.parseLong(processInfos[16]);

                    Long lastProcessTime = appProcessTime.get(pid);
                    newAppProcessTime.put(pid, pidProcessTime);

                    // 如果没有上次记录，则跳过
                    if (lastProcessTime == null) {
                        continue;
                    }

                    // 计算APP进程处理时间
                    Long processRunning = pidProcessTime - lastProcessTime;
                    appResult.put(pid, 100 * (processRunning / (float) cpuRunning));
                } catch (NumberFormatException e) {
                    LogUtil.e(TAG, "Format for string: " + line + " failed", e);
                }
            }

            appProcessTime.clear();
			appProcessTime = newAppProcessTime;

			// 整合计算结果
			float[] result = new float[pids.length + 1];
            for (int i = 0; i < pids.length; i++) {
                int pid = pids[i];
                Float pidData = appResult.get(pid);

                // 如果找不到，说明数据不存在
                if (pidData != null) {
                    result[i] = pidData;
                } else {
                    result[i] = 0F;
                }
            }

            result[pids.length] = totalUsage;
			return result;
		} catch (Exception e) {
			LogUtil.e(TAG, "Catch Exception: " + e.getMessage(), e);
			return new float[0];
		}
	}

	/**
	 * 获取CPU占用率
	 * @return
	 */
	public static float getUsage() {

		if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.M) {
			return getTotalUsage();
		}

		String[] cpuInfos = null;
		String load = loadTotalLine();
		cpuInfos = load.split("\\s+");

		try {
			currentJiffies = Long.parseLong(cpuInfos[1]) + Long.parseLong(cpuInfos[2]) + Long.parseLong(cpuInfos[3])
					+ Long.parseLong(cpuInfos[4]) + Long.parseLong(cpuInfos[5]) + Long.parseLong(cpuInfos[6])
					+ Long.parseLong(cpuInfos[7]);
			currentIdle = Long.parseLong(cpuInfos[4]);

		} catch (ArrayIndexOutOfBoundsException e) {
			LogUtil.e(TAG, "ArrayIndexOutOfBoundsException" + e.getMessage(), e);
			return -1f;
		} catch (NumberFormatException e) {
			LogUtil.e(TAG, "CPU行【%s】格式无法解析", load);
		}

		if (lastJiffies == 0 || lastIdle == 0) {
			lastJiffies = currentJiffies;
			lastIdle = currentIdle;
			return -1f;
		} else {
			long gapJiffies = currentJiffies - lastJiffies;
			long gapIdle = currentIdle - lastIdle;



			lastJiffies = currentJiffies;
			lastIdle = currentIdle;

            if (gapIdle < 0 || gapJiffies < 0) {
                return -1f;
            }

			LogUtil.d(TAG, "CPU占用率:" + (gapJiffies - gapIdle) / (float) gapJiffies);
			return 100 * (gapJiffies - gapIdle) / (float) gapJiffies;
		}

	}

	/**
	 * 加载/proc/stat文件（Android O无法直接读取/proc/stat文件）
	 * @return
	 */
	private static String loadTotalLine(){
		if (Build.VERSION.SDK_INT > 25) {
			String line = CmdTools.execAdbCmd("cat /proc/stat", 0);
			String result = line.substring(0, line.indexOf('\n')).trim();
			LogUtil.d(TAG, "CPU Line: %s", result);
			return result;
 		}
		else {
			try {
				BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream("/proc/stat")), 1000);
				String line = reader.readLine().trim();
				reader.close();
				return line;
			} catch (IOException e) {
				LogUtil.e(TAG, "Catch IOException in read /proc/stat", e);
			}
		}

		return "";
	}

	@Override
	public void trigger() {

	}

	native static float getTotalUsage();

	native static float[] getAppTotalUsage(int[] pids);
}
