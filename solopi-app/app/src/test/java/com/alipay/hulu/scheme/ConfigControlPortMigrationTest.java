package com.alipay.hulu.scheme;

import org.junit.Test;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.Assert.*;

public class ConfigControlPortMigrationTest {
    static class Runtime extends ConfigSchemeResolver.PortMigrationRuntime {
        boolean maintenance = true;
        boolean idle = true;
        boolean bound = true;
        boolean crash;
        int begins;
        int ends;
        int migrations;
        @Override String packageName() { return "com.alipay.hulu.fastpath"; }
        @Override int currentPort() { return 23343; }
        @Override boolean beginMaintenance(String owner) { begins++; return maintenance; }
        @Override void endMaintenance(String owner) { ends++; }
        @Override boolean idle() { return idle; }
        @Override boolean migrate(int port) {
            migrations++;
            if (crash) throw new IllegalStateException("private detail");
            assertEquals(23344, port);
            return bound;
        }
    }

    private Map<String, String> request() {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("action", "control-port-set");
        params.put("port", "23344");
        params.put("confirmIdle", "true");
        params.put("requestId", UUID.randomUUID().toString());
        return params;
    }

    @Test public void transportAndExplicitIdleConfirmationPrecedeEveryMutation() {
        Runtime runtime = new Runtime();
        Map<String, String> params = request();
        assertEquals("mutation_transport_required",
                ConfigSchemeResolver.migrateControlPort(params, false, runtime).get("errorCode"));
        params.remove("confirmIdle");
        assertEquals("idle_confirmation_required",
                ConfigSchemeResolver.migrateControlPort(params, true, runtime).get("errorCode"));
        assertEquals(0, runtime.begins);
        assertEquals(0, runtime.migrations);
    }

    @Test public void arbitraryConfigKeysAndHostsAreRejected() {
        for (String key : new String[]{"key", "value", "host"}) {
            Runtime runtime = new Runtime();
            Map<String, String> params = request();
            params.put(key, "KEY_PATCH_URL");
            assertEquals("invalid_port_migration",
                    ConfigSchemeResolver.migrateControlPort(params, true, runtime).get("errorCode"));
            assertEquals(0, runtime.begins);
        }
    }

    @Test public void malformedPortsAndRequestIdsNeverReachTheRuntime() {
        for (String port : new String[]{"80", "1023", "65536", "-1", "23344;id", "23344\n", "023344"}) {
            Runtime runtime = new Runtime();
            Map<String, String> params = request();
            params.put("port", port);
            assertEquals("invalid_control_port",
                    ConfigSchemeResolver.migrateControlPort(params, true, runtime).get("errorCode"));
            assertEquals(0, runtime.begins);
        }
        Runtime runtime = new Runtime();
        Map<String, String> params = request();
        params.put("requestId", "../request");
        assertEquals("invalid_request_id",
                ConfigSchemeResolver.migrateControlPort(params, true, runtime).get("errorCode"));
        assertEquals(0, runtime.begins);
    }

    @Test public void busyAndUnknownActivityCannotChangeThePort() {
        Runtime busy = new Runtime();
        busy.maintenance = false;
        assertEquals("control_port_busy",
                ConfigSchemeResolver.migrateControlPort(request(), true, busy).get("errorCode"));
        assertEquals(0, busy.ends);
        assertEquals(0, busy.migrations);
        Runtime unknown = new Runtime();
        unknown.idle = false;
        assertEquals("control_port_not_idle",
                ConfigSchemeResolver.migrateControlPort(request(), true, unknown).get("errorCode"));
        assertEquals(1, unknown.ends);
        assertEquals(0, unknown.migrations);
    }

    @Test public void successfulReceiptIsBoundToTheExactRequestPackageAndPort() {
        Runtime runtime = new Runtime();
        Map<String, String> params = request();
        Map<String, Object> result = ConfigSchemeResolver.migrateControlPort(params, true, runtime);
        assertEquals(true, result.get("success"));
        assertEquals(true, result.get("terminal"));
        assertEquals("completed", result.get("state"));
        assertEquals("com.alipay.hulu.fastpath", result.get("packageName"));
        assertEquals(params.get("requestId"), result.get("requestId"));
        assertEquals(23343, result.get("previousPort"));
        assertEquals(23344, result.get("devicePort"));
        assertEquals(1, runtime.ends);
        Map<String, Object> read = ConfigSchemeResolver.portReceipt(params.get("requestId"));
        assertEquals(result, read);
        read.put("success", false);
        assertEquals(true, ConfigSchemeResolver.portReceipt(params.get("requestId")).get("success"));
    }

    @Test public void duplicateRequestsDoNotRepeatOrRetargetTheMutation() {
        Runtime runtime = new Runtime();
        Map<String, String> params = request();
        Map<String, Object> result = ConfigSchemeResolver.migrateControlPort(params, true, runtime);
        assertEquals(result, ConfigSchemeResolver.migrateControlPort(params, true, runtime));
        assertEquals(1, runtime.migrations);
        params.put("port", "23345");
        assertEquals("request_id_conflict",
                ConfigSchemeResolver.migrateControlPort(params, true, runtime).get("errorCode"));
        assertEquals(1, runtime.migrations);
    }

    @Test public void bindFailuresAndExceptionsProduceTerminalFailureAndReleaseMaintenance() {
        for (boolean crash : new boolean[]{false, true}) {
            Runtime runtime = new Runtime();
            runtime.bound = false;
            runtime.crash = crash;
            Map<String, String> params = request();
            Map<String, Object> result = ConfigSchemeResolver.migrateControlPort(params, true, runtime);
            assertEquals(false, result.get("success"));
            assertEquals(true, result.get("terminal"));
            assertEquals("failed", result.get("state"));
            assertEquals(crash ? "control_port_migration_failed" : "control_port_bind_failed", result.get("errorCode"));
            assertFalse(String.valueOf(result).contains("private detail"));
            assertEquals(1, runtime.ends);
            assertEquals(result, ConfigSchemeResolver.portReceipt(params.get("requestId")));
        }
    }
}
