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
package com.alipay.hulu.actions;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.common.annotation.Enable;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.display.DisplayItemInfo;
import com.alipay.hulu.shared.display.DisplayProvider;
import com.alipay.hulu.shared.display.items.base.RecordPattern;
import com.alipay.hulu.shared.node.action.OperationContext;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.provider.ActionProvider;
import com.alipay.hulu.shared.node.action.provider.ViewLoadCallback;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.ui.CheckableRelativeLayout;
import com.alipay.hulu.util.RecordUtil;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Created by qiaoruikai on 2019/1/8 9:02 PM.
 */
@Enable
public class PerformanceActionProvider implements ActionProvider {
    private static final String TAG = "PerformActionPvder";
    private static volatile boolean isRecording = false;

    private static final String ACTION_START_RECORD = "startRecord";

    private static final String ACTION_STOP_RECORD = "stopRecord";

    private static final String CHECK_LIST = "checkList";
    private static final String CHECK_LIST_SPLITTER = ",";

    private static final String UPLOAD_URL = "url";

    private String uploadUrl = null;

    private DisplayProvider displayProvider;

    @Override
    public boolean canProcess(String action) {
        return StringUtil.equals(ACTION_START_RECORD, action)
                || StringUtil.equals(ACTION_STOP_RECORD, action);
    }

    @Override
    public boolean processAction(String targetAction, AbstractNodeTree node, final OperationMethod method,
                                 final OperationContext context) {
        if (StringUtil.equals(targetAction, ACTION_START_RECORD)) {
            String[] items = StringUtil.split(method.getParam(CHECK_LIST), CHECK_LIST_SPLITTER);
            if (items == null) {
                return false;
            }

            // 逐项开启
            displayProvider.stopAllDisplay();
            for (String name: items) {
                displayProvider.startDisplay(name);
            }
            isRecording = true;

            // 记录下上传地址
            uploadUrl = method.getParam(UPLOAD_URL);

            displayProvider.startRecording();
            context.notifyOperationFinish();
            return true;
        } else if (StringUtil.equals(targetAction, ACTION_STOP_RECORD)) {
            context.notifyOnFinish(new Runnable() {
                @Override
                public void run() {
                    Map<RecordPattern, List<RecordPattern.RecordItem>> records = displayProvider.stopRecording();

                    // 全员暂停
                    displayProvider.stopAllDisplay();
                    isRecording = false;

                    if (StringUtil.isEmpty(uploadUrl)) {
                        // 存储录制数据
                        File folder = RecordUtil.saveToFile(records);

                        // 显示提示框
                        LauncherApplication.getInstance().showToast("录制数据已经保存到\"" + folder.getPath() + "\"下");
                    } else {
                        String response = RecordUtil.uploadData(uploadUrl, records);
                        LauncherApplication.getInstance().showToast("录制数据已经上传至\"" + uploadUrl + "\"，响应结果: " + response);
                    }
                }
            });
            return true;
        }
        return false;
    }

    @Override
    public Map<String, String> provideActions(AbstractNodeTree node) {
        if (node != null) {
            return null;
        }

        Map<String, String> actionMap = new HashMap<>(2);

        // 配置功能项
        if (isRecording) {
            actionMap.put(ACTION_STOP_RECORD, "停止性能录制");
        } else {
            actionMap.put(ACTION_START_RECORD, "开始性能录制");
        }

        return actionMap;
    }

    @Override
    public void provideView(Context context, String key, final OperationMethod method,
                            AbstractNodeTree node, ViewLoadCallback callback) {
        if (StringUtil.equals(ACTION_START_RECORD, key)) {
            List<DisplayItemInfo> displayItemInfos = displayProvider.getAllDisplayItems();
            LinearLayout linearLayout = new LinearLayout(context);
            linearLayout.setOrientation(LinearLayout.VERTICAL);
            LayoutInflater inflater = LayoutInflater.from(ContextUtil.getContextThemeWrapper(context, R.style.AppDialogTheme));

            CheckableRelativeLayout.OnCheckedChangeListener listener = new CheckableRelativeLayout.OnCheckedChangeListener() {
                @Override
                public void onCheckedChanged(CheckableRelativeLayout checkable, boolean isChecked) {
                    String name = (String) checkable.getTag();
                    LogUtil.d(TAG, "配置项 %s, checked=%s", name, isChecked);
                    String checkList = method.getParam(CHECK_LIST);
                    List<String> items;
                    String[] split = StringUtil.split(checkList, CHECK_LIST_SPLITTER);
                    if (split != null) {
                        items = new ArrayList<>(Arrays.asList(split));
                    } else {
                        items = new ArrayList<>();
                    }

                    if (isChecked) {
                        items.add(name);
                    } else {
                        items.remove(name);
                    }

                    method.putParam(CHECK_LIST, StringUtil.join(CHECK_LIST_SPLITTER, items));
                }
            };

            // 记录下上传地址
            method.putParam(UPLOAD_URL, SPService.getString(SPService.KEY_PERFORMANCE_UPLOAD));

            Set<String> runningSet = displayProvider.getRunningDisplayItems();

            // 添加布局配置
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            for (DisplayItemInfo info: displayItemInfos) {
                final CheckableRelativeLayout itemView = (CheckableRelativeLayout) inflater.inflate(R.layout.dialog_action_check_item, null);
                itemView.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        itemView.toggle();
                    }
                });
                TextView text = (TextView) itemView.findViewById(R.id.dialog_action_title);
                ImageView icon = (ImageView) itemView.findViewById(R.id.dialog_action_icon);

                // 设置信息
                text.setText(info.getName());
                icon.setImageResource(info.getIcon());

                itemView.setOnCheckedChangeListener(listener);

                // 暂存下
                itemView.setTag(info.getName());

                // 添加子节点
                linearLayout.addView(itemView, params);

                // 前一次关闭失败的场景
                if (runningSet.contains(info.getName())) {
                    itemView.setChecked(true);
                }
            }

            callback.onViewLoaded(linearLayout);
        } else {
            callback.onViewLoaded(null);
        }
    }

    @Override
    public void onCreate(Context context) {
        displayProvider = LauncherApplication.getInstance().findServiceByName(DisplayProvider.class.getName());
    }

    @Override
    public void onDestroy(Context context) {
        displayProvider.stopAllDisplay();
    }
}
