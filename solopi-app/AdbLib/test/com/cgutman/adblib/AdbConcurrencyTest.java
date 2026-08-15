package com.cgutman.adblib;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.net.Socket;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

public class AdbConcurrencyTest {

    private AdbConnection connection;

    @Before
    public void createConnection() throws Exception {
        connection = newBareConnection();
        connection.connected = true;
        connection.connectAttempted = true;
        connection.outputStream = new NoOpOutputStream();
        connection.msgManager.start();
    }

    @After
    public void cleanupConnection() throws Exception {
        connection.outputStream = new NoOpOutputStream();
        connection.msgManager.cleanupStreams();
        assertTrue("ADB message worker did not terminate",
                connection.msgManager.awaitWorkerTermination(2, TimeUnit.SECONDS));
    }

    @Test
    public void localStreamIdAllocatorMustBeAtomic() throws Exception {
        Field localIdField = AdbConnection.class.getDeclaredField("lastLocalId");

        assertEquals(AtomicInteger.class, localIdField.getType());
    }

    @Test
    public void streamRegistryMustSupportConcurrentAccess() throws Exception {
        Field streamsField = AdbMessageManager.class.getDeclaredField("openStreams");
        streamsField.setAccessible(true);

        Object streams = streamsField.get(connection.msgManager);
        assertTrue(streams instanceof ConcurrentMap);
    }

    @Test
    public void writesToSharedAdbOutputMustBeSerialized() throws Exception {
        final BlockingOutputStream output = new BlockingOutputStream();
        connection.outputStream = output;

        final AdbStream first = new AdbStream(connection, 101);
        final AdbStream second = new AdbStream(connection, 102);
        first.updateRemoteId(201);
        second.updateRemoteId(202);

        final CountDownLatch start = new CountDownLatch(1);
        Thread firstWriter = readyWriter(first, start);
        Thread secondWriter = readyWriter(second, start);
        firstWriter.start();
        secondWriter.start();
        start.countDown();

        assertTrue("No ADB packet reached the output stream",
                output.firstWriterEntered.await(2, TimeUnit.SECONDS));
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(1);
        while (output.maximumConcurrentWriters.get() < 2 && System.nanoTime() < deadline) {
            Thread.yield();
        }

        output.releaseWriters.countDown();
        firstWriter.join(2000);
        secondWriter.join(2000);

        assertFalse("First writer did not finish", firstWriter.isAlive());
        assertFalse("Second writer did not finish", secondWriter.isAlive());
        assertEquals("ADB packets may interleave on the shared socket", 1,
                output.maximumConcurrentWriters.get());
    }

    @Test
    public void messagesForTheSameStreamMustKeepWireOrder() throws Exception {
        int localId = 303;
        AdbStream stream = new AdbStream(connection, localId);
        stream.updateRemoteId(403);
        connection.msgManager.addAdbStream(localId, stream);

        byte[] slowFirstPayload = new byte[64 * 1024 * 1024];
        slowFirstPayload[0] = 1;
        byte[] fastSecondPayload = new byte[] { 2 };

        connection.msgManager.pushMessage(message(AdbProtocol.CMD_WRTE, 403, localId,
                slowFirstPayload, 1));
        connection.msgManager.pushMessage(message(AdbProtocol.CMD_WRTE, 403, localId,
                fastSecondPayload, 2));

        LinkedBlockingQueue<byte[]> received = stream.getInputStream().readQueue;
        byte[] firstReceived = received.poll(5, TimeUnit.SECONDS);
        byte[] secondReceived = received.poll(5, TimeUnit.SECONDS);

        assertNotNull("First stream message was not processed", firstReceived);
        assertNotNull("Second stream message was not processed", secondReceived);
        assertEquals("Messages for one stream were processed out of wire order",
                slowFirstPayload.length, firstReceived.length);
        assertEquals(1, firstReceived[0]);
        assertEquals(1, secondReceived.length);
        assertEquals(2, secondReceived[0]);
    }

