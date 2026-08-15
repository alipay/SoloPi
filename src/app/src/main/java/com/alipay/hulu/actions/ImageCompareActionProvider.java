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

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.os.Build;
import android.util.DisplayMetrics;
import android.view.LayoutInflater;
import android.view.WindowManager;
import android.widget.LinearLayout;

import com.alipay.hulu.R;
import com.alipay.hulu.common.annotation.Enable;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.service.ScreenCaptureService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.common.utils.patch.PatchLoadResult;
import com.alipay.hulu.shared.node.action.OperationContext;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.provider.ActionProvider;
import com.alipay.hulu.shared.node.action.provider.ViewLoadCallback;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.utils.AssetsManager;
import com.alipay.hulu.tools.HighLightService;
import com.alipay.hulu.shared.node.utils.BitmapUtil;
import com.theartofdev.edmodo.cropper.CropImageView;

import java.io.File;
import java.lang.reflect.Method;
import java.util.HashMap;
import java.util.Map;

/**
 * Created by qiaoruikai on 2019/1/25 3:47 PM.
 */
@Enable
public class ImageCompareActionProvider implements ActionProvider {
    private static final String TAG = "ImgCompareActionPvd";

    public static final String ACTION_CLICK_BY_SCREENSHOT = "clickByScreenshot";
    public static final String ACTION_ASSERT_SCREENSHOT = "assertScreenshot";
    public static final String IMAGE_COMPARE_PATCH = "hulu_imageCompare";

    private HighLightService highLight;
    private ScreenCaptureService captureService;

    public static final String KEY_TARGET_IMAGE = "targetImage";
    private static final String KEY_ORIGIN_SCREEN = "originSize";
    private static final String KEY_ORIGIN_POS = "originPos";

    @Override
    public void onCreate(Context context) {
        highLight = LauncherApplication.getInstance().findServiceByName(HighLightService.class.getName());
        captureService = LauncherApplication.getInstance().findServiceByName(ScreenCaptureService.class.getName());
    }

    @Override
    public void onDestroy(Context context) {

    }

    @Override
    public boolean canProcess(String action) {
        return StringUtil.equals(action, ACTION_CLICK_BY_SCREENSHOT) ||
                StringUtil.equals(action, ACTION_ASSERT_SCREENSHOT);

    }

