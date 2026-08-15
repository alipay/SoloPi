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
package com.alipay.hulu.actions;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Build;
import android.os.IBinder;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.EditText;

import com.alipay.hulu.R;
import com.alipay.hulu.common.annotation.Enable;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.common.utils.patch.PatchLoadResult;
import com.alipay.hulu.screenRecord.SimpleRecordService;
import com.alipay.hulu.screenRecord.TextSpinner;
import com.alipay.hulu.screenRecord.VideoAnalyzer;
import com.alipay.hulu.shared.event.EventService;
import com.alipay.hulu.shared.event.bean.UniversalEventBean;
import com.alipay.hulu.shared.node.action.Constant;
import com.alipay.hulu.shared.node.action.OperationContext;
import com.alipay.hulu.shared.node.action.OperationExecutor;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.action.UIOperationMessage;
import com.alipay.hulu.shared.node.action.provider.ActionProvider;
import com.alipay.hulu.shared.node.action.provider.ViewLoadCallback;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.utils.AssetsManager;
import com.alipay.hulu.util.RecordUtil;

import java.io.File;
import java.lang.ref.WeakReference;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicBoolean;

import static com.alipay.hulu.common.application.LauncherApplication.DISMISS_LOADING_DIALOG;
import static com.alipay.hulu.common.application.LauncherApplication.SHOW_LOADING_DIALOG;
import static com.alipay.hulu.common.constant.Constant.EVENT_RECORD_SCREEN_CODE;
import static com.alipay.hulu.shared.node.action.provider.ActionProviderManager.KEY_TARGET_ACTION;

/**
 * Created by qiaoruikai on 2019/1/9 3:17 PM.
 */
@Enable
public class RecordScreenActionProvider implements ActionProvider {
    private static final String TAG = "RecordScreenPvder";
    private static final String ACTION_START_RECORD_SCREEN = "startRecordScreen";
    private static final String ACTION_STOP_RECORD_SCREEN = "stopRecordScreen";

    private static final String KEY_RECORD_RESOLUTION = "resolution";
    private static final String KEY_RECORD_UPLOAD_URL = "url";
    private static final String KEY_RECORD_UPLOAD_TITLE = "title";

    private InjectorService injectorService;

    private boolean inMasterMode = false;

    public volatile boolean isRecording = false;

    public Intent extraData;

    private String uploadUrl;
    private String uploadTitle;

    private String lastUploadTitle;

    private ServiceConnection recordConnection;
    private SimpleRecordService.RecordBinder binder;

    private AtomicBoolean waitForClick = new AtomicBoolean(false);

    private File currentRecordFile;

    private long firstActionTime = -1;
    private long realTouchTime = -1;
    private double targetDiff = 0.2;

    @Override
    public boolean canProcess(String action) {
        // 5.0及以上系统才能支持
        return Build.VERSION.SDK_INT >= 21 && (StringUtil.equals(ACTION_START_RECORD_SCREEN, action)
                || StringUtil.equals(ACTION_STOP_RECORD_SCREEN, action));
    }

