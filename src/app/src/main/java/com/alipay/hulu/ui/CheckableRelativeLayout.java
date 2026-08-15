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
import android.graphics.Color;
import android.os.Build;
import android.util.AttributeSet;
import android.view.View;
import android.widget.Checkable;
import android.widget.CompoundButton;
import android.widget.RelativeLayout;

import com.alipay.hulu.R;
import com.alipay.hulu.common.utils.LogUtil;

/**
 * Created by cathor on 2017/12/13.
 */
public class CheckableRelativeLayout extends RelativeLayout implements Checkable {
    private static final String TAG = "CheckableRelativeLayout";

    private boolean mChecked = false;
    CompoundButton mCompoundButton = null;
    private boolean isInitialized = false;
    private int selectedColor = -1;

    private OnCheckedChangeListener _listener;

    public CheckableRelativeLayout(Context context) {
        this(context, null);
    }

    public CheckableRelativeLayout(Context context, AttributeSet attrs) {
        this(context, attrs, 0);
    }

    public CheckableRelativeLayout(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
        readAttrs(context, attrs);
    }

    @TargetApi(Build.VERSION_CODES.LOLLIPOP)
    public CheckableRelativeLayout(Context context, AttributeSet attrs, int defStyleAttr, int defStyleRes) {
        super(context, attrs, defStyleAttr, defStyleRes);
        readAttrs(context, attrs);
    }

    private void readAttrs(Context context, AttributeSet attrs) {
        TypedArray a = context.obtainStyledAttributes(attrs,
                R.styleable.CheckableRelativeLayout);
        selectedColor = a.getColor(R.styleable.CheckableRelativeLayout_selectColor,
                getContext().getResources().getColor(R.color.colorAccentTransparent));
        a.recycle();
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        isInitialized = true;
        for (int i = 0; i < getChildCount(); i++) {
            // 根据资源类型
            View v = getChildAt(i);

            LogUtil.i(TAG, "Load view " + v);
            if (v instanceof CompoundButton) {
                mCompoundButton = (CompoundButton) v;
                mCompoundButton.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
                    @Override
                    public void onCheckedChanged(CompoundButton buttonView, boolean isChecked) {
                        // 有子button的，在子button上触发
                        if (_listener != null) {
                            _listener.onCheckedChanged(CheckableRelativeLayout.this, isChecked);
                        }
                        mChecked = isChecked;
                    }
                });
                break;
            }
        }
        setChecked(mChecked);
    }


    @Override
    public void setChecked(boolean checked) {
        mChecked = checked;
        if (isInitialized) {
            if (mCompoundButton != null) {
                mCompoundButton.setChecked(mChecked);
            } else {
                // 没有子button的直接触发
                if (_listener != null) {
                    _listener.onCheckedChanged(this, mChecked);
                }
                if (mChecked) {
                    setBackgroundColor(selectedColor);
                } else {
                    setBackgroundColor(Color.TRANSPARENT);
                }
            }
        }
    }

    public void setOnCheckedChangeListener(OnCheckedChangeListener listener) {
        _listener = listener;
    }

    @Override
    public boolean isChecked() {
        return mChecked;
    }

    @Override
    public void toggle() {
        setChecked(!mChecked);
    }

    public interface OnCheckedChangeListener {
        void onCheckedChanged(CheckableRelativeLayout checkable, boolean isChecked);
    }
}
