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
package com.alipay.hulu.common.tools;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Looper;
import android.support.annotation.IntRange;
import android.util.Base64;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.bean.ProcessInfo;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.RunningThread;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.android.permission.rom.RomUtils;
import com.cgutman.adblib.AdbBase64;
import com.cgutman.adblib.AdbConnection;
import com.cgutman.adblib.AdbCrypto;
import com.cgutman.adblib.AdbStream;

import java.io.BufferedReader;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.Socket;
import java.security.NoSuchAlgorithmException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Queue;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * 命令行操作集合
 */
public class CmdTools {
    private static String TAG = "CmdTools";

    private static final int MODE_APPEND = 0;

    public static final String FATAL_ADB_CANNOT_RECOVER = "fatalAdbNotRecover";

    public static final String ERROR_NO_CONNECTION = "HULU_ERROR_NO_CONNECTION";
    public static final String ERROR_CONNECTION_ILLEGAL_STATE = "HULU_ERROR_CONNECTION_ILLEGAL_STATE";
    public static final String ERROR_CONNECTION_COMMON_EXCEPTION = "HULU_ERROR_CONNECTION_COMMON_EXCEPTION";

    private static final SimpleDateFormat LOG_FILE_FORMAT = new SimpleDateFormat("yyyy_MM_dd_HH_mm_ss", Locale.CHINA);

    private static ScheduledExecutorService mOppoKeepAliveExecutor;

    private static ExecutorService cachedExecutor = Executors.newCachedThreadPool();

    private static volatile AdbConnection connection;

    private static Boolean isRoot = null;

    private static List<Process> processes = new ArrayList<>();

    private static List<AdbStream> streams = new ArrayList<>();

    private static PidWatcher watcher;

    private static File currentLogFile;

    private static ConcurrentLinkedQueue<String> logs = null;

    public static void forceAdb(){
        isRoot = false;
    }

    public static void cancelForceAdb(){
        isRoot = null;
    }

    public static long LAST_ADB_RETRY_TIME = 0;

    /**
     * 开始adb日志记录
     */
    public static void startAppLog() {
        InjectorService service = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
        if (watcher != null) {
            LogUtil.w(TAG, "无法同时监控两个应用");
            service.unregister(watcher);
            watcher.stop();
        }

        // 确定监控文件
        currentLogFile = new File(FileUtils.getSubDir("logcat").getAbsolutePath(), LOG_FILE_FORMAT.format(new Date()) + ".log");
        // 开始监控
        CmdLine cmdLine = openCmdLine();
        cmdLine.writeCommand("logcat *:S");
        MiscUtil.sleep(500);

        // 注册下pid监听器
        watcher = new PidWatcher(cmdLine);
        service.register(watcher);
    }

    /**
     * 结束并获取adb日志记录
     * @return
     */
    public static File stopAppLog() {
        InjectorService service = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
        if (watcher != null) {
            service.unregister(watcher);
            watcher.stop();
            watcher = null;
            File targetFile = currentLogFile;
            currentLogFile = null;
            return targetFile;
        }

        return null;
    }

    /**
     * pid监控器
     */
    static final class PidWatcher {
        private Set<Integer> pids = null;
        private final CmdLine cmdLine;

        private PidWatcher(CmdLine cmdLine) {
            this.cmdLine = cmdLine;
        }

        @Subscriber(value = @Param(SubscribeParamEnum.PID_CHILDREN), thread = RunningThread.BACKGROUND)
        public void setPid(List<ProcessInfo> processes) {
            if (processes == null || processes.size() == 0) {
                return;
            }

            LogUtil.d(TAG, "收到pid信息：%s", processes);
            // 查找主进程
            Set<Integer> processPids = new HashSet<>();
            for (ProcessInfo process: processes) {
                processPids.add(process.getPid());
            }

            // 完全一致
            if (pids != null && pids.containsAll(processPids) && pids.size() == processPids.size()) {
                return;
            }

            pids = processPids;

            StringBuilder sb = new StringBuilder();
            List<Integer> array = new ArrayList<>(pids);
            int i;
            for (i = 0; i < processPids.size() - 1; i++) {
                sb.append(array.get(i)).append("|");
            }
            sb.append(array.get(i));

            // 先中断之前的，再重新录制
            // 发送Ctrl + \
            cmdLine.writeBytes(new byte[]{ (char)28 });
            MiscUtil.sleep(500);

            String filePath = FileUtils.getPathInShell(currentLogFile);
            String cmd = "logcat -v long *:I | sed -r '/\\[.*(" + sb.toString() + "):.*\\]/,/^$/!d' >> " + filePath;

            LogUtil.d(TAG, "Track logs with cmd: %s", cmd);
            cmdLine.writeBytes(cmd.getBytes());
            MiscUtil.sleep(500);
            cmdLine.writeBytes(new byte[]{ '\n' });
            MiscUtil.sleep(500);
        }

