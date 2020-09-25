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

import android.app.ProgressDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageInfo;
import android.graphics.Bitmap;
import android.graphics.Point;
import android.graphics.Rect;
import android.os.Build;
import android.os.Environment;
import android.os.IBinder;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.util.Pair;
import android.view.LayoutInflater;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.R;
import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.activity.NewRecordActivity;
import com.alipay.hulu.activity.QRScanActivity;
import com.alipay.hulu.bean.AdvanceCaseSetting;
import com.alipay.hulu.bean.CaseParamBean;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.bean.DeviceInfo;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.RunningThread;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.injector.provider.Provider;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.service.ScreenCaptureService;
import com.alipay.hulu.common.service.TouchService;
import com.alipay.hulu.common.service.base.ExportService;
import com.alipay.hulu.common.service.base.LocalService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.DeviceInfoUtil;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.event.HandlePermissionEvent;
import com.alipay.hulu.event.ScanSuccessEvent;
import com.alipay.hulu.shared.event.EventService;
import com.alipay.hulu.shared.event.accessibility.AccessibilityServiceImpl;
import com.alipay.hulu.shared.event.bean.UniversalEventBean;
import com.alipay.hulu.shared.event.constant.Constant;
import com.alipay.hulu.shared.io.OperationStepService;
import com.alipay.hulu.shared.io.bean.OperationStepMessage;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.node.AbstractNodeProcessor;
import com.alipay.hulu.shared.node.OperationService;
import com.alipay.hulu.shared.node.action.OperationContext;
import com.alipay.hulu.shared.node.action.OperationExecutor;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.action.UIOperationMessage;
import com.alipay.hulu.shared.node.action.provider.ActionProviderManager;
import com.alipay.hulu.shared.node.locater.PositionLocator;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.accessibility.AccessibilityNodeProcessor;
import com.alipay.hulu.shared.node.tree.accessibility.AccessibilityProvider;
import com.alipay.hulu.shared.node.tree.capture.CaptureTree;
import com.alipay.hulu.shared.node.tree.export.OperationStepExporter;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;
import com.alipay.hulu.shared.node.utils.BitmapUtil;
import com.alipay.hulu.shared.node.utils.PrepareUtil;
import com.alipay.hulu.shared.node.utils.RectUtil;
import com.alipay.hulu.shared.scan.ScanCodeType;
import com.alipay.hulu.tools.HighLightService;
import com.alipay.hulu.ui.TwoLevelSelectLayout;
import com.alipay.hulu.util.DialogUtils;
import com.alipay.hulu.util.FunctionSelectUtil;
import com.theartofdev.edmodo.cropper.CropImageView;

import java.io.File;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import androidx.appcompat.app.AlertDialog;

import static android.accessibilityservice.AccessibilityService.GESTURE_SWIPE_UP;
import static com.alipay.hulu.shared.event.constant.Constant.KEY_TOUCH_POINT;

/**
 * 操作录制服务
 *
 * @author cc
 */
@LocalService
@Provider({@Param(value = com.alipay.hulu.shared.event.constant.Constant.EVENT_ACCESSIBILITY_MODE, type = Integer.class)})
public class CaseRecordManager implements ExportService {

    private static final String TAG = "CaseRecordManager";

    private Pair<Float, Float> localClickPos = null;

    protected HighLightService highLightService;
    protected String currentRecordId;
    protected AtomicInteger operationIdx = new AtomicInteger(1);
    protected boolean isRecording = false;

    private volatile boolean touchBlockMode = false;

    protected ScheduledExecutorService cmdExecutor;

    // 操作日志输出Handler
    protected OperationStepService operationStepService;

    protected volatile boolean displayDialog = false;

    /**
     * 暂停
     */
    protected volatile boolean pauseFlag = false;

    protected volatile boolean nodeLoading = false;

    protected volatile boolean isExecuting = false;

    protected volatile boolean forceStopBlocking = false;

    protected InjectorService injectorService;

    protected OperationService operationService;

    protected EventService eventService;

    protected OperationStepExporter stepProvider;

    private WindowManager windowManager;

    private String app;

    protected RecordCaseInfo caseInfo;

    protected static boolean isOverrideInstall = false;

    // 与悬浮窗连接
    private RecordFloatConnection connection;
    protected FloatWinService.FloatBinder binder;
    private FloatClickListener listener;
    private FloatStopListener stopListener;

    /**
     * 录制前的输入法
     */
    protected String defaultIme;

    // 截图服务
    private ScreenCaptureService captureService;

    private static FloatWinService.OnFloatListener DEFAULT_FLOAT_LISTENER = new FloatWinService.OnFloatListener() {
        @Override
        public void onFloatClick(boolean hide) {
        }
    };

    /**
     * 一机多控模式
     */

    /**
     * 未连接数量
     */
    private TextView ipUnadd;

    /**
     * 已连接数量
     */
    private TextView ipAdded;

    public void onCreate(Context context) {
        LogUtil.i(TAG, "onCreate");

        LauncherApplication application = LauncherApplication.getInstance();

        eventService = application.findServiceByName(EventService.class.getName());
        operationService = application.findServiceByName(OperationService.class.getName());
        injectorService = application.findServiceByName(InjectorService.class.getName());
        highLightService = application.findServiceByName(HighLightService.class.getName());
        operationStepService = application.findServiceByName(OperationStepService.class.getName());

        injectorService.register(this);

        // 启动CmdHandler
        cmdExecutor = Executors.newSingleThreadScheduledExecutor();

        windowManager = (WindowManager) LauncherApplication.getInstance().getSystemService(Context.WINDOW_SERVICE);

        // 获取截图服务
        captureService = application.findServiceByName(ScreenCaptureService.class.getName());

        PermissionUtil.grantHighPrivilegePermission(LauncherApplication.getContext());

        currentRecordId = StringUtil.generateRandomString(10);
        setServiceToNormalMode();

        // 启动悬浮窗
        connection = new RecordFloatConnection(this);
        listener = new FloatClickListener(this);
        stopListener = new FloatStopListener();

        context.getApplicationContext().bindService(new Intent(context.getApplicationContext(), FloatWinService.class), connection, Context.BIND_AUTO_CREATE);

        // 开始扩展功能处理
        operationService.startExtraActionHandle();
    }


