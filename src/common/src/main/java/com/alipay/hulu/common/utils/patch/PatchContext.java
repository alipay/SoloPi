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
package com.alipay.hulu.common.utils.patch;

import android.content.Context;

import com.alipay.hulu.common.tools.AbstCmdLine;

import java.io.File;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

/**
 * Created by qiaoruikai on 2019-04-19 16:04.
 */
public abstract class PatchContext {
    public abstract File getPatchRoot();

    /**
     * 获取资源大小
     *
     * @return
     */
    public abstract File getAssetsRoot();

    /**
     * 获取数据子文件夹
     * @param name
     * @return
     */
    public abstract File getDataFolder(String name);

    /**
     * 获取CmdLine
     * @return
     */
    public abstract AbstCmdLine startCmdLine();
    public abstract AbstCmdLine startCmdLine(String cmd);

    /**
     * 执行ADB命令
     * @param cmd
     * @return
     */
    public abstract String executeHighPrivilegeCmd(String cmd);

    /**
     * 执行adb命令
     * @param cmd
     * @param timeout 超时时间（毫秒）
     * @return
     */
    public abstract String executeHighPrivilegeCmd(String cmd, int timeout);


    /**
     * 注册消息通知
     * @param object
     */
    public abstract void register(Object object);

    /**
     * 注销消息通知
     * @param object
     */
    public abstract void unregister(Object object);

    public abstract Context getApplicationContext();
    public abstract Context getTopActivity();
    public abstract Context getRunningService();

    /**
     * 获取Patch类
     *
     * @param patchClass
     * @return
     */
    public static PatchContext g(Class<?> patchClass) {
        if (patchClass == null) {
            return null;
        }

        // 通过ClassLoader获取绑定的PatchContext
        ClassLoader loader = patchClass.getClassLoader();
        Class<? extends ClassLoader> targetClass = loader.getClass();
        try {
            Method method = targetClass.getMethod("getContext");
            if (method != null) {
                Object content = method.invoke(loader);

                if (content instanceof PatchContext) {
                    return (PatchContext) content;
                }
            }
        } catch (NoSuchMethodException e) {
        } catch (IllegalAccessException e) {
        } catch (InvocationTargetException e) {
        }
        return null;
    }
}
