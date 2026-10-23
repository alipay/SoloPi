/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.alipay.hulu.common.utils;

import java.util.HashSet;
import java.util.Set;

/**
 * 进程内运行会话与高风险维护操作的原子门闩。
 *
 * <p>普通运行会话可以并存；插件安装或删除属于独占维护操作，只能在没有运行会话时
 * 取得门闩。门闩使用显式 owner，而不是线程锁，因此可跨异步回调安全释放。</p>
 */
public final class RuntimeSessionGuard {
    private static final Object LOCK = new Object();
    private static final Set<String> SESSION_OWNERS = new HashSet<>();
    private static String maintenanceOwner;

    private RuntimeSessionGuard() {
    }

    public static boolean beginSession(String owner) {
        if (StringUtil.isEmpty(owner)) {
            return false;
        }
        synchronized (LOCK) {
            if (maintenanceOwner != null) {
                return false;
            }
            SESSION_OWNERS.add(owner);
            return true;
        }
    }

    public static void endSession(String owner) {
        if (StringUtil.isEmpty(owner)) {
            return;
        }
        synchronized (LOCK) {
            SESSION_OWNERS.remove(owner);
        }
    }

    public static boolean beginMaintenance(String owner) {
        if (StringUtil.isEmpty(owner)) {
            return false;
        }
        synchronized (LOCK) {
            if (owner.equals(maintenanceOwner)) {
                return true;
            }
            if (maintenanceOwner != null || !SESSION_OWNERS.isEmpty()) {
                return false;
            }
            maintenanceOwner = owner;
            return true;
        }
    }

    public static void endMaintenance(String owner) {
        if (StringUtil.isEmpty(owner)) {
            return;
        }
        synchronized (LOCK) {
            if (owner.equals(maintenanceOwner)) {
                maintenanceOwner = null;
            }
        }
    }

    public static boolean isMaintenanceActive() {
        synchronized (LOCK) {
            return maintenanceOwner != null;
        }
    }

    public static boolean hasActiveSessions() {
        synchronized (LOCK) {
            return !SESSION_OWNERS.isEmpty();
        }
    }
}
