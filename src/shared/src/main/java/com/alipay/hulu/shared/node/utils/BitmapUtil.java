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
package com.alipay.hulu.shared.node.utils;

import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Base64;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.utils.LogUtil;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.WriterException;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/**
 * Base64和Bitmap相互转换类
 */
public class BitmapUtil {
    private static final String TAG = BitmapUtil.class.getSimpleName();

    /**
     * bitmap转为base64
     *
     * @param bitmap
     * @return
     */
    public static String bitmapToBase64(Bitmap bitmap) {

        String result = null;
        ByteArrayOutputStream baos = null;
        try {
            if (bitmap != null) {
                baos = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.JPEG, 100, baos);

                baos.flush();
                baos.close();

                byte[] bitmapBytes = baos.toByteArray();
                result = Base64.encodeToString(bitmapBytes, Base64.DEFAULT);
            }
        } catch (IOException e) {
            e.printStackTrace();
        } finally {
            try {
                if (baos != null) {
                    baos.flush();
                    baos.close();
                }
            } catch (IOException e) {
                e.printStackTrace();
            }
        }
        return result;
    }

    /**
     * 解析base64资源
     * @param base64Data
     * @return
     */
    public static byte[] decodeBase64(String base64Data) {
        if (base64Data == null) {
            return null;
        }

        return Base64.decode(base64Data, Base64.DEFAULT);
    }

    /**
     * Bitmap转byte数组
     * @param bitmap
     * @return
     */
    public static byte[] bitmapToByte(Bitmap bitmap) {
        String result = null;
        ByteArrayOutputStream baos = null;
        try {
            if (bitmap != null) {
                baos = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.JPEG, 100, baos);

                baos.flush();
                baos.close();

                return baos.toByteArray();
            }
        } catch (IOException e) {
            e.printStackTrace();
        } finally {
            try {
                if (baos != null) {
                    baos.flush();
                    baos.close();
                }
            } catch (IOException e) {
                e.printStackTrace();
            }
        }
        return null;
    }

    /**
     * base64转为bitmap
     *
     * @param base64
     * @return
     */
    public static Bitmap base64ToBitmap(byte[] base64) {
        if (base64 == null) {
            return null;
        }
        return BitmapFactory.decodeByteArray(base64, 0, base64.length);
    }

    /**
     * 通知新图片文件
     * @param file
     */
    public static void notifyNewImage(final File file) {
        final Intent intent1 = new Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE);
        Uri uri = Uri.fromFile(file);
        intent1.setData(uri);
        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DATA, file.getAbsolutePath());
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpg");
                Uri uri = LauncherApplication.getContext().getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                LogUtil.i(TAG, "Insert result: " + uri);
                LauncherApplication.getInstance().sendBroadcast(intent1);
            }
        });
    }

    /**
     * 生成二维码图片
     * @param qrCode
     * @param size
     * @return
     */
    public static Bitmap generateQrCode(String qrCode, int size, int backgroundColor, int foregroundColor) {
        LogUtil.i(TAG, "为码值【%s】生成二维码", qrCode);
        QRCodeWriter writer = new QRCodeWriter();
        Map<EncodeHintType, Object> hints = new HashMap<>();
        hints.put(EncodeHintType.CHARACTER_SET, "utf-8");

        //容错级别
        hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M);

        // 边框
        hints.put(EncodeHintType.MARGIN, 2);

        BitMatrix matrix;
        try {
            matrix = writer.encode(qrCode, BarcodeFormat.QR_CODE, size, size, hints);
        } catch (WriterException e) {
            LogUtil.e(TAG, "Catch com.google.zxing.WriterException: " + e.getMessage(), e);
            return null;
        }

        int realHeight = matrix.getHeight();
        int realWidth = matrix.getWidth();

        // 二维码图片
        final Bitmap bitmap = Bitmap.createBitmap(realWidth, realHeight, Bitmap.Config.ARGB_4444);
        for (int x = 0; x < realWidth; x++) {
            for (int y = 0; y < realHeight; y++) {
                bitmap.setPixel(x, y, matrix.get(x, y) ? foregroundColor : backgroundColor);
            }
        }

        return bitmap;
    }

    /**
     * base64转为bitmap
     *
     * @param base64Data
     * @return
     */
    public static Bitmap base64ToBitmap(String base64Data) {
        byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
    }

}