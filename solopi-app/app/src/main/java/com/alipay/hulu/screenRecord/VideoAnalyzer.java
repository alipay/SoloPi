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

    private static class SingletonHolder {
        private static final VideoAnalyzer INSTANCE = new VideoAnalyzer();
    }

    public static VideoAnalyzer getInstance() {
        return SingletonHolder.INSTANCE;
    }

    private VideoAnalyzer() {

    }

    public void doAnalyze(final long t1, final double exceptDiff, final String path, final AnalyzeListener listener) {
        final long startTime = System.currentTimeMillis();

        final PatchLoadResult patch = ClassUtil.getPatchInfo(SCREEN_RECORD_PATCH);

        if (patch == null) {
            LogUtil.e("yuawen", "插件screenRecord不存在，无法处理");
            if (listener != null) {
                listener.onAnalyzeFailed("Screen recording analyzer plugin is not installed");
            }
            return;
        }

        // 后台运算
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    Class<?> mainClass = patch.classLoader.loadClass(patch.entryClass);
                    long t2 = invokeAnalyzer(mainClass, patch.entryMethod, path, exceptDiff, t1);

                    // 解析时间
                    long decodeCostTime = (System.currentTimeMillis() - startTime);

                    long result = t2 - t1;

                    LogUtil.i("yuawen",
                            "path : " + path +
                                    "解析耗时：" + decodeCostTime + " 毫秒\n" +
                                    "\nT1时间为：" + t1 +
                                    "\nT2时间为：" + t2 +
                                    "\n计算耗时为：" + result);
                    if (listener != null) {
                        listener.onAnalyzeFinished(result);
                    }
                } catch (Exception | LinkageError e) {
                    LogUtil.e(TAG, "Unable to analyze screen recording: " + e.getMessage(), e);
                    if (listener != null) {
                        listener.onAnalyzeFailed("Unable to analyze screen recording: " + e.getMessage());
                    }
                }
            }
        });
    }

    static long invokeAnalyzer(Class<?> mainClass, String legacyMethod, String path,
                               double exceptDiff, long actionOffset) throws Exception {
        try {
            Method methodWithStart = mainClass.getMethod("compVideoImageWithStart",
                    String.class, double.class, long.class);
            return ((Double) methodWithStart.invoke(
                    null, path, exceptDiff, actionOffset)).longValue();
        } catch (NoSuchMethodException exception) {
            LogUtil.i(TAG, "包含起始时间的视频分析接口不存在，使用兼容接口");
            Method targetMethod = mainClass.getMethod(
                    legacyMethod, String.class, double.class);
            return ((Double) targetMethod.invoke(null, path, exceptDiff)).longValue();
        }
    }
}
