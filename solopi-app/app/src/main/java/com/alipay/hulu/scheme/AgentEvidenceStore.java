/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
package com.alipay.hulu.scheme;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Map;

/** 在 SoloPi 受控目录中持久化只追加的动态 Agent 证据。 */
final class AgentEvidenceStore implements AgentSessionState.EventSink {
    private static final String TAG = AgentEvidenceStore.class.getSimpleName();
    private final File rootOverride;

    AgentEvidenceStore() {
        this(null);
    }

    AgentEvidenceStore(File rootOverride) {
        this.rootOverride = rootOverride;
    }

    @Override
    public synchronized void append(Map<String, Object> event) {
        Object rawSessionId = event.get("sessionId");
        if (!(rawSessionId instanceof String)) {
            return;
        }
        File timeline = new File(sessionDirectory((String) rawSessionId), "timeline.jsonl");
        Writer writer = null;
        try {
            writer = new OutputStreamWriter(new FileOutputStream(timeline, true), "UTF-8");
            writer.write(JSON.toJSONString(event));
            writer.write('\n');
            writer.flush();
        } catch (IOException e) {
            LogUtil.e(TAG, "Unable to append Agent timeline", e);
        } finally {
            if (writer != null) {
                try {
                    writer.close();
                } catch (IOException e) {
                    LogUtil.w(TAG, "Unable to close Agent timeline", e);
                }
            }
        }
    }

    File artifactFile(String sessionId, String name) {
        return new File(sessionDirectory(sessionId), safeName(name));
    }

    String timelinePath(String sessionId) {
        return new File(sessionDirectory(sessionId), "timeline.jsonl").getAbsolutePath();
    }

    static String sha256(File file) throws IOException {
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
        FileInputStream input = null;
        try {
            input = new FileInputStream(file);
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read > 0) {
                    digest.update(buffer, 0, read);
                }
            }
        } finally {
            if (input != null) {
                input.close();
            }
        }
        StringBuilder value = new StringBuilder(64);
        for (byte current : digest.digest()) {
            value.append(String.format("%02x", current & 0xff));
        }
        return value.toString();
    }

    static String sha256(String value) {
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
        try {
            digest.update(value.getBytes("UTF-8"));
        } catch (java.io.UnsupportedEncodingException impossible) {
            throw new IllegalStateException("UTF-8 is unavailable", impossible);
        }
        StringBuilder result = new StringBuilder(64);
        for (byte current : digest.digest()) {
            result.append(String.format("%02x", current & 0xff));
        }
        return result.toString();
    }

    private File sessionDirectory(String sessionId) {
        File root = rootOverride == null ? FileUtils.getSubDir("agent-sessions") : rootOverride;
        if (!root.exists()) {
            root.mkdirs();
        }
        File directory = new File(root, safeName(sessionId));
        if (!directory.exists()) {
            directory.mkdirs();
        }
        return directory;
    }

    private static String safeName(String value) {
        if (value == null || !value.matches("[A-Za-z0-9._-]{1,160}")) {
            throw new IllegalArgumentException("Unsafe Agent evidence name");
        }
        return value;
    }
}
