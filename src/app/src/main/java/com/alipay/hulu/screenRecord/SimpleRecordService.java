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
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.MediaCodecInfo;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;

import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.util.VideoUtils;

import java.io.File;
import java.lang.ref.WeakReference;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

import static android.app.Activity.RESULT_OK;

/**
 * Created by qiaoruikai on 2019/1/9 3:31 PM.
 */
@TargetApi(value = Build.VERSION_CODES.LOLLIPOP)
public class SimpleRecordService extends Service {

    public static final String INTENT_WIDTH =  "INTENT_WIDTH";
    public static final String INTENT_HEIGHT =  "INTENT_HEIGHT";
    public static final String INTENT_FRAME_RATE =  "INTENT_FRAME_RATE";
    public static final String INTENT_VIDEO_BITRATE =  "INTENT_VIDEO_BITRATE";
    public static final String INTENT_EXCEPT_DIFF =  "INTENT_EXCEPT_DIFF";

    private static final String TAG = SimpleRecordService.class.getSimpleName();
    private static final String VIDEO_DIR = "ScreenCaptures";

    private boolean isRecording;
    private MediaProjectionManager mMediaProjectionManager;
    private ScreenRecorder mRecorder;
    private Notifications mNotifications;
    private Handler mHandler;


    private String lastVideoPath;
    private long lastRecorderStartTime;
    private VideoEncodeConfig mVideo;

    private MediaProjection mMediaProjection;


    @Override
    public void onCreate() {
        super.onCreate();
        mHandler = new Handler();
        LogUtil.d(TAG, "onCreate");

        mMediaProjectionManager = (MediaProjectionManager)getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        mNotifications = new Notifications(getApplicationContext());
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return new RecordBinder(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        LogUtil.d(TAG, "onStart");
        stopForeground(false);

        return super.onStartCommand(intent, flags, startId);
    }

    private File initRecorder(Intent intent) {
        try {
            mMediaProjection = mMediaProjectionManager.getMediaProjection(RESULT_OK, intent);
            if (mMediaProjection == null) {
                LogUtil.e(TAG, "media projection is null");
                stopSelf();
                return null;
            }

            mVideo = createVideoConfig(intent);

            if (mVideo == null) {
                mMediaProjection.stop();
                stopSelf();
                return null;
            }

            File record = FileUtils.getSubDir(VIDEO_DIR);
            if (!record.exists() && !record.mkdirs()) {
                stopRecorder();
                stopSelf();
                return null;
            }

            LogUtil.i(TAG, "video dir is: " + record.getAbsolutePath());
            LogUtil.i(TAG, "is video dir exists?" + record.exists());

            File path = generateVideoPath();
            mRecorder = createRecorder(mMediaProjection, mVideo, path);
            return path;
        } catch (Exception e) {
            LogUtil.e(TAG, e.getMessage(), e);
            return null;
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

    @Override
    public void onDestroy() {
        LogUtil.d(TAG, "onDestroy");

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
                isRecording = false;
            }

            @Override
            public void onStart() {
                lastRecorderStartTime = System.currentTimeMillis();
                LogUtil.e("yuawen", "录屏开始时间：" + lastRecorderStartTime);
                mHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        isRecording = true;
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

    private long stopRecorder() {
        mNotifications.clear();
        if (mRecorder != null) {
            mRecorder.quit();
        }
        mRecorder = null;

        return lastRecorderStartTime;
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
            File result = recordRef.get().initRecorder(intent);
            if (result != null) {
                recordRef.get().startRecorder();
                return result;
            }
            return null;
        }

        public long stopRecord() {
            return recordRef.get().stopRecorder();
        }
    }
}