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

import android.util.Base64;

import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;

/** Verifies signatures for executable SoloPi patch packages before they are loaded. */
public final class PatchSignatureVerifier {
    public static final String KEY_ID = "solopi-patch-2026-v1";
    public static final String ALGORITHM = "SHA256withRSA";
    public static final String SIGNATURE_FILE = "manifest.sig";
    private static final String TRUSTED_PUBLIC_KEY =
            "MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAtSMhfpq0oDbmFSgKOKGuEWugtQRORRXtdogCowiT6tpP8RmsccwaFXI27j/UsGfpHd1tpxwwSFIY2d3XxbDO80Ee/HESq9Vk/iOU62OB+X23JJtQ7Gu9HuULhlZbv+vKQXYPD4vknq9qSCEwwCHRJR8mmzs0NdfC4ceF1AeHU0JWRJGQIf2aEyX/BdAhVdhLqEwAHDoSu4tSTX1eoMVuAKsYEYiJ7cbkzFDkITbJy7dIWMR1F6fWW1yIl9RvJBQepkpbHFA2ryAkAXSILx+SldPsYqjLThQOc4SUFMnn1vrwGRNrCiyAzWzYNgCYVm/XDUQ9hQajTca+ChpMJVXNaFGuCOtceCDhGWnmJYGY7OxLfVgRlI3BRvqKQiJvVuOY/QnY/gd9tbUZLsfw9hY0I4UgsuEA0qyHD8ih/miKypQnKfmSMaB2ZmTP9WSVTySpoQhsgrF0K/NBL0oPlW7/aa2zoboXyup66ut3abAng/nrlU2PrAhVxWnXWWp/Udn9AgMBAAE=";

    private PatchSignatureVerifier() {
    }

    public static boolean verify(byte[] content, byte[] signature) {
        try {
            return verify(content, signature, Base64.decode(TRUSTED_PUBLIC_KEY, Base64.DEFAULT));
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
}
