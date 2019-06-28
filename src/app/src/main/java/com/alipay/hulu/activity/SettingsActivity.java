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

import android.content.DialogInterface;
import android.content.Intent;
import android.os.Bundle;
import android.support.v7.app.AlertDialog;
import android.util.Pair;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONException;
import com.alipay.hulu.R;
import com.alipay.hulu.common.constant.Constant;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.AESUtils;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.PatchProcessUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.common.utils.patch.PatchLoadResult;
import com.alipay.hulu.shared.io.bean.GeneralOperationLogBean;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.io.db.GreenDaoManager;
import com.alipay.hulu.shared.io.db.RecordCaseInfoDao;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;
import com.alipay.hulu.ui.HeadControlPanel;
import com.alipay.hulu.upgrade.PatchRequest;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileReader;
import java.io.FilenameFilter;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Created by lezhou.wyl on 01/01/2018.
 */

public class SettingsActivity extends BaseActivity {
    private static final String TAG = "SettingsActivity";

    private HeadControlPanel mPanel;

    private View mRecordUploadWrapper;
    private TextView mRecordUploadInfo;

    private View mRecordScreenUploadWrapper;
    private TextView mRecordScreenUploadInfo;

    private View mPatchListWrapper;
    private TextView mPatchListInfo;

    private View mResolutionSettingWrapper;
    private TextView mResolutionSettingInfo;

    private View mHightlightSettingWrapper;
    private TextView mHightlightSettingInfo;

    private View mAesSeedSettingWrapper;
    private TextView mAesSeedSettingInfo;

    private View mClearFilesSettingWrapper;
    private TextView mClearFilesSettingInfo;

    private View mHideLogSettingWrapper;
    private TextView mHideLogSettingInfo;

    private View mImportCaseSettingWrapper;

    private View mImportPluginSettingWrapper;

