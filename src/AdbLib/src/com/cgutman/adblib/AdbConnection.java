package com.cgutman.adblib;


import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UnsupportedEncodingException;
import java.net.Socket;

/**
 * This class represents an ADB connection.
 * @author Cameron Gutman
 */
public class AdbConnection implements Closeable {
	
	/** The underlying socket that this class uses to
	 * communicate with the target device.
	 */
	protected Socket socket;

	/** The last allocated local stream ID. The ID
	 * chosen for the next stream will be this value + 1.
	 */
	protected int lastLocalId;

	/**
	 * The input stream that this class uses to read from
	 * the socket.
	 */
	protected InputStream inputStream;

	/**
	 * The output stream that this class uses to read from
	 * the socket.
	 */
	protected OutputStream outputStream;

	/**
	 * The backend thread that handles responding to ADB packets.
	 */
	protected Thread connectionThread;

	/**
	 * Specifies whether a connect has been attempted
	 */
	protected boolean connectAttempted;

	/**
	 * Specifies whether a CNXN packet has been received from the peer.
	 */
	protected boolean connected;

	/**
	 * Specifies the maximum amount data that can be sent to the remote peer.
	 * This is only valid after connect() returns successfully.
	 */
	protected int maxData;

	/**
	 * An initialized ADB crypto object that contains a key pair.
	 */
	protected AdbCrypto crypto;

	/**
	 * Specifies whether this connection has already sent a signed token.
	 */
	protected boolean sentSignature;

	protected volatile boolean isFine = true;

	protected AdbMessageManager msgManager;

	protected volatile boolean stopFlag = false;

	/**
	 * Internal constructor to initialize some internal state
	 */
	private AdbConnection()
	{
		msgManager = new AdbMessageManager(this);
		lastLocalId = 0;
		connectionThread = createConnectionThread();
	}
	
	/**
	 * Creates a AdbConnection object associated with the socket and
	 * crypto object specified.
	 * @param socket The socket that the connection will use for communcation.
	 * @param crypto The crypto object that stores the key pair for authentication.
	 * @return A new AdbConnection object.
	 * @throws IOException If there is a socket error
	 */
	public static AdbConnection create(Socket socket, AdbCrypto crypto) throws IOException
	{
		AdbConnection newConn = new AdbConnection();
		
		newConn.crypto = crypto;
		
		newConn.socket = socket;

		// 试试bufferedStream
		newConn.inputStream = socket.getInputStream();
		newConn.outputStream = socket.getOutputStream();

		/* Disable Nagle because we're sending tiny packets */
		socket.setTcpNoDelay(true);

		// 写入缓冲区16K
		socket.setSendBufferSize(16 * 1024);

		// 读取缓冲区64K
		socket.setReceiveBufferSize(64 * 1024);
		socket.setTrafficClass(0x10);

		socket.setPerformancePreferences(0, 2, 1);
		return newConn;
	}
	
	/**
	 * Creates a new connection thread.
	 * @return A new connection thread.
	 */
	private Thread createConnectionThread()
	{
		@SuppressWarnings("resource")
		final AdbConnection conn = this;
		return new Thread(new Runnable() {
			@Override
			public void run() {
				while (!stopFlag && !connectionThread.isInterrupted())
				{
					try {
						/* Read and parse a message off the socket's input stream */
						AdbProtocol.AdbMessage msg = AdbProtocol.AdbMessage.parseAdbMessage(inputStream);
						
						/* Verify magic and checksum */
						msgManager.pushMessage(msg);
						//System.out.println("Receive CMD:" + cmd + "; arg0 " + msg.arg0 + "; arg1: " + msg.arg1 + "; data: " + msg.payloadLength);

					} catch (Exception e) {
						/* The cleanup is taken care of by a combination of this thread
						 * and close() */
						break;
					}
				}

				stopFlag = false;

				/* This thread takes care of cleaning up pending streams */
				synchronized (conn) {
					cleanupStreams();
					conn.notifyAll();
					conn.connectAttempted = false;
				}
			}
		});
	}
	
