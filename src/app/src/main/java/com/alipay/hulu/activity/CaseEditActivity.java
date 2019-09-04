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
import android.os.Bundle;
import android.support.annotation.Nullable;
import android.support.design.widget.TabLayout;
import android.support.v4.app.Fragment;
import android.support.v4.app.FragmentManager;
import android.support.v4.app.FragmentPagerAdapter;
import android.support.v4.view.ViewPager;
import android.view.View;

import com.alipay.hulu.R;
import com.alipay.hulu.bean.CaseStepHolder;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.fragment.CaseDescEditFragment;
import com.alipay.hulu.fragment.CaseStepEditFragment;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.io.db.GreenDaoManager;
import com.alipay.hulu.ui.HeadControlPanel;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;

/**
 * 用例编辑Activity
 */
public class CaseEditActivity extends BaseActivity {
    private static final String TAG = "CaseEditActivity";

    private RecordCaseInfo mRecordCase;

    public static final String RECORD_CASE_EXTRA = "record_case";

    private List<WeakReference<OnCaseSaveListener>> caseSaveListeners = new ArrayList<>();

    private boolean shouldSave = true;

    private boolean saved = false;

    private HeadControlPanel mHeadPanel;

    private TabLayout tabLayout;
    private ViewPager viewPager;


    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        initView();

        initData();
    }

    /**
     * 初始化界面
     */
    private void initView() {
        setContentView(R.layout.activity_edit_case);
        mHeadPanel = (HeadControlPanel) findViewById(R.id.case_edit_head);

        tabLayout = (TabLayout) findViewById(R.id.case_edit_tab_layout);
        viewPager = (ViewPager) findViewById(R.id.case_edit_pager);
    }

    /**
     * 初始化数据
     */
    private void initData() {
        int caseId = getIntent().getIntExtra(RECORD_CASE_EXTRA, 0);
        mRecordCase = CaseStepHolder.getCase(caseId);

        if (mRecordCase == null) {
            LogUtil.e(TAG, "There is no record case");
            return;
        }

        saved = false;
        caseSaveListeners.clear();
        mHeadPanel.setMiddleTitle(getString(R.string.activity__case_edit));

        mHeadPanel.setBackIconClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                onBackPressed();
            }
        });

        mHeadPanel.setInfoIconClickListener(R.drawable.icon_save, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                updateLocalCase();
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

        CustomPagerAdapter pagerAdapter = new CustomPagerAdapter(getSupportFragmentManager(), this);
        viewPager.setAdapter(pagerAdapter);
    }

    @Override
    public void onBackPressed() {
        if (shouldSave && !saved) {
            LauncherApplication.getInstance().showDialog(this, "是否保存用例", "是", new Runnable() {
                @Override
                public void run() {
                    updateLocalCase();
                    finish();
                }
            }, "否", new Runnable() {
                @Override
                public void run() {
                    finish();
                }
            });
        } else {
            finish();
        }
    }

    /**
     * 包装用例信息
     */
    public void wrapRecordCase() {
        for (WeakReference<OnCaseSaveListener> listenerRef: caseSaveListeners) {
            if (listenerRef.get() != null) {
                listenerRef.get().onCaseSave();
            }
        }
    }

    /**
     * 更新本地用例
     */
    private void updateLocalCase() {
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                wrapRecordCase();
                GreenDaoManager.getInstance().getRecordCaseInfoDao().save(mRecordCase);
                toastShort(getString(R.string.case__update_success));
                InjectorService.g().pushMessage(NewRecordActivity.NEED_REFRESH_LOCAL_CASES_LIST);
                saved = true;
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (resultCode != RESULT_OK) {
            return;
        }
    }

    public RecordCaseInfo getRecordCase() {
        return mRecordCase;
    }

    private static class CustomPagerAdapter extends FragmentPagerAdapter {
        private RecordCaseInfo caseInfo;
        private WeakReference<CaseEditActivity> ref;

        public CustomPagerAdapter(FragmentManager fm, CaseEditActivity activity) {
            super(fm);
            this.caseInfo = activity.mRecordCase;
            ref = new WeakReference<>(activity);
        }

        @Override
        public Fragment getItem(int position) {
            if (position == 1) {
                CaseDescEditFragment fragment = CaseDescEditFragment.getInstance(caseInfo);
                CaseEditActivity activity = ref.get();
                if (activity != null) {
                    activity.caseSaveListeners.add(new WeakReference<OnCaseSaveListener>(fragment));
                }
                return fragment;
            } else {
                CaseStepEditFragment fragment = CaseStepEditFragment.getInstance(caseInfo);
                CaseEditActivity activity = ref.get();
                if (activity != null) {
                    activity.caseSaveListeners.add(new WeakReference<OnCaseSaveListener>(fragment));
                }
                return fragment;
            }
        }

        @Override
        public CharSequence getPageTitle(int position) {
            return position == 1? "用例信息": "用例步骤";
        }
        @Override
        public int getCount() {
            return 2;
        }
    }

    public interface OnCaseSaveListener {
        void onCaseSave();
    }
}
