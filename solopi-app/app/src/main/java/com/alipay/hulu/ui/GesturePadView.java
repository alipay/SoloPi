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
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Point;
import android.graphics.PointF;
import android.graphics.Rect;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.View;

import com.alipay.hulu.R;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.LogUtil;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Created by qiaoruikai on 2019/12/6 4:50 PM.
 */
public class GesturePadView extends View {
    private static final String TAG = "GesturePadView";
    /**
     * 背景颜色
     */
    private Drawable backgroundRes;

    /**
     * 清除键资源
     */
    private Drawable clearBtnRes;

    /**
     * 清除键大小
     */
    private int clearBtnSize;

    private Rect clearBtnRect;

    /**
     * 背景Paint
     */
    private Paint backgroundPaint;

    /**
     * 目标图像
     */
    private Drawable targetImg;

    private Drawable sourceImg;

    /**
     * 手势线宽度
     */
    private int lineWidth;

    /**
     * 手势线颜色
     */
    private int lineColor;
    /**
     * 关键点半径
     */
    private int pointRadius;

    /**
     * 绘制padding
     */
    private int padding;

    private int statusBarHeight;

    /**
     * 触摸事件时间间隔
     */
    private int gestureActionFilter;

    /**
     * 手势paint
     */
    private Paint gesturePaint;

    private List<Point> points;


    public GesturePadView(Context context) {
        this(context, null);
    }

    public GesturePadView(Context context, @Nullable AttributeSet attrs) {
        this(context, attrs, 0);
    }

    public GesturePadView(Context context, @Nullable AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
        initAttrs(context, attrs);
        loadView();
    }

    @TargetApi(21)
    public GesturePadView(Context context, @Nullable AttributeSet attrs, int defStyleAttr, int defStyleRes) {
        super(context, attrs, defStyleAttr, defStyleRes);
        initAttrs(context, attrs);
        loadView();
    }

    /**
     * 读取参数
     * @param attrs
     */
    private void initAttrs(Context context, AttributeSet attrs) {
        TypedArray array = getContext().obtainStyledAttributes(attrs, R.styleable.GesturePadView);

        backgroundRes = array.getDrawable(R.styleable.GesturePadView_gpv_backgroundRes);
        if (backgroundRes == null) {
            backgroundRes = new ColorDrawable(context.getResources().getColor(R.color.textColorLowGray));
        }
        backgroundPaint = new Paint();
        backgroundPaint.setStyle(Paint.Style.FILL);
        backgroundPaint.setColor(Color.rgb(200, 200, 200));

        clearBtnRes = array.getDrawable(R.styleable.GesturePadView_gpv_clearBtn);
        if (clearBtnRes == null) {
            clearBtnRes = context.getResources().getDrawable(R.drawable.case_edit);
        }
        clearBtnSize = array.getDimensionPixelSize(R.styleable.GesturePadView_gpv_clearBtnSize,
                ContextUtil.dip2px(context, 36));
        clearBtnRect = new Rect();

        padding = array.getDimensionPixelSize(R.styleable.GesturePadView_gpv_padding,
                ContextUtil.dip2px(context, 2));

        sourceImg = array.getDrawable(R.styleable.GesturePadView_gpv_targetImgRes);

        // 手势Paint配置
        lineColor = array.getColor(R.styleable.GesturePadView_gpv_lineColor,
                context.getResources().getColor(R.color.colorAccent));
        lineWidth = array.getDimensionPixelSize(R.styleable.GesturePadView_gpv_lineWidth,
                ContextUtil.dip2px(context, 2));
        reloadGesturePaint();
        pointRadius = array.getDimensionPixelSize(R.styleable.GesturePadView_gpv_pointRadius,
                ContextUtil.dip2px(context, 2));

        gestureActionFilter = array.getInt(R.styleable.GesturePadView_gpv_gestureFilter, 25);

        points = new ArrayList<>();

        array.recycle();
    }