    private View mAboutBtn;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);

        initView();
        initListeners();
    }

    private void initListeners() {
        mPanel.setBackIconClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                SettingsActivity.this.finish();
            }
        });

        mAboutBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(SettingsActivity.this, InfoActivity.class));
            }
        });

        mRecordUploadWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showMultipleEditDialog(new OnDialogResultListener() {
                    @Override
                    public void onDialogPositive(List<String> data) {
                        if (data.size() == 1) {
                            String path = data.get(0);
                            SPService.putString(SPService.KEY_PERFORMANCE_UPLOAD, path);
                            if (StringUtil.isEmpty(path)) {
                                mRecordUploadInfo.setText(R.string.constant__not_config);
                            } else {
                                mRecordUploadInfo.setText(path);
                            }
                        }
                    }
                }, getString(R.string.settings__performance_upload_url), Collections.singletonList(new Pair<>(getString(R.string.settings__performance_upload_url), SPService.getString(SPService.KEY_PERFORMANCE_UPLOAD))));
            }
        });

        mRecordScreenUploadWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showMultipleEditDialog(new OnDialogResultListener() {
                    @Override
                    public void onDialogPositive(List<String> data) {
                        if (data.size() == 1) {
                            String path = data.get(0);
                            SPService.putString(SPService.KEY_RECORD_SCREEN_UPLOAD, path);
                            if (StringUtil.isEmpty(path)) {
                                mRecordScreenUploadInfo.setText(R.string.constant__not_config);
                            } else {
                                mRecordScreenUploadInfo.setText(path);
                            }
                        }
                    }
                }, getString(R.string.settings__record_upload_url), Collections.singletonList(new Pair<>(getString(R.string.settings__record_upload_url), SPService.getString(SPService.KEY_RECORD_SCREEN_UPLOAD))));
            }
        });

        mPatchListWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showMultipleEditDialog(new OnDialogResultListener() {
                    @Override
                    public void onDialogPositive(List<String> data) {
                        if (data.size() == 1) {
                            String path = data.get(0);
                            SPService.putString(SPService.KEY_PATCH_URL, path);
                            if (StringUtil.isEmpty(path)) {
                                mPatchListInfo.setText(R.string.constant__not_config);
                            } else {
                                mPatchListInfo.setText(path);

                                // 更新patch列表
                                PatchRequest.updatePatchList();
                            }
                        }
                    }
                }, getString(R.string.settings__plugin_url),
                        Collections.singletonList(new Pair<>(getString(R.string.settings__plugin_url),
                                SPService.getString(SPService.KEY_PATCH_URL, "https://raw.githubusercontent.com/soloPi/SoloPi/master/<abi>.json"))));
            }
        });

        mAesSeedSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showMultipleEditDialog(new OnDialogResultListener() {
                    @Override
                    public void onDialogPositive(List<String> data) {
                        if (data.size() == 1) {
                            String seed = data.get(0);
                            String originSeed = SPService.getString(SPService.KEY_AES_KEY, getApplication().getPackageName());
                            SPService.putString(SPService.KEY_AES_KEY, seed);

                            // 发生了更新
                            if (!StringUtil.equals(originSeed,seed)) {
                                updateStoredRecords(originSeed, seed);
                            }
                            mAesSeedSettingInfo.setText(seed);
                        }
                    }
                }, getString(R.string.settings__encrept_key), Collections.singletonList(new Pair<>(getString(R.string.settings__encrept_key), SPService.getString(SPService.KEY_AES_KEY, "com.alipay.hulu"))));
            }
        });

        mClearFilesSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showMultipleEditDialog(new OnDialogResultListener() {
                    @Override
                    public void onDialogPositive(List<String> data) {
                        if (data.size() == 1) {
                            String days = data.get(0);

                            if (StringUtil.isInteger(days)) {
                                int daysNum = Integer.parseInt(days);
                                if (daysNum < 0) {
                                    daysNum = -1;
                                }

                                SPService.putInt(SPService.KEY_AUTO_CLEAR_FILES_DAYS, daysNum);
                                mClearFilesSettingInfo.setText(days);
                            } else {
                                Toast.makeText(SettingsActivity.this, R.string.settings__config_failed, Toast.LENGTH_SHORT).show();
                            }
                        }
                    }
                }, getString(R.string.settings__auto_clean_time), Collections.singletonList(new Pair<>(getString(R.string.settings_auto_clean_hint), StringUtil.toString(SPService.getInt(SPService.KEY_AUTO_CLEAR_FILES_DAYS, 3)))));
            }
        });

        mResolutionSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                List<Pair<String, String>> data = new ArrayList<>(2);
                data.add(new Pair<>("图像查找截图分辨率", "" + SPService.getInt(SPService.KEY_SCREENSHOT_RESOLUTION, 720)));
                showMultipleEditDialog(new OnDialogResultListener() {
                    @Override
                    public void onDialogPositive(List<String> data) {
                        if (data.size() != 2) {
                            LogUtil.e("SettingActivity", "获取编辑项少于两项");
                            return;
                        }

                        // 更新截图分辨率信息
                        SPService.putInt(SPService.KEY_SCREENSHOT_RESOLUTION, Integer.parseInt(data.get(0)));
                        mResolutionSettingInfo.setText(data.get(0) + "P");
                    }
                }, "图像查找截图设置", data);
            }
        });

        mHightlightSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                new AlertDialog.Builder(SettingsActivity.this, R.style.SimpleDialogTheme)
                        .setMessage("回放时是否高亮待操作控件？")
                        .setPositiveButton("是", new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                SPService.putBoolean(SPService.KEY_HIGHLIGHT_REPLAY_NODE, true);
                                mHightlightSettingInfo.setText("是");
                                dialog.dismiss();
                            }
                        }).setNegativeButton("否", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        SPService.putBoolean(SPService.KEY_HIGHLIGHT_REPLAY_NODE, false);
                        mHightlightSettingInfo.setText("否");
                        dialog.dismiss();
                    }
                }).show();
            }
        });

        mHideLogSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                new AlertDialog.Builder(SettingsActivity.this, R.style.SimpleDialogTheme).setMessage(R.string.settings__whether_hide_node_info)
                        .setPositiveButton(R.string.constant__yes, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                mHideLogSettingInfo.setText(R.string.constant__yes);
                                SPService.putBoolean(SPService.KEY_HIDE_LOG, true);
                            }
                        })
                        .setNegativeButton(R.string.constant__no, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                dialog.dismiss();
                                mHideLogSettingInfo.setText(R.string.constant__no);
                                SPService.putBoolean(SPService.KEY_HIDE_LOG, false);
                            }
                        })
                        .setCancelable(true).show();
            }
        });

        mImportCaseSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showProgressDialog(getString(R.string.settings__load_extrenal_case));
                BackgroundExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        File importDir = FileUtils.getSubDir("import");
                        File[] subFiles = importDir.listFiles();

                        int count = 0;
                        if (subFiles != null) {
                            for (File sub : subFiles) {
                                // 格式校验
                                if (sub.isFile() && StringUtil.contains(sub.getName(), ".json")) {
                                    try {
                                        BufferedReader reader = new BufferedReader(new FileReader(sub));
                                        StringBuilder sb = new StringBuilder();
                                        char[] chars = new char[1024];
                                        int readCount;

                                        while ((readCount = reader.read(chars, 0, 1024)) > 0) {
                                            sb.append(chars, 0, readCount);
                                        }

                                        reader.close();

                                        // 加载实例
                                        RecordCaseInfo caseInfo = JSON.parseObject(sb.toString(), RecordCaseInfo.class);

                                        GreenDaoManager.getInstance().getRecordCaseInfoDao().insert(caseInfo);

                                        // 导入完毕后删除
                                        sub.delete();
                                        count++;
                                    } catch (FileNotFoundException e) {
                                        LogUtil.e(TAG, "Catch java.io.FileNotFoundException: " + e.getMessage(), e);
                                    } catch (IOException e) {
                                        LogUtil.e(TAG, "Catch java.io.IOException: " + e.getMessage(), e);
                                    } catch (JSONException e) {
                                        LogUtil.e(TAG, e, "无法解析文件【%s】", StringUtil.hide(sub.getAbsoluteFile()));
                                    } catch (Exception e) {
                                        LogUtil.e(TAG, "Catch Exception: " + e.getMessage(), e);
                                    }
                                }
                            }
                        }

                        dismissProgressDialog();

                        toastLong(getString(R.string.settings__load_count_case, count));
                    }
                });
            }
        });

        mImportPluginSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showProgressDialog(getString(R.string.settings__load_plugin));
                BackgroundExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        File f = FileUtils.getSubDir("patch");
                        if (f.exists() && f.isDirectory()) {
                            File[] subFiles = f.listFiles(new FilenameFilter() {
                                @Override
                                public boolean accept(File dir, String name) {
                                    return name.endsWith(".zip");
                                }
                            });

                            if (subFiles != null && subFiles.length > 0) {
                                for (File patch : subFiles) {
                                    try {
                                        PatchLoadResult result = PatchProcessUtil.dynamicLoadPatch(patch);
                                        if (result != null) {
                                            ClassUtil.installPatch(result);
                                            toastShort(getString(R.string.settings__load_success, result.name));
                                            patch.delete();
                                        } else {
                                            LogUtil.e("Settings", "插件安装失败");
                                            toastShort(getString(R.string.settings__load_failed));
                                        }
                                    } catch (Throwable e) {
                                        LogUtil.e("Settings", "加载插件异常", e);
                                        toastShort(getString(R.string.settings__load_failed));
                                    }
                                }
                            }
                        }

                        // 隐藏进度
                        dismissProgressDialog();
                    }
                });
            }
        });
    }

    private interface OnDialogResultListener {
        void onDialogPositive(List<String> data);
    }

    /**
     * 为多个字段配置输入框
     *
     * @param title
     * @param data
     */
    private void showMultipleEditDialog(final OnDialogResultListener listener, String title, List<Pair<String, String>> data) {
        ScrollView v = (ScrollView) LayoutInflater.from(ContextUtil.getContextThemeWrapper(
                SettingsActivity.this, R.style.AppDialogTheme))
                .inflate(R.layout.dialog_setting, null);
        LinearLayout view = (LinearLayout) v.getChildAt(0);
        final List<EditText> editTexts = new ArrayList<>();

        LinearLayout.LayoutParams layoutParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);

        // 对每一个字段添加EditText
        for (Pair<String, String> source : data) {
            EditText edit = new EditText(this);

            // 配置字段
            edit.setHint(source.first);
            edit.setText(source.second);

            // 设置其他参数
            edit.setTextColor(getResources().getColor(R.color.primaryText));
            edit.setHintTextColor(getResources().getColor(R.color.secondaryText));
            edit.setTextSize(18);
            edit.setHighlightColor(getResources().getColor(R.color.colorAccent));

            view.addView(edit, layoutParams);
            editTexts.add(edit);
        }

        // 显示Dialog
        new AlertDialog.Builder(SettingsActivity.this, R.style.AppDialogTheme)
                .setTitle(title)
                .setView(v)
                .setPositiveButton("确定", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        List<String> result = new ArrayList<>(editTexts.size() + 1);

                        // 获取每个编辑框的文字
                        for (EditText data : editTexts) {
                            result.add(data.getText().toString().trim());
                        }

                        if (listener != null) {
                            listener.onDialogPositive(result);
                        }
                        dialog.dismiss();
                    }
                }).setNegativeButton("取消", new DialogInterface.OnClickListener() {
            @Override
            public void onClick(DialogInterface dialog, int which) {
                dialog.dismiss();
            }
        }).setCancelable(true)
                .show();
    }

    private void initView() {
        mPanel = (HeadControlPanel) findViewById(R.id.head_layout);
        mPanel.setMiddleTitle(getString(R.string.constant__setting));

        mRecordScreenUploadWrapper = findViewById(R.id.recordscreen_upload_setting_wrapper);
        mRecordScreenUploadInfo = (TextView) findViewById(R.id.recordscreen_upload_setting_info);
        String path = SPService.getString(SPService.KEY_RECORD_SCREEN_UPLOAD);
        if (StringUtil.isEmpty(path)) {
            mRecordScreenUploadInfo.setText("未设置");
        } else {
            mRecordScreenUploadInfo.setText(path);
        }

        mRecordUploadWrapper = findViewById(R.id.performance_upload_setting_wrapper);
        mRecordUploadInfo = (TextView) findViewById(R.id.performance_upload_setting_info);
        path = SPService.getString(SPService.KEY_PERFORMANCE_UPLOAD);
        if (StringUtil.isEmpty(path)) {
            mRecordUploadInfo.setText("未设置");
        } else {
            mRecordUploadInfo.setText(path);
        }

        mPatchListWrapper = findViewById(R.id.patch_list_setting_wrapper);
        mPatchListInfo = (TextView) findViewById(R.id.patch_list_setting_info);
        path = SPService.getString(SPService.KEY_PATCH_URL,
                "https://raw.githubusercontent.com/soloPi/SoloPi/master/<abi>.json");
        if (StringUtil.isEmpty(path)) {
            mPatchListInfo.setText("未设置");
        } else {
            mPatchListInfo.setText(path);
        }

        mResolutionSettingWrapper = findViewById(R.id.screenshot_resolution_setting_wrapper);
        mResolutionSettingInfo = (TextView) findViewById(R.id.screenshot_resolution_setting_info);
        mResolutionSettingInfo.setText(SPService.getInt(SPService.KEY_SCREENSHOT_RESOLUTION, 720) + "P");

        mHightlightSettingWrapper = findViewById(R.id.replay_highlight_setting_wrapper);
        mHightlightSettingInfo = (TextView) findViewById(R.id.replay_highlight_setting_info);
        mHightlightSettingInfo.setText(SPService.getBoolean(SPService.KEY_HIGHLIGHT_REPLAY_NODE, true)? "是": "否");

        mAesSeedSettingWrapper = findViewById(R.id.aes_seed_setting_wrapper);
        mAesSeedSettingInfo = (TextView) findViewById(R.id.aes_seed_setting_info);
        mAesSeedSettingInfo.setText(SPService.getString(SPService.KEY_AES_KEY, "com.alipay.hulu"));

        mClearFilesSettingWrapper = findViewById(R.id.clear_files_setting_wrapper);
        mClearFilesSettingInfo = (TextView) findViewById(R.id.clear_files_setting_info);

        mHideLogSettingWrapper = findViewById(R.id.hide_log_setting_wrapper);
        mHideLogSettingInfo = (TextView) findViewById(R.id.hide_log_setting_info);
        boolean hideLog = SPService.getBoolean(SPService.KEY_HIDE_LOG, true);
        if (hideLog) {
            mHideLogSettingInfo.setText("是");
        } else {
            mHideLogSettingInfo.setText("否");
        }

        mImportCaseSettingWrapper = findViewById(R.id.import_case_setting_wrapper);
        // 设置下引入地址
        TextView importPath = (TextView) findViewById(R.id.import_case_setting_path);
        importPath.setText(FileUtils.getSubDir("import").getAbsolutePath());

        mImportPluginSettingWrapper = findViewById(R.id.import_patch_setting_wrapper);
        // 设置下引入地址
        TextView importPluginPath = (TextView) findViewById(R.id.import_patch_setting_path);
        importPluginPath.setText(FileUtils.getSubDir("patch").getAbsolutePath());

        int clearDays = SPService.getInt(SPService.KEY_AUTO_CLEAR_FILES_DAYS, 3);
        mClearFilesSettingInfo.setText(StringUtil.toString(clearDays));

        mAboutBtn = findViewById(R.id.about_wrapper);
    }

    /**
     * 更新存储的用例
     * @param oldSeed
     * @param newSeed
     */
    private void updateStoredRecords(final String oldSeed, final String newSeed) {
        showProgressDialog("开始更新用例");
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    final List<RecordCaseInfo> cases = GreenDaoManager.getInstance().getRecordCaseInfoDao().queryBuilder()
                            .orderDesc(RecordCaseInfoDao.Properties.GmtCreate)
                            .build().list();

                    if (cases != null && cases.size() > 0) {
                        for (int i = 0; i < cases.size(); i++) {
                            showProgressDialog("更新用例(" + (i + 1) + "/" + cases.size() + ")");
                            RecordCaseInfo caseInfo = cases.get(i);
                            GeneralOperationLogBean generalOperation;
                            try {
                                generalOperation = JSON.parseObject(caseInfo.getOperationLog(), GeneralOperationLogBean.class);
                            } catch (Exception e) {
                                LogUtil.e(TAG, "parseOperation failed: " + e.getMessage(), e);
                                continue;
                            }

                            // 如果没拿到数据
                            if (generalOperation == null) {
                                continue;
                            }
                            List<OperationStep> steps = generalOperation.getSteps();
                            if (generalOperation.getSteps() != null) {
                                for (OperationStep step : steps) {
                                    OperationMethod method = step.getOperationMethod();
                                    if (method.isEncrypt()) {
                                        Map<String, String> params = method.getOperationParam();
                                        for (String key : params.keySet()) {
                                            // 逐个参数替换
                                            try {
                                                String originValue = AESUtils.decrypt(params.get(key), oldSeed);
                                                params.put(key, AESUtils.encrypt(originValue, newSeed));
                                            } catch (Exception e) {
                                                LogUtil.e(TAG, "process key=" + key + " failed, " + e.getMessage(), e);
                                                // 不阻碍其他操作执行
                                            }
                                        }
                                    }
                                }
                            }

                            // 更新operationLog字段
                            caseInfo.setOperationLog(JSON.toJSONString(generalOperation));
                            GreenDaoManager.getInstance().getRecordCaseInfoDao().update(caseInfo);
                        }
                    }
                } catch (Throwable t) {
                    LogUtil.e(TAG, "Update aes seed throw " + t.getMessage(), t);
                } finally {
                    // 隐藏进度窗口
                    dismissProgressDialog();
                }
            }
        });
    }
}
