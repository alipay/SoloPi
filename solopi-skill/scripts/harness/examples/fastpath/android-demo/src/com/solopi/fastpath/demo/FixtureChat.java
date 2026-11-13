package com.solopi.fastpath.demo;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** In-memory synthetic chat. No external account or transport is involved. */
final class FixtureChat {
    static final class Message {
        final String id, direction, kind, text;
        boolean retracted;
        Message(String id, String direction, String kind, String text) {
            this.id = id; this.direction = direction; this.kind = kind; this.text = text;
        }
        String description() {
            return "fixture:message:" + id + ":" + direction + ":" + kind + ":" + (retracted ? "retracted" : "active");
        }
    }
    final List<Message> messages = new ArrayList<>();
    private final String instanceId = UUID.randomUUID().toString().replace("-", "");
    private int next = 1;
    private boolean group, ambiguous;

    FixtureChat() { messages.add(new Message("old-1", "incoming", "text", "之前的问题？")); }
    String countDescription() { return "fixture:message-count:" + messages.size() + ":" + instanceId; }
    String identity() {
        return "fixture:conversation:" + (ambiguous ? "friend-2" : "friend-1") + ":" +
                (group ? "group" : "single") + ":" + (ambiguous ? "ambiguous" : "unique");
    }
    void group(boolean value) { group = value; }
    void ambiguous(boolean value) { ambiguous = value; }
    void add(String direction, String kind, String text) {
        messages.add(new Message("m" + next++, direction, kind, text));
    }
    void retractLatestIncoming() {
        for (int i = messages.size() - 1; i >= 0; i--) {
            Message message = messages.get(i);
            if ("incoming".equals(message.direction) && !message.retracted) {
                message.retracted = true;
                return;
            }
        }
    }
}
