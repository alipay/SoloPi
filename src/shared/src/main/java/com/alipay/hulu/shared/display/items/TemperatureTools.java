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

import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.R;
import com.alipay.hulu.shared.display.items.base.DisplayItem;
import com.alipay.hulu.shared.display.items.base.Displayable;
import com.alipay.hulu.shared.display.items.base.RecordPattern;
import com.alipay.hulu.shared.display.items.util.FinalR;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

@DisplayItem(key = "Temperature", nameRes = FinalR.TEMPERATURE, permissions = "adb")
public class TemperatureTools implements Displayable {
    private static final String[] TEMPERATURE_FILE_LIST = new String[] {
            "/sys/devices/system/cpu/cpu0/cpufreq/cpu_temp",
            "/sys/devices/system/cpu/cpu0/cpufreq/FakeShmoo_cpu_temp",
            "/sys/class/thermal/thermal_zone1/temp",
            "/sys/class/i2c-adapter/i2c-4/4-004c/temperature",
            "/sys/devices/platform/tegra-i2c.3/i2c-4/4-004c/temperature",
            "/sys/devices/platform/omap/omap_temp_sensor.0/temperature",
            "/sys/devices/platform/tegra_tmon/temp1_input",
            "/sys/kernel/debug/tegra_thermal/temp_tj",
            "/sys/devices/platform/s5p-tmu/temperature",
            "/sys/class/thermal/thermal_zone0/temp",
            "/sys/devices/virtual/thermal/thermal_zone0/temp",
            "/sys/class/hwmon/hwmon0/device/temp1_input",
            "/sys/devices/virtual/thermal/thermal_zone1/temp",
            "/sys/devices/platform/s5p-tmu/curr_temp"
    };

    private List<RecordPattern.RecordItem> cpuRecord;
    private static int TARGET_FILE = -1;

    private static int getTargetFileIdx() {
        int i;
        for (i = 0; i < TEMPERATURE_FILE_LIST.length; i++) {
            String file = TEMPERATURE_FILE_LIST[i];
            String content = CmdTools.execHighPrivilegeCmd("cat " + file);
            if (StringUtil.isInteger(content.trim())) {
                return i;
            }
        }
        return i;
    }

    private static float readCurrentCpuTemperature() {
        if (TARGET_FILE >= TEMPERATURE_FILE_LIST.length) {
            return -1;
        }
        if (TARGET_FILE < 0) {
            TARGET_FILE = getTargetFileIdx();
        }

        String content = CmdTools.execHighPrivilegeCmd("cat " + TEMPERATURE_FILE_LIST[TARGET_FILE]);
        return Integer.parseInt(content.trim()) / 1000F;
    }

    @Override
    public void start() {

    }

    @Override
    public void stop() {

    }

    @Override
    public String getCurrentInfo() throws Exception {
        float temperature = readCurrentCpuTemperature();
        return StringUtil.getString(R.string.display_temperature__cpu, temperature);
    }

    @Override
    public long getRefreshFrequency() {
        return 500;
    }

    @Override
    public void clear() {

    }

    @Override
    public void startRecord() {
        cpuRecord = new ArrayList<>();
    }

    @Override
    public void record() {
        long time = System.currentTimeMillis();
        float temperature = readCurrentCpuTemperature();
        cpuRecord.add(new RecordPattern.RecordItem(time, temperature, null));
    }

    @Override
    public void trigger() {

    }

    @Override
    public Map<RecordPattern, List<RecordPattern.RecordItem>> stopRecord() {
        Map<RecordPattern, List<RecordPattern.RecordItem>> records = Collections.singletonMap(new RecordPattern("CPU温度", "度", "Temperature"), cpuRecord);
        cpuRecord = null;
        return records;
    }
}
