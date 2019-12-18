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
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.OperationService;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.utils.AppUtil;
import com.alipay.hulu.shared.node.utils.PrepareUtil;
import com.alipay.hulu.shared.node.utils.prepare.PrepareWorker;

/**
 * 清理数据准备器
 * Created by qiaoruikai on 2019-10-09 12:15.
 */
@PrepareWorker.PrepareTool(priority = Integer.MAX_VALUE)
public class StopAppPreparer implements PrepareWorker {
    public static final String KEY_CLEAR_APP_DATA = "K_clearAppData";
    public static final String KEY_CLEARED_APP_DATA = "K_clearedAppData";
    @Override
    public boolean doPrepareWork(String targetApp, PrepareUtil.PrepareStatus status) {
        OperationService service = LauncherApplication.service(OperationService.class);
        String clearAppData = (String) service.getRuntimeParam(KEY_CLEAR_APP_DATA);
        String clearedAppData = (String) service.getRuntimeParam(KEY_CLEARED_APP_DATA);
        if ("true".equals(clearAppData) && !("true".equals(clearedAppData))) {
            if (status != null) {
                status.currentStatus(100, 100, StringUtil.getString(R.string.prepare__clear_app_data), true);
            }

            AppUtil.clearAppData(targetApp);

            service.putRuntimeParam(KEY_CLEARED_APP_DATA, "true");
        }

        AppUtil.forceStopApp(targetApp);
        AppUtil.forceStopApp(targetApp);

        return true;
    }
}
