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
package com.alipay.hulu.fragment;

import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ListView;
import android.widget.TextView;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONReader;
import com.alibaba.fastjson.TypeReference;
import com.alipay.hulu.R;
import com.alipay.hulu.activity.CaseReplayResultActivity;
import com.alipay.hulu.adapter.LocalTaskResultListAdapter;
import com.alipay.hulu.bean.CaseStepHolder;
import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.bean.ReplayStepInfoBean;
import com.alipay.hulu.common.bean.DeviceInfo;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;

import java.io.File;
import java.io.FileFilter;
import java.io.FileInputStream;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

import androidx.annotation.Nullable;
import androidx.collection.ArrayMap;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

public class LocalReplayResultListFragment extends BaseFragment {
    private static final String TAG = "LocalResultListFrag";
    private static final String KEY_ARG_FRAGMENT_TYPE = "KEY_ARG_FRAGMENT_TYPE";

    public static final int KEY_LIST_TYPE_LOCAL = 0;

    private int type;
    private ListView mListView;
    private SwipeRefreshLayout refreshLayout;
    private View mEmptyView;
    private TextView mEmptyTextView;
    private LocalTaskResultListAdapter mAdapter;
    private List<ReplayResultBean> localResultList;

    public static LocalReplayResultListFragment newInstance(int type) {
        LocalReplayResultListFragment fragment = new LocalReplayResultListFragment();
        Bundle args = new Bundle();
        args.putInt(KEY_ARG_FRAGMENT_TYPE, type);
        fragment.setArguments(args);
        return fragment;
    }

    public static int[] getAvailableTypes() {
        return new int[] {KEY_LIST_TYPE_LOCAL};
    }

