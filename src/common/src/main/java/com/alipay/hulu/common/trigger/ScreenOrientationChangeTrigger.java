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
package com.alipay.hulu.common.trigger;

import android.app.Activity;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.view.WindowManager;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;

import static com.alipay.hulu.common.constant.Constant.SCREEN_ORIENTATION;

@Trigger(Trigger.TRIGGER_TIME_HOME_PAGE)
public class ScreenOrientationChangeTrigger implements Runnable {
    private static final String TAG = ScreenOrientationChangeTrigger.class.getSimpleName();

    @Override
    public void run() {
        // 注册屏幕旋转方向监听器
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_CONFIGURATION_CHANGED);
        LauncherApplication.getInstance().registerReceiver(new ScreenOrientationChangeEventListener(),filter);
    }



    /**
     * 屏幕方向旋转监听器
     */
    private static class ScreenOrientationChangeEventListener extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null) {
                return;
            }

            String action = intent.getAction();
            // 屏幕旋转
            if (StringUtil.equals(action, Intent.ACTION_CONFIGURATION_CHANGED)) {
                LogUtil.i(TAG, "Intent extras: " + intent.getExtras());
                LogUtil.i(TAG, "Intent data: " + intent.getData());
                LogUtil.i(TAG, "Intent scheme: " + intent.getScheme());

                // 等Injector初始化
                if (InjectorService.g() == null) {
                    return;
                }

                // 如果有Activity
                Activity activity = (Activity) LauncherApplication.getInstance().loadActivityOnTop();
                if (activity != null) {
                    InjectorService.g().pushMessage(SCREEN_ORIENTATION, activity.getWindowManager().getDefaultDisplay().getRotation());
                    return;
                }

                // 从Service获取
                Service service = (Service) LauncherApplication.getInstance().loadRunningService();

                // 没有就只能忽略
                if (service == null) {
                    LogUtil.w(TAG, "No Foreground service or activity");
                    return;
                }

                // 找WindowManager
                WindowManager wm = (WindowManager) service.getSystemService(Context.WINDOW_SERVICE);
                int rotation = wm.getDefaultDisplay().getRotation();

                // 推送屏幕方向
                InjectorService.g().pushMessage(SCREEN_ORIENTATION, rotation);
            }
        }
    }
}