        /**
         * 关闭
         */
        public void stop() {
            LogUtil.i(TAG, "停止监控日志信息");
            try {
                cmdLine.writeBytes(new byte[]{(char) 28});
                MiscUtil.sleep(500);
                cmdLine.close();
            } catch (IOException e) {
                LogUtil.e(TAG, "Catch java.io.IOException: " + e.getMessage(), e);
            }
        }
    }

    /**
     * root超时限制
     */
    private static ThreadPoolExecutor processReadExecutor = new ThreadPoolExecutor(5, 5, 0, TimeUnit.MILLISECONDS, new LinkedBlockingQueue<Runnable>(10));

    private static SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.CHINA);

    protected static void logcatCmd(String cmd){
        LogUtil.i("ADB CMD", cmd);
    }

    /**
     * 判断当前手机是否有ROOT权限
     * @returnz
     */
    public static boolean isRooted(){
        boolean bool = false;

        // 避免重复查找文件
        if (isRoot != null) {
            return isRoot;
        }
        try{
            if (new File("/system/bin/su").exists()){
                bool = true;
            } else if (new File("/system/xbin/su").exists()) {
                bool = true;
            } else if (new File("/su/bin/su").exists()) {
                bool = true;
            }
            LogUtil.d(TAG, "isRooted = " + bool);

        } catch (Exception e) {
            LogUtil.e(TAG, "THrow exception: " + e.getMessage(), e);
        }
        return bool;
    }

    /**
     * 是否已初始化
     * @return
     */
    public static boolean isInitialized() {
        return connection != null;
    }

    public static Process getRootCmd(){
        try{
            return Runtime.getRuntime().exec("su");
        } catch (IOException e) {
            LogUtil.e(TAG, "get root shell failed", e);
            isRoot = false;
        }
        return null;
    }

    /**
     * 快捷执行ps指令
     * @param filter grep 过滤条件
     * @return 分行结果
     */
    public static String[] ps(String filter) {
        if (!RomUtils.isOppoSystem() && Build.VERSION.SDK_INT <= Build.VERSION_CODES.M) {
            try {
                Process p;
                if (filter != null && filter.length() > 0) {
                    p = Runtime.getRuntime().exec(new String[]{"sh", "-c", "ps | grep \"" + filter + "\""});
                } else {
                    p = Runtime.getRuntime().exec(new String[]{"sh", "-c", "ps"});
                }
                BufferedReader br = new BufferedReader(new InputStreamReader(p.getInputStream()));
                String line;
                List<String> results = new ArrayList<>();
                while ((line = br.readLine()) != null) {
//            		LogUtil.d(TAG, "ERR************" + line);
                    results.add(line);
                }
                return results.toArray(new String[results.size()]);
            } catch (IOException e) {
                LogUtil.e(TAG, "Read ps content failed", e);
                return new String[0];
            }
        } else if (Build.VERSION.SDK_INT <= 25) {

            // Android 7.0, 7.1无法通过应用权限获取所有进程
            if (isRooted()) {
                if (filter != null && filter.length() > 0) {
                    return execRootCmd("ps | grep \"" + filter + "\"", null, true, null).toString().split("\n");
                } else {
                    return execRootCmd("ps", null, true, null).toString().split("\n");
                }
            } else {
                if (filter != null && filter.length() > 0) {

                    // 存在ps命令调用超时情况
                    return execAdbCmd("ps | grep \"" + filter + "\"", 2500).split("\n");
                } else {
                    return execAdbCmd("ps", 2500).split("\n");
                }
            }
        } else {
            // Android O ps为toybox实现，功能与标准ps命令基本相同，需要-A参数获取全部进程
            if (isRooted()) {
                if (filter != null && filter.length() > 0) {
                    return execRootCmd("ps -A | grep \"" + filter + "\"", null, true, null).toString().split("\n");
                } else {
                    return execRootCmd("ps -A", null, true, null).toString().split("\n");
                }
            } else {
                if (filter != null && filter.length() > 0) {

                    // 存在ps命令调用超时情况
                    return execAdbCmd("ps -A | grep \"" + filter + "\"", 2500).split("\n");
                } else {
                    return execAdbCmd("ps -A", 2500).split("\n");
                }
            }
        }
    }

    public static AdbBase64 getBase64Impl() {
        return new AdbBase64() {
            @Override
            public String encodeToString(byte[] arg0) {
                return Base64.encodeToString(arg0, 2);
            }
        };
    }

    /**
     * 运行高权限命令
     * @param cmd
     * @return
     */
    public static String execHighPrivilegeCmd(String cmd) {
        if (isRooted()) {
            return execRootCmd(cmd, null, true, null).toString();
        }
        return execAdbCmd(cmd, 0);
    }

    /**
     * 带超时的高权限命令执行
     * @param cmd shell命令（shell之后的部分）
     * @param maxTime 最长执行时间
     * @return 执行结果
     */
    public static String execHighPrivilegeCmd(final String cmd, int maxTime) {
        if (isRooted()) {
            return execRootCmd(cmd, maxTime).toString();
        }
        return execAdbCmd(cmd, maxTime);
    }

    public static String execAdbExtCmd(final  String cmd, final  int wait) {
        if (connection == null) {
            LogUtil.e(TAG, "no connection");
            return "";
        }

        try {
            AdbStream stream = connection.open(cmd);
            logcatCmd(stream.getLocalId() + "@" + cmd);
            streams.add(stream);

            // 当wait为0，每个10ms观察一次stream状况，直到shutdown
            if (wait == 0) {
                while (!stream.isClosed()) {
                    Thread.sleep(10);
                }
            } else {
                // 等待wait毫秒后强制退出
                Thread.sleep(wait);
                stream.close();
            }

            // 获取stream所有输出
            InputStream adbInputStream = stream.getInputStream();
            StringBuilder sb = new StringBuilder();
            byte[] buffer = new byte[128];
            int readCount = -1;
            while ((readCount = adbInputStream.read(buffer, 0, 128)) > -1) {
                sb.append(new String(buffer, 0, readCount));
            }

            streams.remove(stream);
            return sb.toString();
        } catch (IllegalStateException e) {
            LogUtil.e(TAG
                    , "IllegalState, " + e.getMessage(), e);

            if (connection != null) {
                connection.setFine(false);
            }
            boolean result = generateConnection();
            if (result) {
                return retryExecAdb(cmd, wait);
            } else {
                LogUtil.e(TAG, "regenerateConnection failed");
                return "";
            }
        } catch (Exception e){
            LogUtil.e(TAG, "Throw Exception: " + e.getMessage(), e);
            return "";
        }
    }

    /**
     * 执行Adb命令，对外<br/>
     * <b>注意：主线程执行的话超时时间会强制设置为5S以内，防止ANR</b>
     * @param cmd 对应命令
     * @param wait 等待执行时间，0表示一直等待
     * @return 命令行输出
     */
    public static String execAdbCmd(final String cmd, int wait) {
        // 主线程的话走Callable
        if (Looper.myLooper() == Looper.getMainLooper()) {
            if (wait > 5000 || wait == 0) {
                LogUtil.w(TAG, "主线程配置的等待时间[%dms]过长，修改为5000ms", wait);
                wait = 5000;
            }

            final int finalWait = wait;
            Callable<String> callable = new Callable<String>() {
                @Override
                public String call() {
                    return _execAdbCmd(cmd, finalWait);
                }
            };
            Future<String> result = cachedExecutor.submit(callable);

            // 等待执行完毕
            try {
                return result.get();
            } catch (InterruptedException e) {
                LogUtil.e(TAG, "Catch java.lang.InterruptedException: " + e.getMessage(), e);
            } catch (ExecutionException e) {
                LogUtil.e(TAG, "Catch java.util.concurrent.ExecutionException: " + e.getMessage(), e);
            }
            return null;
        }
        return _execAdbCmd(cmd, wait);
    }

    /**
     * 执行Adb命令
     * @param cmd 对应命令
     * @param wait 等待执行时间，0表示一直等待
     * @return 命令行输出
     */
    public static String _execAdbCmd(final String cmd, final int wait) {
        if (connection == null) {
            LogUtil.e(TAG, "no connection when execAdbCmd");
            return "";
        }

        try {
            AdbStream stream = connection.open("shell:" + cmd);
            logcatCmd(stream.getLocalId() + "@" + "shell:" + cmd);
            streams.add(stream);

            // 当wait为0，每个10ms观察一次stream状况，直到shutdown
            if (wait == 0) {
                while (!stream.isClosed()) {
                    Thread.sleep(10);
                }
            } else {
                // 等待最长wait毫秒后强制退出
                long start = System.currentTimeMillis();
                while (!stream.isClosed() && System.currentTimeMillis() - start < wait) {
                    Thread.sleep(10);
                }

                if (!stream.isClosed()) {
                    stream.close();
                }
            }

            // 获取stream所有输出
            Queue<byte[]> results = stream.getReadQueue();
            StringBuilder sb = new StringBuilder();
            for (byte[] bytes: results) {
                if (bytes != null) {
                    sb.append(new String(bytes));
                }
            }
            streams.remove(stream);
            return sb.toString();
        } catch (IllegalStateException e) {
            LogUtil.e(TAG, "Throw IllegalStateException: " + e.getMessage(), e);

            LogUtil.e(TAG, "illegal", e);

            if (connection != null) {
                connection.setFine(false);
            }
            boolean result = generateConnection();
            if (result) {
                return retryExecAdb(cmd, wait);
            } else {
                LogUtil.e(TAG, "regenerateConnection failed");
                return "";
            }
        } catch (Exception e){
            LogUtil.e(TAG, "Throw Exception: " + e.getMessage()
                    , e);
            return "";
        }
    }

    /**
     * 打开ADB Stream
     * @return
     */
    public static CmdLine openAdbStream(String cmd) {
        if (connection == null) {
            LogUtil.e(TAG, "no connection in ocmd line");
            return null;
        }
        try {
            AdbStream stream = connection.open(cmd);
            logcatCmd(stream.getLocalId() + "@" + cmd);
            streams.add(stream);
            CmdLine cmdLine = new CmdLine(stream);

            // 记录tag
            cmdLine.cmdTag = stream.getLocalId() + "@" + cmd.split(":")[0] + ":";
            return cmdLine;
        } catch (Exception e) {
            LogUtil.e(TAG, "抛出异常 " + e.getMessage(), e);
            return null;
        }
    }


    /**
     * 执行adb命令，在超时时间范围内
     * @deprecated Use {@link #execHighPrivilegeCmd(String, int)}
     * @param cmd
     * @param timeout 超时时间（必大于0）
     * @return
     */
    public static String execShellCmdWithTimeout(final String cmd, @IntRange(from = 1) final long timeout) {
        if (connection == null) {
            LogUtil.i(TAG, "connection is null");
            return "";
        }

        try {
            long startTime = System.currentTimeMillis();
            AdbStream stream = connection.open("shell:" + cmd);
            logcatCmd(stream.getLocalId() + "@shell:" + cmd);
            streams.add(stream);

            while (!stream.isClosed() && System.currentTimeMillis() - startTime < timeout) {
                Thread.sleep(10);
            }

            if (!stream.isClosed()) {
                stream.close();
            }

            // 获取stream所有输出
            Queue<byte[]> results = stream.getReadQueue();
            StringBuilder sb = new StringBuilder();
            for (byte[] bytes: results) {
                if (bytes != null) {
                    sb.append(new String(bytes));
                }
            }
            streams.remove(stream);
            return sb.toString();
        } catch (IllegalStateException e) {

            LogUtil.t(TAG, "IllegalState?? " + e.getMessage(), e);
            if (connection != null) {
                connection.setFine(false);
            }
            boolean result = generateConnection();
            if (result) {
                return retryExecAdb(cmd, timeout);
            } else {
                return "";
            }
        } catch (Exception e){
            LogUtil.e(TAG, "抛出异常 " + e.getMessage(), e);
            LogUtil.e(TAG, "execShellCmdWithTimeout exception:" + e.getMessage());
            return "";
        }
    }


    private static String retryExecAdb(String cmd, long wait) {
        AdbStream stream = null;
        try {
            stream = connection.open("shell:" + cmd);
            logcatCmd(stream.getLocalId() + "@shell:" + cmd);
            streams.add(stream);

            // 当wait为0，每个10ms观察一次stream状况，直到shutdown
            if (wait == 0) {
                while (!stream.isClosed()) {
                    Thread.sleep(10);
                }
            } else {
                // 等待wait毫秒后强制退出
                long start = System.currentTimeMillis();
                while (!stream.isClosed() && System.currentTimeMillis() - start < wait) {
                    Thread.sleep(10);
                }
                if (!stream.isClosed()) {
                    stream.close();
                }
            }

            // 获取stream所有输出
            Queue<byte[]> results = stream.getReadQueue();
            StringBuilder sb = new StringBuilder();
            for (byte[] bytes: results) {
                if (bytes != null) {
                    sb.append(new String(bytes));
                }
            }
            streams.remove(stream);
            return sb.toString();
        } catch (IOException e) {
            LogUtil.e(TAG, "抛出异常 " + e.getMessage(), e);
        } catch (InterruptedException e) {
            LogUtil.e(TAG, "抛出异常 " + e.getMessage(), e);
        }

        return "";
    }


    private static String execAdbCmdWithStatus(final String cmd, final int wait) {
        if (connection == null) {
            return ERROR_NO_CONNECTION;
        }

        try {
            AdbStream stream = connection.open("shell:" + cmd);
            logcatCmd(stream.getLocalId() + "@shell:" + cmd);
            streams.add(stream);

            // 当wait为0，每个10ms观察一次stream状况，直到shutdown
            if (wait == 0) {
                while (!stream.isClosed()) {
                    Thread.sleep(10);
                }
            } else {
                // 等待wait毫秒后强制退出
                long start = System.currentTimeMillis();
                while (!stream.isClosed() && System.currentTimeMillis() - start < wait) {
                    Thread.sleep(10);
                }

                if (!stream.isClosed()) {
                    stream.close();
                }

            }

            // 获取stream所有输出
            Queue<byte[]> results = stream.getReadQueue();
            StringBuilder sb = new StringBuilder();
            for (byte[] bytes: results) {
                if (bytes != null) {
                    sb.append(new String(bytes));
                }
            }
            streams.remove(stream);
            return sb.toString();
        } catch (IllegalStateException e) {
            return ERROR_CONNECTION_ILLEGAL_STATE;
        } catch (Exception e){
            return ERROR_CONNECTION_COMMON_EXCEPTION;
        }
    }

    private static String execSafeCmd(String cmd, int retryCount) {
        String result = "";
        while (retryCount-- > 0) {
            result = execAdbCmdWithStatus(cmd, 0);
            LogUtil.w("yuawen", "execSafeCmd result: " + result);
            if (ERROR_NO_CONNECTION.equals(result) || ERROR_CONNECTION_ILLEGAL_STATE.equals(result)) {
                generateConnection();
                MiscUtil.sleep(2000);
            } else if (ERROR_CONNECTION_COMMON_EXCEPTION.equals("result")) {
                MiscUtil.sleep(2000);
            } else {
                break;
            }
        }
        return result;
    }

    /**
     * 打开命令行
     * @return
     */
    public static CmdLine openCmdLine() {
        if (isRooted()) {
            try {
                Process process = Runtime.getRuntime().exec("su");
                processes.add(process);
                CmdLine cmdLine = new CmdLine(process);
                cmdLine.cmdTag = "su:";
                return cmdLine;
            } catch (IOException e) {
                LogUtil.e(TAG, "抛出异常 " + e.getMessage(), e);
                return null;
            }
        } else {
            if (connection == null || !connection.isFine()) {
                LogUtil.e(TAG, "no connection in ocmd line");
                return null;
            }
            try {
                AdbStream stream = connection.open("shell:");
                logcatCmd(stream.getLocalId() + "@shell:");
                streams.add(stream);
                CmdLine cmdline = new CmdLine(stream);
                cmdline.cmdTag = stream.getLocalId() + "@shell:";
                return cmdline;
            } catch (Exception e) {
                LogUtil.e(TAG, "抛出异常 " + e.getMessage(), e);
                return null;
            }
        }
    }

    public static void clearProcesses() {
        try {
            for (Process p : processes) {
                LogUtil.i(TAG, "stop process: " + p.toString());
                p.destroy();
            }
            processes.clear();
            for (AdbStream stream : streams) {
                LogUtil.i(TAG, "stop stream: " + stream.toString());
                try {
                    stream.close();
                } catch (Exception e) {
                    LogUtil.e(TAG, "Stop stream " + stream.toString() + " failed", e);
                }
            }
            streams.clear();
        } catch (Exception e) {
            LogUtil.e(TAG, "抛出异常 " + e.getMessage(), e);
        }
    }


    private static volatile long LAST_RUNNING_TIME = 0;
    /**
     * 生成Adb连接，由所在文件生成，或创建并保存到相应文件
     */
    public static synchronized boolean generateConnection() {

        if (connection != null && connection.isFine()) {
            return true;
        }

        if (connection != null) {
            try {
                connection.close();
            } catch (IOException e1) {
                LogUtil.e(TAG, "Throw IOException: " + e1.getMessage(), e1);
            } finally {
                connection = null;
            }
        }

        Socket sock;
        AdbCrypto crypto;
        AdbBase64 base64 = getBase64Impl();

        // 获取连接公私钥
        File privKey = new File(LauncherApplication.getInstance().getFilesDir(), "privKey");
        File pubKey = new File(LauncherApplication.getInstance().getFilesDir(), "pubKey");

        if (!privKey.exists() || !pubKey.exists()) {
            try {
                crypto = AdbCrypto.generateAdbKeyPair(base64);
                privKey.delete();
                pubKey.delete();
                crypto.saveAdbKeyPair(privKey, pubKey);
            } catch (NoSuchAlgorithmException | IOException e) {
                LogUtil.e(TAG, "抛出异常 " + e.getMessage(), e);
                return false;
            }
        } else {
            try {
                crypto = AdbCrypto.loadAdbKeyPair(base64, privKey, pubKey);
            } catch (Exception e) {
                LogUtil.e(TAG, "抛出异常 " + e.getMessage(), e);
                try {
                    crypto = AdbCrypto.generateAdbKeyPair(base64);
                    privKey.delete();
                    pubKey.delete();
                    crypto.saveAdbKeyPair(privKey, pubKey);
                } catch (NoSuchAlgorithmException | IOException ex) {
                    LogUtil.e(TAG, "抛出异常 " + ex.getMessage(), ex);
                    return false;
                }
            }
        }

        // 开始连接adb
        LogUtil.i(TAG, "Socket connecting...");
        try {
            sock = new Socket("localhost", 5555);
        } catch (IOException e) {
            LogUtil.e(TAG, "Throw IOException", e);
            return false;
        }
        LogUtil.i(TAG, "Socket connected");

        AdbConnection conn;
        try {
            conn = AdbConnection.create(sock, crypto);
            LogUtil.i(TAG, "ADB connecting...");

            // 10s超时
            conn.connect(10 * 1000);
        } catch (Exception e) {
            LogUtil.e(TAG, "ADB connect failed", e);
            // socket关闭
            if (sock.isConnected()) {
                try {
                    sock.close();
                } catch (IOException e1) {
                    LogUtil.e(TAG, "Catch java.io.IOException: " + e1.getMessage(), e);
                }
            }
            return false;
        }
        connection = conn;
        LogUtil.i(TAG, "ADB connected");

        // ADB成功连接后，开启ADB状态监测
        startAdbStatusCheck();
        return true;
    }

    /**
     * 在maxTime内执行root命令
     * @param cmd 待执行命令
     * @param maxTime 最长执行时间
     * @return 输出
     */
    @SuppressWarnings("deprecation")
    public static StringBuilder execRootCmd(String cmd, final int maxTime) {
        final StringBuilder result = new StringBuilder();
        DataOutputStream dos = null;
        String line = null;
        Process p;

        try {
            p = Runtime.getRuntime().exec("su");// 经过Root处理的android系统即有su命令
            processes.add(p);
            dos = new DataOutputStream(p.getOutputStream());
            final InputStream inputStream = p.getInputStream();

            // 写输入
            LogUtil.i(TAG, cmd);

            Future future = processReadExecutor.submit(new Runnable() {
                @Override
                public void run() {
                    try {
                        // 读取全部输入
                        byte[] read = new byte[1024];
                        int length = 0;
                        while ((length = inputStream.read(read, 0, 1024)) > 0) {
                            result.append(new String(read, 0, length));
                        }
                    } catch (IOException e) {
                        LogUtil.e(TAG, "抛出异常 " + e.getMessage(), e);
                    }
                }
            });

            dos.writeBytes(cmd + "\n");
            dos.flush();

            long startTime = System.currentTimeMillis();
            while (!future.isDone() && System.currentTimeMillis() - startTime < maxTime) {
                Thread.sleep(10);
            }

            if (!future.isDone()) {
                future.cancel(true);
            }


            // 关闭process
            p.destroy();
            processes.remove(p);


            isRoot = true;
        } catch (Exception e) {
            LogUtil.e(TAG, "命令执行发生异常" + e.getMessage(), e);
            isRoot = false;
        } finally {
            if (dos != null) {
                try {
                    dos.close();
                } catch (IOException e) {
                    LogUtil.e(TAG, "抛出IOException " + e.getMessage(), e);
                }
            }
        }
        return result;
    }

    /**
     * 执行root命令
     * @param cmd 待执行命令
     * @param log 日志输出文件
     * @param ret 是否保留命令行输出
     * @param ct 上下文
     * @return 输出
     */
    @SuppressWarnings("deprecation")
    public static StringBuilder execRootCmd(String cmd, String log, Boolean ret, Context ct) {
        StringBuilder result = new StringBuilder();
        DataOutputStream dos = null;
        DataInputStream dis = null;
        DataInputStream des = null;
        String line = null;
        Process p;

        try {
            p = Runtime.getRuntime().exec("su");// 经过Root处理的android系统即有su命令
            processes.add(p);
            dos = new DataOutputStream(p.getOutputStream());
            dis = new DataInputStream(p.getInputStream());
            des = new DataInputStream(p.getErrorStream());

//            while ((line = des.readLine()) != null) {
//            		LogUtil.d(TAG, "ERR************" + line);
//            }

            LogUtil.i(TAG, cmd);
            dos.writeBytes(cmd + "\n");
            dos.flush();
            dos.writeBytes("exit\n");
            dos.flush();

            while ((line = dis.readLine()) != null) {
                if(log != null) {
                    writeFileData(log, line, ct);
                }
                if(ret) {
                    result.append(line).append("\n");
                }
            }
            p.waitFor();
            processes.remove(p);
            isRoot = true;
        } catch (Exception e) {
            LogUtil.e(TAG, "抛出异常 " + e.getMessage(), e);
            isRoot = false;
        } finally {
            if (dos != null) {
                try {
                    dos.close();
                } catch (IOException e) {
                    LogUtil.e(TAG, "抛出异常 " + e.getMessage(), e);
                }
            }
            if (dis != null) {
                try {
                    dis.close();
                } catch (IOException e) {
                    LogUtil.e(TAG, "抛出异常 " + e.getMessage(), e);
                }
            }
        }
        return result;
    }


    public static void writeFileData(String monkeyLog, String message, Context ct) {
        String time = "";
        try {
            FileOutputStream fout = ct.openFileOutput(monkeyLog, MODE_APPEND);

            SimpleDateFormat formatter = new SimpleDateFormat("+++   HH:mm:ss");
            Date curDate = new Date(System.currentTimeMillis());//获取当前时间
            time = formatter.format(curDate);

            byte [] bytes = message.getBytes();
            fout.write(bytes);
            bytes = (time + "\n").getBytes();
            fout.write(bytes);
            fout.close();
        }
        catch(Exception e) {
            LogUtil.e(TAG, "抛出异常 " + e.getMessage(), e);
        }


    }

    public static StringBuilder execCmd(String cmd) {
        InputStreamReader isr = null;
        BufferedReader br = null;
        Process p = null;
        StringBuilder ret = new StringBuilder();
        String line = "";

        try {
            p = Runtime.getRuntime().exec(cmd);// 经过Root处理的android系统即有su命令
            isr = new InputStreamReader(p.getInputStream());

            br = new BufferedReader(isr);
            while ((line = br.readLine()) != null) {
//            		LogUtil.d(TAG, "ERR************" + line);
                ret.append(line).append("\n");
            }
            br.close();
            p.waitFor();
        } catch (Exception e) {
            LogUtil.e(TAG, "抛出异常 " + e.getMessage(), e);
            return ret;
        } finally {
            if (br != null) {
                try {
                    br.close();
                } catch (IOException e) {

                    LogUtil.e(TAG, "抛出异常 " + e.getMessage(), e);
                }
            }
            if (isr != null) {
                try {
                    isr.close();
                } catch (IOException e) {
                    LogUtil.e(TAG, "抛出异常 " + e.getMessage(), e);
                }
            }
            if(p != null) {
                try {
                    p.destroy();
                } catch (Exception e) {
                    LogUtil.e(TAG, "抛出异常 " + e.getMessage(), e);
                }
            }
        }
        return ret;
    }


    public static String getActivityName() {
        String result = execAdbCmd("dumpsys activity top | grep ACTIVITY | grep -o /[^[:space:]]*", 0);

        if (result.length() < 2) {
            return null;
        } else if (result.endsWith("\n")) {
            return result.substring(1, result.length()-1);
        } else {
            return result.substring(1);
        }
    }

    public static String getPageUrl() {
        String result = execAdbCmd("dumpsys activity top | grep -o ' url=[^[:space:]]*'", 0).trim();

        if (result.length() < 5) {
            return null;
        } else {
            String[] tmp = result.split("\n");
            if (tmp.length < 1) {
                return null;
            }
            result = tmp[tmp.length - 1].trim();
            int index = result.indexOf('?');
            if (index > 0) {
                return result.substring(4, index);
            } else {
                index = result.indexOf(',');
                if (index > 0) {
                    return result.substring(4, index);
                } else {
                    return result.substring(4);
                }
            }
        }
    }

    public static void installApk(final boolean isOverrideInstall, final File apkFile, final InstallAppCallback callback) {
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                String path = apkFile.getAbsolutePath();
                PackageManager pm = LauncherApplication.getInstance().getPackageManager();
                PackageInfo info = pm.getPackageArchiveInfo(path,
                        PackageManager.GET_ACTIVITIES);
                String packageName = "";
                if (info != null) {
                    ApplicationInfo appInfo = info.applicationInfo;
                    packageName = appInfo.packageName;
                    LogUtil.w("yuawen", "packageName is: " + packageName);
                } else {
                    LogUtil.w("yuawen", "packageInfo is null, file path is: " + path);
                }

                // 如果是更新自身，手动安装下
                if (StringUtil.equals(packageName, LauncherApplication.getContext().getPackageName())) {
                    callback.onInstallFail("INSTALL_FAILED_UID_CHANGED");
                    return;
                }

                if (!isOverrideInstall) {
                    String uninstallStr = execSafeCmd("pm uninstall " + packageName, 3);
                    LogUtil.w("yuawen", "uninstallStr: " + uninstallStr);
                }
                String cmd, tmpPath = null;

                // 低版本系统不兼容
                if (Build.VERSION.SDK_INT < 23) {
                    cmd = "pm install -r -d " + path;
                } else {
                    cmd = "pm install -r -d -g " + path;
                }

                String installStr = execSafeCmd(cmd, 3);

                // 更贴近ADB实际安装方式
                // 说明需要拷贝到/data/local/tmp里
                if (StringUtil.contains(installStr, "/data/local/tmp/")) {
                    tmpPath = CmdTools.cpFileTo(apkFile, "/data/local/tmp/app-debug.apk");

                    if (Build.VERSION.SDK_INT < 23) {
                        cmd = "pm install -r -d " + tmpPath;
                    } else {
                        cmd = "pm install -r -d -g " + tmpPath;
                    }

                    installStr = execSafeCmd(cmd, 3);
                }

                // 拷贝完毕后需要删除
                if (tmpPath != null) {
                    CmdTools.execHighPrivilegeCmd("rm -f " + tmpPath);
                }

                if (!StringUtil.isEmpty(installStr) && installStr.contains("Success")) {
                    callback.onInstallSuccess(packageName);
                } else {
                    LogUtil.e("yuawen", "installStr: " + installStr);
                    callback.onInstallFail("安装失败:" + installStr);
                }
            }
        });
    }

    public static String getTopActivity() {
        return execAdbCmd("dumpsys activity top | grep ACTIVITY", 0);
    }

    /**
     * 获取屏幕现实的View
     * @return
     */
    public static String loadTopViews(String app) {
        if (StringUtil.isEmpty(app)) {
            return execAdbCmd("dumpsys SurfaceFlinger --list", 0);
        } else {
            return execAdbCmd("dumpsys SurfaceFlinger --list | grep '" + app + "'", 0);
        }
    }

    /**
     * 判断文件是否存在
     * @param file shell中文件路径
     * @return
     */
    public static boolean fileExists(String file) {
        String result = execHighPrivilegeCmd("ls " + file);

        if (StringUtil.contains(result, "No such file")) {
            return false;
        }

        // md5没对上，重新推
        return true;
    }

    private static ScheduledExecutorService scheduledExecutorService;

    /**
     * 开始检查ADB状态
     */
    private static void startAdbStatusCheck() {
        if (scheduledExecutorService == null) {
            scheduledExecutorService = Executors.newSingleThreadScheduledExecutor();
        }

        scheduledExecutorService.schedule(new Runnable() {
            @Override
            public void run() {
                long currentTime = System.currentTimeMillis();
                // 防止重复运行，14s内只能执行一次
                if (currentTime - LAST_RUNNING_TIME < 14 * 1000) {
                    return;
                }

                LAST_RUNNING_TIME = currentTime;
                String result = null;
                try {
                    result = execAdbCmd("echo '1'", 5000);
                } catch (Exception e) {
                    LogUtil.e(TAG, "Check adb status throw :" + e.getMessage(), e);
                }

                if (!StringUtil.equals("1", StringUtil.trim(result))) {
                    // 等2s再检验一次
                    MiscUtil.sleep(2000);

                    boolean genResult = false;

                    // double check机制，防止单次偶然失败带来重连
                    String doubleCheck = null;
                    try {
                        doubleCheck = execAdbCmd("echo '1'", 5000);
                    } catch (Exception e) {
                        LogUtil.e(TAG, "Check adb status throw :" + e.getMessage(), e);
                    }
                    if (!StringUtil.equals("1", StringUtil.trim(doubleCheck))) {
                        // 尝试恢复3次
                        for (int i = 0; i < 3; i++) {
                            // 关停无用连接
                            if (connection != null && connection.isFine()) {
                                try {
                                    connection.close();
                                } catch (IOException e) {
                                    LogUtil.e(TAG, "Catch java.io.IOException: " + e.getMessage(), e);
                                } finally {
                                    connection = null;
                                }
                            }

                            // 清理下当前已连接进程
                            clearProcesses();

                            // 尝试重连
                            genResult = generateConnection();
                            if (genResult) {
                                break;
                            }
                        }
                    }

                    // 恢复失败
                    if (!genResult) {
                        Context con = LauncherApplication.getInstance().loadActivityOnTop();
                        if (con == null) {
                            con = LauncherApplication.getInstance().loadRunningService();
                        }

                        if (con == null) {
                            LauncherApplication.getInstance().showToast("ADB连接中断，请尝试重新开启调试端口");
                            return;
                        }

                        // 回首页
                        LauncherApplication.getInstance().showDialog(con, "ADB连接中断，请尝试重新开启调试端口", "好的", null);

                        // 通知各个功能ADB挂了
                        InjectorService.g().pushMessage(FATAL_ADB_CANNOT_RECOVER);

                        return;
                    }
                }

                // 15S 检查一次
                scheduledExecutorService.schedule(this, 15, TimeUnit.SECONDS);
            }
        }, 15, TimeUnit.SECONDS);
    }

    /**
     * 拷贝文件
     * @param origin
     * @param toPath
     * @return
     */
    public static String cpFileTo(File origin, String toPath) {
        String source = FileUtils.getPathInShell(origin);
        if (StringUtil.isEmpty(source) || StringUtil.isEmpty(toPath)) {
            LogUtil.e(TAG, "Can't copy null item");
            return null;
        }

        String newPath;
        // 补上最后的'/'
        if (!toPath.endsWith("/")) {
            newPath = toPath;
        } else {
            newPath = toPath + origin.getName();
        }

        String cmd = "cp " + source + " " + newPath;

        String result = execHighPrivilegeCmd(cmd);

        return newPath;
    }

    /**
     * 拷贝可执行文件
     * @param sourceF 源文件
     * @return 可执行文件路径
     */
    public static String cpExecutable(File sourceF) {
        String source = FileUtils.getPathInShell(sourceF);
        if (StringUtil.isEmpty(source)) {
            LogUtil.e(TAG, "Can't copy null item");
            return null;
        }

        String exec = "/data/local/tmp/" + sourceF.getName();
        String cmd = "cp " + source + " " + exec + " && chmod 777 " + exec;

        execHighPrivilegeCmd(cmd);

        return exec;
    }

    public interface GrantHighPrivPermissionCallback {
        void onGrantSuccess();
        void onGrantFail(String msg);
    }

    public interface InstallAppCallback {
        void onInstallSuccess(String packageName);
        void onInstallFail(String reason);
    }


}