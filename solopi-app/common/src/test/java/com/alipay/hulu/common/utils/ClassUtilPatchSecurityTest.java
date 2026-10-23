package com.alipay.hulu.common.utils;

import com.alipay.hulu.common.constant.Constant;
import com.alipay.hulu.common.utils.patch.PatchLoadResult;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.lang.reflect.Method;
import java.util.Collections;
import java.util.Map;

import static org.junit.Assert.*;

public class ClassUtilPatchSecurityTest {
    private int logLevel;

    @Before public void muteAndroidLogging() {
        logLevel = LogUtil.LOG_LEVEL;
        LogUtil.LOG_LEVEL = Integer.MAX_VALUE;
    }

    @After public void clearState() throws Exception {
        java.lang.reflect.Field field = ClassUtil.class.getDeclaredField("mPatchInfo");
        field.setAccessible(true);
        ((Map<?, ?>) field.get(null)).clear();
        LogUtil.LOG_LEVEL = logLevel;
    }

    @Test public void cachedHotPatchNameCannotBypassSignatureCheck() throws Exception {
        PatchLoadResult untrusted = new PatchLoadResult();
        untrusted.name = Constant.HOTPATCH_NAME;
        untrusted.root = "/nonexistent/unsigned-patch";
        initialize(untrusted);
        assertNotSame(untrusted, ClassUtil.getPatchInfo(untrusted.name));
        assertNull(ClassUtil.getPatchInfo(untrusted.name).root);
    }

    @Test public void builtInPlaceholderStillLoads() throws Exception {
        Method method = ClassUtil.class.getDeclaredMethod("loadDefaultHotPatch");
        method.setAccessible(true);
        PatchLoadResult builtIn = (PatchLoadResult) method.invoke(null);
        initialize(builtIn);
        assertSame(builtIn, ClassUtil.getPatchInfo(Constant.HOTPATCH_NAME));
    }

    @Test public void directInstallAlsoRejectsUnsignedMetadata() {
        PatchLoadResult untrusted = new PatchLoadResult();
        untrusted.name = "unsigned-direct";
        untrusted.root = "/nonexistent/unsigned-patch";
        ClassUtil.installPatch(untrusted);
        assertNull(ClassUtil.getPatchInfo(untrusted.name));
    }

    private static void initialize(PatchLoadResult patch) throws Exception {
        Method method = ClassUtil.class.getDeclaredMethod("initPatches", java.util.List.class);
        method.setAccessible(true);
        method.invoke(null, Collections.singletonList(patch));
    }
}
