/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
package com.alipay.hulu.service;

import com.alipay.hulu.common.utils.RuntimeSessionGuard;

import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/** 为控制设备界面的组件提供进程内独占所有权。 */
public final class DeviceControlLease {
    private static final String RUNTIME_OWNER_PREFIX = "device-control:";
    private static final AtomicReference<String> OWNER = new AtomicReference<>();
    private static final AtomicLong OWNER_SEQUENCE = new AtomicLong();

    private DeviceControlLease() {
    }

    public static String newOwner(String source) {
        if (source == null || source.length() == 0) {
            throw new IllegalArgumentException("Device-control owner source is required");
        }
        return source + ":" + OWNER_SEQUENCE.incrementAndGet();
    }

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

    public static boolean isOwnedBy(String owner) {
        return owner != null && owner.equals(OWNER.get());
    }

    public static boolean release(String owner) {
        if (owner == null || !OWNER.compareAndSet(owner, null)) {
            return false;
        }
        RuntimeSessionGuard.endSession(runtimeOwner(owner));
        return true;
    }

    private static String runtimeOwner(String owner) {
        return RUNTIME_OWNER_PREFIX + owner;
    }
}
