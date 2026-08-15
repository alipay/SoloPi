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
package com.alipay.hulu.common.logger;

import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.Message;
import android.util.Log;

import com.orhanobut.logger.LogStrategy;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.io.Writer;
import java.util.Calendar;
import java.util.Locale;

/**
 * Created by qiaoruikai on 2018/10/31 3:10 PM.
 */
public final class DiskLogStrategy implements LogStrategy {
    private static final String TAG = "DiskLogStrategy";
    private WriteHandler handler;

    public DiskLogStrategy(File root) {
        HandlerThread thread = new HandlerThread("LogThread");
        thread.start();
        handler = new WriteHandler(root, thread.getLooper());
    }

    @Override
    public void log(int priority, String tag, String message) {
        Message msg = handler.obtainMessage(priority);
        msg.obj = message;
        handler.handleMessage(msg);
    }

    private static class WriteHandler extends Handler {
        // max 512KB
        private static final int MAX_SIZE = 512 * 1024;
        private File root;

        private File currentFile = null;

        private Writer writer;
        private int day = -1;
        private int currentFileIdx = 0;

        private boolean init = false;

        WriteHandler(File root, Looper looper) {
            super(looper);
            this.root = root;
        }

        @Override
        public void handleMessage(Message msg) {
            if (!init) {
                Calendar calendar = Calendar.getInstance();
                day = calendar.get(Calendar.DAY_OF_MONTH);
                currentFileIdx = 0;

                reloadWriter(calendar);
            }

            // 检查是否需要更新
            Calendar calendar = Calendar.getInstance();
            int currentDay = calendar.get(Calendar.DAY_OF_MONTH);
            if (currentDay != day) {
                day = currentDay;
                reloadWriter(calendar);
            } else if (currentFile.length() > MAX_SIZE) {
                reloadWriter(calendar);
            }

            String log = (String) msg.obj;
            try {
                writer.append(log);
                writer.flush();
            } catch (IOException e) {
                // 日志系统故障，没办法打日志
                Log.e(TAG, "Catch java.io.IOException: " + e.getMessage(), e);
            }
        }

        /**
         * 重载Writer
         * @param calendar
         */
        private void reloadWriter(Calendar calendar) {
            String fileNameBase = String.format(Locale.CHINA, "%d%d%d", calendar.get(Calendar.YEAR),
                    calendar.get(Calendar.MONTH) + 1, day);
            // 查找可用输出文件
            while (true) {
                String fileName = fileNameBase + "-" + currentFileIdx + ".log";

                // 需要目标文件小于500K
                File newFile = new File(root, fileName);
                if (!newFile.exists() || newFile.length() < MAX_SIZE) {
                    currentFile = newFile;
                    break;
                }
                currentFileIdx ++;
            }

            if (writer != null) {
                try {
                    writer.close();
                } catch (IOException e) {
                    e.printStackTrace();
                    // 日志系统故障，没办法打日志
                    Log.e(TAG, "Catch java.io.IOException: " + e.getMessage(), e);
                }
            }

            try {
                currentFile.setWritable(true);
                if (currentFile.exists()) {
                    writer = new BufferedWriter(new FileWriter(currentFile, true));
                } else {
                    writer = new BufferedWriter(new FileWriter(currentFile, false));
                }
            } catch (IOException e) {
                // 日志系统故障，没办法打日志
                Log.e(TAG, "Catch java.io.IOException: " + e.getMessage(), e);
            }
        }

        @Override
        protected void finalize() throws Throwable {
            if (writer != null) {
                try {
                    writer.close();
                } catch (IOException e) {
                    Log.e(TAG, "Catch java.io.IOException: " + e.getMessage(), e);
                }
            }
            super.finalize();
        }
    }
}
