/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * 	http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.cgutman.adblib;

import java.io.IOException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

public class AdbMessageManager {

    /**
     * A hash map of our open streams indexed by local ID.
     **/
    private final ConcurrentMap<Integer, AdbStream> openStreams;

    /**
     * 调度任务
     */
    private ExecutorService executorService;

    private final AdbConnection conn;

    private final LinkedBlockingQueue<AdbProtocol.AdbMessage> msgQueue;

    private final Object lifecycleLock = new Object();

    private volatile boolean closed;

    private boolean started;

    protected AdbMessageManager(AdbConnection conn) {
        this.openStreams = new ConcurrentHashMap<>();
        this.conn = conn;
        this.msgQueue = new LinkedBlockingQueue<>();
    }

    protected void start() throws IOException {
        synchronized (lifecycleLock) {
            if (closed) {
                throw new IOException("ADB message manager is closed");
            }
            if (started) {
                return;
            }

            // ADB packets arrive in wire order and must be applied in that same order.
            ExecutorService executor = Executors.newSingleThreadExecutor();
            try {
                executor.execute(getMessageHandler());
                executorService = executor;
                started = true;
            } catch (RuntimeException e) {
                executor.shutdownNow();
                throw e;
            }
        }
    }

    /**
     * 添加消息
     * @param msg
     */
    protected void pushMessage(AdbProtocol.AdbMessage msg) {
        synchronized (lifecycleLock) {
            if (!closed) {
                msgQueue.add(msg);
            }
        }
    }

