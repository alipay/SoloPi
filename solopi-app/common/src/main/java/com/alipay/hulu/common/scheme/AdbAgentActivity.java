package com.alipay.hulu.common.scheme;

import android.app.Activity;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.SortedList;

import java.util.HashMap;
import java.util.Map;

/** DUMP-protected, windowless Agent dispatch in an isolated transient task. */
public final class AdbAgentActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            Uri uri = getIntent().getData();
            LauncherApplication application = LauncherApplication.getInstance();
            Map<String, SortedList<SchemeActionResolver>> resolvers = application == null
                    ? null : application.getSchemeResolver();
            SortedList<SchemeActionResolver> agentResolvers = resolvers == null ? null : resolvers.get("agent");
            // Code security: only the Agent URI is dispatched; DUMP is enforced by Manifest
            // and Agent resolvers retain their exact session/owner checks.
            if (uri == null || !AdbSchemeActivity.canRunWithoutWindow(uri.getScheme(),
                    uri.getAuthority(), uri.getPath(),
                    application != null && application.hasFinishInit(),
                    agentResolvers != null && agentResolvers.size() > 0)) {
                LogUtil.w("AdbAgentActivity", "Agent entry is not ready or the URI is unsupported");
                return;
            }
            Map<String, String> params = new HashMap<>();
            for (String name : uri.getQueryParameterNames()) {
                params.put(name, uri.getQueryParameter(name));
            }
            Callback<Map<String, Object>> callback = new Callback<Map<String, Object>>() {
                @Override
                public void onResult(Map<String, Object> result) {
                    // Results are retrieved through the authenticated typed query endpoints.
                }

                @Override
                public void onFailed() {
                    LogUtil.w("AdbAgentActivity", "Agent dispatch failed");
                }
            };
            for (SchemeActionResolver resolver : agentResolvers) {
                if (resolver.processScheme(this, params, callback)) {
                    return;
                }
            }
        } catch (Throwable error) {
            // Code security: do not log URI parameters or bearer credentials.
            LogUtil.w("AdbAgentActivity", "Unable to dispatch Agent request");
        } finally {
            // Theme_NoDisplay requires completion before onResume, including cold/error paths.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && isTaskRoot()) {
                finishAndRemoveTask();
            } else {
                finish();
            }
        }
    }
}
