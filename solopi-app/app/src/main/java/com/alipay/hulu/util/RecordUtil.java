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
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.Charset;
import java.nio.charset.UnsupportedCharsetException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.DateFormat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import okhttp3.MediaType;
import okhttp3.RequestBody;

/**
 * Created by qiaoruikai on 2019/1/9 12:17 AM.
 */
public class RecordUtil {
    private static final String TAG = "RecordUtil";
    private static final DateFormat TIME_FORMAT = new SimpleDateFormat("yyyyMMddHHmmss", Locale.CHINA);
    private static final String PERFORMANCE_FOLDER_PREFIX = "performance-";
    private static final String PERFORMANCE_SESSION_PATTERN =
            "[A-Za-z0-9][A-Za-z0-9._-]{0,115}";

    public static boolean isValidPerformanceSessionId(String sessionId) {
        return sessionId != null && sessionId.matches(PERFORMANCE_SESSION_PATTERN);
    }

    public static String performanceFolderName(String sessionId) throws IOException {
        if (!isValidPerformanceSessionId(sessionId)) {
            throw new IOException("Invalid performance sessionId");
        }
        return PERFORMANCE_FOLDER_PREFIX + sessionId;
    }

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
        Charset charset = loadOutputCharset();

        for (Map.Entry<RecordPattern, List<RecordPattern.RecordItem>> entry: records.entrySet()){
            RecordPattern pattern = entry.getKey();

            // 文件输出名称为：${Name}_${Category}_${StartMilli}_${EndMilli}.csv，","分隔
            File saveFile = new File(saveFolder, pattern.getName() + "_" + pattern.getSource() + "_" + pattern.getStartTime() + "_" + pattern.getEndTime() + ".csv");
            try {
                if (saveFile.createNewFile()) {
                    BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(saveFile), charset));

                    // 第一行写标题
                    writer.write("RecordTime," + pattern.getName() + "(" + pattern.getUnit() + "),extra,SimpleTime\n");
                    writer.flush();
                    long dataStartTime = entry.getKey().getStartTime();

                    // 写入录制
                    for (RecordPattern.RecordItem item: entry.getValue()) {
                        writer.write(item.time + "," + item.value + "," + item.extra + "," + (item.time - dataStartTime) / 1000F + "\n");
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
     * Strict performance export for external automation. The final directory is unique to the
     * caller's session and only becomes visible after every CSV has been written successfully.
     */
    public static File saveToFileStrict(
            Map<RecordPattern, List<RecordPattern.RecordItem>> records,
            String folderName) throws IOException {
        if (records == null || records.isEmpty()) {
            throw new IOException("No performance records were collected");
        }
        if (folderName == null || !folderName.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,127}")) {
            throw new IOException("Invalid performance record folder name");
        }

        File recordDir = FileUtils.getSubDir("records");
        File saveFolder = new File(recordDir, folderName);
        if (saveFolder.exists()) {
            throw new IOException("Performance record folder already exists");
        }

        File temporaryFolder = new File(recordDir,
                "." + folderName + ".tmp-" + UUID.randomUUID().toString());
        if (!temporaryFolder.mkdir()) {
            throw new IOException("Unable to create temporary performance record folder");
        }

        boolean completed = false;
        try {
            Charset charset = loadOutputCharset();
            for (Map.Entry<RecordPattern, List<RecordPattern.RecordItem>> entry
                    : records.entrySet()) {
                writeRecordFile(temporaryFolder, entry, charset);
            }
            if (!temporaryFolder.renameTo(saveFolder)) {
                throw new IOException("Unable to publish performance record folder");
            }
            completed = true;
            return saveFolder;
        } finally {
            if (!completed) {
                FileUtils.deleteFile(temporaryFolder);
            }
        }
    }

    private static void writeRecordFile(
            File folder,
            Map.Entry<RecordPattern, List<RecordPattern.RecordItem>> entry,
            Charset charset) throws IOException {
        RecordPattern pattern = entry.getKey();
        String identity = String.valueOf(pattern.getName()) + "\u0000"
                + String.valueOf(pattern.getSource()) + "\u0000"
                + String.valueOf(pattern.getUnit()) + "\u0000"
                + pattern.getStartTime() + "\u0000" + pattern.getEndTime();
        String fileName = safeFilePart(pattern.getName()) + "_"
                + safeFilePart(pattern.getSource()) + "_"
                + stableFileSuffix(identity) + "_"
                + pattern.getStartTime() + "_" + pattern.getEndTime() + ".csv";
        File saveFile = new File(folder, fileName);
        if (!saveFile.createNewFile()) {
            throw new IOException("Duplicate performance record file: " + fileName);
        }

        BufferedWriter writer = null;
        try {
            writer = new BufferedWriter(new OutputStreamWriter(
                    new FileOutputStream(saveFile), charset));
            writer.write("RecordTime," + pattern.getName() + "("
                    + pattern.getUnit() + "),extra,SimpleTime\n");
            long dataStartTime = pattern.getStartTime();
            List<RecordPattern.RecordItem> items = entry.getValue();
            if (items != null) {
                for (RecordPattern.RecordItem item : items) {
                    writer.write(item.time + "," + item.value + "," + item.extra + ","
                            + (item.time - dataStartTime) / 1000F + "\n");
                }
            }
        } finally {
            if (writer != null) {
                writer.close();
            }
        }
    }

    private static String safeFilePart(String value) {
        if (value == null || value.length() == 0) {
            return "unknown";
        }
        StringBuilder result = new StringBuilder(Math.min(value.length(), 24));
        for (int i = 0; i < value.length() && result.length() < 24; i++) {
            char character = value.charAt(i);
            if (Character.isISOControl(character)
                    || character == '/' || character == '\\' || character == ':') {
                result.append('_');
            } else {
                result.append(character);
            }
        }
        String normalized = result.toString();
        return ".".equals(normalized) || "..".equals(normalized) ? "unknown" : normalized;
    }

    private static String stableFileSuffix(String identity) throws IOException {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(
                    identity.getBytes("UTF-8"));
            char[] hex = "0123456789abcdef".toCharArray();
            StringBuilder suffix = new StringBuilder(16);
            for (int i = 0; i < 8; i++) {
                int value = digest[i] & 0xFF;
                suffix.append(hex[value >>> 4]);
                suffix.append(hex[value & 0x0F]);
            }
            return suffix.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IOException("SHA-256 is not available", e);
        }
    }

    private static Charset loadOutputCharset() {
        String charsetName = SPService.getString(SPService.KEY_OUTPUT_CHARSET, "GBK");
        try {
            return Charset.forName(charsetName);
        } catch (UnsupportedCharsetException e) {
            LogUtil.w(TAG, "unsupported charset for name=" + charsetName, e);
            return Charset.forName("UTF-8");
        }
    }




    /**
     * 加载保存目录
     * @param startTime
     * @param endTime
     * @return
     */
    private static File loadSaveDir(Date startTime, Date endTime) {
        File recordDir = FileUtils.getSubDir("records");
        File saveFolder = new File(recordDir, TIME_FORMAT.format(startTime) + "_" + TIME_FORMAT.format(endTime));
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