    @Subscriber(value = @Param(sticky = false), thread = RunningThread.MAIN_THREAD)
    public void onScanEvent(final ScanSuccessEvent event) {
        switch (event.getType()) {
            case ScanSuccessEvent.SCAN_TYPE_SCHEME:
                processAction(new OperationMethod(PerformActionEnum.RESUME), null, binder.loadServiceContext());

                // 向handler发送请求
                OperationMethod method = new OperationMethod(PerformActionEnum.JUMP_TO_PAGE);
                method.putParam(OperationExecutor.SCHEME_KEY, event.getContent());

                // 录制模式需要记录下
                operationAndRecord(method, null);
                break;
            case ScanSuccessEvent.SCAN_TYPE_QR_CODE:
            case ScanSuccessEvent.SCAN_TYPE_BAR_CODE:
                processAction(new OperationMethod(PerformActionEnum.RESUME), null, binder.loadServiceContext());
                // 向handler发送请求
                method = new OperationMethod(event.getType() == ScanSuccessEvent.SCAN_TYPE_QR_CODE?
                        PerformActionEnum.GENERATE_QR_CODE: PerformActionEnum.GENERATE_BAR_CODE);
                method.putParam(OperationExecutor.SCHEME_KEY, event.getContent());
                if (event.getType() == ScanSuccessEvent.SCAN_TYPE_BAR_CODE) {
                    ScanCodeType type = event.getCodeType();
                    if (type != null) {
                        method.putParam(OperationExecutor.GENERATE_CODE_TYPE, type.getCode());
                    }
                }

                // 录制模式需要记录下
                operationAndRecord(method, null);
                break;
            case ScanSuccessEvent.SCAN_TYPE_PARAM:
                processAction(new OperationMethod(PerformActionEnum.RESUME), null, binder.loadServiceContext());
                // 向handler发送请求
                method = new OperationMethod(PerformActionEnum.LOAD_PARAM);
                method.putParam(OperationExecutor.APP_URL_KEY, event.getContent());

                // 录制模式需要记录下
                operationAndRecord(method, null);
                break;
            default:
                break;
        }
    }

