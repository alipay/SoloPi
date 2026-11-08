package com.alipay.hulu.scheme;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Binder;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructPollfd;

import com.alipay.hulu.BuildConfig;

import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.util.concurrent.atomic.AtomicBoolean;

/** Debug-only pipe for the fixed synthetic reply fixture. */
public final class FixtureReplyPipeProvider extends ContentProvider {
    private static final int SHELL_UID = 2000;
    private static final AtomicBoolean BUSY = new AtomicBoolean();

    @Override public boolean onCreate() { return true; }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        // Code security: DUMP in the manifest and the actual Binder UID both gate the pipe.
        if (!BuildConfig.DEBUG || !BuildConfig.VIRTUAL_SCREEN_EXPERIMENTAL || Build.VERSION.SDK_INT < 21
                || Binder.getCallingUid() != SHELL_UID || !"w".equals(mode)
                || getContext() == null || !((getContext().getPackageName() + ".fixtureReplyPipe").equals(uri.getAuthority()))
                || !"/write".equals(uri.getPath()) || uri.getQuery() != null || uri.getFragment() != null)
            throw new SecurityException("Fixture pipe unavailable");
        if (!BUSY.compareAndSet(false, true)) throw new FileNotFoundException("Fixture pipe busy");
        final ParcelFileDescriptor[] pipe;
        try { pipe = ParcelFileDescriptor.createPipe(); }
        catch (Exception failure) { BUSY.set(false); throw new FileNotFoundException("Fixture pipe unavailable"); }
        try {
            new Thread(new Runnable() {
                @Override public void run() {
                    try {
                        byte[] bytes = receive(pipe[0]);
                        FixturePipeFrame frame = FixturePipeFrame.parse(bytes);
                        AgentSessionSchemeResolver.scheduleFixturePipe(frame.params, frame.send);
                    } catch (Exception ignored) {
                        // Code security: no payload, caller data or exception detail enters logs.
                    } finally {
                        try { pipe[0].close(); } catch (Exception ignored) { }
                        BUSY.set(false);
                    }
                }
            }, "fixture-reply-pipe").start();
            return pipe[1];
        } catch (RuntimeException failure) {
            try { pipe[0].close(); } catch (Exception ignored) { }
            try { pipe[1].close(); } catch (Exception ignored) { }
            BUSY.set(false);
            throw new FileNotFoundException("Fixture pipe unavailable");
        }
    }

    private static byte[] receive(ParcelFileDescriptor input) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 10000L;
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        StructPollfd poll = new StructPollfd();
        poll.fd = input.getFileDescriptor();
        poll.events = (short) (OsConstants.POLLIN | OsConstants.POLLHUP);
        while (true) {
            long remaining = deadline - SystemClock.elapsedRealtime();
            if (remaining <= 0 || Os.poll(new StructPollfd[]{poll}, (int) remaining) <= 0) throw new java.io.IOException("Pipe timeout");
            int size = Os.read(poll.fd, buffer, 0, buffer.length);
            if (size == 0) return output.toByteArray();
            if (output.size() + size > FixturePipeFrame.MAX_BYTES) throw new java.io.IOException("Frame too large");
            output.write(buffer, 0, size);
        }
    }

    @Override public String getType(Uri uri) { return "application/octet-stream"; }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) { throw new UnsupportedOperationException(); }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