    @Test
    public void peerCloseKeepsQueuedPayloadReadable() throws Exception {
        int localId = 304;
        byte[] payload = new byte[] { 7, 8, 9 };
        AdbStream stream = new AdbStream(connection, localId);
        stream.updateRemoteId(404);
        connection.msgManager.addAdbStream(localId, stream);

        connection.msgManager.pushMessage(message(AdbProtocol.CMD_WRTE, 404, localId,
                payload, 24));
        connection.msgManager.pushMessage(message(AdbProtocol.CMD_CLSE, 404, localId,
                new byte[0], 0));

        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        while (!stream.isClosed() && System.nanoTime() < deadline) {
            Thread.yield();
        }
        byte[] received = new byte[payload.length];
        int read = stream.getInputStream().read(received, 0, received.length);

        assertTrue("Peer CLOSE was not processed", stream.isClosed());
        assertEquals(payload.length, read);
        assertEquals(payload[0], received[0]);
        assertEquals(payload[1], received[1]);
        assertEquals(payload[2], received[2]);
    }

    @Test
    public void openWriteFailureRollsBackAndClosesStreamLocally() throws Exception {
        CapturingMessageManager manager = replaceManager();
        connection.outputStream = new ThrowingOutputStream();

        try {
            connection.open("shell:true");
            fail("Expected OPEN write to fail");
        } catch (IOException expected) {
            assertEquals("forced write failure", expected.getMessage());
        }

        assertEquals(0, manager.getOpenStreamCount());
        assertNotNull(manager.registeredStream);
        assertTrue(manager.registeredStream.isClosed());
    }

