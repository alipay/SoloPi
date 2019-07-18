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
package com.alipay.hulu.util;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.common.bean.DeviceInfo;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.utils.DeviceInfoUtil;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.HttpUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.shared.display.items.base.RecordPattern;

import org.apache.commons.io.Charsets;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.charset.UnsupportedCharsetException;
import java.text.DateFormat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import okhttp3.MediaType;
import okhttp3.RequestBody;

/**
 * Created by qiaoruikai on 2019/1/9 12:17 AM.
 */
public class RecordUtil {
    private static final String TAG = "RecordUtil";

    /**
     * 保存到文件夹
     */
    public static File saveToFile(Map<RecordPattern, List<RecordPattern.RecordItem>> records) {
        Date startTime = new Date(System.currentTimeMillis() * 2);
        Date endTime = new Date(System.currentTimeMillis() / 2);
        for (RecordPattern pattern: records.keySet()) {
            Date tmpStart = new Date(pattern.getStartTime());
            Date tmpEnd = new Date(pattern.getEndTime());
            if (tmpStart.compareTo(startTime) < 0) {
                startTime = tmpStart;
            }
            if (tmpEnd.compareTo(endTime) > 0) {
                endTime = tmpEnd;
            }
        }

        // 保存目录
        File saveFolder = loadSaveDir(startTime, endTime);

        // 加载编码信息
        String charsetName = SPService.getString(SPService.KEY_OUTPUT_CHARSET, "GBK");
        Charset charset;
        try {
            charset = Charset.forName(charsetName);
        } catch (UnsupportedCharsetException e) {
            LogUtil.w(TAG, "unsupported charset for name=" + charsetName, e);
            charset = Charset.forName("UTF-8");
        }

        for (Map.Entry<RecordPattern, List<RecordPattern.RecordItem>> entry: records.entrySet()){
            RecordPattern pattern = entry.getKey();

            // 文件输出名称为：${Name}_${Category}_${StartMilli}_${EndMilli}.csv，","分隔
            File saveFile = new File(saveFolder, pattern.getName() + "_" + pattern.getSource() + "_" + pattern.getStartTime() + "_" + pattern.getEndTime() + ".csv");
            try {
                if (saveFile.createNewFile()) {
                    BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(saveFile), charset));

                    // 第一行写标题
                    writer.write("RecordTime," + pattern.getName() + "(" + pattern.getUnit() + "),extra\n");
                    writer.flush();

                    // 写入录制
                    for (RecordPattern.RecordItem item: entry.getValue()) {
                        writer.write(item.time + "," + item.value + "," + item.extra + "\n");
                        writer.flush();
                    }
                    writer.close();
                }
            } catch (IOException e) {
                e.printStackTrace();
            }
        }

        return saveFolder;
    }




    /**
     * 加载保存目录
     * @param startTime
     * @param endTime
     * @return
     */
    private static File loadSaveDir(Date startTime, Date endTime) {
        File recordDir = FileUtils.getSubDir("records");
        DateFormat format = new SimpleDateFormat("MM月dd日HH:mm:ss", Locale.CHINA);
        File saveFolder = new File(recordDir, format.format(startTime) + "-" + format.format(endTime));
        saveFolder.mkdir();
        return saveFolder;
    }

    /**
     * 上传数据
     *
     * @param path    地址
     * @param records 数据
     */
    public static String uploadData(String path, Map<RecordPattern, List<RecordPattern.RecordItem>> records) {
        Map<String, Map<String, List<RecordPattern.RecordItem>>> data = new HashMap<>();
        for (RecordPattern pattern : records.keySet()) {
            Map<String, List<RecordPattern.RecordItem>> item;
            if (data.containsKey(pattern.getSource())) {
                item = data.get(pattern.getSource());
            } else {
                item = new HashMap<>();
                data.put(pattern.getSource(), item);
            }

            item.put(pattern.getName(), records.get(pattern));
        }

        DeviceInfo deviceInfo = DeviceInfoUtil.generateDeviceInfo();

        UploadData uploadData = new UploadData(data, deviceInfo);

        final byte[] content = JSON.toJSONString(uploadData).getBytes(Charsets.UTF_8);

        try {
            RequestBody body = RequestBody.create(MediaType.get("application/json"), content);
            return HttpUtil.postSync(path, body);
        } catch (IOException e) {
            LogUtil.e(TAG, "抛出IO异常", e);
        }

        return null;
    }

    /**
     * 上传响应耗时数据
     *
     * @param path    地址
     * @param time 响应耗时
     * @param title 上传标题
     */
    public static String uploadRecordData(String path, long time, String title) {
        DeviceInfo deviceInfo = DeviceInfoUtil.generateDeviceInfo();

        RecordUploadData uploadData = new RecordUploadData(time, title, deviceInfo);

        final byte[] content = JSON.toJSONString(uploadData).getBytes(Charsets.UTF_8);

        try {
            RequestBody body = RequestBody.create(MediaType.get("application/json"), content);
            return HttpUtil.postSync(path, body);
        } catch (IOException e) {
            LogUtil.e(TAG, "抛出IO异常", e);
        }

        return null;
    }

    static class UploadData {
        Map<String, Map<String, List<RecordPattern.RecordItem>>> data;
        DeviceInfo model;

        public UploadData() {
        }

        public UploadData(Map<String, Map<String, List<RecordPattern.RecordItem>>> data, DeviceInfo model) {
            this.data = data;
            this.model = model;
        }

        public Map<String, Map<String, List<RecordPattern.RecordItem>>> getData() {
            return data;
        }

        public void setData(Map<String, Map<String, List<RecordPattern.RecordItem>>> data) {
            this.data = data;
        }

        public DeviceInfo getModel() {
            return model;
        }

        public void setModel(DeviceInfo model) {
            this.model = model;
        }
    }

    static class RecordUploadData {
        Map<String, Object> data;
        DeviceInfo model;

        public RecordUploadData() {
        }

        public RecordUploadData(long recordTime, String title, DeviceInfo model) {
            this.data = new HashMap<>(3);
            data.put("time", recordTime);
            data.put("title", title);

            this.model = model;
        }

        public Map<String, Object> getData() {
            return data;
        }

        public void setData(Map<String, Object> data) {
            this.data = data;
        }

        public DeviceInfo getModel() {
            return model;
        }

        public void setModel(DeviceInfo model) {
            this.model = model;
        }
    }
}
