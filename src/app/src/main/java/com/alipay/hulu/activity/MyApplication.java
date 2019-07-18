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
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.WindowManager;

import com.alipay.hulu.bean.CaseStepHolder;
import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.injector.provider.Provider;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.HuluCrashHandler;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.service.CaseReplayManager;
import com.alipay.hulu.shared.io.db.GreenDaoManager;
import com.alipay.hulu.util.LargeObjectHolder;
import com.liulishuo.filedownloader.FileDownloader;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.io.PrintWriter;
import java.text.Collator;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Timer;
import java.util.TimerTask;

public class MyApplication extends LauncherApplication {
    private static final String TAG = "MyApplication";

    private static MyApplication sInstance;

    private int activityCount = 0;

    private static String curSysInputMethod;

    public static String getCurSysInputMethod() {
        return curSysInputMethod;
    }

    private static final long DAY_MILLIONS = 24 * 60 * 60 * 1000;

    private WindowManager.LayoutParams wmParams = new WindowManager.LayoutParams();
    private WindowManager.LayoutParams floatWinParams = new WindowManager.LayoutParams();

    public WindowManager.LayoutParams getMywmParams() {
        return wmParams;
    }

    public WindowManager.LayoutParams getFloatWinParams() {
        return floatWinParams;
    }

    private String appPackage = null;

    private String appName = null;

    private String tempAppPackage = null;

    private String tempAppName = null;

    private InjectorService injectorService;

    private final List<ApplicationInfo> packageList = new ArrayList<>();

    private static TimerTask CLEAR_FILES_TASK = new TimerTask() {
        @Override
        public void run() {
            int clearDays = SPService.getInt(SPService.KEY_AUTO_CLEAR_FILES_DAYS, 3);
            if (clearDays < 0) {
                return;
            }

            // 待清理文件夹
            File[] clearFolders = FileUtils.getAutoClearDirs();

            for (File downloadDir: clearFolders) {

                long currentTime = System.currentTimeMillis();
                long clearTime = currentTime - clearDays * DAY_MILLIONS;

                // 如果设置为0，一天就清理
                if (clearDays == 0) {
                    clearTime = currentTime - DAY_MILLIONS;
                }

                File[] subFiles = downloadDir.listFiles();
                if (subFiles != null) {
                    for (File subFile : subFiles) {
                        // 删除文件
                        if (subFile.isFile() && subFile.lastModified() <= clearTime) {
                            FileUtils.deleteFile(subFile);
                        }
                    }
                }
            }
        }
    };


    // ANR 检测
    private Timer ANR_TIMER;
    private TimerTask ANR_WATCHER = new TimerTask() {
        private String lastTime = null;
        @Override
        public void run() {
            String cmd = "cat /data/anr/traces.txt | grep Cmd -B1";
            if (CmdTools.isInitialized()) {
                String result = CmdTools.execAdbCmd(cmd, 5000);

                // 没有anr文件
                if (StringUtil.contains(result, "No such file or directory")) {
                    return;
                }

                //拆分看下是什么应用
                String[] content = StringUtil.split(result, "\n");
                if (content == null || content.length < 2) {
                    LogUtil.w(TAG, "Can't parse content : " + result);
                    return;
                }

                String appInfo = content[0].replace('-', ' ').trim();
                // 之前的anr信息，不管
                if (StringUtil.equals(appInfo, lastTime)) {
                    return;
                }

                lastTime = appInfo;
                String app = content[1].split(":")[1].trim();

                // 如果发现了葫芦娃或者目标应用的Anr信息
                if (StringUtil.equals(getInstance().appPackage, app) || StringUtil.equals(app, MyApplication.getInstance().getPackageName())) {
                    LogUtil.w(TAG, "Find anr info: " + app);

                    File anrFile = new File(FileUtils.getSubDir("anr"), appInfo.replace(' ', '_') + ".txt");

                    // 已经发现过了
                    if (anrFile.exists()) {
                        return;
                    }

                    String pathInShell = FileUtils.getPathInShell(anrFile);
                    String cpCmd = "cp /data/anr/traces.txt " + pathInShell;
                    result = CmdTools.execHighPrivilegeCmd(cpCmd, 3000);

                    LogUtil.w(TAG, "Copy anr file result: " + result);

                    MyApplication.getInstance().showToast("发现anr信息，已拷贝至: " + pathInShell);
                }
            }
        }
    };

    /**
     * 开始检测ANR信息
     */
    public void startCheckAnr() {
        if (Build.VERSION.SDK_INT > 26) {
            LogUtil.w(TAG, "Anr trace is not supported for Android 8.1+");
            return;
        }

        if (ANR_TIMER == null) {
            ANR_TIMER = new Timer("Anr_Checker");
            ANR_TIMER.schedule(ANR_WATCHER, 3 * 1000, 30 * 1000);
        } else {
            LogUtil.d(TAG, "Anr Timer Already started");
        }
    }

