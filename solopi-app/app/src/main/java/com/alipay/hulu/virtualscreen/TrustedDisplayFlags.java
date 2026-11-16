package com.alipay.hulu.virtualscreen;

/** The helper never requests an always-unlocked display or modifies primary-display settings. */
final class TrustedDisplayFlags {
    static int forSdk(int sdk) {
        if (sdk < 30) throw new IllegalArgumentException("trusted_display_unsupported");
        int flags = (1 << 0) | (1 << 3) | (1 << 6) | (1 << 7) | (1 << 8) | (1 << 10);
        if (sdk >= 33) flags |= 1 << 13;
        if (sdk >= 34) flags |= (1 << 14) | (1 << 16);
        return flags;
    }
    private TrustedDisplayFlags() { }
}
