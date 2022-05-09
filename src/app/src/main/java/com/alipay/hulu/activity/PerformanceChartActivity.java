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
package com.alipay.hulu.activity;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.AdapterView;
import android.widget.SimpleAdapter;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.appcompat.widget.AppCompatSpinner;

import com.alipay.hulu.R;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.display.items.base.RecordPattern;
import com.alipay.hulu.ui.HeadControlPanel;
import com.alipay.hulu.ui.linechart.CheckableLineChartView;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileFilter;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import lecho.lib.hellocharts.listener.LineChartOnValueSelectListener;
import lecho.lib.hellocharts.model.Axis;
import lecho.lib.hellocharts.model.Line;
import lecho.lib.hellocharts.model.LineChartData;
import lecho.lib.hellocharts.model.PointValue;

/**
 * 图表Activity
 * Created by cathor on 17/8/3.
 */

public class PerformanceChartActivity extends BaseActivity {

    private static final Long DAILY_MILLIS = 86400000L;

    private static final String TAG = "PerfChartAct";

    private static final FileFilter folderFilter = new FileFilter() {
        Pattern newPattern = Pattern.compile("\\d{14}_\\d{14}");
        Pattern midPattern = Pattern.compile("\\d{2}月\\d{2}日\\d{2}:\\d{2}:\\d{2}-\\d{2}月\\d{2}日\\d{2}:\\d{2}:\\d{2}");
        Pattern oldPattern = Pattern.compile("\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}_\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}");
        @Override
        public boolean accept(File file) {

            // 记录所有文件夹
            return file.isDirectory() && (newPattern.matcher(file.getName()).matches() || midPattern.matcher(file.getName()).matches() || oldPattern.matcher(file.getName()).matches());
        }
    };

    // Views
    // 表格
    private CheckableLineChartView chartView;
    // 时间维度的录制数据分类
    private AppCompatSpinner recordSpinner;
    // 单项录制数据
    private AppCompatSpinner recordItemSpinner;
    // 数据点提示
    private TextView labelText;
    // 汇总字段
    private TextView summaryText;
    // Toolbar
    private HeadControlPanel headPanel;

    // Adapter
    private SimpleAdapter recordSpinnerAdapter;
    private SimpleAdapter recordItemSpinnerAdapter;
    // 单线录制数据adapter对应Item
    private List<Map<String, String>> items;

    // 绘制数据
    // 时间与对应录制项
    private Map<String, RecordPattern[]> records;
    // 当前时间的录制项
    private RecordPattern[] currentRecords = null;
    // 单项录制数据缓存
    private Map<RecordPattern, List<RecordPattern.RecordItem>> recordCache;
    // 折线图数据
    private LineChartData data;
    // 录制项列表
    private final List<Map<String, String>> titles = new ArrayList<>();

