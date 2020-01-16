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
package com.alipay.hulu.shared.node.utils;

import android.util.Pair;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.PatchProcessUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.common.utils.patch.PatchLoadResult;
import com.alipay.hulu.shared.R;
import com.liulishuo.filedownloader.BaseDownloadTask;
import com.liulishuo.filedownloader.FileDownloadSampleListener;
import com.liulishuo.filedownloader.FileDownloader;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;


/**
 * 资源管理器
 */
public class AssetsManager {

    public static long MAX_PENDING_TIME = 15000;

    private static final String TAG = "AssetsManager";

    public static PatchLoadResult loadPatchFromServer(String name, PrepareUtil.PrepareStatus prepareStatus) {
        LauncherApplication.getInstance().showToast(StringUtil.getString(R.string.assets__load_plugin, name));

        // 如果没有下载地址
        Pair<Float, String> patchInfo = ClassUtil.getAvaliablePatchInfo(name);
        if (patchInfo == null) {
            LogUtil.e(TAG, "Patch %s 不存在", name);
            return null;
        }

        Pair<String, String> assetInfo = new Pair<>(name + ".zip", patchInfo.second);
        File f = AssetsManager.getAssetFile(assetInfo, prepareStatus, true);

        prepareStatus.currentStatus(100, 100, StringUtil.getString(R.string.assets__load_plugin, name), true);
        boolean success = false;
        try {

            PatchLoadResult result = PatchProcessUtil.dynamicLoadPatch(f);
            if (result != null) {
                ClassUtil.installPatch(result);
                success = true;
            } else {
                LogUtil.e(TAG, "插件安装失败");
            }
        } catch (Throwable e) {
            LogUtil.e(TAG, "加载插件异常", e);
        }

        prepareStatus.currentStatus(100, 100, StringUtil.getString(R.string.loading_plugin_finish), success);
        LauncherApplication.getInstance().showToast(StringUtil.getString(R.string.assets__load_plugin_result, success));

        return ClassUtil.getPatchInfo(name);
    }

    public static PatchLoadResult loadPatchFromServer(final String name) {
        return loadPatchFromServer(name, new PrepareUtil.PrepareStatus() {
            @Override
            public void currentStatus(int progress, int total, String message, boolean status) {
                LogUtil.i(TAG, "Load patch %s, progress: %d/%d, message: %s", name, progress, total, message);
            }
        });
    }

    public static File getAssetFile(Pair<String, String> assetInfo, final PrepareUtil.PrepareStatus status) {
        return getAssetFile(assetInfo, status, false);
    }

