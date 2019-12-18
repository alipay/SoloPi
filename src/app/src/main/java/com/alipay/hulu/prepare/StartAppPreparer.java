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
package com.alipay.hulu.prepare;

import com.alipay.hulu.R;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.OperationService;
import com.alipay.hulu.shared.node.action.OperationContext;
import com.alipay.hulu.shared.node.action.OperationExecutor;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.utils.AppUtil;
import com.alipay.hulu.shared.node.utils.PrepareUtil;
import com.alipay.hulu.shared.node.utils.prepare.PrepareWorker;

import java.util.concurrent.CountDownLatch;

/**
 * Created by qiaoruikai on 2019/10/9 9:34 PM.
 */
@PrepareWorker.PrepareTool(priority = 0)
public class StartAppPreparer implements PrepareWorker {
    private static final String TAG = "StartAppPreparer";
    public static final String KEY_PREPARED_APP_ALERT = "K_preparedAppAlert";

    @Override
    public boolean doPrepareWork(String targetApp, PrepareUtil.PrepareStatus status) {
        if (status != null) {
            status.currentStatus(100, 100, StringUtil.getString(R.string.prepare__restart_app), true);
        }
        
        AppUtil.startApp(targetApp);

        OperationService service = LauncherApplication.service(OperationService.class);
        String clearAppData = (String) service.getRuntimeParam(StopAppPreparer.KEY_CLEARED_APP_DATA);
        String preparedAppAlert = (String) service.getRuntimeParam(KEY_PREPARED_APP_ALERT);
        if ("true".equals(clearAppData) && !("true".equals(preparedAppAlert))) {
            if (status != null) {
                status.currentStatus(100, 100, StringUtil.getString(R.string.prepare__handle_start_alert), true);
            }

            // 处理清理数据后弹出的权限弹窗
            final CountDownLatch latch = new CountDownLatch(1);
            OperationMethod method = new OperationMethod(PerformActionEnum.HANDLE_ALERT);
            service.doSomeAction(method, null, new OperationContext.OperationListener() {
                @Override
                public void notifyOperationFinish() {
                    latch.countDown();
                }
            });

            try {
                latch.await();
            } catch (InterruptedException e) {
                LogUtil.e(TAG, "Catch java.lang.InterruptedException: " + e.getMessage(), e);
            }

            service.putRuntimeParam(KEY_PREPARED_APP_ALERT, "true");
        }
        return true;
    }
}
