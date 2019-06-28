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

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.support.annotation.Nullable;
import android.support.v4.content.FileProvider;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.TextView;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.R;
import com.alipay.hulu.activity.entry.EntryActivity;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.constant.Constant;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.DeviceInfoUtil;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.ui.ColorFilterRelativeLayout;
import com.alipay.hulu.ui.HeadControlPanel;
import com.alipay.hulu.upgrade.PatchRequest;
import com.alipay.hulu.util.SystemUtil;
import com.alipay.hulu.util.ZipUtil;

import java.io.File;
import java.io.FileFilter;
import java.io.FilenameFilter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Created by lezhou.wyl on 2018/1/28.
 */

public class IndexActivity extends BaseActivity {
    private static final String TAG = IndexActivity.class.getSimpleName();
    private static final String DISPLAY_ALERT_INFO = "displayAlertInfo";

    private HeadControlPanel mPanel;
    private GridView mGridView;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_index);

        initView();
        initData();
        loadOthers();

        // 免责弹窗
        boolean showDisplay = SPService.getBoolean(DISPLAY_ALERT_INFO, true);
        if (showDisplay) {
            new AlertDialog.Builder(this).setTitle("免责声明")
                    .setMessage(R.string.disclaimer)
                    .setPositiveButton("确定", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            dialog.dismiss();
                        }
                    }).setNegativeButton("不再提示", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            SPService.putBoolean(DISPLAY_ALERT_INFO, false);
                            dialog.dismiss();
                        }
                    }).show();
        }
    }

    /**
     * 初始化界面
     */
    private void initView() {
        mPanel = (HeadControlPanel) findViewById(R.id.head_layout);
        mPanel.setMiddleTitle(getString(R.string.app_name));
        mPanel.setInfoIconClickListener(R.drawable.icon_config, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(IndexActivity.this, SettingsActivity.class));
            }
        });
        mGridView = (GridView) findViewById(R.id.tools_grid);
    }

    /**
     * 加载内容
     */
    private void initData() {
        Map<String, Entry> entryList = new HashMap<>();

        List<Class<? extends Activity>> activities = ClassUtil.findSubClass(Activity.class, EntryActivity.class);

        // 配置唯一entry
        for (Class<? extends Activity> activityClass: activities) {
            // 配置
            Entry target = new Entry(activityClass.getAnnotation(EntryActivity.class), activityClass);
            if (entryList.containsKey(target.name)) {
                if (entryList.get(target.name).level < target.level) {
                    entryList.put(target.name, target);
                }
            } else {
                entryList.put(target.name, target);
            }
        }

        List<Entry> entries = new ArrayList<>(entryList.values());
        // 从大到小排
        Collections.sort(entries, new Comparator<Entry>() {
            @Override
            public int compare(Entry o1, Entry o2) {
                return o1.index - o2.index;
            }
        });

        CustomAdapter adapter = new CustomAdapter(this, entries);
        if (entries.size() <= 3) {
            mGridView.setNumColumns(1);
        } else {
            mGridView.setNumColumns(2);
        }
        mGridView.setAdapter(adapter);

        // 有写权限，申请下
        PatchRequest.updatePatchList();
    }

    /**
     * 加载其他信息
     */
    private void loadOthers() {
        // 检查是否需要上报故障日志
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                checkErrorLog();
            }
        });
    }

    /**
     * 检查是否有需要上报的Crash日志
     */
    private void checkErrorLog() {
        final Pattern pattern = Pattern.compile("\\d+\\.log");
        long lastCheckTime = SPService.getLong(SPService.KEY_ERROR_CHECK_TIME, System.currentTimeMillis());
        File errorDir = FileUtils.getSubDir("error");
        if (errorDir.exists() && errorDir.isDirectory()) {
            File[] children = errorDir.listFiles(new FileFilter() {
                @Override
                public boolean accept(File pathname) {
                    return pathname.isFile() && pattern.matcher(pathname.getName()).matches();
                }
            });

            if (children != null && children.length > 0) {
                for (final File errorLog: children) {
                    final long time = errorLog.lastModified();
                    if (time > lastCheckTime) {
                        // 只上传一条，根据修改时间查看
                        LauncherApplication.getInstance().showDialog(
                                IndexActivity.this,
                                getString(R.string.index__find_error_log), getString(R.string.constant__yes), new Runnable() {
                                    @Override
                                    public void run() {
                                        reportError(time, errorLog);
                                    }
                                }, "取消", null);
                        break;
                    }
                }
            }
        }

        SPService.putLong(SPService.KEY_ERROR_CHECK_TIME, System.currentTimeMillis());
    }

    /**
     * 上报Crash日志
     * @param errorTime
     * @param errorLog
     */
    private void reportError(final long errorTime, final File errorLog) {
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                File logsFolder = new File(getExternalCacheDir(), "logs");
                Date date = new Date(errorTime);
                final String targetDay = String.format(Locale.CHINA, "%d%d%d", date.getYear() + 1900,
                        date.getMonth() + 1, date.getDate());
                final List<File> reportLogs = new ArrayList<>();
                reportLogs.add(errorLog);
                if (logsFolder.exists() && logsFolder.isDirectory()) {
                    File[] childrenFiles = logsFolder.listFiles(new FilenameFilter() {
                        @Override
                        public boolean accept(File dir, String name) {
                            return name.startsWith(targetDay) && name.endsWith(".log");
                        }
                    });

                    if (childrenFiles != null && childrenFiles.length > 0) {
                        Arrays.sort(childrenFiles, new Comparator<File>() {
                            @Override
                            public int compare(File o1, File o2) {
                                return (int) (o2.lastModified() - o1.lastModified());
                            }
                        });

                        // 从最新的向前翻，直到大于2MB
                        long currentSize = 0;
                        for (File child : childrenFiles) {
                            currentSize += child.length();
                            if (currentSize > 2 * 1024 * 1024) {
                                break;
                            }
                            reportLogs.add(child);
                        }
                    }
                }

                final File zipFile = ZipUtil.zip(reportLogs, new File(FileUtils.getSubDir("share"), "report.zip"));
                if (zipFile != null && zipFile.exists()) {
                    // 发送邮件
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            Intent i = new Intent(Intent.ACTION_SEND);
                            i.setType("application/octet-stream");
                            i.putExtra(Intent.EXTRA_EMAIL,
                                    new String[] { Constant.MAIL_ADDERSS });
                            i.putExtra(Intent.EXTRA_SUBJECT, StringUtil.getString(R.string.index__report_error_log));
                            i.putExtra(Intent.EXTRA_TEXT, getString(R.string.index__error_occur_time, errorTime));
                            Uri uri = FileProvider.getUriForFile(IndexActivity.this, "com.alipay.hulu.myProvider", zipFile);
                            i.putExtra(Intent.EXTRA_STREAM, uri);
                            startActivity(Intent.createChooser(i,
                                    getString(R.string.index__select_mail_app)));
                        }
                    });
                } else {
                    toastLong("日志打包失败");

                    // 回设检查时间，以便下次上报
                    SPService.putLong(SPService.KEY_ERROR_CHECK_TIME, errorTime - 10);
                }
            }
        });
    }

    public static class Entry {

        private int iconId;
        private String name;
        private String[] permissions;
        private int level;
        private int index;
        private int cornerColor;
        private String cornerText;
        private float saturation;
        private int cornerPersist;
        private Class<? extends Activity> targetActivity;

        public Entry(EntryActivity activity, Class<? extends Activity> target) {
            this.iconId = activity.icon();
            this.name = activity.name();
            permissions = activity.permissions();
            level = activity.level();
            targetActivity = target;
            index = activity.index();
            cornerText = activity.cornerText();
            cornerColor = activity.cornerBg();
            cornerPersist = activity.cornerPersist();
            saturation = activity.saturation();
        }

    }

    public class CustomAdapter extends BaseAdapter {

        final Context context;
        final List<Entry> data;
        JSONObject entryCount;
        JSONObject versionsCount;
        int currentVersionCode;

        public CustomAdapter(Context context, List<Entry> data) {
            this.context = context;
            this.data = data;

            // 默认取空值
            String appInfo = SPService.getString(SPService.KEY_INDEX_RECORD, null);
            currentVersionCode = SystemUtil.getAppVersionCode();
            if (appInfo == null) {
                versionsCount = new JSONObject();
                entryCount = new JSONObject();
            } else {
                versionsCount = JSON.parseObject(appInfo);
                // 当前版本的信息
                entryCount = versionsCount.getJSONObject(Integer.toString(currentVersionCode));

                // 如果没有当前版本信息
                if (entryCount == null) {
                    entryCount = new JSONObject();
                }
            }
        }

        @Override
        public int getCount() {
            if (data != null) {
                return data.size();
            } else {
                return 0;
            }
        }

        @Override
        public Object getItem(int position) {
            if (data != null) {
                return data.get(position);
            } else {
                return null;
            }
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            final ViewHolder viewHolder;
            if (convertView == null) {
                convertView = LayoutInflater.from(context).inflate(R.layout.item_tools_grid, parent, false);
                viewHolder = new ViewHolder();
                convertView.setTag(viewHolder);
                viewHolder.icon = (ImageView) convertView.findViewById(R.id.img);
                viewHolder.name = (TextView) convertView.findViewById(R.id.tv);
                viewHolder.corner = (TextView) convertView.findViewById(R.id.index_corner);
                viewHolder.background = (ColorFilterRelativeLayout) convertView;
            } else {
                viewHolder = (ViewHolder) convertView.getTag();
            }

            final Entry item = data.get(position);

            viewHolder.icon.setImageResource(item.iconId);
            viewHolder.name.setText(item.name);

            Integer itemCount = entryCount.getInteger(item.name);
            if (itemCount == null) {
                itemCount = 0;
            }
            // 持续显示或者，有进入次数计数
            if (item.cornerPersist == 0 ||
                    (item.cornerPersist > 0 && itemCount < item.cornerPersist)) {
                // 如果有角标配置，设置角标
                if (!StringUtil.isEmpty(item.cornerText)) {
                    viewHolder.corner.setText(item.cornerText);
                    viewHolder.corner.setBackgroundColor(item.cornerColor);
                    viewHolder.corner.setVisibility(View.VISIBLE);
                } else {
                    viewHolder.corner.setVisibility(View.GONE);
                }
            } else {
                viewHolder.corner.setVisibility(View.GONE);
            }

            if (item.saturation != 1F) {
                viewHolder.background.setSaturation(item.saturation);
            }

            convertView.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    final long startTime = System.currentTimeMillis();
                    PermissionUtil.requestPermissions(Arrays.asList(item.permissions), IndexActivity.this, new PermissionUtil.OnPermissionCallback() {
                        @Override
                        public void onPermissionResult(boolean result, String reason) {
                            LogUtil.d(TAG, "权限申请耗时：%dms", System.currentTimeMillis() - startTime);
                            if (result) {
                                if (mPanel != null) {

                                    // 记录下进入次数
                                    Integer count = entryCount.getInteger(item.name);
                                    if (count == null) {
                                        count = 1;
                                    } else {
                                        count ++;
                                    }
                                    entryCount.put(item.name, count);
                                    versionsCount.put(Integer.toString(currentVersionCode), entryCount);
                                    SPService.putString(SPService.KEY_INDEX_RECORD, JSON.toJSONString(versionsCount));

                                    mPanel.post(new Runnable() {
                                        @Override
                                        public void run() {
                                            Intent intent = new Intent(IndexActivity.this, item.targetActivity);
                                            startActivity(intent);
                                        }
                                    });
                                }
                            }
                        }
                    });
                }
            });
            return convertView;
        }

        public List<Entry> getData() {
            return data;
        }

        public class ViewHolder {
            ColorFilterRelativeLayout background;
            ImageView icon;
            TextView name;
            TextView corner;
        }
    }


}