    @Override
    public boolean processAction(final String targetAction, AbstractNodeTree node,
                                 OperationMethod method, final OperationContext context) {

        // 同步执行，没点到就中断
        if (StringUtil.equals(targetAction, ACTION_CLICK_BY_SCREENSHOT)) {
            String base64 = method.getParam(KEY_TARGET_IMAGE);

            String screenInfo = method.getParam(KEY_ORIGIN_SCREEN);
            String[] widthAndHeight = StringUtil.split(screenInfo, ",");

            int defaultWidth;
            if (context.screenWidth < context.screenHeight) {
                defaultWidth = SPService.getInt(SPService.KEY_SCREENSHOT_RESOLUTION, 720);
            } else {
                defaultWidth = (int) (SPService.getInt(SPService.KEY_SCREENSHOT_RESOLUTION, 720) / (float) context.screenWidth * context.screenHeight);
            }

            // 以配置的宽度为准
            if (widthAndHeight != null && widthAndHeight.length == 2) {
                defaultWidth = Integer.parseInt(widthAndHeight[0]);
            }

            if (StringUtil.isEmpty(base64)) {
                LogUtil.e(TAG, "image content is empty");
                return false;
            }
            final Bitmap query;
            try {
                query = BitmapUtil.base64ToBitmap(base64);
                if (query == null) {
                    LogUtil.e(TAG, "Convert base64 to bitmap failed");
                    return false;
                }
            } catch (Exception e) {
                LogUtil.e(TAG, "处理查找抛出异常：" + e.getMessage(), e);
                return false;
            }

            PatchLoadResult rs = ClassUtil.getPatchInfo(IMAGE_COMPARE_PATCH);
            if (rs == null) {
                // 加载
                rs = AssetsManager.loadPatchFromServer(IMAGE_COMPARE_PATCH);

                // 还没有，GG
                if (rs == null) {
                    return false;
                }
            }

            try {
                // 开始查找
                Rect target = findTargetRect(rs, query, context.screenWidth, context.screenHeight, defaultWidth);
                if (target == null) {
                    LogUtil.e(TAG, "Can't find target Image");
                    return false;
                } else {
                    // 高亮控件
                    highLight.highLight(target, null);
                    BackgroundExecutor.execute(new Runnable() {
                        @Override
                        public void run() {
                            highLight.removeHighLight();
                        }
                    }, 1000);

                    // 执行adb命令
                    context.executor.executeClick(target.centerX(), target.centerY());

                    // 等500ms
                    MiscUtil.sleep(500);
                }
            } catch (Exception e) {
                LogUtil.e(TAG, "Catch Exception: " + e.getMessage(), e);
                return false;
            }
            context.notifyOperationFinish();
            return true;

        } else if (StringUtil.equals(targetAction, ACTION_ASSERT_SCREENSHOT)) {
            String base64 = method.getParam(KEY_TARGET_IMAGE);

            if (StringUtil.isEmpty(base64)) {
                LogUtil.e(TAG, "image content is empty");
                return false;
            }

            // 默认宽度
            int defaultWidth;
            if (context.screenWidth < context.screenHeight) {
                defaultWidth = SPService.getInt(SPService.KEY_SCREENSHOT_RESOLUTION, 720);
            } else {
                defaultWidth = (int) (SPService.getInt(SPService.KEY_SCREENSHOT_RESOLUTION, 720) / (float) context.screenHeight * context.screenWidth);
            }

            String screenInfo = method.getParam(KEY_ORIGIN_SCREEN);
            String[] heightAndWidth = StringUtil.split(screenInfo, ",");
            // 以配置的宽度为准
            if (heightAndWidth != null && heightAndWidth.length == 2) {
                defaultWidth = Integer.parseInt(heightAndWidth[0]);
            }

            Bitmap query;
            try {
                query = BitmapUtil.base64ToBitmap(base64);
                if (query == null) {
                    LogUtil.e(TAG, "Convert base64 to bitmap failed");
                    return false;
                }
            } catch (Exception e) {
                LogUtil.e(TAG, "处理查找抛出异常：" + e.getMessage(), e);
                return false;
            }

            PatchLoadResult rs = ClassUtil.getPatchInfo(IMAGE_COMPARE_PATCH);
            if (rs == null) {
                // 加载
                rs = AssetsManager.loadPatchFromServer(IMAGE_COMPARE_PATCH);

                // 还没有，无法执行
                if (rs == null) {
                    LauncherApplication.getInstance().showToast(StringUtil.getString(R.string.image_compare__assert_failed));
                    return false;
                }
            }

            try {
                // 开始查找
                Rect target = findTargetRect(rs, query, context.screenWidth, context.screenHeight, defaultWidth);
                if (target == null) {
                    LogUtil.e(TAG, "Can't find target Image");
                    LauncherApplication.getInstance().showToast(StringUtil.getString(R.string.image_compare__assert_failed));
                    return false;
                } else {
                    // 高亮控件
                    highLight.highLight(target, null);
                    BackgroundExecutor.execute(new Runnable() {
                        @Override
                        public void run() {
                            highLight.removeHighLight();
                        }
                    }, 1500);

                    // 执行adb命令
                    context.notifyOperationFinish();
                    LauncherApplication.getInstance().showToast(StringUtil.getString(R.string.image_compare__assert_success));
                    return true;
                }
            } catch (Exception e) {
                LogUtil.e(TAG, "Catch Exception: " + e.getMessage(), e);
                context.notifyOperationFinish();
            }

            LauncherApplication.getInstance().showToast(StringUtil.getString(R.string.image_compare__assert_failed));
            return false;
        }

        return false;
    }

    @Override
    public Map<String, String> provideActions(AbstractNodeTree node) {
        Map<String, String> actionMap = new HashMap<>(2);

        // 配置功能项
        actionMap.put(ACTION_ASSERT_SCREENSHOT, StringUtil.getString(R.string.image_compare__screenshot_assert));
        actionMap.put(ACTION_CLICK_BY_SCREENSHOT, StringUtil.getString(R.string.image_compare__screenshot_click));

        return actionMap;
    }

