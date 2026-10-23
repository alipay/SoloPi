/*
  Copyright (c) 2013, Cameron Gutman
  All rights reserved.

  Redistribution and use in source and binary forms, with or without modification,
  are permitted provided that the following conditions are met:

    Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.

    Redistributions in binary form must reproduce the above copyright notice, this
    list of conditions and the following disclaimer in the documentation and/or
    other materials provided with the distribution.

    Neither the name of the {organization} nor the names of its
    contributors may be used to endorse or promote products derived from
    this software without specific prior written permission.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
  ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
  DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
  ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
  ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
  SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
package com.cgutman.adblib;

import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.LinkedBlockingQueue;

/**
 * 参照ByteArrayInputStream实现，支持使用byte[]队列作为数据源
 *
 * @author  ruikai.qrk
 * @see     java.io.ByteArrayInputStream
 */
public
class ByteQueueInputStream extends InputStream {

    private boolean isRunning;

    /**
     * 数据源
     */
    protected final LinkedBlockingQueue<byte[]> readQueue;

    /**
     * 当前读取列表
     */
    private byte[] currentBytes;

    /**
     * The index of the next character to read from the input stream buffer.
     * This value should always be nonnegative
     * and not larger than the value of <code>count</code>.
     * The next byte to be read from the input stream buffer
     * will be <code>buf[pos]</code>.
     */
    private int pos;

    private boolean socketForward = false;

    /**
     * The currently marked position in the stream.
     * ByteArrayInputStream objects are marked at position zero by
     * default when constructed.  They may be marked at another
     * position within the buffer by the <code>mark()</code> method.
     * The current buffer position is set to this point by the
     * <code>reset()</code> method.
     * <p>
     * If no mark has been set, then the value of mark is the offset
     * passed to the constructor (or 0 if the offset was not supplied).
     *
     * @since   JDK1.1
     */
    protected int mark = 0;

    /**
     * The index one greater than the last valid character in the input
     * stream buffer.
     * This value should always be nonnegative
     * and not larger than the length of <code>buf</code>.
     * It  is one greater than the position of
     * the last byte within <code>buf</code> that
     * can ever be read  from the input stream buffer.
     */
    protected int count;

    private final Object lock = new Object();

    private final Object addLock = new Object();

    /**
     * Creates a <code>ByteArrayInputStream</code>
     * so that it  uses <code>buf</code> as its
     * buffer array.
     * The buffer array is not copied.
     * The initial value of <code>pos</code>
     * is <code>0</code> and the initial value
     * of  <code>count</code> is the length of
     * <code>buf</code>.
     *
     */
    public ByteQueueInputStream() {
        this.readQueue = new LinkedBlockingQueue<>();
        this.pos = 0;
        this.count = 0;

        // 最大20K
        this.currentBytes = null;
        this.isRunning = true;
    }

    public void openSocketForwardingMode() {
        this.socketForward = true;
    }

    public void closeSocketForwardingMode() {
        this.socketForward = false;
    }

    /**
     * 添加bytes到队列中
     * @param bytes
     */
    public void addBytes(byte[] bytes) {
        long startTime = System.currentTimeMillis();
        this.readQueue.add(bytes);
    }

    /**
     * 加载数据，直到当前bytes非空或者队列为空
     */
    private void pollToAvailable() {
        if (pos >= count) {
            synchronized (lock) {
                while (pos >= count) {
                    // 非forward模式，不强制poll
                    if (!socketForward) {
                        if (readQueue.isEmpty()) {
                            pos = 0;
                            count = 0;
                            return;
                        }
                    }

                    try {
                        currentBytes = this.readQueue.take();
                    } catch (InterruptedException e) {
                        e.printStackTrace();
                    }

                    // 重设
                    if (currentBytes != null) {
                        pos = 0;
                        count = currentBytes.length;
                    } else {
                        pos = 0;
                        count = 0;
                        break;
                    }
                }
            }
        }
    }

