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
package com.alipay.hulu.screenRecord;

import com.alipay.hulu.common.utils.RuntimeSessionGuard;

import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 进程内屏幕录制租约，保证同一时刻只有一个录屏 owner。
 */
public final class ScreenRecorderLease {
    private static final String RUNTIME_OWNER_PREFIX = "screen-record:";
    private static final AtomicReference<String> OWNER = new AtomicReference<>();
    private static final AtomicLong OWNER_SEQUENCE = new AtomicLong();

    private ScreenRecorderLease() {
    }

    public static String newOwner(String source) {
        if (source == null || source.length() == 0) {
            throw new IllegalArgumentException("Screen recorder owner source is required");
        }
        return source + ":" + OWNER_SEQUENCE.incrementAndGet();
    }

    /**
     * 先占用录屏租约，再登记运行会话。维护操作已开始时登记会失败，租约随即回滚。
     */
    public static boolean tryAcquire(String owner) {
        if (owner == null || !OWNER.compareAndSet(null, owner)) {
            return false;
        }
        if (RuntimeSessionGuard.beginSession(runtimeOwner(owner))) {
            return true;
        }
        OWNER.compareAndSet(owner, null);
        return false;
    }

    /**
     * 只有当前 owner 可以释放租约及对应的运行会话。
     */
    public static boolean release(String owner) {
        if (owner == null || !OWNER.compareAndSet(owner, null)) {
            return false;
        }
        RuntimeSessionGuard.endSession(runtimeOwner(owner));
        return true;
    }

    public static boolean isHeld() {
        return OWNER.get() != null;
    }

    public static boolean isOwnedBy(String owner) {
        return owner != null && owner.equals(OWNER.get());
    }

    private static String runtimeOwner(String owner) {
        return RUNTIME_OWNER_PREFIX + owner;
    }
}