    // IO
    // 当前时间端文件夹
    private File currentFolder;
    // 录制数据根目录
    private File recordDir;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        initView();
        initData(savedInstanceState);
    }

    /**
     * 初始化界面
     */
    private void initView(){
        setContentView(R.layout.activity_record_chart);
        headPanel = (HeadControlPanel) findViewById(R.id.head_layout);
        headPanel.setMiddleTitle(getString(R.string.activity__performance_display));
        headPanel.setBackIconClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });
        headPanel.setInfoIconClickListener(R.drawable.head_icon_delete, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent intent = new Intent(PerformanceChartActivity.this, RecordManageActivity.class);
                startActivity(intent);
            }
        });

        chartView = (CheckableLineChartView) findViewById(R.id.record_chart);
        int color;
        if (Build.VERSION.SDK_INT >= 23) {
            color = getColor(R.color.colorPrimary);
        } else {
            color = getResources().getColor(R.color.colorPrimary);
        }
        chartView.setCheckColor(color);
        recordSpinner = (AppCompatSpinner) findViewById(R.id.record_spinner);
        recordItemSpinner = (AppCompatSpinner) findViewById(R.id.record_item_spinner);
        labelText = (TextView) findViewById(R.id.record_label);
        summaryText = (TextView) findViewById(R.id.record_summary);
    }

    private void initData(Bundle savedInstanceState){
        // 加载录制数据根目录
        recordDir = FileUtils.getSubDir("records");

        // 读取本地记录数据
        if (recordDir.exists() && recordDir.isDirectory()) {

            // 加载录制文件
            reloadRecordFolder();

            recordSpinnerAdapter = new SimpleAdapter(this, titles, R.layout.item_record_time_select, new String[]{"title"}, new int[]{R.id.record_time_select_title});
            recordSpinner.setAdapter(recordSpinnerAdapter);
            recordSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
                @Override
                public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                    String title = titles.get(position).get("title");

                    // 查找对应的数据集
                    currentRecords = records.get(title);

                    // 切换当前文件夹到数据集对应文件夹
                    currentFolder = new File(recordDir, title);
                    if (currentRecords != null){
                        if (items == null) {
                            items = new ArrayList<>(currentRecords.length);
                        } else {
                            items.clear();
                        }
                        // 刷新数据选项
                        for (RecordPattern recordPattern: currentRecords) {
                            String name = recordPattern.getName() + " - " + recordPattern.getSource();
                            Map<String, String> keyItem = new HashMap<String, String>(1);
                            keyItem.put("title", name);
                            items.add(keyItem);
                        }

                        // 初始化或是刷新Adapter
                        if (recordItemSpinnerAdapter == null) {
                            recordItemSpinnerAdapter = new SimpleAdapter(PerformanceChartActivity.this, items, R.layout.item_record_time_select, new String[]{"title"}, new int[]{R.id.record_time_select_title});
                            recordItemSpinner.setAdapter(recordItemSpinnerAdapter);
                        } else {
                            recordItemSpinnerAdapter.notifyDataSetChanged();
                        }
                    }
                }

                @Override
                public void onNothingSelected(AdapterView<?> parent) {

                }
            });

            recordItemSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
                @Override
                public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                    String[] split = items.get(position).get("title").split(" - ");
                    RecordPattern realPattern = null;

                    // 根据名称与来源查找数据
                    for (RecordPattern recordPattern : currentRecords) {
                        if (recordPattern.getName().equals(split[0]) && recordPattern.getSource().equals(split[1])) {
                            realPattern = recordPattern;
                            break;
                        }
                    }

                    if (realPattern == null) {
                        toastShort(R.string.performance_chart__no_record_data);
                        return;
                    }

                    // 如果缓存中存在该类数据，直接从缓存读取绘制
                    if (recordCache.containsKey(realPattern)) {
                        List<RecordPattern.RecordItem> recordItems = recordCache.get(realPattern);
                        drawChart(recordItems, realPattern);
                        calculateSummary(recordItems);
                    } else {
                        // 重新构造录制文件名称
                        File f = new File(currentFolder, realPattern.getName() + "_" + realPattern.getSource() + "_" + realPattern.getStartTime() + "_" + realPattern.getEndTime() + ".csv");
                        try {
                            BufferedReader reader = new BufferedReader(new FileReader(f));
                            String dataTitle = reader.readLine();
                            // 首行定义数据单位
                            if (dataTitle != null) {
                                String unit = dataTitle.split("\\(")[1].split("\\)")[0];
                                realPattern.setUnit(unit);
                            }
                            String line;
                            List<RecordPattern.RecordItem> records = new ArrayList<>();

                            // 逐行读取数据内容，第一列时间，第二列数据，第三列扩展字段
                            while ((line = reader.readLine()) != null) {
                                String[] contents = line.split(",");
                                LogUtil.d(TAG, "read line: %s", Arrays.toString(contents));
                                if (contents.length == 3) {
                                    RecordPattern.RecordItem item = new RecordPattern.RecordItem(Long.parseLong(contents[0]), Float.parseFloat(contents[1]), contents[2]);
                                    records.add(item);
                                } else if (contents.length == 2) {
                                    RecordPattern.RecordItem item = new RecordPattern.RecordItem(Long.parseLong(contents[0]), Float.parseFloat(contents[1]), "");
                                    records.add(item);
                                }
                            }
                            // 添加该数据到缓存中
                            recordCache.put(realPattern, records);
                            // 绘制图表
                            drawChart(records, realPattern);

                            // 统计汇总
                            calculateSummary(records);
                        } catch (IOException e) {
                            LogUtil.e(TAG, "Catch IOException: " + e.getMessage(), e);
                        }
                    }
                }

                @Override
                public void onNothingSelected(AdapterView<?> parent) {

                }
            });
            recordCache = new HashMap<>();

            // 默认加载第一项
            if (titles.size() > 0) {
                String title = titles.get(0).get("title");
                for (String timeKey : records.keySet()) {
                    LogUtil.d(TAG, timeKey + " == " + title);
                    if (timeKey.equals(title)) {
                        currentRecords = records.get(timeKey);
                        LogUtil.d(TAG, records.values().toString());
                        break;
                    }
                }
            }
            LogUtil.d(TAG, "get records " + Arrays.toString(currentRecords));
            if (currentRecords != null){
                items = new ArrayList<>(currentRecords.length);
                for (RecordPattern recordPattern: currentRecords) {
                    String name = recordPattern.getName() + " - " + recordPattern.getSource();
                    Map<String, String> keyItem = new HashMap<>(1);
                    keyItem.put("title", name);
                    items.add(keyItem);
                }
                LogUtil.d(TAG, "get files: " + items.toString());
                recordItemSpinnerAdapter = new SimpleAdapter(PerformanceChartActivity.this, items, R.layout.item_record_time_select, new String[]{"title"}, new int[]{R.id.record_time_select_title});
                recordItemSpinner.setAdapter(recordItemSpinnerAdapter);
            }
            chartView.setOnValueTouchListener(new LineChartOnValueSelectListener() {
                @Override
                public void onValueSelected(int lineIndex, int pointIndex, PointValue value) {
                    labelText.setText(String.format("时间: %.3fs 数值: %.2f 附加信息: %s", value.getX(), value.getY(), new String(value.getLabelAsChars())));
                }

                @Override
                public void onValueDeselected() {

                }
            });
        }
    }

    @Override
    protected void onResume() {
        super.onResume();

        LogUtil.d(TAG, "onResume");

        // 以文件夹数量判断是否删除过数据
        File[] newFiles = recordDir.listFiles(folderFilter);
        if (newFiles.length != titles.size()) {

            // 重载数据
            reloadRecordFolder();
            recordSpinnerAdapter.notifyDataSetChanged();
        }
    }

    /**
     * 重载录制文件夹数据
     */
    private void reloadRecordFolder() {

        File[] files = recordDir.listFiles(folderFilter);
        ArrayList<File> folders = new ArrayList<>();
        LogUtil.i(TAG, "get files " + StringUtil.hide(files));

        // 记录所有文件夹
        for (File file: files) {
            if (file.isDirectory()) {
                folders.add(file);
            }
        }
        LogUtil.i(TAG, "get folders size: " + folders.size());
        records = new HashMap<>();

        // 数据输出文件名称为 ${Name}_${Category}_${StartMilli}_${EndMilli}.csv
        Pattern pattern = Pattern.compile("(.+?)_(.+?)_(\\d+)_(\\d+)\\.csv");

        for (File folder : folders) {
            String[] items = folder.list();
            RecordPattern[] folderRecords = new RecordPattern[items.length];
            int index = 0;

            // 读取数据文件
            for (String fileName: items) {
                Matcher matcher = pattern.matcher(fileName);
                if (matcher.matches()) {
                    RecordPattern record = new RecordPattern(matcher.group(1), "", matcher.group(2));
                    record.setStartTime(Long.parseLong(matcher.group(3)));
                    record.setEndTime(Long.parseLong(matcher.group(4)));
                    folderRecords[index++] = record;
                }
            }
            // 数据排序
            Arrays.sort(folderRecords, new Comparator<RecordPattern>() {
                @Override
                public int compare(RecordPattern lhs, RecordPattern rhs) {
                    if (lhs == null) {
                        return -1;
                    }
                    if (rhs == null) {
                        return 1;
                    }
                    if (lhs == rhs) {
                        return 0;
                    }
                    // 如果来源不同，按照来源排序
                    if (!lhs.getSource().equals(rhs.getSource())) {
                        return lhs.getSource().compareTo(rhs.getSource());
                    }
                    // 来源相同，按照名称排序
                    return lhs.getName().compareTo(rhs.getName());
                }
            });

            // 仅保存有实际数据的项
            if (index > 0) {
                records.put(folder.getName(), Arrays.copyOf(folderRecords, index));
            }
        }

        titles.clear();
        // 按修改时间从大到小排序
        Collections.sort(folders, new Comparator<File>() {
            @Override
            public int compare(File o1, File o2) {
                return Long.valueOf(o2.lastModified()).compareTo(o1.lastModified());
            }
        });

        // 按顺序保存
        for (File f: folders) {
            String key = f.getName();
            if (!records.containsKey(key)) {
                continue;
            }

            Map<String, String> item = new HashMap<>(1);
            item.put("title", key);
            titles.add(item);
        }
    }

    /***
     * 绘制图表
     * @param recordItems 记录的数据
     * @param pattern 数据类型
     */
    private void drawChart(List<RecordPattern.RecordItem> recordItems, RecordPattern pattern) {
        List<PointValue> points = new ArrayList<>();

        for (RecordPattern.RecordItem item: recordItems) {
            // 对于时间取从开始到当前时间的秒数
            PointValue point = new PointValue((item.time - pattern.getStartTime()) / 1000F, item.value);
            point.setLabel(item.extra);
            points.add(point);
        }
        // 设置折线属性
        Line line = new Line(points);
        int color;
        if (Build.VERSION.SDK_INT >= 23) {
            color = getColor(R.color.colorAccent);
        } else {
            color = getResources().getColor(R.color.colorAccent);
        }
        line.setColor(color);
        line.setPointRadius(2);
        line.setStrokeWidth(1);
        line.setHasLabelsOnlyForSelected(true);

        if(data == null) {
            data = new LineChartData();
        }
        List<Line> newLines = new ArrayList<>();
        newLines.add(line);
        data.setLines(newLines);
        // 显示辅助线
        Axis axisX = new Axis().setHasLines(true);
        Axis axisY = new Axis().setHasLines(true);
        axisX.setName("Time(s)");
        axisY.setName(pattern.getName() + "(" + pattern.getUnit() + ")");
        data.setAxisXBottom(axisX);
        data.setAxisYLeft(axisY);
        chartView.setLineChartData(data);
    }

    private void calculateSummary(List<RecordPattern.RecordItem> recordItems) {
        Float total = 0f;
        Float averange = 0f;
        int count = 0;
        Float min = Float.MAX_VALUE;
        Float max = Float.MIN_VALUE;

        Float lastPoint = null;
        Long lastTime = null;
        for (RecordPattern.RecordItem item : recordItems) {
            if (lastPoint == null) {
                lastPoint = item.value;
                lastTime = item.time;
            } else {
                // 计算面积
                total += (item.value + lastPoint) * (item.time - lastTime) / 1000F / 2;
                lastPoint = item.value;
                lastTime = item.time;
            }
            count ++;
            averange += item.value;

            if (item.value < min) {
                min = item.value;
            }

            if (item.value > max) {
                max = item.value;
            }
        }

        //对于没有数据的情况，需要特殊设置
        if (recordItems.size() == 0) {
            min = 0.0f;
            max = 0.0f;
            total = 0.0f;
            averange = 0f;
        }

        summaryText.setText(String.format(Locale.CHINA, getString(R.string.performance__summary), total, averange / count, min, max));
    }
}
