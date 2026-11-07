package com.alipay.hulu.scheme;

import org.junit.Test;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.Assert.*;

public class AgentVirtualResourcesTest {
    private static final class Resource implements AutoCloseable {
        int closes;
        boolean fail;
        @Override public void close() throws Exception { closes++; if (fail) throw new Exception("failed"); }
    }
    @Test public void onlyTheLeaseOwnerCanAttachAndRelease() {
        AgentVirtualResources slot = new AgentVirtualResources(new AgentVirtualResources.Ownership() {
            @Override public boolean owns(String owner) { return "lease-a".equals(owner); }
        });
        Resource resource = new Resource();
        assertFalse(slot.attach("lease-b", resource));
        assertTrue(slot.attach("lease-a", resource));
        assertSame(resource, slot.getForLease("lease-a"));
        assertNull(slot.getForLease("lease-b"));
        assertFalse(slot.attach("lease-a", new Resource()));
        assertFalse(slot.closeForLease("lease-b"));
        assertEquals(0, resource.closes);
        assertTrue(slot.closeForLease("lease-a"));
        assertTrue(slot.closeForLease("lease-a"));
        assertEquals(1, resource.closes);
        assertNull(slot.getForLease("lease-a"));
    }
    @Test public void failedCleanupRetainsOwnershipAndCanBeRetried() {
        AgentVirtualResources slot = new AgentVirtualResources(new AgentVirtualResources.Ownership() {
            @Override public boolean owns(String owner) { return "lease-a".equals(owner); }
        });
        Resource resource = new Resource(); resource.fail = true;
        assertTrue(slot.attach("lease-a", resource));
        assertFalse(slot.closeForLease("lease-a"));
        assertFalse(slot.attach("lease-a", new Resource()));
        resource.fail = false;
        assertTrue(slot.closeForLease("lease-a"));
        assertEquals(2, resource.closes);
    }
    @Test public void failedInitializationRetainsPartialResourceForCleanup() throws Exception {
        AgentVirtualResources slot = new AgentVirtualResources(new AgentVirtualResources.Ownership() {
            @Override public boolean owns(String owner) { return "lease-a".equals(owner); }
        });
        Resource resource = new Resource();
        try {
            slot.initializeForLease("lease-a", resource, new AgentVirtualResources.Initializer<Resource, Object>() {
                @Override public Object initialize(Resource value) throws Exception { throw new Exception("uncertain_create"); }
            });
            fail("initialization must fail");
        } catch (Exception expected) { assertEquals("uncertain_create", expected.getMessage()); }
        assertSame(resource, slot.getForLease("lease-a"));
        resource.fail = true;
        assertFalse(slot.closeForLease("lease-a"));
        assertSame(resource, slot.getForLease("lease-a"));
        resource.fail = false;
        assertTrue(slot.closeForLease("lease-a"));
    }
    @Test public void leaseLossDuringInitializationClosesPartialResource() throws Exception {
        final AtomicBoolean owned = new AtomicBoolean(true);
        AgentVirtualResources slot = new AgentVirtualResources(new AgentVirtualResources.Ownership() {
            @Override public boolean owns(String owner) { return owned.get(); }
        });
        final Resource resource = new Resource();
        try {
            slot.initializeForLease("lease-a", resource, new AgentVirtualResources.Initializer<Resource, Object>() {
                @Override public Object initialize(Resource value) { owned.set(false); return new Object(); }
            });
            fail("lost lease must reject initialization");
        } catch (IllegalStateException expected) { assertEquals("virtual_lease_lost", expected.getMessage()); }
        assertEquals(1, resource.closes);
        owned.set(true);
        assertNull(slot.getForLease("lease-a"));
    }
    @Test public void cleanupWaitsUntilCreationHasRegisteredTheResource() throws Exception {
        final AgentVirtualResources slot = new AgentVirtualResources(new AgentVirtualResources.Ownership() {
            @Override public boolean owns(String owner) { return "lease-a".equals(owner); }
        });
        final Resource resource = new Resource();
        final CountDownLatch insideFactory = new CountDownLatch(1);
        final CountDownLatch finishFactory = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<Resource> creation = executor.submit(new Callable<Resource>() {
                @Override public Resource call() throws Exception {
                    return slot.createForLease("lease-a", new AgentVirtualResources.Factory<Resource>() {
                        @Override public Resource create() throws Exception {
                            insideFactory.countDown();
                            if (!finishFactory.await(2, TimeUnit.SECONDS)) throw new IllegalStateException("timeout");
                            return resource;
                        }
                    });
                }
            });
            assertTrue(insideFactory.await(2, TimeUnit.SECONDS));
            Future<Boolean> cleanup = executor.submit(new Callable<Boolean>() {
                @Override public Boolean call() { return slot.closeForLease("lease-a"); }
            });
            finishFactory.countDown();
            assertSame(resource, creation.get(2, TimeUnit.SECONDS));
            assertTrue(cleanup.get(2, TimeUnit.SECONDS));
            assertEquals(1, resource.closes);
        } finally {
            finishFactory.countDown();
            executor.shutdownNow();
        }
    }
    @Test public void leaseLossDuringCreationClosesTheNewResource() throws Exception {
        final AtomicBoolean owned = new AtomicBoolean(true);
        AgentVirtualResources slot = new AgentVirtualResources(new AgentVirtualResources.Ownership() {
            @Override public boolean owns(String owner) { return owned.get(); }
        });
        final Resource resource = new Resource();
        try {
            slot.createForLease("lease-a", new AgentVirtualResources.Factory<Resource>() {
                @Override public Resource create() { owned.set(false); return resource; }
            });
            fail("lease loss must reject creation");
        } catch (IllegalStateException expected) {
            assertEquals("virtual_lease_lost", expected.getMessage());
        }
        assertEquals(1, resource.closes);
    }
    @Test public void failedCloseAfterLeaseLossRetainsTheResource() throws Exception {
        final AtomicBoolean owned = new AtomicBoolean(true);
        AgentVirtualResources slot = new AgentVirtualResources(new AgentVirtualResources.Ownership() {
            @Override public boolean owns(String owner) { return owned.get(); }
        });
        final Resource resource = new Resource();
        resource.fail = true;
        try {
            slot.createForLease("lease-a", new AgentVirtualResources.Factory<Resource>() {
                @Override public Resource create() { owned.set(false); return resource; }
            });
            fail("unconfirmed close must reject creation");
        } catch (IllegalStateException expected) {
            assertEquals("virtual_cleanup_unconfirmed", expected.getMessage());
        }
        assertFalse(slot.closeForLease("lease-a"));
        owned.set(true);
        resource.fail = false;
        assertTrue(slot.closeForLease("lease-a"));
        assertEquals(2, resource.closes);
    }
}
