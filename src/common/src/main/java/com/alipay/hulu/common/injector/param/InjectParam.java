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

import android.accessibilityservice.AccessibilityService;
import android.app.Service;
import android.content.Context;
import androidx.annotation.NonNull;

import com.alipay.hulu.common.bean.ProcessInfo;
import com.alipay.hulu.common.injector.cache.InjectParamTypeCache;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.mdit.library.Const;

import java.util.List;

/**
 * Created by qiaoruikai on 2018/10/9 6:13 PM.
 */
public class InjectParam {
    private static final String TAG = "InjectParam";

    /** 应用包名 */
    public static final InjectParam APP = new InjectParam("app", String.class);

    /** 应用名 */
    public static final InjectParam APP_NAME = new InjectParam("appName", String.class);

    /** 屏幕顶层应用包名 */
    public static final InjectParam PACKAGE = new InjectParam("package", String.class);

    /** 应用所有子进程包名 */
    public static final InjectParam PACKAGE_CHILDREN = new InjectParam("packageChildren", List.class);

    /** 屏幕顶层应用包名 */
    public static final InjectParam TOP_ACTIVITY = new InjectParam("topActivity", String.class);

    /** 服务上下文 */
    public static final InjectParam CONTEXT = new InjectParam("context", Context.class);

    /** 服务上下文 */
    public static final InjectParam SERVICE = new InjectParam("service", Service.class);

    /** AccessibilityService */
    public static final InjectParam ACCESSIBILITY_SERVICE = new InjectParam("accessibilityService", AccessibilityService.class);

    /** 目标进程pid */
    public static final InjectParam PID = new InjectParam("pid", ProcessInfo.class);

    /** 应用所有子进程pid */
    public static final InjectParam PID_CHILDREN = new InjectParam("pidChildren", List.class);

    /** ps获取的uid */
    public static final InjectParam PUID = new InjectParam("puid", String.class);

    /** 应用UID */
    public static final InjectParam UID = new InjectParam("uid", Integer.class);

    /** 是否显示额外信息 */
    public static final InjectParam EXTRA = new InjectParam("extra", Boolean.class);

    /**
     * 空占位符，勿用
     */
    public static final InjectParam DEFAULT = new InjectParam("default", Object.class);

    static {
        // 先预注册预设参数
        InjectParamTypeCache.getCacheInstance().addCache(APP);
        InjectParamTypeCache.getCacheInstance().addCache(APP_NAME);
        InjectParamTypeCache.getCacheInstance().addCache(PACKAGE);
        InjectParamTypeCache.getCacheInstance().addCache(PACKAGE_CHILDREN);
        InjectParamTypeCache.getCacheInstance().addCache(TOP_ACTIVITY);
        InjectParamTypeCache.getCacheInstance().addCache(CONTEXT);
        InjectParamTypeCache.getCacheInstance().addCache(SERVICE);
        InjectParamTypeCache.getCacheInstance().addCache(ACCESSIBILITY_SERVICE);
        InjectParamTypeCache.getCacheInstance().addCache(PID);
        InjectParamTypeCache.getCacheInstance().addCache(PID_CHILDREN);
        InjectParamTypeCache.getCacheInstance().addCache(PUID);
        InjectParamTypeCache.getCacheInstance().addCache(UID);
        InjectParamTypeCache.getCacheInstance().addCache(EXTRA);
        InjectParamTypeCache.getCacheInstance().addCache(DEFAULT);
    }

    private String name;
    private Class type;
    private boolean sticky = true;
    private boolean persistent = false;

    private InjectParam(@NonNull String name, @NonNull Class type) {
        this.name = name;
        if (type.isPrimitive()) {
            this.type = Const.getPackedType(type);
        } else {
            this.type = type;
        }
    }

    private InjectParam(@NonNull String name, @NonNull Class type, boolean sticky, boolean persistent) {
        this.name = name;
        if (type.isPrimitive()) {
            this.type = Const.getPackedType(type);
        } else {
            this.type = type;
        }

        this.sticky = sticky;
        this.persistent = persistent;
    }

    /**
     * 是否是合法内容
     * @param content
     * @return
     */
    public boolean isValueValid(Object content) {
        if (content == null) {
            return true;
        }

        return type.isInstance(content);
    }

    public String getName() {
        return name;
    }

    public Class getType() {
        return type;
    }

    public boolean isSticky() {
        return sticky;
    }

    public boolean isPersistent() {
        return persistent;
    }

    /**
     * 获取InjectParamType实例
     * @param name
     * @param type
     * @return
     */
    public static InjectParam newInjectParamType(String name, Class<?> type, boolean sticky, boolean persistent) {
        if (type == null) {
            return null;
        }

        if (StringUtil.isEmpty(name)) {
            name = type.getName();
        }

        // 查找缓存的参数信息
        InjectParam result = InjectParamTypeCache.getCacheInstance().getExistsParamType(name);
        if (result == null) {
            result = new InjectParam(name, type, sticky, persistent);
            InjectParamTypeCache.getCacheInstance().addCache(result);
        } else {
            if (result.getType() != type) {
                LogUtil.e(TAG, "缓存字段类型与目标类型不一致，无法生成实例，cached=【%s】，new=【%s】", result, type);
                return null;
            }
        }

        return result;
    }

    @Override
    public String toString() {
        final StringBuffer sb = new StringBuffer("InjectParam{");
        sb.append("name='").append(name).append('\'');
        sb.append(", type=").append(type.getSimpleName());
        sb.append('}');
        return sb.toString();
    }
}
