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
import java.util.HashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

public class AdbMessageManager {

    /**
     * A hash map of our open streams indexed by local ID.
     **/
    private HashMap<Integer, AdbStream> openStreams;

    /**
     * 调度任务
     */
    private ExecutorService executorService;

    private AdbConnection conn;

    private LinkedBlockingQueue<AdbProtocol.AdbMessage> msgQueue;

    protected AdbMessageManager(AdbConnection conn) {
        this.openStreams = new HashMap<>();
        this.conn = conn;
        this.msgQueue = new LinkedBlockingQueue<>();

        // 三个线程处理消息
        executorService = new ThreadPoolExecutor(5, Integer.MAX_VALUE,
                0, TimeUnit.MILLISECONDS,
                new SynchronousQueue<Runnable>());
        executorService.execute(getMessageHandler());
        executorService.execute(getMessageHandler());
        executorService.execute(getMessageHandler());
    }

    /**
     * 添加消息
     * @param msg
     */
    protected void pushMessage(AdbProtocol.AdbMessage msg) {
        msgQueue.add(msg);
    }

    private Runnable getMessageHandler() {
        return new Runnable() {
            @Override
            public void run() {
                while (true) {
                    try {
                        AdbProtocol.AdbMessage msg = msgQueue.poll(5000, TimeUnit.MILLISECONDS);

                        if (msg != null) {
                            processAdbMessage(msg);
                        }
                    } catch (InterruptedException e) {
                        e.printStackTrace();
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
    protected void addAdbStream(int localId, AdbStream stream) {
        openStreams.put(localId, stream);
    }

    protected void cleanupStreams() {
        /* Close all streams on this connection */
        for (AdbStream s : openStreams.values()) {
            /* We handle exceptions for each close() call to avoid
             * terminating cleanup for one failed close(). */
            try {
                s.close();
            } catch (IOException e) {}
        }

        /* No open streams anymore */
        openStreams.clear();
    }

    /**
     * 处理ADB消息
     * @param msg
     */
    private void processAdbMessage(AdbProtocol.AdbMessage msg) {
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
                            openStreams.remove(msg.arg1);

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
                        conn.outputStream.write(packet);
                        conn.outputStream.flush();
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
