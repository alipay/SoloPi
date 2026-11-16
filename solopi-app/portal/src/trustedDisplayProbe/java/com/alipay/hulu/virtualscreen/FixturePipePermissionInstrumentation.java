package com.alipay.hulu.virtualscreen;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.ProviderInfo;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Parcel;
import android.os.Process;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Checks the pipe is enabled and denies an independent, unprivileged app UID. */
public final class FixturePipePermissionInstrumentation extends Instrumentation {
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }

    @Override public void onStart() {
        Bundle result = new Bundle();
        boolean passed = false;
        String phase = "provider";
        try {
            Context target = getTargetContext();
            String authority = target.getPackageName() + ".fixtureReplyPipe";
            ProviderInfo provider = target.getPackageManager().resolveContentProvider(authority, 0);
            require(provider != null && provider.enabled && provider.exported
                    && "android.permission.DUMP".equals(provider.writePermission), "provider_not_enabled_or_protected");
            phase = "foreign_uid";
            final CountDownLatch connected = new CountDownLatch(1);
            final IBinder[] remote = new IBinder[1];
            ServiceConnection connection = new ServiceConnection() {
                @Override public void onServiceConnected(ComponentName name, IBinder binder) { remote[0] = binder; connected.countDown(); }
                @Override public void onServiceDisconnected(ComponentName name) { remote[0] = null; }
            };
            Intent intent = new Intent().setComponent(new ComponentName(getContext().getPackageName(),
                    "com.alipay.hulu.virtualscreen.ForeignUidProbeService"));
            require(target.bindService(intent, connection, Context.BIND_AUTO_CREATE), "foreign_service_bind_failed");
            try {
                require(connected.await(10, TimeUnit.SECONDS) && remote[0] != null, "foreign_service_unavailable");
                Parcel data = Parcel.obtain(), response = Parcel.obtain();
                try {
                    require(remote[0].transact(IBinder.FIRST_CALL_TRANSACTION + 1, data, response, 0), "probe_transaction_failed");
                    response.readException();
                    require(response.readInt() != Process.myUid(), "foreign_uid_matches_target");
                    require(response.readInt() == 1, "foreign_uid_has_dump");
                    require(response.readInt() == 1, "foreign_uid_not_rejected");
                } finally { data.recycle(); response.recycle(); }
            } finally { target.unbindService(connection); }
            result.putBoolean("providerEnabledAndProtected", true);
            result.putBoolean("foreignUidWithoutDumpRejected", true);
            passed = true;
        } catch (Throwable failure) {
            result.putString("phase", phase);
            result.putString("failure", failure.getClass().getSimpleName());
        }
        finish(passed ? Activity.RESULT_OK : Activity.RESULT_CANCELED, result);
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