    private Runnable getMessageHandler() {
        return new Runnable() {
            @Override
            public void run() {
                while (!Thread.currentThread().isInterrupted()) {
                    try {
                        AdbProtocol.AdbMessage msg = msgQueue.poll(5000, TimeUnit.MILLISECONDS);

                        if (msg != null) {
                            processAdbMessage(msg);
                        }
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                }
            }
        };
    }

    /**
     * 添加adb stream
     * @param localId
     * @param stream
     */
    protected void addAdbStream(int localId, AdbStream stream) throws IOException {
        synchronized (lifecycleLock) {
            ensureCanRegister(stream);
            if (openStreams.putIfAbsent(localId, stream) != null) {
                stream.closeLocal();
                throw new IOException("ADB stream ID is already registered: " + localId);
            }
        }
    }

    protected void addAdbStreamAndWrite(int localId, AdbStream stream, byte[] openPacket)
            throws IOException {
        synchronized (lifecycleLock) {
            ensureCanRegister(stream);
            if (openStreams.putIfAbsent(localId, stream) != null) {
                stream.closeLocal();
                throw new IOException("ADB stream ID is already registered: " + localId);
            }

            try {
                conn.writePacket(openPacket, true);
            } catch (IOException e) {
                openStreams.remove(localId, stream);
                stream.closeLocal();
                throw e;
            } catch (RuntimeException e) {
                openStreams.remove(localId, stream);
                stream.closeLocal();
                throw e;
            }
        }
    }

    protected boolean removeAdbStream(int localId, AdbStream stream) {
        synchronized (lifecycleLock) {
            return openStreams.remove(localId, stream);
        }
    }

    private void ensureCanRegister(AdbStream stream) throws IOException {
        if (closed || !started) {
            stream.closeLocal();
            throw new IOException(closed
                    ? "ADB message manager is closed"
                    : "ADB message manager is not started");
        }
    }

    protected void cleanupStreams() {
        AdbStream[] streams;
        ExecutorService executor;
        synchronized (lifecycleLock) {
            if (closed) {
                return;
            }

            closed = true;
            streams = openStreams.values().toArray(new AdbStream[openStreams.size()]);
            openStreams.clear();
            msgQueue.clear();
            executor = executorService;
        }

        if (executor != null) {
            executor.shutdownNow();
        }
        for (AdbStream stream : streams) {
            stream.closeLocal();
        }
    }

    boolean isClosed() {
        return closed;
    }

    boolean isStarted() {
        synchronized (lifecycleLock) {
            return started;
        }
    }

    boolean isWorkerShutdown() {
        synchronized (lifecycleLock) {
            return executorService == null || executorService.isShutdown();
        }
    }

    boolean awaitWorkerTermination(long timeout, TimeUnit unit) throws InterruptedException {
        ExecutorService executor;
        synchronized (lifecycleLock) {
            executor = executorService;
        }
        return executor == null || executor.awaitTermination(timeout, unit);
    }

    int getOpenStreamCount() {
        return openStreams.size();
    }

    /**
     * 处理ADB消息
     * @param msg
     */
    private void processAdbMessage(AdbProtocol.AdbMessage msg) {
        synchronized (lifecycleLock) {
            if (closed) {
                return;
            }
            processAdbMessageWhileOpen(msg);
        }
    }

    private void processAdbMessageWhileOpen(AdbProtocol.AdbMessage msg) {
        String cmd = null;

        if (!AdbProtocol.validateMessage(msg))
            return;

        try {
            switch (msg.command) {
                /* Stream-oriented commands */
                case AdbProtocol.CMD_OKAY:
                case AdbProtocol.CMD_WRTE:
                case AdbProtocol.CMD_CLSE:
                    /* We must ignore all packets when not connected */
                    if (!conn.connected)
                        return;

                    /* Get the stream object corresponding to the packet */
                    AdbStream waitingStream = openStreams.get(msg.arg1);
                    if (waitingStream == null)
                        return;

                    synchronized (waitingStream) {
                        if (msg.command == AdbProtocol.CMD_OKAY) {
                            /* We're ready for writes */
                            waitingStream.updateRemoteId(msg.arg0);
                            waitingStream.readyForWrite();

                            /* Unwait an open/write */
                            waitingStream.notify();

                            cmd = "OKAY";
                        } else if (msg.command == AdbProtocol.CMD_WRTE) {
                            /* Got some data from our partner */
                            waitingStream.addPayload(msg.payload);

                            /* Tell it we're ready for more */
                            waitingStream.sendReady();
                            cmd = "WRTE";
                        } else if (msg.command == AdbProtocol.CMD_CLSE) {
                            /* He doesn't like us anymore :-( */
                            openStreams.remove(msg.arg1, waitingStream);

                            /* Notify readers and writers */
                            waitingStream.notifyClose();
                            cmd = "CLSE";
                        }
                    }

                    break;

                case AdbProtocol.CMD_AUTH:

                    byte[] packet;

                    cmd = "AUTH";

                    if (msg.arg0 == AdbProtocol.AUTH_TYPE_TOKEN) {
                        /* This is an authentication challenge */
                        if (conn.sentSignature) {
                            /* We've already tried our signature, so send our public key */
                            packet = AdbProtocol.generateAuth(AdbProtocol.AUTH_TYPE_RSA_PUBLIC,
                                    conn.crypto.getAdbPublicKeyPayload());
                        } else {
                            /* We'll sign the token */
                            packet = AdbProtocol.generateAuth(AdbProtocol.AUTH_TYPE_SIGNATURE,
                                    conn.crypto.signAdbTokenPayload(msg.payload));
                            conn.sentSignature = true;
                        }

                        /* Write the AUTH reply */
                        conn.writePacket(packet, true);
                    }
                    break;

                case AdbProtocol.CMD_CNXN:
                    synchronized (conn) {
                        cmd = "CNXN";
                        /* We need to store the max data size */
                        conn.maxData = msg.arg1;

                        /* Mark us as connected and unwait anyone waiting on the connection */
                        conn.connected = true;
                        conn.notifyAll();
                    }
                    break;

                default:
                    cmd = "default";
                    /* Unrecognized packet, just drop it */
                    break;
            }
        } catch (Exception e) {
            conn.stopFlag = true;
        }
    }

}
