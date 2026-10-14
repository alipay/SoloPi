package com.alipay.hulu.service;

import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.accessibility.tree.AccessibilityNodeTree;
import com.alipay.hulu.shared.node.tree.FakeNodeTree;
import com.alipay.hulu.shared.node.tree.OperationNode;

import org.junit.Test;

import static org.junit.Assert.*;

public class HeadlessReplayNodeResolverTest {
    @Test
    public void delayedNextPageIsCapturedUntilFrozenTargetAppears() {
        FixtureSource source = new FixtureSource();
        FakeNodeTree target = tab("首页");
        source.firstRoot = tab("财富");
        source.nextRoot = target;
        source.availableAt = 1200;
        assertSame(target, HeadlessReplayNodeResolver.resolve(selector(), 3000, source));
        assertEquals(1200, source.now);
        assertEquals(13, source.captures);
    }

    @Test
    public void sharedResourceIdCannotSubstituteDifferentText() {
        FixtureSource source = new FixtureSource();
        source.firstRoot = source.nextRoot = tab("财富");
        assertNull(HeadlessReplayNodeResolver.resolve(selector(), 3000, source));
        assertEquals(3000, source.now);
    }

    @Test
    public void ambiguousMatchesFailImmediatelyEvenForZeroBudgetOptionalLookup() {
        FixtureSource source = new FixtureSource();
        FakeNodeTree root = new FakeNodeTree();
        root.addChildNode(tab("首页"));
        root.addChildNode(tab("首页"));
        source.firstRoot = root;
        try {
            HeadlessReplayNodeResolver.resolve(selector(), 0, source);
            fail("Ambiguous nodes must not be chosen or treated as absent");
        } catch (HeadlessReplayNodeResolver.AmbiguousTargetException expected) {
            assertEquals(1, source.captures);
            assertEquals(0, source.waits);
        }
    }

    @Test
    public void zeroBudgetOptionalLookupDoesNotWaitForAbsentTarget() {
        FixtureSource source = new FixtureSource();
        source.firstRoot = tab("财富");
        assertNull(HeadlessReplayNodeResolver.resolve(selector(), 0, source));
        assertEquals(1, source.captures);
        assertEquals(0, source.waits);
    }

    @Test
    public void timeoutNeverAddsAnotherFullPollingInterval() {
        FixtureSource source = new FixtureSource();
        assertNull(HeadlessReplayNodeResolver.resolve(selector(), 250, source));
        assertEquals(250, source.now);
        assertEquals(4, source.captures);
    }

    @Test
    public void explicitLongerWaitBudgetCanObserveDelayedTarget() {
        FixtureSource source = new FixtureSource();
        source.availableAt = 3500;
        source.nextRoot = tab("首页");
        assertNotNull(HeadlessReplayNodeResolver.resolve(selector(), 4000, source));
        assertEquals(3500, source.now);
    }

    @Test
    public void cancellationBeforeLookupDoesNotCapture() {
        FixtureSource source = new FixtureSource();
        source.active = false;
        assertNull(HeadlessReplayNodeResolver.resolve(selector(), 3000, source));
        assertEquals(0, source.captures);
    }

    @Test
    public void leaseLossDuringCaptureRejectsEvenAnExactTarget() {
        FixtureSource source = new FixtureSource();
        source.firstRoot = tab("首页");
        source.cancelDuringCapture = true;
        assertNull(HeadlessReplayNodeResolver.resolve(selector(), 3000, source));
        assertEquals(1, source.captures);
        assertEquals(0, source.waits);
    }

    @Test
    public void interruptedWaitDoesNotCaptureAgain() {
        FixtureSource source = new FixtureSource();
        source.interruptWait = true;
        assertNull(HeadlessReplayNodeResolver.resolve(selector(), 3000, source));
        assertEquals(1, source.captures);
        assertEquals(1, source.waits);
    }

