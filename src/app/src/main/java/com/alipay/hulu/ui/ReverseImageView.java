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

import android.content.Context;
import android.content.res.TypedArray;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.support.annotation.Nullable;
import android.support.v7.widget.AppCompatImageView;
import android.util.AttributeSet;

import com.alipay.hulu.R;
import com.alipay.hulu.common.utils.LogUtil;

/**
 * 带反色遮罩ImageView<br/>
 * Use code from <a href="https://blog.csdn.net/catoop/article/details/38656697">安卓中遮罩图片的处理</a>
 */
public class ReverseImageView extends AppCompatImageView {
    private static final String TAG = "ReverseImgView";
    int originRef = 0;
    int maskRef = 0;

    public ReverseImageView(Context context) {
        this(context, null);
    }

    public ReverseImageView(Context context, @Nullable AttributeSet attrs) {
        this(context, attrs, 0);
    }

    public ReverseImageView(Context context, @Nullable AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
        readAttrs(attrs);
    }

    /**
     * 获取参数
     * @param attrs
     */
    private void readAttrs(AttributeSet attrs) {
        TypedArray array = getContext().obtainStyledAttributes(attrs, R.styleable.ReverseImageView);

        originRef = array.getResourceId(R.styleable.ReverseImageView_targetImg, 0);
        maskRef = array.getResourceId(R.styleable.ReverseImageView_maskImg, 0);

        // 如果配置了资源
        if (originRef > 0 && maskRef > 0) {
            // 设置Image
            restoreImage();
        }

        array.recycle();
    }

    /**
     * 重置图标
     * @param maskRes
     * @param frontRes
     */
    public void resetImage(int maskRes, int frontRes) {
        this.maskRef = maskRes;
        this.originRef = frontRes;

        restoreImage();
    }

    /**
     * 重设图片
     */
    private void restoreImage() {
        //获取图片的资源文件
        Bitmap origin = getBitmap(getContext(), originRef);
        //获取遮罩层图片
        Bitmap mask = getBitmap(getContext(), maskRef);
        //将遮罩层的图片放到画布中
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_OUT));

        final Bitmap result = Bitmap.createBitmap(mask.getWidth(), mask.getHeight(), Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(result);

        int leftOffset = (origin.getWidth() - mask.getWidth()) / 2;
        int topOffset = (origin.getHeight() - mask.getHeight()) / 2;

        //设置两张图片相交时的模式
        canvas.drawBitmap(origin, -leftOffset, -topOffset, null);
        canvas.drawBitmap(mask, 0, 0, paint);
        paint.setXfermode(null);
        setScaleType(ScaleType.FIT_CENTER);

        LogUtil.d(TAG, "更新图片: %d * %d, mask: %d * %d, target: %d * %d",
                result.getWidth(), result.getHeight(), mask.getWidth(), mask.getHeight(),
                origin.getWidth(), origin.getHeight());
        setImageBitmap(result);
    }

    /**
     * Android 5.0以上支持VectorDrawable，所以不能直接decodeResource
     * @param context
     * @param vectorDrawableId
     * @return
     */
    private static Bitmap getBitmap(Context context,int vectorDrawableId) {
        Bitmap bitmap;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP){
            Drawable vectorDrawable = context.getDrawable(vectorDrawableId);
            bitmap = Bitmap.createBitmap(vectorDrawable.getIntrinsicWidth(),
                    vectorDrawable.getIntrinsicHeight(), Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            vectorDrawable.setBounds(0, 0, canvas.getWidth(), canvas.getHeight());
            vectorDrawable.draw(canvas);
        }else {
            bitmap = BitmapFactory.decodeResource(context.getResources(), vectorDrawableId);
        }
        return bitmap;
    }
}
