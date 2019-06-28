/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * 	http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.alipay.hulu.common.utils;

import com.alipay.hulu.common.service.SPService;

import java.nio.charset.Charset;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Created by lezhou.wyl on 2018/8/28.
 */

public class AESUtils {
    /**
     * 根据默认配置的Seed加密
     * @param cleartext
     * @return
     * @throws Exception
     */
    public static String encrypt(String cleartext) throws Exception {
        String seed = SPService.getString(SPService.KEY_AES_KEY, "com.alipay.hulu");
        return encrypt(cleartext, seed);
    }

    /**
     * 根据默认配置的Seed解密
     * @param encrypted
     * @return
     * @throws Exception
     */
    public static String decrypt(String encrypted) throws Exception {
        String seed = SPService.getString(SPService.KEY_AES_KEY, "com.alipay.hulu");
        return decrypt(encrypted, seed);
    }

    /**
     * 根据seed加密clearText
     * @param cleartext
     * @param seed
     * @return
     * @throws Exception
     */
    public static String encrypt(String cleartext, String seed) throws Exception {
        // 如果没有设置seed，不加密
        if (StringUtil.isEmpty(seed)) {
            return cleartext;
        }

        byte[] rawKey = deriveKeyInsecurely(seed,32).getEncoded();
        byte[] result = encrypt(rawKey, cleartext.getBytes());
        return toHex(result);
    }

    /**
     * 根据seed解密encrypted
     * @param seed
     * @param encrypted
     * @return
     * @throws Exception
     */
    public static String decrypt(String encrypted, String seed) throws Exception {
        // 如果没有设置seed，不解密
        if (StringUtil.isEmpty(seed)) {
            return encrypted;
        }

        byte[] rawKey = deriveKeyInsecurely(seed,32).getEncoded();
        byte[] enc = toByte(encrypted);
        byte[] result = decrypt(rawKey, enc);
        return new String(result);
    }

    private static SecretKey deriveKeyInsecurely(String password, int
            keySizeInBytes) {
        byte[] passwordBytes = password.getBytes(Charset.forName("US-ASCII"));
        return new SecretKeySpec(
                InsecureSHA1PRNGKeyDerivator.deriveInsecureKey(
                        passwordBytes, keySizeInBytes),
                "AES");
    }
    private static byte[] encrypt(byte[] raw, byte[] clear) throws Exception {
        SecretKeySpec skeySpec = new SecretKeySpec(raw, "AES");
        Cipher cipher = Cipher.getInstance("AES");
        cipher.init(Cipher.ENCRYPT_MODE, skeySpec, new IvParameterSpec(new byte[cipher.getBlockSize()]));
        byte[] encrypted = cipher.doFinal(clear);
        return encrypted;
    }
    private static byte[] decrypt(byte[] raw, byte[] encrypted) throws Exception {
        SecretKeySpec skeySpec = new SecretKeySpec(raw, "AES");
        Cipher cipher = Cipher.getInstance("AES");
        cipher.init(Cipher.DECRYPT_MODE, skeySpec, new IvParameterSpec(new byte[cipher.getBlockSize()]));
        byte[] decrypted = cipher.doFinal(encrypted);
        return decrypted;
    }
    private static String toHex(String txt) {
        return toHex(txt.getBytes());
    }
    private static String fromHex(String hex) {
        return new String(toByte(hex));
    }
    private static byte[] toByte(String hexString) {
        int len = hexString.length() / 2;
        byte[] result = new byte[len];
        for (int i = 0; i < len; i++)
            result[i] = Integer.valueOf(hexString.substring(2 * i, 2 * i + 2), 16).byteValue();
        return result;
    }
    private static String toHex(byte[] buf) {
        if (buf == null)
            return "";
        StringBuffer result = new StringBuffer(2 * buf.length);
        for (int i = 0; i < buf.length; i++) {
            appendHex(result, buf[i]);
        }
        return result.toString();
    }
    private final static String HEX = "0123456789ABCDEF";
    private static void appendHex(StringBuffer sb, byte b) {
        sb.append(HEX.charAt((b >> 4) & 0x0f)).append(HEX.charAt(b & 0x0f));
    }

}
