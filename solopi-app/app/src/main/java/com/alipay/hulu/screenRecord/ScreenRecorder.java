/*
 * Copyright (c) 2014 Yrom Wang <http://www.yrom.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.alipay.hulu.screenRecord;

import android.annotation.TargetApi;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.MediaCodec;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.media.projection.MediaProjection;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.Message;

import com.alipay.hulu.BuildConfig;
import com.alipay.hulu.common.utils.LogUtil;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.LinkedList;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * @author Yrom
 */
@TargetApi(value = Build.VERSION_CODES.LOLLIPOP)
public class ScreenRecorder {
    private static final String TAG = "ScreenRecorder";
    private static final boolean VERBOSE = BuildConfig.DEBUG;
    private static final int INVALID_INDEX = -1;
    public static final String VIDEO_AVC = MediaFormat.MIMETYPE_VIDEO_AVC; // H.264 Advanced Video Coding
    private int mWidth;
    private int mHeight;
    private int mDpi;
    private String mDstPath;
    private MediaProjection mMediaProjection;
    private VideoEncoder mVideoEncoder;

    private MediaFormat mVideoOutputFormat = null;
    private int mVideoTrackIndex = INVALID_INDEX;
    private MediaMuxer mMuxer;
    private boolean mMuxerStarted = false;

    private final AtomicBoolean mForceQuit = new AtomicBoolean(false);
    private final AtomicBoolean mIsRunning = new AtomicBoolean(false);
    private final AtomicBoolean mStopSignalled = new AtomicBoolean(false);
    private final AtomicBoolean mStopHandled = new AtomicBoolean(false);
    private VirtualDisplay mVirtualDisplay;
    private MediaProjection.Callback mProjectionCallback = new MediaProjection.Callback() {
        @Override
        public void onStop() {
            quit();
        }
    };

    private volatile HandlerThread mWorker;
    private volatile CallbackHandler mHandler;

    private Callback mCallback;
    private LinkedList<Integer> mPendingVideoEncoderBufferIndices = new LinkedList<>();
    private LinkedList<MediaCodec.BufferInfo> mPendingVideoEncoderBufferInfos = new LinkedList<>();

    /**
     * @param dpi for {@link VirtualDisplay}
     */
    public ScreenRecorder(VideoEncodeConfig video, int dpi, MediaProjection mp,
                          String dstPath) {
        mWidth = video.width;
        mHeight = video.height;
        mDpi = dpi;
        mMediaProjection = mp;
        mDstPath = dstPath;
        mVideoEncoder = new VideoEncoder(video);

    }

    /**
     * stop task
     */
    public final void quit() {
        quit(null);
    }

    final void quit(Throwable error) {
        CallbackHandler handler;
        synchronized (this) {
            mForceQuit.set(true);
            handler = mHandler;
            if (handler != null && !mIsRunning.get()) {
                // start() 已经排队但 record() 尚未执行时，直接取消启动消息。
                handler.removeMessages(MSG_START);
            }
        }
        if (handler == null) {
            finishStop(error, false);
        } else {
            signalStop(handler, false, error);
        }
    }

    public void updateDstPath(String dstPath) {
        mDstPath = dstPath;
    }

    public synchronized void start() {
        if (mWorker != null || mForceQuit.get() || mStopHandled.get()) {
            throw new IllegalStateException();
        }
        mWorker = new HandlerThread(TAG);
        mWorker.start();
        mHandler = new CallbackHandler(mWorker.getLooper());
        mHandler.sendEmptyMessage(MSG_START);
    }

    public void setCallback(Callback callback) {
        mCallback = callback;
    }

    public String getSavedPath() {
        return mDstPath;
    }

    /**
     * 仅用于录屏会话控制器确认编码线程是否仍在运行。
     */
    public boolean isRunning() {
        return mIsRunning.get();
    }

    interface Callback {
        void onStop(Throwable error);

        void onStart();

