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
package com.alipay.hulu.common.utils;

import android.content.Context;
import android.widget.ImageView;

import com.bumptech.glide.load.engine.DiskCacheStrategy;
import com.bumptech.glide.request.RequestOptions;

/**
 * 图标加载工具
 */
public class GlideUtil {
    /**
     * 加载图标
     * @param context
     * @return
     */
    public static void loadIcon(Context context, String app, ImageView img) {
        GlideApp.with(context)
            .applyDefaultRequestOptions(
                    RequestOptions.diskCacheStrategyOf(DiskCacheStrategy.NONE))
            .applyDefaultRequestOptions(RequestOptions.fitCenterTransform())
            .load("package:" + app).into(img);
        // cannot disk cache ApplicationInfo, nor Drawables;
    }
}
