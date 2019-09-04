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
package com.alipay.hulu.common.utils.activity;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.v4.app.ActivityCompat;
import android.text.Html;
import android.view.Display;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import com.alipay.hulu.common.R;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.constant.Constant;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.android.permission.FloatWindowManager;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Created by qiaoruikai on 2018/10/15 5:20 PM.
 */
public class PermissionDialogActivity extends Activity implements View.OnClickListener {
    private static final String TAG = "PermissionDialog";
    public static final String PERMISSIONS_KEY = "permissions";
    public static final String PERMISSION_IDX_KEY = "permissionIdx";
    private static final String PERMISSION_SKIP_RECORD = "skipRecord";
    private static final String PERMISSION_GRANT_RECORD = "grantRecord";
    private static final String PERMISSION_GRANT_ADB = "grantAdb";

    public static final int PERMISSION_FLOAT = 1;
    public static final int PERMISSION_ADB = 2;
    public static final int PERMISSION_ROOT = 3;
    public static final int PERMISSION_TOAST = 4;
    public static final int PERMISSION_ACCESSIBILITY = 5;
    public static final int PERMISSION_USAGE = 6;
    public static final int PERMISSION_RECORD = 7;
    public static final int PERMISSION_ANDROID = 8;
    public static final int PERMISSION_DYNAMIC = 9;

    public static volatile boolean runningStatus = false;

    private InjectorService injectorService;

    private TextView permissionPassed;
    private TextView permissionTotal;

    private ProgressBar progressBar;
    private TextView permissionText;

    private LinearLayout actionLayout;
    private LinearLayout positiveButton;
    private TextView positiveBtnText;
    private LinearLayout negativeButton;
    private TextView negativeBtnText;
    private int currentIdx;
    private int totalIdx;

    private int USAGE_REQUEST = 10001;
    private int ACCESSIBILITY_REQUEST = 10002;
    private int M_PERMISSION_REQUEST = 10003;
    private int MEDIA_PROJECTION_REQUEST = 10004;

    private List<GroupPermission> allPermissions;
    private int currentPermissionIdx;

    /**
     * 权限名称映射表
     */
    public static final Map<String, String> PERMISSION_NAMES = new HashMap<String, String>() {
        {
            put(Manifest.permission.READ_CALENDAR, "读取日历");
            put(Manifest.permission.WRITE_CALENDAR, "写入日历");
            put(Manifest.permission.CAMERA, "相机");
            put(Manifest.permission.READ_CONTACTS, "读取联系人");
            put(Manifest.permission.WRITE_CONTACTS, "写入联系人");
            put(Manifest.permission.GET_ACCOUNTS, "获取账户");
            put(Manifest.permission.ACCESS_FINE_LOCATION, "获取精确定位");
            put(Manifest.permission.ACCESS_COARSE_LOCATION, "获取粗略定位");
            put(Manifest.permission.RECORD_AUDIO, "录音");
            put(Manifest.permission.READ_PHONE_STATE, "读取电话状态");
            put(Manifest.permission.CALL_PHONE, "拨打电话");
            put(Manifest.permission.READ_CALL_LOG, "读取通话记录");
            put(Manifest.permission.WRITE_CALL_LOG, "写入通话记录");
            put(Manifest.permission.ADD_VOICEMAIL, "添加语音邮箱");
            put(Manifest.permission.USE_SIP, "使用SIP");
            put(Manifest.permission.BODY_SENSORS, "获取传感器数据");
            put(Manifest.permission.SEND_SMS, "发送短信");
            put(Manifest.permission.RECEIVE_SMS, "接收短信");
            put(Manifest.permission.READ_SMS, "获取短信信息");
            put(Manifest.permission.RECEIVE_WAP_PUSH, "接收Wap Push");
            put(Manifest.permission.RECEIVE_MMS, "接收MMS");
            put(Manifest.permission.READ_EXTERNAL_STORAGE, "读取外部存储");
            put(Manifest.permission.WRITE_EXTERNAL_STORAGE, "写入外部存储");

        }
    };

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setFinishOnTouchOutside(false);
        setContentView(R.layout.permission_dialog_layout);

