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

import android.os.Bundle;
import android.support.annotation.Nullable;
import android.support.design.widget.TabLayout;
import android.support.v4.app.Fragment;
import android.support.v4.app.FragmentManager;
import android.support.v4.app.FragmentPagerAdapter;
import android.support.v4.view.ViewPager;
import android.view.View;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.fragment.BatchExecutionFragment;
import com.alipay.hulu.ui.HeadControlPanel;
import com.alipay.hulu.common.utils.MiscUtil;

/**
 * Created by lezhou.wyl on 2018/8/19.
 */

public class BatchExecutionActivity extends BaseActivity {

    private ViewPager mPager;
    private TabLayout mTabLayout;
    private HeadControlPanel mHeadPanel;


    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        setContentView(R.layout.activity_batch_execution);

        mPager = (ViewPager) findViewById(R.id.pager);
        mTabLayout = (TabLayout) findViewById(R.id.tab_layout);
        mHeadPanel = (HeadControlPanel) findViewById(R.id.head_replay_list);
        mHeadPanel.setMiddleTitle("批量回放");
        mHeadPanel.setBackIconClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });
        //FIXME 暂时不显示Header
        mHeadPanel.setVisibility(View.GONE);
        mPager.addOnPageChangeListener(new TabLayout.TabLayoutOnPageChangeListener(mTabLayout));
        mTabLayout.setupWithViewPager(mPager);
        mTabLayout.setTabGravity(TabLayout.GRAVITY_FILL);
        mTabLayout.setTabMode(TabLayout.MODE_FIXED);
        mTabLayout.setSelectedTabIndicatorColor(getResources().getColor(R.color.mainBlue));
        mTabLayout.post(new Runnable() {
            @Override
            public void run() {
                MiscUtil.setIndicator(mTabLayout, 0, 0);
            }
        });

        CustomPagerAdapter pagerAdapter = new CustomPagerAdapter(getSupportFragmentManager());
        mPager.setAdapter(pagerAdapter);

    }


    private static class CustomPagerAdapter extends FragmentPagerAdapter {

        private static int[] PAGES = BatchExecutionFragment.getTypes();

        public CustomPagerAdapter(FragmentManager fm) {
            super(fm);
        }

        @Override
        public Fragment getItem(int position) {
            return BatchExecutionFragment.newInstance(PAGES[position]);
        }

        @Override
        public CharSequence getPageTitle(int position) {
            return BatchExecutionFragment.getTypeName(PAGES[position]);
        }
        @Override
        public int getCount() {
            return PAGES.length;
        }
    }



}