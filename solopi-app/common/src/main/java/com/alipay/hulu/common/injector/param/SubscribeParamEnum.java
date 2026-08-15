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
package com.alipay.hulu.common.injector.param;

/**
 * Created by qiaoruikai on 2018/10/9 6:27 PM.
 */
public class SubscribeParamEnum {
    public static final String APP = "app";

    /** 应用名 */
    public static final String APP_NAME = "appName";

    /** 屏幕顶层应用包名 */
    public static final String PACKAGE = "package";

    /** 应用所有子进程包名 */
    public static final String PACKAGE_CHILDREN = "packageChildren";

    /** 屏幕顶层应用包名 */
    public static final String TOP_ACTIVITY = "topActivity";

    /** AccessibilityService */
    public static final String ACCESSIBILITY_SERVICE = "accessibilityService";

    /** 目标进程pid */
    public static final String PID = "pid";

    /** 应用所有子进程pid */
    public static final String PID_CHILDREN = "pidChildren";

    /** ps获取的uid */
    public static final String PUID = "puid";

    /** 应用UID */
    public static final String UID = "uid";

    /** 是否显示额外信息 */
    public static final String EXTRA = "extra";
}