	/**
	 * Gets the max data size that the remote client supports.
	 * A connection must have been attempted before calling this routine.
	 * This routine will block if a connection is in progress.
	 * @return The maximum data size indicated in the connect packet.
	 * @throws InterruptedException If a connection cannot be waited on.
	 * @throws IOException if the connection fails
	 */
	public int getMaxData() throws InterruptedException, IOException
	{
		if (!connectAttempted)
			throw new IllegalStateException("connect() must be called first");
		
		synchronized (this) {
			/* Block if a connection is pending, but not yet complete */
			if (!connected)
				wait();
			
			if (!connected) {
				throw new IOException("Connection failed");
			}
		}
		
		return maxData;
	}

	/**
	 * 无限等待
	 * @throws IOException
	 * @throws InterruptedException
	 */
	public void connect() throws IOException, InterruptedException {
		connect(0L);
	}
	
	/**
	 * Connects to the remote device. This routine will block until the connection
	 * completes.
	 * @throws IOException If the socket fails while connecting
	 * @throws InterruptedException If we are unable to wait for the connection to finish
	 */
	public void connect(long timeout) throws IOException, InterruptedException
	{
		if (connected)
			throw new IllegalStateException("Already connected");
		
		/* Write the CONNECT packet */
		outputStream.write(AdbProtocol.generateConnect());
		outputStream.flush();
		
		/* Start the connection thread to respond to the peer */
		connectAttempted = true;
		connectionThread.start();
		
		/* Wait for the connection to go live */
		synchronized (this) {
			if (!connected)
				wait(timeout);
			
			if (!connected) {
				throw new IOException("Connection failed");
			}
		}
	}
	
	/**
	 * Opens an AdbStream object corresponding to the specified destination.
	 * This routine will block until the connection completes.
	 * @param destination The destination to open on the target
	 * @return AdbStream object corresponding to the specified destination
	 * @throws UnsupportedEncodingException If the destination cannot be encoded to UTF-8
	 * @throws IOException If the stream fails while sending the packet
	 * @throws InterruptedException If we are unable to wait for the connection to finish
	 */
	public AdbStream open(String destination) throws UnsupportedEncodingException, IOException, InterruptedException
	{
		int localId = ++lastLocalId;
		
		if (!connectAttempted)
			throw new IllegalStateException("connect() must be called first");
		
		/* Wait for the connect response */
		if (!connected) {
			synchronized (this) {
				if (!connected)
					wait();

				if (!connected) {
					throw new IOException("Connection failed");
				}
			}
		}
		
		/* Add this stream to this list of half-open streams */
		AdbStream stream = new AdbStream(this, localId);
		msgManager.addAdbStream(localId, stream);

		/* Send the open */
		outputStream.write(AdbProtocol.generateOpen(localId, destination));
		outputStream.flush();
		
		/* Wait for the connection thread to receive the OKAY */
		synchronized (stream) {
			// 五秒超时
			stream.wait(5000);
		}
		
		/* Check if the open was rejected */
//		if (stream.isClosed())
//			throw new ConnectException("Stream open actively rejected by remote peer");
		
		/* We're fully setup now */
		return stream;
	}
	
	/**
	 * This function terminates all I/O on streams associated with this ADB connection
	 */
	private void cleanupStreams() {
		msgManager.cleanupStreams();
	}

	/** This routine closes the Adb connection and underlying socket
	 * @throws IOException if the socket fails to close
	 */
	@Override
	public void close() throws IOException {
		/* If the connection thread hasn't spawned yet, there's nothing to do */
		if (connectionThread == null)
			return;

		/* Closing the socket will kick the connection thread */
		socket.close();

		/* Wait for the connection thread to die */
		connectionThread.interrupt();
		try {
			connectionThread.join();
		} catch (InterruptedException e) { }
	}

	public boolean isFine() {
		return isFine && connectAttempted && connected;
	}

	public synchronized void setFine(boolean isFine) {
		this.isFine =  isFine;
	}
}
