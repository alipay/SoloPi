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

import com.alipay.hulu.common.utils.LogUtil;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Use code from <a href="http://blog.sina.com.cn/s/blog_600ff0750100x61j.html">Android Zip格式压缩和解压缩(ZipUtil.java)</a>
 */
public class ZipUtil {
    private static final String TAG = "ZipUtil";

    /**
     * 打zip包
     * @param files
     * @param dest
     */
    public static File zip(List<File> files, File dest) {
        //提供了一个数据项压缩成一个ZIP归档输出流
        ZipOutputStream out = null;
        try {
            if (dest.exists()) {
                dest.delete();
            }

            out = new ZipOutputStream(new FileOutputStream(dest));
            //如果此文件是一个文件，否则为false。
            for (File f: files) {
                zipFileOrDirectory(out, f, "");
            }

            // 停止上报
            out.close();

            return dest;
        } catch (IOException ex) {
            LogUtil.e(TAG, "抛出IOException: " + ex.getMessage(), ex);
            return null;
        } finally {
            //关闭输出流
            if (out != null) {
                try {
                    out.close();
                } catch (IOException ex) {
                    LogUtil.e(TAG, "抛出IOException: " + ex.getMessage(), ex);
                }
            }
        }
    }

    /**
     * 压缩文件
     * @param out
     * @param fileOrDirectory
     * @param curPath
     * @throws IOException
     */
    private static void zipFileOrDirectory(ZipOutputStream out,
                                           File fileOrDirectory, String curPath) throws IOException {
        //从文件中读取字节的输入流
        FileInputStream in = null;
        try {
            //如果此文件是一个目录，否则返回false。
            if (!fileOrDirectory.isDirectory()) {
                // 压缩文件
                byte[] buffer = new byte[4096];
                int bytes_read;
                in = new FileInputStream(fileOrDirectory);
                //实例代表一个条目内的ZIP归档
                ZipEntry entry = new ZipEntry(curPath
                        + fileOrDirectory.getName());
                //条目的信息写入底层流
                out.putNextEntry(entry);

                while ((bytes_read = in.read(buffer)) > 0) {
                    out.write(buffer, 0, bytes_read);
                }

                out.flush();
                out.closeEntry();
            } else {
                // 压缩目录
                File[] entries = fileOrDirectory.listFiles();
                for (int i = 0; i < entries.length; i++) {
                    // 递归压缩，更新curPaths
                    zipFileOrDirectory(out, entries[i], curPath
                            + fileOrDirectory.getName() + "/");
                }
            }
        } catch (IOException ex) {
            LogUtil.e(TAG, "Zip file " + curPath + " throws exception: " + ex, ex);
            // throw ex;
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (IOException ex) {
                    LogUtil.e(TAG, "Close file " + curPath + " throws exception: " + ex, ex);
                }
            }
        }
    }
}