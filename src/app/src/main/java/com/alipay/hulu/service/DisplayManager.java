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
package com.alipay.hulu.service;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;

import com.alipay.hulu.R;
import com.alipay.hulu.adapter.FloatStressAdapter;
import com.alipay.hulu.adapter.FloatWinAdapter;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.injector.provider.Provider;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.display.DisplayItemInfo;
import com.alipay.hulu.shared.display.DisplayProvider;
import com.alipay.hulu.shared.display.items.base.RecordPattern;
import com.alipay.hulu.ui.RecycleViewDivider;
import com.alipay.hulu.util.RecordUtil;

import java.io.File;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 性能工具加载服务
 * Created by qiaoruikai on 2018/10/15 8:59 PM.
 */
@Provider(@Param(value = DisplayManager.STOP_DISPLAY))
public class DisplayManager {

    private static final String TAG = "DisplayManager";

    public static final String STOP_DISPLAY = "stopDisplay";

    private DisplayProvider provider;

    private List<DisplayItemInfo> currentDisplayInfo = new ArrayList<>();
    private List<String> displayMessages = new ArrayList<>();

    private FloatWinAdapter floatWinAdapter;

    private FloatStressAdapter floatStressAdapter;

    private int runningMode;
    private volatile boolean runningFlag = true;

    private FloatWinService.FloatBinder binder;
    private FloatWinService.OnRunListener runListener;
    private FloatWinService.OnStopListener stopListener = new FloatWinService.OnStopListener() {
        @Override
        public boolean onStopClick() {
            stop();
            return false;
        }
    };

    private ScheduledExecutorService executorService;

    private InjectorService injectorService;

    private RecyclerView floatWinList;

    private RecyclerView floatStressList;

    private View floatStressHide;

    private DisplayConnection connection;

    private static DisplayManager instance;

    /**
     * 获取显示控制实例
     * @return
     */
    public static DisplayManager getInstance() {
        if (instance == null) {
            instance = new DisplayManager();
        }
        return instance;
    }

    private DisplayManager() {
        provider = LauncherApplication.getInstance().findServiceByName(DisplayProvider.class.getName());
        executorService = Executors.newSingleThreadScheduledExecutor();
        runListener = new MyRunningListener(this);
    }

    /**
     * 开始展示数据
     */
    private void start() {
        connection = new DisplayConnection(this);
        Context context = LauncherApplication.getContext();
        injectorService = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());

        runningFlag = true;

        context.bindService(new Intent(context, FloatWinService.class), connection, Context.BIND_AUTO_CREATE);

