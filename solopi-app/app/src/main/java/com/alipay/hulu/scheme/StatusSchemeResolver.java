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

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static com.alipay.hulu.shared.event.constant.Constant.RUNNING_STATUS;

@SchemeResolver("status")
public class StatusSchemeResolver implements SchemeActionResolver {
    private static final String TAG = StatusSchemeResolver.class.getSimpleName();
    private static final long PAGE_QUERY_TIMEOUT_MS = 5000L;

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
                    // HTTP 查询不能弹权限框或改变设备设置；由 doctor 暴露缺口。
                    callback.onResult(pageError("page_permission_required",
                            "ADB and accessibility permissions are required"));
                    return true;
                }
                // 等500ms后再加载页面信息
                final CountDownLatch getNodeLatch = new CountDownLatch(1);
                final AtomicReference<Map<String, Object>> pageResult = new AtomicReference<>();
                try {
                    BackgroundExecutor.execute(new Runnable() {
                        @Override
                        public void run() {
                            OperationService service = null;
                            try {
                                service = LauncherApplication.service(OperationService.class);
                                if (service == null) {
                                    pageResult.set(pageError("page_service_unavailable",
                                            "Operation service is unavailable"));
                                    return;
                                }
                                AbstractNodeTree root = service.getBaseCurrentRoot();
                                if (root == null) {
                                    pageResult.set(pageError("page_root_unavailable",
                                            "Current page root is unavailable"));
                                    return;
                                }

                                // 构造可传输的树结构
                                JSONObject obj = root.exportToJsonObject();
                                if (obj == null) {
                                    pageResult.set(pageError("page_export_failed",
                                            "Current page could not be exported"));
                                    return;
                                }
                                pageResult.set(Collections.<String, Object>singletonMap(
                                        "page", obj));
                            } catch (Throwable throwable) {
                                LogUtil.e(TAG, "Load current page failed", throwable);
                                pageResult.set(pageError("page_query_failed",
                                        "Unable to load the current page"));
                            } finally {
                                try {
                                    if (service != null) {
                                        service.invalidRoot();
                                    }
                                } catch (Throwable throwable) {
                                    LogUtil.w(TAG, "Unable to invalidate current page root",
                                            throwable);
                                } finally {
                                    // 即使查询、错误回执构造或根节点清理再次抛错，也必须释放等待方。
                                    getNodeLatch.countDown();
                                }
                            }
                        }
                    }, 500);
                } catch (RuntimeException e) {
                    LogUtil.e(TAG, "Unable to schedule current page query", e);
                    callback.onResult(pageError("page_query_schedule_failed",
                            "Unable to schedule the current page query"));
                    return true;
                }

                final boolean completed;
                try {
                    completed = getNodeLatch.await(PAGE_QUERY_TIMEOUT_MS,
                            TimeUnit.MILLISECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    LogUtil.e(TAG, "Load node failed", e);
                    callback.onResult(pageError("page_query_interrupted",
                            "Current page query was interrupted"));
                    return true;
                }
                if (!completed) {
                    callback.onResult(pageError("page_query_timeout",
                            "Timed out waiting for the current page"));
                    return true;
                }

                Map<String, Object> result = pageResult.get();
                callback.onResult(result == null
                        ? pageError("page_query_failed", "Current page query returned no result")
                        : result);
                return true;
        }

        return false;
    }

    private static Map<String, Object> pageError(String code, String message) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", false);
        result.put("errorCode", code);
        result.put("error", message);
        return result;
    }
}
