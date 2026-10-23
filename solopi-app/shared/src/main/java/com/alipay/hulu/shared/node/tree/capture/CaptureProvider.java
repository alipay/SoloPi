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
package com.alipay.hulu.shared.node.tree.capture;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.service.ScreenCaptureService;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.shared.node.AbstractProvider;
import com.alipay.hulu.shared.node.tree.MetaTree;
import com.alipay.hulu.shared.node.tree.annotation.NodeProvider;
import com.alipay.hulu.shared.node.utils.BitmapUtil;
import com.alipay.hulu.shared.node.utils.NodeContext;

import java.io.File;

/**
 * Created by qiaoruikai on 2019-04-25 16:13.
 */
@NodeProvider(dataType = CaptureInfo.class)
public class CaptureProvider implements AbstractProvider {
    private static final String TAG = "CaptureProvider";
    ScreenCaptureService captureService;
    WindowManager manager;

    @Override
    public boolean onStart() {
        captureService = LauncherApplication.service(ScreenCaptureService.class);
        manager = (WindowManager) LauncherApplication.getInstance().getSystemService(Context.WINDOW_SERVICE);
        return true;
    }

    @Override
    public MetaTree provideMetaTree(NodeContext context) {
        File tmpScreenShot = new File(FileUtils.getSubDir("tmp"), "screenshot.jpg");
        try {
            if (captureService != null) {
                DisplayMetrics metrics = new DisplayMetrics();
                manager.getDefaultDisplay().getRealMetrics(metrics);
                int defaultWidth = metrics.widthPixels;
                int defaultHeight = metrics.heightPixels;

                int minEdge = Math.min(defaultHeight, defaultWidth);
                float scale = SPService.getInt(SPService.KEY_SCREENSHOT_RESOLUTION, 720) / (float) minEdge;

                // 不需要放大，只需要缩小
                if (scale > 1) {
                    scale = 1;
                }

                int scaledHeight = (int) (defaultHeight * scale);
                int scaledWidth = (int) (defaultWidth * scale);
                Bitmap bitmap = captureService.captureScreen(tmpScreenShot, defaultWidth, defaultHeight, scaledWidth, scaledHeight);
                if (bitmap != null) {
                    byte[] bytes = BitmapUtil.bitmapToByte(bitmap);

                    // 获取截图信息
                    CaptureInfo info = new CaptureInfo();
                    info.bytes = bytes;
                    info.height = scaledHeight;
                    info.width = scaledWidth;
                    info.originH = defaultHeight;
                    info.originW = defaultWidth;
                    info.scale = scale;

                    MetaTree meta = new MetaTree();
                    meta.setCurrentNode(info);

                    return meta;
                }
            }
            String path = FileUtils.getPathInShell(tmpScreenShot);

            CmdTools.execHighPrivilegeCmd("screencap -p \"" + path + "\"", 2000);

            Bitmap _bitmap = BitmapFactory.decodeFile(path);
            int minEdge = Math.min(_bitmap.getWidth(), _bitmap.getHeight());
            float scale = SPService.getInt(SPService.KEY_SCREENSHOT_RESOLUTION, 720) / (float) minEdge;

            // 缩放到目标宽度
            Matrix matrix = new Matrix();
            matrix.postScale(scale, scale);// 使用后乘
            Bitmap bitmap = Bitmap.createBitmap(_bitmap, 0, 0,
                    _bitmap.getWidth(), _bitmap.getHeight(), matrix, false);
            byte[] bytes = BitmapUtil.bitmapToByte(bitmap);

            // 获取截图信息
            CaptureInfo info = new CaptureInfo();
            info.bytes = bytes;
            info.height = bitmap.getHeight();
            info.width = bitmap.getWidth();
            info.originH = _bitmap.getHeight();
            info.originW = _bitmap.getWidth();
            info.scale = scale;

            MetaTree meta = new MetaTree();
            meta.setCurrentNode(info);

            return meta;

        } catch (Throwable t) {
            LogUtil.e(TAG, "获取屏幕截图出现异常", t);
        } finally {
            if (tmpScreenShot.exists()) {
                tmpScreenShot.delete();
            }
        }

        return null;
    }

    @Override
    public boolean refresh() {
        if (captureService == null) {
            captureService = LauncherApplication.service(ScreenCaptureService.class);
        }
        return true;
    }

    @Override
    public void onStop() {

    }
}
