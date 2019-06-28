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
package com.alipay.hulu.activity;

import android.content.Intent;
import android.content.res.Resources;
import android.os.Bundle;
import android.support.annotation.Nullable;
import android.support.design.widget.TabLayout;
import android.support.v4.app.Fragment;
import android.support.v4.app.FragmentManager;
import android.support.v4.app.FragmentPagerAdapter;
import android.support.v4.view.ViewPager;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.util.TypedValue;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.bean.CaseStepHolder;
import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.fragment.ReplayLogFragment;
import com.alipay.hulu.fragment.ReplayMainResultFragment;
import com.alipay.hulu.fragment.ReplayScreenShotFragment;
import com.alipay.hulu.fragment.ReplayStepFragment;
import com.alipay.hulu.ui.HeadControlPanel;

import java.lang.reflect.Field;
import java.text.SimpleDateFormat;
import java.util.Locale;

public class CaseReplayResultActivity extends BaseActivity {
    private static final String TAG = "CaseActivity";

    private ViewPager mPager;
    private TabLayout mTabLayout;
    private HeadControlPanel mHeadPanel;

    private TextView mCaseName;
    private TextView mTargetApp;
    private TextView mStartTime;
    private TextView mEndTime;
    private TextView mStatus;

    private ReplayResultBean result;

    private ReplayResultFragmentAdapter mAdapter;


    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        initView();
        initData();
    }


    private void initView() {
        setContentView(R.layout.activity_display_replay_result);
        mPager = (ViewPager) findViewById(R.id.pager);
        mTabLayout = (TabLayout) findViewById(R.id.tab_layout);
        mHeadPanel = (HeadControlPanel) findViewById(R.id.head_replay_result);
        mCaseName = (TextView) findViewById(R.id.case_name);
        mTargetApp = (TextView) findViewById(R.id.target_app);
        mStartTime = (TextView) findViewById(R.id.start_time);
        mEndTime = (TextView) findViewById(R.id.end_time);
        mStatus = (TextView) findViewById(R.id.case_status);
    }

    private void initData() {
        mHeadPanel.setMiddleTitle("回放结果");
        mHeadPanel.setBackIconClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                CaseReplayResultActivity.this.finish();
            }
        });

        mPager.addOnPageChangeListener(new TabLayout.TabLayoutOnPageChangeListener(mTabLayout));
        mTabLayout.setupWithViewPager(mPager);
        mTabLayout.setTabGravity(TabLayout.GRAVITY_FILL);
        mTabLayout.setTabMode(TabLayout.MODE_FIXED);
        mTabLayout.setSelectedTabIndicatorColor(getResources().getColor(R.color.mainBlue));
        mTabLayout.post(new Runnable() {
            @Override
            public void run() {
                setIndicator(mTabLayout, 0, 0);
            }
        });


        Intent intent = getIntent();
        int id = intent.getIntExtra("data", 0);
        result = CaseStepHolder.getResult(id);
        if (result == null) {
            return;
        }

        mCaseName.setText(getString(R.string.case_replay_result__case_name, result.getCaseName()));
        mTargetApp.setText(getString(R.string.case_replay_result__targe_app, result.getTargetApp()));

        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.CHINA);
        mStartTime.setText(getString(R.string.case_replay_result__start_time, format.format(result.getStartTime())));
        mEndTime.setText(getString(R.string.case_replay_result__end_time, format.format(result.getEndTime())));
        try {
            SpannableString textSpanned1 = new SpannableString(getString(R.string.case_replay_result__running_result, result.getExceptionMessage() != null? "失败" : "成功"));
            textSpanned1.setSpan(new ForegroundColorSpan(result.getExceptionMessage() != null ? 0xfff76262 : 0xff65c0ba), 5, 7, Spanned.SPAN_INCLUSIVE_EXCLUSIVE);
            mStatus.setText(textSpanned1);
        } catch (Exception e) {
            LogUtil.e(TAG, e.getMessage(), e);
        }

        mAdapter = new ReplayResultFragmentAdapter(getSupportFragmentManager(), result);
        mPager.setAdapter(mAdapter);
    }

    private void setIndicator(TabLayout tabs, int leftDip, int rightDip) {
        Class<?> tabLayout = tabs.getClass();
        Field tabStrip;
        try {
            tabStrip = tabLayout.getDeclaredField("mTabStrip");
        } catch (NoSuchFieldException e) {
            return;
        }

        tabStrip.setAccessible(true);
        LinearLayout llTab;
        try {
            llTab = (LinearLayout) tabStrip.get(tabs);
        } catch (IllegalAccessException e) {
            return;
        }

        int left = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, leftDip, Resources.getSystem().getDisplayMetrics());
        int right = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, rightDip, Resources.getSystem().getDisplayMetrics());

        for (int i = 0; i < llTab.getChildCount(); i++) {
            View child = llTab.getChildAt(i);
            child.setPadding(0, 0, 0, 0);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1);
            params.leftMargin = left;
            params.rightMargin = right;
            child.setLayoutParams(params);
            child.invalidate();
        }
    }

    private static class ReplayResultFragmentAdapter extends FragmentPagerAdapter {
        private ReplayResultBean resultBean;
        public ReplayResultFragmentAdapter(FragmentManager fm, ReplayResultBean resultBean) {
            super(fm);
            this.resultBean = resultBean;
        }

        @Override
        public Fragment getItem(int position) {
            switch (position) {
                case 0:
                    return ReplayMainResultFragment.newInstance(resultBean);
                case 1:
                    return ReplayStepFragment.newInstance(resultBean);
                case 2:
                    return ReplayLogFragment.newInstance(resultBean.getLogFile());
                case 3:
                    return ReplayScreenShotFragment.newInstance(resultBean);
            }
            return null;
        }

        @Override
        public int getCount() {
            return 4;
        }

        @Override
        public CharSequence getPageTitle(int position) {
            switch (position) {
                case 0:
                    return "回放结果";
                case 1:
                    return "用例步骤";
                case 2:
                    return "运行日志";
                case 3:
                    return "用例截图";
            }
            return "";
        }
    }
}
