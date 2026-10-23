package com.alipay.hulu.common.utils;

import com.alipay.hulu.common.utils.patch.PatchLoadResult;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.nio.file.Files;
import java.util.Base64;
import static org.junit.Assert.*;

public class InstalledPatchSecurityTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private int logLevel;

    @Before public void muteLogging() {
        logLevel = LogUtil.LOG_LEVEL;
        LogUtil.LOG_LEVEL = Integer.MAX_VALUE;
    }
    @After public void restoreLogging() { LogUtil.LOG_LEVEL = logLevel; }

    @Test public void acceptsAuthenticInstalledDescriptor() throws Exception {
        assertTrue(PatchProcessUtil.isTrustedInstalledPatch(signedPatch()));
    }

    @Test public void rejectsUnsignedPatch() throws Exception {
        PatchLoadResult patch = signedPatch();
        Files.delete(new File(patch.root, "manifest.sig").toPath());
        assertFalse(PatchProcessUtil.isTrustedInstalledPatch(patch));
    }

    @Test public void rejectsExecutablePathNotCoveredBySignedDescriptor() throws Exception {
        PatchLoadResult patch = signedPatch();
        patch.jarPath = new File(patch.root, "unsigned.dex").getPath();
        assertFalse(PatchProcessUtil.isTrustedInstalledPatch(patch));
    }

    @Test public void rejectsNativePathNotCoveredBySignedDescriptor() throws Exception {
        PatchLoadResult patch = signedPatch();
        patch.soPath = new File(patch.root, "untrusted-lib").getPath();
        assertFalse(PatchProcessUtil.isTrustedInstalledPatch(patch));
    }

    @Test public void rejectsUnsignedEntryPointAndDependencies() throws Exception {
        PatchLoadResult patch = signedPatch();
        patch.entryClass = "untrusted.Entry";
        assertFalse(PatchProcessUtil.isTrustedInstalledPatch(patch));
        patch.entryClass = null;
        patch.dependencies = java.util.Collections.singletonList("unsigned-dependency");
        assertFalse(PatchProcessUtil.isTrustedInstalledPatch(patch));
    }

    private PatchLoadResult signedPatch() throws Exception {
        File root = temporary.newFolder();
        Files.write(new File(root, "desc.json").toPath(),
                Base64.getDecoder().decode(PatchSignatureVerifierTest.PRODUCTION_VECTOR_CONTENT));
        Files.write(new File(root, "manifest.sig").toPath(),
                Base64.getDecoder().decode(PatchSignatureVerifierTest.PRODUCTION_VECTOR_SIGNATURE));
        PatchLoadResult patch = new PatchLoadResult();
        patch.name = "trust-vector";
        patch.root = root.getCanonicalPath();
        return patch;
    }
}
