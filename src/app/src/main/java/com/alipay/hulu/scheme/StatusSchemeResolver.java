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
package com.alipay.hulu.scheme;

import android.content.Context;
import android.provider.Settings;
import android.util.Log;

import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.scheme.SchemeActionResolver;
import com.alipay.hulu.common.scheme.SchemeResolver;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.OperationService;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;

import java.util.Arrays;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;

import static com.alipay.hulu.shared.event.constant.Constant.RUNNING_STATUS;

@SchemeResolver("status")
public class StatusSchemeResolver implements SchemeActionResolver {
    private static final String TAG = StatusSchemeResolver.class.getSimpleName();

    public static final String KEY_STATUS_TYPE = "type";
    public static final String KEY_STATUS = "status";
    public static final String KEY_PAGE = "page";

    public StatusSchemeResolver() {
        InjectorService.g().register(this);
    }

    private String currentStatus = "none";

    @Subscriber(@Param(RUNNING_STATUS))
    public void setCurrentStatus(String currentStatus) {
        this.currentStatus = currentStatus;
    }

    @Override
    public boolean processScheme(Context context, Map<String, String> params, final Callback<Map<String, Object>> callback) {
        String type = params.get(KEY_STATUS_TYPE);
        if (StringUtil.isEmpty(type)) {
            return false;
        }

        LogUtil.i(TAG, "Status Scheme处理中，请求参数：" + params);
        switch (type) {
            case KEY_STATUS:
                callback.onResult(Collections.<String, Object>singletonMap("status", currentStatus));
                return true;
            case KEY_PAGE:
                boolean isGranted = PermissionUtil.getPermissionStatus(context, "adb") && PermissionUtil.getPermissionStatus(context, Settings.ACTION_ACCESSIBILITY_SETTINGS);
                if (!isGranted) {
                    final AtomicBoolean permissionResult = new AtomicBoolean(false);
                    final CountDownLatch latch = new CountDownLatch(1);
                    PermissionUtil.requestPermissions(Arrays.asList("adb", Settings.ACTION_ACCESSIBILITY_SETTINGS), LauncherApplication.getInstance().getBestForegroundContext(), new PermissionUtil.OnPermissionCallback() {
                        @Override
                        public void onPermissionResult(boolean result, String reason) {
                            permissionResult.set(result);
                            latch.countDown();
                        }
                    });

                    try {
                        latch.await();
                    } catch (InterruptedException e) {
                        Log.e(TAG, "等待权限授予失败", e);
                    }
                    if (!permissionResult.get()) {
                        callback.onResult(Collections.<String, Object>singletonMap("error", "未授予权限"));
                        return true;
                    }
                }
                // 等500ms后再加载页面信息
                final CountDownLatch getNodeLatch = new CountDownLatch(1);
                BackgroundExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        OperationService service = LauncherApplication.service(OperationService.class);
                        AbstractNodeTree root = service.getBaseCurrentRoot();

                        // 构造可传输的树结构
                        JSONObject obj = root.exportToJsonObject();

                        callback.onResult(Collections.<String, Object>singletonMap("page", obj));
                        service.invalidRoot();
                        getNodeLatch.countDown();
                    }
                }, 500);
                try {
                    getNodeLatch.await();
                } catch (InterruptedException e) {
                    LogUtil.e(TAG, "Load node failed", e);
                }

                return true;
        }

        return false;
    }
}