    private void loadView() {
        // 获取标题栏高度
        if (statusBarHeight == 0) {
            try {
                Class<?> clazz = Class.forName("com.android.internal.R$dimen");
                Object object = clazz.newInstance();
                statusBarHeight = Integer.parseInt(clazz.getField("status_bar_height")
                        .get(object).toString());
                statusBarHeight = getResources().getDimensionPixelSize(statusBarHeight);
            } catch (Exception e) {
                e.printStackTrace();
            } finally {
                if (statusBarHeight == 0) {
                    statusBarHeight = 50;
                }
            }
        }
    }

    /**
     * 获取操作路径
     * @return
     */
    public List<PointF> getGesturePath() {
        if (targetImg == null) {
            return null;
        }

        if (points.size() == 0) {
            return Collections.emptyList();
        }

        Rect rect = targetImg.getBounds();
        List<PointF> pointFS = new ArrayList<>(points.size() + 1);
        for (Point p: points) {
            pointFS.add(new PointF((p.x - (float) rect.left)/ rect.width(), (p.y - (float) rect.top)/ rect.height()));
        }

        return pointFS;
    }

    /**
     * 设置触摸事件时间间隔
     * @param gestureFilter
     */
    public void setGestureFilter(int gestureFilter) {
        this.gestureActionFilter = gestureFilter;
    }

    /**
     * 获取触摸事件时间间隔
     * @return
     */
    public int getGestureFilter() {
        return gestureActionFilter;
    }

    public void clear() {
        points.clear();
        invalidate();
    }

    private void reloadGesturePaint() {
        if (gesturePaint != null) {
            gesturePaint.reset();
        } else {
            gesturePaint = new Paint();
        }

        gesturePaint.setColor(lineColor);
        gesturePaint.setStrokeWidth(lineWidth);
        gesturePaint.setStyle(Paint.Style.FILL_AND_STROKE);
        gesturePaint.setAntiAlias(true);
        gesturePaint.setFilterBitmap(false);
    }

    /**
     * 加载操作图片
     * @param drawable
     */
    public void setTargetImage(@NonNull Drawable drawable) {
        targetImg = null;
        sourceImg = drawable;
        invalidate();
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int maxWidth = MeasureSpec.getSize(widthMeasureSpec);
        int maxHeight = MeasureSpec.getSize(heightMeasureSpec);
        if (maxHeight > maxWidth) {
            // 设置容器所需的宽度和高度
            setMeasuredDimension(maxWidth, maxWidth);
        } else {
            setMeasuredDimension(maxHeight, maxHeight);
        }
    }

    private int oldWidth = -1;

    private void reloadWidth(int width) {
        oldWidth = width;
        backgroundRes.setBounds(0, 0 ,width, width);
        clearBtnRect.set(width - clearBtnSize - padding, padding, width - padding, clearBtnSize + padding);
        int padding = (int) (clearBtnRect.height() * 0.2F);
        clearBtnRes.setBounds(clearBtnRect.left + padding, clearBtnRect.top + padding,
                clearBtnRect.right - padding, clearBtnRect.bottom - padding);
    }

    private void loadTargetImg(int totalWidth) {
        int size = totalWidth - padding * 2;
        int width = sourceImg.getIntrinsicWidth();
        int height = sourceImg.getIntrinsicHeight();

        LogUtil.d(TAG, "Image info: w:%d, h:%d, s:%d", width, height, size);
        Bitmap realBitmap;
        if (sourceImg instanceof BitmapDrawable) {
            realBitmap = ((BitmapDrawable) sourceImg).getBitmap();
        } else {
            realBitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_4444);
            Canvas canvas = new Canvas(realBitmap);
            sourceImg.setBounds(0, 0, width, height);
            sourceImg.draw(canvas);
        }
        sourceImg = null;

        float radio = width / (float) height;
        if (width > height) {
            float scaledHeight = size / radio;
            Bitmap scaled = Bitmap.createScaledBitmap(realBitmap, size, (int) scaledHeight, false);
            targetImg = new BitmapDrawable(getResources(), scaled);
            targetImg.setBounds(padding, (int) (size / 2 - scaledHeight / 2), size + padding, (int) (size / 2 + scaledHeight / 2));
        } else if (width == height) {
            targetImg = new BitmapDrawable(getResources(), realBitmap);
            targetImg.setBounds(padding, padding, size + padding, size + padding);
        } else {
            float scaledWidth = size * radio;
            Bitmap scaled = Bitmap.createScaledBitmap(realBitmap, (int) scaledWidth, size, false);
            targetImg = new BitmapDrawable(getResources(), scaled);
            targetImg.setBounds((int) (size / 2 - scaledWidth / 2), padding, (int) (size / 2 + scaledWidth / 2), size + padding);
        }
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int width = getWidth();

