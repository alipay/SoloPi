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
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import com.google.android.material.tabs.TabLayout;
import androidx.fragment.app.Fragment;
import androidx.fragment.app.FragmentManager;
import androidx.fragment.app.FragmentPagerAdapter;
import androidx.viewpager.widget.ViewPager;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.R;
import com.alipay.hulu.bean.AdvanceCaseSetting;
import com.alipay.hulu.bean.CaseRunningParam;
import com.alipay.hulu.bean.CaseStepHolder;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.fragment.BaseFragment;
import com.alipay.hulu.fragment.CaseParamSeparateFragment;
import com.alipay.hulu.fragment.CaseParamUnionFragment;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.io.db.GreenDaoManager;
import com.alipay.hulu.ui.HeadControlPanel;

/**
 * Created by qiaoruikai on 2019-08-19 21:16.
 */
public class CaseParamEditActivity extends BaseActivity {
    public static final String RECORD_CASE_EXTRA = "record_case";
    private static final String TAG = CaseParamEditActivity.class.getSimpleName();

    // display
    private TextView mCaseName;
    private TextView mCaseDesc;

    private HeadControlPanel mHead;
    private ViewPager mPager;
    private TabLayout mTabLayout;
    private CaseParamFragmentAdapter mParamAdapter;

    private RecordCaseInfo mRecordCase;
    private AdvanceCaseSetting mSettings;

    private boolean saved = false;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_case_param_edit);

        initView();
        initData();
    }

    /**
     * 渲染数据
     */
    private void initData() {
        int caseId = getIntent().getIntExtra(RECORD_CASE_EXTRA, 0);
        mRecordCase = CaseStepHolder.getCase(caseId);

        // 如果Intent中没有
        if (mRecordCase == null) {
            LogUtil.e(TAG, "There is no record case");
            return;
        }

        mSettings = JSON.parseObject(mRecordCase.getAdvanceSettings(), AdvanceCaseSetting.class);

        mCaseName.setText(mRecordCase.getCaseName());
        mCaseDesc.setText(getString(R.string.case_param_edit__case_desc, mRecordCase.getCaseDesc()));

        mHead.setMiddleTitle(getString(R.string.activity__gen_param_case));
        mHead.setBackIconClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                onBackPressed();
            }
        });

        // 自己的用例
        mHead.setInfoIconClickListener(R.drawable.icon_save, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                saveCase();
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

        mParamAdapter = new CaseParamFragmentAdapter(getSupportFragmentManager(), mSettings);
        mPager.setAdapter(mParamAdapter);
    }

    /**
     * 初始化界面
     */
    private void initView() {
        mHead = (HeadControlPanel) findViewById(R.id.head_layout);

        mCaseName = (TextView) findViewById(R.id.case_param_edit_name);
        mCaseDesc = (TextView) findViewById(R.id.case_param_edit_desc);

        mPager = (ViewPager) findViewById(R.id.case_param_pager);
        mTabLayout = (TabLayout) findViewById(R.id.case_param_tab_layout);
    }

    @Override
    public void onBackPressed() {
        if (!saved) {
            LauncherApplication.getInstance().showDialog(this, getString(R.string.case_edit__should_save_case), getString(R.string.constant__yes), new Runnable() {
                @Override
                public void run() {
                    saveCase();
                    finish();
                }
            }, getString(R.string.constant__no), new Runnable() {
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
     * 保存用例
     */
    private void saveCase() {
        CaseRunningParam param = mParamAdapter.getCurrentFragment().getRunningParam();
        mSettings.setRunningParam(param);
        mRecordCase.setAdvanceSettings(JSON.toJSONString(mSettings));

        updateLocalCase();
    }

    /**
     * 更新本地用例
     */
    private void updateLocalCase() {
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                GreenDaoManager.getInstance().getRecordCaseInfoDao().save(mRecordCase);
                toastShort(getString(R.string.case__update_success));
                InjectorService.g().pushMessage(NewRecordActivity.NEED_REFRESH_LOCAL_CASES_LIST);
                saved = true;
            }
        });
    }

    public static class CaseParamFragmentAdapter extends FragmentPagerAdapter {
        private AdvanceCaseSetting advanceCaseSetting;
        private CaseParamFragment mCurrentFragment;

        public CaseParamFragmentAdapter(FragmentManager fm, AdvanceCaseSetting advanceCaseSetting) {
            super(fm);
            this.advanceCaseSetting = advanceCaseSetting;
        }

        @Override
        public int getCount() {
            return 2;
        }

        @Override
        public Fragment getItem(int position) {
            CaseParamFragment fragment;
            if (position == 0) {
                fragment = new CaseParamSeparateFragment();
            } else {
                fragment = new CaseParamUnionFragment();
            }
            fragment.setAdvanceCaseSetting(advanceCaseSetting);
            return fragment;
        }

        @Override
        public CharSequence getPageTitle(int position) {
            if (position == 0) {
                return "独立模式";
            } else {
                return "联合模式";
            }
        }

        @Override
        public void setPrimaryItem(ViewGroup container, int position, Object object) {
            this.mCurrentFragment = (CaseParamFragment) object;
            super.setPrimaryItem(container, position, object);
        }

        public CaseParamFragment getCurrentFragment() {
            return mCurrentFragment;
        }
    }

    public static abstract class CaseParamFragment extends BaseFragment {
        public abstract void setAdvanceCaseSetting(@NonNull AdvanceCaseSetting advanceCaseSetting);
        public abstract CaseRunningParam getRunningParam();
    }
}