    /**
     * Reads the next byte of data from this input stream. The value
     * byte is returned as an <code>int</code> in the range
     * <code>0</code> to <code>255</code>. If no byte is available
     * because the end of the stream has been reached, the value
     * <code>-1</code> is returned.
     * <p>
     * This <code>read</code> method
     * cannot block.
     *
     * @return  the next byte of data, or <code>-1</code> if the end of the
     *          stream has been reached.
     */
    @Override
    public int read() {
        if (!isRunning) {
            return -1;
        }

        synchronized (addLock) {
            pollToAvailable();
            return (pos < count) ? currentBytes[pos++] & 0xff : -1;
        }
    }
    /**
     * Reads up to <code>len</code> bytes of data into an array of bytes
     * from this input stream.
     * If <code>pos</code> equals <code>count</code>,
     * then <code>-1</code> is returned to indicate
     * end of file. Otherwise, the  number <code>k</code>
     * of bytes read is equal to the smaller of
     * <code>len</code> and <code>count-pos</code>.
     * If <code>k</code> is positive, then bytes
     * <code>buf[pos]</code> through <code>buf[pos+k-1]</code>
     * are copied into <code>b[off]</code>  through
     * <code>b[off+k-1]</code> in the manner performed
     * by <code>System.arraycopy</code>. The
     * value <code>k</code> is added into <code>pos</code>
     * and <code>k</code> is returned.
     * <p>
     * This <code>read</code> method cannot block.
     *
     * @param   b     the buffer into which the data is read.
     * @param   off   the start offset in the destination array <code>b</code>
     * @param   len   the maximum number of bytes read.
     * @return  the total number of bytes read into the buffer, or
     *          <code>-1</code> if there is no more data because the end of
     *          the stream has been reached.
     * @exception  NullPointerException If <code>b</code> is <code>null</code>.
     * @exception  IndexOutOfBoundsException If <code>off</code> is negative,
     * <code>len</code> is negative, or <code>len</code> is greater than
     * <code>b.length - off</code>
     */
    @Override
    public int read(byte b[], int off, int len) {
        if (b == null) {
            throw new NullPointerException();
        } else if (off < 0 || len < 0 || len > b.length - off) {
            throw new IndexOutOfBoundsException();
        } else if (!isRunning) {
            return -1;
        }

        // 初始计数
        int realCount = -1;

        synchronized (addLock) {
            // 只填充一次数据，不需要按照len填充
            pollToAvailable();

            if (count - pos > 0) {
                int toCopy = Math.min(count - pos, len);
                System.arraycopy(currentBytes, pos, b, off, toCopy);

                pos += toCopy;
                realCount = toCopy;
            }

            return realCount;
        }
    }

    /**
     * Skips <code>n</code> bytes of input from this input stream. Fewer
     * bytes might be skipped if the end of the input stream is reached.
     * The actual number <code>k</code>
     * of bytes to be skipped is equal to the smaller
     * of <code>n</code> and  <code>count-pos</code>.
     * The value <code>k</code> is added into <code>pos</code>
     * and <code>k</code> is returned.
     *
     * @param   n   the number of bytes to be skipped.
     * @return  the actual number of bytes skipped.
     */
    @Override
    public long skip(long n) {
        synchronized (addLock) {
            // 首先移动到可用bytes
            pollToAvailable();

            // 初始计数
            int availableCount = count - pos;
            long leftCount = n < 0 ? 0 : n;
            long realCount = 0;

            // 当列表未填充完毕且仍有可用数据
            while (leftCount > 0 && availableCount > 0) {
                long toCopy = Math.min(availableCount, leftCount);

                pos += toCopy;
                leftCount -= toCopy;
                realCount += toCopy;

                // 移动到可用bytes
                pollToAvailable();

                // 重新计算可用数量
                availableCount = count - pos;
            }

            return realCount;
        }
    }

    /**
     * Returns the number of remaining bytes that can be read (or skipped over)
     * from this input stream.
     * <p>
     * The value returned is <code>count&nbsp;- pos</code>,
     * which is the number of bytes remaining to be read from the input buffer.
     *
     * @return  the number of remaining bytes that can be read (or skipped
     *          over) from this input stream without blocking.
     */
    @Override
    public int available() {

        return 0;
//        while (isRunning) {
//            int available;
//            synchronized (lock) {
//                pollToAvailable();
//                available = count - pos;
//            }
//
//            if (available <= 0) {
//                try {
//                    addLock.wait();
//                } catch (InterruptedException e) {
//                    e.printStackTrace();
//                }
//            } else {
//                return available;
//            }
//        }
//
//        return -1;
    }

    /**
     * Tests if this <code>InputStream</code> supports mark/reset. The
     * <code>markSupported</code> method of <code>ByteArrayInputStream</code>
     * always returns <code>true</code>.
     *
     * @since   JDK1.1
     */
    @Override
    public boolean markSupported() {
        return false;
    }

    /**
     * Set the current marked position in the stream.
     * ByteArrayInputStream objects are marked at position zero by
     * default when constructed.  They may be marked at another
     * position within the buffer by this method.
     * <p>
     * If no mark has been set, then the value of the mark is the
     * offset passed to the constructor (or 0 if the offset was not
     * supplied).
     *
     * <p> Note: The <code>readAheadLimit</code> for this class
     *  has no meaning.
     *
     * @since   JDK1.1
     */
    @Override
    public void mark(int readAheadLimit) {

    }

    /**
     * Resets the buffer to the marked position.  The marked position
     * is 0 unless another position was marked or an offset was specified
     * in the constructor.
     */
    @Override
    public void reset() {
    }

    /**
     * Closing a <tt>ByteArrayInputStream</tt> has no effect. The methods in
     * this class can be called after the stream has been closed without
     * generating an <tt>IOException</tt>.
     * <p>
     */
    @Override
    public void close() throws IOException {
        isRunning = false;
    }
}
