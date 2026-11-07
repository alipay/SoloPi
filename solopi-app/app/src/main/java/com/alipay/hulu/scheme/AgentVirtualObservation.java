package com.alipay.hulu.scheme;

import android.graphics.Bitmap;
import android.os.SystemClock;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.virtualscreen.VirtualActionGuard;
import com.alipay.hulu.virtualscreen.VirtualAgentSession;
import com.alipay.hulu.virtualscreen.VirtualOcrEngine;
import com.alipay.hulu.virtualscreen.VirtualOcrTargetGuard;

import java.io.File;
import java.io.FileOutputStream;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** A device-collected page and frame, with a private node-ID mapping for later actions. */
final class AgentVirtualObservation {
    final String virtualObservationId;
    final String signature;
    final Map<String, Object> evidence;
    final Map<String, String> nodePaths;
    final VirtualActionGuard.Page guardPage;
    final List<VirtualOcrTargetGuard.Line> ocrLines;
    final VirtualOcrEngine.Result ocrResult;

    private AgentVirtualObservation(String id, String signature, Map<String, Object> evidence,
                                    Map<String, String> nodePaths, VirtualActionGuard.Page guardPage,
                                    List<VirtualOcrTargetGuard.Line> ocrLines, VirtualOcrEngine.Result ocrResult) {
        this.virtualObservationId = id;
        this.signature = signature;
        this.evidence = evidence;
        this.nodePaths = Collections.unmodifiableMap(nodePaths);
        this.guardPage = guardPage;
        this.ocrLines = Collections.unmodifiableList(ocrLines);
        this.ocrResult = ocrResult;
    }

    static AgentVirtualObservation capture(VirtualAgentSession session, String sessionId,
                                           AgentEvidenceStore store) throws Exception {
        return capture(session, sessionId, store, true);
    }

    static AgentVirtualObservation capture(VirtualAgentSession session, String sessionId,
                                           AgentEvidenceStore store, boolean includeOcr) throws Exception {
        return capture(session, sessionId, store, includeOcr, null);
    }

