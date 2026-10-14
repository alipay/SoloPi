package com.alipay.hulu.service;

import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.OperationNode;
import com.alipay.hulu.shared.node.tree.capture.CaptureTree;
import com.alipay.hulu.shared.node.tree.accessibility.tree.AccessibilityNodeTree;

/** Bounded, read-only target lookup for computer-controlled fixed replay. */
final class HeadlessReplayNodeResolver {
    private static final long POLL_INTERVAL_MS = 100L;

    interface Source {
        AbstractNodeTree capture();
        boolean canContinue();
        long nowMs();
        boolean await(long delayMs);
    }

    static final class AmbiguousTargetException extends IllegalStateException {
        AmbiguousTargetException() { super("Headless replay target is not unique"); }
    }

    private HeadlessReplayNodeResolver() { }

    static boolean supports(OperationNode selector) {
        if (selector == null || CaptureTree.class.getSimpleName().equals(selector.getNodeType())) {
            return false;
        }
        // Pure XPath/image recordings retain their existing locator. Typed selectors use
        // all their declared fields together, never the legacy partial-match ranking.
        return present(selector.getResourceId()) || present(selector.getText())
                || present(selector.getDescription())
                || (!present(selector.getXpath())
                    && (present(selector.getClassName()) || present(selector.getPackageName())));
    }

    static AbstractNodeTree resolve(OperationNode selector, long timeoutMs, Source source) {
        long start = source.nowMs();
        long budget = Math.max(0L, timeoutMs);
        while (source.canContinue()) {
            AbstractNodeTree root = source.capture();
            // Code security: a cancellation or released lease during capture must stop before action.
            if (!source.canContinue()) {
                return null;
            }
            AbstractNodeTree match = null;
            if (root != null) {
                for (AbstractNodeTree node : root) {
                    if (matchesDeclaredFields(selector, node)) {
                        if (match != null) {
                            throw new AmbiguousTargetException();
                        }
                        match = node;
                    }
                }
            }
            if (match != null) {
                return match;
            }
            long elapsed = Math.max(0L, source.nowMs() - start);
            if (elapsed >= budget || !source.await(Math.min(POLL_INTERVAL_MS, budget - elapsed))) {
                return null;
            }
        }
        return null;
    }

    static boolean matchesDeclaredFields(OperationNode selector, AbstractNodeTree node) {
        return selector != null && node != null
                && matches(selector.getPackageName(), node.getPackageName())
                && matches(selector.getClassName(), node.getClassName())
                && matches(selector.getResourceId(), node.getResourceId())
                && matches(selector.getText(), node.getText())
                && matches(selector.getDescription(), node.getDescription());
    }

    static boolean isActionEligible(AbstractNodeTree node, PerformActionEnum action) {
        if (node == null) {
            return false;
        }
        // Assertions/reads may intentionally inspect a disabled control. A text child need
        // not itself be clickable, since fixed replay can click its enabled parent.
        if (action == PerformActionEnum.ASSERT || action == PerformActionEnum.CHECK_NODE
                || action == PerformActionEnum.LET_NODE || action == PerformActionEnum.SLEEP_UNTIL) {
            return true;
        }
        return node.isVisible() && (!(node instanceof AccessibilityNodeTree)
                || ((AccessibilityNodeTree) node).isEnabled());
    }

    private static boolean matches(String expected, String actual) {
        return !present(expected) || expected.equals(actual);
    }

    private static boolean present(String value) {
        return value != null && !value.isEmpty();
    }
}
