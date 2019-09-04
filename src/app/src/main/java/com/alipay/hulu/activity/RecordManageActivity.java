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
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.ListView;
import android.widget.Toast;

import com.alipay.hulu.R;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.ui.HeadControlPanel;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.regex.Pattern;

/**
 * 性能数据管理Activity
 */
public class RecordManageActivity extends BaseActivity {
    private static final String TAG = "RecordManageActivity";

    // Views
    private HeadControlPanel headPanel;

    private ListView listView;

    private Button deleteButton;

    // Data
    File recordDir;

    List<String> recordFolderNames = new ArrayList<>();




    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        initView();

        initData(savedInstanceState);
    }

    /**
     * 初始化界面
     */
    private void initView() {
        setContentView(R.layout.activity_record_manage);

        headPanel = (HeadControlPanel) findViewById(R.id.head_layout);
        headPanel.setMiddleTitle(getString(R.string.activity__performance_manage));
        headPanel.setBackIconClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });

        listView = (ListView) findViewById(R.id.record_manage_list);

        deleteButton = (Button) findViewById(R.id.record_manage_button_delete);
    }

    /**
     * 初始化数据
     * @param savedInstanceState 应用状态
     */
    private void initData(Bundle savedInstanceState) {
        recordDir = FileUtils.getSubDir("records");

        // 读取本地记录数据
        refreshRecords();

        final ArrayAdapter<String> arrayAdapter = new ArrayAdapter<String>(this,
                R.layout.item_record_manage, R.id.record_name, recordFolderNames) {
            @Override
            public boolean hasStableIds() {
                return true;
            }

            @Override
            public long getItemId(int position) {
                if (position >= recordFolderNames.size()) {
                    return -1;
                }
                return recordFolderNames.get(position).hashCode();
            }

            @Override
            public int getCount() {
                return super.getCount();
            }
        };

        listView.setAdapter(arrayAdapter);

        deleteButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                long[] checkedItems = listView.getCheckedItemIds();
                LogUtil.i(TAG, "选中ID: " + Arrays.toString(checkedItems));

                String[] toDelete = new String[checkedItems.length];
                for (int i = 0; i < checkedItems.length; i++) {
                    for (String fileName: recordFolderNames) {

                        // 通过hashCode判断
                        if (fileName.hashCode() == checkedItems[i]) {
                            toDelete[i] = fileName;
                            break;
                        }
                    }
                }

                deleteSelectFolders(toDelete);

                refreshRecords();
                arrayAdapter.notifyDataSetChanged();
            }
        });
    }

    /**
     * 删除选中的录制文件夹
     * @param select 被选中的文件夹名列表
     */
    private void deleteSelectFolders(String[] select) {
        for (String folderName : select) {
            File folder = new File(recordDir, folderName);

            // 正确性判断
            if (folder.exists() && folder.isDirectory()) {
                File[] childrenFiles = folder.listFiles();

                for (File childFile: childrenFiles) {
                    boolean deleteResult = childFile.delete();

                    // 当存在子文件无法删除，break当前文件夹删除
                    if (!deleteResult) {
                        break;
                    }
                }

                if (!folder.delete()) {
                    LauncherApplication.toast(R.string.record__fail_delete_folder, folder);
                }
            }
        }
    }

    /**
     * 刷新文件夹记录
     */
    private void refreshRecords() {
        if (recordDir != null && recordDir.exists() && recordDir.isDirectory()) {
            File[] files = recordDir.listFiles();
            recordFolderNames.clear();
            LogUtil.i(TAG, "get files " +  StringUtil.hide(files));

            Pattern newPattern = Pattern.compile("\\d{2}月\\d{2}日\\d{2}:\\d{2}:\\d{2}-\\d{2}月\\d{2}日\\d{2}:\\d{2}:\\d{2}");
            Pattern oldPattern = Pattern.compile("\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}_\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}");

            // 记录所有文件夹
            for (File file : files) {
                if (file.isDirectory() && (newPattern.matcher(file.getName()).matches() || oldPattern.matcher(file.getName()).matches())) {
                    recordFolderNames.add(file.getName());
                }
            }
            Collections.sort(recordFolderNames);
            LogUtil.i(TAG, "get folders: " + recordFolderNames.size());
        }
    }
}
