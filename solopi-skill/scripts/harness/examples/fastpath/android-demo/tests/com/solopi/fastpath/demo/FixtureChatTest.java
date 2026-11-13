package com.solopi.fastpath.demo;

public final class FixtureChatTest {
    public static void main(String[] args) {
        FixtureChat chat = new FixtureChat();
        check(chat.identity().equals("fixture:conversation:friend-1:single:unique"));
        check(chat.messages.size() == 1 && chat.messages.get(0).id.equals("old-1"));
        String marker = chat.countDescription();
        check(marker.matches("fixture:message-count:1:[0-9a-f]{32}"));
        check(!marker.equals(new FixtureChat().countDescription()));
        chat.add("incoming", "text", "same");
        chat.add("incoming", "text", "same");
        check(!chat.messages.get(1).id.equals(chat.messages.get(2).id));
        check(chat.messages.get(1).description().equals("fixture:message:m1:incoming:text:active"));
        chat.retractLatestIncoming();
        check(chat.messages.get(2).description().equals("fixture:message:m2:incoming:text:retracted"));
        chat.add("incoming", "image", "测试图片");
        chat.add("outgoing", "text", "reply");
        check(chat.countDescription().equals(marker.replace("message-count:1:", "message-count:5:")));
        check(chat.messages.get(3).description().equals("fixture:message:m3:incoming:image:active"));
        check(chat.messages.get(4).description().equals("fixture:message:m4:outgoing:text:active"));
        chat.group(true);
        check(chat.identity().equals("fixture:conversation:friend-1:group:unique"));
        chat.ambiguous(true);
        check(chat.identity().equals("fixture:conversation:friend-2:group:ambiguous"));
    }
    private static void check(boolean value) {
        if (!value) throw new AssertionError("fixture chat contract failed");
    }
}
