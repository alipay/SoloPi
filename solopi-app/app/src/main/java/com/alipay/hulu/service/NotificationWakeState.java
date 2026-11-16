package com.alipay.hulu.service;

import java.util.UUID;

/** A wake-up counter only; notification content is never retained. */
final class NotificationWakeState {
    private static final String ALLOWED_PACKAGE = "com.tencent.mm";
    private static final String CONTROLLED_PACKAGE = "com.solopi.fastpath.demo";
    private static final String REPLY_FIXTURE_PACKAGE = "com.solopi.fastpath.replyfixture";
    private final boolean allowControlledPackage;
    private boolean connected;
    private String epoch = UUID.randomUUID().toString();
    private long sequence;

    NotificationWakeState(boolean allowControlledPackage) {
        this.allowControlledPackage = allowControlledPackage;
    }

    synchronized void connected() {
        epoch = UUID.randomUUID().toString();
        sequence = 0;
        connected = true;
    }

    synchronized void disconnected() {
        connected = false;
        epoch = UUID.randomUUID().toString();
        sequence = 0;
    }

    synchronized void posted(String packageName) {
        if (connected && (ALLOWED_PACKAGE.equals(packageName)
                || (allowControlledPackage && (CONTROLLED_PACKAGE.equals(packageName)
                    || REPLY_FIXTURE_PACKAGE.equals(packageName))))) {
            if (sequence == Long.MAX_VALUE) {
                epoch = UUID.randomUUID().toString();
                sequence = 0;
            }
            sequence++;
        }
    }

    synchronized Snapshot snapshot() {
        return new Snapshot(connected, epoch, sequence);
    }

    static final class Snapshot {
        final boolean available;
        final String epoch;
        final long sequence;

        Snapshot(boolean available, String epoch, long sequence) {
            this.available = available;
            this.epoch = epoch;
            this.sequence = sequence;
        }
    }
}