    @Test
    public void interruptedOpenRollsBackAndPropagatesInterruption() throws Exception {
        final CapturingMessageManager manager = replaceManager();
        final SignallingOutputStream output = new SignallingOutputStream();
        final AtomicReference<Throwable> failure = new AtomicReference<>();
        connection.outputStream = output;

        Thread opener = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    connection.open("shell:true");
                    failure.set(new AssertionError("OPEN unexpectedly completed"));
                } catch (Throwable e) {
                    failure.set(e);
                }
            }
        });
        opener.start();

        assertTrue("OPEN packet was not written",
                output.packetWritten.await(2, TimeUnit.SECONDS));
        opener.interrupt();
        opener.join(2000);

        assertFalse("Interrupted OPEN did not finish", opener.isAlive());
        assertTrue("OPEN did not propagate InterruptedException",
                failure.get() instanceof InterruptedException);
        assertEquals(0, manager.getOpenStreamCount());
        assertNotNull(manager.registeredStream);
        assertTrue(manager.registeredStream.isClosed());
    }

    @Test
    public void registrationIsRejectedWhileCleanupIsStillRunning() throws Exception {
        final BlockingCloseStream registered = new BlockingCloseStream(connection, 501);
        connection.msgManager.addAdbStream(501, registered);

        Thread cleanup = new Thread(new Runnable() {
            @Override
            public void run() {
                connection.msgManager.cleanupStreams();
            }
        });
        cleanup.start();
        assertTrue("Cleanup did not reach stream shutdown",
                registered.closeEntered.await(2, TimeUnit.SECONDS));

        AdbStream rejected = new AdbStream(connection, 502);
        try {
            connection.msgManager.addAdbStream(502, rejected);
            fail("Registration succeeded after cleanup started");
        } catch (IOException expected) {
            assertTrue(expected.getMessage().contains("closed"));
        } finally {
            registered.releaseClose.countDown();
        }

        cleanup.join(2000);
        assertFalse("Cleanup did not finish", cleanup.isAlive());
        assertTrue(registered.isClosed());
        assertTrue(rejected.isClosed());
        assertEquals(0, connection.msgManager.getOpenStreamCount());
    }

    @Test
    public void concurrentCleanupAndOpenLeaveNoRegisteredStream() throws Exception {
        final CapturingMessageManager manager = replaceManager();
        final BlockingOutputStream output = new BlockingOutputStream();
        final AtomicReference<Throwable> openFailure = new AtomicReference<>();
        connection.outputStream = output;

        Thread opener = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    connection.open("shell:true");
                    openFailure.set(new AssertionError("OPEN unexpectedly completed"));
                } catch (Throwable e) {
                    openFailure.set(e);
                }
            }
        });
        opener.start();
        assertTrue("OPEN write did not start",
                output.firstWriterEntered.await(2, TimeUnit.SECONDS));

        final CountDownLatch cleanupCalled = new CountDownLatch(1);
        Thread cleanup = new Thread(new Runnable() {
            @Override
            public void run() {
                cleanupCalled.countDown();
                manager.cleanupStreams();
            }
        });
        cleanup.start();
        assertTrue(cleanupCalled.await(2, TimeUnit.SECONDS));
        assertTrue("Cleanup should wait for the atomic OPEN write", cleanup.isAlive());

        output.releaseWriters.countDown();
        opener.join(2000);
        cleanup.join(2000);

        assertFalse("OPEN did not finish", opener.isAlive());
        assertFalse("Cleanup did not finish", cleanup.isAlive());
        assertTrue(openFailure.get() instanceof IOException);
        assertEquals(0, manager.getOpenStreamCount());
        assertNotNull(manager.registeredStream);
        assertTrue(manager.registeredStream.isClosed());
    }

    @Test
    public void connectionCloseUnblocksWriteBeforeManagerCleanup() throws Exception {
        final CapturingMessageManager manager = replaceManager();
        final SocketClosingOutputStream output = new SocketClosingOutputStream();
        final AtomicReference<Throwable> openFailure = new AtomicReference<>();
        final AtomicReference<Throwable> closeFailure = new AtomicReference<>();
        connection.outputStream = output;
        connection.socket = new OutputUnblockingSocket(output);

        Thread opener = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    connection.open("shell:true");
                    openFailure.set(new AssertionError("OPEN unexpectedly completed"));
                } catch (Throwable e) {
                    openFailure.set(e);
                }
            }
        });
        opener.start();
        assertTrue("OPEN write did not block",
                output.writeEntered.await(2, TimeUnit.SECONDS));

        Thread closer = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    connection.close();
                } catch (Throwable e) {
                    closeFailure.set(e);
                }
            }
        });
        closer.start();
        closer.join(2000);
        boolean closeWasBlocked = closer.isAlive();
        if (closeWasBlocked) {
            output.release();
            closer.join(2000);
        }
        opener.join(2000);

        assertFalse("Connection close waited on a blocked manager write", closeWasBlocked);
        assertFalse("Connection close did not finish", closer.isAlive());
        assertFalse("OPEN did not finish", opener.isAlive());
        assertTrue(openFailure.get() instanceof IOException);
        assertTrue("Connection close failed: " + closeFailure.get(), closeFailure.get() == null);
        assertTrue(manager.isClosed());
        assertEquals(0, manager.getOpenStreamCount());
    }

    @Test
    public void closeBeforeConnectClosesUnstartedMessageManager() throws Exception {
        AdbConnection unconnected = newBareConnection();

        unconnected.close();

        assertTrue(unconnected.msgManager.isClosed());
        assertFalse(unconnected.msgManager.isStarted());
        assertTrue(unconnected.msgManager.isWorkerShutdown());
        assertTrue(unconnected.msgManager.awaitWorkerTermination(1, TimeUnit.SECONDS));
        assertFalse(unconnected.connectionThread.isAlive());
    }

    @Test
    public void failedConnectWriteShutsDownMessageWorker() throws Exception {
        AdbConnection failed = newBareConnection();
        failed.outputStream = new ThrowingOutputStream();

        try {
            failed.connect(1);
            fail("Expected CONNECT write to fail");
        } catch (IOException expected) {
            assertEquals("forced write failure", expected.getMessage());
        }

        assertTrue(failed.msgManager.isStarted());
        assertTrue(failed.msgManager.isClosed());
        assertTrue(failed.msgManager.isWorkerShutdown());
        assertTrue(failed.msgManager.awaitWorkerTermination(2, TimeUnit.SECONDS));
        assertFalse(failed.connectionThread.isAlive());
    }

    @Test
    public void connectTimeoutClosesSocketAndUnblocksReader() throws Exception {
        AdbConnection failed = newBareConnection();
        BlockingInputStream input = new BlockingInputStream();
        TrackingSocket socket = new TrackingSocket(input);
        failed.inputStream = input;
        failed.outputStream = new NoOpOutputStream();
        failed.socket = socket;

        try {
            failed.connect(50);
            fail("Expected CONNECT to time out");
        } catch (IOException expected) {
            assertEquals("Connection failed", expected.getMessage());
        }

        failed.connectionThread.join(2000);
        assertTrue("Failed connection did not close its socket", socket.closeCalled.get());
        assertFalse("Socket reader remained blocked", failed.connectionThread.isAlive());
        assertTrue(failed.msgManager.isClosed());
        assertTrue(failed.msgManager.awaitWorkerTermination(2, TimeUnit.SECONDS));
    }

    @Test
    public void localCloseIsVisibleAcrossThreads() throws Exception {
        final AdbStream stream = new AdbStream(connection, 601);
        final CountDownLatch observerStarted = new CountDownLatch(1);
        final AtomicBoolean observedClosed = new AtomicBoolean(false);

        Thread observer = new Thread(new Runnable() {
            @Override
            public void run() {
                observerStarted.countDown();
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
                while (!stream.isClosed() && System.nanoTime() < deadline) {
                    Thread.yield();
                }
                observedClosed.set(stream.isClosed());
            }
        });
        observer.start();
        assertTrue(observerStarted.await(1, TimeUnit.SECONDS));

        stream.closeLocal();
        observer.join(2000);

        assertFalse("Observer did not finish", observer.isAlive());
        assertTrue("Observer did not see local close", observedClosed.get());
    }

    private CapturingMessageManager replaceManager() throws Exception {
        connection.msgManager.cleanupStreams();
        assertTrue(connection.msgManager.awaitWorkerTermination(2, TimeUnit.SECONDS));

        CapturingMessageManager manager = new CapturingMessageManager(connection);
        connection.msgManager = manager;
        manager.start();
        return manager;
    }

    private static AdbConnection newBareConnection() throws Exception {
        Constructor<AdbConnection> constructor = AdbConnection.class.getDeclaredConstructor();
        constructor.setAccessible(true);
        return constructor.newInstance();
    }

    private static AdbProtocol.AdbMessage message(int command, int arg0, int arg1,
                                                   byte[] payload, int checksum) {
        AdbProtocol.AdbMessage message = new AdbProtocol.AdbMessage();
        message.command = command;
        message.arg0 = arg0;
        message.arg1 = arg1;
        message.payload = payload;
        message.payloadLength = payload.length;
        message.checksum = checksum;
        message.magic = command ^ 0xFFFFFFFF;
        return message;
    }

    private static Thread readyWriter(final AdbStream stream, final CountDownLatch start) {
        return new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    start.await();
                    stream.sendReady();
                } catch (Exception e) {
                    throw new AssertionError(e);
                }
            }
        });
    }

    private static final class CapturingMessageManager extends AdbMessageManager {
        private volatile AdbStream registeredStream;

        private CapturingMessageManager(AdbConnection connection) {
            super(connection);
        }

        @Override
        protected void addAdbStreamAndWrite(int localId, AdbStream stream, byte[] packet)
                throws IOException {
            registeredStream = stream;
            super.addAdbStreamAndWrite(localId, stream, packet);
        }
    }

    private static final class BlockingCloseStream extends AdbStream {
        private final CountDownLatch closeEntered = new CountDownLatch(1);
        private final CountDownLatch releaseClose = new CountDownLatch(1);

        private BlockingCloseStream(AdbConnection connection, int localId) {
            super(connection, localId);
        }

        @Override
        boolean closeLocal() {
            closeEntered.countDown();
            try {
                releaseClose.await(2, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return super.closeLocal();
        }
    }

    private static final class BlockingOutputStream extends OutputStream {
        private final AtomicInteger activeWriters = new AtomicInteger();
        private final AtomicInteger maximumConcurrentWriters = new AtomicInteger();
        private final CountDownLatch firstWriterEntered = new CountDownLatch(1);
        private final CountDownLatch releaseWriters = new CountDownLatch(1);

        @Override
        public void write(int value) {
        }

        @Override
        public void write(byte[] packet) throws IOException {
            int active = activeWriters.incrementAndGet();
            updateMaximum(active);
            firstWriterEntered.countDown();
            try {
                if (!releaseWriters.await(3, TimeUnit.SECONDS)) {
                    throw new IOException("Timed out waiting to release test writers");
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IOException("Interrupted while writing test packet", e);
            } finally {
                activeWriters.decrementAndGet();
            }
        }

        private void updateMaximum(int candidate) {
            int current;
            do {
                current = maximumConcurrentWriters.get();
                if (candidate <= current) {
                    return;
                }
            } while (!maximumConcurrentWriters.compareAndSet(current, candidate));
        }
    }

    private static final class SignallingOutputStream extends OutputStream {
        private final CountDownLatch packetWritten = new CountDownLatch(1);

        @Override
        public void write(int value) {
        }

        @Override
        public void write(byte[] packet) {
            packetWritten.countDown();
        }
    }

    private static final class ThrowingOutputStream extends OutputStream {
        @Override
        public void write(int value) throws IOException {
            throw new IOException("forced write failure");
        }

        @Override
        public void write(byte[] packet) throws IOException {
            throw new IOException("forced write failure");
        }
    }

    private static final class SocketClosingOutputStream extends OutputStream {
        private final CountDownLatch writeEntered = new CountDownLatch(1);
        private boolean released;

        @Override
        public void write(int value) throws IOException {
            waitForSocketClose();
        }

        @Override
        public void write(byte[] packet) throws IOException {
            waitForSocketClose();
        }

        private synchronized void waitForSocketClose() throws IOException {
            writeEntered.countDown();
            while (!released) {
                try {
                    wait();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            throw new IOException("socket closed");
        }

        private synchronized void release() {
            released = true;
            notifyAll();
        }
    }

    private static final class OutputUnblockingSocket extends Socket {
        private final SocketClosingOutputStream output;

        private OutputUnblockingSocket(SocketClosingOutputStream output) {
            this.output = output;
        }

        @Override
        public synchronized void close() {
            output.release();
        }
    }

    private static final class BlockingInputStream extends InputStream {
        private boolean closed;

        @Override
        public synchronized int read() throws IOException {
            while (!closed) {
                try {
                    wait();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            return -1;
        }

        @Override
        public synchronized int read(byte[] buffer, int offset, int length) throws IOException {
            return read();
        }

        @Override
        public synchronized void close() {
            closed = true;
            notifyAll();
        }
    }

    private static final class TrackingSocket extends Socket {
        private final BlockingInputStream input;
        private final AtomicBoolean closeCalled = new AtomicBoolean(false);

        private TrackingSocket(BlockingInputStream input) {
            this.input = input;
        }

        @Override
        public synchronized void close() throws IOException {
            closeCalled.set(true);
            input.close();
        }
    }

    private static final class NoOpOutputStream extends OutputStream {
        @Override
        public void write(int value) {
        }
    }
}
