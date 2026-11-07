package com.alipay.hulu.virtualscreen;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;
import static org.junit.Assert.*;

public class VirtualActionGuardTest {
    @Test public void rejectsExpiredFutureAndInvalidatedObservations() {
        assertTrue(VirtualActionGuard.observationFresh(1000, 31000, 30000, 2, 2));
        assertFalse(VirtualActionGuard.observationFresh(1000, 31001, 30000, 2, 2));
        assertFalse(VirtualActionGuard.observationFresh(1000, 999, 30000, 2, 2));
        assertFalse(VirtualActionGuard.observationFresh(1000, 1100, 30000, 2, 3));
        assertFalse(VirtualActionGuard.observationFresh(-1, 0, 30000, 2, 2));
    }
    private static final VirtualActionGuard.Box SCREEN = new VirtualActionGuard.Box(0, 0, 100, 200);
    private static final VirtualActionGuard.Box TARGET = new VirtualActionGuard.Box(10, 20, 40, 60);
    private VirtualActionGuard.Node node(String path, boolean enabled, VirtualActionGuard.Box box) {
        return new VirtualActionGuard.Node(path, "订单", "", "id", "Button", box, true, enabled, true, false);
    }
    private VirtualActionGuard.Page page(int display, VirtualActionGuard.Node node, VirtualActionGuard.Window... overlays) {
        java.util.List<VirtualActionGuard.Window> windows = new java.util.ArrayList<VirtualActionGuard.Window>();
        windows.add(new VirtualActionGuard.Window(7, 1, SCREEN)); windows.addAll(Arrays.asList(overlays));
        return new VirtualActionGuard.Page(display, 7, 100, 200, 0, "app.test", windows, Collections.singletonList(node));
    }
    @Test public void acceptsOnlyTheSameVisibleNodeOnTheSameScreen() {
        VirtualActionGuard.Page p = page(3, node("0.1", true, TARGET));
        assertNull(VirtualActionGuard.check(p, page(3, node("0.1", true, TARGET)), "0.1"));
        assertEquals("screen_changed", VirtualActionGuard.check(p, page(4, node("0.1", true, TARGET)), "0.1"));
        assertEquals("stale_observation", VirtualActionGuard.check(p, page(3, node("0.1", false, TARGET)), "0.1"));
        assertEquals("target_unavailable", VirtualActionGuard.check(p, p, "0.2"));
    }
    @Test public void boundFrameRequiresMatchingTreesAndWindows() {
        VirtualActionGuard.Page first = page(3, node("0.1", true, TARGET));
        assertNull(VirtualActionGuard.comparePages(first, page(3, node("0.1", true, TARGET))));
        assertEquals("screen_changed", VirtualActionGuard.comparePages(first, page(4, node("0.1", true, TARGET))));
        assertEquals("stale_observation", VirtualActionGuard.comparePages(first, page(3, node("0.1", false, TARGET))));
        VirtualActionGuard.Window popup = new VirtualActionGuard.Window(8, 2, new VirtualActionGuard.Box(0, 0, 50, 80));
        assertEquals("stale_observation", VirtualActionGuard.comparePages(first, page(3, node("0.1", true, TARGET), popup)));
    }
    @Test public void rejectsOcclusionAndInvalidGeometry() {
        VirtualActionGuard.Window overlay = new VirtualActionGuard.Window(8, 2, new VirtualActionGuard.Box(0, 0, 50, 80));
        VirtualActionGuard.Page covered = page(3, node("0.1", true, TARGET), overlay);
        assertEquals("target_occluded", VirtualActionGuard.check(covered, covered, "0.1"));
        VirtualActionGuard.Page offscreen = page(3, node("0.1", true, new VirtualActionGuard.Box(-1, 0, 20, 30)));
        assertEquals("target_geometry_unknown", VirtualActionGuard.check(offscreen, offscreen, "0.1"));
    }
    @Test public void scrollRequiresAnUnobscuredScrollableNode() {
        VirtualActionGuard.Node scroll = new VirtualActionGuard.Node("0.1", "", "", "id", "ScrollView", TARGET,
                true, true, false, false, true);
        VirtualActionGuard.Page page = page(3, scroll);
        assertNull(VirtualActionGuard.checkScroll(page, page, "0.1"));
        assertEquals("target_unavailable", VirtualActionGuard.check(page, page, "0.1"));
        VirtualActionGuard.Page ordinary = page(3, node("0.1", true, TARGET));
        assertEquals("target_unavailable", VirtualActionGuard.checkScroll(ordinary, ordinary, "0.1"));
        VirtualActionGuard.Window overlay = new VirtualActionGuard.Window(8, 2, new VirtualActionGuard.Box(0, 0, 50, 80));
        VirtualActionGuard.Page covered = page(3, scroll, overlay);
        assertEquals("target_occluded", VirtualActionGuard.checkScroll(covered, covered, "0.1"));
    }
    @Test public void scrollPathRegionContainsGestureAndRejectsOutsideCoordinates() {
        VirtualActionGuard.Box corridor = VirtualActionGuard.scrollPathRegion(SCREEN, 50, 160, 50, 40);
        assertNotNull(corridor);
        assertTrue(corridor.left <= 50 && corridor.right > 50);
        assertTrue(corridor.top <= 40 && corridor.bottom > 160);
        assertTrue(corridor.left > SCREEN.left && corridor.right < SCREEN.right);
        assertNull(VirtualActionGuard.scrollPathRegion(SCREEN, -1, 160, 50, 40));
    }
    @Test public void visualTargetRejectsChangedOrOccludingWindows() {
        VirtualActionGuard.Node label = new VirtualActionGuard.Node("0.1", "", "", "", "View", TARGET,
                true, true, false, false);
        VirtualActionGuard.Page normal = page(3, label);
        assertNull(VirtualActionGuard.checkVisual(normal, normal, TARGET));
        VirtualActionGuard.Window overlay = new VirtualActionGuard.Window(8, 2, new VirtualActionGuard.Box(0, 0, 50, 80));
        VirtualActionGuard.Page covered = page(3, label, overlay);
        assertEquals("target_occluded", VirtualActionGuard.checkVisual(covered, covered, TARGET));
        assertEquals("stale_observation", VirtualActionGuard.checkVisual(normal, covered, TARGET));
        VirtualActionGuard.Page clickable = page(3, node("0.1", true, TARGET));
        assertEquals("target_has_accessible_node", VirtualActionGuard.checkVisual(clickable, clickable, TARGET));
        VirtualActionGuard.Page disabled = page(3, node("0.1", false, TARGET));
        assertEquals("target_disabled", VirtualActionGuard.checkVisual(disabled, disabled, TARGET));
    }
    @Test public void visualScrollAreaRequiresEmptyRootAndRejectsOverlay() {
        VirtualActionGuard.Node empty = new VirtualActionGuard.Node("0", "", "", "", "", SCREEN,
                true, true, false, false);
        VirtualActionGuard.Page plain = page(3, empty);
        VirtualActionGuard.Box area = VirtualActionGuard.visualScrollArea(plain);
        assertNotNull(area);
        assertNull(VirtualActionGuard.checkVisual(plain, plain, area));
        VirtualActionGuard.Window popup = new VirtualActionGuard.Window(8, 2, SCREEN);
        VirtualActionGuard.Page covered = page(3, empty, popup);
        assertEquals("target_occluded", VirtualActionGuard.checkVisual(covered, covered, area));
        assertNull(VirtualActionGuard.visualScrollArea(page(3, node("0", true, SCREEN))));
    }
    @Test public void rejectsPasswordAndChangedWindows() {
        VirtualActionGuard.Node secret = new VirtualActionGuard.Node("0.1", "", "", "id", "EditText", TARGET,
                true, true, true, true);
        VirtualActionGuard.Page p = page(3, secret);
        assertEquals("target_unavailable", VirtualActionGuard.check(p, p, "0.1"));
        VirtualActionGuard.Page normal = page(3, node("0.1", true, TARGET));
        VirtualActionGuard.Window overlay = new VirtualActionGuard.Window(8, 2, new VirtualActionGuard.Box(0, 0, 50, 80));
        assertEquals("stale_observation", VirtualActionGuard.check(normal, page(3, node("0.1", true, TARGET), overlay), "0.1"));
    }
}
