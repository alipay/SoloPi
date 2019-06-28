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
import android.content.res.TypedArray;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.support.annotation.Nullable;
import android.util.AttributeSet;
import android.view.View;

import com.alipay.hulu.R;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.StringUtil;

import java.util.ArrayList;
import java.util.List;

/**
 * Created by qiaoruikai on 2019/2/21 2:46 PM.
 */
public class CaseStepStatusView extends View {
    private int backGroundColor;
    private int lineColor;
    private int textSize;
    private int textWidth;
    private int lineSpace;
    private int lineWidth;
    private int triangleWidth;

    private Paint trianglePaint;
    private Paint linePaint;

    private List<Integer> occuredLevel = new ArrayList<>();
    private int startLevel = -1;
    private List<Integer> endLevel = new ArrayList<>();
    private String text = null;

    public CaseStepStatusView(Context context) {
        this(context, null);
    }

    public CaseStepStatusView(Context context, @Nullable AttributeSet attrs) {
        this(context, attrs, 0);
    }

    public CaseStepStatusView(Context context, @Nullable AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);

        readAttributes(attrs);
    }

    @TargetApi(21)
    public CaseStepStatusView(Context context, @Nullable AttributeSet attrs, int defStyleAttr, int defStyleRes) {
        super(context, attrs, defStyleAttr, defStyleRes);

        readAttributes(attrs);
    }

    private void readAttributes(AttributeSet attrs) {
        TypedArray array = getContext().obtainStyledAttributes(attrs, R.styleable.CaseStepStatusView);
        backGroundColor = array.getColor(R.styleable.CaseStepStatusView_css_backgroundColor,
                Color.rgb(0xFB, 0xFF, 0xEA ));

        lineColor = array.getColor(R.styleable.CaseStepStatusView_css_lineColor,
                Color.rgb(151, 151, 151));
        // 默认12dp
        textSize = array.getDimensionPixelSize(R.styleable.CaseStepStatusView_css_textSize,
                ContextUtil.dip2px(getContext(), 12));

        // 默认36dp
        textWidth = array.getDimensionPixelOffset(R.styleable.CaseStepStatusView_css_textWidth,
                ContextUtil.dip2px(getContext(), 36));

        // 默认4dp
        lineSpace = array.getDimensionPixelOffset(R.styleable.CaseStepStatusView_css_lineSpace,
                ContextUtil.dip2px(getContext(), 4));

        lineWidth = array.getDimensionPixelOffset(R.styleable.CaseStepStatusView_css_lineWidth,
                ContextUtil.dip2px(getContext(), 1));

        triangleWidth = array.getDimensionPixelOffset(R.styleable.CaseStepStatusView_css_triangleWidth,
                ContextUtil.dip2px(getContext(), 6));

        initPaint();
        array.recycle();
    }

    public void setText(String text) {
        this.text = text;
        invalidate();
    }

    /**
     * 设置level状态
     * @param occuredLevel
     * @param startLevel
     * @param endLevel
     */
    public void setLevelStatus(List<Integer> occuredLevel, int startLevel, List<Integer> endLevel) {
        this.occuredLevel.clear();
        this.occuredLevel.addAll(occuredLevel);

        this.startLevel = startLevel;

        this.endLevel.clear();
        this.endLevel.addAll(endLevel);

        invalidate();
    }

    /**
     * 初始化绘制
     */
    private void initPaint() {
        if (linePaint == null) {
            linePaint = new Paint();
        } else {
            linePaint.reset();
        }
        linePaint.setColor(lineColor);
        linePaint.setAntiAlias(false);
        linePaint.setStrokeWidth(lineWidth);
        linePaint.setStrokeCap(Paint.Cap.SQUARE);
        linePaint.setStrokeJoin(Paint.Join.BEVEL);

        if (trianglePaint == null) {
            trianglePaint = new Paint();
        } else {
            trianglePaint.reset();
        }


        trianglePaint.setColor(lineColor);
        trianglePaint.setAntiAlias(true);
        trianglePaint.setStrokeWidth(1);
        trianglePaint.setStrokeJoin(Paint.Join.BEVEL);
        trianglePaint.setTextSize(textSize);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);

        canvas.drawColor(backGroundColor);
        int height = getHeight();
        int width = getWidth();

        int defaultLineSpace = width - (textWidth + 8);

        // 跨过的level
        if (!occuredLevel.isEmpty()) {
            for (int level : occuredLevel) {
                int x = defaultLineSpace - level * lineSpace;
                canvas.drawLine(x, 0,
                        x, height, linePaint);
            }
        }

        // 起始位置
        if (startLevel > -1) {
            int x = defaultLineSpace - startLevel * lineSpace;
            canvas.drawLine(x, height / 2F, width, height / 2F, linePaint);
            canvas.drawLine(x, height / 2F, x, height, linePaint);
        }

        if (!endLevel.isEmpty()) {
            int maxLevel = -1;
            for (int level: endLevel) {
                if (maxLevel < level) {
                    maxLevel = level;
                }
                int x = defaultLineSpace - level * lineSpace;
                canvas.drawLine(x, 0, x, height / 2F, linePaint);
            }

            int maxX = defaultLineSpace - maxLevel * lineSpace;
            canvas.drawLine(maxX, height / 2F, width - triangleWidth, height / 2F, linePaint);

            canvas.drawPath(genEndTriangle(), trianglePaint);
        }

        if (!StringUtil.isEmpty(text)) {
            canvas.drawText(text, width - textWidth, height / 2F - textSize / 2F, trianglePaint);
        }
    }

    /**
     * 生成三角
     * @return
     */
    private Path genEndTriangle() {
        Path p = new Path();
        float halfHeight = (float) (triangleWidth / Math.sqrt(3));
        p.moveTo(getWidth() - triangleWidth, getHeight() / 2F - halfHeight);
        p.rLineTo(triangleWidth, halfHeight);
        p.rLineTo(-triangleWidth, halfHeight);
        p.close();
        return p;
    }
}
