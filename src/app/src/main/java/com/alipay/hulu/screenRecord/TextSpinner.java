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
package com.alipay.hulu.screenRecord;

import android.annotation.TargetApi;
import android.content.Context;
import android.content.res.TypedArray;
import android.os.Build;
import android.util.AttributeSet;
import android.util.TypedValue;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.SpinnerAdapter;
import android.widget.TextView;

import com.alipay.hulu.R;

public class TextSpinner extends LinearLayout {
    private TextView mTitleView;
    private Spinner mSpinner;
    private OnItemSelectedListener mListener;

    public TextSpinner(Context context) {
        this(context, null);
    }

    public TextSpinner(Context context, AttributeSet attrs) {
        this(context, attrs, 0);
    }

    public TextSpinner(Context context, AttributeSet attrs, int defStyleAttr) {
        this(context, attrs, defStyleAttr, 0);
    }

    @TargetApi(Build.VERSION_CODES.LOLLIPOP)
    public TextSpinner(Context context, AttributeSet attrs, int defStyleAttr, int defStyleRes) {
        super(context, attrs, defStyleAttr, defStyleRes);
        setOrientation(HORIZONTAL);
        mTitleView = new TextView(context);
        mSpinner = new Spinner(context, Spinner.MODE_DROPDOWN);
        mSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                TextSpinner.this.onItemSelected(position);
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
            }
        });
        TypedArray a = context.obtainStyledAttributes(attrs, R.styleable.TextSpinner, defStyleAttr, defStyleRes);
        final CharSequence[] entries = a.getTextArray(R.styleable.TextSpinner_entries);
        if (entries != null) {
            final ArrayAdapter<CharSequence> adapter = new ArrayAdapter<>(
                    context, android.R.layout.simple_spinner_item, entries);
            adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
            mSpinner.setAdapter(adapter);
        }
        int textAppearance = a.getResourceId(R.styleable.TextSpinner_textAppearance,
                android.R.style.TextAppearance_DeviceDefault_Medium);
        CharSequence title = a.getText(R.styleable.TextSpinner_name);
        mTitleView.setTextAppearance(context, textAppearance);
        setName(title);
        LayoutParams titleParams = generateDefaultLayoutParams();
        float _16 = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 16f, context.getResources().getDisplayMetrics());
        titleParams.setMarginEnd(Math.round(_16));
        addViewInLayout(mTitleView, -1, titleParams, true);
        addViewInLayout(mSpinner, -1, generateDefaultLayoutParams(), true);

        a.recycle();
    }

    public void setName(CharSequence text) {
        if (text == null) {
            text = "";
        }
        mTitleView.setText(text);
        mSpinner.setPrompt(text);
    }

    public void setAdapter(SpinnerAdapter adapter) {
        mSpinner.setAdapter(adapter);
    }

    public SpinnerAdapter getAdapter() {
        return mSpinner.getAdapter();
    }

    public <T> T getSelectedItem() throws ClassCastException {
        return (T) mSpinner.getSelectedItem();
    }

    public void setSelectedPosition(int position) {
        mSpinner.setSelection(position, false);
    }

    public int getSelectedItemPosition() {
        return mSpinner.getSelectedItemPosition();
    }

    public void setOnItemSelectedListener(OnItemSelectedListener l) {
        mListener = l;
    }

    private void onItemSelected(int position) {
        if (mListener != null) {
            mListener.onItemSelected(this, position);
        }
    }


    public interface OnItemSelectedListener {
        void onItemSelected(TextSpinner view, int position);
    }
}
