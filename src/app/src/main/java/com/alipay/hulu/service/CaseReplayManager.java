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
package com.alipay.hulu.service;

import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.ServiceConnection;
import android.graphics.Bitmap;
import android.graphics.Point;
import android.graphics.Rect;
import android.os.Build;
import android.os.IBinder;
import android.support.v7.app.AlertDialog;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.alipay.hulu.R;
import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.bean.ReplayStepInfoBean;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.bean.DeviceInfo;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.RunningThread;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.service.ScreenCaptureService;
import com.alipay.hulu.common.service.base.ExportService;
import com.alipay.hulu.common.service.base.LocalService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.DeviceInfoUtil;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.replay.AbstractStepProvider;
import com.alipay.hulu.shared.event.EventService;
import com.alipay.hulu.shared.node.AbstractNodeProcessor;
import com.alipay.hulu.shared.node.OperationService;
import com.alipay.hulu.shared.node.action.OperationContext;
import com.alipay.hulu.shared.node.action.OperationExecutor;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.action.UIOperationMessage;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.OperationNode;
import com.alipay.hulu.shared.node.tree.accessibility.AccessibilityNodeProcessor;
import com.alipay.hulu.shared.node.tree.accessibility.AccessibilityProvider;
import com.alipay.hulu.shared.node.tree.capture.CaptureTree;
import com.alipay.hulu.shared.node.tree.export.OperationStepProvider;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;
import com.alipay.hulu.shared.node.utils.AppUtil;
import com.alipay.hulu.shared.node.utils.BitmapUtil;
import com.alipay.hulu.shared.node.utils.ContentChangeWatcher;
import com.alipay.hulu.shared.node.utils.OperationUtil;
import com.alipay.hulu.shared.node.utils.PrepareUtil;
import com.alipay.hulu.shared.node.utils.RectUtil;
import com.alipay.hulu.tools.HighLightService;

import java.io.File;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * 操作回放服务
 * Created by qiaoruikai on 2018/10/16 12:31 AM.
 */
@LocalService
public class CaseReplayManager implements ExportService {
    private static final String TAG = "CaseReplayManager";

    /**
     * 运行标记
     */
    boolean runningFlag;

    /**
     * 故障步骤
     */
    OperationStep exceptionStep;

    /**
     * 操作提供器
     */
    private AbstractStepProvider provider;

    /**
     * 操作服务
     */
    private OperationService operationService;

    /**
     * 高亮服务
     */
    private HighLightService highLightService;

    /**
     * 截图服务
     */
    private ScreenCaptureService captureService;

    private WindowManager windowManager;

    /**
     * 消息服务
     */
    private InjectorService injectorService;

    private ExecutorService runningExecutor;

    /**
     * 目标应用
     */
    private String app;

    /**
     * 悬浮窗Binder
     */
    private FloatWinService.FloatBinder binder;

    /**
     * 悬浮窗连接
     */
    private ReplayConnection connection;

    private OnFinishListener finishListener;

    private ContentChangeWatcher watcher;

    private EventService eventService;

    private FloatWinService.OnRunListener listener = new FloatWinService.OnRunListener() {
        @Override
        public int onRunClick() {
            if (provider.canStart()) {
                startProcess();
            } else {
                Toast.makeText(binder.loadServiceContext(), "无法手动启动", Toast.LENGTH_SHORT).show();
            }
            return 0;
        }
    };

    private FloatWinService.OnFloatListener floatListener = new FloatWinService.OnFloatListener() {
        @Override
        public void onFloatClick(boolean hide) {
            if (!hide && provider != null) {
                provider.onFloatClick(binder.loadServiceContext(), CaseReplayManager.this);
            }
        }
    };

    public void onCreate(Context context) {
        LauncherApplication app = LauncherApplication.getInstance();
        operationService = app.findServiceByName(OperationService.class.getName());
        injectorService = app.findServiceByName(InjectorService.class.getName());
        injectorService.register(this);
        runningExecutor = Executors.newSingleThreadExecutor();
        eventService = app.findServiceByName(EventService.class.getName());
        highLightService = app.findServiceByName(HighLightService.class.getName());

        // 截图服务
        captureService = app.findServiceByName(ScreenCaptureService.class.getName());

        windowManager = (WindowManager) app.getSystemService(Context.WINDOW_SERVICE);
    }