        if (width != oldWidth) {
            reloadWidth(width);
        }

        if (targetImg == null && sourceImg != null) {
            loadTargetImg(width);
        }

        backgroundRes.draw(canvas);
//        canvas.save();

        if (targetImg != null) {
            targetImg.draw(canvas);
        }

        canvas.saveLayerAlpha(0, 0, width, width, 125, Canvas.ALL_SAVE_FLAG);
//        canvas.save();
        canvas.drawRect(clearBtnRect, backgroundPaint);
        clearBtnRes.draw(canvas);
        canvas.restore();

        drawPoints(canvas);
    }

    private void drawPoints(Canvas canvas) {
        if (points != null && points.size() > 0) {
            int i;
            for (i = 0; i < points.size() - 1; i++) {
                Point p1 = points.get(i);
                Point p2 = points.get(i + 1);

                canvas.drawLine(p1.x, p1.y, p2.x, p2.y, gesturePaint);
                if (pointRadius > 0) {
                    canvas.drawCircle(p1.x, p1.y, pointRadius, gesturePaint);
                }
            }

            if (pointRadius > 0) {
                canvas.drawCircle(points.get(i).x, points.get(i).y, pointRadius, gesturePaint);
            }
        }
    }

    private long lastBtnTime = -1L;

    private boolean onPointTrack = false;
    private long lastPointTime = -1L;

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        int[] originScreen = new int[2];
        getLocationInWindow(originScreen);
        int x = (int) event.getX();
        int y = (int) event.getY();

        LogUtil.d(TAG, "Action x: %d, y: %d", x, y);

        switch (event.getAction()) {
            case MotionEvent.ACTION_DOWN:
                if (clearBtnRect.contains(x, y)) {
                    lastBtnTime = System.currentTimeMillis();
                    onPointTrack = false;
                } else if (targetImg != null && targetImg.getBounds().contains(x, y))  {
                    points.add(new Point(x, y));
                    invalidate();
                    onPointTrack = true;
                    lastPointTime = System.currentTimeMillis();
                    lastBtnTime = -1L;
                } else {
                    return false;
                }
                return true;
            case MotionEvent.ACTION_MOVE:
                if (lastBtnTime > -1) {
                    if (!clearBtnRect.contains(x, y)) {
                        lastBtnTime = -1;
                    }
                } else if (onPointTrack)  {
                    if (targetImg.getBounds().contains(x, y)) {
                        if (System.currentTimeMillis() - lastPointTime >= gestureActionFilter) {

                            // 长按fix
                            int count = (int) ((System.currentTimeMillis() - lastPointTime) / gestureActionFilter);
                            if (count > 1) {
                                Point last = points.get(points.size() - 1);
                                for (int i = 1; i < count; i++) {
                                    points.add(last);
                                }
                            }

                            points.add(new Point(x, y));
                            lastPointTime = System.currentTimeMillis();
                            invalidate();
                        }
                    } else {
                        onPointTrack = false;
                    }
                }
                break;
            case MotionEvent.ACTION_UP:
                if (lastBtnTime > -1) {
                    if (!clearBtnRect.contains(x, y)) {
                        lastBtnTime = -1;
                    } else {
                        points.clear();
                        invalidate();
                    }
                } else if (onPointTrack)  {
                    if (targetImg.getBounds().contains(x, y)) {
                        if (System.currentTimeMillis() - lastPointTime >= gestureActionFilter) {
                            int count = (int) ((System.currentTimeMillis() - lastPointTime) / gestureActionFilter);
                            Point last = points.get(points.size() - 1);
                            for (int i = 0; i < count; i++) {
                                points.add(last);
                            }
                        }
                        points.add(new Point(x, y));
                        lastPointTime = -1L;
                        invalidate();
                    }
                    onPointTrack = false;
                }
                break;
        }
        return false;
    }
}