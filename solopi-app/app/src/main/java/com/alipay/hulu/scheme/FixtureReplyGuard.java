package com.alipay.hulu.scheme;

import com.alipay.hulu.virtualscreen.VirtualActionGuard;
import java.util.HashSet;
import java.util.Set;

/** Test-fixture-only contract. These markers have no meaning for third-party applications. */
final class FixtureReplyGuard {
    static final String PACKAGE = "com.solopi.fastpath.replyfixture";
    private static final String IDS = "com.solopi.fastpath.demo:id/";

    static String target(VirtualActionGuard.Page page, String contact, String message,
                         String reply, boolean send) {
        if (page == null || !PACKAGE.equals(page.packageName) || contact == null || message == null
                || !contact.matches("[A-Za-z0-9-]{1,80}") || !message.matches("[A-Za-z0-9-]{1,80}")
                || reply == null || reply.trim().isEmpty() || reply.length() > 2000) return null;
        VirtualActionGuard.Node identity = null, input = null, button = null, targetMessage = null;
        for (VirtualActionGuard.Node node : page.nodes) {
            if (node == null) return null;
            if (!node.visible || !node.enabled || node.password) continue;
            if ((IDS + "chat_identity").equals(node.resourceId)) {
                if (identity != null) return null;
                identity = node;
            } else if ((IDS + "chat_input").equals(node.resourceId)) {
                if (input != null) return null;
                input = node;
            } else if ((IDS + "chat_send").equals(node.resourceId)) {
                if (button != null) return null;
                button = node;
            } else if ((IDS + "chat_message").equals(node.resourceId)
                    && node.description != null && node.description.startsWith("fixture:message:" + message + ":")) {
                if (targetMessage != null) return null;
                targetMessage = node;
            }
        }
        // Code security: fixture metadata is accepted only in its debug-only fixed package;
        // it is not a trusted identity mechanism for a real messaging application.
        if (identity == null || !("fixture:conversation:" + contact + ":single:unique").equals(identity.description)
                || targetMessage == null || !isIncoming(targetMessage.description, message)
                || input == null || !input.editable || button == null || !button.clickable) return null;
        // Code security: only the framework's explicit hint flag can mark displayed text as an empty draft.
        if (send ? input.showingHintText || !reply.equals(input.text)
                : !input.showingHintText && input.text != null && !input.text.isEmpty()) return null;
        return send ? button.path : input.path;
    }

    static Set<String> outgoingIds(VirtualActionGuard.Page page) {
        Set<String> ids = new HashSet<>();
        if (page == null) return ids;
        for (VirtualActionGuard.Node node : page.nodes) {
            if (node == null || !(IDS + "chat_message").equals(node.resourceId) || node.description == null) continue;
            String[] fields = node.description.split(":");
            if (fields.length == 6 && "fixture".equals(fields[0]) && "message".equals(fields[1])
                    && "outgoing".equals(fields[3]) && "text".equals(fields[4]) && "active".equals(fields[5]))
                ids.add(fields[2]);
        }
        return ids;
    }

    static boolean sent(VirtualActionGuard.Page page, String contact, String message, String reply, Set<String> previousIds) {
        if (page == null || !PACKAGE.equals(page.packageName)) return false;
        int identities = 0, validIdentities = 0, messages = 0, incoming = 0, outgoing = 0, emptyInputs = 0, inputs = 0;
        for (VirtualActionGuard.Node node : page.nodes) {
            if (node == null || !node.visible || !node.enabled || node.password) continue;
            if ((IDS + "chat_identity").equals(node.resourceId)) {
                identities++;
                if (("fixture:conversation:" + contact + ":single:unique").equals(node.description)) validIdentities++;
            }
            if ((IDS + "chat_message").equals(node.resourceId)) {
                if (node.description != null && node.description.startsWith("fixture:message:" + message + ":")) {
                    messages++;
                    if (isIncoming(node.description, message)) incoming++;
                }
                if (reply.equals(node.text) && node.description != null
                        && node.description.matches("fixture:message:[A-Za-z0-9-]+:outgoing:text:active")
                        && !previousIds.contains(node.description.split(":")[2])) outgoing++;
            }
            if ((IDS + "chat_input").equals(node.resourceId)) {
                inputs++;
                if (node.editable && (node.showingHintText || node.text == null || node.text.isEmpty())) emptyInputs++;
            }
        }
        return identities == 1 && validIdentities == 1 && messages == 1 && incoming == 1
                && outgoing == 1 && inputs == 1 && emptyInputs == 1;
    }

    private static boolean isIncoming(String description, String message) {
        return ("fixture:message:" + message + ":incoming:text:active").equals(description)
                || ("fixture:message:" + message + ":incoming:image:active").equals(description);
    }

    private FixtureReplyGuard() { }
}
