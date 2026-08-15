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

public class HeadControlPanel extends RelativeLayout {
	public static final int POSITION_CENTER = 0;
	public static final int POSITION_LEFT = 1;
	public static final int POSITION_RIGHT = 2;

	private TextView mMidleTitle;
	private ImageView infoIcon;
	private ImageView backIcon;
	private LinearLayout headMenuLayout;

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

		if (v instanceof ImageView) {
			// 限制为40dp
			if (real.width > 0) {
				real.width = getResources().getDimensionPixelSize(R.dimen.control_dp40);
			}
			if (real.height > 0) {
				real.height = getResources().getDimensionPixelSize(R.dimen.control_dp40);
			}
		}

        // 保证右侧4DP间距
        real.setMarginEnd(getResources().getDimensionPixelSize(R.dimen.control_dp8));
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

        if (v instanceof ImageView) {
			// 限制为40dp
			if (real.width > 0) {
				real.width = getResources().getDimensionPixelSize(R.dimen.control_dp40);
			}
			if (real.height > 0) {
				real.height = getResources().getDimensionPixelSize(R.dimen.control_dp40);
			}
		}

        // 保证左侧4DP间距
        real.setMarginStart(getResources().getDimensionPixelSize(R.dimen.control_dp8));
        v.setLayoutParams(real);

        headMenuLayout.addView(v);
    }


	/**
	 * 设置标题位置
	 * @param position
	 */
	public void setTitlePosition(int position) {
		if (position == POSITION_LEFT) {
			RelativeLayout.LayoutParams layoutParams = (LayoutParams) mMidleTitle.getLayoutParams();
			layoutParams.removeRule(CENTER_IN_PARENT);
			layoutParams.removeRule(LEFT_OF);
			layoutParams.addRule(CENTER_VERTICAL);
			layoutParams.addRule(RIGHT_OF, R.id.back_icon);
			mMidleTitle.setLayoutParams(layoutParams);
		} else if (position == POSITION_CENTER) {
			RelativeLayout.LayoutParams layoutParams = (LayoutParams) mMidleTitle.getLayoutParams();
			layoutParams.addRule(CENTER_IN_PARENT);
			layoutParams.removeRule(CENTER_VERTICAL);
			layoutParams.removeRule(LEFT_OF);
			layoutParams.removeRule(RIGHT_OF);
			mMidleTitle.setLayoutParams(layoutParams);
		} else if (position == POSITION_RIGHT) {
			RelativeLayout.LayoutParams layoutParams = (LayoutParams) mMidleTitle.getLayoutParams();
			layoutParams.removeRule(CENTER_IN_PARENT);
			layoutParams.removeRule(RIGHT_OF);
			layoutParams.addRule(CENTER_VERTICAL);
			layoutParams.addRule(LEFT_OF, R.id.head_info_menu_layout);
			mMidleTitle.setLayoutParams(layoutParams);
		}
	}

    public void setMiddleTitle(String s){
		mMidleTitle.setText(s);
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
