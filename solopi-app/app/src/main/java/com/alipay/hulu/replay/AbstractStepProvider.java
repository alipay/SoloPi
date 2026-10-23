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
package com.alipay.hulu.replay;

import android.app.ActivityManager;
import android.content.Context;
import android.content.DialogInterface;
import androidx.appcompat.app.AlertDialog;

import android.os.Build;
import android.view.View;

import com.alipay.hulu.R;
import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.bean.ReplayStepInfoBean;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.service.CaseReplayManager;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;
import com.alipay.hulu.util.DialogUtils;

import java.io.IOException;
import java.util.Arrays;
import java.util.Date;
import java.util.List;

/**
 * Created by qiaoruikai on 2018/10/16 12:40 AM.
 */
public abstract class AbstractStepProvider {
    private static final String TAG = "AbstStepProvider";
    Date replayStartTime;

    /**
     * 准备操作
     */
    public void prepare() {
        replayStartTime = new Date();
    }

    /**
     * 是否可以手动调用启动
     * @return
     */
    public boolean canStart() {
        return true;
    }

    /**
     * 获取步骤
     * @return
     */
    public abstract OperationStep provideStep();

    /**
     * 是否还有下一步
     * @return
     */
    public abstract boolean hasNext();

    /**
     * 上报故障步骤
     * @param step 步骤
     * @param reason 故障原因
     * @return 是否是故障
     */
    public abstract boolean reportErrorStep(OperationStep step, String reason, List<String> callStack);

    /**
     * 获取回放结果
     * @return
     */
    public List<ReplayResultBean> genReplayResult() {
        ReplayResultBean resultBean = new ReplayResultBean();

        resultBean.setStartTime(replayStartTime);
        resultBean.setEndTime(new Date());

        return Arrays.asList(resultBean);
    }

    /**
     * 上报当前步骤操作信息
     * @param bean
     */
    public abstract void onStepInfo(ReplayStepInfoBean bean);

    public void onFloatClick(Context context, final CaseReplayManager manager) {
        DialogUtils.showFunctionView(context, Arrays.asList(PerformActionEnum.NORMAL_EXIT, PerformActionEnum.FORCE_STOP), new DialogUtils.FunctionViewCallback<PerformActionEnum>() {

            @Override
            public void onExecute(DialogInterface dialog, PerformActionEnum action) {
                if (action == PerformActionEnum.NORMAL_EXIT) {
                    manager.stopRunning();
                } else if (action == PerformActionEnum.FORCE_STOP) {
                    // 移除所有Task
                    ActivityManager am = (ActivityManager) LauncherApplication.getInstance()
                            .getSystemService(Context.ACTIVITY_SERVICE);
                    if (am != null && Build.VERSION.SDK_INT >= 21) {
                        try {
                            List<ActivityManager.AppTask> tasks = am.getAppTasks();
                            for (ActivityManager.AppTask task: tasks) {
                                task.finishAndRemoveTask();
                            }
                        } catch (Exception e) {
                            e.printStackTrace();
                        }
                    }
                    BackgroundExecutor.execute(new Runnable() {
                        @Override
                        public void run() {
                            int pid = android.os.Process.myPid();
                            String command = "kill -9 "+ pid;
                            try {
                                Runtime.getRuntime().exec(command);
                            } catch (IOException e) {
                                LogUtil.e(TAG, "强制关闭进程失败");
                            }
                            // adb强杀
                            try {
                                String cmd = "am force-stop " + LauncherApplication.getInstance().getPackageName();
                                CmdTools.execCmd(cmd + " && " + cmd);
                            } catch (Throwable e) {
                                LogUtil.w(TAG, "force-stop fail??", e);
                            }
                        }
                    }, 200);

                    // System exit
                    System.exit(0);
                }
                dialog.dismiss();
            }

            @Override
            public void onCancel(DialogInterface dialog) {
                dialog.dismiss();
            }

            @Override
            public void onDismiss(DialogInterface dialog) {

            }
        });
    }

    /**
     * 提供悬浮窗界面
     * @param context
     * @return
     */
    public View provideView(Context context) {
        return null;
    }
}
