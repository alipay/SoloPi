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
package com.alipay.hulu.ui;

import android.annotation.TargetApi;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Paint;
import android.util.AttributeSet;
import android.widget.RelativeLayout;

/**
 * Created by qiaoruikai on 2019/2/28 12:00 PM.
 */
public class ColorFilterRelativeLayout extends RelativeLayout {
    //XXLayout could be LinearLayout, RelativeLayout or others
    private Paint m_paint;

    //define constructors here and call _Init() at the end of constructor function


    public ColorFilterRelativeLayout(Context context) {
        this(context, null);
    }

    public ColorFilterRelativeLayout(Context context, AttributeSet attrs) {
        this(context, attrs, 0);
    }

    public ColorFilterRelativeLayout(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
        _Init();
    }

    @TargetApi(21)
    public ColorFilterRelativeLayout(Context context, AttributeSet attrs, int defStyleAttr, int defStyleRes) {
        super(context, attrs, defStyleAttr, defStyleRes);
        _Init();
    }

    private void _Init() {
        ColorMatrix cm = new ColorMatrix();
        cm.setSaturation(1);
        m_paint = new Paint();
        m_paint.setColorFilter(new ColorMatrixColorFilter(cm));
    }

    @Override
    protected void dispatchDraw(Canvas canvas) {
        canvas.saveLayer(null, m_paint, Canvas.ALL_SAVE_FLAG);
        super.dispatchDraw(canvas);
        canvas.restore();
    }

    /**
     * 重设饱和度
     * @param saturation
     */
    public void setSaturation(float saturation) {
        ColorMatrix cm = new ColorMatrix();
        cm.setSaturation(saturation);
        m_paint.setColorFilter(new ColorMatrixColorFilter(cm));

        invalidate();
    }
}
