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

import com.alipay.hulu.common.utils.LogUtil;
import com.cgutman.adblib.AdbStream;
import com.cgutman.adblib.ByteQueueInputStream;
import com.codebutler.android_websockets.WrapSocket;

import java.io.DataOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.Queue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;

/**
 * 命令行操作包装
 * Created by cathor on 2017/12/26.
 */
public class CmdLine implements AbstCmdLine, WrapSocket {
    private static final String TAG = "CmdLine";

    protected String cmdTag;

    /**
     * 包装的adbStream
     */
    private AdbStream stream;

    /**
     * 包装的process
     */
    private Process suProcess;

    /**
     * 重定向输出
     */
    private ConcurrentLinkedQueue<String> redirectLog;

    /**
     * Process reader
     */
    private InputStream inputStream;

    private ExecutorService singleTaskExecutor;

    private Queue<byte[]> readList;

    /**
     * 是否是adb模式
     */
    private boolean isAdb;

    protected CmdLine(AdbStream stream) {
        isAdb = true;
        this.stream = stream;
        this.suProcess = null;
        this.inputStream = stream.getInputStream();
    }

    protected CmdLine(Process suProcess) {
        this.isAdb = false;
        this.stream = null;
        this.suProcess = suProcess;

        // 对于Process，需要一个独立的线程来读取命令行输出
        this.inputStream = suProcess.getInputStream();
        this.readList = new LinkedBlockingQueue<>();
        singleTaskExecutor = Executors.newSingleThreadExecutor();
        singleTaskExecutor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    byte[] bytes = new byte[1024];
                    int length = 0;
                    while ((length = inputStream.read(bytes, 0, 1024)) > 0) {
                        readList.add(Arrays.copyOf(bytes, length));
                    }
                } catch (IOException e) {
                    LogUtil.e(TAG, "Catch IOException: " + e.getMessage(), e);
                }
            }
        });
    }

    /**
     * 向命令行执行写操作
     *
     * @param cmd
     * @throws Exception
     */
    public void writeCommand(String cmd) {
        if (cmd == null) {
            cmd = "";
        }
        try {
            CmdTools.logcatCmd(cmdTag + cmd);
            if (!cmd.endsWith("\n")) {
                cmd = cmd + "\n";
            }
            if (isAdb) {
                stream.write(cmd);
            } else {
                DataOutputStream stream = new DataOutputStream(suProcess.getOutputStream());
                stream.writeBytes(cmd);
                stream.flush();
            }
        } catch (Exception e) {
            LogUtil.e(TAG, "Write command " + cmd + " failed", e);
        }
    }

    /**
     * 读取命令行当前所有输出
     *
     * @return
     */
    public String readUntilSomething() {
        try {
            if (isAdb) {
                BlockingQueue<byte[]> queue = (BlockingQueue<byte[]>) stream.getReadQueue();
                StringBuilder builder = new StringBuilder();
                // 读取消息
                synchronized (stream.getReadQueue()) {
                    String content = new String(queue.take());
                    builder.append(content);
                    while (!queue.isEmpty()) {
                        content = new String(queue.poll());
                        builder.append(content);
                    }
                    stream.getReadQueue().notifyAll();
                }
                return builder.toString();
            } else {
                StringBuilder stringBuilder = new StringBuilder();
                while (!readList.isEmpty()) {
                    stringBuilder.append(new String(readList.poll()));
                }

                return stringBuilder.toString();
            }
        } catch (Exception e) {
            LogUtil.e(TAG, "Read content failed", e);
            return null;
        }
    }

    /**
     * 读取命令行当前所有输出
     *
     * @return
     */
    public String readOutput() {
        try {
            if (isAdb) {
                Queue<byte[]> queue = stream.getReadQueue();
                StringBuilder builder = new StringBuilder();
                // 读取消息
                synchronized (stream.getReadQueue()) {
                    while (!queue.isEmpty()) {
                        String content = new String(queue.poll());
                        builder.append(content);
                    }
                    stream.getReadQueue().notifyAll();
                }
                return builder.toString();
            } else {
                StringBuilder stringBuilder = new StringBuilder();
                while (!readList.isEmpty()) {
                    stringBuilder.append(new String(readList.poll()));
                }

                return stringBuilder.toString();
            }
        } catch (Exception e) {
            LogUtil.e(TAG, "Read content failed", e);
            return null;
        }
    }

    @Override
    public void writeBytes(byte[] content) {
        try {
            if (isAdb) {
                stream.write(content, true);
            } else {
                OutputStream outputStream = suProcess.getOutputStream();
                outputStream.write(content);
                outputStream.flush();
            }
        } catch (IOException e) {
            LogUtil.e(TAG, "Catch IOException: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            LogUtil.e(TAG, "Catch InterruptedException: " + e.getMessage(), e);
        }
    }

    @Override
    public InputStream getInputStream() {
        return inputStream;
    }

    /**
     * 强制关闭命令行
     *
     * @throws IOException
     */
    public void close() throws IOException {
        if (isAdb) {
            stream.close();
        } else {
            suProcess.destroy();
        }
    }

    /**
     * 命令行是否关闭
     *
     * @return
     */
    public boolean isClosed() {
        if (isAdb) {
            return stream.isClosed();
        } else {
            try {
                int exit = suProcess.exitValue();
                return true;
            } catch (IllegalThreadStateException e) {
                return false;
            }
        }
    }

    @Override
    public void disconnect() {
        ((ByteQueueInputStream) inputStream).closeSocketForwardingMode();
        LogUtil.i(TAG, "Wrap Connection disconnect");
    }
}
