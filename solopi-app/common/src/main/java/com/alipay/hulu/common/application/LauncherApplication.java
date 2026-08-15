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
package com.alipay.hulu.common.application;

import androidx.annotation.StringRes;
import androidx.multidex.MultiDex;

import static android.content.DialogInterface.BUTTON_NEGATIVE;
import static android.content.DialogInterface.BUTTON_POSITIVE;

import static android.content.DialogInterface.BUTTON_NEGATIVE;
import static android.content.DialogInterface.BUTTON_POSITIVE;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.AlertDialog;
import android.app.Application;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.ComponentCallbacks2;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.os.Handler;
import android.os.LocaleList;
import android.os.Looper;
import android.view.WindowManager;
import android.widget.Toast;

import androidx.annotation.StringRes;
import androidx.multidex.MultiDex;

import com.alipay.hulu.common.R;
import com.alipay.hulu.common.http.HttpServer;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.injector.provider.Provider;
import com.alipay.hulu.common.logger.DiskLogStrategy;
import com.alipay.hulu.common.logger.SimpleFormatStrategy;
import com.alipay.hulu.common.scheme.SchemeActionResolver;
import com.alipay.hulu.common.scheme.SchemeHttpListener;
import com.alipay.hulu.common.scheme.SchemeResolver;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.service.base.AppGuardian;
import com.alipay.hulu.common.service.base.ExportService;
import com.alipay.hulu.common.service.base.LocalService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.trigger.Trigger;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.SortedList;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.common.utils.patch.PatchLoadResult;
import com.mdit.library.Enhancer;
import com.mdit.library.EnhancerInterface;
import com.mdit.library.MethodInterceptor;
import com.mdit.library.MethodProxy;
import com.orhanobut.logger.AndroidLogAdapter;
import com.orhanobut.logger.CsvFormatStrategy;
import com.orhanobut.logger.DiskLogAdapter;
import com.orhanobut.logger.Logger;

import java.io.File;
import java.io.IOException;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Queue;
import java.util.Set;
import java.util.Stack;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/**
 * Created by qiaoruikai on 2018/9/29 10:59 AM.
 */
@Provider(@Param(value = LauncherApplication.SYSTEM_GUARDIAN_EVENT, sticky = false, type = AppGuardian.ReceiveSystemEvent.class))
public abstract class LauncherApplication extends Application {
    private static final String TAG = LauncherApplication.class.getSimpleName();

    public static final String SHOW_LOADING_DIALOG = "showLoadingDialog";
    public static final String DISMISS_LOADING_DIALOG = "dismissLoadingDialog";
    public static final String ON_TRIM_MEMORY = "system_trim_memory";
    public static final String SYSTEM_GUARDIAN_EVENT = "system_guardian_event";

    private Map<String, SortedList<SchemeActionResolver>> schemeResolver;

    /**
     * Android系统默认语言
     */
    public final Locale DEFAULT_LOCALE;

    private HttpServer totalControlHttpServer;
    private SchemeHttpListener schemeListener;

