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

import org.junit.Test;

import java.nio.charset.Charset;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.util.Base64;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/** Covers the detached signature primitive used before executable patch loading. */
public class PatchSignatureVerifierTest {
    private static final Charset UTF_8 = Charset.forName("UTF-8");
    static final String PRODUCTION_VECTOR_CONTENT =
            "eyJuYW1lIjoidHJ1c3QtdmVjdG9yIiwidmVyc2lvbiI6MX0=";
    static final String PRODUCTION_VECTOR_SIGNATURE =
            "mT2eQJDM+oRVllC+x+J7lZs/xlvXACiU2ZiUWYtcpKpyXNZzC5BaCxShmnDP4pPLne9rnmZPqM9Hil4YyWq5GcV2AC1TEREbSO4r7az+H37bMGwrhpqUpb0itTupipz0F7hHxXMXZmG4rnYpdLWZeDX2p7cnznHJ1NGg5kJ+xSTDOAdReD02g6iOFel+fKK/uoyxTcuoZcXK0kkWXqvbTeSVb6APLx89dqsRfVy3kPjis6SxqHsF6jD7vYghGIBo3nbUi0whEKkv0qrlULdYmCoZn3/5FZxeWw6Msnw16fSDx+Mtj4C2c4gKO+cL7DOmnb4AcsSFjFK2i1VpYNjHeuDOyOTXBgJVNxtxp3IXvd//Vmqy21SsA1V+sAKULXg3mkFweLK0ZSkknl6J8Vi4iNqB9C5KLLRQwV1IawtLpiIYaaT/2ZMlrvn0g95XMxFWut5pA0nupcWM+kJq6wb2pzSEVMfmBSl11vEtaV5uH7V+oFOZ9xKtHIGsfsb0AD+3";

    @Test
    public void acceptsProductionKeyTestVector() {
        assertTrue(PatchSignatureVerifier.verify(Base64.getDecoder().decode(PRODUCTION_VECTOR_CONTENT),
                Base64.getDecoder().decode(PRODUCTION_VECTOR_SIGNATURE)));
    }

    @Test
    public void acceptsSignatureFromMatchingKey() throws Exception {
        KeyPair pair = pair();
        byte[] content = "signed patch descriptor".getBytes(UTF_8);

        assertTrue(PatchSignatureVerifier.verify(content, sign(pair, content),
                pair.getPublic().getEncoded()));
    }

    @Test
    public void rejectsModifiedDescriptorAndWrongKey() throws Exception {
        KeyPair pair = pair();
        byte[] content = "signed patch descriptor".getBytes(UTF_8);
        byte[] signature = sign(pair, content);

        assertFalse(PatchSignatureVerifier.verify("changed descriptor".getBytes(UTF_8),
                signature, pair.getPublic().getEncoded()));
        assertFalse(PatchSignatureVerifier.verify(content, signature,
                pair().getPublic().getEncoded()));
    }

    private static KeyPair pair() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        return generator.generateKeyPair();
    }

    private static byte[] sign(KeyPair pair, byte[] content) throws Exception {
        Signature signer = Signature.getInstance(PatchSignatureVerifier.ALGORITHM);
        signer.initSign(pair.getPrivate());
        signer.update(content);
        return signer.sign();
    }
}
