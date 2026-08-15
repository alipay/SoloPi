package com.alipay.hulu.scheme;

import android.util.DisplayMetrics;

import com.alibaba.fastjson.JSONObject;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class AgentSessionSchemeResolverTest {
    @Test
    public void controllablePageRejectsControlAppAndNarrowSystemWindows() {
        DisplayMetrics metrics = metrics(1080, 2400);

        assertFalse(AgentSessionSchemeResolver.isControllablePage(
                page("com.alipay.hulu", 0, 0, 1080, 2400), metrics, "com.alipay.hulu"));
        assertFalse(AgentSessionSchemeResolver.isControllablePage(
                page("com.android.systemui", 0, 0, 1080, 132), metrics, "com.alipay.hulu"));
        assertTrue(AgentSessionSchemeResolver.isControllablePage(
                page("com.example.counter", 0, 0, 1080, 2400), metrics, "com.alipay.hulu"));
    }

    @Test
    public void pageSignatureIgnoresObjectInsertionOrder() {
        JSONObject firstBounds = new JSONObject();
        firstBounds.put("left", 0);
        firstBounds.put("right", 1080);
        JSONObject first = new JSONObject();
        first.put("packageName", "com.example.counter");
        first.put("nodeBound", firstBounds);

        JSONObject secondBounds = new JSONObject();
        secondBounds.put("right", 1080);
        secondBounds.put("left", 0);
        JSONObject second = new JSONObject();
        second.put("nodeBound", secondBounds);
        second.put("packageName", "com.example.counter");

        assertTrue(AgentSessionSchemeResolver.signature(first)
                .equals(AgentSessionSchemeResolver.signature(second)));
    }

    @Test
    public void settleRequiresAChangedSignatureToBecomeStable() {
        assertFalse(AgentSessionSchemeResolver.hasSettled("before", "before", "before"));
        assertFalse(AgentSessionSchemeResolver.hasSettled("before", "before", "after"));
        assertTrue(AgentSessionSchemeResolver.hasSettled("before", "after", "after"));
    }

    private static DisplayMetrics metrics(int width, int height) {
        DisplayMetrics metrics = new DisplayMetrics();
        metrics.widthPixels = width;
        metrics.heightPixels = height;
        return metrics;
    }

    private static JSONObject page(String packageName, int left, int top, int right, int bottom) {
        JSONObject bounds = new JSONObject();
        bounds.put("left", left);
        bounds.put("top", top);
        bounds.put("right", right);
        bounds.put("bottom", bottom);
        JSONObject page = new JSONObject();
        page.put("packageName", packageName);
        page.put("nodeBound", bounds);
        return page;
    }
}
