package com.alipay.hulu.virtualscreen;

import android.app.Instrumentation;
import android.app.Activity;
import android.content.Context;
import android.content.ComponentName;
import android.content.Intent;
import android.content.ServiceConnection;
import android.hardware.display.DisplayManager;
import android.media.ImageReader;
import android.graphics.PixelFormat;
import android.os.Binder;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Process;
import android.os.Parcel;
import android.os.SystemClock;
import com.alipay.hulu.common.tools.CmdTools;
import com.cgutman.adblib.AdbStream;
import com.cgutman.adblib.AdbConnection;
import com.cgutman.adblib.AdbCrypto;
import java.io.File;
import java.lang.reflect.Field;
import java.net.Socket;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Isolated debug instrumentation: no content or handoff secrets are printed. */
public final class TrustedDisplayHandshakeInstrumentation extends Instrumentation {
    private boolean ownerDeathProbe;
    @Override public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        ownerDeathProbe = arguments != null && "true".equals(arguments.getString("owner_death"));
        start();
    }

    @Override public void onStart() {
        Bundle result = new Bundle();
        TrustedDisplayAttachProvider.Pending pending = null;
        AdbStream wrong = null, valid = null, replay = null;
        ImageReader reader = null;
        ITrustedDisplayHelper helper = null;
        AdbConnection testConnection = null;
        byte[] secret = null, incorrect = null;
        boolean released = false;
        boolean succeeded = false;
        String phase = "context";
        try {
            Context context = getTargetContext();
            phase = "adb_connect";
            // Instrumentation starts before LauncherApplication.onCreate on some devices.
            // Reuse the app's existing authorized key without generating or changing it.
            File privateKey = new File(context.getFilesDir(), "privKey");
            File publicKey = new File(context.getFilesDir(), "pubKey");
            require(privateKey.isFile() && publicKey.isFile(), "existing_adb_key_unavailable");
            AdbCrypto crypto = AdbCrypto.loadAdbKeyPair(CmdTools.getBase64Impl(), privateKey, publicKey);
            testConnection = AdbConnection.create(new Socket("127.0.0.1", 5555), crypto);
            testConnection.connect(10000);
            Field connectionField = CmdTools.class.getDeclaredField("connection");
            connectionField.setAccessible(true);
            connectionField.set(null, testConnection);
            phase = "identity";
            TrustedAppIdentity identity = TrustedAppIdentity.read(context, context.getPackageName());
            require(identity.uid == Process.myUid(), "app_uid_mismatch");
            pending = TrustedDisplayAttachProvider.begin();
            phase = "wrong_secret";
            secret = pending.secretForPrivateTransport(); incorrect = secret.clone(); incorrect[0] ^= 1;
            wrong = CmdTools.startTrustedDisplayHelper(identity.apkPath, identity.packageName, identity.uid,
                    identity.certificateSha256, incorrect);
            require(waitClosed(wrong, 10000), "wrong_secret_helper_did_not_exit");
            phase = "valid_helper";
            valid = CmdTools.startTrustedDisplayHelper(identity.apkPath, identity.packageName, identity.uid,
                    identity.certificateSha256, secret);
            IBinder remote = pending.await();
            phase = "replay";
            helper = ITrustedDisplayHelper.Stub.asInterface(remote);
            require(helper != null, "helper_unavailable");
            replay = CmdTools.startTrustedDisplayHelper(identity.apkPath, identity.packageName, identity.uid,
                    identity.certificateSha256, secret);
            require(waitClosed(replay, 10000), "replayed_secret_helper_did_not_exit");
            phase = "wrong_owner";
            reader = ImageReader.newInstance(720, 1280, PixelFormat.RGBA_8888, 2);
            try { helper.create(reader.getSurface(), 720, 1280, 320, new Binder()); throw new AssertionError("unbound_owner_accepted"); }
            catch (IllegalArgumentException expected) { }
            phase = "create_display";
            int display = helper.create(reader.getSurface(), 720, 1280, 320, pending.ownerToken());
            require(display > 0, "display_not_created");
            DisplayManager manager = (DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE);
            require(manager != null && manager.getDisplay(display) != null, "display_not_visible");
            phase = "foreign_uid";
            int foreignMask = probeForeignUid(context, getContext().getPackageName(), helper.asBinder(), display);
            require(foreignMask == 15, "foreign_uid_not_rejected");
            require(manager.getDisplay(display) != null, "foreign_uid_changed_display");
            result.putBoolean("foreignUidRejected", true);
            if (ownerDeathProbe) {
                Bundle ready = new Bundle();
                ready.putInt("ownedDisplayId", display);
                sendStatus(1, ready);
                Thread.sleep(2000);
                // The host verifies that the shell helper removes the display after this app process dies.
                Process.killProcess(Process.myPid());
                throw new AssertionError("process_kill_returned");
            }
            try { helper.release(display + 1); throw new AssertionError("foreign_display_accepted"); }
            catch (SecurityException expected) { }
            helper.release(display); released = true;
            require(manager.getDisplay(display) == null, "display_release_unconfirmed");
            helper.shutdown();
            require(waitClosed(valid, 10000), "helper_exit_unconfirmed");
            result.putBoolean("wrongSecretRejected", true);
            result.putBoolean("replayRejected", true);
            result.putBoolean("wrongOwnerRejected", true);
            result.putBoolean("wrongDisplayRejected", true);
            result.putBoolean("createdAndReleased", true);
            result.putBoolean("helperExited", true);
            succeeded = true;
        } catch (Throwable failure) {
            result.putString("failure", failure.getClass().getSimpleName());
            result.putString("phase", phase);
            if (valid != null) {
                result.putBoolean("helperStreamClosed", valid.isClosed());
                boolean helperFailed = false;
                for (byte[] chunk : valid.getReadQueue()) {
                    if (chunk != null && new String(chunk).contains("trusted_helper_failed")) helperFailed = true;
                }
                result.putBoolean("helperReportedFailure", helperFailed);
            }
        } finally {
            if (helper != null && !released) try { helper.cleanup(); helper.shutdown(); }
            catch (Exception ignored) { result.putBoolean("cleanupUnconfirmed", true); succeeded = false; }
            if (reader != null) reader.close();
            if (pending != null) pending.close();
            if (secret != null) Arrays.fill(secret, (byte) 0);
            if (incorrect != null) Arrays.fill(incorrect, (byte) 0);
            CmdTools.closeTrustedDisplayHelper(wrong);
            CmdTools.closeTrustedDisplayHelper(replay);
            CmdTools.closeTrustedDisplayHelper(valid);
            if (testConnection != null) try { testConnection.close(); } catch (Exception ignored) { }
        }
        finish(succeeded ? Activity.RESULT_OK : Activity.RESULT_CANCELED, result);
    }

    private static boolean waitClosed(AdbStream stream, long timeoutMs) throws InterruptedException {
        long until = SystemClock.elapsedRealtime() + timeoutMs;
        while (!stream.isClosed() && SystemClock.elapsedRealtime() < until) Thread.sleep(50);
        return stream.isClosed();
    }
    private static int probeForeignUid(Context context, String testPackage, IBinder helper, int display) throws Exception {
        final CountDownLatch connected = new CountDownLatch(1);
        final IBinder[] remote = new IBinder[1];
        ServiceConnection connection = new ServiceConnection() {
            @Override public void onServiceConnected(ComponentName name, IBinder binder) { remote[0] = binder; connected.countDown(); }
            @Override public void onServiceDisconnected(ComponentName name) { remote[0] = null; }
        };
        Intent intent = new Intent().setComponent(new ComponentName(testPackage,
                "com.alipay.hulu.virtualscreen.ForeignUidProbeService"));
        require(context.bindService(intent, connection, Context.BIND_AUTO_CREATE), "foreign_service_bind_failed");
        try {
            require(connected.await(10, TimeUnit.SECONDS) && remote[0] != null, "foreign_service_unavailable");
            Parcel data = Parcel.obtain(), result = Parcel.obtain();
            try {
                data.writeStrongBinder(helper); data.writeInt(display);
                require(remote[0].transact(IBinder.FIRST_CALL_TRANSACTION, data, result, 0), "foreign_service_transaction_failed");
                result.readException();
                int uid = result.readInt();
                require(uid != Process.myUid(), "foreign_service_uid_matches_owner");
                return result.readInt();
            } finally { data.recycle(); result.recycle(); }
        } finally { context.unbindService(connection); }
    }
    private static void require(boolean value, String failure) { if (!value) throw new AssertionError(failure); }
}