    @Subscriber(@Param(value = CmdTools.FATAL_ADB_CANNOT_RECOVER, sticky = false))
    public void notifyAdbClose() {
        // 先暂停，等ADB恢复
        processAction(new OperationMethod(PerformActionEnum.PAUSE), null, binder.loadServiceContext());

        // 防止用户点了恢复阻塞模式，判断下ADB是否还活着
        binder.registerFloatClickListener(new FloatWinService.OnFloatListener() {
            @Override
            public void onFloatClick(boolean hide) {
                BackgroundExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            boolean result = CmdTools.generateConnection();
                            if (!result) {
                                LauncherApplication.getInstance().showToast(StringUtil.getString(R.string.record__adb_hint));
                            } else {
                                setServiceToTouchBlockMode();
                                operationService.invalidRoot();
                                notifyDialogDismiss(1000);
                                binder.registerFloatClickListener(DEFAULT_FLOAT_LISTENER);
                            }
                        } catch (Exception e) {
                            LogUtil.e(TAG, "Throw exception: " + e.getMessage(), e);
                        }
                    }
                });

            }
        });
    }

    /**
     * 设置录制的用例相关信息
     * @param caseInfo
     */
    public void setRecordCase(RecordCaseInfo caseInfo) {
        if (caseInfo == null) {
            return;
        }

        this.caseInfo = caseInfo;

        // 重置RecordId和operationIdx
        currentRecordId = StringUtil.generateRandomString(10);
        operationIdx.set(0);


        String name = caseInfo.getCaseName();
        if (StringUtil.isEmpty(name)) {
            // 使用时间作为默认用例名称
            name = new Date().toString();
            caseInfo.setCaseName(name);
        }

        // 默认使用Accessibility模式
        List<Class<? extends AbstractNodeProcessor>> processors = new ArrayList<>();
        processors.add(AccessibilityNodeProcessor.class);
        operationService.configProcessors(processors);
        operationService.configProvider(AccessibilityProvider.class);
        operationService.initParams();
        AdvanceCaseSetting setting = JSON.parseObject(caseInfo.getAdvanceSettings(), AdvanceCaseSetting.class);
        if (setting != null && setting.getParams() != null) {
            Map<String, String> params = new HashMap<>(setting.getParams().size() + 1);
            for (CaseParamBean caseParam: setting.getParams()) {
                params.put(caseParam.getParamName(), caseParam.getParamDefaultValue());
            }

            // 设置参数
            operationService.putAllRuntimeParamAtTop(params);
        }
        operationService.putRuntimeParam(com.alipay.hulu.shared.node.action.Constant.KEY_CURRENT_MODE, "record");

        // 查找package信息
        PackageInfo pkgInfo = ContextUtil.getPackageInfoByName(LauncherApplication.getContext()
                , caseInfo.getTargetAppPackage());
        if (pkgInfo == null) {
            return;
        }

        final ProgressDialog progressDialog = DialogUtils.showProgressDialog(ContextUtil.getContextThemeWrapper(LauncherApplication.getContext(), R.style.AppDialogTheme), "准备运行环境中");
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    PrepareUtil.doPrepareWork(app, new PrepareUtil.PrepareStatus() {
                        @Override
                        public void currentStatus(final int progress, final int total, final String message, boolean status) {
                            if (progressDialog != null && progressDialog.isShowing()) {
                                LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                                    @Override
                                    public void run() {
                                        progressDialog.setProgress(progress);
                                        progressDialog.setMax(total);
                                        progressDialog.setMessage(message);
                                    }
                                });
                            }
                        }
                    });
                } finally {
                    if (progressDialog != null && progressDialog.isShowing()) {
                        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                progressDialog.dismiss();
                            }
                        });
                    }
                }

            }
        });
    }

    /**
     * 开始录制
     */
    public void startRecord() {
        isRecording = true;
        displayDialog = true;

        // 先记录下默认输入法
        defaultIme = CmdTools.execHighPrivilegeCmd("settings get secure default_input_method");
        MyApplication.getInstance().updateDefaultIme("com.alipay.hulu/.tools.AdbIME");

        // 初始化
        operationStepService.startRecord(caseInfo);

        TouchService touchService = LauncherApplication.service(TouchService.class);
        if (touchService != null) {
            touchService.start();
        }

        // 刷新数据导出
        if (stepProvider == null) {
            stepProvider = new OperationStepExporter(currentRecordId);
        } else {
            stepProvider.refresh(currentRecordId);
        }

        eventService.startTrackAccessibilityEvent();
        // 对于支持的设备，开启触摸监控
        if (isSupportedDevice()) {
            eventService.startTrackTouch();
        }

        // 重载下当前界面
        operationService.invalidRoot();

        // 通知进入触摸屏蔽模式
        setServiceToTouchBlockModeNoDelay();

        // 1秒后再监听
        notifyDialogDismiss(1000);

        operationService.invalidRoot();
    }

    /**
     * 进入触摸屏蔽模式
     */
    protected void setServiceToTouchBlockMode() {
        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                setServiceToTouchBlockModeNoDelay();
            }
        }, 500);
    }

    /**
     * 进入触摸屏蔽模式
     */
    protected void setServiceToTouchBlockModeNoDelay() {
        if (pauseFlag) {
            return;
        }
        LogUtil.d(TAG, "进入触摸阻塞模式");
        touchBlockMode = true;
        injectorService.pushMessage(com.alipay.hulu.shared.event.constant.Constant.EVENT_ACCESSIBILITY_MODE, AccessibilityServiceImpl.MODE_BLOCK);
    }

    /**
     * 进入正常模式
     */
    protected void setServiceToNormalMode() {
        touchBlockMode = false;
        LogUtil.d(TAG, "进入正常触摸模式");
        // 200ms后点击
        injectorService.pushMessage(com.alipay.hulu.shared.event.constant.Constant.EVENT_ACCESSIBILITY_MODE, AccessibilityServiceImpl.MODE_NORMAL, 200);
    }

    private UniversalEventBean touchPos;

    @Subscriber(value = @Param(Constant.EVENT_TOUCH_POSITION), thread = RunningThread.BACKGROUND)
    public void receiveTouchPos(UniversalEventBean eventBean) {
        this.touchPos = eventBean;
    }

    @Subscriber(value = @Param(Constant.EVENT_TOUCH_UP), thread = RunningThread.BACKGROUND)
    public void receiveTouchUp(UniversalEventBean event) {
        if (touchPos != null) {
            receiveTouchPosition(touchPos);
            touchPos = null;
        }
    }

    public void receiveTouchPosition(UniversalEventBean eventBean) {
        Point point = eventBean.getParam(KEY_TOUCH_POINT);
        if (point == null) {
            LogUtil.w(TAG, "收到空触摸消息【%s】", eventBean);
            return;
        }

        // 非触摸阻塞模式
        if (!touchBlockMode) {
            LogUtil.d(TAG, "当前非阻塞模式");
            return;
        }

        LogUtil.d(TAG, "Receive Touch at time " + eventBean.getTime());

        int x = point.x;
        int y = point.y;

        // 只针对显示dialog的情况
        if (displayDialog || pauseFlag || nodeLoading || isExecuting || !isRecording) {
            return;
        }

        LogUtil.i(TAG, "Start notify Touch Event at (%d, %d)", x, y);

        // 看下是否点到SoloPi图标
        if (binder.checkInFloat(point)) {
            LogUtil.i(TAG, "点到了SoloPi");
            showFunctionView(null);
            return;
        }

        nodeLoading = true;
        try {
            AbstractNodeTree root = operationService.getCurrentRoot();

            AbstractNodeTree node = PositionLocator.findDeepestNode(root, x, y);
            LogUtil.i(TAG, "目标节点：%s", node);

            // 节点没拿到
            if (node == null) {
                LogUtil.e(TAG, "Get node at (" + x + ", " + y + ") null");
                return;
            }

            Rect bound = node.getNodeBound();
            float xFactor = (x - bound.left) / (float) bound.width();
            float yFactor = (y - bound.top) / (float) bound.height();

            localClickPos = new Pair<>(xFactor, yFactor);
            showFunctionView(node);
        } finally {
            nodeLoading = false;
        }
    }

    /**
     * 操作并记录
     *
     * @param method
     * @param target
     */
    protected boolean operationAndRecord(OperationMethod method, AbstractNodeTree target) {
        OperationStep step = doAndRecordAction(method, target);

        if (step == null) {
            PerformActionEnum action = method.getActionEnum();
            String desc;
            if (action == PerformActionEnum.OTHER_GLOBAL || action == PerformActionEnum.OTHER_NODE) {
                desc = method.getParam(ActionProviderManager.KEY_TARGET_ACTION_DESC);

                // 两次降级
                if (StringUtil.isEmpty(desc)) {
                    desc = method.getParam(ActionProviderManager.KEY_TARGET_ACTION);
                }
                if (StringUtil.isEmpty(desc)) {
                    desc = action.getDesc();
                }
            } else {
                desc = action.getDesc();
            }

            LauncherApplication.getInstance().showToast(binder.loadServiceContext(), StringUtil.getString(R.string.record__execute_fail, desc));
            return false;
        }

        OperationStepMessage message = new OperationStepMessage();
        message.setStepIdx(step.getOperationIndex());
        message.setGeneralOperationStep(step);
        injectorService.pushMessage(OperationStepService.NOTIFY_OPERATION_STEP, message, true);
        return true;
    }

    /**
     * 执行操作
     * @param method
     * @param target
     * @return
     */
    protected OperationStep doAndRecordAction(OperationMethod method, AbstractNodeTree target) {
        isExecuting = true;
        updateFloatIcon(R.drawable.solopi_running);

        // 如果是控件操作，需要记录操作控件信息
        if (target != null && !(target instanceof CaptureTree) && captureService != null && target.getCapture() == null) {
            DisplayMetrics metrics = new DisplayMetrics();
            windowManager.getDefaultDisplay().getRealMetrics(metrics);

            File captureImg = new File(FileUtils.getSubDir("tmp"), "running.jpg");
            int minEdge = Math.min(metrics.widthPixels, metrics.heightPixels);

            // 截成720P
            float radio = SPService.getInt(SPService.KEY_SCREENSHOT_RESOLUTION, 720) / (float) minEdge;
            if (radio > 1) {
                radio = 1;
            }

            Bitmap capture = captureService.captureScreen(captureImg, metrics.widthPixels, metrics.heightPixels,
                    (int) (radio * metrics.widthPixels), (int) (radio * metrics.heightPixels));

            // 成功截图的话
            if (capture != null) {
                // 截取区域
                Rect rect = target.getNodeBound();
                // 多截取一些区域，防止查找时缺乏信息
                Rect scaledRect = RectUtil.safetyExpend(RectUtil.safetyScale(rect, radio, capture.getWidth(),
                        capture.getHeight()), 10, capture.getWidth(), capture.getHeight());

                Bitmap crop = Bitmap.createBitmap(capture, scaledRect.left,
                        scaledRect.top, scaledRect.width(),
                        scaledRect.height());

                // 保存截图信息
                target.setCapture(BitmapUtil.bitmapToBase64(crop));

                // 回收
                crop.recycle();
                capture.recycle();
            }

            // 删除图片
            captureImg.delete();
        }

        OperationStep step = null;
        try {
            step = operationService.doAndRecordAction(method, target, stepProvider, new OperationContext.OperationListener() {
                @Override
                public void notifyOperationFinish() {
                    isExecuting = false;
                    if (!forceStopBlocking) {
                        setServiceToTouchBlockMode();
                        notifyDialogDismiss(100);
                    }
                    updateFloatIcon(R.drawable.solopi_float);
                }
            });
        } catch (Exception e) {
            LogUtil.e(TAG, "doRecord action throw : " + e.getMessage(), e);
            isExecuting = false;
            if (!forceStopBlocking) {
                setServiceToTouchBlockMode();
                notifyDialogDismiss(100);
            }
            updateFloatIcon(R.drawable.solopi_float);
        }

        if (step == null) {
            isExecuting = false;
            updateFloatIcon(R.drawable.solopi_float);
        }

        return step;
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

    protected static final List<Integer> NODE_KEYS = new ArrayList<>();

    protected static final List<Integer> NODE_ICONS = new ArrayList<>();

    protected static final Map<Integer, List<TwoLevelSelectLayout.SubMenuItem>> NODE_ACTION_MAP = new HashMap<>();


    protected static final List<Integer> GLOBAL_KEYS = new ArrayList<>();

    protected static final List<Integer> GLOBAL_ICONS = new ArrayList<>();

    protected static final Map<Integer, List<TwoLevelSelectLayout.SubMenuItem>> GLOBAL_ACTION_MAP = new HashMap<>();

    // 初始化二级菜单
    static {
        // 节点操作
        NODE_KEYS.add(R.string.function_group__click);
        NODE_ICONS.add(R.drawable.dialog_action_drawable_quick_click_2);
        List<TwoLevelSelectLayout.SubMenuItem> clickActions = new ArrayList<>();
        clickActions.add(convertPerformActionToSubMenu(PerformActionEnum.CLICK));
        clickActions.add(convertPerformActionToSubMenu(PerformActionEnum.LONG_CLICK));
        clickActions.add(convertPerformActionToSubMenu(PerformActionEnum.CLICK_IF_EXISTS));
        clickActions.add(convertPerformActionToSubMenu(PerformActionEnum.CLICK_QUICK));
        clickActions.add(convertPerformActionToSubMenu(PerformActionEnum.MULTI_CLICK));
        NODE_ACTION_MAP.put(R.string.function_group__click, clickActions);

        NODE_KEYS.add(R.string.function_group__input);
        NODE_ICONS.add(R.drawable.dialog_action_drawable_input);
        List<TwoLevelSelectLayout.SubMenuItem> inputActions = new ArrayList<>();
        inputActions.add(convertPerformActionToSubMenu(PerformActionEnum.INPUT));
        inputActions.add(convertPerformActionToSubMenu(PerformActionEnum.INPUT_SEARCH));
        NODE_ACTION_MAP.put(R.string.function_group__input, inputActions);

        NODE_KEYS.add(R.string.function_group__scroll);
        NODE_ICONS.add(R.drawable.dialog_action_drawable_scroll);
        List<TwoLevelSelectLayout.SubMenuItem> scrollActions = new ArrayList<>();
        scrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.SCROLL_TO_BOTTOM));
        scrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.SCROLL_TO_TOP));
        scrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.SCROLL_TO_LEFT));
        scrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.SCROLL_TO_RIGHT));
        scrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.GESTURE));
        NODE_ACTION_MAP.put(R.string.function_group__scroll, scrollActions);

        NODE_KEYS.add(R.string.function_group__assert);
        NODE_ICONS.add(R.drawable.dialog_action_drawable_assert);
        List<TwoLevelSelectLayout.SubMenuItem> assertActions = new ArrayList<>();
        assertActions.add(convertPerformActionToSubMenu(PerformActionEnum.ASSERT));
        assertActions.add(convertPerformActionToSubMenu(PerformActionEnum.SLEEP_UNTIL));
        assertActions.add(convertPerformActionToSubMenu(PerformActionEnum.LET_NODE));
        assertActions.add(convertPerformActionToSubMenu(PerformActionEnum.CHECK_NODE));
        NODE_ACTION_MAP.put(R.string.function_group__assert, assertActions);

        NODE_KEYS.add(R.string.function_group__extra);
        NODE_ICONS.add(R.drawable.dialog_action_drawable_extra);


        // 全局操作
        GLOBAL_KEYS.add(R.string.function_group__device);
        GLOBAL_ICONS.add(R.drawable.dialog_action_drawable_device_operation);
        List<TwoLevelSelectLayout.SubMenuItem> gDeviceActions = new ArrayList<>();
        gDeviceActions.add(convertPerformActionToSubMenu(PerformActionEnum.BACK));
        gDeviceActions.add(convertPerformActionToSubMenu(PerformActionEnum.HOME));
        gDeviceActions.add(convertPerformActionToSubMenu(PerformActionEnum.HANDLE_ALERT));
        gDeviceActions.add(convertPerformActionToSubMenu(PerformActionEnum.SCREENSHOT));
        gDeviceActions.add(convertPerformActionToSubMenu(PerformActionEnum.SLEEP));
        gDeviceActions.add(convertPerformActionToSubMenu(PerformActionEnum.EXECUTE_SHELL));
        gDeviceActions.add(convertPerformActionToSubMenu(PerformActionEnum.NOTIFICATION));
        gDeviceActions.add(convertPerformActionToSubMenu(PerformActionEnum.RECENT_TASK));
        GLOBAL_ACTION_MAP.put(R.string.function_group__device, gDeviceActions);

        GLOBAL_KEYS.add(R.string.function_group__app);
        GLOBAL_ICONS.add(R.drawable.dialog_action_drawable_app_operation);
        List<TwoLevelSelectLayout.SubMenuItem> gAppActions = new ArrayList<>();
        gAppActions.add(convertPerformActionToSubMenu(PerformActionEnum.GOTO_INDEX));
        gAppActions.add(convertPerformActionToSubMenu(PerformActionEnum.CHANGE_MODE));
        gAppActions.add(convertPerformActionToSubMenu(PerformActionEnum.JUMP_TO_PAGE));
        gAppActions.add(convertPerformActionToSubMenu(PerformActionEnum.GENERATE_QR_CODE));
        gAppActions.add(convertPerformActionToSubMenu(PerformActionEnum.GENERATE_BAR_CODE));
        gAppActions.add(convertPerformActionToSubMenu(PerformActionEnum.KILL_PROCESS));
        gAppActions.add(convertPerformActionToSubMenu(PerformActionEnum.CLEAR_DATA));
        gAppActions.add(convertPerformActionToSubMenu(PerformActionEnum.ASSERT_TOAST));
        gAppActions.add(convertPerformActionToSubMenu(PerformActionEnum.RELOAD));
        GLOBAL_ACTION_MAP.put(R.string.function_group__app, gAppActions);

        GLOBAL_KEYS.add(R.string.function_group__scroll);
        GLOBAL_ICONS.add(R.drawable.dialog_action_drawable_scroll);
        List<TwoLevelSelectLayout.SubMenuItem> gScrollActions = new ArrayList<>();
        gScrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.GLOBAL_SCROLL_TO_BOTTOM));
        gScrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.GLOBAL_SCROLL_TO_TOP));
        gScrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.GLOBAL_SCROLL_TO_LEFT));
        gScrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.GLOBAL_SCROLL_TO_RIGHT));
        gScrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.GLOBAL_PINCH_OUT));
        gScrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.GLOBAL_PINCH_IN));
        gScrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.GLOBAL_GESTURE));
        GLOBAL_ACTION_MAP.put(R.string.function_group__scroll, gScrollActions);

        GLOBAL_KEYS.add(R.string.function_group__info);
        GLOBAL_ICONS.add(R.drawable.dialog_action_drawable_device_info);
        List<TwoLevelSelectLayout.SubMenuItem> gInfoActions = new ArrayList<>();
        gInfoActions.add(convertPerformActionToSubMenu(PerformActionEnum.DEVICE_INFO));
        gInfoActions.add(convertPerformActionToSubMenu(PerformActionEnum.LOAD_PARAM));
        GLOBAL_ACTION_MAP.put(R.string.function_group__info, gInfoActions);

        GLOBAL_KEYS.add(R.string.function_group__extra);
        GLOBAL_ICONS.add(R.drawable.dialog_action_drawable_extra);

        GLOBAL_KEYS.add(R.string.function_group__logic);
        GLOBAL_ICONS.add(R.drawable.dialog_action_drawable_logic);
        List<TwoLevelSelectLayout.SubMenuItem> gLoopActions = new ArrayList<>();
        gLoopActions.add(convertPerformActionToSubMenu(PerformActionEnum.LET));
        gLoopActions.add(convertPerformActionToSubMenu(PerformActionEnum.CHECK));
        gLoopActions.add(convertPerformActionToSubMenu(PerformActionEnum.LOAD_PARAM));
        GLOBAL_ACTION_MAP.put(R.string.function_group__logic, gLoopActions);

        GLOBAL_KEYS.add(R.string.function_group__control);
        GLOBAL_ICONS.add(R.drawable.dialog_action_drawable_finish);
        List<TwoLevelSelectLayout.SubMenuItem> gControlActions = new ArrayList<>();
        gControlActions.add(convertPerformActionToSubMenu(PerformActionEnum.FINISH));
        gControlActions.add(convertPerformActionToSubMenu(PerformActionEnum.PAUSE));
        GLOBAL_ACTION_MAP.put(R.string.function_group__control, gControlActions);
    }

    /**
     * 展示操作界面
     *
     * @param node
     */
    private synchronized void showFunctionView(final AbstractNodeTree node) {
        if (displayDialog || pauseFlag) {
            return;
        }

        // 没有操作
        displayDialog = true;
        final List<Integer> keys;
        final List<Integer> icons;
        final Map<Integer, List<TwoLevelSelectLayout.SubMenuItem>> secondLevel = new HashMap<>();
        if (node != null) {
            Pair<Float, Float> pos = localClickPos;

            // 截图树特殊处理下
            if (node instanceof CaptureTree) {
                final CaptureTree captureTree = (CaptureTree) node;

                // 如果已经被设置过区域
                if (!captureTree.isResized()) {
                    final Bitmap screenshot = captureTree.getOriginScreen();
                    int centerX = (int) (pos.first * captureTree.getScaleWidth());
                    int centerY = (int) (pos.second * captureTree.getScaleHeight());
                    int radio = captureTree.getScaleWidth() / 10;
                    final Rect defaultBound = new Rect(centerX - radio, centerY - radio, centerX + radio, centerY + radio);
                    LogUtil.w(TAG, "Capture: " + captureTree + " " + defaultBound);

                    setServiceToNormalMode();
                    LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            LinearLayout root = (LinearLayout) LayoutInflater.from(binder.loadServiceContext()).inflate(R.layout.dialog_action_crop_image, null);

                            final CropImageView crop = (CropImageView) root.findViewById(R.id.dialog_action_crop_view);

                            crop.setImageBitmap(screenshot);
                            crop.setCropRect(defaultBound);

                            root.setMinimumHeight(20);

                            DialogUtils.showCustomView(binder.loadServiceContext(), root, StringUtil.getString(R.string.constant__confirm), new Runnable() {
                                @Override
                                public void run() {
                                    Rect scaledRect = crop.getCropRect();
                                    Rect origin = captureTree.fromScaleToOrigin(scaledRect);
                                    captureTree.resizeTo(origin);

                                    // 重置百分比
                                    float originX = localClickPos.first * captureTree.getOriginWidth();
                                    float originY = localClickPos.second * captureTree.getOriginHeigth();
                                    if (origin.contains((int) originX, (int) originY)) {
                                        localClickPos = new Pair<>((originX - origin.left) / origin.width(), (originY - origin.top) / origin.height());
                                    } else {
                                        localClickPos = new Pair<>(0.5F, 0.5F);
                                    }

                                    showFunctionView(captureTree);
                                }
                            }, StringUtil.getString(R.string.constant__cancel), new Runnable() {
                                @Override
                                public void run() {
                                    captureTree.resetBound();

                                    setServiceToTouchBlockMode();
                                    notifyDialogDismiss();
                                }
                            });
                        }
                    });
                    return;
                }
            }

            keys = new ArrayList<>(NODE_KEYS);
            icons = new ArrayList<>(NODE_ICONS);
            secondLevel.putAll(NODE_ACTION_MAP);
            secondLevel.put(R.string.function_group__extra, loadOtherActions(PerformActionEnum.OTHER_NODE, node));

            Rect bound = node.getNodeBound();

            Point p = null;
            if (pos != null) {
                int x = (int) (bound.left + pos.first * bound.width());
                int y = (int) (bound.top + pos.second * bound.height());
                p = new Point(x, y);
            }

            highLightService.highLight(bound, p);
        } else {
            keys = new ArrayList<>(GLOBAL_KEYS);
            icons = new ArrayList<>(GLOBAL_ICONS);
            secondLevel.putAll(GLOBAL_ACTION_MAP);

            // 加入额外操作
            secondLevel.put(R.string.function_group__extra, loadOtherActions(PerformActionEnum.OTHER_GLOBAL, null));
        }

        setServiceToNormalMode();

        final Context context = binder.loadServiceContext();
        if (context == null) {
            notifyDialogDismiss();
            return;
        }

        // 先切换到默认输入法
        CmdTools.switchToIme(defaultIme);
        // 处理方法
        FunctionSelectUtil.showFunctionView(context, node, keys, icons, secondLevel,
                highLightService, operationService, getLocalClickPos(), new FunctionSelectUtil.FunctionListener() {
                    @Override
                    public void onProcessFunction(final OperationMethod method, final AbstractNodeTree node) {
                        LogUtil.d(TAG, "悬浮窗消失");

                        // 切换回SoloPi输入法
                        CmdTools.switchToIme("com.alipay.hulu/.tools.AdbIME");

                        // 等悬浮窗消失了再操作
                        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                // 返回是否处理完毕
                                boolean processResult = processAction(method, node, context);

                                // 进行后续处理
                                if (!processResult) {
                                    setServiceToTouchBlockMode();
                                    notifyDialogDismiss();
                                }
                            }
                        }, 50);
                    }

                    @Override
                    public void onCancel() {
                        // 重设区域
                        if (node instanceof CaptureTree) {
                            ((CaptureTree) node).resetBound();
                        }

                        setServiceToTouchBlockModeNoDelay();
                        notifyDialogDismiss();
                    }
                });
    }

    /**
     * 加载额外功能
     * @param actionEnum
     * @param nodeTree
     * @return
     */
    private List<TwoLevelSelectLayout.SubMenuItem> loadOtherActions(PerformActionEnum actionEnum, AbstractNodeTree nodeTree) {
        Map<String, String> allActions = operationService.getActionProviderMng()
                .loadProvideActions(nodeTree);
        List<TwoLevelSelectLayout.SubMenuItem> output = new ArrayList<>();

        // 组装参数
        for (String key: allActions.keySet()) {
            TwoLevelSelectLayout.SubMenuItem item = new TwoLevelSelectLayout.SubMenuItem(allActions.get(key), actionEnum.getCode());
            item.extra = key;
            output.add(item);
        }

        return output;
    }

    /**
     * 提供悬浮窗体
     * @return
     */
    private void provideDisplayContent(final FloatWinService.FloatBinder binder) {
        binder.provideDisplayView(null, null);
        return;
    }

    /**
     * 回调处理一些操作
     *
     * @param method
     * @param node
     * @param context
     * @return 是否需要恢复阻塞模式
     */
    protected boolean processAction(OperationMethod method, AbstractNodeTree node, final Context context) {
        PerformActionEnum action = method.getActionEnum();
        if (action == PerformActionEnum.FINISH) {

            // 删除临时图片
            File targetDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM);
            targetDir = new File(targetDir, "solopi");
            if (targetDir.exists()) {
                FileUtils.deleteFile(targetDir);
            }

            // 切换回默认输入法
            MyApplication.getInstance().updateDefaultIme(defaultIme);
            CmdTools.switchToIme(defaultIme);

            isRecording = false;
            displayDialog = false;
            isExecuting = false;

            // 初始化运行环境
            operationService.initParams();

            TouchService touchService = LauncherApplication.service(TouchService.class);
            if (touchService != null) {
                touchService.stop();
            }

            boolean processed = operationStepService.stopRecord(context);

            eventService.stopTrackAccessibilityEvent();
            eventService.stopTrackTouch();

            setServiceToNormalMode();

            if (!processed) {
                // 恢复悬浮窗
                binder.restoreFloat();
                Intent intent = new Intent(context, NewRecordActivity.class);
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                intent.putExtra(NewRecordActivity.NEED_REFRESH_PAGE, true);
                context.startActivity(intent);

                LauncherApplication.getInstance().stopServiceByName(CaseRecordManager.class.getName());
            } else {
                LauncherApplication.getInstance().stopServiceByName(CaseRecordManager.class.getName());
            }
            return true;
        } else if (action == PerformActionEnum.PAUSE) {
            setServiceToNormalMode();
            displayDialog = true;
            pauseFlag = true;
            binder.registerFloatClickListener(new FloatWinService.OnFloatListener() {
                @Override
                public void onFloatClick(boolean hide) {
                    pauseFlag = false;
                    setServiceToTouchBlockMode();
                    operationService.invalidRoot();
                    notifyDialogDismiss(1000);
                    binder.registerFloatClickListener(DEFAULT_FLOAT_LISTENER);
                }
            });
            return true;
        } else if (action == PerformActionEnum.RESUME) {
            pauseFlag = false;
            setServiceToTouchBlockMode();
            operationService.invalidRoot();
            notifyDialogDismiss(1000);
            binder.registerFloatClickListener(DEFAULT_FLOAT_LISTENER);
            return true;
        } else if (action == PerformActionEnum.JUMP_TO_PAGE
                || action == PerformActionEnum.GENERATE_QR_CODE
                || action == PerformActionEnum.GENERATE_BAR_CODE
                || action == PerformActionEnum.LOAD_PARAM) {
            if (!StringUtil.equals(method.getParam("scan"), "1")) {
                operationAndRecord(method, node);
            } else {
                if (action == PerformActionEnum.JUMP_TO_PAGE) {
                    Intent intent = new Intent(context, QRScanActivity.class);
                    intent.putExtra(QRScanActivity.KEY_SCAN_TYPE, ScanSuccessEvent.SCAN_TYPE_SCHEME);
                    intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(intent);
                    processAction(new OperationMethod(PerformActionEnum.PAUSE), null, context);
//                    setServiceToTouchBlockMode();
                } else if (action == PerformActionEnum.GENERATE_QR_CODE) {
                    Intent intent = new Intent(context, QRScanActivity.class);
                    intent.putExtra(QRScanActivity.KEY_SCAN_TYPE, ScanSuccessEvent.SCAN_TYPE_QR_CODE);
                    intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(intent);
                    processAction(new OperationMethod(PerformActionEnum.PAUSE), null, context);
//                    setServiceToTouchBlockMode();
                } else if (action == PerformActionEnum.GENERATE_BAR_CODE) {
                    Intent intent = new Intent(context, QRScanActivity.class);
                    intent.putExtra(QRScanActivity.KEY_SCAN_TYPE, ScanSuccessEvent.SCAN_TYPE_BAR_CODE);
                    intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(intent);
                    processAction(new OperationMethod(PerformActionEnum.PAUSE), null, context);
//                    setServiceToTouchBlockMode();
                } else if (action == PerformActionEnum.LOAD_PARAM) {
                    Intent intent = new Intent(context, QRScanActivity.class);
                    intent.putExtra(QRScanActivity.KEY_SCAN_TYPE, ScanSuccessEvent.SCAN_TYPE_PARAM);
                    intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(intent);
                    processAction(new OperationMethod(PerformActionEnum.PAUSE), null, context);
//                    setServiceToTouchBlockMode();
                }
            }
        } else {
            return operationAndRecord(method, node);
        }
        return false;
    }

    @Subscriber(@Param(value = "FloatClickMethod", sticky = false))
    public void registerFloatClickListener(final Callable<OperationMethod> methodCallable) {
        binder.registerFloatClickListener(new FloatWinService.OnFloatListener() {
            @Override
            public void onFloatClick(boolean hide) {
                try {
                    // 只可执行全局操作
                    OperationMethod method = methodCallable.call();
                    forceStopBlocking = false;
                    if (method != null) {
                        operationAndRecord(method, null);
                    } else {
                        setServiceToTouchBlockMode();
                    }

                    notifyDialogDismiss(1000);
                    binder.registerFloatClickListener(DEFAULT_FLOAT_LISTENER);
                } catch (Exception e) {
                    LogUtil.e(TAG, "Catch java.lang.Exception: " + e.getMessage(), e);
                }
            }
        });

        forceStopBlocking = true;

        // 延迟200ms做
        cmdExecutor.schedule(new Runnable() {
            @Override
            public void run() {
                setServiceToNormalMode();
                displayDialog = true;
            }
        }, 200, TimeUnit.MILLISECONDS);
    }


    /**
     * 检查是否是目前方案兼容的设备（方案指的是监听当前页面的点击位置）
     *
     * @return
     */
    public boolean isSupportedDevice() {
        return true;
    }

    @Subscriber(@Param(com.alipay.hulu.shared.event.constant.Constant.EVENT_ACCESSIBILITY_GESTURE))
    public void onGesture(UniversalEventBean gestureEvent) {
        LogUtil.i(TAG, "System Call Gesture Method: " + gestureEvent);

        Integer gestureId;
        if (gestureEvent != null && (gestureId = gestureEvent.getParam(com.alipay.hulu.shared.event.constant.Constant.KEY_GESTURE_TYPE)) != null) {
            if (gestureId == GESTURE_SWIPE_UP && !displayDialog && !pauseFlag && !nodeLoading) {
                showFunctionView(null);
            }
        }
    }

    public void onDestroy(Context context) {
        LogUtil.i(TAG, "onDestroy");

        if (connection != null) {
            context.unbindService(connection);
            connection = null;
            binder = null;
        }
        listener = null;
        stopListener = null;

        operationService.stopExtraActionHandle();

        injectorService.unregister(this);
    }

    /**
     * Getter method for property <tt>isRecording</tt>.
     *
     * @return property value of isRecording
     */
    public boolean isRecording() {
        return isRecording;
    }

    public Pair<Float, Float> getLocalClickPos() {
        Pair<Float, Float> target = localClickPos;
        localClickPos = null;
        return target;
    }

    @Subscriber(@Param(sticky = false))
    public void onHandlePermissionEvent(HandlePermissionEvent event) {
        OperationMethod method = new OperationMethod(PerformActionEnum.HANDLE_PERMISSION_ALERT);
        operationService.doSomeAction(method, null);
    }


    @Subscriber(value = @Param(type = UIOperationMessage.class, sticky = false), thread = RunningThread.MAIN_THREAD)
    public void receiveDeviceInfoMessage(UIOperationMessage message) {
        if (message.eventType == UIOperationMessage.TYPE_DEVICE_INFO) {
            DeviceInfo info = DeviceInfoUtil.generateDeviceInfo();
            showDialog(StringUtil.getString(R.string.ui__device_info), info.toString(), binder.loadServiceContext(), 0);
        } else if (message.eventType == UIOperationMessage.TYPE_DIALOG) {
            String info = message.getParam("msg");
            String title = message.getParam("title");
            showDialog(title, info, binder.loadServiceContext(), 0);
        } else if (message.eventType == UIOperationMessage.TYPE_COUNT_DOWN) {
            long timeMillis = message.getParam("time");
            showDialog(StringUtil.getString(R.string.ui__sleep), StringUtil.getString(R.string.ui__sleep_time, timeMillis), binder.loadServiceContext(), timeMillis);
        } else if (message.eventType == UIOperationMessage.TYPE_DISMISS) {
            // 如果在显示弹窗，就隐藏下
            if (dialogRef != null && dialogRef.get() != null && dialogRef.get().isShowing()) {
                displayDialog = false;
                forceStopBlocking = false;
                dialogRef.get().dismiss();
            }
        }
    }

    /**
     * 当前显示的弹窗
     */
    private WeakReference<AlertDialog> dialogRef;

    /**
     * 显示设备信息
     * @param deviceInfo
     * @param context
     */
    public void showDialog(String title, String deviceInfo, Context context, long timeout) {
        if (TextUtils.isEmpty(deviceInfo)) {
            return;
        }

        try {
            // 隐藏掉原来的Dialog
            if (dialogRef != null && dialogRef.get() != null && dialogRef.get().isShowing()) {
                dialogRef.get().dismiss();
            }
            displayDialog = true;
            forceStopBlocking = true;

            // 不是超时自动关闭的dialog
            if (timeout <= 0) {
                setServiceToNormalMode();
            }

            View v = LayoutInflater.from(ContextUtil.getContextThemeWrapper(context, R.style.AppDialogTheme)).inflate(R.layout.device_info_view, null);
            TextView info = (TextView) v.findViewById(R.id.device_info);
            info.setText(deviceInfo);

            // 调整文字颜色与大小
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
                    .setPositiveButton(R.string.constant__confirm, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            setServiceToTouchBlockMode();
                            forceStopBlocking = false;
                            dialog.dismiss();
                            notifyDialogDismiss(2000);
                        }
                    }).create();
            dialog.getWindow().setType(com.alipay.hulu.common.constant.Constant.TYPE_ALERT);
            dialog.setCanceledOnTouchOutside(false);
            dialog.setCancelable(false);
            dialog.show();

            dialogRef = new WeakReference<>(dialog);

            dialog.getWindow().setLayout(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT);

            // timeout fix
            if (timeout > 0) {
                if (timeout > 500) {
                    LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            displayDialog = false;
                            forceStopBlocking = false;
                            dialog.dismiss();
                        }
                    }, timeout - 500);
                } else {
                    displayDialog = false;
                    forceStopBlocking = false;
                    LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            dialog.dismiss();
                        }
                    }, timeout);
                }
            }
        } catch (Exception e) {
            LogUtil.e(TAG, "显示设备信息出现异常", e);
            setServiceToTouchBlockMode();

            notifyDialogDismiss();
        }
    }

    /**
     * 通知隐藏悬浮窗
     */
    protected void notifyDialogDismiss() {
        notifyDialogDismiss(500);
    }

    /**
     * 通知隐藏悬浮窗
     *
     * @param time 延迟时间
     */
    protected void notifyDialogDismiss(long time) {
        if (time == 0) {
            displayDialog = false;
        } else {
            executeDelay(new Runnable() {
                @Override
                public void run() {
                    displayDialog = false;
                }
            }, time);
        }
    }

    /**
     * 延时执行
     * @param runnable
     * @param mill
     */
    private void executeDelay(Runnable runnable, long mill) {
        if (mill == 0L) {
            runnable.run();
        } else {
            cmdExecutor.schedule(runnable, mill, TimeUnit.MILLISECONDS);
        }
    }

    @Subscriber(@Param(SubscribeParamEnum.APP))
    public void setApp(String app) {
        this.app = app;
    }

    private static class RecordFloatConnection implements ServiceConnection {
        WeakReference<CaseRecordManager> managerRef;

        public RecordFloatConnection(CaseRecordManager manager) {
            this.managerRef = new WeakReference<>(manager);
        }

        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            FloatWinService.FloatBinder binder = (FloatWinService.FloatBinder) service;
            managerRef.get().binder = binder;
            managerRef.get().provideDisplayContent(binder);
            binder.registerRunClickListener(managerRef.get().listener);
            binder.registerStopClickListener(managerRef.get().stopListener);
            binder.registerFloatClickListener(DEFAULT_FLOAT_LISTENER);
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            managerRef.get().binder = null;
        }
    }

    private static class FloatClickListener implements FloatWinService.OnRunListener {
        WeakReference<CaseRecordManager> managerRef;

        public FloatClickListener(CaseRecordManager manager) {
            this.managerRef = new WeakReference<>(manager);
        }

        @Override
        public int onRunClick() {
            CaseRecordManager manager = managerRef.get();
            if (!manager.isRecording) {
                manager.binder.hideFloat();
                manager.startRecord();
            }
            return 0;
        }
    }

    /**
     * 停止监听器
     */
    private static class FloatStopListener implements FloatWinService.OnStopListener {
        @Override
        public boolean onStopClick() {
            LauncherApplication.getInstance().stopServiceByName(CaseRecordManager.class.getName());
            return false;
        }
    }

    /**
     * 转换为菜单
     * @param actionEnum
     * @return
     */
    protected static TwoLevelSelectLayout.SubMenuItem convertPerformActionToSubMenu(PerformActionEnum actionEnum) {
        return new TwoLevelSelectLayout.SubMenuItem(actionEnum.getDesc(),
                actionEnum.getCode(), actionEnum.getIcon());
    }
}
