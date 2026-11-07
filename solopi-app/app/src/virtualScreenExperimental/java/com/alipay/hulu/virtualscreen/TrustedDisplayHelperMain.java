package com.alipay.hulu.virtualscreen;

import android.content.AttributionSource;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.pm.ProviderInfo;
import android.hardware.display.DisplayManager;
import android.os.Binder;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Process;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.security.MessageDigest;
import java.util.Arrays;

/** Shell-only entry point. ADB stdin carries the one-time handoff secret. */
public final class TrustedDisplayHelperMain {
    private static final String SHELL = "com.android.shell";

    private static final class ShellContext extends ContextWrapper {
        ShellContext(Context base) { super(base); }
        @Override public String getPackageName() { return SHELL; }
        @Override public String getOpPackageName() { return SHELL; }
        @Override public Context getApplicationContext() { return this; }
        @Override public AttributionSource getAttributionSource() {
            return new AttributionSource.Builder(Process.myUid()).setPackageName(SHELL).build();
        }
    }

    public static void main(String[] args) {
        byte[] nonce = null;
        try {
            if (Process.myUid() != 2000 || args == null || args.length != 3
                    || !args[0].matches("[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)+")
                    || !args[1].matches("[0-9]{5,10}") || !args[2].matches("[0-9a-f]{64}"))
                throw new IllegalArgumentException("invalid_helper_invocation");
            int uid = Integer.parseInt(args[1]);
            if (uid < 10000) throw new IllegalArgumentException("invalid_helper_owner");
            nonce = readNonce();
            Looper.prepareMainLooper();
            Class<?> activityThread = Class.forName("android.app.ActivityThread");
            Object thread = activityThread.getMethod("systemMain").invoke(null);
            Context base = (Context) activityThread.getDeclaredMethod("getSystemContext").invoke(thread);
            Context context = new ShellContext(base);
            TrustedAppIdentity identity = TrustedAppIdentity.read(context, args[0]);
            // Code security: verify the installed package, UID, signing certificate and loaded APK before handing off Binder.
            if (identity.uid != uid || !identity.apkPath.equals(System.getProperty("java.class.path"))
                    || !MessageDigest.isEqual(identity.certificateSha256.getBytes("US-ASCII"), args[2].getBytes("US-ASCII")))
                throw new SecurityException("trusted_app_identity_changed");
            Constructor<DisplayManager> constructor = DisplayManager.class.getDeclaredConstructor(Context.class);
            constructor.setAccessible(true);
            DisplayManager manager = constructor.newInstance(context);
            final Handler worker = new Handler(Looper.getMainLooper());
            final Runnable exit = new Runnable() {
                @Override public void run() { Looper.myLooper().quitSafely(); }
            };
            final TrustedDisplayHelperService service = new TrustedDisplayHelperService(uid, manager, worker, exit);
            IBinder owner = attach(context, identity, service, nonce);
            Arrays.fill(nonce, (byte) 0); nonce = null;
            service.bindOwner(owner);
            worker.postDelayed(new Runnable() {
                @Override public void run() { if (service.stopIfUnclaimed()) exit.run(); }
            }, 20000L);
            Looper.loop();
        } catch (Exception failure) {
            // Code security: no token, app content, arguments or exception payload is written to logs.
            System.err.println("trusted_helper_failed");
        } finally {
            if (nonce != null) Arrays.fill(nonce, (byte) 0);
        }
    }

    private static byte[] readNonce() throws Exception {
        byte[] wire = new byte[65], result = new byte[32];
        try {
            for (int i = 0; i < wire.length; i++) {
                int value = System.in.read();
                if (value < 0) throw new IllegalArgumentException("invalid_helper_nonce");
                wire[i] = (byte) value;
            }
            if (wire[64] != '\n') throw new IllegalArgumentException("invalid_helper_nonce");
            for (int i = 0; i < result.length; i++) {
                int hi = Character.digit((char) wire[2 * i], 16), lo = Character.digit((char) wire[2 * i + 1], 16);
                if (hi < 0 || lo < 0) throw new IllegalArgumentException("invalid_helper_nonce");
                result[i] = (byte) ((hi << 4) | lo);
            }
            return result;
        } catch (Exception e) {
            Arrays.fill(result, (byte) 0);
            throw e;
        } finally { Arrays.fill(wire, (byte) 0); }
    }

    /** Uses the shell-only external-provider API; no app data or screenshots cross this channel. */
    private static IBinder attach(Context context, TrustedAppIdentity identity, IBinder helper, byte[] nonce) throws Exception {
        String authority = identity.packageName + ".trustedDisplayAttach";
        Object am = Class.forName("android.app.ActivityManager").getMethod("getService").invoke(null);
        IBinder providerToken = new Binder();
        int userId = identity.uid / 100000;
        Object holder = am.getClass().getMethod("getContentProviderExternal", String.class, int.class,
                IBinder.class, String.class).invoke(am, authority, userId, providerToken, "SoloPiTrusted");
        if (holder == null) throw new IllegalStateException("trusted_provider_unavailable");
        try {
            ProviderInfo info = (ProviderInfo) holder.getClass().getField("info").get(holder);
            if (info == null || info.applicationInfo == null || !identity.packageName.equals(info.packageName)
                    || info.applicationInfo.uid != identity.uid || !info.exported
                    || !"android.permission.DUMP".equals(info.readPermission)
                    || !"android.permission.DUMP".equals(info.writePermission))
                throw new SecurityException("trusted_provider_identity_mismatch");
            Object provider = holder.getClass().getField("provider").get(holder);
            Bundle extras = new Bundle(); extras.putBinder("binder", helper); extras.putByteArray("secret", nonce);
            AttributionSource caller = new AttributionSource.Builder(Process.myUid()).setPackageName(SHELL).build();
            Method selected = null;
            for (Method method : provider.getClass().getMethods()) {
                Class<?>[] types = method.getParameterTypes();
                if ("call".equals(method.getName()) && types.length == 5 && types[0] == AttributionSource.class) {
                    selected = method; break;
                }
            }
            if (selected == null) throw new IllegalStateException("trusted_provider_api_unavailable");
            selected.setAccessible(true);
            Bundle result = (Bundle) selected.invoke(provider, caller, authority, "attachTrustedDisplay", null, extras);
            if (result == null || !result.getBoolean("accepted")) throw new SecurityException("trusted_handoff_rejected");
            IBinder owner = result.getBinder("ownerToken");
            if (owner == null || !owner.isBinderAlive()) throw new IllegalStateException("trusted_owner_unavailable");
            return owner;
        } finally {
            try { am.getClass().getMethod("removeContentProviderExternalAsUser", String.class, IBinder.class, int.class)
                    .invoke(am, authority, providerToken, userId); }
            catch (Exception ignored) { }
        }
    }

    private TrustedDisplayHelperMain() { }
}