    public static String getTypeName(int type) {
        if (type == KEY_LIST_TYPE_LOCAL) {
            return StringUtil.getString(R.string.replay_list__local);
        }

        return null;
    }

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Bundle bundle = getArguments();
        if (bundle == null) {
            return;
        }
        type = bundle.getInt(KEY_ARG_FRAGMENT_TYPE);
    }

    @Nullable
    @Override
    public View onCreateView(LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_replay_list, container, false);
    }

    @Override
    public void onViewCreated(View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        initEmptyView(view);
        initListView(view);

        // 读取用例
        if (type == KEY_LIST_TYPE_LOCAL) {
            getReplayResultFromFile(null);
        }
    }

    private void getReplayResultFromFile(final Runnable r) {
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                File root = FileUtils.getSubDir("replay");
                File[] subDirs = root.listFiles(new FileFilter() {
                    @Override
                    public boolean accept(File pathname) {
                        return pathname.isDirectory() && new File(pathname, "info.json").exists();
                    }
                });

                if (subDirs == null || subDirs.length == 0) {
                    localResultList = null;
                    getActivity().runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (r != null) {
                                r.run();
                            }
                            mListView.setVisibility(View.GONE);
                            mEmptyView.setVisibility(View.VISIBLE);
                        }
                    });
                    return;
                }

                List<ReplayResultBean> resultBeans = new ArrayList<>(subDirs.length + 1);
                for (File folder: subDirs) {
                    File info = new File(folder, "info.json");
                    try {
                        ReplayResultBean result = JSON.parseObject(new FileInputStream(info), ReplayResultBean.class);
                        result.setBaseDir(folder);
                        File deviceInfo = new File(folder, "device.json");
                        if (deviceInfo.exists()) {
                            result.setDeviceInfo((DeviceInfo) JSON.parseObject(new FileInputStream(deviceInfo), DeviceInfo.class));
                        }
                        resultBeans.add(result);
                    } catch (IOException e) {
                        LogUtil.w(TAG, "Fail to load result info in folder " + folder, e);
                    }
                }

                // 按创建时间排序
                Collections.sort(resultBeans, new Comparator<ReplayResultBean>() {
                    @Override
                    public int compare(ReplayResultBean o1, ReplayResultBean o2) {
                        return o2.getStartTime().compareTo(o1.getStartTime());
                    }
                });

                localResultList = resultBeans;

                getActivity().runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (r != null) {
                            r.run();
                        }
                        if (localResultList != null && localResultList.size() > 0) {
                            mAdapter.setData(localResultList);
                            mListView.setVisibility(View.VISIBLE);
                            mEmptyView.setVisibility(View.GONE);
                        } else {
                            mListView.setVisibility(View.GONE);
                            mEmptyView.setVisibility(View.VISIBLE);
                        }
                    }
                });
            }
        });
    }

    private void initListView(View view) {
        refreshLayout = view.findViewById(R.id.replay_swipe_refresh);
        refreshLayout.setOnRefreshListener(new SwipeRefreshLayout.OnRefreshListener() {
            @Override
            public void onRefresh() {
                Runnable r = new Runnable() {
                    @Override
                    public void run() {
                        refreshLayout.setRefreshing(false);
                    }
                };

                // 读取用例
                if (type == KEY_LIST_TYPE_LOCAL) {
                    getReplayResultFromFile(r);
                }
            }
        });

        mListView = view.findViewById(R.id.replay_list);
        mAdapter = new LocalTaskResultListAdapter(getContext());

        mListView.setAdapter(mAdapter);

        // 默认点击编辑
        mListView.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                showReplayResult(position);
            }
        });

        // 长按删除
        mListView.setOnItemLongClickListener(new AdapterView.OnItemLongClickListener() {
            @Override
            public boolean onItemLongClick(AdapterView<?> parent, View view, final int position, long id) {
                new AlertDialog.Builder(getActivity())
                        .setMessage(R.string.replay_result__delete_item)
                        .setNegativeButton(R.string.constant__cancel, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {

                            }
                        })
                        .setPositiveButton(R.string.constant__confirm, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                deleteResult(position);
                            }
                        })
                        .show();
                return true;
            }
        });
    }

    /**
     * 删除回放结果
     * @param position
     */
    private void deleteResult(int position) {

        if (type == KEY_LIST_TYPE_LOCAL) {
            ReplayResultBean result = localResultList.get(position);
            File baseDir = result.getBaseDir();
            if (baseDir != null && baseDir.exists()) {
                try {
                    FileUtils.deleteDirectory(baseDir);
                    getReplayResultFromFile(null);
                } catch (IOException e) {
                    LogUtil.e(TAG, "Fail delete folder " + baseDir, e);
                    toastShort("删除回放文件失败，请尝试手动删除");
                }
            }
        }
    }

    private void initEmptyView(View view) {
        mEmptyView = view.findViewById(R.id.empty_view_container);
        mEmptyTextView = view.findViewById(R.id.empty_text);
        mEmptyTextView.setText(R.string.replay_result__no_history);
    }

    /**
     * 展示回放结果
     * @param position
     */
    private void showReplayResult(int position) {
        ReplayResultBean resultBean = localResultList.get(position);
        File baseDir = resultBean.getBaseDir();
        try {
            Map<Integer, ReplayStepInfoBean> actionLogs = new JSONReader(new FileReader(new File(baseDir, "actions.json"))).readObject(new TypeReference<Map<Integer, ReplayStepInfoBean>>() {});
            resultBean.setActionLogs(actionLogs);
        } catch (IOException e) {
            LogUtil.e(TAG, "Fail to find ", e);
        }

        File targetFile = new File(baseDir, "running.log");
        resultBean.setLogFile(targetFile.getPath());

        File steps = new File(baseDir, "steps.json");
        try {
            List<OperationStep> operations = new JSONReader(new FileReader(steps)).readObject(new TypeReference<List<OperationStep>>() {});
            resultBean.setCurrentOperationLog(operations);
        } catch (IOException e) {
            LogUtil.e(TAG, "Fail to find ", e);
        }

        List<CaseReplayResultActivity.ScreenshotBean> screenshotBeans = resultBean.getScreenshots();
        if (screenshotBeans != null) {
            ArrayMap<String, String> screenshots = new ArrayMap<>();
            for (CaseReplayResultActivity.ScreenshotBean screenshot: screenshotBeans) {
                screenshots.put(screenshot.getName(), new File(baseDir, screenshot.getFile()).getPath());
            }
            resultBean.setScreenshotFiles(screenshots);
        }

        Intent intent = new Intent(getActivity(), CaseReplayResultActivity.class);

        // 通过Holder中转
        int storeId = CaseStepHolder.storeResult(resultBean);
        intent.putExtra("data", storeId);
        startActivity(intent);
    }
}