    /**
     * 单用例回放
     */
    public static CaseReplayManager.OnFinishListener SINGLE_REPLAY_LISTENER = new CaseReplayManager.OnFinishListener() {
        @Override
        public void onFinish(List< ReplayResultBean > resultBeans, Context context) {
            Intent intent = new Intent(context, CaseReplayResultActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (resultBeans == null || resultBeans.size() != 1) {
                LogUtil.e(TAG, "返回结果异常");
                //FIXME yuawen
            } else {
                int id = CaseStepHolder.storeResult(resultBeans.get(0));
                intent.putExtra("data", id);
            }

            PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT);
            try {
                pendingIntent.send();
            } catch (PendingIntent.CanceledException e) {
                LogUtil.e(TAG, "Catch android.app.PendingIntent.CanceledException: " + e.getMessage(), e);
            }
        }
    };

    /**
     * 多用例回放
     */
    public static CaseReplayManager.OnFinishListener MULTI_REPLAY_LISTENER = new CaseReplayManager.OnFinishListener() {
        @Override
        public void onFinish(List<ReplayResultBean> resultBeans, Context context) {
            LargeObjectHolder.getInstance().setReplayResults(resultBeans);
            Intent intent = new Intent(context, BatchReplayResultActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT);
            try{
                pendingIntent.send();
            } catch (PendingIntent.CanceledException e) {
                LogUtil.e(TAG, "PendingIntent canceled ", e);
            }
        }
    };

