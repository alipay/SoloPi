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
import android.view.View;

import com.alipay.hulu.R;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.fragment.LocalReplayResultListFragment;
import com.alipay.hulu.ui.HeadControlPanel;
import com.google.android.material.tabs.TabLayout;

import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.fragment.app.FragmentManager;
import androidx.fragment.app.FragmentPagerAdapter;
import androidx.viewpager.widget.ViewPager;

public class LocalReplayResultActivity extends BaseActivity {
    private HeadControlPanel panel;
    private TabLayout tabLayout;
    private ViewPager viewPager;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_replay_result);

        initView();

        initControl();
    }

    private void initView() {
        panel = _findViewById(R.id.head_replay_list);
        tabLayout = findViewById(R.id.replay_result_tab);
        viewPager = findViewById(R.id.replay_result_list_pager);
    }

    private void initControl() {
        InjectorService.g().register(this);
        panel.setMiddleTitle(getString(R.string.activity_local_replay_result_title));
        panel.setBackIconClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });

        viewPager.addOnPageChangeListener(new TabLayout.TabLayoutOnPageChangeListener(tabLayout));
        tabLayout.setupWithViewPager(viewPager);
        tabLayout.setTabGravity(TabLayout.GRAVITY_FILL);
        tabLayout.setTabMode(TabLayout.MODE_FIXED);
        tabLayout.setSelectedTabIndicatorColor(getResources().getColor(R.color.mainBlue));
        tabLayout.post(new Runnable() {
            @Override
            public void run() {
                MiscUtil.setIndicator(tabLayout, 0, 0);
            }
        });

        LocalReplayResultPagerAdapter pagerAdapter = new LocalReplayResultPagerAdapter(getSupportFragmentManager());
        viewPager.setAdapter(pagerAdapter);
        viewPager.setOffscreenPageLimit(2);
    }

    private static class LocalReplayResultPagerAdapter extends FragmentPagerAdapter {

        private static final int[] PAGES = LocalReplayResultListFragment.getAvailableTypes();

        public LocalReplayResultPagerAdapter(FragmentManager fm) {
            super(fm);
        }

        @Override
        public Fragment getItem(int position) {
            return LocalReplayResultListFragment.newInstance(PAGES[position]);
        }

        @Override
        public CharSequence getPageTitle(int position) {
            return LocalReplayResultListFragment.getTypeName(PAGES[position]);
        }
        @Override
        public int getCount() {
            return PAGES.length;
        }
    }
}
