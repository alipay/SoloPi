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
import android.provider.Settings;
import android.support.annotation.Nullable;
import android.support.design.widget.TabLayout;
import android.support.v4.app.Fragment;
import android.support.v4.app.FragmentManager;
import android.support.v4.app.FragmentPagerAdapter;
import android.support.v4.view.ViewPager;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.adapter.BatchExecutionListAdapter;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.fragment.BatchExecutionFragment;
import com.alipay.hulu.replay.BatchStepProvider;
import com.alipay.hulu.service.CaseReplayManager;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.ui.HeadControlPanel;
import com.zhy.view.flowlayout.FlowLayout;
import com.zhy.view.flowlayout.TagAdapter;
import com.zhy.view.flowlayout.TagFlowLayout;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Created by lezhou.wyl on 2018/8/19.
 */
public class BatchExecutionActivity extends BaseActivity
        implements BatchExecutionListAdapter.Delegate , TagFlowLayout.OnTagClickListener{

    private ViewPager mPager;
    private CheckBox mRestartApp;
    private TabLayout mTabLayout;
    private HeadControlPanel mHeadPanel;
    private TagFlowLayout tagGroup;
    private final List<RecordCaseInfo> currentCases = new ArrayList<>();
    private TagAdapter<RecordCaseInfo> tagAdapter;

    private Button startExecutionBtn;

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

        // 选择项
        currentCases.clear();
        tagAdapter = new TagAdapter<RecordCaseInfo>(currentCases) {
            @Override
            public View getView(FlowLayout parent, int position, RecordCaseInfo o) {
                View tag = LayoutInflater.from(BatchExecutionActivity.this).inflate(R.layout.item_batch_execute_tag, parent, false);
                TextView title = (TextView) tag.findViewById(R.id.batch_execute_tag_name);
                title.setText(o.getCaseName());
                return tag;
            }
        };
        tagGroup = (TagFlowLayout) findViewById(R.id.batch_execute_tag_group);
        tagGroup.setMaxSelectCount(0);
        tagGroup.setAdapter(tagAdapter);
        tagGroup.setOnTagClickListener(this);

        CustomPagerAdapter pagerAdapter = new CustomPagerAdapter(getSupportFragmentManager());
        mPager.setAdapter(pagerAdapter);
        mRestartApp = (CheckBox) findViewById(R.id.batch_execute_restart);

        startExecutionBtn = (Button) findViewById(R.id.batch_execute_start_btn);

        startExecutionBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (currentCases.size() == 0) {
                    toastShort("请选择用例");
                    return;
                }

                PermissionUtil.OnPermissionCallback callback = new PermissionUtil.OnPermissionCallback() {
                    @Override
                    public void onPermissionResult(boolean result, String reason) {
                        if (result) {
                            BatchStepProvider provider = new BatchStepProvider(new ArrayList<>(currentCases), mRestartApp.isChecked());
                            CaseReplayManager manager = LauncherApplication.getInstance().findServiceByName(CaseReplayManager.class.getName());
                            manager.start(provider, MyApplication.MULTI_REPLAY_LISTENER);
                        }
                    }
                };
                checkPermissions(callback);
            }
        });

    }

    @Override
    public void onItemAdd(RecordCaseInfo caseInfo) {
        currentCases.add(caseInfo);
        updateExecutionTag();
    }

    public void updateExecutionTag() {
        tagAdapter.notifyDataChanged();
    }

    @Override
    public boolean onTagClick(View view, int position, FlowLayout parent) {
        currentCases.remove(position);
        updateExecutionTag();
        return false;
    }

    /**
     * 检察权限
     * @param callback
     */
    private void checkPermissions(PermissionUtil.OnPermissionCallback callback) {
        // 高权限，悬浮窗权限判断
        PermissionUtil.requestPermissions(Arrays.asList("adb", Settings.ACTION_ACCESSIBILITY_SETTINGS),
                this, callback);
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