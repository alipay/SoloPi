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
package com.alipay.hulu.common.scheme;

import android.net.Uri;
import android.os.Bundle;

import com.alipay.hulu.common.application.LauncherApplication;

/**
 * Explicit ADB-only entry point protected by android.permission.DUMP.
 */
public final class AdbSchemeActivity extends SchemeActivity {
    private boolean agentRequest;
    private boolean headlessReplayRequest;
    private boolean backgroundHarnessRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        Uri uri = getIntent().getData();
        String scheme = uri == null ? null : uri.getScheme();
        String authority = uri == null ? null : uri.getAuthority();
        String path = uri == null ? null : uri.getPath();
        agentRequest = isAgentRequest(scheme, authority, path);
        String headless = uri == null ? null : uri.getQueryParameter("headless");
        headlessReplayRequest = isHeadlessReplayRequest(scheme, authority, path, headless);
        String harnessType = uri == null ? null : uri.getQueryParameter("type");
        backgroundHarnessRequest = isBackgroundHarnessRequest(scheme, authority, path, harnessType);
        LauncherApplication application = LauncherApplication.getInstance();
        boolean initialized = application != null && application.hasFinishInit();
        boolean resolverReady = application != null && application.getSchemeResolver() != null
                && application.getSchemeResolver().containsKey("agent");
        boolean replayResolverReady = application != null && application.getSchemeResolver() != null
                && application.getSchemeResolver().containsKey("replay");
        boolean harnessResolverReady = application != null && application.getSchemeResolver() != null
                && application.getSchemeResolver().containsKey("harness");
        // Code security: preserve the DUMP-protected entry and all non-Agent flows.
        // NoDisplay is safe only when synchronous dispatch can finish before onResume.
        if (canRunWithoutWindow(scheme, authority, path, initialized, resolverReady)
                || canReplayWithoutWindow(scheme, authority, path, headless, initialized, replayResolverReady)
                || canHarnessRunWithoutWindow(scheme, authority, path, harnessType, initialized, harnessResolverReady)) {
            setTheme(android.R.style.Theme_NoDisplay);
        }
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onSchemeDispatchFinished(String action) {
        if ((agentRequest && "agent".equals(action))
                || (headlessReplayRequest && "replay".equals(action))
                || (backgroundHarnessRequest && "harness".equals(action))) {
            finish();
        }
    }

    static boolean isAgentRequest(String scheme, String authority, String path) {
        return "solopi".equals(scheme) && "startaction".equals(authority)
                && "/agent".equals(path);
    }

    static boolean canRunWithoutWindow(String scheme, String authority, String path,
                                       boolean initialized, boolean resolverReady) {
        return initialized && resolverReady && isAgentRequest(scheme, authority, path);
    }

    static boolean isHeadlessReplayRequest(String scheme, String authority, String path, String headless) {
        return "solopi".equals(scheme) && "startaction".equals(authority)
                && "/replay".equals(path) && "true".equalsIgnoreCase(headless);
    }

    static boolean canReplayWithoutWindow(String scheme, String authority, String path, String headless,
                                           boolean initialized, boolean resolverReady) {
        return initialized && resolverReady && isHeadlessReplayRequest(scheme, authority, path, headless);
    }

    static boolean isBackgroundHarnessRequest(String scheme, String authority, String path, String type) {
        // Code security: only these noninteractive operations use the existing DUMP-protected entry.
        return "solopi".equals(scheme) && "startaction".equals(authority) && "/harness".equals(path)
                && ("case-import".equals(type) || "cancel".equals(type));
    }

    static boolean canHarnessRunWithoutWindow(String scheme, String authority, String path, String type,
                                              boolean initialized, boolean resolverReady) {
        return initialized && resolverReady && isBackgroundHarnessRequest(scheme, authority, path, type);
    }
}
