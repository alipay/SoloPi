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
package com.alipay.hulu.screenRecord;

import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.ClassUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.patch.PatchLoadResult;

import java.lang.reflect.Method;

public class VideoAnalyzer {

    public static final String SCREEN_RECORD_PATCH = "hulu_screenRecord";

    public interface AnalyzeListener {
        void onAnalyzeFinished(long result);
        void onAnalyzeFailed(String msg);
    }

    private static final String TAG = VideoAnalyzer.class.getSimpleName();

    private long startTime;
    private long t1;    //从开始录屏到检测到点击的时间
    private long t2;    //从开始录屏到检测到加载完成的时间
    private long result;

    private static class SingletonHolder {
        private static final VideoAnalyzer INSTANCE = new VideoAnalyzer();
    }

    public static VideoAnalyzer getInstance() {
        return SingletonHolder.INSTANCE;
    }

    private VideoAnalyzer() {

    }

    public void doAnalyze(final long t1, final double exceptDiff, final String path, final AnalyzeListener listener) {
        this.startTime = System.currentTimeMillis();
        this.t1 = t1;
        this.t2 = 0;

        final PatchLoadResult patch = ClassUtil.getPatchInfo(SCREEN_RECORD_PATCH);

        if (patch == null) {
            LogUtil.e("yuawen", "插件screenRecord不存在，无法处理");
            if (listener != null) {
                listener.onAnalyzeFinished(-1);
            }
            return;
        }

        // 后台运算
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    Class<?> mainClass = patch.classLoader.loadClass(patch.entryClass);

                    try {
                        Method methodWithStart = mainClass.getMethod("compVideoImageWithStart",
                                String.class, double.class, long.class);

                        t2 = ((Double) methodWithStart.invoke(null, path, exceptDiff, t1)).intValue();
                    } catch (Exception e) {
                        LogUtil.e(TAG, "无法找到包含Start的函数", e);

                        // 降级到无起始时间的调用
                        Method targetMethod = mainClass.getMethod(patch.entryMethod, String.class, double.class);

                        t2 = ((Double) targetMethod.invoke(null, path, exceptDiff)).intValue();
                    }

                    // 解析时间
                    long decodeCostTime = (System.currentTimeMillis() - startTime);

                    result = t2 - t1;

                    LogUtil.i("yuawen",
                            "path : " + path +
                                    "解析耗时：" + decodeCostTime + " 毫秒\n" +
                                    "\nT1时间为：" + t1 +
                                    "\nT2时间为：" + t2 +
                                    "\n计算耗时为：" + result);
                    if (listener != null) {
                        listener.onAnalyzeFinished(result);
                    }
                } catch (Exception e) {
                    LogUtil.e(TAG, "Catch java.lang.Exception: " + e.getMessage(), e);
                }
            }
        });
    }
}
