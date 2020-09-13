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
import androidx.appcompat.app.AlertDialog;
import android.util.Pair;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.EditText;
import android.widget.TextView;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONException;
import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.R;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.AESUtils;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.PatchProcessUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.common.utils.activity.FileChooseDialogActivity;
import com.alipay.hulu.common.utils.patch.PatchLoadResult;
import com.alipay.hulu.shared.io.bean.GeneralOperationLogBean;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.io.db.GreenDaoManager;
import com.alipay.hulu.shared.io.db.RecordCaseInfoDao;
import com.alipay.hulu.shared.io.util.OperationStepUtil;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;
import com.alipay.hulu.ui.HeadControlPanel;
import com.alipay.hulu.upgrade.PatchRequest;
import com.alipay.hulu.util.DialogUtils;
import com.alipay.hulu.util.DialogUtils.OnDialogResultListener;
import com.zhy.view.flowlayout.FlowLayout;
import com.zhy.view.flowlayout.TagAdapter;
import com.zhy.view.flowlayout.TagFlowLayout;

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

import static com.alipay.hulu.util.DialogUtils.showMultipleEditDialog;

/**
 * Created by lezhou.wyl on 01/01/2018.
 */

public class SettingsActivity extends BaseActivity {
    private static final String TAG = "SettingsActivity";

    private static final int REQUEST_FILE_CHOOSE = 1101;

    private HeadControlPanel mPanel;

    private View mRecordUploadWrapper;
    private TextView mRecordUploadInfo;

    private View mRecordScreenUploadWrapper;
    private TextView mRecordScreenUploadInfo;

    private View mPatchListWrapper;
    private TextView mPatchListInfo;

    private View mReplayOtherAppSettingWrapper;
    private TextView mReplayOtherAppInfo;

    private View mRestartAppSettingWrapper;
    private TextView mRestartAppInfo;

    private View mGlobalParamSettingWrapper;

    private View mResolutionSettingWrapper;
    private TextView mResolutionSettingInfo;

    private View mHightlightSettingWrapper;
    private TextView mHightlightSettingInfo;

    private View mLanguageSettingWrapper;
    private TextView mLanguageSettingInfo;

    private View mDisplaySystemAppSettingWrapper;
    private TextView mDisplaySystemAppSettingInfo;

    private View mAutoReplaySettingWrapper;
    private TextView mAutoReplaySettingInfo;

    private View mSkipAccessibilitySettingWrapper;
    private TextView mSkipAccessibilitySettingInfo;

    private View mMaxWaitSettingWrapper;
    private TextView mMaxWaitSettingInfo;

    private View mDefaultRotationSettingWrapper;
    private TextView mDefaultRotationSettingInfo;

    private View mChangeRotationSettingWrapper;
    private TextView mChangeRotationSettingInfo;

    private View mCheckUpdateSettingWrapper;
    private TextView mCheckUpdateSettingInfo;

    private View mBaseDirSettingWrapper;
    private TextView mBaseDirSettingInfo;

    private View mOutputCharsetSettingWrapper;
    private TextView mOutputCharsetSettingInfo;

    private View mAesSeedSettingWrapper;
    private TextView mAesSeedSettingInfo;

    private View mClearFilesSettingWrapper;
    private TextView mClearFilesSettingInfo;

    private View mHideLogSettingWrapper;
    private TextView mHideLogSettingInfo;

    private View mAdbServerSettingWrapper;
    private TextView mAdbServerSettingInfo;

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

        mGlobalParamSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showGlobalParamEdit();
            }
        });

        mDefaultRotationSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                new AlertDialog.Builder(SettingsActivity.this, R.style.SimpleDialogTheme)
                        .setItems(R.array.default_screen_rotation, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                String item = getResources().getStringArray(R.array.default_screen_rotation)[which];
                                SPService.putInt(SPService.KEY_SCREEN_FACTOR_ROTATION, which);
                                if (which == 1 || which == 3) {
                                    SPService.putBoolean(SPService.KEY_SCREEN_ROTATION, true);
                                    mChangeRotationSettingInfo.setText(R.string.constant__yes);
                                } else {
                                    SPService.putBoolean(SPService.KEY_SCREEN_ROTATION, false);
                                    mChangeRotationSettingInfo.setText(R.string.constant__no);
                                }
                                mDefaultRotationSettingInfo.setText(item);
                            }
                        })
                        .setTitle(R.string.setting__set_screen_orientation)
                        .setNegativeButton(R.string.constant__cancel, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                dialog.dismiss();
                            }
                        })
                        .show();
            }
        });

        mChangeRotationSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                new AlertDialog.Builder(SettingsActivity.this, R.style.SimpleDialogTheme)
                        .setMessage(R.string.setting__change_screen_axis)
                        .setPositiveButton(R.string.constant__yes, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                SPService.putBoolean(SPService.KEY_SCREEN_ROTATION, true);
                                mChangeRotationSettingInfo.setText(R.string.constant__yes);
                            }
                        }).setNegativeButton(R.string.constant__no, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        SPService.putBoolean(SPService.KEY_SCREEN_ROTATION, false);
                        mChangeRotationSettingInfo.setText(R.string.constant__no);
                    }
                }).show();
            }
        });

        mRecordUploadWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showMultipleEditDialog(SettingsActivity.this, new OnDialogResultListener() {
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
                showMultipleEditDialog(SettingsActivity.this, new OnDialogResultListener() {
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
                showMultipleEditDialog(SettingsActivity.this, new OnDialogResultListener() {
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
                                PatchRequest.updatePatchList(null);
                            }
                        }
                    }
                }, getString(R.string.settings__plugin_url),
                        Collections.singletonList(new Pair<>(getString(R.string.settings__plugin_url),
                                SPService.getString(SPService.KEY_PATCH_URL, "https://raw.githubusercontent.com/alipay/SoloPi/master/<abi>.json"))));
            }
        });

        mOutputCharsetSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showMultipleEditDialog(SettingsActivity.this, new DialogUtils.OnDialogResultListener() {
                                           @Override
                                           public void onDialogPositive(List<String> data) {
                                               if (data.size() == 1) {
                                                   String charset = data.get(0);
                                                   SPService.putString(SPService.KEY_OUTPUT_CHARSET, charset);
                                                   mOutputCharsetSettingInfo.setText(charset);
                                               }
                                           }
                                       }, getString(R.string.settings__output_charset),
                        Collections.singletonList(new Pair<>(getString(R.string.settings__output_charset),
                                SPService.getString(SPService.KEY_OUTPUT_CHARSET))));
            }
        });


        mLanguageSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                new AlertDialog.Builder(SettingsActivity.this, R.style.SimpleDialogTheme)
                        .setTitle(R.string.settings__language)
                        .setItems(R.array.language, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                SPService.putInt(SPService.KEY_USE_LANGUAGE, which);
                                LauncherApplication.getInstance().setApplicationLanguage();

                                mLanguageSettingInfo.setText(getResources().getStringArray(R.array.language)[which]);
                                // 重启服务
                                LauncherApplication.getInstance().restartAllServices();

                                Intent intent = new Intent(SettingsActivity.this, SplashActivity.class);
                                intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK | Intent.FLAG_ACTIVITY_NEW_TASK);
                                startActivity(intent);
                                finish();
                            }
                        })
                        .setNegativeButton(R.string.constant__cancel, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        dialog.dismiss();
                    }
                }).show();
            }
        });

        mReplayOtherAppSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                new AlertDialog.Builder(SettingsActivity.this, R.style.SimpleDialogTheme)
                        .setMessage(R.string.settings__should_replay_in_other_app)
                        .setPositiveButton(R.string.constant__yes, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                SPService.putBoolean(SPService.KEY_ALLOW_REPLAY_DIFFERENT_APP, true);
                                mReplayOtherAppInfo.setText(R.string.constant__yes);
                                dialog.dismiss();
                            }
                        }).setNegativeButton(R.string.constant__no, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        SPService.putBoolean(SPService.KEY_ALLOW_REPLAY_DIFFERENT_APP, false);
                        mReplayOtherAppInfo.setText(R.string.constant__no);
                        dialog.dismiss();
                    }
                }).show();
            }
        });

        mRestartAppSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                new AlertDialog.Builder(SettingsActivity.this, R.style.SimpleDialogTheme)
                        .setMessage(R.string.settings__should_restart_before_replay)
                        .setPositiveButton(R.string.constant__yes, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                SPService.putBoolean(SPService.KEY_RESTART_APP_ON_PLAY, true);
                                mRestartAppInfo.setText(R.string.constant__yes);
                                dialog.dismiss();
                            }
                        }).setNegativeButton(R.string.constant__no, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        SPService.putBoolean(SPService.KEY_RESTART_APP_ON_PLAY, false);
                        mRestartAppInfo.setText(R.string.constant__no);
                        dialog.dismiss();
                    }
                }).show();
            }
        });

        mDisplaySystemAppSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                new AlertDialog.Builder(SettingsActivity.this, R.style.SimpleDialogTheme)
                        .setMessage(R.string.setting__display_system_app)
                        .setPositiveButton(R.string.constant__yes, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                SPService.putBoolean(SPService.KEY_DISPLAY_SYSTEM_APP, true);
                                mDisplaySystemAppSettingInfo.setText(R.string.constant__yes);
                                MyApplication.getInstance().reloadAppList();
                                dialog.dismiss();
                            }
                        }).setNegativeButton(R.string.constant__no, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        SPService.putBoolean(SPService.KEY_DISPLAY_SYSTEM_APP, false);
                        mDisplaySystemAppSettingInfo.setText(R.string.constant__no);
                        MyApplication.getInstance().reloadAppList();
                        dialog.dismiss();
                    }
                }).show();
            }
        });

        mAutoReplaySettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                new AlertDialog.Builder(SettingsActivity.this, R.style.SimpleDialogTheme)
                        .setMessage(R.string.setting__auto_replay)
                        .setPositiveButton(R.string.constant__yes, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                SPService.putBoolean(SPService.KEY_REPLAY_AUTO_START, true);
                                mAutoReplaySettingInfo.setText(R.string.constant__yes);
                                dialog.dismiss();
                            }
                        }).setNegativeButton(R.string.constant__no, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        SPService.putBoolean(SPService.KEY_REPLAY_AUTO_START, false);
                        mAutoReplaySettingInfo.setText(R.string.constant__no);
                        dialog.dismiss();
                    }
                }).show();
            }
        });

        mSkipAccessibilitySettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                new AlertDialog.Builder(SettingsActivity.this, R.style.SimpleDialogTheme)
                        .setMessage(R.string.setting__skip_accessibility)
                        .setPositiveButton(R.string.constant__yes, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                SPService.putBoolean(SPService.KEY_SKIP_ACCESSIBILITY, true);
                                mSkipAccessibilitySettingInfo.setText(R.string.constant__yes);
                                dialog.dismiss();
                            }
                        }).setNegativeButton(R.string.constant__no, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        SPService.putBoolean(SPService.KEY_SKIP_ACCESSIBILITY, false);
                        mSkipAccessibilitySettingInfo.setText(R.string.constant__no);
                        dialog.dismiss();
                    }
                }).show();
            }
        });

        mMaxWaitSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showMultipleEditDialog(SettingsActivity.this, new OnDialogResultListener() {
                    @Override
                    public void onDialogPositive(List<String> data) {
                        if (data.size() == 1) {
                            String time = data.get(0);
                            SPService.putLong(SPService.KEY_MAX_WAIT_TIME, Long.parseLong(time));
                            mMaxWaitSettingInfo.setText(time + "ms");
                        }
                    }
                }, getString(R.string.settings__max_wait_time), Collections.singletonList(new Pair<>(getString(R.string.setting__max_wait_time), Long.toString(SPService.getLong(SPService.KEY_MAX_WAIT_TIME, 10000)))));
            }
        });

        mBaseDirSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                FileChooseDialogActivity.startFileChooser(SettingsActivity.this,
                        REQUEST_FILE_CHOOSE, getString(R.string.settings__base_dir), "solopi",
                        FileUtils.getSolopiDir());
            }
        });

        mAesSeedSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showMultipleEditDialog(SettingsActivity.this, new OnDialogResultListener() {
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
                showMultipleEditDialog(SettingsActivity.this, new OnDialogResultListener() {
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
                                toastShort(R.string.settings__config_failed);
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
                data.add(new Pair<>(getString(R.string.settings__screenshot_resolution), "" + SPService.getInt(SPService.KEY_SCREENSHOT_RESOLUTION, 720)));
                showMultipleEditDialog(SettingsActivity.this, new OnDialogResultListener() {
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
                }, getString(R.string.settings__screenshot_setting), data);
            }
        });

        mHightlightSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                new AlertDialog.Builder(SettingsActivity.this, R.style.SimpleDialogTheme)
                        .setMessage(R.string.settings__highlight_node)
                        .setPositiveButton(R.string.constant__yes, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                SPService.putBoolean(SPService.KEY_HIGHLIGHT_REPLAY_NODE, true);
                                mHightlightSettingInfo.setText(R.string.constant__yes);
                                dialog.dismiss();
                            }
                        }).setNegativeButton(R.string.constant__no, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        SPService.putBoolean(SPService.KEY_HIGHLIGHT_REPLAY_NODE, false);
                        mHightlightSettingInfo.setText(R.string.constant__no);
                        dialog.dismiss();
                    }
                }).show();
            }
        });

        // check update
        mCheckUpdateSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                new AlertDialog.Builder(SettingsActivity.this, R.style.SimpleDialogTheme)
                        .setMessage(R.string.settings__check_update)
                        .setPositiveButton(R.string.constant__yes, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                SPService.putBoolean(SPService.KEY_CHECK_UPDATE, true);
                                mCheckUpdateSettingInfo.setText(R.string.constant__yes);
                                dialog.dismiss();
                            }
                        }).setNegativeButton(R.string.constant__no, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        SPService.putBoolean(SPService.KEY_CHECK_UPDATE, false);
                        mCheckUpdateSettingInfo.setText(R.string.constant__no);
                        dialog.dismiss();
                    }
                }).show();
            }
        });

        // adb调试地址
        mAdbServerSettingWrapper.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showMultipleEditDialog(SettingsActivity.this, new DialogUtils.OnDialogResultListener() {
                            @Override
                            public void onDialogPositive(List<String> data) {
                                if (data.size() == 1) {
                                    String server = data.get(0);
                                    SPService.putString(SPService.KEY_ADB_SERVER, server);
                                    mAdbServerSettingInfo.setText(server);
                                }
                            }
                        }, getString(R.string.settings__adb_server),
                        Collections.singletonList(new Pair<>(getString(R.string.settings__adb_server),
                                SPService.getString(SPService.KEY_ADB_SERVER, "localhost:5555"))));
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
                                        String operationLog = caseInfo.getOperationLog();
                                        GeneralOperationLogBean log = JSON.parseObject(operationLog, GeneralOperationLogBean.class);
                                        OperationStepUtil.beforeStore(log);
                                        caseInfo.setOperationLog(JSON.toJSONString(log));

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

    private void initView() {
        mPanel = (HeadControlPanel) findViewById(R.id.head_layout);
        mPanel.setMiddleTitle(getString(R.string.activity__setting));

        mRecordScreenUploadWrapper = findViewById(R.id.recordscreen_upload_setting_wrapper);
        mRecordScreenUploadInfo = (TextView) findViewById(R.id.recordscreen_upload_setting_info);
        String path = SPService.getString(SPService.KEY_RECORD_SCREEN_UPLOAD);
        if (StringUtil.isEmpty(path)) {
            mRecordScreenUploadInfo.setText(R.string.settings__unset);
        } else {
            mRecordScreenUploadInfo.setText(path);
        }

        mRecordUploadWrapper = findViewById(R.id.performance_upload_setting_wrapper);
        mRecordUploadInfo = (TextView) findViewById(R.id.performance_upload_setting_info);
        path = SPService.getString(SPService.KEY_PERFORMANCE_UPLOAD);
        if (StringUtil.isEmpty(path)) {
            mRecordUploadInfo.setText(R.string.settings__unset);
        } else {
            mRecordUploadInfo.setText(path);
        }

        mPatchListWrapper = findViewById(R.id.patch_list_setting_wrapper);
        mPatchListInfo = (TextView) findViewById(R.id.patch_list_setting_info);
        path = SPService.getString(SPService.KEY_PATCH_URL,
                "https://raw.githubusercontent.com/alipay/SoloPi/master/<abi>.json");
        if (StringUtil.isEmpty(path)) {
            mPatchListInfo.setText(R.string.settings__unset);
        } else {
            mPatchListInfo.setText(path);
        }
        mGlobalParamSettingWrapper = findViewById(R.id.global_param_setting_wrapper);

        mDefaultRotationSettingWrapper = findViewById(R.id.default_screen_rotation_setting_wrapper);
        mDefaultRotationSettingInfo = _findViewById(R.id.default_screen_rotation_setting_info);
        int defaultRotation = SPService.getInt(SPService.KEY_SCREEN_FACTOR_ROTATION, 0);
        String[] arrays = getResources().getStringArray(R.array.default_screen_rotation);
        mDefaultRotationSettingInfo.setText(arrays[defaultRotation]);

        mChangeRotationSettingWrapper = findViewById(R.id.change_rotation_setting_wrapper);
        mChangeRotationSettingInfo = _findViewById(R.id.change_rotation_setting_info);
        boolean changeRotation = SPService.getBoolean(SPService.KEY_SCREEN_ROTATION, false);
        mChangeRotationSettingInfo.setText(changeRotation? R.string.constant__yes: R.string.constant__no);


        mOutputCharsetSettingWrapper = findViewById(R.id.output_charset_setting_wrapper);
        mOutputCharsetSettingInfo = (TextView) findViewById(R.id.output_charset_setting_info);
        mOutputCharsetSettingInfo.setText(SPService.getString(SPService.KEY_OUTPUT_CHARSET, "GBK"));

        mResolutionSettingWrapper = findViewById(R.id.screenshot_resolution_setting_wrapper);
        mResolutionSettingInfo = (TextView) findViewById(R.id.screenshot_resolution_setting_info);
        mResolutionSettingInfo.setText(SPService.getInt(SPService.KEY_SCREENSHOT_RESOLUTION, 720) + "P");

        mHightlightSettingWrapper = findViewById(R.id.replay_highlight_setting_wrapper);
        mHightlightSettingInfo = (TextView) findViewById(R.id.replay_highlight_setting_info);
        mHightlightSettingInfo.setText(SPService.getBoolean(SPService.KEY_HIGHLIGHT_REPLAY_NODE, true)? R.string.constant__yes: R.string.constant__no);

        mLanguageSettingWrapper = findViewById(R.id.language_setting_wrapper);
        mLanguageSettingInfo = (TextView) findViewById(R.id.language_setting_info);
        int pos = SPService.getInt(SPService.KEY_USE_LANGUAGE, 0);
        String[] availableLanguages = getResources().getStringArray(R.array.language);
        if (availableLanguages != null && availableLanguages.length > pos) {
            mLanguageSettingInfo.setText(availableLanguages[pos]);
        } else {
            mLanguageSettingInfo.setText(availableLanguages[0]);
        }

        mDisplaySystemAppSettingWrapper = findViewById(R.id.display_system_app_setting_wrapper);
        mDisplaySystemAppSettingInfo = (TextView) findViewById(R.id.display_system_app_setting_info);
        boolean displaySystemApp = SPService.getBoolean(SPService.KEY_DISPLAY_SYSTEM_APP, false);
        if (displaySystemApp) {
            mDisplaySystemAppSettingInfo.setText(R.string.constant__yes);
        } else {
            mDisplaySystemAppSettingInfo.setText(R.string.constant__no);
        }

        mAutoReplaySettingWrapper = findViewById(R.id.auto_replay_setting_wrapper);
        mAutoReplaySettingInfo = (TextView) findViewById(R.id.auto_replay_setting_info);
        boolean autoReplay = SPService.getBoolean(SPService.KEY_REPLAY_AUTO_START, false);
        if (autoReplay) {
            mAutoReplaySettingInfo.setText(R.string.constant__yes);
        } else {
            mAutoReplaySettingInfo.setText(R.string.constant__no);
        }

        mReplayOtherAppSettingWrapper = findViewById(R.id.replay_other_app_setting_wrapper);
        mReplayOtherAppInfo = _findViewById(R.id.replay_other_app_setting_info);
        boolean replayOtherApp = SPService.getBoolean(SPService.KEY_ALLOW_REPLAY_DIFFERENT_APP, false);
        mReplayOtherAppInfo.setText(replayOtherApp? R.string.constant__yes: R.string.constant__no);

        mRestartAppSettingWrapper = findViewById(R.id.restart_app_setting_wrapper);
        mRestartAppInfo = _findViewById(R.id.restart_app_setting_info);
        boolean restartApp = SPService.getBoolean(SPService.KEY_RESTART_APP_ON_PLAY, true);
        mRestartAppInfo.setText(restartApp? R.string.constant__yes: R.string.constant__no);

        mAdbServerSettingWrapper = findViewById(R.id.adb_server_setting_wrapper);
        mAdbServerSettingInfo = _findViewById(R.id.adb_server_setting_info);
        mAdbServerSettingInfo.setText(SPService.getString(SPService.KEY_ADB_SERVER, "localhost:5555"));

        mSkipAccessibilitySettingWrapper = findViewById(R.id.skip_accessibility_setting_wrapper);
        mSkipAccessibilitySettingInfo = (TextView) findViewById(R.id.skip_accessibility_setting_info);
        boolean skipAccessibility = SPService.getBoolean(SPService.KEY_SKIP_ACCESSIBILITY, true);
        if (skipAccessibility) {
            mSkipAccessibilitySettingInfo.setText(R.string.constant__yes);
        } else {
            mSkipAccessibilitySettingInfo.setText(R.string.constant__no);
        }

        mMaxWaitSettingWrapper = findViewById(R.id.max_wait_setting_wrapper);
        mMaxWaitSettingInfo = (TextView) findViewById(R.id.max_wait_setting_info);
        long maxWaitTime = SPService.getLong(SPService.KEY_MAX_WAIT_TIME, 10000L);
        mMaxWaitSettingInfo.setText(maxWaitTime + "ms");

        mCheckUpdateSettingWrapper = findViewById(R.id.check_update_setting_wrapper);
        mCheckUpdateSettingInfo = (TextView) findViewById(R.id.check_update_setting_info);
        boolean checkUpdate = SPService.getBoolean(SPService.KEY_CHECK_UPDATE, true);
        if (checkUpdate) {
            mCheckUpdateSettingInfo.setText(R.string.constant__yes);
        } else {
            mCheckUpdateSettingInfo.setText(R.string.constant__no);
        }

        mBaseDirSettingWrapper = findViewById(R.id.base_dir_setting_wrapper);
        mBaseDirSettingInfo = (TextView) findViewById(R.id.base_dir_setting_info);
        mBaseDirSettingInfo.setText(FileUtils.getSolopiDir().getPath());

        mAesSeedSettingWrapper = findViewById(R.id.aes_seed_setting_wrapper);
        mAesSeedSettingInfo = (TextView) findViewById(R.id.aes_seed_setting_info);
        mAesSeedSettingInfo.setText(SPService.getString(SPService.KEY_AES_KEY, AESUtils.DEFAULT_AES_KEY));

        mClearFilesSettingWrapper = findViewById(R.id.clear_files_setting_wrapper);
        mClearFilesSettingInfo = (TextView) findViewById(R.id.clear_files_setting_info);

        mHideLogSettingWrapper = findViewById(R.id.hide_log_setting_wrapper);
        mHideLogSettingInfo = (TextView) findViewById(R.id.hide_log_setting_info);
        boolean hideLog = SPService.getBoolean(SPService.KEY_HIDE_LOG, true);
        if (hideLog) {
            mHideLogSettingInfo.setText(R.string.constant__yes);
        } else {
            mHideLogSettingInfo.setText(R.string.constant__no);
        }

        mImportCaseSettingWrapper = findViewById(R.id.import_case_setting_wrapper);
        // 设置下引入地址
        TextView importPath = (TextView) findViewById(R.id.import_case_setting_path);
        importPath.setText(FileUtils.getSubDir("import").getAbsolutePath());

        mImportPluginSettingWrapper = findViewById(R.id.import_patch_setting_wrapper);
        // 设置下引入地址
        TextView importPluginPath = (TextView) findViewById(R.id.import_patch_setting_path);
        importPluginPath.setText(FileUtils.getSubDir("patch").getAbsolutePath());


        findViewById(R.id.plugin_list_setting_wrapper).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(SettingsActivity.this, PatchStatusActivity.class));
            }
        });

        int clearDays = SPService.getInt(SPService.KEY_AUTO_CLEAR_FILES_DAYS, 3);
        mClearFilesSettingInfo.setText(StringUtil.toString(clearDays));

        mAboutBtn = findViewById(R.id.about_wrapper);
    }


    /**
     * 展示全局变量配置窗口
     */
    private void showGlobalParamEdit() {
        final List<Pair<String, String>> paramList = new ArrayList<>();

        String globalParam = SPService.getString(SPService.KEY_GLOBAL_SETTINGS);
        JSONObject params = JSON.parseObject(globalParam);
        if (params != null && params.size() > 0) {
            for (String key: params.keySet()) {
                paramList.add(new Pair<>(key, params.getString(key)));
            }
        }

        final LayoutInflater inflater = LayoutInflater.from(ContextUtil.getContextThemeWrapper(
                SettingsActivity.this, R.style.AppDialogTheme));
        final View view = inflater.inflate(R.layout.dialog_global_param_setting, null);
        final TagFlowLayout tagFlowLayout = (TagFlowLayout) view.findViewById(R.id.global_param_group);
        final EditText paramName= (EditText) view.findViewById(R.id.global_param_name);
        final EditText paramValue = (EditText) view.findViewById(R.id.global_param_value);
        View paramAdd = view.findViewById(R.id.global_param_add);

        tagFlowLayout.setAdapter(new TagAdapter<Pair<String, String>>(paramList) {
            @Override
            public View getView(FlowLayout parent, int position, Pair<String, String> o) {
                View root = inflater.inflate(R.layout.item_param_info, parent, false);

                TextView title = (TextView) root.findViewById(R.id.batch_execute_tag_name);
                title.setText(getString(R.string.settings__global_param_key_value, o.first, o.second));
                return root;
            }
        });
        tagFlowLayout.setOnTagClickListener(new TagFlowLayout.OnTagClickListener() {
            @Override
            public boolean onTagClick(View view, int position, FlowLayout parent) {
                paramList.remove(position);
                tagFlowLayout.getAdapter().notifyDataChanged();
                return true;
            }
        });

        paramAdd.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String key = paramName.getText().toString().trim();
                String value = paramValue.getText().toString().trim();
                if (StringUtil.isEmpty(key) || key.contains("=")) {
                    toastShort(getString(R.string.setting__invalid_param_name));
                }

                // 清空输入框
                paramName.setText("");
                paramValue.setText("");

                int replacePosition = -1;
                for (int i = 0; i < paramList.size(); i++) {
                    if (key.equals(paramList.get(i).first)) {
                        replacePosition = i;
                        break;
                    }
                }

                // 如果有相同的，就进行替换
                if (replacePosition > -1) {
                    paramList.set(replacePosition, new Pair<>(key, value));
                } else {
                    paramList.add(new Pair<>(key, value));
                }

                tagFlowLayout.getAdapter().notifyDataChanged();
            }
        });

        new AlertDialog.Builder(SettingsActivity.this, R.style.AppDialogTheme)
                .setView(view)
                .setPositiveButton(R.string.constant__confirm, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        JSONObject newGlobalParam = new JSONObject(paramList.size() + 1);
                        for (Pair<String, String> param: paramList) {
                            newGlobalParam.put(param.first, param.second);
                        }
                        SPService.putString(SPService.KEY_GLOBAL_SETTINGS, newGlobalParam.toJSONString());
                        dialog.dismiss();
                    }
                }).setNegativeButton(R.string.constant__cancel, new DialogInterface.OnClickListener() {
            @Override
            public void onClick(DialogInterface dialog, int which) {
                dialog.dismiss();
            }
        }).setCancelable(true)
                .show();
    }


    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE_CHOOSE) {
            if (resultCode == RESULT_OK) {
                String targetFile = data.getStringExtra(FileChooseDialogActivity.KEY_TARGET_FILE);
                if (!StringUtil.isEmpty(targetFile)) {
                    SPService.putString(SPService.KEY_BASE_DIR, targetFile);
                    mBaseDirSettingInfo.setText(targetFile);
                    FileUtils.setSolopiBaseDir(targetFile);
                }
            }
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    /**
     * 更新存储的用例
     * @param oldSeed
     * @param newSeed
     */
    private void updateStoredRecords(final String oldSeed, final String newSeed) {
        showProgressDialog(getString(R.string.settings__start_update_cases));
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    final List<RecordCaseInfo> cases = GreenDaoManager.getInstance().getRecordCaseInfoDao().queryBuilder()
                            .orderDesc(RecordCaseInfoDao.Properties.GmtCreate)
                            .build().list();

                    if (cases != null && cases.size() > 0) {
                        for (int i = 0; i < cases.size(); i++) {
                            showProgressDialog(getString(R.string.settings__updating_cases, i + 1, cases.size()));
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

                            // load file content
                            OperationStepUtil.afterLoad(generalOperation);

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
                            OperationStepUtil.beforeStore(generalOperation);

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
