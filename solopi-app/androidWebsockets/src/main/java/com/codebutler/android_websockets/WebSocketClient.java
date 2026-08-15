package com.codebutler.android_websockets;

import android.os.Handler;
import android.os.HandlerThread;
import android.text.TextUtils;
import android.util.Base64;
import android.util.Log;
import org.apache.http.*;
import org.apache.http.message.BasicLineParser;
import org.apache.http.message.BasicNameValuePair;

import javax.net.SocketFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLException;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;

import java.io.EOFException;
import java.io.IOException;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.net.Socket;
import java.net.URI;
import java.security.KeyManagementException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;


public class WebSocketClient {
    private static final String TAG = "WebSocketClient";

    private URI                      mURI;
    private Listener                 mListener;
    private Socket                   mSocket;

    private WrapSocket               mWrapSocket;

    private Thread                   mThread;
    private HandlerThread            mHandlerThread;
    private Handler                  mHandler;
    private List<BasicNameValuePair> mExtraHeaders;
    private HybiParser               mParser;

    private boolean running;

    private final Object mSendLock = new Object();

    private static TrustManager[] sTrustManagers;

    public static void setTrustManagers(TrustManager[] tm) {
        sTrustManagers = tm;
    }

    public WebSocketClient(URI uri, Listener listener, List<BasicNameValuePair> extraHeaders) {
        mURI          = uri;
        mListener = listener;
        mExtraHeaders = extraHeaders;
        mParser       = new HybiParser(this);

        mHandlerThread = new HandlerThread("websocket-thread");
        mHandlerThread.start();
        mHandler = new Handler(mHandlerThread.getLooper());
    }

    public void registerWrapSocket(WrapSocket wrapSocket) {
        this.mWrapSocket = wrapSocket;
    }

    public Listener getListener() {
        return mListener;
    }

