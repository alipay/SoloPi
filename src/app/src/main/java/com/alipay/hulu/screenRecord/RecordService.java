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
package com.alipay.hulu.screenRecord;

import android.annotation.TargetApi;
import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Rect;
import android.media.MediaCodecInfo;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.widget.AdapterView;
import android.widget.ImageView;
import android.widget.ListView;
import android.widget.SimpleAdapter;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.service.BaseService;
import com.alipay.hulu.shared.event.EventService;
import com.alipay.hulu.shared.event.bean.UniversalEventBean;
import com.alipay.hulu.shared.event.constant.Constant;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@TargetApi(value = Build.VERSION_CODES.LOLLIPOP)
public class RecordService extends BaseService {
    public static final int RECORD_SERVICE_NOTIFICATION_ID = 26543;

    public static final String INTENT_RESULT_CODE =  "INTENT_RESULT_CODE";
    public static final String INTENT_VIDEO_CODEC =  "INTENT_VIDEO_CODEC";
    public static final String INTENT_WIDTH =  "INTENT_WIDTH";
    public static final String INTENT_HEIGHT =  "INTENT_HEIGHT";
    public static final String INTENT_FRAME_RATE =  "INTENT_FRAME_RATE";
    public static final String INTENT_VIDEO_BITRATE =  "INTENT_VIDEO_BITRATE";
    public static final String INTENT_EXCEPT_DIFF =  "INTENT_EXCEPT_DIFF";

    public static final String ACTION_INIT = "ACTION_INIT";

    private static final String TAG = RecordService.class.getSimpleName();
    private static final String VIDEO_DIR = "ScreenCaptures";

    private WindowManager wm = null;
    private WindowManager.LayoutParams wmParams = null;

    private View view;
    private TextView recordBtn;
    private View closeBtn;
    private ListView resultList;
    private TextView killCurrent;
    private SimpleAdapter adapter;
    private ImageView resultHide;

    private float mTouchStartX;
    private float mTouchStartY;
    private float x;
    private float y;
    int state, lastState;
    private int statusBarHeight = 0;

    private long lastMotionDownTime;

    private List<Long> results;
    private List<Map<String, String>> displayDataSource;

    private String mCodec;
    private int mFrameRate;
    private int mBitrate;
    private int mWidth;
    private int mHeight;

    private boolean isRecording;
    private MediaProjectionManager mMediaProjectionManager;
    private ScreenRecorder mRecorder;
    private Notifications mNotifications;


    private String lastVideoPath;
    private long lastRecorderStartTime;
    private long lastCalculateT1;
    private boolean hasClicked = false;
    private boolean isCalculating = false;
    private VideoEncodeConfig mVideo;

    private boolean hideResult = false;

    private Handler mHandler;
    private MediaProjection mMediaProjection;

    private InjectorService injectorService;
    private EventService eventService;

    private Intent mIntent;
    private int mResultCode;
    private double mExceptDiff;

    @Override
    public void onCreate() {
        super.onCreate();
        LogUtil.d(TAG, "onCreate");
        results = new ArrayList<>();
        createView();

        Notification notification = generateNotificationBuilder().setContentText(getString(R.string.service_notification__solopi_record_running)).setSmallIcon(R.drawable.solopi_main).build();
        startForeground(RECORD_SERVICE_NOTIFICATION_ID, notification);


        mMediaProjectionManager = (MediaProjectionManager)getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        mNotifications = new Notifications(getApplicationContext());
        mHandler = new Handler();
        injectorService = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
        injectorService.register(this);

        eventService = LauncherApplication.getInstance().findServiceByName(EventService.class.getName());
        eventService.startTrackTouch();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }


    private void createView() {
        view = LayoutInflater.from(ContextUtil.getContextThemeWrapper(this, R.style.AppTheme)).inflate(R.layout.record_service, null);

        recordBtn = (TextView) view.findViewById(R.id.record_btn);
        recordBtn.setText(R.string.record__start_record);
        closeBtn = view.findViewById(R.id.close_btn);
        resultList = (ListView) view.findViewById(R.id.record_session_result);
        killCurrent = (TextView) view.findViewById(R.id.record_kill_current);
        resultHide  = (ImageView) view.findViewById(R.id.record_session_hide);

        displayDataSource = new ArrayList<>();
        adapter = new SimpleAdapter(this, displayDataSource, R.layout.item_screen_result, new String[] {"title", "value"}, new int[] {R.id.screen_result_title, R.id.screen_result_value});
        resultList.setAdapter(adapter);
        resultList.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                if (position < results.size()) {
                    removeResultAt(position);
                } else {
                    clearResult();
                }
            }
        });

        killCurrent.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                BackgroundExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        if (CmdTools.isInitialized()) {
                            String[] pA = CmdTools.getTopPkgAndActivity();
                            if (pA == null || pA.length != 2) {
                                LauncherApplication.getInstance().showToast("获取当前应用失败");
                                return;
                            }
                            LogUtil.i(TAG, "当前应用: %s, 当前Activity: %s", pA[0], pA[1]);

                            // 杀两遍
                            CmdTools.execHighPrivilegeCmd("am force-stop " + pA[0]);
                            CmdTools.execHighPrivilegeCmd("am force-stop " + pA[0]);
                        } else {
                            // 申请ADB
                            requestAdb();
                        }
                    }
                });
            }
        });

        resultHide.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                hideResult = !hideResult;
                if (hideResult) {
                    resultList.setVisibility(View.GONE);
                    resultHide.setRotation(0);
                } else {
                    resultList.setVisibility(View.VISIBLE);
                    resultHide.setRotation(180);
                }
            }
        });

        if (statusBarHeight == 0) {
            try {
                Class<?> clazz = Class.forName("com.android.internal.R$dimen");
                Object object = clazz.newInstance();
                statusBarHeight = Integer.parseInt(clazz.getField("status_bar_height")
                        .get(object).toString());
                statusBarHeight = getResources().getDimensionPixelSize(statusBarHeight);
            } catch (Exception e) {
                e.printStackTrace();
            } finally {
                if (statusBarHeight == 0) {
                    statusBarHeight = 50;
                }
            }
        }

        wm = (WindowManager) getApplicationContext().getSystemService(WINDOW_SERVICE);
        wmParams = ((MyApplication)getApplication()).getFloatWinParams();
        wmParams.type = com.alipay.hulu.common.constant.Constant.TYPE_ALERT;
        wmParams.flags |= 8;
        wmParams.gravity = Gravity.LEFT | Gravity.TOP; // 调整悬浮窗口至左上角
        // 以屏幕左上角为原点，设置x、y初始值
        wmParams.x = 0;
        wmParams.y = 0;
        // 设置悬浮窗口长宽数据
        wmParams.width = WindowManager.LayoutParams.WRAP_CONTENT;
        wmParams.height = WindowManager.LayoutParams.WRAP_CONTENT;
        wmParams.format = 1;
        wmParams.alpha = 1f;

        wm.addView(view, wmParams);

        final Rect closeRect = new Rect();
        final Rect recordRect = new Rect();

        view.postDelayed(new Runnable() {
            @Override
            public void run() {
                closeBtn.getHitRect(closeRect);
                recordBtn.getHitRect(recordRect);
            }
        }, 500);

        view.setOnTouchListener(new View.OnTouchListener() {
            public boolean onTouch(View v, MotionEvent event) {
                // 获取相对屏幕的坐标，即以屏幕左上角为原点
                x = event.getRawX();
                y = event.getRawY() - statusBarHeight;
                LogUtil.i(TAG, "currX" + x + "====currY" + y);

                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        state = MotionEvent.ACTION_DOWN;
                        // 获取相对View的坐标，即以此View左上角为原点
                        mTouchStartX = event.getX();
                        mTouchStartY = event.getY();
                        LogUtil.i(TAG, "startX" + mTouchStartX + "====startY" + mTouchStartY);
                        lastState = state;
                        lastMotionDownTime = System.currentTimeMillis();
                        break;
                    case MotionEvent.ACTION_MOVE:
                        state = MotionEvent.ACTION_MOVE;
                        updateViewPosition();
                        lastState = state;
                        break;

                    case MotionEvent.ACTION_UP:
                        state = MotionEvent.ACTION_UP;

                        if (System.currentTimeMillis() - lastMotionDownTime < ViewConfiguration.getTapTimeout()) {
                            float curX = event.getX();
                            float curY = event.getY();

                            if (closeRect.contains((int)curX, (int)curY)
                                    && closeRect.contains((int)mTouchStartX, (int)mTouchStartY)) {
                                LogUtil.i(TAG, "Click Close Btn");
                                onCloseBtnClicked();
                            } else if (recordRect.contains((int)curX, (int)curY)
                                    && recordRect.contains((int)mTouchStartX, (int)mTouchStartY)) {
                                LogUtil.i(TAG, "Click Record Btn");
                                onRecordBtnClicked();
                            }
                        }

                        updateViewPosition();
                        mTouchStartX = mTouchStartY = 0;
                        lastState = state;
                        break;
                }
                return false;
            }
        });

        view.setAlpha(0.8f);
    }

    private void requestAdb() {
        LauncherApplication.getInstance().showDialog(RecordService.this, "ADB连接尚未开启，是否开启？", "开启", new Runnable() {
            @Override
            public void run() {
                BackgroundExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        boolean result;
                        try {
                            result = CmdTools.generateConnection();
                        } catch (Exception e) {
                            LogUtil.e(TAG, "连接adb异常", e);
                            result = false;
                        }
                        if (result) {
                            LauncherApplication.getInstance().showToast("开启成功");
                        } else {
                            LauncherApplication.getInstance().showToast("开启失败");
                        }
                    }
                });
            }
        }, "取消", null);
    }

    private void onRecordBtnClicked() {
        if (isCalculating) {
            return;
        }

        LogUtil.w("yuawen", "上一次点击开始/结束录制的时间：" + System.currentTimeMillis());
        if (isRecording) {
            stopRecorder();
        } else {
            if (initRecorder()) {
                startRecorder();
            }
        }
    }

    private void onCloseBtnClicked() {
        stopRecorder();
        stopSelf();
    }

    private void updateViewPosition() {
        // 更新浮动窗口位置参数
        wmParams.x = (int) (x - mTouchStartX);
        wmParams.y = (int) (y - mTouchStartY);
        wmParams.alpha = 1F;
        wm.updateViewLayout(view, wmParams);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        LogUtil.d(TAG, "onStart");
//        Notification notification = new Notification.Builder(this).setContentText(getString(R.string.float__toast_title)).setSmallIcon(R.drawable.solopi_main).build();
//        startForeground(NOTIFICATION_ID, notification);

        if (intent == null) {
            return super.onStartCommand(intent, flags, startId);
        }

        if (ACTION_INIT.equals(intent.getAction())) {

            mResultCode = intent.getIntExtra(INTENT_RESULT_CODE, 0);
            mIntent = intent;

            mCodec = intent.getStringExtra(INTENT_VIDEO_CODEC);
            mFrameRate = intent.getIntExtra(INTENT_FRAME_RATE, 0);
            mBitrate = intent.getIntExtra(INTENT_VIDEO_BITRATE, 0);
            mWidth = intent.getIntExtra(INTENT_WIDTH, 0);
            mHeight = intent.getIntExtra(INTENT_HEIGHT, 0);
            mExceptDiff = intent.getDoubleExtra(INTENT_EXCEPT_DIFF, 0);
        }
        return super.onStartCommand(intent, flags, startId);
    }

    private boolean initRecorder() {
        try {
            mMediaProjection = mMediaProjectionManager.getMediaProjection(mResultCode, mIntent);
            if (mMediaProjection == null) {
                LogUtil.e(TAG, "media projection is null");
                stopSelf();
                return false;
            }

            mVideo = createVideoConfig();

            if (mVideo == null) {
                mMediaProjection.stop();
                stopSelf();
                return false;
            }

            File record = FileUtils.getSubDir(VIDEO_DIR);
            if (!record.exists()) {
                stopRecorder();
                stopSelf();
                return false;
            }

            LogUtil.i(TAG, "video dir is: " + record.getAbsolutePath());
            LogUtil.i(TAG, "is video dir exists?" + record.exists());

            mRecorder = createRecorder(mMediaProjection, mVideo, generateVideoPath());
            return true;
        } catch (Exception e) {
            LogUtil.e(TAG, e.getMessage(), e);
            return false;
        }
    }

    @NonNull
    private File generateVideoPath() {
        SimpleDateFormat format = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US);
        final File file = new File(FileUtils.getSubDir(VIDEO_DIR), "Screen-" + format.format(new Date())
                + "-" + mVideo.width + "x" + mVideo.height + ".mp4");
        LogUtil.d(TAG, "Create recorder with :" + mVideo + " \n " + file);
        lastVideoPath = file.getAbsolutePath();
        if (mRecorder != null) {
            mRecorder.updateDstPath(lastVideoPath);
        }
        return file;
    }

    /**
     * 增加结果列
     * @param result
     */
    private void addResultValue(long result) {
        results.add(result);
        displayDataSource.clear();
        long total = 0;
        for (int i = 0; i < results.size(); i++) {
            long val = results.get(i);
            total += val;
            Map<String, String> display = new HashMap<>(3);
            display.put("title", "第" + (i + 1) + "次");
            display.put("value", val + "ms");
            displayDataSource.add(display);
        }

        Map<String, String> display = new HashMap<>(3);
        display.put("title", "平均值");
        display.put("value", (total / results.size()) + "ms");
        displayDataSource.add(display);

        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                adapter.notifyDataSetChanged();
            }
        });
    }

    /**
     * 清空结果列
     */
    private void clearResult() {
        results.clear();
        displayDataSource.clear();
        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                adapter.notifyDataSetChanged();
            }
        });
    }

    /**
     * 删除结果列特定项
     */
    private void removeResultAt(int position) {
        if (position >= results.size() || position < 0) {
            return;
        }
        results.remove(position);
        displayDataSource.clear();
        long total = 0;
        for (int i = 0; i < results.size(); i++) {
            long val = results.get(i);
            total += val;
            Map<String, String> display = new HashMap<>(3);
            display.put("title", "第" + (i + 1) + "次");
            display.put("value", val + "ms");
            displayDataSource.add(display);
        }

        if (results.size() > 0) {
            Map<String, String> display = new HashMap<>(3);
            display.put("title", "平均值");
            display.put("value", (total / results.size()) + "ms");
            displayDataSource.add(display);
        }
        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                adapter.notifyDataSetChanged();
            }
        });
    }

    @Override
    public void onDestroy() {
        LogUtil.d(TAG, "onDestroy");
        wm.removeView(view);
        stopForeground(true);

        injectorService.unregister(this);
        injectorService = null;

        // 停止监听
        eventService.stopTrackTouch();
        LauncherApplication.getInstance().stopServiceByName(EventService.class.getName());
        eventService = null;

        super.onDestroy();
    }


    private ScreenRecorder createRecorder(MediaProjection mediaProjection, final VideoEncodeConfig video
            , final File output) {
        ScreenRecorder r = new ScreenRecorder(video,
                1, mediaProjection, output.getAbsolutePath());
        r.setCallback(new ScreenRecorder.Callback() {
            long startTime = 0;
            @Override
            public void onStop(Throwable error) {
                mHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        isRecording = false;
                        isCalculating = true;
                        recordBtn.setText(R.string.record__calculating);
                        LauncherApplication.getInstance().showToast(getString(R.string.record__please_wait));
                    }
                });
                BackgroundExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        VideoAnalyzer.getInstance().doAnalyze(lastCalculateT1,video.exceptDiff
                                , lastVideoPath, new VideoAnalyzer.AnalyzeListener() {
                                    @Override
                                    public void onAnalyzeFinished(final long result) {
                                        mHandler.post(new Runnable() {
                                            @Override
                                            public void run() {
                                                isCalculating = false;
                                                recordBtn.setText(R.string.record__start_record);
                                                if (result <= 0) {
                                                    LauncherApplication.getInstance().showToast(getString(R.string.record__operation_fast));
                                                } else {
                                                    addResultValue(result);
                                                }
                                            }
                                        });
                                    }

                                    @Override
                                    public void onAnalyzeFailed(final String msg) {
                                        mHandler.post(new Runnable() {
                                            @Override
                                            public void run() {
                                                isCalculating = false;
                                                recordBtn.setText(R.string.record__start_record);
                                                LauncherApplication.getInstance().showToast(msg);
                                            }
                                        });
                                    }
                                });
                    }
                }, 2000);
                if (error != null) {
                    LogUtil.e(TAG, "stop record is error now... error msg:\n"
                            + MiscUtil.stackTraceToString(error.getStackTrace()));
                    output.delete();
                }
            }

            @Override
            public void onStart() {
                lastRecorderStartTime = System.currentTimeMillis();
                LogUtil.w("yuawen", "录屏开始时间：" + lastRecorderStartTime);
                mHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        isRecording = true;
                        hasClicked = false;
                        recordBtn.setText(R.string.record__stop_record);
                        mNotifications.recording(0);
                    }
                });
            }

            @Override
            public void onRecording(long presentationTimeUs) {
                if (startTime <= 0) {
                    startTime = presentationTimeUs;
                }
                long time = (presentationTimeUs - startTime) / 1000;
                mNotifications.recording(time);
            }
        });
        return r;
    }

    private void startRecorder() {
        if (mRecorder == null) {
            return;
        }
        mRecorder.start();
    }

    private void stopRecorder() {
        mNotifications.clear();
        if (mRecorder != null) {
            mRecorder.quit();
        }
        mRecorder = null;
    }

    private VideoEncodeConfig createVideoConfig() {
        final String codec = mCodec;
        if (codec == null) {
            return null;
        }
        int width = mWidth;
        int height = mHeight;
        int framerate = mFrameRate;
        int iframe = 1;
        int bitrate = mBitrate;
        double exceptDiff = mExceptDiff;
        MediaCodecInfo.CodecProfileLevel profileLevel = null;

        return new VideoEncodeConfig(width, height, bitrate,
                framerate, iframe, codec, ScreenRecorder.VIDEO_AVC, profileLevel,exceptDiff);
    }


    @Subscriber(@Param(Constant.EVENT_TOUCH_UP))
    public void notifyTouchEnd(final UniversalEventBean eventBean) {
        mHandler.post(new Runnable() {
            @Override
            public void run() {
                long curTouchTime = eventBean.getTime();
                LogUtil.w("yuawen", "上一次点击的时间:" + curTouchTime);
                if (hasClicked || curTouchTime < lastRecorderStartTime) {
                    return;
                }
                hasClicked = true;
                lastCalculateT1 = curTouchTime - lastRecorderStartTime;
                LogUtil.w("yuawen", "筛选后上一次点击的时间:" + curTouchTime);
                LogUtil.w("yuawen", "t1 costs:" + lastCalculateT1);
            }
        });
    }
}