    /**
     * 获取asset资源文件
     * @param assetInfo
     * @param status
     * @return
     */
    public static File getAssetFile(Pair<String, String> assetInfo, final PrepareUtil.PrepareStatus status, boolean overwrite) {
        final long startTime = System.currentTimeMillis();
        String path = assetInfo.first;

        File targetFile = new File(FileUtils.getSubDir("download"), path);
        final AtomicBoolean finishFileDownload = new AtomicBoolean(false);
        final AtomicBoolean success = new AtomicBoolean(false);

        // overwrite重新下载
        if (overwrite) {
            if (targetFile.exists()) {
                targetFile.delete();
            }
        }

        // 不存在需要重新下载
        if (!targetFile.exists()) {
            final String url = assetInfo.second;
            FileDownloader.getImpl().create(url)
                    .setPath(targetFile.getAbsolutePath())
                    .setCallbackProgressTimes(50)
                    .setAutoRetryTimes(3)
//                    .addHeader("Referer", "https://github.com/alipay/SoloPi/")
                    .setListener(new FileDownloadSampleListener() {
                        @Override
                        protected void completed(BaseDownloadTask task) {
                            super.completed(task);
                            if (status != null) {
                                status.currentStatus(100, 100, StringUtil.getString(R.string.assets_downloaded), true);
                            }
                            success.set(true);
                            finishFileDownload.set(true);
                        }

                        @Override
                        protected void progress(BaseDownloadTask task, int soFarBytes, int totalBytes) {
                            super.progress(task, soFarBytes, totalBytes);
                            int downloadedKB = soFarBytes / 1024;
                            int totalKB = totalBytes / 1024;

                            if (status != null) {
                                status.currentStatus(downloadedKB, totalKB,
                                        String.format(StringUtil.getString(R.string.downloading__assets), downloadedKB, totalKB), true);
                            }
                        }

                        @Override
                        protected void pending(BaseDownloadTask task, int soFarBytes, int totalBytes) {
                            super.pending(task, soFarBytes, totalBytes);


                            if (System.currentTimeMillis() - startTime > MAX_PENDING_TIME) {
                                task.pause();
                                finishFileDownload.set(true);
                                LogUtil.e(TAG, "Pending too long , cancel download");
                            }

                            if (status != null) {
                                long downloadedKB = 0;
                                long totalKB = 100;
                                status.currentStatus((int) downloadedKB, (int) totalKB, StringUtil.getString(R.string.assets_to_download), true);
                            }
                        }

                        @Override
                        protected void error(BaseDownloadTask task, Throwable e) {
                            super.error(task, e);
                            long downloadedKB = 0;
                            long totalKB = 100;

                            if (status != null) {
                                status.currentStatus((int) downloadedKB, (int) totalKB,
                                        StringUtil.getString(R.string.assets_download_fail) + e.getMessage(), false);
                            }
                            LogUtil.e(TAG, "Download failed: " + e.getMessage(), e);
                            finishFileDownload.set(true);
                        }
                    }).start();

            // 等待下载完毕
            do {
                MiscUtil.sleep(200);
            } while (!finishFileDownload.get());

            // 当前状态不为成功
            if (!success.get()) {
                LogUtil.e(TAG, "Download file failed");
                if (targetFile.exists()) {
                    targetFile.delete();
                }
                return null;
            }

            if (!targetFile.exists()) {
                LogUtil.e(TAG, "Download file not exists");
                return null;
            }
        } else {
            // 修改下操作时间，防止被回收
            targetFile.setLastModified(System.currentTimeMillis());
        }

        LogUtil.w(TAG, "Get file costs: " + (System.currentTimeMillis() - startTime));

        return targetFile;
    }

    /**
     * 获取asset资源文件
     * @param assetInfo
     * @param status
     * @return
     */
    public static File getAssetFileWithOkHttp(Pair<String, String> assetInfo, final PrepareUtil.PrepareStatus status, boolean overwrite) {
        final long startTime = System.currentTimeMillis();
        String path = assetInfo.first;

        File targetFile = new File(FileUtils.getSubDir("download"), path);

        // overwrite重新下载
        if (overwrite) {
            if (targetFile.exists()) {
                targetFile.delete();
            }
        }

        // 不存在需要重新下载
        if (!targetFile.exists()) {
            final String url = assetInfo.second;
            boolean result = download(url, targetFile);

            if (!result || !targetFile.exists()) {
                LogUtil.e(TAG, "Download file not exists");
                return null;
            }
        } else {
            // 修改下操作时间，防止被回收
            targetFile.setLastModified(System.currentTimeMillis());
        }

        LogUtil.w(TAG, "Get file costs: " + (System.currentTimeMillis() - startTime));

        return targetFile;
    }

    /**
     * 下载文件
     * @param url          下载连接
     * @param targetFile   目标文件
     */
    public static boolean download(final String url, final File targetFile) {
        Request request = new Request.Builder()
                .url(url)
                .build();

        OkHttpClient client = new OkHttpClient();

        Response response;
        try {
            response = client.newCall(request).execute();
        } catch (IOException e) {
            LogUtil.e(TAG,"Open connection fail", e);
            return false;
        }

        InputStream is = null;
        byte[] buf = new byte[8192];
        int len;
        BufferedOutputStream buffer = null;

        //储存下载文件的目录
        try {
            is = response.body().byteStream();
            buffer = new BufferedOutputStream(new FileOutputStream(targetFile));
            while ((len = is.read(buf)) != -1) {
                buffer.write(buf, 0, len);
            }
            buffer.flush();
            //下载完成
            return true;
        } catch (Exception e) {
            LogUtil.e(TAG, "Download fail", e);
            return false;
        } finally {

            try {
                if (is != null) {
                    is.close();
                }
                if (buffer != null) {
                    buffer.close();
                }
            } catch (IOException e) {

            }

        }
    }

}
