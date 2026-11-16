package com.alipay.hulu.common.tools;

import org.junit.Test;
import static org.junit.Assert.*;

public class TrustedHelperCommandTest {
    private static final String CERT = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    @Test public void onlyFormatsInstalledAppIdentityAndNeverASecret() {
        String cmd = TrustedHelperCommand.create("/data/app/~~abc/com.example.app-a_b==/base.apk", "com.example.app", 10123, CERT);
        assertTrue(cmd.startsWith("shell:CLASSPATH=/data/app/"));
        assertTrue(cmd.endsWith(" com.example.app 10123 " + CERT));
        assertFalse(cmd.contains("nonce"));
    }

    @Test public void rejectsShellSyntaxTraversalAndSystemUid() {
        String[][] bad = {{"/data/app/a/../base.apk", "com.example.app"},
                {"/data/app/a/base.apk;id", "com.example.app"},
                {"/data/app/a/base.apk", "com.example.app;id"},
                {"/sdcard/base.apk", "com.example.app"}};
        for (String[] pair : bad) {
            try { TrustedHelperCommand.create(pair[0], pair[1], 10123, CERT); fail(); }
            catch (IllegalArgumentException expected) { }
        }
        try { TrustedHelperCommand.create("/data/app/a/base.apk", "com.example.app", 2000, CERT); fail(); }
        catch (IllegalArgumentException expected) { }
        try { TrustedHelperCommand.create("/data/app/a/base.apk", "com.example.app", 10123, CERT + ";id"); fail(); }
        catch (IllegalArgumentException expected) { }
    }
}
