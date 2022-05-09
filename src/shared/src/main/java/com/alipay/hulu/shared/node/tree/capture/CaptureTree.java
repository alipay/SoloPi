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

import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.shared.node.action.OperationContext;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.utils.BitmapUtil;
import com.alipay.hulu.shared.node.utils.RectUtil;

import java.util.ArrayList;
import java.util.List;
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


    @Override
    public JSONObject exportToJsonObject() {
        JSONObject obj = new JSONObject(6);
        obj.put("type", getClass().getSimpleName());
        obj.put("nodeBound", nodeBound);
        if (childrenNodes != null) {
            List<JSONObject> children = new ArrayList<>(childrenNodes.size() + 1);
            for (AbstractNodeTree child : getChildrenNodes()) {
                JSONObject childObj = child.exportToJsonObject();
                if (childObj != null) {
                    children.add(childObj);
                }
            }
            obj.put("children", children);
        }
        return obj;
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
    public int performAction(OperationMethod method, OperationContext context) {
        int result = super.performAction(method, context);

        // 等1秒
        if (result >= 0) {
            MiscUtil.sleep(1000);
        }

        return result;
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
