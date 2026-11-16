package com.alipay.hulu.scheme;

import com.alipay.hulu.virtualscreen.VirtualActionGuard;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;
import static org.junit.Assert.*;

public class FixtureReplyGuardTest {
    private static final VirtualActionGuard.Box BOX = new VirtualActionGuard.Box(0, 0, 10, 10);
    private static VirtualActionGuard.Node node(String path, String id, String text, String desc,
                                                boolean click, boolean edit) {
        return new VirtualActionGuard.Node(path, text, desc, "com.solopi.fastpath.demo:id/" + id,
                "View", BOX, true, true, click, false, false, edit);
    }
    private static VirtualActionGuard.Page page(String packageName, String contact, String input, boolean outgoing) {
        return page(packageName, contact, input, outgoing, false);
    }
    private static VirtualActionGuard.Page page(String packageName, String contact, String input, boolean outgoing, boolean hint) {
        List<VirtualActionGuard.Node> nodes = new ArrayList<>(Arrays.asList(
                node("0.1", "chat_identity", "contact", contact, false, false),
                node("0.2", "chat_message", "question", "fixture:message:m1:incoming:text:active", false, false),
                new VirtualActionGuard.Node("0.3", input, "", "com.solopi.fastpath.demo:id/chat_input",
                        "EditText", BOX, true, true, false, false, false, true, hint),
                node("0.4", "chat_send", "send", "", true, false)));
        if (outgoing) nodes.add(node("0.5", "chat_message", "reply", "fixture:message:m2:outgoing:text:active", false, false));
        return new VirtualActionGuard.Page(1, 1, 100, 100, 0, packageName,
                Arrays.asList(new VirtualActionGuard.Window(1, 1, new VirtualActionGuard.Box(0, 0, 100, 100))), nodes);
    }
    @Test public void requiresUniqueSingleConversationAndMatchingDraft() {
        String valid = "fixture:conversation:friend-1:single:unique";
        assertEquals("0.3", FixtureReplyGuard.target(page(FixtureReplyGuard.PACKAGE, valid, "", false), "friend-1", "m1", "reply", false));
        assertEquals("0.4", FixtureReplyGuard.target(page(FixtureReplyGuard.PACKAGE, valid, "reply", false), "friend-1", "m1", "reply", true));
        assertNull(FixtureReplyGuard.target(page("com.tencent.mm", valid, "", false), "friend-1", "m1", "reply", false));
        assertNull(FixtureReplyGuard.target(page(FixtureReplyGuard.PACKAGE, "fixture:conversation:friend-1:group:unique", "", false), "friend-1", "m1", "reply", false));
        assertNull(FixtureReplyGuard.target(page(FixtureReplyGuard.PACKAGE, valid, "other", false), "friend-1", "m1", "reply", true));
        assertEquals("0.4", FixtureReplyGuard.target(page(FixtureReplyGuard.PACKAGE, valid, "reply", true), "friend-1", "m1", "reply", true));
    }
    @Test public void confirmationRequiresOneMatchingOutgoingAndEmptyDraft() {
        String valid = "fixture:conversation:friend-1:single:unique";
        java.util.Set<String> empty = java.util.Collections.emptySet();
        assertTrue(FixtureReplyGuard.sent(page(FixtureReplyGuard.PACKAGE, valid, "", true), "friend-1", "m1", "reply", empty));
        assertFalse(FixtureReplyGuard.sent(page(FixtureReplyGuard.PACKAGE, valid, "", false), "friend-1", "m1", "reply", empty));
        assertFalse(FixtureReplyGuard.sent(page(FixtureReplyGuard.PACKAGE, valid, "reply", true), "friend-1", "m1", "reply", empty));
        assertFalse(FixtureReplyGuard.sent(page(FixtureReplyGuard.PACKAGE, valid, "", true), "friend-1", "m1", "reply", java.util.Collections.singleton("m2")));
    }
    @Test public void androidHintIsEmptyButOnlyWithExplicitFlag() {
        String valid = "fixture:conversation:friend-1:single:unique";
        assertEquals("0.3", FixtureReplyGuard.target(page(FixtureReplyGuard.PACKAGE, valid, "hint", false, true), "friend-1", "m1", "reply", false));
        assertNull(FixtureReplyGuard.target(page(FixtureReplyGuard.PACKAGE, valid, "hint", false, false), "friend-1", "m1", "reply", false));
        assertNull(FixtureReplyGuard.target(page(FixtureReplyGuard.PACKAGE, valid, "reply", false, true), "friend-1", "m1", "reply", true));
        assertTrue(FixtureReplyGuard.sent(page(FixtureReplyGuard.PACKAGE, valid, "hint", true, true), "friend-1", "m1", "reply", java.util.Collections.<String>emptySet()));
    }