        setupWindow();

        injectorService = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());

        initView();
        initControl();
    }

    @Override
    public void onBackPressed() {
        finish();
        PermissionUtil.onPermissionResult(currentPermissionIdx, false, "取消授权");
    }

    /**
     * 设置窗体信息
     */
    private void setupWindow() {
        WindowManager windowManager = getWindowManager();
        Display display = windowManager.getDefaultDisplay();
        WindowManager.LayoutParams params = getWindow().getAttributes();
        params.width = display.getWidth() - ContextUtil.dip2px(this, 48);
        getWindow().setGravity(Gravity.CENTER);
    }

    @Override
    public void finish() {
        runningStatus = false;
        super.finish();
    }

    @Override
    protected void onDestroy() {
        runningStatus = false;
        LogUtil.i(TAG, "权限弹窗Stop");
        super.onDestroy();
    }

    /**
     * 加载界面
     */
    private void initView() {
        permissionPassed = (TextView) findViewById(R.id.permission_success);
        permissionTotal = (TextView) findViewById(R.id.permission_all);

        progressBar = (ProgressBar) findViewById(R.id.permission_loading_progress);
        permissionText = (TextView) findViewById(R.id.permission_text);

        actionLayout = (LinearLayout) findViewById(R.id.permission_action_layout);
        positiveButton = (LinearLayout) findViewById(R.id.permission_positive_button);
        positiveBtnText = (TextView) positiveButton.getChildAt(0);
        negativeButton = (LinearLayout) findViewById(R.id.permission_negative_button);
        negativeBtnText = (TextView) negativeButton.getChildAt(0);
    }

    private void initControl() {
        positiveButton.setOnClickListener(this);
        negativeButton.setOnClickListener(this);

        currentPermissionIdx = getIntent().getIntExtra(PERMISSION_IDX_KEY, -1);
        groupPermissions();
        processPermission();
    }

    /**
     * 权限分组
     */
    private void groupPermissions() {
        List<String> permissions = getIntent().getStringArrayListExtra(PERMISSIONS_KEY);
        Map<Integer, GroupPermission> currentPermissions = new LinkedHashMap<>();

        // 按照分组过一遍
        for (String permission : permissions) {
            int group;
            switch (permission) {
                case "float":
                    group = PERMISSION_FLOAT;
                    break;
                case "root":
                    group = PERMISSION_ROOT;
                    break;
                case "adb":
                    group = PERMISSION_ADB;
                    break;
                case Settings.ACTION_USAGE_ACCESS_SETTINGS:
                    group = PERMISSION_USAGE;
                    break;
                case Settings.ACTION_ACCESSIBILITY_SETTINGS:
                    group = PERMISSION_ACCESSIBILITY;
                    break;
                case "screenRecord":
                    group = PERMISSION_RECORD;
                    break;
                default:
                    if (permission.startsWith("Android=")) {
                        group = PERMISSION_ANDROID;
                    } else if (permission.startsWith("toast:")) {
                        group = PERMISSION_TOAST;
                    } else {
                        group = PERMISSION_DYNAMIC;
                    }
                    break;
            }

            // 如果有同分组
            GroupPermission permissionG = currentPermissions.get(group);
            if (permissionG == null) {
                permissionG = new GroupPermission(group);
                currentPermissions.put(group, permissionG);
            }

            permissionG.addPermission(permission);
        }

        // 设置下实际需要的权限
        allPermissions = new ArrayList<>(currentPermissions.values());
    }

    /**
     * 开始处理权限
     */
    public void processPermission() {
        if (allPermissions == null || allPermissions.size() == 0) {
            showAction(StringUtil.getString(R.string.permission_list_error), getString(R.string.constant__confirm), new Runnable() {
                @Override
                public void run() {
                    finish();
                }
            });
        }

        currentIdx = -1;
        totalIdx = allPermissions.size();

        // 设置待处理总数
        permissionTotal.setText(StringUtil.toString(totalIdx));

        // 开始处理权限
        processedAction();
    }

    /**
     * 处理单项权限
     */
    private void processSinglePermission() {
        final GroupPermission permission = allPermissions.get(currentIdx);

        // 按照权限组别处理
        switch (permission.permissionType) {
            case PERMISSION_FLOAT:
                if(!processFloatPermission()) {
                    return;
                }
                break;
            case PERMISSION_ROOT:
                if (!processRootPermission()) {
                    return;
                }
                break;
            case PERMISSION_ADB:
                if (!processAdbPermission()) {
                    return;
                }
                break;
            case PERMISSION_TOAST:
                if (!processToastPermission(permission)) {
                    return;
                }
                break;
            case PERMISSION_USAGE:
                if (!processUsagePermission()) {
                    return;
                }
                break;
            case PERMISSION_ACCESSIBILITY:
                if (!processAccessibilityPermission()) {
                    return;
                }
                break;
            case PERMISSION_RECORD:
                if (!processRecordPermission()) {
                    return;
                }
                break;
            case PERMISSION_ANDROID:
                if (!processAndroidVersionPermission(permission)) {
                    return;
                }
                break;
            case PERMISSION_DYNAMIC:
                if (!processDynamicPermission(permission)) {
                    return;
                }
                break;
        }

        // 成功的直接processed
        processedAction();
    }

    /**
     * 悬浮窗权限判断
     * @return
     */
    private boolean processFloatPermission() {
        if (!FloatWindowManager.getInstance().checkPermission(this)) {
            showAction(StringUtil.getString(R.string.float_permission), getString(R.string.permission__i_grant), new Runnable() {
                @Override
                public void run() {
                    if (FloatWindowManager.getInstance().checkPermission(PermissionDialogActivity.this)) {
                        processedAction();
                    } else {
                        LauncherApplication.toast(R.string.permission__no_float_permission);
                    }
                }
            }, getString(R.string.constant__confirm), new Runnable() {
                @Override
                public void run() {
                    FloatWindowManager.getInstance().applyPermissionDirect(PermissionDialogActivity.this);
                }
            });
            return false;
        }
        return true;
    }

    /**
     * 判断root权限
     * @return
     */
    private boolean processRootPermission() {
        if (!CmdTools.isRooted()) {
            showAction(StringUtil.getString(R.string.root_permission), getString(R.string.constant__confirm), new Runnable() {
                @Override
                public void run() {
                    finish();
                    PermissionUtil.onPermissionResult(currentPermissionIdx, false, "该需要Root权限，请Root后使用");
                }
            });
            return false;
        }

        return true;
    }

    /**
     * 处理ADB权限
     * @return
     */
    private boolean processAdbPermission() {
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                boolean status;
                if (SPService.getBoolean(PERMISSION_GRANT_ADB, false)) {
                    status = CmdTools.generateConnection();
                } else {
                    status = CmdTools.isInitialized();
                }
                if (!status) {
                    showAction(StringUtil.getString(R.string.adb_permission), getString(R.string.constant__confirm), new Runnable() {
                        @Override
                        public void run() {
                            SPService.putBoolean(PERMISSION_GRANT_ADB, true);
                            progressBar.setVisibility(View.VISIBLE);
                            permissionText.setText(R.string.adb_open_advice);
                            positiveButton.setEnabled(false);
                            BackgroundExecutor.execute(new Runnable() {
                                @Override
                                public void run() {
                                    boolean result;
                                    try {
                                        result = CmdTools.generateConnection();
                                    } catch (Exception e) {
                                        LogUtil.e(TAG, "连接adb异常", e);
                                        result = false;
                                    }

                                    if (result) {
                                        runOnUiThread(new Runnable() {
                                            @Override
                                            public void run() {
                                                positiveButton.setEnabled(true);
                                            }
                                        });
                                        processedAction();
                                    } else {
                                        runOnUiThread(new Runnable() {
                                            @Override
                                            public void run() {
                                                progressBar.setVisibility(View.GONE);
                                                permissionText.setText(R.string.open_adb_permission_failed);
                                                positiveButton.setEnabled(true);
                                            }
                                        });
                                    }
                                }
                            });
                        }
                    }, getString(R.string.constant__cancel), new Runnable() {
                        @Override
                        public void run() {
                            finish();
                            PermissionUtil.onPermissionResult(currentPermissionIdx, false, "ADB连接失败");
                        }
                    });
                } else {
                    processedAction();
                }
            }
        });
        // 因为需要socket通信，所以就直接返回失败
        return false;
    }

    /**
     * 处理提示信息
     * @param permissionG
     * @return
     */
    private boolean processToastPermission(GroupPermission permissionG) {
        List<String> permissions = permissionG.permissions;
        final List<String> real = new ArrayList<>(permissions.size() + 1);

        for (String p: permissions) {
            String permission = p.substring(6);
            if (!SPService.getBoolean(permission, false)) {
                real.add(permission);
            }
        }

        if (!real.isEmpty()) {
            showAction(StringUtil.join("\n", real), getString(R.string.permission__i_know), new Runnable() {
                @Override
                public void run() {
                    processedAction();
                }
            }, getString(R.string.constant__no_inform), new Runnable() {
                @Override
                public void run() {
                    for (String p: real) {
                        SPService.putBoolean(p, true);
                    }
                    processedAction();
                }
            });
            return false;
        }
        return true;
    }

    /**
     * 处理使用情况权限
     * @return
     */
    private boolean processUsagePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT && !PermissionUtil.isUsageStatPermissionOn(this)) {
            showAction(StringUtil.getString(R.string.device_usage_permission), getString(R.string.permission__i_open), new Runnable() {
                @Override
                public void run() {
                    if (PermissionUtil.isUsageStatPermissionOn(PermissionDialogActivity.this)) {
                        processedAction();
                    } else {
                        LauncherApplication.toast(R.string.permission__valid_fail);
                    }
                }
            }, getString(R.string.constant__confirm), new Runnable() {
                @Override
                public void run() {
                    Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
                    startActivityForResult(intent, USAGE_REQUEST);
                }
            });
            return false;
        }

        return true;
    }

    /**
     * 处理辅助功能权限
     * @return
     */
    private boolean processAccessibilityPermission() {
        final InjectorService service = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());

        // 没有注册上AccessibilityService，需要开辅助功能
        if (service.getMessage(SubscribeParamEnum.ACCESSIBILITY_SERVICE, null) == null) {
            showAction(StringUtil.getString(R.string.accessibility_permission), getString(R.string.permission__i_open), new Runnable() {
                @Override
                public void run() {
                    if (service.getMessage(SubscribeParamEnum.ACCESSIBILITY_SERVICE, null) != null) {
                        processedAction();
                    } else {
                        LauncherApplication.toast(R.string.permission__valid_fail);
                    }
                }
            }, getString(R.string.constant__confirm), new Runnable() {
                @Override
                public void run() {
                    Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK
                            | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
                    // | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    startActivityForResult(intent, ACCESSIBILITY_REQUEST);
                }
            });
            return false;
        }

        return true;
    }

    /**
     * 处理录屏权限
     * @return
     */
    @SuppressWarnings("NewApi")
    private boolean processRecordPermission() {
        // 如果包含忽略录屏，直接跳过
        if (SPService.getBoolean(PERMISSION_SKIP_RECORD, false)) {
            return true;
        }

        if (Build.VERSION.SDK_INT < 21) {
            showAction(StringUtil.getString(R.string.record_screen_android_version_error, Build.VERSION.SDK_INT), getString(R.string.constant__confirm), new Runnable() {
                @Override
                public void run() {
                    SPService.putBoolean(PERMISSION_SKIP_RECORD, true);
                    processedAction();
                }
            });
            return false;
        }


        if (injectorService.getMessage(Constant.EVENT_RECORD_SCREEN_CODE, Intent.class) == null) {
            MediaProjectionManager mMediaProjectionManager = (MediaProjectionManager) getApplicationContext().getSystemService(MEDIA_PROJECTION_SERVICE);
            final Intent intent = mMediaProjectionManager.createScreenCaptureIntent();

            // 之前申请过，直接申请
            if (SPService.getBoolean(PERMISSION_GRANT_RECORD, false)) {
                startActivityForResult(intent, MEDIA_PROJECTION_REQUEST);
            }

            showAction(StringUtil.getString(R.string.record_screen_permission), getString(R.string.permission__i_permit), new Runnable() {
                @Override
                public void run() {
                    if (injectorService.getMessage(Constant.EVENT_RECORD_SCREEN_CODE, Intent.class) != null) {
                        processedAction();
                        SPService.putBoolean(PERMISSION_GRANT_RECORD, true);
                    } else {
                        LauncherApplication.toast(R.string.permission__no_record_info);
                    }
                }
            }, getString(R.string.constant__confirm), new Runnable() {
                @Override
                public void run() {
                    startActivityForResult(intent, MEDIA_PROJECTION_REQUEST);
                }
            });
            return false;
        }

        return true;
    }

    /**
     * 处理系统权限版本
     * @param permission
     * @return
     */
    private boolean processAndroidVersionPermission(GroupPermission permission) {
        int maxVersion = 0;

        // 计算需要的最高系统版本
        for (String per: permission.permissions) {
            int currentMax = Integer.parseInt(per.substring(8));
            if (currentMax > maxVersion) {
                maxVersion = currentMax;
            }
        }


        if (Build.VERSION.SDK_INT < maxVersion) {
            showAction(StringUtil.getString(R.string.android_version_error, maxVersion, Build.VERSION.SDK_INT), getString(R.string.constant__confirm), new Runnable() {
                @Override
                public void run() {
                    finish();
                    PermissionUtil.onPermissionResult(currentPermissionIdx, false, "系统版本过低");
                }
            });
            return false;
        }

        return true;
    }

    @Override
    protected void onStart() {
        super.onStart();
        runningStatus = true;
    }

    @Override
    protected void onStop() {
        super.onStop();
    }

    /**
     * 处理需要动态授权的权限
     */
    private boolean processDynamicPermission(GroupPermission permission) {
        // 动态申请权限
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            String[] requestPermissions = permission.permissions.toArray(new String[0]);

            // 看下哪些权限没有被授权
            final List<String> ungrantedPermissions = PermissionUtil.checkUngrantedPermission(this, requestPermissions);
            if (ungrantedPermissions != null && ungrantedPermissions.size() > 0) {
                List<String> mappedName = new ArrayList<>();
                for (String dynPermission: ungrantedPermissions) {
                    String mapName = PERMISSION_NAMES.get(dynPermission);
                    if (mapName != null) {
                        mappedName.add(mapName);
                    } else {
                        mappedName.add(dynPermission);
                    }
                }

                String permissionNames = StringUtil.join("、", mappedName);

                showAction(StringUtil.getString(R.string.request_dynamic_permission, permissionNames, ungrantedPermissions.size()), getString(R.string.constant__confirm), new Runnable() {
                    @Override
                    public void run() {
                        ActivityCompat.requestPermissions(PermissionDialogActivity.this, ungrantedPermissions.toArray(new String[0]), M_PERMISSION_REQUEST);
                    }
                }, getString(R.string.constant__cancel), new Runnable() {
                    @Override
                    public void run() {
                        LogUtil.i(TAG, "用户取消授权");
                        finish();
                        PermissionUtil.onPermissionResult(currentPermissionIdx, false, "用户不进行授权");
                    }
                });
                return false;
            }
        }

        return true;
    }

    /**
     * 显示操作框
     * @param message 显示文案
     * @param positiveText 确定文案
     * @param positiveAction 确定动作
     */
    private void showAction(String message, String positiveText, Runnable positiveAction) {
        showAction(message, positiveText, positiveAction, null, null);
    }

    /**
     * 显示操作框
     * @param message 显示文案
     * @param positiveText 确定文案
     * @param positiveAct 确定动作
     * @param negativeText 取消文案
     * @param negativeAct 取消动作
     */
    private void showAction(final String message, final String positiveText, final Runnable positiveAct,
                            final String negativeText, final Runnable negativeAct) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                positiveAction = positiveAct;
                negativeAction = negativeAct;

                progressBar.setVisibility(View.GONE);
                actionLayout.setVisibility(View.VISIBLE);

                // 显示文字
                permissionText.setText(Html.fromHtml(StringUtil.patternReplace(message, "\n", "<br/>")));

                // 设置按钮文本
                positiveBtnText.setText(positiveText);
                // 如果取消非空
                if (!StringUtil.isEmpty(negativeText)) {
                    negativeButton.setVisibility(View.VISIBLE);
                    negativeBtnText.setText(negativeText);
                } else {
                    negativeButton.setVisibility(View.GONE);
                }
            }
        });
    }

    /**
     * 当前权限已处理完毕
     */
    private void processedAction() {
        currentIdx++;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                progressBar.setVisibility(View.VISIBLE);
                actionLayout.setVisibility(View.GONE);
                permissionPassed.setText(StringUtil.toString(currentIdx + 1));

                if (currentIdx >= totalIdx) {
                    finish();
                    PermissionUtil.onPermissionResult(currentPermissionIdx, true, null);
                    return;
                }

                // 开始处理下一条权限
                processSinglePermission();
            }
        });
    }

    private Runnable positiveAction;
    private Runnable negativeAction;

    @Override
    public void onClick(View v) {
        if (v == positiveButton) {
            if (positiveAction != null) {
                positiveAction.run();
            }
        } else if (v == negativeButton) {
            if (negativeAction != null) {
                negativeAction.run();
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == USAGE_REQUEST) {
            currentIdx --;
            processedAction();
        } else if (requestCode == MEDIA_PROJECTION_REQUEST && resultCode == RESULT_OK) {
            LogUtil.d(TAG, "获取录屏许可，录屏响应码：" + resultCode);
            injectorService.pushMessage(Constant.EVENT_RECORD_SCREEN_CODE, data);
            processedAction();
            SPService.putBoolean(PERMISSION_GRANT_RECORD, true);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == M_PERMISSION_REQUEST) {
            for (int i = 0; i < grantResults.length; i++) {
                int result = grantResults[i];
                if (result != PackageManager.PERMISSION_GRANTED) {
                    LogUtil.i(TAG, "用户不授权%s权限", permissions[i]);
                    // 重新去检查权限
                    processSinglePermission();
                    return;
                }
            }

            processedAction();
        }
    }

    /**
     * 权限分组
     */
    private static class GroupPermission {
        private int permissionType;
        private List<String> permissions;

        private GroupPermission(int permissionType) {
            this.permissionType = permissionType;
        }

        /**
         * 添加一条权限
         * @param permission
         */
        private void addPermission(String permission) {
            if (permissions == null) {
                permissions = new ArrayList<>();
            }

            if (!permissions.contains(permission)) {
                permissions.add(permission);
            } else {
                LogUtil.w(TAG, "Permission %s already added", permission);
            }
        }
    }
}