        void onRecording(long presentationTimeUs);
    }

    private static final int MSG_START = 0;
    private static final int MSG_STOP = 1;
    private static final int MSG_ERROR = 2;
    private static final int STOP_WITH_EOS = 1;

    private class CallbackHandler extends Handler {
        CallbackHandler(Looper looper) {
            super(looper);
        }

        @Override
        public void handleMessage(Message msg) {
            switch (msg.what) {
                case MSG_START:
                    try {
                        record();
                        if (mCallback != null) {
                            mCallback.onStart();
                        }
                    } catch (Throwable throwable) {
                        finishStop(throwable, false);
                    }
                    break;
                case MSG_STOP:
                case MSG_ERROR:
                    finishStop((Throwable) msg.obj, msg.arg1 == STOP_WITH_EOS);
                    break;
            }
        }
    }

    private void finishStop(Throwable error, boolean stopWithEOS) {
        if (!mStopHandled.compareAndSet(false, true)) {
            return;
        }
        Throwable stopError = error;
        try {
            stopEncoders();
            if (!stopWithEOS) {
                signalEndOfStream();
            }
        } catch (Throwable throwable) {
            if (stopError == null) {
                stopError = throwable;
            }
        }
        try {
            release();
        } catch (Throwable throwable) {
            if (stopError == null) {
                stopError = throwable;
            }
        }
        Callback callback = mCallback;
        if (callback != null) {
            // 回调只能在编码器、MediaProjection 和 muxer 全部最终化后触发一次。
            callback.onStop(stopError);
        }
    }

