package com.alipay.hulu.virtualscreen;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** Identity is read from Android's package manager, not from IPC arguments. */
final class TrustedAppIdentity {
    final String packageName, apkPath, certificateSha256;
    final int uid;

    private TrustedAppIdentity(String packageName, String apkPath, int uid, String certificateSha256) {
        this.packageName = packageName; this.apkPath = apkPath; this.uid = uid; this.certificateSha256 = certificateSha256;
    }

    @SuppressWarnings("deprecation")
    static TrustedAppIdentity read(Context context, String packageName) throws PackageManager.NameNotFoundException {
        if (context == null || packageName == null) throw new IllegalArgumentException("invalid_trusted_app");
        PackageInfo info = context.getPackageManager().getPackageInfo(packageName, PackageManager.GET_SIGNATURES);
        Signature[] signatures = info.signatures;
        if (info.applicationInfo == null || info.applicationInfo.uid < 10000 || info.applicationInfo.sourceDir == null
                || !packageName.equals(info.packageName) || signatures == null || signatures.length != 1)
            throw new IllegalStateException("trusted_app_identity_unavailable");
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray());
            char[] hex = "0123456789abcdef".toCharArray(), output = new char[digest.length * 2];
            for (int i = 0; i < digest.length; i++) {
                output[i * 2] = hex[(digest[i] & 0xff) >>> 4]; output[i * 2 + 1] = hex[digest[i] & 0x0f];
            }
            return new TrustedAppIdentity(packageName, info.applicationInfo.sourceDir, info.applicationInfo.uid, new String(output));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("trusted_app_digest_unavailable");
        }
    }
}
