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
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.MediaCodecInfo;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.preference.PreferenceManager;
import android.util.Range;
import android.util.Rational;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.SpinnerAdapter;

import com.alipay.hulu.R;
import com.alipay.hulu.activity.BaseActivity;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.ui.HeadControlPanel;
import com.alipay.hulu.util.VideoUtils;

import java.lang.reflect.Field;
import java.util.Arrays;


@TargetApi(value = Build.VERSION_CODES.LOLLIPOP)
public class RecorderConfigActivity extends BaseActivity {

    private static final String TAG = RecorderConfigActivity.class.getSimpleName();
    private static final int REQUEST_MEDIA_PROJECTION = 1;

    private MediaProjectionManager mMediaProjectionManager;
    private MediaCodecInfo[] mAvcCodecInfo;

    private TextSpinner mVideoResolution;
    private TextSpinner mVideoFrameRate;
    private TextSpinner mVideoBitrate;
    private TextSpinner mVideoCodec;

    private HeadControlPanel mPanel;

    private Button mStartBtn;
    private TextSpinner mVideoExceptDiff;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_record_config);

        initViews();

        mMediaProjectionManager = (MediaProjectionManager) getApplicationContext().getSystemService(MEDIA_PROJECTION_SERVICE);

        VideoUtils.findEncodersByTypeAsync(ScreenRecorder.VIDEO_AVC, new VideoUtils.Callback() {
            @Override
            public void onResult(MediaCodecInfo[] infos) {
                logCodecInfos(infos, ScreenRecorder.VIDEO_AVC);
                mAvcCodecInfo = infos;
                SpinnerAdapter codecsAdapter = createCodecsAdapter(mAvcCodecInfo);
                mVideoCodec.setAdapter(codecsAdapter);
                restoreSelections(mVideoCodec, mVideoResolution, mVideoFrameRate, mVideoBitrate);
            }
        });
    }


    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_MEDIA_PROJECTION && resultCode == RESULT_OK) {
            Intent intent = new Intent(this, RecordService.class);
            intent.setAction(RecordService.ACTION_INIT);
            intent.putExtra(RecordService.INTENT_RESULT_CODE, resultCode);
            intent.putExtra(RecordService.INTENT_VIDEO_CODEC, getSelectedVideoCodec());
            intent.putExtra(RecordService.INTENT_FRAME_RATE, getSelectedFramerate());
            intent.putExtra(RecordService.INTENT_VIDEO_BITRATE, getSelectedVideoBitrate());
            intent.putExtra(RecordService.INTENT_EXCEPT_DIFF, getSelectedVideoDiff());
            int[] widthAndHeigth = getSelectedWidthHeight();
            intent.putExtra(RecordService.INTENT_WIDTH, widthAndHeigth[1]);
            intent.putExtra(RecordService.INTENT_HEIGHT, widthAndHeigth[0]);
            intent.putExtras(data);
            startService(intent);
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        saveSelections();
    }

    private void initViews() {

        mPanel = (HeadControlPanel) findViewById(R.id.info_head);
        mPanel.setMiddleTitle("录屏设置");
        mPanel.setBackIconClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });

        mStartBtn = (Button) findViewById(R.id.btn_start);
        mStartBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (checkVideoSettings()) {
                    startWindow(v);
                } else {
                    toastShort("视频参数不支持");
                }
            }
        });

        mVideoCodec = (TextSpinner) findViewById(R.id.spinner_video_codec);
        mVideoResolution = (TextSpinner) findViewById(R.id.spinner_resolution);
        mVideoFrameRate = (TextSpinner) findViewById(R.id.spinner_framerate);
        mVideoBitrate = (TextSpinner) findViewById(R.id.spinner_video_bitrate);
        mVideoExceptDiff = (TextSpinner) findViewById(R.id.spinner_except_diff);

        mVideoCodec.setOnItemSelectedListener(new TextSpinner.OnItemSelectedListener() {
            @Override
            public void onItemSelected(TextSpinner view, int position) {
                onVideoCodecSelected((String) view.getSelectedItem());
            }
        });

        mVideoResolution.setOnItemSelectedListener(new TextSpinner.OnItemSelectedListener() {
            @Override
            public void onItemSelected(TextSpinner view, int position) {
                if (position == 0) {
                    return;
                }
                onResolutionChanged(position, (String) view.getSelectedItem());
            }
        });

        mVideoFrameRate.setOnItemSelectedListener(new TextSpinner.OnItemSelectedListener() {
            @Override
            public void onItemSelected(TextSpinner view, int position) {
                if (position == 0) {
                    return;
                }
                onFramerateChanged(position, (String) view.getSelectedItem());
            }
        });
        mVideoBitrate.setOnItemSelectedListener(new TextSpinner.OnItemSelectedListener() {
            @Override
            public void onItemSelected(TextSpinner view, int position) {
                if (position == 0) {
                    return;
                }
                onBitrateChanged(position, (String) view.getSelectedItem());
            }
        });
        mVideoExceptDiff.setOnItemSelectedListener(new TextSpinner.OnItemSelectedListener() {
            @Override
            public void onItemSelected(TextSpinner view, int position) {
                if (position == 0) {
                    return;
                }
                onExceptDiffChanged(position, (String) view.getSelectedItem());
            }
        });
    }


    private boolean checkVideoSettings() {
        String codecName = getSelectedVideoCodec();
        MediaCodecInfo codec = getVideoCodecInfo(codecName);

        if (codec == null) {
            return false;
        }

        MediaCodecInfo.CodecCapabilities capabilities = codec.getCapabilitiesForType(ScreenRecorder.VIDEO_AVC);
        MediaCodecInfo.VideoCapabilities videoCapabilities = capabilities.getVideoCapabilities();

        LogUtil.i(TAG, "checkVideoSettings, 当前codec: " + codecName);

        int[] heightAndWidth = getSelectedWidthHeight();
        if (heightAndWidth.length != 2) {
            return false;
        }

        int height = heightAndWidth[0];
        int width = heightAndWidth[1];

        LogUtil.i(TAG, "checkVideoSettings, width: " + width + " height: " + height);

        double frameRate = getSelectedFramerate();
        int bitrate = getSelectedVideoBitrate();

        LogUtil.i(TAG, "checkVideoSettings, frameRate: " + frameRate);
        LogUtil.i(TAG, "checkVideoSettings, bitrate" + bitrate);

        if (!videoCapabilities.areSizeAndRateSupported(width, height, frameRate)) {
            LogUtil.i(TAG, "checkVideoSettings, size not supported!!!");

            LogUtil.i(TAG, "checkVideoSettings, widthAlignment: " + videoCapabilities.getWidthAlignment()
                    + " heightAlignment: " + videoCapabilities.getHeightAlignment());

            LogUtil.i(TAG, "checkVideoSettings, bitrate range: " + videoCapabilities.getBitrateRange());

            try {
                LogUtil.i(TAG, "supported heights for width" + width + " is :" + videoCapabilities.getSupportedHeightsFor(width));
            } catch (Exception e) {
                LogUtil.e(TAG, e.getMessage());
            }

            try {
                LogUtil.i(TAG, "supported widths for height" + height + " is :" + videoCapabilities.getSupportedWidthsFor(height));
            } catch (Exception e) {
                LogUtil.e(TAG, e.getMessage());
            }

            try {
                LogUtil.i(TAG, "checkVideoSettings, frameRates: " + videoCapabilities.getSupportedFrameRatesFor(width, height));
            } catch (Exception e) {
                LogUtil.e(TAG, e.getMessage());
            }

            try {

                Field limit = MediaCodecInfo.VideoCapabilities.class.getDeclaredField("mSmallerDimensionUpperLimit");
                Field blockWidth = MediaCodecInfo.VideoCapabilities.class.getDeclaredField("mBlockWidth");
                Field blockHeight = MediaCodecInfo.VideoCapabilities.class.getDeclaredField("mBlockHeight");
                Field blockCountRange =  MediaCodecInfo.VideoCapabilities.class.getDeclaredField("mBlockCountRange");
                Field aspectRatioRange = MediaCodecInfo.VideoCapabilities.class.getDeclaredField("mAspectRatioRange");
                Field blockAspectRatioRange = MediaCodecInfo.VideoCapabilities.class.getDeclaredField("mBlockAspectRatioRange");
                Field blocksPerSecondRange = MediaCodecInfo.VideoCapabilities.class.getDeclaredField("mBlocksPerSecondRange");

                limit.setAccessible(true);
                blockWidth.setAccessible(true);
                blockHeight.setAccessible(true);
                blockCountRange.setAccessible(true);
                aspectRatioRange.setAccessible(true);
                blockAspectRatioRange.setAccessible(true);
                blocksPerSecondRange.setAccessible(true);
                int smallerDimensionUpperLimit = (int) limit.get(videoCapabilities);
                int blockWidthVal = (int) blockWidth.get(videoCapabilities);
                int blockHeightVal = (int) blockHeight.get(videoCapabilities);
                Range<Integer> blockCountRangeVal = (Range<Integer>) blockCountRange.get(videoCapabilities);
                Range<Rational> aspectRatioRangeVal = (Range<Rational>) aspectRatioRange.get(videoCapabilities);
                Range<Rational> blockAspectRatioRangeVal = (Range<Rational>) blockAspectRatioRange.get(videoCapabilities);
                Range<Long> blocksPerSecondRangeVal = (Range<Long>) blocksPerSecondRange.get(videoCapabilities);

                LogUtil.e(TAG, "limit: " + smallerDimensionUpperLimit + "\n"
                        + "blockWidth: " + blockWidthVal + "\n"
                        + "blockHeight: " + blockHeightVal + "\n"
                        + "blockCountRange: " + blockCountRangeVal + "\n"
                        + "aspectRatioRange: " + aspectRatioRangeVal + "\n"
                        + "blockAspectRatioRange: " + blockAspectRatioRangeVal + "\n"
                        + "blocksPerSecondRange: " + blocksPerSecondRangeVal);

            } catch (NoSuchFieldException e) {
                LogUtil.e(TAG, e.getMessage());
            } catch (IllegalAccessException e) {
                LogUtil.e(TAG, e.getMessage());
            }
            return false;
        }

        return true;
    }


    private void onResolutionChanged(int selectedPosition, String resolution) {
        String codecName = getSelectedVideoCodec();
        MediaCodecInfo codec = getVideoCodecInfo(codecName);
        if (codec == null) return;
        MediaCodecInfo.CodecCapabilities capabilities = codec.getCapabilitiesForType(ScreenRecorder.VIDEO_AVC);
        MediaCodecInfo.VideoCapabilities videoCapabilities = capabilities.getVideoCapabilities();
        String[] xes = resolution.split("x");
        if (xes.length != 2) throw new IllegalArgumentException();
        int width = Integer.parseInt(xes[1]);
        int height = Integer.parseInt(xes[0]);

        double selectedFramerate = getSelectedFramerate();
        int resetPos = Math.max(selectedPosition - 1, 0);
        if (!videoCapabilities.isSizeSupported(width, height)) {
            mVideoResolution.setSelectedPosition(resetPos);
            toastShort("codec '%s' unsupported size %dx%d ",
                    codecName, width, height);
            LogUtil.w(TAG, codecName +
                    " height range: " + videoCapabilities.getSupportedHeights() +
                    "\n width range: " + videoCapabilities.getSupportedHeights());
        } else if (!videoCapabilities.areSizeAndRateSupported(width, height, selectedFramerate)) {
            mVideoResolution.setSelectedPosition(resetPos);
            toastShort("codec '%s' unsupported size %dx%d\nwith framerate %d",
                    codecName, width, height, (int) selectedFramerate);
        }
    }

    private void onBitrateChanged(int selectedPosition, String bitrate) {
        String codecName = getSelectedVideoCodec();
        MediaCodecInfo codec = getVideoCodecInfo(codecName);
        if (codec == null) return;
        MediaCodecInfo.CodecCapabilities capabilities = codec.getCapabilitiesForType(ScreenRecorder.VIDEO_AVC);
        MediaCodecInfo.VideoCapabilities videoCapabilities = capabilities.getVideoCapabilities();
        int selectedBitrate = Integer.parseInt(bitrate) * 1000;

        int resetPos = Math.max(selectedPosition - 1, 0);
        if (!videoCapabilities.getBitrateRange().contains(selectedBitrate)) {
            mVideoBitrate.setSelectedPosition(resetPos);
            toastShort("codec '%s' unsupported bitrate %d", codecName, selectedBitrate);
            LogUtil.w(TAG, codecName +
                    " bitrate range: " + videoCapabilities.getBitrateRange());
        }
    }

    private void onExceptDiffChanged(int selectedPosition, String diff) {
        mVideoExceptDiff.setSelectedPosition(selectedPosition);
    }


    private void onFramerateChanged(int selectedPosition, String rate) {
        String codecName = getSelectedVideoCodec();
        MediaCodecInfo codec = getVideoCodecInfo(codecName);
        if (codec == null) return;
        MediaCodecInfo.CodecCapabilities capabilities = codec.getCapabilitiesForType(ScreenRecorder.VIDEO_AVC);
        MediaCodecInfo.VideoCapabilities videoCapabilities = capabilities.getVideoCapabilities();
        int[] selectedWithHeight = getSelectedWidthHeight();
        int selectedFramerate = Integer.parseInt(rate);
        int width = selectedWithHeight[1];
        int height = selectedWithHeight[0];

        int resetPos = Math.max(selectedPosition - 1, 0);
        if (!videoCapabilities.getSupportedFrameRates().contains(selectedFramerate)) {
            mVideoFrameRate.setSelectedPosition(resetPos);
            toastShort("codec '%s' unsupported framerate %d", codecName, selectedFramerate);
        } else if (!videoCapabilities.areSizeAndRateSupported(width, height, selectedFramerate)) {
            mVideoFrameRate.setSelectedPosition(resetPos);
            toastShort("codec '%s' unsupported size %dx%d\nwith framerate %d",
                    codecName, width, height, selectedFramerate);
        }
    }

    private void onVideoCodecSelected(String codecName) {
        MediaCodecInfo codec = getVideoCodecInfo(codecName);
        if (codec == null) {
            return;
        }
        MediaCodecInfo.CodecCapabilities capabilities = codec.getCapabilitiesForType(ScreenRecorder.VIDEO_AVC);
        //todo
    }


    private MediaCodecInfo getVideoCodecInfo(String codecName) {
        if (codecName == null) {
            return null;
        }
        if (mAvcCodecInfo == null) {
            mAvcCodecInfo = VideoUtils.findEncodersByType(ScreenRecorder.VIDEO_AVC);
        }
        MediaCodecInfo codec = null;
        for (int i = 0; i < mAvcCodecInfo.length; i++) {
            MediaCodecInfo info = mAvcCodecInfo[i];
            if (info.getName().equals(codecName)) {
                codec = info;
                break;
            }
        }
        if (codec == null) {
            return null;
        }
        return codec;
    }


    private String getSelectedVideoCodec() {
        return mVideoCodec == null ? null : (String) mVideoCodec.getSelectedItem();
    }

    private SpinnerAdapter createCodecsAdapter(MediaCodecInfo[] codecInfos) {
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, codecInfoNames(codecInfos));
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        return adapter;
    }


    private int getSelectedFramerate() {
        if (mVideoFrameRate == null) {
            throw new IllegalStateException();
        }
        return Integer.parseInt((String) mVideoFrameRate.getSelectedItem());
    }

    private int getSelectedVideoBitrate() {
        if (mVideoBitrate == null) {
            throw new IllegalStateException();
        }
        String selectedItem = mVideoBitrate.getSelectedItem();
        return Integer.parseInt(selectedItem) * 1000;
    }

    private double getSelectedVideoDiff() {
        if (mVideoExceptDiff == null) {
            throw new IllegalStateException();
        }
        String selectedItem = mVideoExceptDiff.getSelectedItem();
        return Double.parseDouble(selectedItem);
    }


    private int[] getSelectedWidthHeight() {
        if (mVideoResolution == null)  {
            throw new IllegalStateException();
        }
        String selected = mVideoResolution.getSelectedItem();
        String[] xes = selected.split("x");
        if (xes.length != 2) {
            throw new IllegalArgumentException();
        }
        return new int[]{Integer.parseInt(xes[0]), Integer.parseInt(xes[1])};
    }

    private static String[] codecInfoNames(MediaCodecInfo[] codecInfos) {
        String[] names = new String[codecInfos.length];
        for (int i = 0; i < codecInfos.length; i++) {
            names[i] = codecInfos[i].getName();
        }
        return names;
    }

    private static void logCodecInfos(MediaCodecInfo[] codecInfos, String mimeType) {
        for (MediaCodecInfo info : codecInfos) {
            StringBuilder builder = new StringBuilder(512);
            MediaCodecInfo.CodecCapabilities caps = info.getCapabilitiesForType(mimeType);
            builder.append("Encoder '").append(info.getName()).append('\'')
                    .append("\n  supported : ")
                    .append(Arrays.toString(info.getSupportedTypes()));
            MediaCodecInfo.VideoCapabilities videoCaps = caps.getVideoCapabilities();
            if (videoCaps != null) {
                builder.append("\n  Video capabilities:")
                        .append("\n  Widths: ").append(videoCaps.getSupportedWidths())
                        .append("\n  Heights: ").append(videoCaps.getSupportedHeights())
                        .append("\n  Frame Rates: ").append(videoCaps.getSupportedFrameRates())
                        .append("\n  Bitrate: ").append(videoCaps.getBitrateRange());
                if (ScreenRecorder.VIDEO_AVC.equals(mimeType)) {
                    MediaCodecInfo.CodecProfileLevel[] levels = caps.profileLevels;

                    builder.append("\n  Profile-levels: ");
                    for (MediaCodecInfo.CodecProfileLevel level : levels) {
                        builder.append("\n  ").append(VideoUtils.avcProfileLevelToString(level));
                    }
                }
                builder.append("\n  Color-formats: ");
                for (int c : caps.colorFormats) {
                    builder.append("\n  ").append(VideoUtils.toHumanReadable(c));
                }
            }
            MediaCodecInfo.AudioCapabilities audioCaps = caps.getAudioCapabilities();
            if (audioCaps != null) {
                builder.append("\n Audio capabilities:")
                        .append("\n Sample Rates: ").append(Arrays.toString(audioCaps.getSupportedSampleRates()))
                        .append("\n Bit Rates: ").append(audioCaps.getBitrateRange())
                        .append("\n Max channels: ").append(audioCaps.getMaxInputChannelCount());
            }
            LogUtil.i(TAG, builder.toString());
        }
    }

    private void restoreSelections(TextSpinner... spinners) {
        SharedPreferences preferences =
                PreferenceManager.getDefaultSharedPreferences(getApplicationContext());
        for (TextSpinner spinner : spinners) {
            restoreSelectionFromPreferences(preferences, spinner);
        }
    }

    private void saveSelections() {
        SharedPreferences preferences =
                PreferenceManager.getDefaultSharedPreferences(getApplicationContext());
        SharedPreferences.Editor edit = preferences.edit();
        for (TextSpinner spinner : new TextSpinner[]{
                mVideoResolution,
                mVideoFrameRate,
                mVideoBitrate,
                mVideoCodec,

        }) {
            saveSelectionToPreferences(edit, spinner);
        }
    }

    private void saveSelectionToPreferences(SharedPreferences.Editor preferences, TextSpinner spinner) {
        int resId = spinner.getId();
        String key = getResources().getResourceEntryName(resId);
        int selectedItemPosition = spinner.getSelectedItemPosition();
        if (selectedItemPosition >= 0) {
            preferences.putInt(key, selectedItemPosition);
        }
    }

    private void restoreSelectionFromPreferences(SharedPreferences preferences, TextSpinner spinner) {
        int resId = spinner.getId();
        String key = getResources().getResourceEntryName(resId);
        int value = preferences.getInt(key, -1);
        if (value >= 0 && spinner.getAdapter() != null) {
            spinner.setSelectedPosition(value);
        }
    }

    public void startWindow(View v) {
        // 检查adb和悬浮窗权限
        PermissionUtil.requestPermissions(Arrays.asList("float", "adb"), this, new PermissionUtil.OnPermissionCallback() {
            @Override
            public void onPermissionResult(boolean result, String reason) {
                if (result) {
                    Intent captureIntent = mMediaProjectionManager.createScreenCaptureIntent();
                    startActivityForResult(captureIntent, REQUEST_MEDIA_PROJECTION);
                }
            }
        });
    }
}