    /**
     * 启动Replay流程
     */
    public void start(AbstractStepProvider provider, OnFinishListener finishListener) {
        // 有连接，不需要重连
        if (connection != null) {
            return;
        }

        this.provider = provider;
        this.finishListener = finishListener;

        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                boolean result = PrepareUtil.doPrepareWork(app);
                if (result) {
                    AppUtil.forceStopApp(app);
                }
            }
        });

        List<Class<? extends AbstractNodeProcessor>> processors = new ArrayList<>();
        processors.add(AccessibilityNodeProcessor.class);
        operationService.configProcessors(processors);
        operationService.configProvider(AccessibilityProvider.class);

        Context context = LauncherApplication.getContext();
        // 连接悬浮窗
        connection = new ReplayConnection(this);
        context.getApplicationContext().bindService(new Intent(context.getApplicationContext(), FloatWinService.class), connection, Context.BIND_AUTO_CREATE);

        watcher = new ContentChangeWatcher();
        watcher.start();
        eventService.startTrackAccessibilityEvent();
    }

    /**
     * 停止replay
     */
    public void onDestroy(Context context) {
        this.provider = null;
        eventService.stopTrackAccessibilityEvent();

        if (watcher != null) {
            watcher.stop();
            watcher = null;
        }

        if (connection != null) {
            context.unbindService(connection);
            connection = null;
            binder = null;
        }

        runningExecutor.shutdownNow();
        LauncherApplication.getInstance().stopServiceByName(HighLightService.class.getName());
    }

    /**
     * 开始处理
     */
    public void startProcess() {
        // 隐藏悬浮窗
        binder.hideFloat();

        runningFlag = true;
        runningExecutor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    process();
                } catch (Exception e) {
                    LogUtil.e(TAG, "抛出异常" + e.getMessage(), e);
                }
            }
        });
    }

    /**
     * 具体执行
     */
    private void process() {
        if (provider == null) {
            LogUtil.e(TAG, "provider为空");
            return;
        }

        // 准备
        provider.prepare();

        // 执行各步骤
        while (provider.hasNext()) {
            OperationStep step = null;
            try {
                step = provider.provideStep();
            } catch (final Exception e) {
                LogUtil.e(TAG, "Provide step throw exception: " + e.getMessage(), e);
                // 强制终止
                LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        showDialog("解析异常", e.getClass() + ": " + e.getMessage(), binder.loadServiceContext(), 0);
                    }
                });
                break;
            }

            // 说明特殊情况，执行完毕
            if (step == null) {
                break;
            }

            LogUtil.d(TAG, "开始执行操作：%s", step);
            updateFloatIcon(R.drawable.solopi_running);

            String result;
            try {
                result = processOperation(step);
            } catch (Exception e) {
                LogUtil.e(TAG, "执行操作抛出异常: " + e.getMessage(), e);
                result = "执行异常:" + e.getMessage();
            }

            if (result != null) {
                LogUtil.e(TAG, "执行步骤出现问题：%s", result);

                boolean isError = provider.reportErrorStep(step, result);

                if (StringUtil.equals(result, "回放中止")) {
                    break;
                }

                // 如果是error步骤
                if (isError) {
                    break;
                }
            }

            // 更新到原始图标
            updateFloatIcon(R.drawable.solopi_float);
            MiscUtil.sleep(200);
        }

        watcher.sleepUntilContentDontChange();

        // 汇报结果
        final List<ReplayResultBean> resultBeans = provider.genReplayResult();
        // 先restore再stop
        binder.restoreFloat();
        binder.stopFloat();
        if (finishListener != null) {
            finishListener.onFinish(resultBeans, binder.loadServiceContext());
        }

        // 停止自身
        LauncherApplication.getInstance().stopServiceByName(CaseReplayManager.class.getName());
    }

    public void stopRunning() {
        this.runningFlag = false;
    }

    /**
     * 处理单步操作
     * @param operation
     * @return
     */
    private String processOperation(OperationStep operation) {
        if (!runningFlag) {
            return  "回放终止";
        }

        if (operation == null) {
            return "操作为空";
        }

        final OperationMethod method = operation.getOperationMethod();
        if (method == null || method.getActionEnum() == null) {
            exceptionStep = operation;
            return "方法为空";
        }

        // 这两个操作返回出来，说明出现问题
        if (method.getActionEnum() == PerformActionEnum.BREAK ||
                method.getActionEnum() == PerformActionEnum.CONTINUE) {
            return "逻辑控制异常";
        }

        ReplayStepInfoBean stepInfoBean = new ReplayStepInfoBean();

        final CountDownLatch runningFlag = new CountDownLatch(1);
        final long startTime = System.currentTimeMillis();
        OperationContext.OperationListener listener = new OperationContext.OperationListener() {
            @Override
            public void notifyOperationFinish() {
                LogUtil.d(TAG, "当前操作【%s】执行完毕，执行耗时: %dms", method.getActionEnum().getDesc(), System.currentTimeMillis() - startTime);
                runningFlag.countDown();
            }
        };

        // 对于需要操作节点的记录
        if (operation.getOperationNode() != null) {
            if (operation.getOperationMethod().getActionEnum() != PerformActionEnum.CLICK_QUICK) {
                watcher.sleepUntilContentDontChange();
            } else {
                // 快速点击模式下，需要尽快进行点击，sleep 500ms够了
                MiscUtil.sleep(500);
            }
            List<String> prepareActions = new ArrayList<>();

            AbstractNodeTree node = null;
            if (operation.getOperationMethod().getActionEnum() == PerformActionEnum.CLICK_IF_EXISTS) {
                node = OperationUtil.findAbstractNodeWithoutScroll(operation.getOperationNode(), operationService, prepareActions);

                if (node == null) {
                    LogUtil.d(TAG, "未查找到节点【%s】，不进行操作", operation.getOperationNode());
                    return null;
                }
            } else if (operation.getOperationMethod().getActionEnum() == PerformActionEnum.CHECK_NODE) {
                node = OperationUtil.findAbstractNodeWithoutScroll(operation.getOperationNode(), operationService, prepareActions);

                if (node == null) {
                    LogUtil.i(TAG, "未查找到节点【%s】，不进行操作", operation.getOperationNode());
                    return "节点未查找到";
                }
            } else if (operation.getOperationMethod().getActionEnum() == PerformActionEnum.SLEEP_UNTIL) {
                // 获取最长sleep时间
                String sleepCount = operation.getOperationMethod().getParam(OperationExecutor.INPUT_TEXT_KEY);
                try {
                    long time = Long.parseLong(sleepCount);

                    long start = System.currentTimeMillis();
                    while ((System.currentTimeMillis() - start) < time) {
                        node = OperationUtil.scrollToScreen(operation.getOperationNode(), operationService);

                        // 如果找到了，直接break
                        if (node != null) {
                            break;
                        }

                        operationService.invalidRoot();
                        // 等500ms
                        MiscUtil.sleep(500);
                    }

                    // 没找到
                    if (node == null) {
                        LogUtil.w(TAG, "未查找到节点【%s】", operation.getOperationNode());
                        return "节点未查找到";
                    }
                } catch (NumberFormatException e) {
                    LogUtil.e(TAG, "无法解析时间%s", sleepCount);
                    return "参数错误";
                }
            } else {
                node = OperationUtil.findAbstractNode(operation.getOperationNode(), operationService, prepareActions);
                if (node == null) {
                    LogUtil.w(TAG, "未查找到节点【%s】，无法进行操作", operation.getOperationNode());
                    return "节点未查找到";
                }
            }

            stepInfoBean.setPrepareActionList(prepareActions);

            // 非一机多控回放时截图对比
            // CaptureTree自己会保留截图信息
            if (!(node instanceof CaptureTree) && node.getNodeBound() != null && captureService != null) {
                File captureFile = new File(FileUtils.getSubDir("tmp"), "running.jpg");
                DisplayMetrics metrics = new DisplayMetrics();
                windowManager.getDefaultDisplay().getRealMetrics(metrics);

                int minEdge = Math.min(metrics.widthPixels, metrics.heightPixels);
                float radio = SPService.getInt(SPService.KEY_SCREENSHOT_RESOLUTION, 720) / (float) minEdge;

                // 无法放大
                if (radio > 1) {
                    radio = 1;
                }

                Bitmap capture = captureService.captureScreen(captureFile, metrics.widthPixels, metrics.heightPixels,
                        (int) (radio * metrics.widthPixels), (int) (radio * metrics.heightPixels));

                // 成功截图
                if (capture != null) {
                    Rect displayRect = node.getNodeBound();
                    Rect scaledRect = RectUtil.safetyScale(displayRect, radio, capture.getWidth(),
                            capture.getHeight());

                    Bitmap crop = Bitmap.createBitmap(capture, scaledRect.left,
                           scaledRect.top, scaledRect.width(),
                            scaledRect.height());

                    String content = BitmapUtil.bitmapToBase64(crop);
                    node.setCapture(content);

                    // 回收图片
                    crop.recycle();
                    capture.recycle();
                }

                // 删除文件
                captureFile.delete();
            }

            // 如果需要高亮
            if (SPService.getBoolean(SPService.KEY_HIGHLIGHT_REPLAY_NODE, true)) {
                // 高亮下
                highLightAndRemove(node, operation.getOperationMethod());
            }

            // 执行操作
            boolean result = operationService.doSomeAction(operation.getOperationMethod(), node, listener);
            if (!result) {
                return "执行失败";
            }

            OperationNode opNode = OperationStepProvider.exportNodeToOperationNode(node);

            // 等待操作结束
            try {
                runningFlag.await(600 * 100, TimeUnit.MILLISECONDS);
            } catch (InterruptedException e) {
                LogUtil.e(TAG, "Catch java.lang.InterruptedException: " + e.getMessage(), e);
            }

            // 输入操作会较耗时，需要等待下
            if (method.getActionEnum() == PerformActionEnum.INPUT || method.getActionEnum() == PerformActionEnum.INPUT_SEARCH) {
                MiscUtil.sleep(3000);
                watcher.sleepUntilContentDontChange();
            }

            stepInfoBean.setFindNode(opNode);

            provider.onStepInfo(stepInfoBean);
        } else {
            // 前一次操作时间有记录，需要Sleep这段时间
            watcher.sleepUntilContentDontChange();

            // 对于全局操作，直接执行
            boolean result = operationService.doSomeAction(method, null, listener);
            if (!result) {
                return "执行失败";
            }

            // 成功执行，需要等待
            // 等待操作结束
            try {
                runningFlag.await(600 * 100, TimeUnit.MILLISECONDS);
            } catch (InterruptedException e) {
                LogUtil.e(TAG, "Catch java.lang.InterruptedException: " + e.getMessage(), e);
            }
        }
        LogUtil.d(TAG, "操作执行完毕");
        return null;
    }

    /**
     * 更新悬浮窗图标
     * @param res
     */
    public void updateFloatIcon(final int res) {
        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                binder.updateFloatIcon(res);
            }
        });
    }

    /**
     * 高亮操作节点后隐藏
     * @param nodeTree
     * @param method
     */
    private void highLightAndRemove(AbstractNodeTree nodeTree, OperationMethod method) {
        Point p = null;
        Rect rect = nodeTree.getNodeBound();
        if (method != null) {
            String clickPos = method.getParam(OperationExecutor.LOCAL_CLICK_POS_KEY);
            if (!StringUtil.isEmpty(clickPos)) {
                String[] origin = clickPos.split(",");

                // 计算特定坐标
                if (origin.length == 2) {
                    try {
                        float factorX = Float.parseFloat(origin[0]);
                        float factorY = Float.parseFloat(origin[1]);
                        int x = (int) (rect.left + factorX * rect.width());
                        int y = (int) (rect.top + factorY * rect.height());
                        p = new Point(x, y);
                    } catch (Exception e) {
                        LogUtil.e(TAG, "Can't load position");
                    }
                }
            }
        }

        highLightService.highLight(rect, p);
        MiscUtil.sleep(500);
        highLightService.removeHightLightSync();
    }

    @Subscriber(@Param(SubscribeParamEnum.APP))
    public void setApp(String app) {
        this.app = app;
    }



    @Subscriber(value = @Param(type = UIOperationMessage.class, sticky = false), thread = RunningThread.MAIN_THREAD)
    public void receiveDeviceInfoMessage(UIOperationMessage message) {
        if (message.eventType == UIOperationMessage.TYPE_DEVICE_INFO) {
            DeviceInfo info = DeviceInfoUtil.generateDeviceInfo();
            showDialog("设备信息", info.toString(), binder.loadServiceContext(), 0);
        } else if (message.eventType == UIOperationMessage.TYPE_DIALOG) {
            String info = message.getParam("msg");
            String title = message.getParam("title");
            showDialog(title, info, binder.loadServiceContext(), 0);
        } else if (message.eventType == UIOperationMessage.TYPE_COUNT_DOWN) {
            long timeMillis = message.getParam("time");
            showDialog("SLEEP", "等待" + timeMillis + "ms", binder.loadServiceContext(), timeMillis);
        } else if (message.eventType == UIOperationMessage.TYPE_DISMISS) {
            // 隐藏掉原来的Dialog
            if (dialogRef != null && dialogRef.get() != null && dialogRef.get().isShowing()) {
                dialogRef.get().dismiss();
            }
        }
    }

    private WeakReference<AlertDialog> dialogRef;

    /**
     * 显示设备悬浮窗
     * @param deviceInfo
     * @param context
     */
    public void showDialog(String title, String deviceInfo, Context context, long timeOut) {
        if (TextUtils.isEmpty(deviceInfo)) {
            return;
        }

        try {
            // 隐藏掉原来的Dialog
            if (dialogRef != null && dialogRef.get() != null && dialogRef.get().isShowing()) {
                dialogRef.get().dismiss();
            }

            View v = LayoutInflater.from(ContextUtil.getContextThemeWrapper(context, R.style.AppDialogTheme)).inflate(R.layout.device_info_view, null);
            TextView info = (TextView) v.findViewById(R.id.device_info);
            info.setText(deviceInfo);

            if (deviceInfo.length() < 30) {
                info.setTextSize(18);
                if (Build.VERSION.SDK_INT >= 23) {
                    info.setTextColor(context.getColor(R.color.colorAccent));
                } else {
                    info.setTextColor(context.getResources().getColor(R.color.colorAccent));
                }
            }

            final AlertDialog dialog = new AlertDialog.Builder(context, R.style.AppDialogTheme)
                    .setTitle(title)
                    .setView(v)
                    .setPositiveButton("确定", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            dialog.dismiss();
                        }
                    }).create();
            dialog.getWindow().setType(WindowManager.LayoutParams.TYPE_SYSTEM_ALERT);
            dialog.setCanceledOnTouchOutside(false);
            dialog.setCancelable(false);
            dialog.show();
            dialogRef = new WeakReference<>(dialog);

            dialog.getWindow().setLayout(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT);

            // 提前500ms隐藏下
            if (timeOut > 0) {
                long count = timeOut > 500? timeOut - 500: timeOut;

                LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        dialog.dismiss();
                    }
                }, count);
            }
        } catch (Exception e) {
            LogUtil.e(TAG, "显示设备信息异常", e);
        }
    }

    private static class ReplayConnection implements ServiceConnection {
        private WeakReference<CaseReplayManager> managerRef;

        ReplayConnection(CaseReplayManager manager) {
            managerRef = new WeakReference<>(manager);
        }

        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            final FloatWinService.FloatBinder binder = (FloatWinService.FloatBinder) service;
            final CaseReplayManager manager = managerRef.get();

            manager.binder = binder;
            View v = manager.provider.provideView(binder.loadServiceContext());
            if (v != null) {
                binder.provideDisplayView(v, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            } else {
                binder.provideDisplayView(null, null);
            }

            binder.provideExpendView(null, null);

            binder.registerRunClickListener(manager.listener);
            binder.registerFloatClickListener(manager.floatListener);
            binder.registerStopClickListener(new FloatWinService.OnStopListener() {
                @Override
                public boolean onStopClick() {
                    manager.runningFlag = false;
                    LauncherApplication.getInstance().stopServiceByName(CaseReplayManager.class.getName());
                    return true;
                }
            });
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
        }
    }

    public interface OnFinishListener {
        void onFinish(List<ReplayResultBean> resultBeans, Context context);
    }
}
