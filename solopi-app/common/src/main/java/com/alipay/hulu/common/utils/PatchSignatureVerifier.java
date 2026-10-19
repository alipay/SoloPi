/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.alipay.hulu.common.utils;

import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;

/** Verifies signatures for executable SoloPi patch packages before they are loaded. */
public final class PatchSignatureVerifier {
    public static final String KEY_ID = "solopi-patch-2026-v1";
    public static final String ALGORITHM = "SHA256withRSA";
    public static final String SIGNATURE_FILE = "manifest.sig";
    // X.509 SubjectPublicKeyInfo DER, represented in hex to keep this verifier JVM-testable.
    private static final String TRUSTED_PUBLIC_KEY_HEX =
            "308201a2300d06092a864886f70d01010105000382018f003082018a0282018100b523217e9ab4a036e615280a38a1ae116ba0b5044e4515ed768802a30893eada4ff119ac71cc1a157236ee3fd4b067e91ddd6da71c30485218d9ddd7c5b0cef3411efc7112abd564fe2394eb6381f97db7249b50ec6bbd1ee50b86565bbfebca41760f0f8be49eaf6a482130c021d1251f269b3b3435d7c2e1c785d4078753425644919021fd9a1325ff05d02155d84ba84c001c3a12bb8b524d7d5ea0c56e00ab18118889edc6e4cc50e42136c9cbb74858c47517a7d65b5c8897d46f24141ea64a5b1c5036af20240174882f1f9295d3ec62a8cb4e140e73849414c9e7d6faf019136b0a2c80cd6cd8360098566fd70d443d8506a34dc6be0a1a4c2555cd6851ae08eb5c7820e11969e6258198ecec4b7d5811948dc146fa8a42226f56e398fd09d8fe077db5b5192ec7f0f61634238520b2e100d2ac870fc8a1fe688aca942729f99231a0766664cff564954f24a9a1086c82b1742bf3412f4a0f956eff69adb3a1ba17caea7aeaeb7769b02783f9eb954d8fac0855c569d7596a7f51d9fd0203010001";

    private PatchSignatureVerifier() {
    }

    public static boolean verify(byte[] content, byte[] signature) {
        try {
            return verify(content, signature, decodeHex(TRUSTED_PUBLIC_KEY_HEX));
        } catch (Exception e) {
            LogUtil.e("PatchSignature", e, "Unable to verify patch signature");
            return false;
        }
    }

    static boolean verify(byte[] content, byte[] signature, byte[] encodedPublicKey) throws Exception {
        if (content == null || content.length == 0 || signature == null || signature.length == 0) {
            return false;
        }
        PublicKey publicKey = KeyFactory.getInstance("RSA")
                .generatePublic(new X509EncodedKeySpec(encodedPublicKey));
        Signature verifier = Signature.getInstance(ALGORITHM);
        verifier.initVerify(publicKey);
        verifier.update(content);
        return verifier.verify(signature);
    }

    private static byte[] decodeHex(String value) {
        byte[] result = new byte[value.length() / 2];
        for (int i = 0; i < result.length; i++) {
            result[i] = (byte) Integer.parseInt(value.substring(i * 2, i * 2 + 2), 16);
        }
        return result;
    }
}
