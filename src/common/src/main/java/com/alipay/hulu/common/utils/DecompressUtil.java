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
package com.alipay.hulu.common.utils;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Created by qiaoruikai on 2018/12/18 8:16 PM.
 */
public class DecompressUtil {
    private static final String TAG = "DecompressUtil";

    /**
     * 解压到目标文件
     * @param originFile 原始文件
     * @param targetFolder 解压到的文件夹
     * @return
     */
    public static File decompressZip(File originFile, File targetFolder) {
        if (!originFile.exists() || !originFile.canRead()) {
            LogUtil.e(TAG, "压缩文件【%s】无法解析，不存在或者无法读取", originFile);
            return null;
        }

        FileInputStream inputStream;
        try {
            inputStream = new FileInputStream(originFile);
        } catch (FileNotFoundException e) {
            LogUtil.e(TAG, "Catch java.io.FileNotFoundException: " + e.getMessage(), e);
            return null;
        }

        String folderName = originFile.getName();
        int pointPos;
        if ((pointPos = folderName.indexOf('.')) > -1) {
            folderName = folderName.substring(0, pointPos);
        }

        // 设置为子文件夹
        targetFolder = new File(targetFolder, folderName);
        if (!targetFolder.exists()) {
            targetFolder.mkdirs();
        }

        ZipInputStream zip = new ZipInputStream(inputStream);
        ZipEntry zipEntry;
        String  szName;
        try {
            while ((zipEntry = zip.getNextEntry()) != null) {
                szName = zipEntry.getName();
                if (zipEntry.isDirectory()) {
                    //获取部件的文件夹名
                    szName = szName.substring(0, szName.length() - 1);
                    File folder = new File(targetFolder, szName);
                    if (!folder.exists()) {
                        folder.mkdirs();
                    }
                } else {
                    File file = new File(targetFolder, szName);
                    if (!file.exists()){
                        LogUtil.d(TAG, "Create the file: %s", szName);
                        if (!file.getParentFile().exists()) {
                            file.getParentFile().mkdirs();
                        }
                        file.createNewFile();
                    }
                    // 获取文件的输出流
                    FileOutputStream out = new FileOutputStream(file);
                    int len;
                    byte[] buffer = new byte[4096];
                    // 读取（字节）字节到缓冲区
                    while ((len = zip.read(buffer)) != -1) {
                        // 从缓冲区（0）位置写入（字节）字节
                        out.write(buffer, 0, len);
                        out.flush();
                    }
                    out.close();
                }
                LogUtil.d(TAG, "处理Entry=%s完毕", szName);
            }

        } catch (IOException e) {
            LogUtil.e(TAG, "Catch java.io.IOException: " + e.getMessage(), e);
        }

        return targetFolder;
    }
}
