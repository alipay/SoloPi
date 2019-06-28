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

import android.graphics.Rect;
import android.graphics.RectF;
import android.support.annotation.NonNull;

/**
 * Created by qiaoruikai on 2019-05-07 17:04.
 */
public class RectUtil {
    /**
     * 安全缩放
     * @param origin
     * @param scale
     * @param maxWidth
     * @param maxHeight
     * @return
     */
    public static Rect safetyScale(@NonNull Rect origin, float scale, int maxWidth, int maxHeight) {
        return ensureBound(scaleRect(origin, scale), maxWidth, maxHeight);
    }

    /**
     * 安全缩放
     * @param origin
     * @param scale
     * @param maxWidth
     * @param maxHeight
     * @return
     */
    public static RectF safetyScale(@NonNull RectF origin, float scale, float maxWidth, float maxHeight) {
        return ensureBound(scaleRectF(origin, scale), maxWidth, maxHeight);
    }

    /**
     * 缩放Rect
     * @param origin
     * @param scale
     * @return
     */
    public static Rect scaleRect(@NonNull Rect origin, float scale) {
        if (scale != 1) {
            return new Rect((int) (origin.left * scale + 0.5f),
                    (int) (origin.top * scale + 0.5f),
                    (int) (origin.right * scale + 0.5f),
                    (int) (origin.bottom * scale + 0.5f));
        } else {
            return new Rect(origin);
        }
    }

    /**
     * 缩放Rect
     * @param origin
     * @param scale
     * @return
     */
    public static RectF scaleRectF(@NonNull RectF origin, float scale) {
        if (scale != 1) {
            return new RectF(origin.left * scale, origin.top * scale,
                    origin.right * scale, origin.bottom * scale);
        } else {
            return new RectF(origin);
        }
    }

    /**
     * 确保边界
     *
     * @param target
     * @param maxWidth
     * @param maxHeight
     * @return
     */
    public static Rect ensureBound(@NonNull Rect target, int maxWidth, int maxHeight) {
        return new Rect(target.left < 0 ? 0 : target.left, target.top < 0 ? 0 : target.top,
                target.right > maxWidth ? maxWidth : target.right,
                target.bottom > maxHeight ? maxHeight : target.bottom);
    }

    /**
     * 确保边界
     * @param target
     * @param maxWidth
     * @param maxHeight
     * @return
     */
    public static RectF ensureBound(@NonNull RectF target, float maxWidth, float maxHeight) {
        return new RectF(target.left < 0 ? 0 : target.left, target.top < 0 ? 0 : target.top,
                target.right > maxWidth ? maxWidth : target.right,
                target.bottom > maxHeight ? maxHeight : target.bottom);
    }
}