    @Override
    public void init() {

        sInstance = this;

        // 注册自身信息
        injectorService = findServiceByName(InjectorService.class.getName());
        injectorService.register(this);

        //HuluCrashHandler.getCrashHandler().init();
        initLibraries();

        // 后台加载下应用列表
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                synchronized (MyApplication.class) {
                    loadApplicationList();
                }
            }
        });

        // 启动定时清理文件
        Timer timer = new Timer("AUTO_CLEAR_FILE");
        timer.schedule(CLEAR_FILES_TASK, 5000, 3 * 60 * 60 * 1000);

        startCheckAnr();
    }

    @Override
    protected void initInMain() {
        super.initInMain();
        registerLifecycleCallbacks();
    }

    /**
     * 获取应用列表
     * @return
     */
    public List<ApplicationInfo> loadAppList() {
        synchronized (MyApplication.class) {
            if (packageList.isEmpty()) {
                loadApplicationList();
            }
        }

        return packageList;
    }

    /**
     * 获取应用列表
     * @return
     */
    public void reloadAppList() {
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                synchronized (MyApplication.class) {
                    loadApplicationList();
                }
            }
        });
    }

    private void registerLifecycleCallbacks() {
        registerActivityLifecycleCallbacks(new ActivityLifecycleCallbacks() {
            @Override
            public void onActivityCreated(Activity activity, Bundle savedInstanceState) {

            }

            @Override
            public void onActivityStarted(Activity activity) {
                activityCount++;
            }

            @Override
            public void onActivityResumed(Activity activity) {

            }

            @Override
            public void onActivityPaused(Activity activity) {

            }

            @Override
            public void onActivityStopped(Activity activity) {
                activityCount--;
            }

            @Override
            public void onActivitySaveInstanceState(Activity activity, Bundle outState) {

            }

            @Override
            public void onActivityDestroyed(Activity activity) {

            }
        });
    }

    /**
     * 重新加载应用列表
     */
    private void loadApplicationList() {

        // 后台加载下应用列表
        List<ApplicationInfo> listPack = getPackageManager().getInstalledApplications(PackageManager.GET_META_DATA);

        List<ApplicationInfo> removedItems = new ArrayList<>();

        String selfPackage = getPackageName();
        boolean displaySystemApp = SPService.getBoolean(SPService.KEY_DISPLAY_SYSTEM_APP, false);

        for (ApplicationInfo pack: listPack) {
            if (!displaySystemApp && (pack.flags & ApplicationInfo.FLAG_SYSTEM) > 0) {
                removedItems.add(pack);
            }

            // 移除自身
            if (StringUtil.equals(selfPackage, pack.packageName)) {
                removedItems.add(pack);
            }
        }
        listPack.removeAll(removedItems);

        // 排序下
        final Comparator c = Collator.getInstance(Locale.CHINA);
        Collections.sort(listPack, new Comparator<ApplicationInfo>() {
            @Override
            public int compare(ApplicationInfo o1, ApplicationInfo o2) {
                String n1 = o1.loadLabel(getPackageManager()).toString();
                String n2 = o2.loadLabel(getPackageManager()).toString();
                return c.compare(n1, n2);
            }
        });

        packageList.clear();
        packageList.addAll(listPack);
    }

    /**
     * 当发生应用列表变化，重新加载下
     */
    public void notifyAppChangeEvent() {
        synchronized (MyApplication.class) {
            loadApplicationList();
        }
    }

    /**
     * 更新临时应用信息
     * @param appPackage
     * @param appName
     */
    public void updateAppAndNameTemp(String appPackage, String appName) {
        this.tempAppPackage = appPackage;
        this.tempAppName = appName;
        injectorService.pushMessage(SubscribeParamEnum.APP, tempAppPackage, true);
        injectorService.pushMessage(SubscribeParamEnum.APP_NAME, tempAppName, true);
    }

    public void invalidTempAppInfo() {
        this.tempAppName = null;
        this.tempAppPackage = null;

        // 加载默认信息
        if (this.appName == null || this.appPackage == null) {
            String[] appName = getSharedPreferences("FloatWinService", MODE_PRIVATE).getString("float_" + SubscribeParamEnum.APP, "").split("##");
            if (appName.length > 1) {
                this.appPackage = appName[1];
                this.appName = appName[0];
            } else {
                this.appPackage = "-";
                this.appName = "全局";
            }
        }
        injectorService.pushMessage(SubscribeParamEnum.APP, appPackage, true);
        injectorService.pushMessage(SubscribeParamEnum.APP_NAME, appName, true);
    }

    /**
     * 更新调试应用与包名
     *
     * @param appPackage
     * @param appName
     */
    public void updateAppAndName(String appPackage, String appName) {
        this.appName = appName;
        this.appPackage = appPackage;

        // 主动推消息
        injectorService.pushMessage(SubscribeParamEnum.APP, appPackage, true);
        injectorService.pushMessage(SubscribeParamEnum.APP_NAME, appName, true);

        getSharedPreferences("FloatWinService", MODE_PRIVATE).edit().putString("float_app", appName + "##" + appPackage).apply();
    }

    /**
     * 获取App名称和AppName
     *
     * @return
     */
    @Provider(value = {@Param(value = SubscribeParamEnum.APP, type = String.class),
            @Param(value = SubscribeParamEnum.APP_NAME, type = String.class)}, updatePeriod = 1000000)
    public Map<String, Object> getAppAndAppName() {
        HashMap<String, Object> content = new HashMap<>(3);

        if (tempAppName != null && tempAppPackage != null) {
            content.put(SubscribeParamEnum.APP, tempAppPackage);
            content.put(SubscribeParamEnum.APP_NAME, tempAppName);
            return content;
        }

        // 没有缓存，加载缓存
        if (this.appName == null || this.appPackage == null) {
            String[] appName = getSharedPreferences("FloatWinService", MODE_PRIVATE).getString("float_" + SubscribeParamEnum.APP, "").split("##");
            if (appName.length > 1) {
                this.appPackage = appName[1];
                this.appName = appName[0];
            } else {
                this.appPackage = "-";
                this.appName = "全局";
            }
        }

        content.put(SubscribeParamEnum.APP, appPackage);
        content.put(SubscribeParamEnum.APP_NAME, appName);

        return content;
    }

    private void initLibraries() {
        initGreenDao();
        initFileDownloader();

        curSysInputMethod = Settings.Secure.getString(getContentResolver(), Settings.Secure.DEFAULT_INPUT_METHOD);

        // 兜底记录未捕获的日志
        HuluCrashHandler handler = HuluCrashHandler.getCrashHandler();
        handler.registerCrashCallback(new HuluCrashHandler.CrashCallback() {
            @Override
            public void onAppCrash(Thread t, Throwable e) {
                File errorDir = FileUtils.getSubDir("error");
                File outputFile = new File(errorDir, System.currentTimeMillis() + ".log");
                try {
                    FileWriter writer = new FileWriter(outputFile);
                    PrintWriter printWriter = new PrintWriter(writer);
                    printWriter.println("故障线程：" + t.getName());
                    printWriter.println("故障日志：");
                    e.printStackTrace(printWriter);
                    printWriter.flush();
                    printWriter.close();
                } catch (IOException e1) {
                    LogUtil.e(TAG, "Catch java.io.IOException: " + e1.getMessage(), e);
                }
            }
        });
        handler.init();
    }

    private void initFileDownloader() {
        FileDownloader.setup(this);
    }

    private void initGreenDao() {
        GreenDaoManager.getInstance();
    }

    public void updateDefaultIme(String ime) {
        curSysInputMethod = ime;
    }

    public static MyApplication getInstance() {
        return sInstance;
    }
}