    @Test public void acceptsOnlyActiveIncomingFixtureImages() {
        String valid = "fixture:conversation:friend-1:single:unique";
        VirtualActionGuard.Page image = withMessage(page(FixtureReplyGuard.PACKAGE, valid, "", true),
                "fixture:message:m1:incoming:image:active", false);
        assertEquals("0.3", FixtureReplyGuard.target(image, "friend-1", "m1", "reply", false));
        assertTrue(FixtureReplyGuard.sent(image, "friend-1", "m1", "reply", java.util.Collections.<String>emptySet()));
        assertFalse(FixtureReplyGuard.sent(image, "friend-1", "m1", "reply", java.util.Collections.singleton("m2")));
        VirtualActionGuard.Page retracted = withMessage(image, "fixture:message:m1:incoming:image:retracted", false);
        assertNull(FixtureReplyGuard.target(retracted, "friend-1", "m1", "reply", false));
        assertFalse(FixtureReplyGuard.sent(retracted, "friend-1", "m1", "reply", java.util.Collections.<String>emptySet()));
        VirtualActionGuard.Page duplicate = withMessage(image, "fixture:message:m1:incoming:image:active", true);
        assertNull(FixtureReplyGuard.target(duplicate, "friend-1", "m1", "reply", false));
        assertFalse(FixtureReplyGuard.sent(duplicate, "friend-1", "m1", "reply", java.util.Collections.<String>emptySet()));
    }

    @Test public void existingMatchingReplyDoesNotCountAsNewConfirmation() {
        String valid = "fixture:conversation:friend-1:single:unique";
        VirtualActionGuard.Page before = page(FixtureReplyGuard.PACKAGE, valid, "reply", true);
        assertEquals("0.4", FixtureReplyGuard.target(before, "friend-1", "m1", "reply", true));
        java.util.Set<String> previous = FixtureReplyGuard.outgoingIds(before);
        assertFalse(FixtureReplyGuard.sent(page(FixtureReplyGuard.PACKAGE, valid, "", true), "friend-1", "m1", "reply", previous));
        VirtualActionGuard.Page after = withMessage(page(FixtureReplyGuard.PACKAGE, valid, "", true),
                "fixture:message:m3:outgoing:text:active", true, "reply");
        assertTrue(FixtureReplyGuard.sent(after, "friend-1", "m1", "reply", previous));
        after = withMessage(after, "fixture:message:m4:outgoing:text:active", true, "reply");
        assertFalse(FixtureReplyGuard.sent(after, "friend-1", "m1", "reply", previous));
    }

    private static VirtualActionGuard.Page withMessage(VirtualActionGuard.Page source, String description, boolean duplicate) {
        return withMessage(source, description, duplicate, "image");
    }

    private static VirtualActionGuard.Page withMessage(VirtualActionGuard.Page source, String description, boolean duplicate, String text) {
        List<VirtualActionGuard.Node> nodes = new ArrayList<>(source.nodes);
        if (!duplicate) nodes.remove(1);
        nodes.add(node("0.8", "chat_message", text, description, false, false));
        return new VirtualActionGuard.Page(1, 1, 100, 100, 0, source.packageName,
                Arrays.asList(new VirtualActionGuard.Window(1, 1, new VirtualActionGuard.Box(0, 0, 100, 100))), nodes);
    }
}
