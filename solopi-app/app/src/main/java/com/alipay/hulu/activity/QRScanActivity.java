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
package com.alipay.hulu.activity;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.PointF;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.injector.provider.Provider;
import com.alipay.hulu.common.scheme.SchemeActivity;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.event.HandlePermissionEvent;
import com.alipay.hulu.event.ScanSuccessEvent;
import com.alipay.hulu.scheme.ScanSchemeResolver;
import com.alipay.hulu.shared.scan.ScanCodeType;
import com.alipay.hulu.ui.AnyCodeReaderView;
import com.google.android.material.snackbar.Snackbar;
import com.google.zxing.BarcodeFormat;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;


/**
 * Created by lezhou.wyl on 2018/2/6.
 */
@Provider({@Param(type = ScanSuccessEvent.class, sticky = false),
        @Param(type = HandlePermissionEvent.class, sticky = false)})
public class QRScanActivity extends BaseActivity
        implements ActivityCompat.OnRequestPermissionsResultCallback, AnyCodeReaderView.OnCodeReadListener {
    private static final String TAG = "QRScanActivity";

    public static final String KEY_SCAN_TYPE = "KEY_SCAN_TYPE";
    public static final String KEY_PROTOCOL_SESSION_ID = "KEY_PROTOCOL_SESSION_ID";
    public static final String KEY_PROTOCOL_GENERATION = "KEY_PROTOCOL_GENERATION";

    private static final int MY_PERMISSION_REQUEST_CAMERA = 0;

    private ViewGroup mainLayout;

    private TextView resultTextView;
    private TextView resultTypeText;
    private AnyCodeReaderView anyCodeReaderView;
    private volatile boolean isQRCodeReadListenerEnabled = false;

    private InjectorService injectorService;

    private int curScanType;
    private long lastReadTime = 0;
    private String protocolSessionId;
    private long protocolGeneration = -1L;
    private boolean protocolSession;
    private boolean scanReservationAcquired;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Intent scanIntent = getIntent();
        if (scanIntent != null) {
            protocolSessionId = scanIntent.getStringExtra(KEY_PROTOCOL_SESSION_ID);
            protocolGeneration = scanIntent.getLongExtra(KEY_PROTOCOL_GENERATION, -1L);
        }
        protocolSession = StringUtil.isNotEmpty(protocolSessionId)
                && protocolGeneration >= 0L;
        scanReservationAcquired = protocolSession
                ? ScanSchemeResolver.attachProtocolActivity(
                        this, protocolSessionId, protocolGeneration)
                : ScanSchemeResolver.attachManualActivity(this);
        if (!scanReservationAcquired) {
            finish();
            return;
        }

        setContentView(R.layout.activity_scan);
        injectorService = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());

        mainLayout = (ViewGroup) findViewById(R.id.main_layout);


        if (scanIntent != null) {
            curScanType = scanIntent.getIntExtra(KEY_SCAN_TYPE, 0);
        }

        //发送尝试处理权限弹窗的广播，OPPO R9s等手机明明没有权限仍然返回的是granted...
        injectorService.pushMessage(null, new HandlePermissionEvent());

        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED) {
            initQRCodeReaderView();
        } else {
            requestCameraPermission();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        enableQRCodeReadListener();
    }

    private void enableQRCodeReadListener() {
        if (anyCodeReaderView != null) {
            isQRCodeReadListenerEnabled = true;
            anyCodeReaderView.startCamera();
            anyCodeReaderView.setOnCodeReadListener(this);
        }
    }

    private void disableQRCodeReadListener() {
        if (anyCodeReaderView != null) {
            isQRCodeReadListenerEnabled = false;
            anyCodeReaderView.stopCamera();
            anyCodeReaderView.setOnCodeReadListener(null);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        disableQRCodeReadListener();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        if (requestCode != MY_PERMISSION_REQUEST_CAMERA) {
            return;
        }

        if (grantResults.length == 1 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            Snackbar.make(mainLayout, "Camera permission was granted.", Snackbar.LENGTH_SHORT).show();
            initQRCodeReaderView();
        } else {
            Snackbar.make(mainLayout, "Camera permission request was denied.", Snackbar.LENGTH_SHORT)
                    .show();
            if (protocolSession) {
                ScanSchemeResolver.markFailed(protocolSessionId, protocolGeneration,
                        "Camera permission was denied");
                finish();
            }
        }
    }

    @Override
    public void onCodeRead(BarcodeFormat format, String text, PointF[] points) {
        LogUtil.d(TAG, "OnQrCodeRead");
        if (!isQRCodeReadListenerEnabled) {
            return;
        }

        resultTextView.setText(text);
        resultTypeText.setText(format.toString());

        // 过滤不可用的类型
        ScanCodeType acceptType = ScanCodeType.getByFormat(format);
        if (acceptType == null) {
            LogUtil.w(TAG, "Can't process code of type::" + format);
            enableQRCodeReadListener();
            return;
        }

        disableQRCodeReadListener();

        if (StringUtil.isEmpty(text)) {
            enableQRCodeReadListener();
            return;
        }

        long curTime = System.currentTimeMillis();
        if (curTime - lastReadTime < 2000) {
            enableQRCodeReadListener();
            return;
        }

        lastReadTime = curTime;

        if (protocolSession) {
            boolean completed = ScanSchemeResolver.onScanCompleted(
                    protocolSessionId,
                    protocolGeneration,
                    text,
                    format.name(),
                    acceptType.getCode());
            if (completed) {
                finish();
            } else {
                enableQRCodeReadListener();
            }
            return;
        }

        if (curScanType == ScanSuccessEvent.SCAN_TYPE_SCHEME
                || curScanType == ScanSuccessEvent.SCAN_TYPE_QR_CODE
                || curScanType == ScanSuccessEvent.SCAN_TYPE_BAR_CODE) {
            notifyScanSuccess(text, acceptType);
        } else if (curScanType == ScanSuccessEvent.SCAN_TYPE_PARAM) {
            if (StringUtil.startWith(text, "http://") || StringUtil.startWith(text, "https://")) {
                notifyScanSuccess(text, acceptType);
            } else {
                resultTextView.setText(getString(R.string.qr_scan__url_not_support, text));
                enableQRCodeReadListener();
            }
        } else {
            resultTextView.setText(text);
            if (StringUtil.startWith(text, "http")) {
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setData(Uri.parse(text));
                startActivity(intent);
                finish();
            } else if (StringUtil.startWith(text, "solopi://")) {
                Intent intent = new Intent(this, SchemeActivity.class);
                intent.setData(Uri.parse(text));
                startActivity(intent);
                finish();
            } else {
                enableQRCodeReadListener();
            }
        }
    }

    @Override
    protected void onDestroy() {
        if (scanReservationAcquired) {
            if (protocolSession) {
                ScanSchemeResolver.onProtocolActivityDestroyed(
                        this, protocolSessionId, protocolGeneration);
            } else {
                ScanSchemeResolver.releaseManualActivity(this);
            }
            scanReservationAcquired = false;
        }
        if (injectorService != null) {
            injectorService.unregister(this);
            injectorService = null;
        }

        super.onDestroy();
    }

    /**
     * 发送成功消息
     */
    public void notifyScanSuccess(String text, ScanCodeType codeType) {
        ScanSuccessEvent event = new ScanSuccessEvent();
        event.setContent(text);
        event.setCodeType(codeType);
        event.setType(curScanType);
        injectorService.pushMessage(null, event);
        finish();
    }

    private void requestCameraPermission() {
        if (protocolSession) {
            ScanSchemeResolver.onCameraPermissionRequired(
                    protocolSessionId, protocolGeneration);
        }
        if (ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.CAMERA)) {
            Snackbar.make(mainLayout, R.string.qr__camera_permission,
                    Snackbar.LENGTH_INDEFINITE).setAction(R.string.constant__yes, new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    ActivityCompat.requestPermissions(QRScanActivity.this, new String[]{
                            Manifest.permission.CAMERA
                    }, MY_PERMISSION_REQUEST_CAMERA);
                }
            }).show();
        } else {
            Snackbar.make(mainLayout, R.string.qr__requst_permission,
                    Snackbar.LENGTH_SHORT).show();
            ActivityCompat.requestPermissions(this, new String[]{
                    Manifest.permission.CAMERA
            }, MY_PERMISSION_REQUEST_CAMERA);
        }
    }

    private void initQRCodeReaderView() {
        try {
            View content = getLayoutInflater().inflate(R.layout.content_decoder, mainLayout, true);

            anyCodeReaderView = content.findViewById(R.id.anydecoderview);
            resultTextView = (TextView) content.findViewById(R.id.result_text_view);
            resultTypeText = content.findViewById(R.id.result_type_text);

            anyCodeReaderView.setAutofocusInterval(2000L);
            anyCodeReaderView.setOnCodeReadListener(this);
            anyCodeReaderView.setBackCamera();
            anyCodeReaderView.startCamera();

            enableQRCodeReadListener();
            if (protocolSession) {
                ScanSchemeResolver.onScanReady(protocolSessionId, protocolGeneration);
            }
        } catch (RuntimeException exception) {
            LogUtil.e(TAG, "Unable to initialize camera scanner", exception);
            if (protocolSession) {
                ScanSchemeResolver.markFailed(protocolSessionId, protocolGeneration,
                        "Unable to initialize camera scanner: " + exception.getMessage());
                finish();
            } else {
                throw exception;
            }
        }
    }
}
