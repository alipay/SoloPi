package com.alipay.hulu.scheme;

import android.util.DisplayMetrics;

import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.JSONArray;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class TrustBenchAgentSessionSchemeResolverTest {
    @Test public void readinessRejectsAnimatedRootEvenWithOnscreenChildren() {
        JSONObject root = page("com.example.trustnotes", 1214, 126, 2254, 2385);
        root.put("visible", true);
        JSONArray children = new JSONArray();
        children.add(content(48, 505, 1108, 649));
        root.put("children", children);
        assertFalse(AgentSessionSchemeResolver.hasConsistentOnscreenContent(root, metrics(1156, 2510)));
        root.put("nodeBound", page("com.example.trustnotes", 0, 0, 1156, 2510).get("nodeBound"));
        assertTrue(AgentSessionSchemeResolver.hasConsistentOnscreenContent(root, metrics(1156, 2510)));
        // A small real dialog remains eligible; native window ownership is checked separately.
        root.put("nodeBound", page("com.example.trustnotes", 30, 450, 1120, 900).get("nodeBound"));
        assertTrue(AgentSessionSchemeResolver.hasConsistentOnscreenContent(root, metrics(1156, 2510)));
    }
    @Test public void nativeDialogOwnerFallbackDoesNotOverrideKnownFocus() {
        String owner = "\n mFocusedApp=ActivityRecord{123 u0 org.fossify.filemanager/.activities.MainActivity t1}";
        assertTrue("org.fossify.filemanager".equals(AgentSessionSchemeResolver.focusedDialogOwner(
                "mCurrentFocus=Window{abc u0 新建}" + owner)));
        assertTrue(AgentSessionSchemeResolver.focusedDialogOwner(
                "mCurrentFocus=Window{abc u0 com.android.systemui/.Panel}" + owner) == null);
        assertTrue(AgentSessionSchemeResolver.focusedDialogOwner(
                "mCurrentFocus=null" + owner) == null);
        assertTrue(AgentSessionSchemeResolver.focusedDialogOwner(
                "mCurrentFocus=Window{abc u0 新建}") == null);
    }
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

    @Test
    public void observationRejectsRedmiOffscreenTransitionDespiteFullscreenRoot() {
        JSONObject root = page("com.example.trustnotes", 0, 0, 1156, 2510);
        root.put("visible", true);
        JSONObject button = content(1257, 580, 2211, 710);
        JSONArray children = new JSONArray();
        children.add(button);
        root.put("children", children);
        assertTrue(AgentSessionSchemeResolver.isControllablePage(
                root, metrics(1156, 2510), "com.alipay.hulu.trustbench"));
        assertFalse(AgentSessionSchemeResolver.isObservationPageReady(
                root, metrics(1156, 2510), "com.alipay.hulu.trustbench"));
        button.put("nodeBound", content(48, 505, 1108, 649).getJSONObject("nodeBound"));
        assertTrue(AgentSessionSchemeResolver.isObservationPageReady(
                root, metrics(1156, 2510), "com.alipay.hulu.trustbench"));
    }

    @Test
    public void observationRequiresVisibleTargetContentWithinParentBounds() {
        JSONObject root = page("com.example.trustnotes", 0, 0, 1156, 2510);
        root.put("visible", true);
        assertFalse(AgentSessionSchemeResolver.isObservationPageReady(
                root, metrics(1156, 2510), "com.alipay.hulu.trustbench"));
        JSONObject button = content(48, 505, 1108, 649);
        JSONArray children = new JSONArray();
        children.add(button);
        root.put("children", children);
        button.put("visible", false);
        assertFalse(AgentSessionSchemeResolver.isObservationPageReady(
                root, metrics(1156, 2510), "com.alipay.hulu.trustbench"));
        button.put("visible", true);
        button.put("packageName", "com.android.systemui");
        assertFalse(AgentSessionSchemeResolver.isObservationPageReady(
                root, metrics(1156, 2510), "com.alipay.hulu.trustbench"));
        button.put("packageName", "com.example.trustnotes");
        root.put("nodeBound", page("com.example.trustnotes", 1200, 0, 2356, 2510)
                .getJSONObject("nodeBound"));
        assertFalse(AgentSessionSchemeResolver.isObservationPageReady(
                root, metrics(1156, 2510), "com.alipay.hulu.trustbench"));
    }

    @Test
    public void initialObservationRequiresTwoConsecutiveIdenticalValidFrames() {
        assertFalse(AgentSessionSchemeResolver.isStableObservation(null, null));
        assertFalse(AgentSessionSchemeResolver.isStableObservation(null, "frame"));
        assertFalse(AgentSessionSchemeResolver.isStableObservation("frame", null));
        assertFalse(AgentSessionSchemeResolver.isStableObservation("moving", "frame"));
        assertTrue(AgentSessionSchemeResolver.isStableObservation("frame", "frame"));
        JSONObject first = content(48, 505, 1108, 649);
        JSONObject moved = content(49, 505, 1109, 649);
        assertFalse(AgentSessionSchemeResolver.isStableObservation(
                AgentSessionSchemeResolver.signature(first),
                AgentSessionSchemeResolver.signature(moved)));
    }

    @Test
    public void initialObservationWaitsForControlForegroundToLeave() {
        assertFalse(AgentSessionSchemeResolver.isObservationForegroundReady(null, "com.alipay.hulu.trustbench"));
        assertFalse(AgentSessionSchemeResolver.isObservationForegroundReady("", "com.alipay.hulu.trustbench"));
        assertFalse(AgentSessionSchemeResolver.isObservationForegroundReady(
                "com.alipay.hulu.trustbench", "com.alipay.hulu.trustbench"));
        assertTrue(AgentSessionSchemeResolver.isObservationForegroundReady(
                "com.example.trustnotes", "com.alipay.hulu.trustbench"));
    }

    private static JSONObject content(int left, int top, int right, int bottom) {
        JSONObject result = page("com.example.trustnotes", left, top, right, bottom);
        result.put("visible", true);
        result.put("isClickable", true);
        result.put("text", "NEW NOTE");
        return result;
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