        // 定时更新
        executorService.schedule(new Runnable() {
            @Override
            public void run() {
                // 如果还在运行
                if (runningFlag) {
                    executorService.schedule(this, 500, TimeUnit.MILLISECONDS);
                }

                updateDisplayInfo();
            }
        }, 500, TimeUnit.MILLISECONDS);

    }

    /**
     * 停止展示数据
     */
    private void stop() {
        runningFlag = false;

        // 停掉Provider
        LauncherApplication.getInstance().stopServiceByName(DisplayProvider.class.getName());

        if (connection != null) {
            LauncherApplication.getContext().unbindService(connection);
            connection = null;
            binder = null;
        } else {

        }

        // 发送停止显示消息
        injectorService.pushMessage(STOP_DISPLAY, null, false);
        injectorService.unregister(this);

        this.displayMessages.clear();
        this.currentDisplayInfo.clear();
    }

    /**
     * 更新记录项
     *
     * @param newItems
     * @param removeItems
     * @return
     */
    public synchronized List<DisplayItemInfo> updateRecordingItems(List<DisplayItemInfo> newItems, List<DisplayItemInfo> removeItems) {
        List<DisplayItemInfo> newInfos = new ArrayList<>(currentDisplayInfo);
        if (removeItems != null && removeItems.size() > 0) {
            for (DisplayItemInfo remove : removeItems) {
                provider.stopDisplay(remove.getName());
            }

            newInfos.removeAll(removeItems);
        }


        // 添加显示项
        List<DisplayItemInfo> failed = new ArrayList<>();
        if (newItems != null && newItems.size() > 0) {
            for (DisplayItemInfo info : newItems) {
                boolean result = provider.startDisplay(info.getKey());

                // 失败项将取消
                if (result) {
                    newInfos.add(info);
                } else {
                    failed.add(info);
                }
            }
        }

        // 直接替换，防止更新出现问题
        currentDisplayInfo = newInfos;

        // 开始绑定
        if (connection == null && currentDisplayInfo.size() > 0) {
            start();
        } else if (connection != null && currentDisplayInfo.size() == 0) {
            stop();
        }

        return failed;
    }

    /**
     * 更新显示信息
     */
    private void updateDisplayInfo() {
        if (runningMode == DisplayProvider.DISPLAY_MODE) {
            displayMessages.clear();
            for (DisplayItemInfo info : currentDisplayInfo) {
                displayMessages.add(provider.getDisplayContent(info.getName()));
            }

            LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    floatWinAdapter.updateListViewSource(currentDisplayInfo, displayMessages);
                }
            });
        }
    }

    /**
     * 触发显示项
     * @param info
     */
    public void triggerInfo(DisplayItemInfo info) {
        if (currentDisplayInfo.contains(info)) {
            provider.triggerItem(info.getName());
        } else {
            LogUtil.w(TAG, "显示项【%s】不可用", info);
        }
    }

    /**
     * 开始录制
     */
    private void startRecord() {
        this.runningMode = DisplayProvider.RECORDING_MODE;
        provider.startRecording();
        binder.provideDisplayView(null, null);
    }

    private void stopRecord() {
        this.runningMode = DisplayProvider.DISPLAY_MODE;
        final Map<RecordPattern, List<RecordPattern.RecordItem>> result = provider.stopRecording();

        binder.provideDisplayView(provideMainView(binder.loadServiceContext()),
                new LinearLayout.LayoutParams(binder.loadServiceContext().getResources().getDimensionPixelSize(R.dimen.control_float_title_width),
                ViewGroup.LayoutParams.WRAP_CONTENT));

        final String uploadUrl = SPService.getString(SPService.KEY_PERFORMANCE_UPLOAD, null);
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                if (StringUtil.isEmpty(uploadUrl)) {
                    // 存储录制数据
                    File folder = RecordUtil.saveToFile(result);

                    // 显示提示框
                    LauncherApplication.getInstance().showDialog(binder.loadServiceContext(), StringUtil.getString(R.string.performance__record_save, folder.getPath()) , StringUtil.getString(R.string.constant__confirm), null);
                } else {
                    String response = RecordUtil.uploadData(uploadUrl, result);
                    LauncherApplication.getInstance().showDialog(binder.loadServiceContext(), StringUtil.getString(R.string.performance__record_upload,  uploadUrl, response), StringUtil.getString(R.string.constant__confirm), null);
                }
            }
        });
    }

    /**
     * 提供主界面
     * @param context
     * @return
     */
    private View provideMainView(Context context) {
        if (runningMode == DisplayProvider.RECORDING_MODE) {
            return null;
        }
        View root = LayoutInflater.from(context).inflate(R.layout.display_main_layout, null);
        floatWinList = root.findViewById(R.id.float_recycler_view);
        floatWinList.setLayoutManager(new LinearLayoutManager(context));
        floatWinList.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View v, MotionEvent event) {
                return false;
            }
        });

        floatWinAdapter = new FloatWinAdapter(context, this, currentDisplayInfo);
        floatWinList.setAdapter(floatWinAdapter);
        // 添加分割线
        floatWinList.addItemDecoration(new RecycleViewDivider(context,
                LinearLayoutManager.HORIZONTAL, 1, context.getResources().getColor(R.color.divider_color)));

        floatStressList = root.findViewById(R.id.float_stress_recycler_view);

        floatStressList.setLayoutManager(new LinearLayoutManager(context));
        floatStressList.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View v, MotionEvent event) {
                return false;
            }
        });

        floatStressAdapter = new FloatStressAdapter(context);
        floatStressList.setAdapter(floatStressAdapter);
        // 添加分割线
        floatStressList.addItemDecoration(new RecycleViewDivider(context,
                LinearLayoutManager.HORIZONTAL, 1, context.getResources().getColor(R.color.divider_color)));

        floatStressHide = root.findViewById(R.id.float_stress_hide);
        floatStressHide.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (floatStressList.getVisibility() == View.VISIBLE) {
                    floatStressHide.setRotation(0);
                    floatStressList.setVisibility(View.GONE);
                } else {
                    floatStressHide.setRotation(180);
                    floatStressList.setVisibility(View.VISIBLE);
                }
            }
        });

        return root;
    }

    private View provideExpendView(Context context) {
        return null;
    }

    private static class DisplayConnection implements ServiceConnection {
        private WeakReference<DisplayManager> reference;

        private DisplayConnection(DisplayManager manager) {
            this.reference = new WeakReference<>(manager);
        }

        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            if (reference.get() == null) {
                return;
            }

            FloatWinService.FloatBinder binder = (FloatWinService.FloatBinder) service;

            DisplayManager manager = reference.get();

            Context context = binder.loadServiceContext();
            manager.floatWinAdapter = new FloatWinAdapter(context, manager, manager.currentDisplayInfo);

            // 提供主界面
            binder.provideDisplayView(manager.provideMainView(context),
                    new LinearLayout.LayoutParams(context.getResources().getDimensionPixelSize(R.dimen.control_float_title_width),
                            ViewGroup.LayoutParams.WRAP_CONTENT));

            // 提供扩展界面
            binder.provideExpendView(manager.provideExpendView(context), null);

            manager.binder = binder;
            binder.registerRunClickListener(manager.runListener);
            binder.registerStopClickListener(manager.stopListener);
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            if (reference.get() == null) {
                return;
            }

            // 设置悬浮窗界面
            FloatWinService.FloatBinder binder = reference.get().binder;

            reference.get().binder = null;

            // 移除无用参数
            binder.provideExpendView(null, null);
            binder.provideDisplayView(null, null);
            binder.registerRunClickListener(null);
            binder.registerStopClickListener(null);

            // 停止悬浮窗
            binder.stopFloat();
        }
    }

    private static class MyRunningListener implements FloatWinService.OnRunListener {
        private WeakReference<DisplayManager> managerRef;

        public MyRunningListener(DisplayManager manager) {
            this.managerRef = new WeakReference<>(manager);
        }

        @Override
        public int onRunClick() {
            if (managerRef.get() == null) {
                LogUtil.e(TAG, "Manager被回收？" );
                return 0;
            }

            // 更新显示图标
            DisplayManager manager = managerRef.get();
            if (manager.runningMode == DisplayProvider.DISPLAY_MODE) {
                manager.startRecord();
                return FloatWinService.RECORDING_ICON;
            } else if (manager.runningMode == DisplayProvider.RECORDING_MODE) {
                manager.stopRecord();
                return FloatWinService.PLAY_ICON;
            }

            return 0;
        }
    }
}