    static AgentVirtualObservation capture(VirtualAgentSession session, String sessionId,
                                           AgentEvidenceStore store, boolean includeOcr,
                                           AgentVirtualObservation previous) throws Exception {
        long captureStarted = SystemClock.elapsedRealtime();
        VirtualAgentSession.BoundObservation bound = session.observeWithFrame();
        long observeFrameMs = SystemClock.elapsedRealtime() - captureStarted;
        File file = null;
        boolean saved = false;
        boolean transferredToOcr = false;
        try {
            Encoded page = encode(bound.observation.snapshot.guardPage);
            String signature = AgentSessionSchemeResolver.signature(page.page);
            file = store.artifactFile(sessionId, "virtual-observation-" + UUID.randomUUID() + ".png");
            long pngStarted = SystemClock.elapsedRealtime();
            FileOutputStream output = null;
            try {
                output = new FileOutputStream(file);
                if (!bound.frame.bitmap.compress(Bitmap.CompressFormat.PNG, 100, output))
                    throw new IllegalStateException("virtual_screenshot_failed");
                output.flush();
            } finally {
                if (output != null) output.close();
            }
            long pngWriteMs = SystemClock.elapsedRealtime() - pngStarted;
            Map<String, Object> evidence = new LinkedHashMap<>();
            evidence.put("screenMode", "virtual");
            evidence.put("displayId", page.displayId);
            evidence.put("windowId", page.windowId);
            evidence.put("screenWidth", page.width);
            evidence.put("screenHeight", page.height);
            evidence.put("rotation", page.rotation);
            JSONArray windows = new JSONArray();
            for (VirtualActionGuard.Window window : bound.observation.snapshot.guardPage.windows) {
                JSONObject item = new JSONObject(true);
                item.put("id", window.id); item.put("layer", window.layer);
                JSONObject bounds = new JSONObject(true);
                bounds.put("left", window.bounds.left); bounds.put("top", window.bounds.top);
                bounds.put("right", window.bounds.right); bounds.put("bottom", window.bounds.bottom);
                item.put("bounds", bounds); windows.add(item);
            }
            evidence.put("windows", windows);
            evidence.put("frameGeneration", bound.frame.generation);
            evidence.put("frameSequence", bound.frame.sequence);
            evidence.put("frameUptimeMs", bound.frame.uptimeMs);
            evidence.put("treeSha256", signature);
            evidence.put("page", page.page);
            evidence.put("screenshotPath", file.getAbsolutePath());
            evidence.put("screenshotSha256", AgentEvidenceStore.sha256(file));
            evidence.put("timelinePath", store.timelinePath(sessionId));
            Map<String, Object> timing = new LinkedHashMap<>();
            timing.put("screenCreateMs", session.screenCreateMs() >= 0 ? session.screenCreateMs() : null);
            timing.put("launchSubmitMs", session.launchSubmitMs() >= 0 ? session.launchSubmitMs() : null);
            timing.put("observeFrameMs", observeFrameMs);
            timing.put("pngWriteMs", pngWriteMs);
            timing.put("ocrAndRevalidationMs", null);
            VirtualOcrEngine.Result recognized = null;
            if (!includeOcr) {
                evidence.put("ocrSkipped", true);
            } else if (session.hasOcr()) {
                long ocrStarted = SystemClock.elapsedRealtime();
                final CountDownLatch completed = new CountDownLatch(1);
                final AtomicReference<VirtualOcrEngine.Result> ocrResult = new AtomicReference<>();
                final AtomicReference<String> ocrError = new AtomicReference<>();
                try {
                    if (reusableOcr(previous, signature, (String) evidence.get("screenshotSha256"), bound.observation.snapshot.guardPage)) {
                        VirtualOcrEngine.Result cached = previous.ocrResult;
                        // Code security: identical full-frame pixels and page identity are required;
                        // rebind to this observation and repeat the current-frame/window checks.
                        VirtualOcrEngine.Result rebound = new VirtualOcrEngine.Result(bound.frame.generation,
                                bound.frame.sequence, bound.frame.sequence, false, "revalidate", cached.lines);
                        try {
                            VirtualOcrEngine.Result checked = session.revalidateOcr(bound, rebound);
                            if (verifiedOcr(checked)) { recognized = checked; evidence.put("ocrReused", true); }
                        } catch (IllegalStateException stale) { /* Fall back to a new OCR capture. */ }
                    }
                    if (recognized == null) {
                        session.recognize(bound, new VirtualOcrEngine.Callback() {
                            @Override public void onResult(VirtualOcrEngine.Result result) { ocrResult.set(result); completed.countDown(); }
                            @Override public void onError(String error) { ocrError.set(error); completed.countDown(); }
                        });
                        transferredToOcr = true;
                        if (!completed.await(8, TimeUnit.SECONDS)) evidence.put("ocrError", "ocr_timeout");
                        else if (ocrResult.get() == null) evidence.put("ocrError", ocrError.get());
                        else recognized = ocrResult.get();
                    }
                    if (recognized != null) {
                        VirtualOcrEngine.Result value = recognized;
                        if (!value.current) {
                            try { value = session.revalidateOcr(bound, value); }
                            catch (IllegalStateException stale) { evidence.put("ocrRevalidationError", stale.getMessage()); }
                        }
                        recognized = value;
                        evidence.put("ocr", encodeOcr(value, bound.observation.snapshot.guardPage));
                    }
                } catch (IllegalStateException stale) {
                    evidence.put("ocrError", "stale_observation");
                } finally {
                    timing.put("ocrAndRevalidationMs", SystemClock.elapsedRealtime() - ocrStarted);
                }
            } else evidence.put("ocrError", "ocr_unavailable");
            JSONObject ocr = (JSONObject) evidence.get("ocr");
            String progressSignature = progressSignature(signature, ocr);
            if (progressSignature != null) evidence.put("progressSignature", progressSignature);
            timing.put("captureTotalMs", SystemClock.elapsedRealtime() - captureStarted);
            evidence.put("deviceTiming", timing);
            AgentVirtualObservation result = new AgentVirtualObservation(bound.observation.id, signature, evidence,
                    page.nodePaths, bound.observation.snapshot.guardPage, ocrLines((JSONObject) evidence.get("ocr")), recognized);
            saved = true;
            return result;
        } finally {
            // OCR owns the bitmap after submission, including when its callback arrives late.
            if (!transferredToOcr && !bound.frame.bitmap.isRecycled()) bound.frame.bitmap.recycle();
            if (!saved && file != null) file.delete();
        }
    }