    @Override
    public void provideView(final Context context, String action, final OperationMethod method,
                            final AbstractNodeTree node, final ViewLoadCallback callback) {

        if (!StringUtil.equals(action, ACTION_CLICK_BY_SCREENSHOT) &&
                !StringUtil.equals(action, ACTION_ASSERT_SCREENSHOT)) {
            LogUtil.e(TAG, "Can't process Action %s", action);
            callback.onViewLoaded(null);
            return;
        }

        LogUtil.d(TAG, "开始提供图像对比界面");

        highLight.removeHighLight();
        // 等2秒，高亮、Dialog消失
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                final File target = new File(FileUtils.getSubDir("tmp"), "screenshot_" + System.currentTimeMillis() + ".png");

                // 在后台再去加载
                BackgroundExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        if (ClassUtil.getPatchInfo(IMAGE_COMPARE_PATCH) == null) {
                            AssetsManager.loadPatchFromServer(IMAGE_COMPARE_PATCH);
                        }
                    }
                });

                int defaultMinEdge = SPService.getInt(SPService.KEY_SCREENSHOT_RESOLUTION, 720);
                // 屏幕尺寸信息
                DisplayMetrics dm = new DisplayMetrics();
                ((WindowManager) LauncherApplication.getInstance().getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRealMetrics(dm);
                final int height = dm.heightPixels;
                int width = dm.widthPixels;
                int minEdge = Math.min(height, width);
                float radio = defaultMinEdge / (float) minEdge;
                if (radio > 1) {
                    radio = 1;
                }

                Bitmap newBM = null;
                long startTime = System.currentTimeMillis();
                if (captureService != null) {
                    newBM = captureService.captureScreen(target, width, height, (int) (radio * width), (int) (radio * height));

                    LogUtil.d(TAG, "Minicap 截图耗时: " + (System.currentTimeMillis() - startTime));
                }

                if (newBM == null) {
                    String path = FileUtils.getPathInShell(target);
                    CmdTools.execHighPrivilegeCmd("screencap -p \"" + path + "\"", 2000);

                    // 截图文件存在
                    if (target.exists()) {
                        Bitmap bitmap = BitmapFactory.decodeFile(target.getPath());

                        // 缩放到默认缩放尺寸
                        Matrix matrix = new Matrix();
                        matrix.postScale(radio, radio);// 使用后乘
                        newBM = Bitmap.createBitmap(bitmap, 0, 0,
                                bitmap.getWidth(), bitmap.getHeight(), matrix, false);

                        // 回收下
                        if (!bitmap.isRecycled()) {
                            bitmap.recycle();
                        }

                        // 加载完毕后，截图文件删除
                        if (target.exists()) {
                            target.delete();
                        }
                    }
                }

                // 设置默认框选区域
                final Rect defaultBound;
                if (node != null) {
                    Rect tmp = node.getNodeBound();
                    defaultBound = new Rect((int) (tmp.left * radio), (int) (tmp.top * radio), (int) (tmp.right * radio), (int) (tmp.bottom * radio));
                } else {
                    defaultBound = new Rect(newBM.getWidth() / 3,
                            newBM.getHeight() / 3, newBM.getWidth() / 3 * 2,
                            newBM.getHeight() / 3 * 2);
                }

                // 配置默认尺寸
                method.putParam(KEY_ORIGIN_SCREEN, newBM.getWidth() + "," + newBM.getHeight());
                final Bitmap finalNewBM = newBM;
                LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        LinearLayout root = (LinearLayout) LayoutInflater.from(context).inflate(R.layout.dialog_action_crop_image, null);

                        final CropImageView crop = (CropImageView) root.findViewById(R.id.dialog_action_crop_view);

                        crop.setImageBitmap(finalNewBM);
                        crop.setCropRect(defaultBound);

                        root.setMinimumHeight(height * 2 / 3);

                        callback.onViewLoaded(root, new Runnable() {
                            @Override
                            public void run() {
                                Bitmap result = crop.getCroppedImage();

                                // Base64存储
                                method.putParam(KEY_TARGET_IMAGE, BitmapUtil.bitmapToBase64(result));
                                method.putParam(KEY_ORIGIN_POS, flatRectToString(crop.getCropRect()));
                            }
                        });
                    }
                });
            }
        }, 200);
        return;
    }

    /**
     * 根据query图像查找目标Rect
     * @param rs 插件
     * @param query query图像
     * @return
     */
    private Rect findTargetRect(PatchLoadResult rs, Bitmap query, int screenWidth, int screenHeight, int scaleWidth) {
        // 截图查找
        final File target = new File(FileUtils.getSubDir("tmp"), "screenshot_" + System.currentTimeMillis() + ".png");
        Bitmap screenShot = null;

        // 缩放比率
        float radio = scaleWidth / (float) screenWidth;

        // 传来的图片尺寸更大，先缩小query图片
        if (scaleWidth > screenWidth) {
            float scale = screenWidth / (float) scaleWidth;

            LogUtil.w(TAG, "缩放目标图片： %f", scale);
            // 缩放下原始图片
            query = Bitmap.createScaledBitmap(query, (int) (scale * query.getWidth()), (int) (scale * query.getHeight()), false);

            radio = 1;
            scaleWidth = screenWidth;
        }

        // 如果有minicap截图服务，走minicap
        if (captureService != null) {
            long startTime = System.currentTimeMillis();
            screenShot = captureService.captureScreen(target, screenWidth, screenHeight, scaleWidth, (int) (screenHeight * radio));
            LogUtil.d(TAG, "截图耗时 " + (System.currentTimeMillis() - startTime));
        }

        if (screenShot == null) {
            String path = FileUtils.getPathInShell(target);

            CmdTools.execHighPrivilegeCmd("screencap -p \"" + path + "\"", 2000);

            Bitmap bitmap = BitmapFactory.decodeFile(target.getPath());

            // 缩放到目标宽度
            Matrix matrix = new Matrix();
            matrix.postScale(radio, radio);// 使用后乘
            screenShot = Bitmap.createBitmap(bitmap, 0, 0,
                    bitmap.getWidth(), bitmap.getHeight(), matrix, false);

            // 回收下
            if (!bitmap.isRecycled()) {
                bitmap.recycle();
            }
        }

        try {
            Class<?> targetClass = ClassUtil.getClassByName(rs.entryClass);
            if (targetClass == null) {
                LogUtil.e(TAG, "插件类不存在");
                return null;
            }

            Method targetMethod = targetClass.getMethod(rs.entryMethod, Bitmap.class, Bitmap.class);
            if (targetMethod == null) {
                LogUtil.e(TAG, "插件目标方法不存在");
                return null;
            }

            float[] result = (float[]) targetMethod.invoke(null, query, screenShot);

            // 未能找到目标框
            if (result == null || result.length != 8) {
                LogUtil.e(TAG, "未能找到目标控件");
                return null;
            }

            int left = Integer.MAX_VALUE;
            int top = Integer.MAX_VALUE;
            int right = -1;
            int bottom = -1;

            // 可能存在目标点不是标准矩形，找上下左右最值点
            for (int i = 0; i < 8; i++) {
                if (i % 2 == 0) {
                    if (result[i] < left) {
                        left = (int) result[i];
                    }
                    if (result[i] > right) {
                        right = (int) result[i];
                    }
                } else {
                    if (result[i] < top) {
                        top = (int) result[i];
                    }

                    if (result[i] > bottom) {
                        bottom = (int) result[i];
                    }
                }
            }

            float targetWidth = right - left;
            float targetHeight = bottom - top;

            float widthRadio = targetWidth / query.getWidth();
            float heightRadio = targetHeight / query.getHeight();

            LogUtil.d(TAG, "原尺寸: %s, 查找尺寸: %s" , query.getWidth() + "x" + query.getHeight(), targetWidth + "x" + targetHeight);

            // 差别过大，说明找错了，当做没找到
            if (widthRadio < 0.4 || widthRadio > 2 || heightRadio < 0.4 || heightRadio > 2) {
                LogUtil.w(TAG, "查找结果与原图尺寸差别过大，不可信");
                return null;
            }

            return new Rect((int) (left / radio), (int) (top / radio), (int) (right / radio), (int) (bottom / radio));
        } catch (Exception e) {
            LogUtil.e(TAG, "Catch Exception: " + e.getMessage(), e);
            return null;
        } finally {
            if (target.exists()) {
                FileUtils.deleteFile(target);
            }
        }
    }

    private static String flatRectToString(Rect r) {
        return r.top + "," + r.left + "," + r.bottom + "," + r.right;
    }

    private static Rect readRectFromString(String content) {
        String[] poses = StringUtil.split(content, ",");
        if (poses == null || poses.length != 4) {
            return null;
        }

        try {
            return new Rect(Integer.parseInt(poses[0]), Integer.parseInt(poses[1]),
                    Integer.parseInt(poses[2]), Integer.parseInt(poses[3]));
        } catch (NumberFormatException e) {
            LogUtil.e(TAG, "Can't read rect from String %s", content);
            return null;
        }
    }
}
