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
package com.alipay.hulu.service;

/**
 * 面向已有回放调用方的兼容门面。回放与动态 Agent 会话共享同一个独占设备控制租约。
 */
public final class ReplaySessionLease {
    private ReplaySessionLease() {
    }

    public static String newOwner(String source) {
        return DeviceControlLease.newOwner(source);
    }

    public static boolean tryAcquire(String owner) {
        return DeviceControlLease.tryAcquire(owner);
    }

    public static boolean isOwnedBy(String owner) {
        return DeviceControlLease.isOwnedBy(owner);
    }

    public static boolean release(String owner) {
        return DeviceControlLease.release(owner);
    }
}
