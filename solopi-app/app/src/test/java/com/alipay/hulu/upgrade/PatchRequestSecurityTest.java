/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
package com.alipay.hulu.upgrade;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

/** Verifies that startup never consumes a previously configured custom patch source. */
public class PatchRequestSecurityTest {
    @Test
    public void startupUsesOnlyTheOfficialPatchSource() {
        assertEquals(PatchRequest.DEFAULT_PATCH_URL, PatchRequest.getStartupPatchUrl());
    }
}