    static boolean verifiedOcr(VirtualOcrEngine.Result result) {
        if (result == null || !result.current || !"current".equals(result.freshness)) return false;
        for (VirtualOcrEngine.Line line : result.lines) if (line == null || !line.pixelsMatch) return false;
        return true;
    }

    static boolean reusableOcr(AgentVirtualObservation previous, String signature, String screenshotHash,
                               VirtualActionGuard.Page page) {
        if (previous == null) return false;
        return reusableOcr(previous.signature, (String) previous.evidence.get("screenshotSha256"), previous.guardPage,
                previous.ocrResult, signature, screenshotHash, page);
    }

    static boolean reusableOcr(String previousSignature, String previousHash, VirtualActionGuard.Page previousPage,
                               VirtualOcrEngine.Result previousResult, String signature, String screenshotHash,
                               VirtualActionGuard.Page page) {
        return verifiedOcr(previousResult) && signature != null && signature.equals(previousSignature)
                && screenshotHash != null && screenshotHash.equals(previousHash)
                && VirtualActionGuard.comparePages(previousPage, page) == null;
    }

    static String progressSignature(String treeSignature, JSONObject ocr) {
        JSONArray lines = ocr == null ? null : ocr.getJSONArray("lines");
        if (lines == null) return null;
        List<String> visible = new ArrayList<>();
        for (int i = 0; i < lines.size(); i++) {
            JSONObject line = lines.getJSONObject(i), bounds = line.getJSONObject("bounds");
            String text = line.getString("text");
            if (bounds == null || text == null || text.trim().isEmpty() || !line.getBooleanValue("pixelsMatch")
                    || line.getBooleanValue("protected")) continue;
            visible.add(bounds.getIntValue("left") + ":" + bounds.getIntValue("top") + ":"
                    + bounds.getIntValue("right") + ":" + bounds.getIntValue("bottom") + ":" + text);
        }
        if (visible.isEmpty()) return null;
        Collections.sort(visible);
        return AgentEvidenceStore.sha256(treeSignature + "\n" + com.alibaba.fastjson.JSON.toJSONString(visible));
    }

    private static JSONObject encodeOcr(VirtualOcrEngine.Result result, VirtualActionGuard.Page page) {
        JSONObject encoded = new JSONObject(true);
        encoded.put("frameGeneration", result.frameGeneration);
        encoded.put("frameSequence", result.frameSequence);
        encoded.put("comparedFrameSequence", result.comparedFrameSequence);
        encoded.put("current", result.current);
        encoded.put("freshness", result.freshness);
        encoded.put("requiresActionRevalidation", true);
        JSONArray lines = new JSONArray();
        int index = 0;
        for (VirtualOcrEngine.Line line : result.lines) {
            if (line == null || line.bounds == null || line.text == null) continue;
            boolean protectedRegion = false;
            for (VirtualActionGuard.Node node : page.nodes) {
                if (node.password && node.bounds != null && node.bounds.left < line.bounds.right
                        && node.bounds.right > line.bounds.left && node.bounds.top < line.bounds.bottom
                        && node.bounds.bottom > line.bounds.top) { protectedRegion = true; break; }
            }
            JSONObject item = new JSONObject(true);
            item.put("lineId", "ocr-" + (++index));
            // Code security: never export OCR text overlapping an observed password field.
            item.put("text", protectedRegion ? "" : line.text.substring(0, Math.min(line.text.length(), 4096)));
            JSONObject bounds = new JSONObject(true);
            bounds.put("left", line.bounds.left); bounds.put("top", line.bounds.top);
            bounds.put("right", line.bounds.right); bounds.put("bottom", line.bounds.bottom);
            item.put("bounds", bounds);
            item.put("pixelsMatch", line.pixelsMatch);
            item.put("protected", protectedRegion);
            lines.add(item);
        }
        encoded.put("lines", lines);
        return encoded;
    }

