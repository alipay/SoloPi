package com.alipay.hulu.scheme;

import android.util.DisplayMetrics;
import com.alibaba.fastjson.JSONObject;
import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;
import static org.junit.Assert.*;

public class AgentTargetContextAndroidTest {
    @Test
    public void smallMenuNeedsUniqueActiveFocusedApplicationWindow() {
        DisplayMetrics metrics = new DisplayMetrics();
        metrics.widthPixels = 1080;
        metrics.heightPixels = 2400;
        JSONObject page = new JSONObject();
        page.put("packageName", "com.example.orders");
        AgentTargetContextGuard.Box bounds = new AgentTargetContextGuard.Box(146, 980, 934, 1488);
        page.put("nodeBound", bounds.json());
        AgentTargetContextGuard.Window menu = menu(1, true, true, "com.example.orders");
        assertTrue(AgentTargetContextAndroid.activeApplicationWindow(page, metrics, 7,
                Collections.singletonList(menu), "com.alipay.hulu"));
        for (AgentTargetContextGuard.Window invalid : Arrays.asList(
                menu(2, true, true, "com.example.orders"), // input method
                menu(3, true, true, "com.example.orders"), // system window
                menu(1, false, true, "com.example.orders"),
                menu(1, true, false, "com.example.orders"),
                menu(1, true, true, "com.example.other"))) {
            assertFalse(AgentTargetContextAndroid.activeApplicationWindow(page, metrics, 7,
                    Collections.singletonList(invalid), "com.alipay.hulu"));
        }
        assertFalse(AgentTargetContextAndroid.activeApplicationWindow(page, metrics, 8,
                Collections.singletonList(menu), "com.alipay.hulu"));
        assertFalse(AgentTargetContextAndroid.activeApplicationWindow(page, metrics, 7,
                Arrays.asList(menu, menu), "com.alipay.hulu"));
        assertFalse(AgentTargetContextAndroid.activeApplicationWindow(page, metrics, 7,
                null, "com.alipay.hulu"));
        page.put("packageName", "com.alipay.hulu");
        assertFalse(AgentTargetContextAndroid.activeApplicationWindow(page, metrics, 7,
                Collections.singletonList(menu(1, true, true, "com.alipay.hulu")), "com.alipay.hulu"));
    }

    private static AgentTargetContextGuard.Window menu(int type, boolean active, boolean focused, String pkg) {
        return new AgentTargetContextGuard.Window(7, type, 2, active, focused,
                new AgentTargetContextGuard.Box(146, 980, 934, 1488), pkg);
    }

    @Test
    public void changedTargetOrWindowsPreventNativeDispatch() throws Exception {
        Click source = new Click();
        source.target = false;
        assertFalse(AgentTargetContextAndroid.dispatch(source, new Guard()));
        assertEquals(0, source.calls);
        source.target = true;
        source.windows = false;
        assertFalse(AgentTargetContextAndroid.dispatch(source, new Guard()));
        assertEquals(0, source.calls);
    }

    @Test
    public void cancellationBetweenWindowCheckAndDispatchPreventsAction() throws Exception {
        Click source = new Click();
        Guard guard = new Guard();
        guard.cancelAt = 2;
        try {
            AgentTargetContextAndroid.dispatch(source, guard);
            fail("Cancellation must stop dispatch");
        } catch (AgentUiWaiter.AbortedException expected) {
            assertEquals(0, source.calls);
        }
    }

    @Test
    public void nativeRejectionDoesNotRetryOrFallback() throws Exception {
        Click source = new Click();
        source.nativeResult = false;
        assertFalse(AgentTargetContextAndroid.dispatch(source, new Guard()));
        assertEquals(1, source.calls);
    }

    @Test
    public void validNativeClickDispatchesOnceAfterBothGuards() throws Exception {
        Click source = new Click();
        Guard guard = new Guard();
        assertTrue(AgentTargetContextAndroid.dispatch(source, guard));
        assertEquals(1, source.calls);
        assertEquals(2, guard.checks);
    }

    private static final class Click implements AgentTargetContextAndroid.NativeClick {
        boolean target = true, windows = true, nativeResult = true;
        int calls;
        public boolean refreshTarget() { return target; }
        public boolean verifyWindows() { return windows; }
        public boolean perform() { calls++; return nativeResult; }
    }

    private static final class Guard implements AgentUiWaiter.Guard {
        int checks, cancelAt;
        public void check() {
            if (++checks == cancelAt) { throw new AgentUiWaiter.AbortedException(); }
        }
    }
}
