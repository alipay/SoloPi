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
import android.content.Context;
import android.content.Intent;
import android.media.MediaCodecInfo;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.view.WindowManager;

import com.alipay.hulu.R;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.service.BaseService;
import com.alipay.hulu.util.VideoUtils;

import java.io.File;
import java.lang.ref.WeakReference;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import static android.app.Activity.RESULT_OK;

/**
 * Created by qiaoruikai on 2019/1/9 3:31 PM.
 */
@TargetApi(value = Build.VERSION_CODES.LOLLIPOP)
public class SimpleRecordService extends BaseService {
    private static final int RECORD_SERVICE_NOTIFICATION_ID = 36231;

    public static final String INTENT_WIDTH =  "INTENT_WIDTH";
    public static final String INTENT_HEIGHT =  "INTENT_HEIGHT";
    public static final String INTENT_FRAME_RATE =  "INTENT_FRAME_RATE";
    public static final String INTENT_VIDEO_BITRATE =  "INTENT_VIDEO_BITRATE";
    public static final String INTENT_EXCEPT_DIFF =  "INTENT_EXCEPT_DIFF";
    public static final String VIDEO_DIR = "ScreenCaptures";

    private static final String TAG = SimpleRecordService.class.getSimpleName();
    private static volatile boolean anyRecorderActive;
    private static final int NOTIFICATION_ID = 19222;

    private static final int TYPE_TOAST = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY: WindowManager.LayoutParams.TYPE_TOAST;

    static {
        LauncherApplication.getInstance().registerSelfAsForegroundService(SimpleRecordService.class);
    }

    private volatile boolean isRecording;
    private volatile boolean recorderActive;
    private volatile boolean stopCompleted = true;
    private volatile boolean stopRequested;
    private volatile String lastRecordingError;
    private volatile String recorderOwner;
    private volatile String legacyRecorderOwner;
    private final Set<String> cancelledRecorderOwners = new HashSet<>();
    private final ScreenRecorderSessionState recorderSessions =
            new ScreenRecorderSessionState();
    private MediaProjectionManager mMediaProjectionManager;
    private volatile ScreenRecorder mRecorder;
    private Notifications mNotifications;
    private Handler mHandler;


    private volatile String lastVideoPath;
    private volatile long lastRecorderStartTime;
    private VideoEncodeConfig mVideo;

    private MediaProjection mMediaProjection;


