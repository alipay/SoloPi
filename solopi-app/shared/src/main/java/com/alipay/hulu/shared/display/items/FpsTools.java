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
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.R;
import com.alipay.hulu.shared.display.items.base.DisplayItem;
import com.alipay.hulu.shared.display.items.base.Displayable;
import com.alipay.hulu.shared.display.items.base.RecordPattern;
import com.alipay.hulu.shared.display.items.util.FinalR;
import com.alipay.hulu.shared.display.items.util.FpsUtil;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@DisplayItem(nameRes = FinalR.FPS, key = "FPS", permissions = {"adb", "toast:${com.alipay.hulu.shared.R$string.toast_message__turn_on_gfx_info}"})
public class FpsTools implements Displayable {
	private static String TAG = "FpsTools";
	private static Long startTime = 0L;
	/**
	 * FPS数据
	 */
	private static List<RecordPattern.RecordItem> fpsCurrent;
	/**
	 * 延迟数据
	 */
	private static List<RecordPattern.RecordItem> jankCurrent;
	/**
	 * 最大延迟数据
	 */
	private static List<RecordPattern.RecordItem> maxJankCurrent;
	/**
	 * Jank百分比
	 */
	private static List<RecordPattern.RecordItem> jankPercentCurrent;

	private InjectorService injectorService;

	private Boolean displayExtra = false;

	private String currentProc = null;

	private String previousProc = null;

	private List<FpsUtil.FpsDataWrapper> currentData;

	private int displayIdx = 0;

	@Override
	public void clear() {
		fpsCurrent = null;
		jankCurrent = null;
		maxJankCurrent = null;
		jankPercentCurrent = null;
	}

	@Override
	public void start() {
		injectorService = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
		injectorService.register(this);

		FpsUtil.initIfNotInited();
	}

	@Override
	public void stop() {
		injectorService.unregister(this);
		injectorService = null;
	}

	@Override
	public void startRecord() {

		fpsCurrent = new ArrayList<>();
		jankCurrent = new ArrayList<>();
		maxJankCurrent = new ArrayList<>();
		jankPercentCurrent = new ArrayList<>();
		startTime = System.currentTimeMillis();
	}

	@Override
	public void record() {
		if (displayIdx < 0) {
			return;
		}

		FpsUtil.FpsDataWrapper dataWrapper = currentData.get(displayIdx);
		if (dataWrapper.fps > 0) {
			String topActivity = dataWrapper.activity;
			fpsCurrent.add(new RecordPattern.RecordItem(System.currentTimeMillis(),
					(float)dataWrapper.fps, topActivity));
			jankCurrent.add(new RecordPattern.RecordItem(System.currentTimeMillis(),
					(float)dataWrapper.junkCount, topActivity));
			maxJankCurrent.add(new RecordPattern.RecordItem(System.currentTimeMillis(),
					(float)dataWrapper.maxJunk, topActivity));
			jankPercentCurrent.add(new RecordPattern.RecordItem(System.currentTimeMillis(),
					dataWrapper.junkPercent, topActivity));
		}
	}

	@Override
	public Map<RecordPattern, List<RecordPattern.RecordItem>> stopRecord() {
		Map<RecordPattern, List<RecordPattern.RecordItem>> result = new HashMap<>();
		Long endTime = System.currentTimeMillis();
		RecordPattern pattern = new RecordPattern(StringUtil.getString(R.string.display_fps__framerate), StringUtil.getString(R.string.display_fps__frame), "FPS");
		pattern.setStartTime(startTime);
		pattern.setEndTime(endTime);
		result.put(pattern, fpsCurrent);
		pattern = new RecordPattern(StringUtil.getString(R.string.display_fps__jank_time), StringUtil.getString(R.string.display_fps__count), "FPS");
		pattern.setStartTime(startTime);
		pattern.setEndTime(endTime);
		result.put(pattern, jankCurrent);
		pattern = new RecordPattern(StringUtil.getString(R.string.display_fps__max_jank_time), "ms", "FPS");
		pattern.setStartTime(startTime);
		pattern.setEndTime(endTime);
		result.put(pattern, maxJankCurrent);
		pattern = new RecordPattern(StringUtil.getString(R.string.display_fps__jank_percentage), "%", "FPS");
		pattern.setStartTime(startTime);
		pattern.setEndTime(endTime);
		result.put(pattern, jankPercentCurrent);

		fpsCurrent = null;
		jankCurrent = null;
		maxJankCurrent = null;
		jankPercentCurrent = null;
		return result;
	}

	@Override
	public String getCurrentInfo() {
		if (currentData == null || displayIdx < 0) {
			return "-";
		}

		FpsUtil.FpsDataWrapper dataWrapper = currentData.get(displayIdx);

		if (dataWrapper.fps > 0) {
			if (displayExtra && !StringUtil.isEmpty(dataWrapper.activity)) {
				return StringUtil.getString(R.string.display_fps__current_info_activity,
						dataWrapper.fps, dataWrapper.junkCount, dataWrapper.maxJunk,
						dataWrapper.junkPercent, dataWrapper.activity.substring(dataWrapper.activity.indexOf('/') + 1));
			}
			return StringUtil.getString(R.string.display_fps__current_info, dataWrapper.fps,
					dataWrapper.junkCount, dataWrapper.maxJunk, dataWrapper.junkPercent);
		}
		return "-";
	}

	@Override
	public long getRefreshFrequency() {
		return 800;
	}

	@Subscriber(@Param(FpsUtil.FPS_DATA_EVENT))
	public void receiveFps(List<FpsUtil.FpsDataWrapper> dataWrappers) {
		if (dataWrappers == null) {
			return;
		}
		if (dataWrappers.size() == 1) {
			previousProc = null;
			currentData = dataWrappers;
			displayIdx = 0;
		} else if (dataWrappers.size() == 0) {
			currentData = null;
			displayIdx = -1;
		} else {
			String procA = dataWrappers.get(0).proc;
			String procB = dataWrappers.get(1).proc;

			if (previousProc == null) {
				if (StringUtil.equals(procA, currentProc)) {
					currentProc = procB;
					previousProc = procA;
				} else {
					currentProc = procA;
					previousProc = procB;
				}
			}

			if (StringUtil.equals(procA, currentProc)) {
				displayIdx = 0;
			} else {
				displayIdx = 1;
			}

			currentData = dataWrappers;
		}
	}

	@Override
	public void trigger() {

	}
}
