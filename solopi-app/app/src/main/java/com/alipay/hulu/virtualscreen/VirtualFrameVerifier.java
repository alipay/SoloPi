package com.alipay.hulu.virtualscreen;

/** Checks an observed target against an on-demand image of the same owned display. */
public interface VirtualFrameVerifier {
    /** Returns null on a match, otherwise a stable refusal reason. Never dispatches input. */
    String verify(LatestFrameBuffer.Frame observed, VirtualActionGuard.Box target);
    /** Refresh the session's cached frame on the same display; null means accepted. */
    String refresh(LatestFrameBuffer buffer, long generation);
}
