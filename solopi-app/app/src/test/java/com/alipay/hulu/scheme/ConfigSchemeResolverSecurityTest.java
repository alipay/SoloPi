/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
package com.alipay.hulu.scheme;

import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.utils.Callback;

import org.junit.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/** Covers the scheme boundary that protects mutable configuration. */
public class ConfigSchemeResolverSecurityTest {
    @Test
    public void httpContextCannotChangePatchSource() {
        Map<String, String> params = new HashMap<>();
        params.put("action", "set");
        params.put("key", SPService.KEY_PATCH_URL);
        params.put("value", "https://attacker.invalid/patches/<abi>.json");
        RecordingCallback callback = new RecordingCallback();

        boolean handled = new ConfigSchemeResolver().processScheme(null, params, callback);

        assertTrue(handled);
        assertFalse((Boolean) callback.result.get("success"));
        assertEquals("mutation_transport_required", callback.result.get("errorCode"));
    }

    @Test
    public void legacyHttpMutationFormIsAlsoRejected() {
        Map<String, String> params = new HashMap<>();
        params.put("key", SPService.KEY_PATCH_URL);
        params.put("value", "https://attacker.invalid/patches/<abi>.json");
        RecordingCallback callback = new RecordingCallback();

        boolean handled = new ConfigSchemeResolver().processScheme(null, params, callback);

        assertTrue(handled);
        assertFalse((Boolean) callback.result.get("success"));
        assertEquals("mutation_transport_required", callback.result.get("errorCode"));
    }

    private static final class RecordingCallback implements Callback<Map<String, Object>> {
        private Map<String, Object> result;

        @Override
        public void onResult(Map<String, Object> item) {
            result = item;
        }

        @Override
        public void onFailed() {
            throw new AssertionError("Config resolver unexpectedly failed without a result");
        }
    }
}