    @Override
    public boolean processAction(String targetAction, AbstractNodeTree node, final OperationMethod method,
                                 final OperationContext context) {
        if (StringUtil.equals(targetAction, ACTION_START_RECORD_SCREEN)) {
            // 切换到sendevent模式
            injectorService.pushMessage(OperationExecutor.EVENT_CLICK_TYPE, OperationExecutor.CLICK_TYPE_SEND_EVENT);

            isRecording = true;

            // 主机模式开启点击监控
            waitForClick.set(true);

            // 初始化点击时间
            realTouchTime = -1;
            firstActionTime = -1;

            // 记录下待上传信息
            uploadTitle = method.getParam(KEY_RECORD_UPLOAD_TITLE);
            uploadUrl = method.getParam(KEY_RECORD_UPLOAD_URL);

            if (ClassUtil.getPatchInfo(VideoAnalyzer.SCREEN_RECORD_PATCH) == null) {
                LauncherApplication.getInstance().showToast(StringUtil.getString(R.string.settings__load_plugin));
                context.notifyOnFinish(new Runnable() {
                    @Override
                    public void run() {
                        PatchLoadResult rs = AssetsManager.loadPatchFromServer(VideoAnalyzer.SCREEN_RECORD_PATCH);
                        // 如果是主进程
                        if (rs != null) {
                            LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    Intent targetIntent = genRecordIntent(LauncherApplication.getContext(), method);
                                    currentRecordFile = binder.startRecord(targetIntent);
                                }
                            });
                        }
                    }
                });
                return true;
            }

            Intent targetIntent = genRecordIntent(LauncherApplication.getContext(), method);

            currentRecordFile = binder.startRecord(targetIntent);

            context.notifyOperationFinish();
            return true;
        } else if (StringUtil.equals(targetAction, ACTION_STOP_RECORD_SCREEN)) {
            if (binder == null) {
                return false;
            }

            // 结束主机模式
            inMasterMode = false;

            isRecording = false;
            // 切换回原有模式
            injectorService.pushMessage(OperationExecutor.EVENT_CLICK_TYPE, OperationExecutor.CLICK_TYPE_ADB_TAP);
            context.notifyOnFinish(new Runnable() {
                @Override
                public void run() {
                    try {
                        injectorService.pushMessage(SHOW_LOADING_DIALOG, StringUtil.getString(R.string.record_screen__calculating_response_time));

                        long startTime = binder.stopRecord();

                        LogUtil.d(TAG, "视频起始时间： " + startTime);

                        MiscUtil.sleep(1000);

                        processVideo(currentRecordFile.getPath(), startTime);

                        // 关闭加载悬浮窗
                        injectorService.pushMessage(DISMISS_LOADING_DIALOG);
                    } catch (Exception e) {
                        LogUtil.e(TAG, "计算响应耗时出现异常: " + e.getMessage(), e);
                    }
                }
            });
            return true;
        }
        return false;
    }

    /**
     * 生成录屏Intent
     * @param method
     * @return
     */
    private Intent genRecordIntent(Context context, OperationMethod method) {
        String resolution = method.getParam(KEY_RECORD_RESOLUTION);
        String[] xes = resolution.split("x");
        int width = Integer.parseInt(xes[0]);
        int height = Integer.parseInt(xes[1]);

        // 默认单位改成kbit/sec
        int bitrate = Integer.parseInt(method.getParam(SimpleRecordService.INTENT_VIDEO_BITRATE)) * 1000;
        int fps = Integer.parseInt(method.getParam(SimpleRecordService.INTENT_FRAME_RATE));
        targetDiff = Double.parseDouble(method.getParam(SimpleRecordService.INTENT_EXCEPT_DIFF));

        Intent intent = new Intent(context, SimpleRecordService.class);
        intent.putExtra(SimpleRecordService.INTENT_FRAME_RATE, fps);
        intent.putExtra(SimpleRecordService.INTENT_VIDEO_BITRATE, bitrate);
        intent.putExtra(SimpleRecordService.INTENT_EXCEPT_DIFF, targetDiff);
        intent.putExtra(SimpleRecordService.INTENT_WIDTH, width);
        intent.putExtra(SimpleRecordService.INTENT_HEIGHT, height);
        intent.putExtras(extraData);

        return intent;
    }

    @Override
    public Map<String, String> provideActions(AbstractNodeTree node) {
        if (Build.VERSION.SDK_INT < 21 || node != null) {
            return null;
        }

        Map<String, String> desc = new HashMap<>(2);
        if (!isRecording) {
            desc.put(ACTION_START_RECORD_SCREEN, StringUtil.getString(R.string.record_screen__start_launch_time));
        } else {
            desc.put(ACTION_STOP_RECORD_SCREEN, StringUtil.getString(R.string.record_screen__stop_launch_time));
        }

        return desc;
    }

    /**
     * 处理视频
     * @param path
     */
    private void processVideo(String path, long videoStartTime) {
        VideoAnalyzer.getInstance().doAnalyze(realTouchTime - videoStartTime, targetDiff
                ,path, new VideoAnalyzer.AnalyzeListener() {
                    @Override
                    public void onAnalyzeFinished(final long result) {
                        UIOperationMessage message = new UIOperationMessage();
                        message.eventType = UIOperationMessage.TYPE_DIALOG;
                        message.params.put("msg", StringUtil.getString(R.string.record_screen__cost_time, result));
                        message.params.put("title", StringUtil.getString(R.string.record_screen__response_time));
                        injectorService.pushMessage(null, message, false);

                        // 如果有配置上传信息
                        if (!StringUtil.isEmpty(uploadUrl)) {
                            BackgroundExecutor.execute(new Runnable() {
                                @Override
                                public void run() {
                                    // 确保上传标题非空
                                    String toUpload = StringUtil.isEmpty(uploadTitle)?
                                            Long.toString(System.currentTimeMillis()): uploadTitle;

                                    RecordUtil.uploadRecordData(uploadUrl, result, toUpload);

                                    // 记录上一次提交标题
                                    lastUploadTitle = uploadTitle;
                                    uploadUrl = null;
                                    uploadTitle = null;
                                }
                            });
                        }
                    }

                    @Override
                    public void onAnalyzeFailed(final String msg) {

                    }
                });
    }

    @Override
    public void provideView(final Context context, String key, final OperationMethod method,
                            AbstractNodeTree node, ViewLoadCallback callback) {
        // 第一次需要配置
        if (StringUtil.equals(key, ACTION_START_RECORD_SCREEN)) {
            inMasterMode = true;
            View v = LayoutInflater.from(ContextUtil.getContextThemeWrapper(context, R.style.AppDialogTheme)).inflate(R.layout.dialog_action_record_config, null);
            View layoutWrapper = v.findViewById(R.id.dialog_action_record_title_layout);
            String uploadUrl = SPService.getString(SPService.KEY_RECORD_SCREEN_UPLOAD, null);

            // 有配置上传地址，提供标题配置选项
            if (uploadUrl != null) {
                method.putParam(KEY_RECORD_UPLOAD_URL, uploadUrl);
                EditText title = (EditText) layoutWrapper.findViewById(R.id.dialog_action_record_title);
                title.addTextChangedListener(new TextWatcher() {
                    @Override
                    public void beforeTextChanged(CharSequence s, int start, int count, int after) {

                    }

                    @Override
                    public void onTextChanged(CharSequence s, int start, int before, int count) {

                    }

                    @Override
                    public void afterTextChanged(Editable s) {
                        method.putParam(KEY_RECORD_UPLOAD_TITLE, s.toString());
                    }
                });

                // 如果有上一次上传的标题，配置下
                if (lastUploadTitle != null) {
                    title.setText(lastUploadTitle);
                }
            } else {
                // 没有上传地址，直接返回空
                layoutWrapper.setVisibility(View.GONE);
            }

            // 加载Spinner
            TextSpinner resolution = (TextSpinner) v.findViewById(R.id.dialog_action_record_resolution);
            resolution.setTag(KEY_RECORD_RESOLUTION);
            TextSpinner bitrate = (TextSpinner) v.findViewById(R.id.dialog_action_record_bitrate);
            bitrate.setTag(SimpleRecordService.INTENT_VIDEO_BITRATE);
            TextSpinner fps = (TextSpinner) v.findViewById(R.id.dialog_action_record_fps);
            fps.setTag(SimpleRecordService.INTENT_FRAME_RATE);
            TextSpinner diff = (TextSpinner) v.findViewById(R.id.dialog_action_record_diff);
            diff.setTag(SimpleRecordService.INTENT_EXCEPT_DIFF);


            TextSpinner.OnItemSelectedListener listener = new TextSpinner.OnItemSelectedListener() {
                @Override
                public void onItemSelected(TextSpinner view, int position) {
                    String key = (String) view.getTag();
                    String value = view.getSelectedItem();
                    method.putParam(key, value);
                }
            };

            // 统一监听下
            resolution.setOnItemSelectedListener(listener);
            bitrate.setOnItemSelectedListener(listener);
            fps.setOnItemSelectedListener(listener);
            diff.setOnItemSelectedListener(listener);

            // 默认设置
            resolution.setSelectedPosition(0);
            bitrate.setSelectedPosition(0);
            fps.setSelectedPosition(0);
            diff.setSelectedPosition(0);

            callback.onViewLoaded(v);
        } else {
            callback.onViewLoaded(null);
        }
    }

    @Override
    public void onCreate(Context context) {
        if (Build.VERSION.SDK_INT < 21) {
            return;
        }

        injectorService = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
        injectorService.register(this);

        EventService service = LauncherApplication.getInstance().findServiceByName(EventService.class.getName());
        service.startTrackTouch();

        // 连接SimpleRecordService
        Intent intent = new Intent(LauncherApplication.getContext(), SimpleRecordService.class);
        recordConnection = new RecordServiceConnection(RecordScreenActionProvider.this);
        LauncherApplication.getContext().bindService(intent, recordConnection
                , Context.BIND_AUTO_CREATE);
    }

    @Override
    public void onDestroy(Context context) {
        if (Build.VERSION.SDK_INT < 21) {
            return;
        }

        if (binder != null && recordConnection != null) {
            if (isRecording) {
                binder.stopRecord();
            }

            context.unbindService(recordConnection);

            Intent intent = new Intent(context, SimpleRecordService.class);
            context.stopService(intent);
        }
    }

    @Subscriber(@Param(value = Constant.ACTION_OPERATION_STEP, sticky = false))
    public void onReceiveEvent(PerformActionEnum actionEnum) {
        if ((actionEnum == PerformActionEnum.CLICK
                || actionEnum == PerformActionEnum.CLICK_IF_EXISTS
                ||actionEnum == PerformActionEnum.CLICK_QUICK)
                && waitForClick.compareAndSet(true, false)) {
            firstActionTime = System.currentTimeMillis();

            LogUtil.d(TAG, "Receive event: " + actionEnum);

            // 主机模式需要监控点击事件
            if (inMasterMode) {
                LogUtil.d(TAG, "主机模式，控制悬浮窗点击");
                injectorService.pushMessage("FloatClickMethod", new Callable<OperationMethod>() {
                    @Override
                    public OperationMethod call() throws Exception {
                        OperationMethod method = new OperationMethod(PerformActionEnum.OTHER_GLOBAL);
                        method.putParam(KEY_TARGET_ACTION, ACTION_STOP_RECORD_SCREEN);
                        return method;
                    }
                });
            }
        }
    }

    @Subscriber(@Param(value = com.alipay.hulu.shared.event.constant.Constant.EVENT_TOUCH_UP, sticky = false))
    public void onReceiveButtonUp(UniversalEventBean eventBean) {
        if (realTouchTime == -1 && firstActionTime > 0 && eventBean.getTime() > firstActionTime) {
            LogUtil.d(TAG, "Select touch time: " + eventBean.getTime());
            realTouchTime = eventBean.getTime();
        }
    }

    @Subscriber(@Param(EVENT_RECORD_SCREEN_CODE))
    public void receiveRecordData(Intent extra) {
        this.extraData = extra;
    }

    private static class RecordServiceConnection implements ServiceConnection {
        private WeakReference<RecordScreenActionProvider> pvderRef;

        /**
         * 初始化
         * @param pvd
         */
        RecordServiceConnection(RecordScreenActionProvider pvd) {
            pvderRef = new WeakReference<>(pvd);
        }

        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            LogUtil.d(TAG, "SimpleRecordService Connected");
            RecordScreenActionProvider pvd = pvderRef.get();
            if (pvd != null) {
                pvd.binder = (SimpleRecordService.RecordBinder) service;
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            LogUtil.d(TAG, "SimpleRecordService disconnected");
            RecordScreenActionProvider provider = pvderRef.get();
            if (provider != null) {
                provider.binder = null;
            }
        }
    }
}