    public void connect() {
        if (mThread != null && mThread.isAlive()) {
            return;
        }

        mThread = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    String secret = createSecret();

                    int port = (mURI.getPort() != -1) ? mURI.getPort() : (mURI.getScheme().equals("wss") ? 443 : 80);

                    String path = TextUtils.isEmpty(mURI.getPath()) ? "/" : mURI.getPath();
                    if (!TextUtils.isEmpty(mURI.getQuery())) {
                        path += "?" + mURI.getQuery();
                    }

                    String originScheme = mURI.getScheme().equals("wss") ? "https" : "http";
                    URI origin = new URI(originScheme, "//" + mURI.getHost(), null);

                    if (mWrapSocket == null) {
                        SocketFactory factory = mURI.getScheme().equals("wss") ? getSSLSocketFactory() : SocketFactory.getDefault();
                        mSocket = factory.createSocket(mURI.getHost(), port);



                        PrintWriter out = new PrintWriter(mSocket.getOutputStream());
                        out.print("GET " + path + " HTTP/1.1\r\n");
                        out.print("Upgrade: websocket\r\n");
                        out.print("Connection: Upgrade\r\n");
                        out.print("Host: " + mURI.getHost() + "\r\n");
                        out.print("Origin: " + origin.toString() + "\r\n");
                        out.print("Sec-WebSocket-Key: " + secret + "\r\n");
                        out.print("Sec-WebSocket-Version: 13\r\n");
                        if (mExtraHeaders != null) {
                            for (NameValuePair pair : mExtraHeaders) {
                                out.print(String.format("%s: %s\r\n", pair.getName(), pair.getValue()));
                            }
                        }
                        out.print("\r\n");
                        out.flush();

                        HybiParser.HappyDataInputStream stream = new HybiParser.HappyDataInputStream(mSocket.getInputStream());

                        // Read HTTP response status line.
                        StatusLine statusLine = parseStatusLine(readLine(stream));
                        if (statusLine == null) {
                            throw new HttpException("Received no reply from server.");
                        } else if (statusLine.getStatusCode() != HttpStatus.SC_SWITCHING_PROTOCOLS) {
                            throw new HttpException("Response code: " + statusLine.getStatusCode() + " " + statusLine.getReasonPhrase());
                        }

                        // Read HTTP response headers.
                        String line;
                        boolean validated = false;

                        while (!TextUtils.isEmpty(line = readLine(stream))) {
                            Header header = parseHeader(line);
                            if (header.getName().equals("Sec-WebSocket-Accept")) {
                                String expected = createSecretValidation(secret);
                                String actual = header.getValue().trim();

                                if (!expected.equals(actual)) {
                                    throw new HttpException("Bad Sec-WebSocket-Accept header value.");
                                }

                                validated = true;
                            }
                        }

                        if (!validated) {
                            throw new HttpException("No Sec-WebSocket-Accept header.");
                        }

                        mListener.onConnect();

                        running = true;

                        // Now decode websocket frames.
                        mParser.start(stream);
                    } else {
                        StringBuilder builder = new StringBuilder();
                        builder.append("GET ").append(path).append(" HTTP/1.1\r\n");
                        builder.append("Upgrade: websocket\r\n");
                        builder.append("Connection: Upgrade\r\n");
                        builder.append("Host: ").append(mURI.getHost()).append("\r\n");
                        builder.append("Origin: ").append(origin.toString()).append("\r\n");
                        builder.append("Sec-WebSocket-Key: ").append(secret).append("\r\n");
                        builder.append("Sec-WebSocket-Version: 13\r\n");
                        if (mExtraHeaders != null) {
                            for (NameValuePair pair : mExtraHeaders) {
                                builder.append(String.format("%s: %s\r\n", pair.getName(), pair.getValue()));
                            }
                        }
                        builder.append("\r\n");
                        mWrapSocket.writeBytes(builder.toString().getBytes());

                        Thread.sleep(500);

                        HybiParser.HappyDataInputStream stream = new HybiParser.HappyDataInputStream(mWrapSocket.getInputStream());

                        // Read HTTP response status line.
                        StatusLine statusLine = parseStatusLine(readLine(stream));
                        if (statusLine == null) {
                            throw new HttpException("Received no reply from server.");
                        } else if (statusLine.getStatusCode() != HttpStatus.SC_SWITCHING_PROTOCOLS) {
                            throw new HttpException("Response code: " + statusLine.getStatusCode() + " " + statusLine.getReasonPhrase());
                        }

                        // Read HTTP response headers.
                        String line;
                        boolean validated = false;

                        while (!TextUtils.isEmpty(line = readLine(stream))) {
                            Header header = parseHeader(line);
                            if (header.getName().equals("Sec-WebSocket-Accept")) {
                                String expected = createSecretValidation(secret);
                                String actual = header.getValue().trim();

                                if (!expected.equals(actual)) {
                                    throw new HttpException("Bad Sec-WebSocket-Accept header value.");
                                }

                                validated = true;
                            }
                        }

                        if (!validated) {
                            throw new HttpException("No Sec-WebSocket-Accept header.");
                        }

                        mListener.onConnect();

                        // Now decode websocket frames.
                        mParser.start(stream);
                    }

                } catch (EOFException ex) {
                    Log.d(TAG, "WebSocket EOF!", ex);
                    mListener.onDisconnect(0, "EOF");

                } catch (SSLException ex) {
                    // Connection reset by peer
                    Log.d(TAG, "Websocket SSL error!", ex);
                    mListener.onDisconnect(0, "SSL");

                } catch (Exception ex) {
                    mListener.onError(ex);
                }
            }
        });
        mThread.start();
    }

    /**
     * 断开与WebSocket连接
     * @param code
     * @param reason
     */
    public void disconnect(short code, String reason) {
        // 构建断开消息
        byte[] content = new byte[2 + reason.getBytes().length];
        content[1] = (byte) (code >> 8);
        content[0] = (byte) (code);

        byte[] reasonBytes = reason.getBytes();
        System.arraycopy(reasonBytes, 0, content, 2, reasonBytes.length);

        // 同步发送挥手消息
        send(content, false);

        mThread.interrupt();

        /**
         * adb的byteQueueInputStream会处理一次InterruptException，如果被处理了，需要再进行Interrupt
         */
        if (!mThread.isInterrupted()) {
            mThread.interrupt();
        }

        running = false;


        if (mSocket != null) {
            mHandler.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        mSocket.close();
                        mSocket = null;
                    } catch (IOException ex) {
                        Log.d(TAG, "Error while disconnecting", ex);
                        mListener.onError(ex);
                    }
                }
            });
        } else {
            try {
                mWrapSocket.disconnect();
            } catch (Exception e) {
                Log.e(TAG, "Error on close", e);
            }
        }

        mHandlerThread.quit();
    }

    public void disconnect() {
        disconnect((short) 1000, "Mission finished");
    }

    /**
     * 异步发送String数据
     * @param data 数据
     */
    public void send(String data) {
        send(data, true);
    }

    /**
     * 异步发送byte[]数据
     * @param data 数据
     */
    public void send(byte[] data) {
        send(data, true);
    }

    /**
     * 发送String数据
     * @param data 数据
     * @param async 是否异步
     */
    public void send(String data, boolean async) {
        sendFrame(mParser.frame(data), async);
    }

    /**
     * 发送byte[]数据
     * @param data 数据
     * @param async 是否异步
     */
    public void send(byte[] data, boolean async) {
        sendFrame(mParser.frame(data), async);
    }

    private StatusLine parseStatusLine(String line) {
        if (TextUtils.isEmpty(line)) {
            return null;
        }
        return BasicLineParser.parseStatusLine(line, new BasicLineParser());
    }

    private Header parseHeader(String line) {
        return BasicLineParser.parseHeader(line, new BasicLineParser());
    }

    // Can't use BufferedReader because it buffers past the HTTP data.
    private String readLine(HybiParser.HappyDataInputStream reader) throws IOException {
        int readChar = reader.read();
        if (readChar == -1) {
            return null;
        }
        StringBuilder string = new StringBuilder("");
        while (readChar != '\n') {
            if (readChar != '\r') {
                string.append((char) readChar);
            }

            readChar = reader.read();
            if (readChar == -1) {
                return null;
            }
        }
        return string.toString();
    }

    private String createSecret() {
        byte[] nonce = new byte[16];
        for (int i = 0; i < 16; i++) {
            nonce[i] = (byte) (Math.random() * 256);
        }
        return Base64.encodeToString(nonce, Base64.DEFAULT).trim();
    }

    private String createSecretValidation(String secret) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            md.update((secret + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes());
            return Base64.encodeToString(md.digest(), Base64.DEFAULT).trim();
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException(e);
        }
    }

    /**
     * 异步发送帧
     * @param frame 帧数据
     */
    void sendFrame(final byte[] frame) {
        sendFrame(frame, true);
    }

    /**
     * 发送帧
     * @param frame 帧数据
     * @param async 是否异步
     */
    void sendFrame(final byte[] frame, boolean async) {
        Runnable sendRunnable = new Runnable() {
            @Override
            public void run() {
                try {
                    synchronized (mSendLock) {
                        if (mWrapSocket != null) {
                            mWrapSocket.writeBytes(frame);
                            try {
                                Thread.sleep(500);
                            } catch (InterruptedException e) {
                                e.printStackTrace();
                            }

                            return;
                        }

                        if (mSocket == null) {
                            throw new IllegalStateException("Socket not connected");
                        }
                        OutputStream outputStream = mSocket.getOutputStream();
                        outputStream.write(frame);
                        outputStream.flush();
                    }
                } catch (IOException e) {
                    mListener.onError(e);
                }
            }
        };

        if (!async) {
            sendRunnable.run();
        } else {
            mHandler.post(sendRunnable);
        }
    }

    public boolean isRunning() {
        return running;
    }

    public interface Listener {
        public void onConnect();
        public void onMessage(String message);
        public void onMessage(byte[] data);
        public void onDisconnect(int code, String reason);
        public void onError(Exception error);
    }

    private SSLSocketFactory getSSLSocketFactory() throws NoSuchAlgorithmException, KeyManagementException {
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, sTrustManagers, null);
        return context.getSocketFactory();
    }
}
