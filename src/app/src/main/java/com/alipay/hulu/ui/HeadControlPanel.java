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
import android.widget.ImageView;
import android.widget.RelativeLayout;
import android.widget.TextView;

import com.alipay.hulu.R;

public class HeadControlPanel extends RelativeLayout {

	private TextView mMidleTitle;
	private ImageView infoIcon;
	private ImageView backIcon;
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

		backIcon.setVisibility(GONE);
		infoIcon.setVisibility(GONE);

		setBackgroundColor(getContext().getResources().getColor(R.color.colorPrimary));
		super.onFinishInflate();
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

	public void setInfoIconClickListener(int drawableId,OnClickListener listener) {
		infoIcon.setImageResource(drawableId);
		infoIcon.setVisibility(VISIBLE);
		infoIcon.setOnClickListener(listener);
	}



}