    @Test
    public void everyDeclaredFieldMustMatchIncludingPackageAndDescription() {
        OperationNode selector = selector();
        FakeNodeTree node = tab("首页");
        assertTrue(HeadlessReplayNodeResolver.matchesDeclaredFields(selector, node));
        node.setPackageName("another.app");
        assertFalse(HeadlessReplayNodeResolver.matchesDeclaredFields(selector, node));
        node.setPackageName("target.app");
        selector.setDescription("指定描述");
        assertFalse(HeadlessReplayNodeResolver.matchesDeclaredFields(selector, node));
        node.setDescription("指定描述");
        assertTrue(HeadlessReplayNodeResolver.matchesDeclaredFields(selector, node));
    }

    @Test
    public void imageAndPureXpathKeepTheirExistingLocator() {
        OperationNode selector = selector();
        assertTrue(HeadlessReplayNodeResolver.supports(selector));
        selector.setNodeType("CaptureTree");
        assertFalse(HeadlessReplayNodeResolver.supports(selector));
        OperationNode xpath = new OperationNode();
        xpath.setXpath("/android.widget.FrameLayout[1]");
        xpath.setClassName("android.widget.FrameLayout");
        assertFalse(HeadlessReplayNodeResolver.supports(xpath));
    }

    @Test
    public void disabledAndInvisibleNodesCannotReceiveActionsButAssertionsCanReadThem() {
        AccessibilityNodeTree disabled = new AccessibilityNodeTree(null, null);
        disabled.setVisible(true);
        assertFalse(HeadlessReplayNodeResolver.isActionEligible(disabled, PerformActionEnum.CLICK));
        assertFalse(HeadlessReplayNodeResolver.isActionEligible(disabled, PerformActionEnum.INPUT));
        assertTrue(HeadlessReplayNodeResolver.isActionEligible(disabled, PerformActionEnum.ASSERT));
        FakeNodeTree invisible = tab("首页");
        invisible.setVisible(false);
        assertFalse(HeadlessReplayNodeResolver.isActionEligible(invisible, PerformActionEnum.CLICK));
        assertTrue(HeadlessReplayNodeResolver.isActionEligible(invisible, PerformActionEnum.CHECK_NODE));
    }

    @Test
    public void enabledVisibleLabelCanStillBeClickedThroughItsParent() {
        AccessibilityNodeTree label = new AccessibilityNodeTree(null, null) {
            @Override public boolean isEnabled() { return true; }
        };
        label.setVisible(true);
        label.setClickable(false);
        assertTrue(HeadlessReplayNodeResolver.isActionEligible(label, PerformActionEnum.CLICK));
        label.setVisible(false);
        assertFalse(HeadlessReplayNodeResolver.isActionEligible(label, PerformActionEnum.CLICK));
    }

    private static OperationNode selector() {
        OperationNode selector = new OperationNode();
        selector.setText("首页");
        selector.setResourceId("target.app:id/tab_description");
        selector.setClassName("android.widget.TextView");
        selector.setPackageName("target.app");
        return selector;
    }

    private static FakeNodeTree tab(String text) {
        FakeNodeTree node = new FakeNodeTree();
        node.setText(text);
        node.setResourceId("target.app:id/tab_description");
        node.setClassName("android.widget.TextView");
        node.setPackageName("target.app");
        return node;
    }

    private static final class FixtureSource implements HeadlessReplayNodeResolver.Source {
        AbstractNodeTree firstRoot;
        AbstractNodeTree nextRoot;
        long availableAt = Long.MAX_VALUE;
        long now;
        int captures;
        int waits;
        boolean active = true;
        boolean cancelDuringCapture;
        boolean interruptWait;
        @Override public AbstractNodeTree capture() {
            captures++;
            if (cancelDuringCapture) { active = false; }
            return now >= availableAt ? nextRoot : firstRoot;
        }
        @Override public boolean canContinue() { return active; }
        @Override public long nowMs() { return now; }
        @Override public boolean await(long delayMs) {
            waits++;
            if (interruptWait) { return false; }
            now += delayMs;
            return true;
        }
    }
}
