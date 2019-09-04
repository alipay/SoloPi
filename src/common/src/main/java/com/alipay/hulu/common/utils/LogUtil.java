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

import com.orhanobut.logger.Logger;

/**
 * 日志打印工具
 * Created by qiaoruikai on 2018/9/29 11:35 AM.
 */
public class LogUtil {
    /**
     * 日志级别
     */
    public static int LOG_LEVEL = 0;

    public static void d(String tag, String message, Object... args) {
        if (LOG_LEVEL > Logger.DEBUG) {
            return;
        }
        Logger.t(tag).d(message, args);
    }

    public static void i(String tag, String message, Object... args) {
        if (LOG_LEVEL > Logger.INFO) {
            return;
        }
        Logger.t(tag).i(message, args);
    }

    public static void w(String tag, String message, Object... args) {
        if (LOG_LEVEL > Logger.WARN) {
            return;
        }
        Logger.t(tag).w(message, args);
    }

    public static void e(String tag, String message, Object... args) {
        if (LOG_LEVEL > Logger.ERROR) {
            return;
        }
        Logger.t(tag).e(message + "\n" + MiscUtil.getCurrentStrackTraceString(), args);
    }

    public static void e(String tag, Throwable throwable, String message, Object... args) {
        if (LOG_LEVEL > Logger.ERROR) {
            return;
        }
        Logger.t(tag).e(throwable, message, args);
    }

    public static void i(String tag, String message, Throwable t) {
        if (LOG_LEVEL > Logger.INFO) {
            return;
        }
        Logger.log(Logger.INFO, tag, message, t);
    }

    public static void w(String tag, String message, Throwable t) {
        if (LOG_LEVEL > Logger.WARN) {
            return;
        }
        Logger.log(Logger.WARN, tag, message, t);
    }

    public static void d(String tag, String message, Throwable t) {
        if (LOG_LEVEL > Logger.DEBUG) {
            return;
        }
        Logger.log(Logger.DEBUG, tag, message, t);
    }

    public static void e(String tag, String message, Throwable t) {
        e(tag, t, message);
    }

    public static void v(String tag, String message, Object... args) {
        if (LOG_LEVEL > Logger.VERBOSE) {
            return;
        }
        Logger.t(tag).v(message, args);
    }

    public static void t(String tag, String message, Object... args) {
        if (LOG_LEVEL > Logger.ASSERT) {
            return;
        }
        Logger.t(tag).wtf(message, args);
    }
}