    private static List<VirtualOcrTargetGuard.Line> ocrLines(JSONObject encoded) {
        List<VirtualOcrTargetGuard.Line> result = new ArrayList<>();
        JSONArray lines = encoded == null ? null : encoded.getJSONArray("lines");
        if (lines == null) return result;
        for (int i = 0; i < lines.size(); i++) {
            JSONObject line = lines.getJSONObject(i), bounds = line.getJSONObject("bounds");
            result.add(new VirtualOcrTargetGuard.Line(line.getString("lineId"), line.getString("text"),
                    new VirtualActionGuard.Box(bounds.getIntValue("left"), bounds.getIntValue("top"),
                            bounds.getIntValue("right"), bounds.getIntValue("bottom")),
                    line.getBooleanValue("pixelsMatch"), line.getBooleanValue("protected")));
        }
        return result;
    }

    static Encoded encode(VirtualActionGuard.Page source) {
        if (source == null || source.nodes.isEmpty()) throw new IllegalArgumentException("virtual_page_unavailable");
        Map<String, JSONObject> byPath = new LinkedHashMap<>();
        Map<String, String> nodePaths = new LinkedHashMap<>();
        int sequence = 0;
        JSONObject root = null;
        for (VirtualActionGuard.Node node : source.nodes) {
            if (node == null || node.path == null || node.bounds == null || byPath.containsKey(node.path))
                throw new IllegalArgumentException("invalid_virtual_node");
            String nodeId = "node-" + (++sequence);
            JSONObject entry = new JSONObject(true);
            entry.put("nodeId", nodeId);
            entry.put("text", node.password ? "" : node.text);
            entry.put("description", node.password ? "" : node.description);
            entry.put("resourceId", node.resourceId);
            entry.put("className", node.role);
            entry.put("packageName", source.packageName);
            entry.put("type", "VirtualAccessibilityNode");
            entry.put("visible", node.visible);
            entry.put("enabled", node.enabled);
            entry.put("clickable", node.clickable);
            entry.put("scrollable", node.scrollable);
            entry.put("password", node.password);
            entry.put("isVisibleToUser", node.visible);
            entry.put("isEnabled", node.enabled);
            entry.put("isClickable", node.clickable);
            entry.put("isScrollable", node.scrollable);
            entry.put("isPassword", node.password);
            JSONObject bounds = new JSONObject(true);
            bounds.put("left", node.bounds.left); bounds.put("top", node.bounds.top);
            bounds.put("right", node.bounds.right); bounds.put("bottom", node.bounds.bottom);
            entry.put("nodeBound", bounds);
            entry.put("children", new JSONArray());
            byPath.put(node.path, entry);
            nodePaths.put(nodeId, node.path);
            int dot = node.path.lastIndexOf('.');
            if (dot < 0) {
                if (!"0".equals(node.path) || root != null) throw new IllegalArgumentException("invalid_virtual_root");
                root = entry;
            } else {
                JSONObject parent = byPath.get(node.path.substring(0, dot));
                if (parent == null) throw new IllegalArgumentException("missing_virtual_parent");
                parent.getJSONArray("children").add(entry);
            }
        }
        if (root == null) throw new IllegalArgumentException("missing_virtual_root");
        root.put("packageName", source.packageName);
        return new Encoded(root, nodePaths, source.displayId, source.windowId,
                source.width, source.height, source.rotation);
    }

    static final class Encoded {
        final JSONObject page;
        final Map<String, String> nodePaths;
        final int displayId, windowId, width, height, rotation;
        Encoded(JSONObject page, Map<String, String> paths, int displayId, int windowId,
                int width, int height, int rotation) {
            this.page = page; this.nodePaths = paths; this.displayId = displayId; this.windowId = windowId;
            this.width = width; this.height = height; this.rotation = rotation;
        }
    }
}
