/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
package com.alipay.hulu.common.http;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

/** Verifies that the control-plane listener is not reachable from the LAN. */
public class HttpServerSecurityTest {
    @Test
    public void controlServerBindsOnlyToLoopback() {
        HttpServer server = new HttpServer(23342);

        assertEquals("127.0.0.1", server.getHostname());
    }
}
