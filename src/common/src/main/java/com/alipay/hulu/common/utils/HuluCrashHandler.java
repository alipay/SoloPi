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
package com.alipay.hulu.common.utils;

import android.os.Process;

import java.util.ArrayList;
import java.util.List;

/**
 * Created by ruyao.yry on 2018/3/12.
 */
public class HuluCrashHandler implements Thread.UncaughtExceptionHandler {
    private static final String TAG = "HuluCrashHandler";

    private static volatile HuluCrashHandler sHuluCrashHandler;

    private static volatile boolean sHasInited = false;

    public static HuluCrashHandler getCrashHandler() {
        if (sHuluCrashHandler == null) {
            synchronized (HuluCrashHandler.class) {
                if (sHuluCrashHandler == null) {
                    sHuluCrashHandler = new HuluCrashHandler();
                }
            }
        }

        return sHuluCrashHandler;
    }

    private List<CrashCallback> mCrashCallbacks = new ArrayList<>();

    public void init() {
        if (!sHasInited) {
            Thread.setDefaultUncaughtExceptionHandler(this);
            sHasInited = true;
        }
    }

    public void registerCrashCallback(CrashCallback cb) {
        synchronized (mCrashCallbacks) {
            mCrashCallbacks.add(cb);
        }
    }

    public void unregisterCrashCallback(CrashCallback cb) {
        synchronized (mCrashCallbacks) {
            mCrashCallbacks.remove(cb);
        }
    }

    private void runCallbacks(Thread t, Throwable reason) {
        List<CrashCallback> copyCrashCallbacks = new ArrayList<>();
        synchronized (mCrashCallbacks) {
            copyCrashCallbacks.addAll(mCrashCallbacks);
        }

        for (CrashCallback cb : mCrashCallbacks) {
            cb.onAppCrash(t, reason);
        }
    }

    @Override
    public void uncaughtException(Thread t, Throwable e) {
        LogUtil.e(TAG, e.getMessage(), e);
        runCallbacks(t, e);
        CrashCallback.KILL_PROCESS_CALLBACK.onAppCrash(t, e);
    }

    public interface CrashCallback {
        void onAppCrash(Thread t, Throwable e);

        CrashCallback KILL_PROCESS_CALLBACK = new CrashCallback() {
            @Override
            public void onAppCrash(Thread t, Throwable e) {
                Process.killProcess(Process.myPid());
            }
        };
    }
}
