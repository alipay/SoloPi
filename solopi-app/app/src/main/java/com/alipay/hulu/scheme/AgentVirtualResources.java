package com.alipay.hulu.scheme;

/** Associates one closeable resource with the internally held device lease. */
final class AgentVirtualResources {
    interface Ownership { boolean owns(String leaseOwner); }
    interface Factory<T extends AutoCloseable> { T create() throws Exception; }
    interface Initializer<T extends AutoCloseable, R> { R initialize(T resource) throws Exception; }
    private final Ownership ownership;
    private String owner;
    private AutoCloseable resource;

    AgentVirtualResources(Ownership ownership) { this.ownership = ownership; }

    synchronized boolean attach(String leaseOwner, AutoCloseable value) {
        // Code security: only the current device-lease owner may register a screen.
        if (leaseOwner == null || value == null || resource != null || !ownership.owns(leaseOwner)) return false;
        owner = leaseOwner; resource = value;
        return true;
    }

    synchronized AutoCloseable getForLease(String leaseOwner) {
        // Code security: the caller receives only the resource attached to the current lease.
        if (leaseOwner == null || !leaseOwner.equals(owner) || !ownership.owns(leaseOwner)) return null;
        return resource;
    }

    /** Register partial resources before initialization can submit a physical side effect. */
    synchronized <T extends AutoCloseable, R> R initializeForLease(String leaseOwner, T value,
                                                                  Initializer<T, R> initializer) throws Exception {
        if (leaseOwner == null || value == null || initializer == null || resource != null || !ownership.owns(leaseOwner))
            throw new IllegalStateException("virtual_lease_unavailable");
        owner = leaseOwner;
        resource = value;
        try {
            R result = initializer.initialize(value);
            if (!ownership.owns(leaseOwner)) throw new IllegalStateException("virtual_lease_lost");
            return result;
        } catch (Exception failure) {
            if (!ownership.owns(leaseOwner)) {
                try {
                    value.close();
                    resource = null;
                    owner = null;
                } catch (Exception cleanup) {
                    throw new IllegalStateException("virtual_cleanup_unconfirmed", cleanup);
                }
            }
            throw failure;
        }
    }

    /** Creation and registration share the same lock as teardown. */
    synchronized <T extends AutoCloseable> T createForLease(String leaseOwner, Factory<T> factory) throws Exception {
        // Code security: reject before creating any display if this lease no longer owns the device.
        if (leaseOwner == null || factory == null || resource != null || !ownership.owns(leaseOwner)) {
            throw new IllegalStateException("virtual_lease_unavailable");
        }
        T created = factory.create();
        if (created == null) throw new IllegalStateException("virtual_resource_unavailable");
        owner = leaseOwner;
        resource = created;
        if (!ownership.owns(leaseOwner)) {
            // Creation raced external lease loss; retain a failed close for explicit recovery.
            try {
                created.close();
                resource = null;
                owner = null;
            } catch (Exception failure) {
                throw new IllegalStateException("virtual_cleanup_unconfirmed", failure);
            }
            throw new IllegalStateException("virtual_lease_lost");
        }
        return created;
    }

    synchronized boolean closeForLease(String leaseOwner) {
        if (resource == null) return true;
        if (leaseOwner == null || !leaseOwner.equals(owner) || !ownership.owns(leaseOwner)) return false;
        try {
            resource.close();
            resource = null; owner = null;
            return true;
        } catch (Exception failure) {
            // Retain the resource and its lease when cleanup cannot be confirmed.
            return false;
        }
    }
}