    @Override
    public void onCreate() {
        super.onCreate();

        Notification notification = generateNotificationBuilder().setContentText(getString(R.string.service_notification__solopi_record_running)).setSmallIcon(R.drawable.solopi_main).build();
        startForeground(RECORD_SERVICE_NOTIFICATION_ID, notification);

        mHandler = new Handler();
        LogUtil.d(TAG, "onCreate");
        InjectorService.g().register(this);

        mMediaProjectionManager = (MediaProjectionManager)getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        mNotifications = new Notifications(getApplicationContext());
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return new SimpleRecordService.RecordBinder(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        LogUtil.d(TAG, "onStart");
//        stopForeground(false);

        return super.onStartCommand(intent, flags, startId);
    }

    private synchronized File startRecorder(Intent intent, String owner, boolean legacy) {
        if (owner == null) {
            lastRecordingError = "Screen recording owner is required";
            return null;
        }
        if (cancelledRecorderOwners.remove(owner)) {
            lastRecordingError = "Screen recording was cancelled before start";
            recorderSessions.reject(owner, lastRecordingError);
            return null;
        }
        if (recorderActive || mRecorder != null) {
            LogUtil.w(TAG, "A screen recorder is already active");
            lastRecordingError = "Another screen recorder is already active";
            recorderSessions.reject(owner, lastRecordingError);
            return null;
        }
        if (!ScreenRecorderLease.tryAcquire(owner)) {
            LogUtil.w(TAG, "Unable to acquire the process screen recorder lease");
            lastRecordingError = ScreenRecorderLease.isHeld()
                    ? "Another screen recorder owner is already active"
                    : "Screen recording is unavailable during runtime maintenance";
            recorderSessions.reject(owner, lastRecordingError);
            return null;
        }
        recorderSessions.start(owner);
        recorderOwner = owner;
        legacyRecorderOwner = legacy ? owner : null;
        recorderActive = true;
        anyRecorderActive = true;
        stopCompleted = false;
        stopRequested = false;
        lastRecordingError = null;
        lastVideoPath = null;
        lastRecorderStartTime = 0L;
        try {
            mMediaProjection = mMediaProjectionManager.getMediaProjection(RESULT_OK, intent);
            if (mMediaProjection == null) {
                LogUtil.e(TAG, "media projection is null");
                failRecorderInitialization(owner,
                        "MediaProjection permission result is invalid");
                stopSelf();
                return null;
            }

            mVideo = createVideoConfig(intent);

            if (mVideo == null) {
                failRecorderInitialization(owner,
                        "No compatible H.264 encoder is available");
                stopSelf();
                return null;
            }

            File record = FileUtils.getSubDir(VIDEO_DIR);
            if (!record.exists() && !record.mkdirs()) {
                failRecorderInitialization(owner,
                        "Unable to create the screen capture directory");
                stopSelf();
                return null;
            }

            LogUtil.i(TAG, "video dir is: " + record.getAbsolutePath());
            LogUtil.i(TAG, "is video dir exists?" + record.exists());

            File path = generateVideoPath();
            mRecorder = createRecorder(mMediaProjection, mVideo, path, owner);
            mRecorder.start();
            return path;
        } catch (Exception e) {
            LogUtil.e(TAG, e.getMessage(), e);
            String message = e.getMessage();
            if (message == null) {
                message = e.getClass().getSimpleName();
            }
            ScreenRecorder recorder = mRecorder;
            if (recorder != null) {
                recorder.quit(e);
            } else {
                failRecorderInitialization(owner, message);
            }
            lastRecordingError = message;
            recorderSessions.updateError(owner, message);
            return null;
        }
    }

    private synchronized File startLegacyRecorder(Intent intent) {
        return startRecorder(intent, ScreenRecorderLease.newOwner("simple-legacy"), true);
    }

    private synchronized void failRecorderInitialization(String owner, String reason) {
        if (owner == null || !owner.equals(recorderOwner)) {
            return;
        }
        lastRecordingError = reason;
        isRecording = false;
        recorderActive = false;
        anyRecorderActive = false;
        stopRequested = false;
        recorderSessions.complete(owner, 0L, reason);
        recorderOwner = null;
        if (owner.equals(legacyRecorderOwner)) {
            legacyRecorderOwner = null;
        }
        mRecorder = null;
        stopProjectionQuietly();
        ScreenRecorderLease.release(owner);
        stopCompleted = true;
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

    @Override
    public void onDestroy() {
        stopRecorder(null, true);
        stopForeground(false);
        LogUtil.d(TAG, "onDestroy");
        super.onDestroy();
    }


    private ScreenRecorder createRecorder(MediaProjection mediaProjection,
            final VideoEncodeConfig video, final File output, final String owner) {
        ScreenRecorder r = new ScreenRecorder(video,
                1, mediaProjection, output.getAbsolutePath());
        r.setCallback(new ScreenRecorder.Callback() {
            long startTime = 0;
            @Override
            public void onStop(final Throwable error) {
                completeRecorderStop(owner, error);
            }

            @Override
            public void onStart() {
                synchronized (SimpleRecordService.this) {
                    if (!owner.equals(recorderOwner)) {
                        return;
                    }
                    lastRecorderStartTime = System.currentTimeMillis();
                    lastRecordingError = null;
                    recorderSessions.updateStartTime(owner, lastRecorderStartTime);
                    recorderSessions.updateError(owner, null);
                }
                LogUtil.e("yuawen", "录屏开始时间：" + lastRecorderStartTime);
                mHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        synchronized (SimpleRecordService.this) {
                            if (!owner.equals(recorderOwner) || stopRequested) {
                                return;
                            }
                            isRecording = true;
                        }
                        mNotifications.recording(0);
                    }
                });
            }

            @Override
            public void onRecording(long presentationTimeUs) {
                synchronized (SimpleRecordService.this) {
                    if (!owner.equals(recorderOwner)) {
                        return;
                    }
                }
                if (startTime <= 0) {
                    startTime = presentationTimeUs;
                }
                long time = (presentationTimeUs - startTime) / 1000;
                mNotifications.recording(time);
            }
        });
        return r;
    }

    private synchronized long stopRecorder(String owner, boolean force) {
        String activeOwner = recorderOwner;
        if (activeOwner == null) {
            if (!force && owner != null) {
                // 阻止 bind/start 与 stop 并发时同一 owner 的迟到启动。
                cancelledRecorderOwners.add(owner);
            }
            return lastRecorderStartTime;
        }
        if (!force && !activeOwner.equals(owner)) {
            LogUtil.w(TAG, "Reject stop request from a non-owner");
            return -1L;
        }
        if (stopRequested) {
            return lastRecorderStartTime;
        }
        stopRequested = true;
        try {
            mNotifications.clear();
        } catch (RuntimeException exception) {
            LogUtil.w(TAG, "Unable to clear the recording notification");
        }
        ScreenRecorder recorder = mRecorder;
        if (recorder != null) {
            recorder.quit();
        } else {
            completeRecorderStop(activeOwner, null);
        }
        return lastRecorderStartTime;
    }

    private synchronized void completeRecorderStop(String owner, Throwable error) {
        if (owner == null || !owner.equals(recorderOwner)) {
            return;
        }
        try {
            mNotifications.clear();
        } catch (RuntimeException exception) {
            LogUtil.w(TAG, "Unable to clear the recording notification");
        }
        isRecording = false;
        recorderActive = false;
        anyRecorderActive = false;
        stopRequested = false;
        recorderOwner = null;
        if (owner.equals(legacyRecorderOwner)) {
            legacyRecorderOwner = null;
        }
        mRecorder = null;
        mMediaProjection = null;
        if (error == null) {
            lastRecordingError = null;
        } else {
            String message = error.getMessage();
            lastRecordingError = message == null ? error.getClass().getSimpleName() : message;
        }
        recorderSessions.complete(owner, lastRecorderStartTime, lastRecordingError);
        ScreenRecorderLease.release(owner);
        stopCompleted = true;
    }

    private void stopProjectionQuietly() {
        MediaProjection projection = mMediaProjection;
        mMediaProjection = null;
        if (projection != null) {
            try {
                projection.stop();
            } catch (RuntimeException exception) {
                LogUtil.w(TAG, "MediaProjection was already stopped");
            }
        }
    }

    public static boolean hasActiveRecorder() {
        return anyRecorderActive;
    }

    private synchronized long getRecorderStartTime(String owner) {
        return recorderSessions.getStartTime(owner);
    }

    private synchronized boolean isRecorderStopCompleted(String owner) {
        return recorderSessions.isCompleted(owner);
    }

    private synchronized String getRecorderError(String owner) {
        return recorderSessions.getError(owner);
    }

    private synchronized boolean isRecorderRecording(String owner) {
        return owner != null && owner.equals(recorderOwner) && isRecording;
    }

    private synchronized boolean isRecorderActive(String owner) {
        return owner != null && owner.equals(recorderOwner) && recorderActive;
    }


    private VideoEncodeConfig createVideoConfig(Intent intent) {
        // 不同系统，不同硬件，codec不一样，无法传递
        MediaCodecInfo[] codecs = VideoUtils.findEncodersByType(ScreenRecorder.VIDEO_AVC);
        if (codecs.length == 0) {
            return null;
        }

        String codec = codecs[0].getName();

        int framerate = intent.getIntExtra(INTENT_FRAME_RATE, 0);
        int bitrate = intent.getIntExtra(INTENT_VIDEO_BITRATE, 0);
        int height = intent.getIntExtra(INTENT_WIDTH, 0);
        int width = intent.getIntExtra(INTENT_HEIGHT, 0);
        double exceptDiff = intent.getDoubleExtra(INTENT_EXCEPT_DIFF, 0);


        int iframe = 1;
        MediaCodecInfo.CodecProfileLevel profileLevel = null;

        return new VideoEncodeConfig(width, height, bitrate,
                framerate, iframe, codec, ScreenRecorder.VIDEO_AVC, profileLevel, exceptDiff);
    }

    /**
     * binder调用
     */
    public static class RecordBinder extends Binder {
        private WeakReference<SimpleRecordService> recordRef;

        public RecordBinder(SimpleRecordService service) {
            recordRef = new WeakReference<>(service);
        }

        public File startRecord(Intent intent) {
            SimpleRecordService service = recordRef.get();
            return service == null ? null : service.startLegacyRecorder(intent);
        }

        public File startRecord(Intent intent, String owner) {
            SimpleRecordService service = recordRef.get();
            if (service == null) {
                return null;
            }
            return service.startRecorder(intent, owner, false);
        }

        public long stopRecord() {
            SimpleRecordService service = recordRef.get();
            if (service == null) {
                return 0L;
            }
            String owner = service.legacyRecorderOwner;
            if (owner == null) {
                return 0L;
            }
            long result = service.stopRecorder(owner, false);
            return result < 0L ? 0L : result;
        }

        public boolean stopRecord(String owner) {
            SimpleRecordService service = recordRef.get();
            return service != null && service.stopRecorder(owner, false) >= 0L;
        }

        public boolean isOwnedBy(String owner) {
            SimpleRecordService service = recordRef.get();
            return service != null && owner != null && owner.equals(service.recorderOwner);
        }

        public boolean isRecording() {
            SimpleRecordService service = recordRef.get();
            return service != null && service.isRecording;
        }

        public boolean isRecording(String owner) {
            SimpleRecordService service = recordRef.get();
            return service != null && service.isRecorderRecording(owner);
        }

        public boolean isRecorderActive() {
            SimpleRecordService service = recordRef.get();
            return service != null && service.recorderActive;
        }

        public boolean isRecorderActive(String owner) {
            SimpleRecordService service = recordRef.get();
            return service != null && service.isRecorderActive(owner);
        }

        public boolean isStopCompleted() {
            SimpleRecordService service = recordRef.get();
            return service == null || service.stopCompleted;
        }

        public boolean isStopCompleted(String owner) {
            SimpleRecordService service = recordRef.get();
            return service == null || service.isRecorderStopCompleted(owner);
        }

        public String getLastVideoPath() {
            SimpleRecordService service = recordRef.get();
            return service == null ? null : service.lastVideoPath;
        }

        public long getLastRecorderStartTime() {
            SimpleRecordService service = recordRef.get();
            return service == null ? 0L : service.lastRecorderStartTime;
        }

        public long getLastRecorderStartTime(String owner) {
            SimpleRecordService service = recordRef.get();
            return service == null ? 0L : service.getRecorderStartTime(owner);
        }

        public String getLastRecordingError() {
            SimpleRecordService service = recordRef.get();
            return service == null ? "Screen recording service is unavailable" : service.lastRecordingError;
        }

        public String getLastRecordingError(String owner) {
            SimpleRecordService service = recordRef.get();
            return service == null
                    ? "Screen recording service is unavailable"
                    : service.getRecorderError(owner);
        }

        public Context loadContext() {
            return recordRef.get();
        }
    }
}
