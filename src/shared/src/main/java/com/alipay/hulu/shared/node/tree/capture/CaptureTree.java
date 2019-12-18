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

import android.graphics.Bitmap;
import android.graphics.Rect;

import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.action.OperationContext;
import com.alipay.hulu.shared.node.action.OperationExecutor;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.utils.BitmapUtil;
import com.alipay.hulu.shared.node.utils.RectUtil;

import java.util.Map;

/**
 * Created by qiaoruikai on 2019-04-25 14:51.
 */
public class CaptureTree extends AbstractNodeTree {
    private static final String TAG = "CaptureTree";
    public static final String KEY_ORIGIN_SCREEN = "originSize";
    private static final String KEY_ORIGIN_POS = "originPos";

    private byte[] bytes;
    private float scale;
    private final int scaleWidth;
    private final int scaleHeight;
    private final int originWidth;
    private final int originHeigth;
    private boolean resized;

    /**
     * 配置截图信息
     * @param captureInfo
     */
    public CaptureTree(CaptureInfo captureInfo) {
        this.nodeBound = new Rect(0, 0, captureInfo.originW, captureInfo.originH);
        this.bytes = captureInfo.bytes;
        this.scale = captureInfo.scale;
        this.scaleHeight = captureInfo.height;
        this.scaleWidth = captureInfo.width;
        this.originHeigth = captureInfo.originH;
        this.originWidth = captureInfo.originW;
        visible = true;
    }

    @Override
    public boolean canDoAction(PerformActionEnum action) {
        if (action == PerformActionEnum.ASSERT) {
            return false;
        }
        return true;
    }

    @Override
    public String getCapture() {
        // 重新筛选区域
        Bitmap bitmap = BitmapUtil.base64ToBitmap(bytes);
        Rect scaled = RectUtil.safetyScale(nodeBound, scale, bitmap.getWidth(), bitmap.getHeight());

        Bitmap capture = Bitmap.createBitmap(bitmap, scaled.left, scaled.top, scaled.width(), scaled.height());

        return BitmapUtil.bitmapToBase64(capture);
    }

    /**
     * 设置框选区域
     * @param position
     */
    public void resizeTo(Rect position) {
        resized = true;
        this.nodeBound = RectUtil.ensureBound(position, originWidth, originHeigth);
    }

    /**
     * 重设区域
     */
    public void resetBound() {
        resized = false;
        this.nodeBound = new Rect(0, 0, originWidth, originHeigth);
    }

    /**
     * 获取原始截图
     * @return
     */
    public Bitmap getOriginScreen() {
        return BitmapUtil.base64ToBitmap(bytes);
    }

    public byte[] getBytes() {
        return bytes;
    }

    public float getScale() {
        return scale;
    }

    public boolean isResized() {
        return resized;
    }

    public int getScaleWidth() {
        return scaleWidth;
    }

    public int getScaleHeight() {
        return scaleHeight;
    }

    public int getOriginWidth() {
        return originWidth;
    }

    public int getOriginHeigth() {
        return originHeigth;
    }

    @Override
    public boolean performAction(OperationMethod method, OperationContext context) {
        // 输入通过位置进行
        if (method.getActionEnum() == PerformActionEnum.INPUT) {
            String text = method.getParam(OperationExecutor.INPUT_TEXT_KEY);
            inputText(text, context);
            return true;
        }

        boolean result = super.performAction(method, context);

        // 等1秒
        if (result) {
            MiscUtil.sleep(1000);
        }

        return result;
    }

    /**
     * 输入文字
     * @param text
     * @param opContext
     */
    private void inputText(final String text, final OperationContext opContext) {
        opContext.notifyOnFinish(new Runnable() {
            @Override
            public void run() {
                LogUtil.e(TAG, "Start Input");
                if (StringUtil.containsChinese(text)) {
                    try {
                        String defaultIme = opContext.executor.executeCmdSync("settings get secure default_input_method");
                        CmdTools.switchToIme("com.alipay.hulu/.tools.AdbIME");
                        Rect rect = getNodeBound();

                        opContext.executor.executeClick(rect.centerX(), rect.centerY());
                        MiscUtil.sleep(1500);
                        opContext.executor.executeCmdSync("am broadcast -a ADB_INPUT_TEXT --es msg '" + text + "' --es default '" + StringUtil.trim(defaultIme) + "'", 0);
                    } catch (Exception e) {
                        LogUtil.e(TAG, "Input throw Exception：" + e.getLocalizedMessage(), e);
                    }
                } else {
                    Rect rect = getNodeBound();
                    opContext.executor.executeClick(rect.centerX(), rect.centerY());
                    MiscUtil.sleep(1500);
                    opContext.executor.executeCmdSync("input text " + text);
                }
                LogUtil.e(TAG, "Finish Input");
            }
        });
    }

    public void exportExtras(Map<String, String> extras) {
        extras.put(KEY_ORIGIN_POS, flatRectToString(getNodeBound()));
        extras.put(KEY_ORIGIN_SCREEN, scaleWidth + "," + scaleHeight);
    }

    public Rect fromOriginToScale(Rect originRect) {
        return RectUtil.safetyScale(originRect, scale, scaleWidth, scaleHeight);
    }

    public Rect fromScaleToOrigin(Rect scaledRect) {
        return RectUtil.safetyScale(scaledRect, 1 / scale, originWidth, originHeigth);
    }

    @Override
    public StringBuilder printTrace(StringBuilder builder) {
        builder.append("CaptureNode[").append(getNodeBound()).append("]");
        return builder;
    }

    @Override
    public boolean isSelfUsableForLocating() {
        return true;
    }

    @Override
    public int getDepth() {
        return 0;
    }

    @Override
    public int getIndex() {
        return 0;
    }

    private static String flatRectToString(Rect r) {
        return r.top + "," + r.left + "," + r.bottom + "," + r.right;
    }

    @Override
    public String toString() {
        return "CaptureTree{" +
                "scaleWidth=" + scaleWidth +
                ", scaleHeight=" + scaleHeight +
                ", originWidth=" + originWidth +
                ", originHeigth=" + originHeigth +
                ", bound=" + nodeBound.toShortString() +
                '}';
    }
}
