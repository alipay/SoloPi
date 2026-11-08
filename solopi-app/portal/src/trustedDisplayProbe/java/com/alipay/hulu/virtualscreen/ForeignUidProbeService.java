package com.alipay.hulu.virtualscreen;

import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Binder;
import android.os.IBinder;
import android.os.Parcel;
import android.os.Process;
import android.os.RemoteException;

/** Test-only service that exercises the real Binder from a different package UID. */
public final class ForeignUidProbeService extends Service {
    private static final String DESCRIPTOR = "com.alipay.hulu.virtualscreen.ITrustedDisplayHelper";
    private final Binder probe = new Binder() {
        @Override protected boolean onTransact(int code, Parcel data, Parcel reply, int flags) throws RemoteException {
            if (code != FIRST_CALL_TRANSACTION && code != FIRST_CALL_TRANSACTION + 1)
                return super.onTransact(code, data, reply, flags);
            // Code security: the test service only accepts a Binder from its own instrumented app.
            String testPackage = getPackageName();
            if (!testPackage.endsWith(".test")) throw new SecurityException("invalid_probe_package");
            try {
                int targetUid = getPackageManager().getApplicationInfo(
                        testPackage.substring(0, testPackage.length() - ".test".length()), 0).uid;
                if (Binder.getCallingUid() != targetUid) throw new SecurityException("probe_caller_mismatch");
            } catch (android.content.pm.PackageManager.NameNotFoundException unavailable) {
                throw new SecurityException("probe_target_unavailable");
            }
            if (code == FIRST_CALL_TRANSACTION + 1) {
                boolean noDump = checkPermission("android.permission.DUMP", Process.myPid(), Process.myUid())
                        != PackageManager.PERMISSION_GRANTED;
                boolean rejected = false;
                long identity = Binder.clearCallingIdentity();
                try {
                    String target = testPackage.substring(0, testPackage.length() - ".test".length());
                    try (java.io.OutputStream stream = getContentResolver().openOutputStream(
                            Uri.parse("content://" + target + ".fixtureReplyPipe/write"), "w")) {
                        // An opened pipe is a failed test even if no bytes are sent.
                    } catch (SecurityException expected) { rejected = true; }
                    catch (java.io.IOException unavailable) { /* Not proof of permission denial. */ }
                } finally { Binder.restoreCallingIdentity(identity); }
                reply.writeNoException();
                reply.writeInt(Process.myUid());
                reply.writeInt(noDump ? 1 : 0);
                reply.writeInt(rejected ? 1 : 0);
                return true;
            }
            IBinder helper = data.readStrongBinder();
            int displayId = data.readInt();
            int rejected = 0;
            long identity = Binder.clearCallingIdentity();
            try {
                for (int index = 0; index < 4; index++) if (rejectsCaller(helper, index, displayId)) rejected |= 1 << index;
            } finally { Binder.restoreCallingIdentity(identity); }
            reply.writeNoException();
            reply.writeInt(Process.myUid());
            reply.writeInt(rejected);
            return true;
        }
    };

    private static boolean rejectsCaller(IBinder helper, int method, int displayId) throws RemoteException {
        Parcel request = Parcel.obtain(), result = Parcel.obtain();
        try {
            request.writeInterfaceToken(DESCRIPTOR);
            if (method == 0) {
                request.writeInt(0); // no Surface: a caller check must precede argument checks
                request.writeInt(720); request.writeInt(1280); request.writeInt(320);
                request.writeStrongBinder(new Binder());
            } else if (method == 1) request.writeInt(displayId);
            helper.transact(IBinder.FIRST_CALL_TRANSACTION + method, request, result, 0);
            try { result.readException(); return false; }
            catch (SecurityException rejected) { return "trusted_display_caller_mismatch".equals(rejected.getMessage()); }
            catch (RuntimeException other) { return false; }
        } finally { request.recycle(); result.recycle(); }
    }

    @Override public IBinder onBind(Intent intent) { return probe; }
}
