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

import android.content.Context;
import android.content.DialogInterface;
import androidx.appcompat.app.AlertDialog;
import android.view.View;

import com.alipay.hulu.R;
import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.bean.ReplayStepInfoBean;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.service.CaseReplayManager;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;

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
        showFunctionView(context, "是否终止回放", new Runnable() {
            @Override
            public void run() {
                manager.stopRunning();
            }
        }, null);
    }

    /**
     * 提供悬浮窗界面
     * @param context
     * @return
     */
    public View provideView(Context context) {
        return null;
    }

    /**
     * 展示操作dialog
     * @param message 消息
     * @param confirmAction 确定动作
     * @param cancelAction 取消动作
     */
    protected void showFunctionView(Context context, String message, final Runnable confirmAction, final Runnable cancelAction) {
        try {
            AlertDialog dialog = new AlertDialog.Builder(context, R.style.SimpleDialogTheme)
                    .setMessage(message)
                    .setPositiveButton(R.string.constant__confirm, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            if (confirmAction != null) {
                                confirmAction.run();
                            }
                            dialog.dismiss();
                        }
                    })
                    .setNegativeButton(R.string.constant__cancel, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            if (cancelAction != null) {
                                cancelAction.run();
                            }
                            dialog.dismiss();
                        }
                    }).setOnCancelListener(new DialogInterface.OnCancelListener() {
                        @Override
                        public void onCancel(DialogInterface dialog) {
                            dialog.dismiss();
                        }
                    }).create();
            dialog.getWindow().setType(com.alipay.hulu.common.constant.Constant.TYPE_ALERT);
            dialog.setCanceledOnTouchOutside(false);
            dialog.show();
        } catch (Exception e) {
            LogUtil.e(TAG, e.getMessage());
        }
    }
}