    /**
     * 触发器线程池（无常备线程）
     */
    private final ExecutorService triggerThreadPool = new ThreadPoolExecutor(0, 3, 3, TimeUnit.MINUTES, new LinkedBlockingQueue<Runnable>(), new ThreadFactory() {
        AtomicInteger counter = new AtomicInteger(1);
        @Override
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r);
            t.setName("Trigger-thread-" + counter.getAndIncrement());
            return t;
        }
    });

    /**
     * 触发器队列
     */
    private Map<String, SortedList<Class<? extends Runnable>>> triggerClasses;

    protected static LauncherApplication appInstance;
    protected Map<String, ServiceReference> registeredService = new HashMap<>();
    private Handler handler;

    private Stack<ContextInstanceWrapper> openedActivity = new Stack<>();
    private Stack<ContextInstanceWrapper> openedService = new Stack<>();

    private volatile boolean finishInit = false;

    /**
     * 是否是DEBUG
     */
    public static boolean DEBUG = false;

    private volatile boolean accessibilityRegistered = false;

    public LauncherApplication() {
        DEFAULT_LOCALE = getSystemLocale();
    }

    /**
     * 获取AccessibilityService是否注册
     * @return
     */
    public boolean getAccessibilityState() {
        return accessibilityRegistered;
    }

    /**
     * 设置AccessibilityService状态
     * @param state
     */
    public void setAccessibilityState(boolean state) {
        this.accessibilityRegistered = state;
    }

    /**
     * 获取实例
     * @return
     */
    public static LauncherApplication getInstance() {
        return appInstance;
    }

    public Set<String> foregroundServiceClasses = new HashSet<>();

    /**
     * 注册自身为前台服务
     * @param serviceClz
     */
    public void registerSelfAsForegroundService(Class<? extends Service> serviceClz) {
        foregroundServiceClasses.add(serviceClz.getName());
    }

    public boolean isServiceForeGround(Class<? extends Service> serviceClz) {
        if (serviceClz == null) {
            return false;
        }
        return foregroundServiceClasses.contains(serviceClz.getName());
    }

    /**
     * 获取Context
     * @return
     */
    public static Context getContext() {
        return appInstance;
    }

    @Override
    public void onCreate() {
        // ClassUtil没有加载过类，说明是第一次启动，或者crash了
        if (!ClassUtil.recordClasses()) {
            finishInit = false;
        }

        // 初始化过，看看不重新onCreate的影响
        if (finishInit) {
            super.onCreate();
            LogUtil.e(TAG, "Already initialized");
            return;
        }

        finishInit = false;
        appInstance = this;
        super.onCreate();
        SPService.init(this);
        setApplicationLanguage();

        // 是否是DEBUG模式
        ApplicationInfo info = getApplicationInfo();
        DEBUG = (info.flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;

        initialLogger();

        handler = new Handler();

        initEventTracker();

        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    try {
                        // 搜索下内部类
                        ClassUtil.initClasses(LauncherApplication.this, null);
                    } catch (Throwable t) {
                        LogUtil.e(TAG, "加载类失败, " + t.getMessage(), t);
                    }

                    registerTriggerClasses();
                    // 起始时间触发器
                    triggerAtTime(Trigger.TRIGGER_TIME_START);

                    // 初始化基础服务
                    registerServices();

                    // 实际初始化
                    init();

                    triggerAtTime(Trigger.TRIGGER_TIME_START_FINISH);
                    finishInit = true;

                    BackgroundExecutor.execute(new Runnable() {
                        @Override
                        public void run() {
                            initActionResolvers();

                            startHttpServerAtPort(SPService.getInt(SPService.KEY_CONTROL_PORT, 23342));
                            schemeListener = new SchemeHttpListener();
                            registerControlListener(schemeListener);

                            triggerAtTime(Trigger.TRIGGER_TIME_SCHEME_INIT);
                        }
                    }, 5000);
                } catch (Throwable e) {
                    LogUtil.e(TAG, "无法处理", e);
                    // 解决不了
                    throw new RuntimeException(e);
                }
            }
        });

        // 主线程初始化
        initInMain();
    }

    /**
     * 启动http服务
     * @param port
     */
    public void startHttpServerAtPort(int port) {
        List<HttpServer.OnUrlRequestListener> listeners = new ArrayList<>();
        if (totalControlHttpServer != null) {
            // 转移注册
            listeners.addAll(totalControlHttpServer.getAllListeners());
            totalControlHttpServer.removeAllListeners();
            totalControlHttpServer.stop();
            totalControlHttpServer = null;
        }

        totalControlHttpServer = new HttpServer(port);
        try {
            totalControlHttpServer.start();
            totalControlHttpServer.addAllListeners(listeners);
        } catch (IOException e) {
            LogUtil.e(TAG, "Start totalControlHttpServer failed", e);
            showToast("启动HTTP服务失败，当前端口为 " + port +  " ，请确认是否端口冲突");
        }
    }

    /**
     * 注册控制服务监听器
     * @param listener
     */
    public boolean registerControlListener(HttpServer.OnUrlRequestListener listener) {
        if (totalControlHttpServer == null) {
            LogUtil.w(TAG, "Control server is null, can't register");
            return false;
        }

        totalControlHttpServer.addListener(listener);
        return true;
    }

    @Override
    protected void attachBaseContext(Context base) {
        super.attachBaseContext(base);
        MultiDex.install(this);
    }

    /**
     * 在主线程运行
     * @param runnable
     */
    public void runOnUiThread(Runnable runnable) {
        // 如果有主线程在等待，抛给主线程执行
        if (MAIN_THREAD_WAIT) {
            MAIN_THREAD_RUNNABLES.add(runnable);
            return;
        }

        if (Thread.currentThread() != Looper.getMainLooper().getThread()) {
            handler.post(runnable);
        } else {
            runnable.run();
        }
    }

    /**
     * 在主线程运行
     * @param runnable
     */
    public void runOnUiThread(Runnable runnable, long delay) {
        handler.postDelayed(runnable, delay);
    }

    protected abstract void init();

    protected void initInMain() {
    }

    /**
     * 设置应用默认语言
     */
    public void setApplicationLanguage() {
        Locale.setDefault(getLanguageLocale());
        ContextUtil.updateResources(this);
    }

    /**
     * 注册触发器类
     */
    protected synchronized void registerTriggerClasses() {
        if (triggerClasses != null) {
            LogUtil.i(TAG, "Trigger Classes already registered");
            return;
        }
        List<Class<? extends Runnable>> triggerClasses = ClassUtil.findSubClass(Runnable.class, Trigger.class);
        Map<String, SortedList<Class<? extends Runnable>>> triggerMap = new HashMap<>();
        for (Class<? extends Runnable> triggerClz: triggerClasses) {
            Trigger trigger = triggerClz.getAnnotation(Trigger.class);
            if (trigger == null) {
                LogUtil.e(TAG, "Trigger class %s has no trigger annotation", triggerClz);
                continue;
            }

            String[] values = trigger.value();
            if (values == null || values.length == 0) {
                LogUtil.e(TAG, "Trigger class %s has no related time", triggerClz);
                continue;
            }

            // 批量注册
            for (String value: values) {
                if (StringUtil.isEmpty(value)) {
                    LogUtil.w(TAG, "Invalid trigger time for class " + triggerClz);
                    continue;
                }
                if (!triggerMap.containsKey(value)) {
                    triggerMap.put(value, new SortedList<Class<? extends Runnable>>(true));
                }

                triggerMap.get(value).add(triggerClz, trigger.level());
            }
        }

        this.triggerClasses = triggerMap;
    }

    /**
     * 触发特定环节触发器
     * @param trigger
     */
    public void triggerAtTime(final String trigger) {
        if (triggerClasses.containsKey(trigger)) {
            LogUtil.i(TAG, "Trigger at time: " + trigger);
            final SortedList<Class<? extends Runnable>> clzList = triggerClasses.get(trigger);
            if (clzList == null || clzList.size() == 0) {
                LogUtil.w(TAG, "No trigger registered at time: " + trigger);
                return;
            }

            // 实际触发执行
            triggerThreadPool.execute(new Runnable() {
                @Override
                public void run() {
                    long startTime = System.currentTimeMillis();
                    LogUtil.i(trigger, "Do Trigger at time: " + trigger);

                    for (Class<? extends Runnable> triggerClz: clzList) {
                        LogUtil.i(trigger, "Start trigger for class: " + triggerClz);
                        Runnable r = ClassUtil.constructClass(triggerClz);
                        if (r == null) {
                            LogUtil.e(trigger, "Initialize failed for trigger class: " + triggerClz);
                            return;
                        }

                        // 实际执行
                        try {
                            r.run();
                        } catch (Throwable t) {
                            LogUtil.e(trigger, "Trigger Run failed for class: " + triggerClz);
                        } finally {
                            LogUtil.i(trigger, "Finish trigger for class: " + triggerClz);
                        }
                    }

                    LogUtil.i(trigger, "Finish Trigger at time: " + trigger + ", total spend time: " + (System.currentTimeMillis() - startTime));
                }
            });
        } else {
            LogUtil.w(TAG, "No trigger registered at time: " + trigger);
        }
    }

    /**
     * 注册服务
     */
    protected void registerServices() {
        List<Class<? extends ExportService>> serviceClasses = ClassUtil.findSubClass(ExportService.class, LocalService.class);

        // 实际注册服务
        _registerServices(serviceClasses);
    }

    /**
     * 动态注册Patch服务
     * @param rs
     */
    public void registerPatchServices(PatchLoadResult rs) {
        if (rs == null) {
            return;
        }

        // Patch中查找子类
        List<Class<? extends ExportService>> serviceClasses = ClassUtil.findSubClassInPatch(rs,
                ExportService.class, LocalService.class);

        _registerServices(serviceClasses);
    }

    /**
     * 注册服务
     * @param serviceClasses
     */
    private void _registerServices(List<Class<? extends ExportService>> serviceClasses) {
        if (serviceClasses != null && serviceClasses.size() > 0) {
            for (Class<? extends ExportService> childClass: serviceClasses) {
                LocalService annotation = childClass.getAnnotation(LocalService.class);
                String name = annotation.name();
                if (StringUtil.isEmpty(name)) {
                    name = childClass.getName();
                }

                // 如果有注册过，比较Service的level，确定保留哪一个服务
                if (registeredService.containsKey(name)) {
                    ServiceReference prevService = registeredService.get(name);
                    if (annotation.level() <= prevService.level) {
                        continue;
                    } else {
                        // 清理掉之前注册的服务
                        prevService.onDestroy(this);
                    }
                }

                ServiceReference reference = new ServiceReference(annotation, childClass);
                registeredService.put(name, reference);
            }
        }
    }

    // 主线程借助
    private volatile boolean MAIN_THREAD_WAIT = false;
    private Queue<Runnable> MAIN_THREAD_RUNNABLES = new ConcurrentLinkedQueue<>();

    public void restartAllServices() {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                for (ServiceReference ref: registeredService.values()) {
                    ref.onDestroy(LauncherApplication.this);
                }
            }
        });

    }

    /**
     * 主线程等待
     * @return
     */
    public boolean prepareInMain() {
        while (!finishInit) {
            if (Looper.getMainLooper().getThread() == Thread.currentThread()) {
                MAIN_THREAD_WAIT = true;

                // 主线程执行
                while (!MAIN_THREAD_RUNNABLES.isEmpty()) {
                    Runnable r = MAIN_THREAD_RUNNABLES.poll();
                    if (r != null) {
                        r.run();
                    }
                }
            } else {
                MiscUtil.sleep(50);
            }
        }

        MAIN_THREAD_WAIT = false;
        return true;
    }

    /**
     * 是否初始化完毕
     * @return
     */
    public boolean hasFinishInit() {
        return finishInit;
    }

    /**
     * Context运行状态
     */
    private enum ContextRunningStatus {
        CREATE,
        RESUME,
        PAUSE,
        DESTROY
    }

    /**
     * Context维护
     */
    private static class ContextInstanceWrapper {
        /**
         * 名称
         */
        private String name;
        private WeakReference<Context> currentContext;
        private ContextRunningStatus status;

        public ContextInstanceWrapper(String name, Context currentContext, ContextRunningStatus status) {
            this.name = name;
            this.currentContext = new WeakReference<>(currentContext);
            this.status = status;
        }

        /**
         * 更新Context状态
         *
         * @param status
         */
        public void updateStatus(ContextRunningStatus status) {
            this.status = status;
        }

        /**
         * 生命周期校验
         *
         * @return
         */
        public boolean checkValid() {
            return status != ContextRunningStatus.DESTROY && this.currentContext.get() != null;
        }

        /**
         * 检测是否是目标Context
         *
         * @param context
         * @return
         */
        public boolean isTargetContext(Context context) {
            return context != null && context == this.currentContext.get();
        }

        /**
         * 是否正在运行
         * @return
         */
        public boolean isRunning() {
            return currentContext.get() != null &&
                    (status == ContextRunningStatus.CREATE ||
                            status == ContextRunningStatus.RESUME);
        }
    }

    /**
     * 根据名称获取服务
     * @param name
     * @return
     */
    public <T extends ExportService> T findServiceByName(String name) {
        if (registeredService.containsKey(name)) {
            final ServiceReference reference = registeredService.get(name);
            final T target =  (T) reference.getService();
            if (target instanceof EnhancerInterface) {
                Object realTarget = ((EnhancerInterface) target).getTarget$Enhancer$();
                if (realTarget == null) {
                    final CountDownLatch latch = new CountDownLatch(1);
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            ((EnhancerInterface) target).setTarget$Enhancer$(reference.initClass());
                            latch.countDown();
                        }
                    });

                    // 等待对应service初始化完毕
                    try {
                        latch.await();
                    } catch (InterruptedException e) {
                        LogUtil.e(TAG, "Catch java.lang.InterruptedException: " + e.getMessage(), e);
                    }
                }
            }

            return target;
        }
        return null;
    }

    /**
     * 快捷调用
     * @param target
     * @param <T>
     * @return
     */
    public static <T extends ExportService> T service(Class<T> target) {
        return getInstance().findServiceByName(target.getName());
    }

    /**
     * 根据名称停止服务
     * @param name
     * @return
     */
    public void stopServiceByName(String name) {
        if (registeredService.containsKey(name)) {
            ServiceReference reference = registeredService.get(name);
            reference.onDestroy(getContext());
        }
    }

    protected void initialLogger() {
        // 非调试模式走CSV Log
        if (!DEBUG) {
            File logDir = new File(getContext().getExternalCacheDir(), "logs");
            if (!logDir.exists()) {
                logDir.mkdirs();
            }

            CsvFormatStrategy strategy = CsvFormatStrategy.newBuilder().tag("SoloPi").logStrategy(new DiskLogStrategy(logDir)).build();
            LogUtil.LOG_LEVEL = Logger.INFO;
            Logger.addLogAdapter(new DiskLogAdapter(strategy) {
                @Override
                public boolean isLoggable(int priority, String tag) {
                    if (priority < Logger.INFO) {
                        return false;
                    }

                    return true;
                }
            });
        } else {
            // 调试模式走SimpleFormat
            SimpleFormatStrategy formatStrategy = new SimpleFormatStrategy();
            LogUtil.LOG_LEVEL = Logger.VERBOSE;
//            Logger.printer(new ThreadInfoLoggerPrinter());
            Logger.addLogAdapter(new AndroidLogAdapter(formatStrategy) {
                @Override
                public boolean isLoggable(int priority, String tag) {
                    return true;
                }
            });
        }
    }

    /**
     * 通知Context创建
     * @param context
     */
    public void notifyCreate(Context context) {
        if (context == null) {
            return;
        }

        // 先记录下名称
        String name = context.getClass().getName();
        if (context instanceof Service) {
            // 校验是否已启动，启动就不再添加
            ContextInstanceWrapper wrapper = findTargetContext(openedService, context);
            if (wrapper != null) {
                LogUtil.w(TAG, "Target Service[%s] already created, " +
                        "can't add for a second time", name);
                return;
            }

            // 加Service
            SERVICE_STACK_LOCK.writeLock().lock();
            wrapper = new ContextInstanceWrapper(name, context, ContextRunningStatus.CREATE);
            openedService.push(wrapper);
            SERVICE_STACK_LOCK.writeLock().unlock();
        } else if (context instanceof Activity){
            // 校验是否已启动，已启动就不再添加
            ContextInstanceWrapper wrapper = findTargetContext(openedActivity, context);
            if (wrapper != null) {
                LogUtil.w(TAG, "Target Activity[%s] already created, " +
                        "can't add for a second time", name);
                return;
            }

            // 加Activity
            ACTIVITY_STACK_LOCK.writeLock().lock();
            wrapper = new ContextInstanceWrapper(name, context, ContextRunningStatus.CREATE);
            openedActivity.push(wrapper);
            ACTIVITY_STACK_LOCK.writeLock().unlock();
        } else {
            LogUtil.e(TAG, "Unknown Context %s can't create", name);
        }
    }

    /**
     * 通知Context显示
     * @param context
     */
    public void notifyResume(Context context) {
        if (context == null) {
            return;
        }

        // 先记录下名称
        String name = context.getClass().getName();
        if (context instanceof Activity) {
            ContextInstanceWrapper target = findTargetContext(openedActivity, context);

            // 找到目标Activity
            if (target != null) {
                target.updateStatus(ContextRunningStatus.RESUME);
                LogUtil.i(TAG, "Update activity %s to resume state", name);
            } else {
                // 没找到，添加一个
                ACTIVITY_STACK_LOCK.writeLock().lock();
                openedActivity.push(new ContextInstanceWrapper(name, context, ContextRunningStatus.RESUME));
                ACTIVITY_STACK_LOCK.writeLock().unlock();

                LogUtil.w(TAG, "Activity %s resume without start", name);
            }
        } else {
            LogUtil.e(TAG, "Context %s can't resume", name);
        }
    }

    /**
     * 通知Context暂停
     * @param context
     */
    public void notifyPause(Context context) {
        if (context == null) {
            return;
        }

        // 先记录下名称
        String name = context.getClass().getName();
        if (context instanceof Activity) {
            // 找下目标Context
            ContextInstanceWrapper target = findTargetContext(openedActivity, context);

            // 找到目标Activity
            if (target != null) {
                target.updateStatus(ContextRunningStatus.PAUSE);
                LogUtil.i(TAG, "Update activity %s to pause state", name);
            } else {
                // 没找到，不操作
                LogUtil.w(TAG, "Activity %s pause without start", name);
            }
        } else {
            LogUtil.e(TAG, "Context %s can't resume", name);
        }
    }

    /**
     * 通知context销毁
     * @param context
     */
    public void notifyDestroy(Context context) {
        if (context == null) {
            return;
        }

        // 先记录下名称
        String name = context.getClass().getName();
        if (context instanceof Activity) {
            // 找下目标Context
            ContextInstanceWrapper target = findTargetContext(openedActivity, context);

            // 找到目标Activity
            if (target != null) {
                target.updateStatus(ContextRunningStatus.DESTROY);
                LogUtil.i(TAG, "Update activity %s to destroy state", name);

                // 清理下Activity
                clearDestroyedContext(openedActivity);
            } else {
                // 没找到，不操作
                LogUtil.w(TAG, "Activity %s destroy without start", name);
            }
        } else if (context instanceof Service) {
            // 找下目标Context
            ContextInstanceWrapper target = findTargetContext(openedService, context);

            // 找到目标Activity
            if (target != null) {
                target.updateStatus(ContextRunningStatus.DESTROY);
                LogUtil.i(TAG, "Update activity %s to destroy state", name);

                // 清理下Service
                clearDestroyedContext(openedService);
            } else {
                // 没找到，不操作
                LogUtil.w(TAG, "Activity %s destroy without start", name);
            }
        } else {
            LogUtil.e(TAG, "Context %s can't resume", name);
        }
    }

    /**
     * 加载Scheme解析器
     * @return
     */
    public synchronized void initActionResolvers() {
        if (schemeResolver != null) {
            return;
        }

        List<Class<? extends SchemeActionResolver>> actionResolvers = ClassUtil.findSubClass(SchemeActionResolver.class, SchemeResolver.class);
        if (actionResolvers == null) {
            setSchemeResolver(Collections.<String, SortedList<SchemeActionResolver>>emptyMap());
            return;
        }

        Map<String, SortedList<SchemeActionResolver>> resolvers = new HashMap<>(actionResolvers.size() + 1);
        for (Class<? extends SchemeActionResolver> cls: actionResolvers) {
            SchemeActionResolver resolver = ClassUtil.constructClass(cls);
            if (resolver != null) {
                SchemeResolver annotation = cls.getAnnotation(SchemeResolver.class);
                String name = annotation.value();
                int index = annotation.index();
                SortedList<SchemeActionResolver> sortedList;
                if (resolvers.containsKey(name)) {
                    sortedList = resolvers.get(name);
                } else {
                    sortedList = new SortedList<>(true);
                    resolvers.put(name, sortedList);
                }

                sortedList.add(resolver, index);
            }
        }

        setSchemeResolver(resolvers);

    }

    @Override
    public void onTrimMemory(int level) {
        if (level >= ComponentCallbacks2.TRIM_MEMORY_MODERATE) {
            InjectorService.g().pushMessage(ON_TRIM_MEMORY);
        }
        LogUtil.i("ScreenEventBroadCastReceiver", "Receive memory state " + level);
        super.onTrimMemory(level);
    }

    /**
     * 获取最适合的前台Context
     * @return
     */
    public Context getBestForegroundContext() {
        Context activity = loadActivityOnTop();
        if (activity != null) {
            return activity;
        }
        Context service = loadRunningService();
        if (service != null) {
            return service;
        }
        return this;
    }

    /**
     * 获取当前屏幕显示的Activity
     * @return
     */
    public Context loadActivityOnTop() {
        // 找Activity
        ACTIVITY_STACK_LOCK.readLock().lock();
        for (ContextInstanceWrapper wrapper : openedActivity) {
            if (wrapper.isRunning()) {
                ACTIVITY_STACK_LOCK.readLock().unlock();
                return wrapper.currentContext.get();
            }
        }

        ACTIVITY_STACK_LOCK.readLock().unlock();
        // 没找到，返回空
        return null;
    }

    /**
     * 获取当前屏幕显示的Service
     * @return
     */
    public Context loadRunningService() {
        // 找Service
        SERVICE_STACK_LOCK.readLock().lock();
        for (ContextInstanceWrapper wrapper : openedService) {
            if (wrapper.isRunning()) {
                SERVICE_STACK_LOCK.readLock().unlock();
                return wrapper.currentContext.get();
            }
        }

        SERVICE_STACK_LOCK.readLock().unlock();
        // 没找到，返回空
        return null;
    }

    // Activity栈读写锁
    private final ReentrantReadWriteLock ACTIVITY_STACK_LOCK = new ReentrantReadWriteLock();

    // Service栈读写锁
    private final ReentrantReadWriteLock SERVICE_STACK_LOCK = new ReentrantReadWriteLock();

    /**
     * 查找目标Context
     *
     * @param stack
     * @param context
     * @return
     */
    private ContextInstanceWrapper findTargetContext(Stack<ContextInstanceWrapper> stack, Context context) {
        if (stack == null || context == null) {
            LogUtil.w(TAG, "无意义查找");
            return null;
        }

        ReentrantReadWriteLock.ReadLock readLock = null;

        // 查找对应锁
        if (stack == openedActivity) {
            readLock = ACTIVITY_STACK_LOCK.readLock();
        } else if (stack == openedService) {
            // 不修改，加读锁
            readLock = SERVICE_STACK_LOCK.readLock();
        }

        if (readLock != null) {
            readLock.lock();
        }
        for (ContextInstanceWrapper target : stack) {
            if (target.isTargetContext(context)) {
                if (readLock != null) {
                    readLock.unlock();
                }
                return target;
            }
        }

        if (readLock != null) {
            readLock.unlock();
        }
        return null;
    }

    /**
     * 清理无用Context
     * @param stack
     */
    public void clearDestroyedContext(Stack<ContextInstanceWrapper> stack) {
       ReentrantReadWriteLock.WriteLock writeLock = null;

        // 查找对应锁
        if (stack == openedActivity) {
            writeLock = ACTIVITY_STACK_LOCK.writeLock();
        } else if (stack == openedService) {
            // 不修改，加读锁
            writeLock = SERVICE_STACK_LOCK.writeLock();
        }

        if (writeLock != null) {
            writeLock.lock();
        }
        // 清理掉Destroy的Context
        Iterator<ContextInstanceWrapper> iterator = stack.iterator();
        while (iterator.hasNext()) {
            ContextInstanceWrapper item = iterator.next();
            if (!item.checkValid()) {
                iterator.remove();
            }
        }

        if (writeLock != null) {
            writeLock.unlock();
        }
    }

    private boolean isDialogShow = false;

    private Runnable positiveRunnable = null;

    private Runnable negativeRunnable = null;

    private DialogInterface.OnClickListener listener = new DialogInterface.OnClickListener() {
        @Override
        public void onClick(DialogInterface dialog, int which) {
            if (which == BUTTON_POSITIVE) {
                if (positiveRunnable != null) {
                    positiveRunnable.run();
                }
            } else if (which == BUTTON_NEGATIVE){
                if (negativeRunnable != null) {
                    negativeRunnable.run();
                }
            }

            dialog.dismiss();
        }
    };

    /**
     * 展示提示框
     * @param message
     * @param positiveText
     * @param positiveRunnable
     */
    public void showDialog(Context context, final String message, final String positiveText,
                           final Runnable positiveRunnable) {
        showDialog(context, message, positiveText, positiveRunnable, null, null);
    }

    public static void toast(final String message) {
        LauncherApplication.getInstance().showToast(message);
    }

    public static void toast(@StringRes final int message) {
        toast(LauncherApplication.getContext().getString(message));
    }

    public static void toast(@StringRes final int message, Object... args) {
        toast(LauncherApplication.getContext().getString(message, args));
    }

    /**
     * 显示toast
     * @param context
     * @param message
     */
    public void showToast(final Context context, final String message) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(context, message, Toast.LENGTH_SHORT).show();
            }
        });
    }

    private static int WINDOW_TYPE = WindowManager.LayoutParams.TYPE_SYSTEM_ALERT;

    /**
     * 显示Toast
     * @param message
     */
    public void showToast(String message) {
        showToast(getContext(), message);
    }

    /**
     * 显示Toast
     * @param res 文字资源
     */
    public void showToast(int res, Object... args) {
        showToast(getContext(), getContext().getString(res, args));
    }

    /**
     * 展示加载框
     *
     * @param message
     */
    public void showDialog(final Context context, final String message, final String positiveText,
                           final Runnable positiveRunnable, final String negativeText,
                           final Runnable negativeRunnable) {
        this.positiveRunnable = positiveRunnable;
        this.negativeRunnable = negativeRunnable;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                AlertDialog.Builder builder = new AlertDialog.Builder(context, R.style.PermissionAppDialogTheme)
                        .setMessage(message)
                        .setPositiveButton(positiveText, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                if (positiveRunnable != null) {
                                    positiveRunnable.run();
                                }
                                dialog.dismiss();
                            }
                });
                if (!StringUtil.isEmpty(negativeText)) {
                    builder.setNegativeButton(negativeText, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            if (negativeRunnable != null) {
                                negativeRunnable.run();
                            }
                            dialog.dismiss();
                        }
                    });
                }
                AlertDialog dialog = builder.create();
                dialog.getWindow().setType(com.alipay.hulu.common.constant.Constant.TYPE_ALERT);
                dialog.setCanceledOnTouchOutside(false);                                   //点击外面区域不会让dialog消失
                dialog.setCancelable(false);

                try {
                    dialog.show();
                } catch (WindowManager.BadTokenException e) {
                    LogUtil.e(TAG, "Unable to show with TYPE_SYSTEM_ALERT", e);
                    WINDOW_TYPE = WindowManager.LayoutParams.TYPE_APPLICATION_ATTACHED_DIALOG;
                }
            }
        });
    }

    /**
     *
     * @return
     */
    public Locale getLanguageLocale() {
        switch (SPService.getInt(SPService.KEY_USE_LANGUAGE, 0)) {
            case 1:
                return Locale.CHINA;
            case 2:
                return Locale.US;
            default:
                return DEFAULT_LOCALE;
        }
    }

    /**
     * 获取系统的locale
     *
     * @return Locale对象
     */
    private Locale getSystemLocale() {
        Locale locale;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            locale = LocaleList.getDefault().get(0);
        } else {
            locale = Locale.getDefault();
        }
        return locale;
    }

    /**
     * 返回SoloPi
     */
    public void moveSelfToFront() {
        int contextFrom = 0;

        // 一级一级加载Context
        Context context = loadActivityOnTop();
        if (context == null) {
            context = loadRunningService();
            contextFrom = 1;
        }
        if (context == null) {
            context = getApplicationContext();
            contextFrom = 2;
        }

        if (contextFrom != 0) {
            //获取ActivityManager
            ActivityManager mAm = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
            //获得当前运行的task
            List<ActivityManager.RunningTaskInfo> taskList = mAm.getRunningTasks(100);
            for (ActivityManager.RunningTaskInfo rti : taskList) {
                //找到当前应用的task，并启动task的栈顶activity，达到程序切换到前台
                if (rti.topActivity.getPackageName().equals(getPackageName())) {
                    mAm.moveTaskToFront(rti.id, 0);
                    return;
                }
            }

            // pending intent跳回去
            Intent intent = getPackageManager().getLaunchIntentForPackage(getPackageName());
            PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT);
            try {
                pendingIntent.send();
            } catch (PendingIntent.CanceledException e) {
                LogUtil.e(TAG, "Catch android.app.PendingIntent.CanceledException: " + e.getMessage(), e);
            }
        }
    }

    /**
     * 是否在顶层运行
     * @param context
     * @return
     */
    public boolean isRunningForeground(Context context) {
        return loadActivityOnTop() != null;
    }

    public Map<String, SortedList<SchemeActionResolver>> getSchemeResolver() {
        return schemeResolver;
    }

    private void setSchemeResolver(Map<String, SortedList<SchemeActionResolver>> schemeResolver) {
        LogUtil.i(TAG, "配置Scheme处理器，数量: " + (schemeResolver == null? 0: schemeResolver.size()));
        this.schemeResolver = schemeResolver;
    }

    private void initEventTracker() {
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_ON);
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_USER_PRESENT);
        registerReceiver(new ScreenEventBroadCastReceiver(this), filter);
    }

    private void triggerServiceEvent(AppGuardian.ReceiveSystemEvent event) {
        if (!finishInit) {
            return;
        }
        for (ServiceReference service: registeredService.values()) {
            service.onSystemEventTriggered(event);
        }
        InjectorService.g().pushMessage(SYSTEM_GUARDIAN_EVENT, event);
    }

    /**
     * 服务引用
     */
    private static class ServiceReference {
        private Class<? extends ExportService> targetClass;
        private ExportService target;
        private boolean isAppGuardianEnable = false;
        private int level;
        private volatile boolean isInitialized = false;

        public ServiceReference(LocalService annotation, Class<? extends ExportService> targetClass) {
            this.targetClass = targetClass;
            this.level = annotation.level();
            AppGuardian.AppGuardianEnable guardianEnable = targetClass.getAnnotation(AppGuardian.AppGuardianEnable.class);
            if (guardianEnable != null && guardianEnable.value() && AppGuardian.class.isAssignableFrom(targetClass)) {
                this.isAppGuardianEnable = true;
            }
            initializedService(targetClass, annotation.lazy());
        }

        /**
         * 获取服务
         * @return
         */
        private synchronized ExportService getService() {
            return target;
        }

        /**
         * 初始化服务
         * @param target
         */
        private void initializedService(Class<? extends ExportService> target, boolean lazy) {
            if (ExportService.class.isAssignableFrom(target)) {
                Enhancer enhancer = new Enhancer(getContext());
                enhancer.setSuperclass(target);
                enhancer.setCallback(new MethodInterceptor() {
                    @Override
                    public Object intercept(Object object, Object[] args, MethodProxy methodProxy) throws Exception {
//                        LogUtil.d(TAG, "当前类型：%s", object.getClass());
                        final EnhancerInterface enhancerInterface = (EnhancerInterface) object;

//                        LogUtil.d(TAG, "convert类型：%s", object.getClass());
                        ExportService target = (ExportService) enhancerInterface.getTarget$Enhancer$();
//                        LogUtil.d(TAG, "target类型:%s", target);
                        if (target == null) {
                            final AtomicBoolean runningFLag = new AtomicBoolean(true);

                            // 在主线程运行
                            getInstance().runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    enhancerInterface.setTarget$Enhancer$(initClass());
                                    isInitialized = true;
                                    runningFLag.set(false);
                                }
                            });

                            long startTime = System.currentTimeMillis();
                            // 等待加载完毕，最长3s
                            while (System.currentTimeMillis() - startTime < 3000) {
                                if (!runningFLag.get()) {
                                    break;
                                }
                                try {
                                    Thread.sleep(2);
                                } catch (InterruptedException e) {
                                    LogUtil.e(TAG, "Catch java.lang.InterruptedException: " + e.getMessage(), e);
                                }
                            }

                            target = (ExportService) enhancerInterface.getTarget$Enhancer$();
                        }
                        return methodProxy.invokeSuper(target, args);
                    }
                });
                final EnhancerInterface result = (EnhancerInterface) enhancer.create();

                // 非lazy模式
                if (!lazy) {
                    getInstance().runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            ExportService service = initClass();
                            isInitialized = true;
                            result.setTarget$Enhancer$(service);
                        }
                    });
                }

                this.target = (ExportService) result;
            }
        }

        /**
         * 构造
         * @return
         */
        private ExportService initClass() {
            ExportService target = ClassUtil.constructClass(targetClass);
            if (target == null) {
                LogUtil.e(TAG, "初始化类失败，className=%s", targetClass);
                return null;
            }

            target.onCreate(getContext());
            return target;
        }

        private synchronized void onSystemEventTriggered(AppGuardian.ReceiveSystemEvent event) {
            if (this.isAppGuardianEnable && this.isInitialized) {
                ((AppGuardian) this.target).onEventTrigger(event);
            }
        }

        /**
         * 调用清理
         * @param context
         */
        private void onDestroy(final Context context) {
            EnhancerInterface target = (EnhancerInterface) this.target;
            final ExportService service = (ExportService) target.getTarget$Enhancer$();
            if (service != null) {
                isInitialized = false;
                getInstance().runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        service.onDestroy(context);
                    }
                });
                // 设置为空
                target.setTarget$Enhancer$(null);
            }
        }
    }

    private static class ScreenEventBroadCastReceiver extends BroadcastReceiver {
        private static final String TAG = ScreenEventBroadCastReceiver.class.getSimpleName();
        private LauncherApplication app;
        private ScreenEventBroadCastReceiver(LauncherApplication app) {
            this.app = app;
        }

        @Override
        public void onReceive(Context context, Intent intent) {
            LogUtil.i(TAG, "Receive broadcast event" + intent.getAction());
            switch (intent.getAction()) {
                case Intent.ACTION_SCREEN_OFF:
                    app.triggerServiceEvent(AppGuardian.ReceiveSystemEvent.SCREEN_LOCK);
                    break;
                case Intent.ACTION_USER_PRESENT:
                    app.triggerServiceEvent(AppGuardian.ReceiveSystemEvent.SCREEN_UNLOCK);
                    break;
            }
        }
    }
}