    private void signalEndOfStream() {
        MediaCodec.BufferInfo eos = new MediaCodec.BufferInfo();
        ByteBuffer buffer = ByteBuffer.allocate(0);
        eos.set(0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
        if (VERBOSE) LogUtil.i(TAG, "Signal EOS to muxer ");
        if (mVideoTrackIndex != INVALID_INDEX) {
            writeSampleData(mVideoTrackIndex, eos, buffer);
        }
        mVideoTrackIndex = INVALID_INDEX;
    }

    private void record() {
        if (mIsRunning.get() || mForceQuit.get()) {
            throw new IllegalStateException();
        }
        if (mMediaProjection == null) {
            throw new IllegalStateException("maybe release");
        }
        mIsRunning.set(true);

        mMediaProjection.registerCallback(mProjectionCallback, mHandler);
        try {
            // create muxer
            mMuxer = new MediaMuxer(mDstPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            // create encoder and input surface
            prepareVideoEncoder();
        } catch (IOException e) {
            throw new RuntimeException(e);
        }

        mVirtualDisplay = mMediaProjection.createVirtualDisplay(TAG + "-display",
                mWidth, mHeight, mDpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                mVideoEncoder.getInputSurface(), null, null);
        if (VERBOSE) LogUtil.d(TAG, "created virtual display: " + mVirtualDisplay.getDisplay());
    }

    private void muxVideo(int index, MediaCodec.BufferInfo buffer) {
        if (!mIsRunning.get()) {
            LogUtil.w(TAG, "muxVideo: Already stopped!");
            return;
        }
        if (!mMuxerStarted || mVideoTrackIndex == INVALID_INDEX) {
            mPendingVideoEncoderBufferIndices.add(index);
            mPendingVideoEncoderBufferInfos.add(buffer);
            return;
        }
        ByteBuffer encodedData = mVideoEncoder.getOutputBuffer(index);
        writeSampleData(mVideoTrackIndex, buffer, encodedData);
        mVideoEncoder.releaseOutputBuffer(index);
        if ((buffer.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
            if (VERBOSE)
                LogUtil.d(TAG, "Stop encoder and muxer, since the buffer has been marked with EOS");
            // send release msg
            mVideoTrackIndex = INVALID_INDEX;
            signalStop(true);
        }
    }




    private void writeSampleData(int track, MediaCodec.BufferInfo buffer, ByteBuffer encodedData) {
        if ((buffer.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
            // The codec config data was pulled out and fed to the muxer when we got
            // the INFO_OUTPUT_FORMAT_CHANGED status.
            // Ignore it.
            if (VERBOSE) LogUtil.d(TAG, "Ignoring BUFFER_FLAG_CODEC_CONFIG");
            buffer.size = 0;
        }
        boolean eos = (buffer.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
        if (buffer.size == 0 && !eos) {
            if (VERBOSE) LogUtil.d(TAG, "info.size == 0, drop it.");
            encodedData = null;
        } else {
            if (buffer.presentationTimeUs != 0) { // maybe 0 if eos
                if (track == mVideoTrackIndex) {
                    resetVideoPts(buffer);
                }
            }
            if (VERBOSE)
                LogUtil.d(TAG, "[" + Thread.currentThread().getId() + "] Got buffer, track=" + track
                        + ", info: size=" + buffer.size
                        + ", presentationTimeUs=" + buffer.presentationTimeUs);
            if (!eos && mCallback != null) {
                mCallback.onRecording(buffer.presentationTimeUs);
            }
        }
        if (encodedData != null) {

            encodedData.position(buffer.offset);
            encodedData.limit(buffer.offset + buffer.size);
            mMuxer.writeSampleData(track, encodedData, buffer);
            if (VERBOSE)
                LogUtil.i(TAG, "Sent " + buffer.size + " bytes to MediaMuxer on track " + track);
        }
    }

    private long mVideoPtsOffset;


    private void resetVideoPts(MediaCodec.BufferInfo buffer) {
        if (mVideoPtsOffset == 0) {
            mVideoPtsOffset = buffer.presentationTimeUs;
            buffer.presentationTimeUs = 0;
        } else {
            buffer.presentationTimeUs -= mVideoPtsOffset;
        }
    }

    private void resetVideoOutputFormat(MediaFormat newFormat) {
        // should happen before receiving buffers, and should only happen once
        if (mVideoTrackIndex >= 0 || mMuxerStarted) {
            throw new IllegalStateException("output format already changed!");
        }
        if (VERBOSE)
            LogUtil.i(TAG, "Video output format changed.\n New format: " + newFormat.toString());
        mVideoOutputFormat = newFormat;
    }

    private void resetAudioOutputFormat(MediaFormat newFormat) {
        // should happen before receiving buffers, and should only happen once
        if ( mMuxerStarted) {
            throw new IllegalStateException("output format already changed!");
        }
        if (VERBOSE)
            LogUtil.i(TAG, "Audio output format changed.\n New format: " + newFormat.toString());

    }

    private void startMuxerIfReady() {
        if (mMuxerStarted || mVideoOutputFormat == null
                ) {
            return;
        }

        mVideoTrackIndex = mMuxer.addTrack(mVideoOutputFormat);

        mMuxer.start();
        mMuxerStarted = true;
        if (VERBOSE) LogUtil.i(TAG, "Started media muxer, videoIndex=" + mVideoTrackIndex);
        if (mPendingVideoEncoderBufferIndices.isEmpty()) {
            return;
        }
        if (VERBOSE) LogUtil.i(TAG, "Mux pending video output buffers...");
        MediaCodec.BufferInfo info;
        while ((info = mPendingVideoEncoderBufferInfos.poll()) != null) {
            int index = mPendingVideoEncoderBufferIndices.poll();
            muxVideo(index, info);
        }

        if (VERBOSE) LogUtil.i(TAG, "Mux pending video output buffers done.");
    }



    // @WorkerThread
    private void prepareVideoEncoder() throws IOException {
        VideoEncoder.Callback callback = new VideoEncoder.Callback() {
            boolean ranIntoError = false;

            @Override
            public void onOutputBufferAvailable(BaseEncoder codec, int index, MediaCodec.BufferInfo info) {
                if (VERBOSE) LogUtil.i(TAG, "VideoEncoder output buffer available: index=" + index);
                try {
                    muxVideo(index, info);
                } catch (Exception e) {
                    LogUtil.e(TAG, "Muxer encountered an error! ", e);
                    Message.obtain(mHandler, MSG_ERROR, e).sendToTarget();
                }
            }

            @Override
            public void onError(Encoder codec, Exception e) {
                ranIntoError = true;
                LogUtil.e(TAG, "VideoEncoder ran into an error! ", e);
                Message.obtain(mHandler, MSG_ERROR, e).sendToTarget();
            }

            @Override
            public void onOutputFormatChanged(BaseEncoder codec, MediaFormat format) {
                resetVideoOutputFormat(format);
                startMuxerIfReady();
            }
        };
        mVideoEncoder.setCallback(callback);
        mVideoEncoder.prepare();
    }

    private void signalStop(boolean stopWithEOS) {
        CallbackHandler handler = mHandler;
        if (handler == null) {
            finishStop(null, stopWithEOS);
            return;
        }
        signalStop(handler, stopWithEOS);
    }

    private void signalStop(CallbackHandler handler, boolean stopWithEOS) {
        signalStop(handler, stopWithEOS, null);
    }

    private void signalStop(CallbackHandler handler, boolean stopWithEOS, Throwable error) {
        if (!mStopSignalled.compareAndSet(false, true)) {
            return;
        }
        Message msg = Message.obtain(handler, MSG_STOP,
                stopWithEOS ? STOP_WITH_EOS : 0, 0);
        msg.obj = error;
        handler.sendMessageAtFrontOfQueue(msg);
    }

    private void stopEncoders() {
        mIsRunning.set(false);

        mPendingVideoEncoderBufferInfos.clear();
        mPendingVideoEncoderBufferIndices.clear();
        // maybe called on an error has been occurred
        try {
            if (mVideoEncoder != null) mVideoEncoder.stop();
        } catch (IllegalStateException e) {
            // ignored
        }


    }

    private void release() {
        Throwable releaseError = null;
        if (mMediaProjection != null) {
            try {
                mMediaProjection.unregisterCallback(mProjectionCallback);
            } catch (Throwable throwable) {
                releaseError = throwable;
            }
        }
        if (mVirtualDisplay != null) {
            try {
                mVirtualDisplay.release();
            } catch (Throwable throwable) {
                if (releaseError == null) {
                    releaseError = throwable;
                }
            }
            mVirtualDisplay = null;
        }


        mMuxerStarted = false;

        if (mWorker != null) {
            try {
                mWorker.quitSafely();
            } catch (Throwable throwable) {
                if (releaseError == null) {
                    releaseError = throwable;
                }
            }
            mWorker = null;
        }
        if (mVideoEncoder != null) {
            try {
                mVideoEncoder.release();
            } catch (Throwable throwable) {
                if (releaseError == null) {
                    releaseError = throwable;
                }
            }
            mVideoEncoder = null;
        }


        if (mMediaProjection != null) {
            try {
                mMediaProjection.stop();
            } catch (Throwable throwable) {
                if (releaseError == null) {
                    releaseError = throwable;
                }
            }
            mMediaProjection = null;
        }
        if (mMuxer != null) {
            try {
                mMuxer.stop();
            } catch (Throwable throwable) {
                if (releaseError == null) {
                    releaseError = throwable;
                }
            }
            try {
                mMuxer.release();
            } catch (Throwable throwable) {
                if (releaseError == null) {
                    releaseError = throwable;
                }
            }
            mMuxer = null;
        }
        mHandler = null;
        if (releaseError instanceof RuntimeException) {
            throw (RuntimeException) releaseError;
        }
        if (releaseError != null) {
            throw new RuntimeException(releaseError);
        }
    }

    @Override
    protected void finalize() throws Throwable {
        if (mMediaProjection != null) {
            LogUtil.e(TAG, "release() not called!");
            release();
        }
    }

}
