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
import android.accessibilityservice.AccessibilityService;
import android.annotation.TargetApi;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.os.LocaleList;
import android.provider.Settings;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import android.text.Html;
import android.view.Display;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import com.alipay.hulu.common.R;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.constant.Constant;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.android.permission.FloatWindowManager;
import com.android.permission.rom.MiuiUtils;
import com.android.permission.rom.RomUtils;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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
    public static final int PERMISSION_BACKGROUND = 10;

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
    private LinearLayout thirdButton;
    private TextView thirdBtnText;
    private int currentIdx;
    private int totalIdx;

    private int USAGE_REQUEST = 10001;
    private int ACCESSIBILITY_REQUEST = 10002;
    private int M_PERMISSION_REQUEST = 10003;
    private int MEDIA_PROJECTION_REQUEST = 10004;

    private List<GroupPermission> allPermissions;
    private int currentPermissionIdx;
    private static final Pattern FILED_CALL_PATTERN = Pattern.compile("\\$\\{[^}\\s]+\\.?[^}\\s]*\\}");
    /**
     * 权限名称映射表
     */
    public static Map<String, Integer> PERMISSION_NAMES = new HashMap<String, Integer>() {
        {
            put(Manifest.permission.READ_CALENDAR, R.string.permission__read_calendar);
            put(Manifest.permission.WRITE_CALENDAR, R.string.permission__write_calendar);
            put(Manifest.permission.CAMERA, R.string.permission__camera);
            put(Manifest.permission.READ_CONTACTS, R.string.permission__read_contacts);
            put(Manifest.permission.WRITE_CONTACTS, R.string.permission__write_contacts);
            put(Manifest.permission.GET_ACCOUNTS, R.string.permission__get_accounts);
            put(Manifest.permission.ACCESS_FINE_LOCATION, R.string.permission__access_fine_location);
            put(Manifest.permission.ACCESS_COARSE_LOCATION, R.string.permission__access_coarse_location);
            put(Manifest.permission.RECORD_AUDIO, R.string.permission__record_audio);
            put(Manifest.permission.READ_PHONE_STATE, R.string.permission__read_phone_state);
            put(Manifest.permission.CALL_PHONE, R.string.permission__call_phone);
            put(Manifest.permission.READ_CALL_LOG, R.string.permission__read_call_log);
            put(Manifest.permission.WRITE_CALL_LOG, R.string.permission__write_call_log);
            put(Manifest.permission.ADD_VOICEMAIL, R.string.permission__add_voicemail);
            put(Manifest.permission.USE_SIP, R.string.permission__use_sip);
            put(Manifest.permission.BODY_SENSORS, R.string.permission__body_sensors);
            put(Manifest.permission.SEND_SMS, R.string.permission__send_sms);
            put(Manifest.permission.RECEIVE_SMS, R.string.permission__receive_sms);
            put(Manifest.permission.READ_SMS, R.string.permission__read_sms);
            put(Manifest.permission.RECEIVE_WAP_PUSH, R.string.permission__receive_wap_push);
            put(Manifest.permission.RECEIVE_MMS, R.string.permission__receive_mms);
            put(Manifest.permission.READ_EXTERNAL_STORAGE, R.string.permission__read_external_storage);
            put(Manifest.permission.WRITE_EXTERNAL_STORAGE, R.string.permission__write_external_storage);

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
        thirdButton = (LinearLayout) findViewById(R.id.permission_third_button);
        thirdBtnText = (TextView) thirdButton.getChildAt(0);
    }

    private void initControl() {
        positiveButton.setOnClickListener(this);
        negativeButton.setOnClickListener(this);
        thirdButton.setOnClickListener(this);

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
                case "background":
                    group = PERMISSION_BACKGROUND;
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
            case PERMISSION_BACKGROUND:
                if (!processBackgroundPermission()) {
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
        final List<String> sources = new ArrayList<>();

        for (String p: permissions) {
            String permission = p.substring(6);
            if (!isToastHandled(permission)) {
                sources.add(permission);
                real.add(getToastMessage(permission));
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
                    handleToast(sources);
                    processedAction();
                }
            });
            return false;
        }
        return true;
    }

    private static final String HANDLED_PERMISSIONS = "handledPermissions";

    /**
     * 确认toast是否处理过
     * @param origin
     * @return
     */
    private boolean isToastHandled(String origin) {
        List<String> permissions = SPService.get(HANDLED_PERMISSIONS, List.class);
        if (permissions != null && permissions.contains(origin)) {
            return true;
        }

        return SPService.getBoolean(origin, false);
    }

    /**
     * 处理权限
     * @param toasts
     */
    private void handleToast(List<String> toasts) {
        List<String> permissions = SPService.get(HANDLED_PERMISSIONS, List.class);
        if (permissions == null) {
            permissions = new ArrayList<>();
        }

        permissions.addAll(toasts);
        SPService.put(HANDLED_PERMISSIONS, permissions);
    }

    /**
     * 获取toast实际消息
     * @param source
     * @return
     */
    private String getToastMessage(String source) {
        return StringUtil.patternReplace(source, FILED_CALL_PATTERN, new StringUtil.PatternReplace() {
            @Override
            public String replacePattern(String origin) {
                String content = origin.substring(2, origin.length() - 1);
                int nameRes = 0;
                int lastDotPos = content.lastIndexOf('.');
                String clazz = content.substring(0, lastDotPos);
                String field = content.substring(lastDotPos + 1);
                try {
                    Class<?> RClass = ClassUtil.getClassByName(clazz);
                    Field nameResF = RClass.getDeclaredField(field);
                    nameRes = nameResF.getInt(null);
                } catch (Exception e) {
                    LogUtil.e(TAG, "Fail to load name result with id:" + content);
                    nameRes = R.string.app_name;
                }
                return getString(nameRes);
            }
        });
    }

    /**
     * 处理使用情况权限
     * @return
     */
    private boolean processUsagePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT && !PermissionUtil.isUsageStatPermissionOn(this)) {
            showAction(StringUtil.getString(R.string.device_usage_permission), getString(R.string.permission__i_grant), new Runnable() {
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
            BackgroundExecutor.execute(new Runnable() {
                @Override
                public void run() {
                    final CountDownLatch latch = new CountDownLatch(1);
                    InjectorService.g().waitForMessage(SubscribeParamEnum.ACCESSIBILITY_SERVICE, new Callback<AccessibilityService>() {
                        @Override
                        public void onResult(AccessibilityService item) {
                            latch.countDown();
                        }

                        @Override
                        public void onFailed() {
                            latch.countDown();
                        }
                    });
                    CmdTools.putAccessibility("enabled_accessibility_services", "com.alipay.hulu/com.alipay.hulu.shared.event.accessibility.AccessibilityServiceImpl");
                    CmdTools.putAccessibility("accessibility_enabled", "1");

                    try {
                        latch.await(2000, TimeUnit.MILLISECONDS);
                    } catch (InterruptedException e) {
                        LogUtil.e(TAG, "Catch java.lang.InterruptedException: " + e.getMessage(), e);
                    }

                    if (InjectorService.g().getMessage(SubscribeParamEnum.ACCESSIBILITY_SERVICE, AccessibilityService.class) == null) {
                        CmdTools.execHighPrivilegeCmd("settings put secure enabled_accessibility_services com.alipay.hulu/com.alipay.hulu.shared.event.accessibility.AccessibilityServiceImpl");
                        CmdTools.execHighPrivilegeCmd("settings put secure accessibility_enabled 1");
                    }
                    try {
                        latch.await(2000, TimeUnit.MILLISECONDS);
                    } catch (InterruptedException e) {
                        LogUtil.e(TAG, "Catch java.lang.InterruptedException: " + e.getMessage(), e);
                    }

                    // 可能是因为UIAutomator、Instrument等工具影响，清理掉
                    if (InjectorService.g().getMessage(SubscribeParamEnum.ACCESSIBILITY_SERVICE, AccessibilityService.class) == null) {
                        showAction(getString(R.string.permission__try_kil_uiautomator), getString(R.string.constant__cancel), new Runnable() {
                            @Override
                            public void run() {
                                finish();
                                PermissionUtil.onPermissionResult(currentPermissionIdx, false, "User cancel");
                            }
                        });
                        restartAccessibilityService();
                    }
                    LauncherApplication.getInstance().showToast(getString(R.string.permission__open_accessibility));

                    // 等2秒，确定消息发过来了
                    MiscUtil.sleep(2000);

                    LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (service.getMessage(SubscribeParamEnum.ACCESSIBILITY_SERVICE, null) != null) {
                                processedAction();
                            } else {
                                processAccessibilityByHand(injectorService);
                            }
                        }
                    });
                }
            });

            return false;
        }

        return true;
    }

    /**
     * 手动处理辅助功能问题
     * @param service
     */
    private void processAccessibilityByHand(final InjectorService service) {
        showAction(StringUtil.getString(R.string.accessibility_permission), getString(R.string.permission__i_grant), new Runnable() {
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
        }, getString(R.string.permission__force_stop), new Runnable() {
            @Override
            public void run() {
                BackgroundExecutor.execute(new Runnable() {
                    @Override
                    public void run() {
                        CmdTools.execHighPrivilegeCmd("am force-stop com.alipay.hulu && am force-stop com.alipay.hulu");
                    }
                });
            }
        });
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

            showAction(StringUtil.getString(R.string.record_screen_permission), getString(R.string.permission__i_grant), new Runnable() {
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

    /**
     * 处理后台弹出界面权限
     * @return
     */
    private boolean processBackgroundPermission() {
        if (RomUtils.checkIsMiuiRom()) {
            final String content = getString(R.string.permission__open_background_permission);
            if (!SPService.getBoolean(content, false)) {
                showAction(content, getString(R.string.permission__opened), new Runnable() {
                    @Override
                    public void run() {
                        SPService.putBoolean(content, true);
                        processedAction();
                    }
                }, getString(R.string.permission__go_to_open), new Runnable() {
                    @Override
                    public void run() {
                        MiuiUtils.applyMiuiPermission(PermissionDialogActivity.this);
                    }
                });
                return false;
            }
        }
        return true;
    }



    /**
     * 关闭Instrument和UIAutomator
     */
    public static void cleanInstrumentationAndUiAutomator() {
        String allActions = CmdTools.execHighPrivilegeCmd("ps -ef | grep shell");
        LogUtil.i(TAG, "Let me see::::" + allActions);

        // 关闭Instrument
        String result = CmdTools.execHighPrivilegeCmd("pm list instrumentation");
        if (StringUtil.isEmpty(result)) {
            LogUtil.e(TAG, "fail to kill instrument apps");
        } else {
            String[] lines = StringUtil.split(result, "\n");
            Pattern pattern = Pattern.compile("\\(target=(.*)\\)");
            String targetApp = InjectorService.g().getMessage(SubscribeParamEnum.APP, String.class);

            for (String line : lines) {
                Matcher matcher = pattern.matcher(line);
                if (matcher.find()) {
                    String instPkg = matcher.group(1);
                    if (StringUtil.equals(instPkg, "com.alipay.hulu")) {
                        continue;
                    }
                    // 不杀目标应用
                    if (StringUtil.equals(instPkg, targetApp)) {
                        continue;
                    }

                    LauncherApplication.getInstance().showToast(StringUtil.getString(R.string.permission__kill_app, instPkg));
                    LogUtil.i(TAG, "Find instrumentation package and killing \"" + instPkg + "\"");
                    String exeRes = CmdTools.execHighPrivilegeCmd("am force-stop " + instPkg);
                    LogUtil.i(TAG, "force-stop result:::" + exeRes);
                    CmdTools.execHighPrivilegeCmd("am force-stop " + instPkg);
                }
            }
        }

        // 关闭UIAutomator
        String[] pids = CmdTools.ps("uiautomator");
        if (pids != null && pids.length > 0) {
            for (String pid : pids) {
                LogUtil.i(TAG, "Get uiautomator pid line: " + pid);
                String[] columns = pid.split("\\s+");
                if (columns.length > 2) {
                    pid = columns[1];
                    CmdTools.execHighPrivilegeCmd("kill " + pid);
                }
            }
        }

        // 杀掉Monkey
        pids = CmdTools.ps("monkey");
        if (pids != null && pids.length > 0) {
            for (String pid : pids) {
                // 只杀掉shell用户开启的monkey
                if (!StringUtil.contains(pid, "shell")) {
                    continue;
                }
                LogUtil.i(TAG, "Get Monkey pid line: " + pid);
                String[] columns = pid.split("\\s+");
                if (columns.length > 2) {
                    pid = columns[1];
                    CmdTools.execHighPrivilegeCmd("kill " + pid);
                }
            }
        }
    }


    /**
     * 重启辅助功能
     */
    private void restartAccessibilityService() {
        LauncherApplication.getInstance().showToast(getString(R.string.permission__restarting_accessibility));
        // 关uiautomator
        cleanInstrumentationAndUiAutomator();

        // 提前点准备
        final CountDownLatch latch = new CountDownLatch(1);
        InjectorService.g().waitForMessage(SubscribeParamEnum.ACCESSIBILITY_SERVICE, new Callback<AccessibilityService>() {
            @Override
            public void onResult(AccessibilityService item) {
                latch.countDown();
            }

            @Override
            public void onFailed() {
                latch.countDown();
            }
        });

        // 切换回TalkBack
        CmdTools.putAccessibility("enabled_accessibility_services", "com.android.talkback/com.google.android.marvin.talkback.TalkBackService");
        // 等2秒
        MiscUtil.sleep(2000);

        CmdTools.putAccessibility("enabled_accessibility_services", "com.alipay.hulu/com.alipay.hulu.shared.event.accessibility.AccessibilityServiceImpl");

        // 等待辅助功能重新激活
        LauncherApplication.getInstance().showToast("尝试重启辅助功能，等待10秒");
        try {
            latch.await(10000, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            LogUtil.e(TAG, "Catch java.lang.InterruptedException: " + e.getMessage(), e);
        }
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
                    Integer mapName = PERMISSION_NAMES.get(dynPermission);
                    if (mapName != null) {
                        mappedName.add(StringUtil.getString(mapName));
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
     * @see #showAction(String, String, Runnable, String, Runnable, String, Runnable)
     */
    private void showAction(final String message, final String positiveText, final Runnable positiveAct,
                            final String negativeText, final Runnable negativeAct) {
        showAction(message, positiveText, positiveAct, negativeText, negativeAct, null, null);
    }

    /**
     * 显示操作框
     * @param message 显示文案
     * @param positiveText 确定文案
     * @param positiveAct 确定动作
     * @param negativeText 取消文案
     * @param negativeAct 取消动作
     * @param thirdText 第三操作文案
     * @param thirdAct 第三操作
     */
    private void showAction(final String message, final String positiveText, final Runnable positiveAct,
                            final String negativeText, final Runnable negativeAct, final String thirdText, final Runnable thirdAct) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                positiveAction = positiveAct;
                negativeAction = negativeAct;
                thirdAction = thirdAct;

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

                if (!StringUtil.isEmpty(thirdText)) {
                    thirdButton.setVisibility(View.VISIBLE);
                    thirdBtnText.setText(thirdText);
                } else {
                    thirdButton.setVisibility(View.GONE);
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
    private Runnable thirdAction;

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
        } else if (v == thirdButton) {
            if (thirdAction != null) {
                thirdAction.run();
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


    @Override
    protected void attachBaseContext(Context newBase) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            newBase = updateResources(newBase);
        }
        super.attachBaseContext(newBase);
    }

    @TargetApi(Build.VERSION_CODES.N)
    private static Context updateResources(Context context) {

        Resources resources = context.getResources();
        Locale locale = LauncherApplication.getInstance().getLanguageLocale();

        Configuration configuration = resources.getConfiguration();
        configuration.setLocale(locale);
        configuration.setLocales(new LocaleList(locale));
        return context.createConfigurationContext(configuration);
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
