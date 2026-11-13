package com.alipay.hulu.scheme;

import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

final class FixturePipeFrame {
    static final int MAX_BYTES = 16384;
    private static final String[] KEYS = {"sessionId", "ownerToken", "stepId", "observationId", "contactId", "messageId", "reply"};
    final boolean send;
    final Map<String, String> params;

    private FixturePipeFrame(boolean send, Map<String, String> params) {
        this.send = send;
        this.params = params;
    }

    static FixturePipeFrame parse(byte[] bytes) throws IOException {
        if (bytes == null || bytes.length > MAX_BYTES) throw new IOException("Invalid frame");
        DataInputStream input = new DataInputStream(new ByteArrayInputStream(bytes));
        if (input.readInt() != 0x53504631) throw new IOException("Invalid frame");
        int operation = input.readUnsignedByte();
        if (operation != 0 && operation != 1) throw new IOException("Invalid frame");
        Map<String, String> params = new LinkedHashMap<>();
        for (String key : KEYS) {
            int size = input.readUnsignedShort();
            int maximum = "reply".equals(key) ? 8000 : 512;
            if (size == 0 || size > maximum || size > input.available()) throw new IOException("Invalid frame");
            byte[] value = new byte[size];
            input.readFully(value);
            try {
                String decoded = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(value)).toString();
                if (decoded.trim().isEmpty() || decoded.indexOf('\0') >= 0) throw new IOException("Invalid frame");
                params.put(key, decoded);
            } catch (CharacterCodingException invalid) {
                throw new IOException("Invalid frame");
            }
        }
        if (input.available() != 0) throw new IOException("Invalid frame");
        return new FixturePipeFrame(operation == 1, params);
    }
}
