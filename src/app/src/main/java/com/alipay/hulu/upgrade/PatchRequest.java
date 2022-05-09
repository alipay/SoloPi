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
package com.alipay.hulu.upgrade;

import android.app.Activity;
import android.util.Pair;

import com.alipay.hulu.R;
import com.alipay.hulu.activity.BaseActivity;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.DeviceInfoUtil;
import com.alipay.hulu.common.utils.HttpUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.PatchProcessUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.common.utils.patch.PatchLoadResult;
import com.alipay.hulu.shared.node.utils.AssetsManager;

import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

import okhttp3.Call;

/**
 * Created by ruyao.yry on 2018/3/25.
 *
 * 升级管理
 */

public class PatchRequest {
    private static final String TAG = "PatchRequest";
    /**
     * 强制升级
     */
    private static final String REQUIRED = "required";
    private static final String INVALID = "invalid";

    /**
     * 基础依赖插件
     */
    private static final String BASE = "base";

    /**
     * 更新Patch列表
     */
    public static void updatePatchList(final LoadPatchCallback callback) {
        String storedUrl = SPService.getString(SPService.KEY_PATCH_URL, "https://raw.githubusercontent.com/alipay/SoloPi/master/<abi>.json");
        // 地址为空
        if (StringUtil.isEmpty(storedUrl)) {
            LogUtil.e(TAG, "Patch url is empty");
            return;
        }

        String cpuAbi = DeviceInfoUtil.getCPUABIInArm();
        // 替换ABI参数
        String realUrl = StringUtil.patternReplace(storedUrl, "<abi>", cpuAbi);

        LogUtil.i(TAG, "Start request patch list on: " + realUrl);

        // 下载Patch列表
        HttpUtil.get(realUrl, new HttpUtil.Callback<PatchResponse>(PatchResponse.class) {
            @Override
            public void onResponse(Call call, PatchResponse item) throws IOException {
                doUpgradePatch(item);
                if (callback != null) {
                    callback.onLoaded();
                }
            }

            @Override
            public void onFailure(Call call, IOException e) {
                LogUtil.e(TAG, "抛出IO异常，" + e.getMessage(), e);
                LauncherApplication.getInstance().showToast(StringUtil.getString(R.string.constant__plugin_load_fail) + e.getMessage());
                if (callback != null) {
                    callback.onFailed();
                }
            }
        });
    }

    /**
     * 解析Patch列表
     * @param response
     */
    public static void doUpgradePatch(PatchResponse response) {
        LogUtil.i(TAG, "接收patch列表" + response);
        if (response == null || !StringUtil.equals(response.getStatus(), "success")) {
            return;
        }

        List<PatchResponse.DataBean> patches = response.getData();
        if (patches == null || patches.size() == 0) {
            LogUtil.i(TAG, "Patch 数据量为空");
            return;
        }

        final AtomicInteger loadingCount = new AtomicInteger(0);

        Map<String, Pair<Float, String>> patchMap = new HashMap<>();
        for (final PatchResponse.DataBean data : patches) {

            // invalid的插件删除掉
            if (StringUtil.equals(data.getType(), INVALID)) {
                LogUtil.i(TAG, "Patch %s 不再可用，移除", data.getName());
                ClassUtil.removePatch(data.getName());
                continue;
            }

            patchMap.put(data.getName(), new Pair<>(data.getVersion(), data.getUrl()));
            // 强制升级
            if (StringUtil.equals(data.getType(), REQUIRED)) {
                PatchLoadResult result = ClassUtil.getPatchInfo(data.getName());
                if (result != null && result.version < data.getVersion()) {
                    LogUtil.i(TAG, "强制升级插件： %s, 版本号from %f to %f", data.getName(),
                            result.version, data.getVersion());
                    loadingCount.incrementAndGet();
                    BackgroundExecutor.execute(new Runnable() {
                        @Override
                        public void run() {
                            Pair<String, String> assetInfo = new Pair<>(data.getName() + ".zip", data.getUrl());

                            // Use FileDownloader fail？？？
                            File f = AssetsManager.getAssetFileWithOkHttp(assetInfo, null, true);

                            // 下载失败
                            if (f == null) {
                                LogUtil.e(TAG, "下载插件失败");
                                LauncherApplication.getInstance().showToast(StringUtil.getString(R.string.patch__load_failed, data.getName()));
                                loadingCount.decrementAndGet();
                                return;
                            }
                            try {
                                PatchLoadResult patchResult = PatchProcessUtil.dynamicLoadPatch(f);
                                if (patchResult != null) {
                                    ClassUtil.installPatch(patchResult);
                                }
                            } catch (Throwable e) {
                                LogUtil.e(TAG, "更新插件异常", e);
                            }
                            loadingCount.decrementAndGet();
                        }
                    });
                }
            }

            // 基础依赖，必须安装
            if (StringUtil.equals(data.getType(), BASE)) {
                PatchLoadResult result = ClassUtil.getPatchInfo(data.getName());
                if (result == null || result.version < data.getVersion()) {
                    LogUtil.i(TAG, "安装基础依赖插件： %s, 版本号：%f", data.getName(),
                            data.getVersion());
                    loadingCount.incrementAndGet();
                    BackgroundExecutor.execute(new Runnable() {
                        @Override
                        public void run() {
                            Pair<String, String> assetInfo = new Pair<>(data.getName() + ".zip", data.getUrl());

                            // Use FileDownloader fail？？？
                            File f = AssetsManager.getAssetFileWithOkHttp(assetInfo, null, true);

                            // 下载失败
                            if (f == null) {
                                LogUtil.e(TAG, "下载插件失败");
                                loadingCount.decrementAndGet();
                                return;
                            }
                            try {
                                PatchLoadResult patchResult = PatchProcessUtil.dynamicLoadPatch(f);
                                if (patchResult != null) {
                                    ClassUtil.installPatch(patchResult);
                                }
                            } catch (Throwable e) {
                                LogUtil.e(TAG, "更新插件异常", e);
                            }
                            loadingCount.decrementAndGet();
                        }
                    });
                }
            }

        }

        if (loadingCount.get() > 0) {
            final BaseActivity activity = (BaseActivity) LauncherApplication.getInstance().loadActivityOnTop();
            if (activity != null) {
                activity.showProgressDialog(StringUtil.getString(R.string.patch__loading_plugin_wait));
                BackgroundExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        while (!loadingCount.compareAndSet(0, 0)) {
                            MiscUtil.sleep(5);
                        }
                        activity.dismissProgressDialog();
                    }
                });
            }
        }

        // 更新本地插件版本
        ClassUtil.updateAvailablePatches(patchMap);
    }

    private static final Set<String> ACCEPT_ABI = new HashSet<String>() {
        {
            add("armeabi");
            add("armeabi-v7a");
            add("arm64-v8a");
        }
    };

    public interface LoadPatchCallback {
        void onLoaded();
        void onFailed();
    }
}
