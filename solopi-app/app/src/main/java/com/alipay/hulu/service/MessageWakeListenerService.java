package com.alipay.hulu.service;

import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import com.alipay.hulu.BuildConfig;

import java.util.LinkedHashMap;
import java.util.Map;

/** Converts notifications into content-free wake-up signals. */
public final class MessageWakeListenerService extends NotificationListenerService {
    private static final NotificationWakeState STATE = new NotificationWakeState(BuildConfig.DEBUG);

    @Override public void onListenerConnected() {
        super.onListenerConnected();
        STATE.connected();
    }

    @Override public void onListenerDisconnected() {
        STATE.disconnected();
        super.onListenerDisconnected();
    }

    @Override public void onDestroy() {
        STATE.disconnected();
        super.onDestroy();
    }

    @Override public void onNotificationPosted(StatusBarNotification notification) {
        if (notification != null) STATE.posted(notification.getPackageName());
    }

    public static Map<String, Object> status() {
        NotificationWakeState.Snapshot snapshot = STATE.snapshot();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("available", snapshot.available);
        result.put("epoch", snapshot.epoch);
        result.put("sequence", snapshot.sequence);
        return result;
    }
}
