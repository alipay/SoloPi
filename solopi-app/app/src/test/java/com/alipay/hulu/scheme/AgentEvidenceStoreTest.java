package com.alipay.hulu.scheme;

import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

public class AgentEvidenceStoreTest {
    @Test
    public void appendWritesOrderedJsonLinesWithoutReplacingPriorEvidence() throws Exception {
        File root = Files.createTempDirectory("agent-evidence").toFile();
        AgentEvidenceStore store = new AgentEvidenceStore(root);
        store.append(event(1L, "session_started"));
        store.append(event(2L, "observation_created"));

        File timeline = new File(new File(root, "agent-session-test"), "timeline.jsonl");
        List<String> lines = Files.readAllLines(timeline.toPath(), StandardCharsets.UTF_8);

        assertEquals(2, lines.size());
        assertFalse(lines.get(0).contains("ownerToken"));
        assertEquals("{\"sequence\":1,\"sessionId\":\"agent-session-test\",\"type\":\"session_started\"}",
                lines.get(0));
        assertEquals("{\"sequence\":2,\"sessionId\":\"agent-session-test\",\"type\":\"observation_created\"}",
                lines.get(1));
    }

    private static Map<String, Object> event(long sequence, String type) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("sequence", sequence);
        event.put("sessionId", "agent-session-test");
        event.put("type", type);
        return event;
    }
}
