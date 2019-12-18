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
import android.util.AttributeSet;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.RelativeLayout;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.common.utils.ContextUtil;

public class HeadControlPanel extends RelativeLayout {

	private TextView mMidleTitle;
	private ImageView infoIcon;
	private ImageView backIcon;
	private LinearLayout headMenuLayout;
	private static final float middle_title_size = 20f;

	public HeadControlPanel(Context context, AttributeSet attrs) {
		super(context, attrs);
		// TODO Auto-generated constructor stub
	}

	@Override
	protected void onFinishInflate() {
		// TODO Auto-generated method stub
		mMidleTitle = (TextView)findViewById(R.id.midle_title);
		infoIcon = (ImageView) findViewById(R.id.info_icon);
		backIcon = (ImageView) findViewById(R.id.back_icon);
		headMenuLayout = (LinearLayout) findViewById(R.id.head_info_menu_layout);

		backIcon.setVisibility(GONE);
		infoIcon.setVisibility(GONE);

		setBackgroundColor(getContext().getResources().getColor(R.color.colorPrimary));
		super.onFinishInflate();
	}

    /**
     * 左侧添加菜单
     * @param v
     */
    public void addMenuFromLeft(View v) {
        ViewGroup.LayoutParams params = v.getLayoutParams();
        LinearLayout.LayoutParams real;
        if (params != null) {
            if (params instanceof LinearLayout.LayoutParams) {
                real = (LinearLayout.LayoutParams) params;
            } else {
                real = new LinearLayout.LayoutParams(params);
            }
        } else {
            real = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        }

        // 保证右侧4DP间距
        real.setMarginEnd(ContextUtil.dip2px(getContext(), 8));
        v.setLayoutParams(real);

        headMenuLayout.addView(v, 0);
    }

    /**
     * 右侧添加菜单
     * @param v
     */
    public void addMenuFromRight(View v) {
        ViewGroup.LayoutParams params = v.getLayoutParams();
        LinearLayout.LayoutParams real;
        if (params != null) {
            if (params instanceof LinearLayout.LayoutParams) {
                real = (LinearLayout.LayoutParams) params;
            } else {
                real = new LinearLayout.LayoutParams(params);
            }
        } else {
            real = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        }

        // 保证左侧4DP间距
        real.setMarginStart(ContextUtil.dip2px(getContext(), 8));
        v.setLayoutParams(real);

        headMenuLayout.addView(v);
    }


    public void setMiddleTitle(String s){
		mMidleTitle.setText(s);
		mMidleTitle.setTextSize(middle_title_size);
	}

	public void setBackIconClickListener(OnClickListener listener) {
		backIcon.setImageResource(R.drawable.back_angel);
		backIcon.setVisibility(VISIBLE);
		backIcon.setOnClickListener(listener);
	}

	public void setLeftIconClickListener(int drawableId, OnClickListener listener) {
		backIcon.setImageResource(drawableId);
		backIcon.setVisibility(VISIBLE);
		backIcon.setOnClickListener(listener);
	}

	public void setInfoIconClickListener(int drawableId,OnClickListener listener) {
		infoIcon.setImageResource(drawableId);
		infoIcon.setVisibility(VISIBLE);
		infoIcon.setOnClickListener(listener);
	}



}
