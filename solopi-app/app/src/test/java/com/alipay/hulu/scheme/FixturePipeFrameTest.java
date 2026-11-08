package com.alipay.hulu.scheme;

import org.junit.Test;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import static org.junit.Assert.*;

public class FixturePipeFrameTest {
    private byte[] frame(int op) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream out = new DataOutputStream(bytes);
        out.writeInt(0x53504631); out.writeByte(op);
        for (String value : new String[]{"session", "owner", "step", "observation", "friend-1", "m1", "合成回复"}) {
            byte[] encoded = value.getBytes(StandardCharsets.UTF_8);
            out.writeShort(encoded.length); out.write(encoded);
        }
        return bytes.toByteArray();
    }

    @Test public void acceptsCompleteFrameAndBothActions() throws Exception {
        FixturePipeFrame input = FixturePipeFrame.parse(frame(0));
        assertFalse(input.send); assertEquals("合成回复", input.params.get("reply"));
        assertTrue(FixturePipeFrame.parse(frame(1)).send);
    }

    @Test public void rejectsTruncatedTrailingOversizeAndInvalidOperation() throws Exception {
        byte[] valid = frame(0);
        for (int i = 0; i < valid.length; i++) reject(Arrays.copyOf(valid, i));
        reject(Arrays.copyOf(valid, valid.length + 1));
        reject(new byte[FixturePipeFrame.MAX_BYTES + 1]);
        reject(frame(2));
        byte[] malformed = valid.clone(); malformed[malformed.length - 1] = (byte) 0xff;
        reject(malformed);
    }

    private void reject(byte[] bytes) throws Exception {
        try { FixturePipeFrame.parse(bytes); fail("invalid frame accepted"); }
        catch (IOException expected) { }
    }
}
