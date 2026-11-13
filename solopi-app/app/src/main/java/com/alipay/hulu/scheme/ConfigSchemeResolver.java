/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.alipay.hulu.scheme;

import android.app.Activity;
import android.content.Context;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.scheme.SchemeActionResolver;
import com.alipay.hulu.common.scheme.AdbSchemeActivity;
import com.alipay.hulu.common.scheme.SchemeResolver;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.utils.Callback;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.common.utils.RuntimeSessionGuard;
import com.alipay.hulu.common.utils.SortedList;
import com.alipay.hulu.screenRecord.ScreenRecorderLease;
import com.alipay.hulu.upgrade.PatchRequest;

import java.io.File;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Collections;

import static com.alipay.hulu.common.service.SPService.*;

/**
 * SoloPi 设置的类型化查询与 ADB-only 修改入口。
 *
 * HTTP 只允许 list/get；set 必须从受系统权限保护的 ADB Activity 进入。
 */
@SchemeResolver("config")
public class ConfigSchemeResolver implements SchemeActionResolver {
    private static final String ACTION = "action";
    private static final String ACTION_LIST = "list";
    private static final String ACTION_GET = "get";
    private static final String ACTION_SET = "set";
    private static final String ACTION_CONTROL_PORT_SET = "control-port-set";
    private static final String ACTION_CONTROL_PORT_RECEIPT = "control-port-receipt";
    private static final String KEY = "key";
    private static final String VALUE = "value";

    private static final String TYPE_BOOLEAN = "boolean";
    private static final String TYPE_INT = "int";
    private static final String TYPE_LONG = "long";
    private static final String TYPE_STRING = "string";
    private static final String TYPE_JSON = "json";

    private static final Map<String, ConfigSpec> SPECS = buildSpecs();
    private static final Map<String, Map<String, Object>> PORT_RECEIPTS = new LinkedHashMap<>();

    @Override
    public boolean processScheme(Context context, Map<String, String> params,
                                 Callback<Map<String, Object>> callback) {
        String action = params.get(ACTION);
        if (ACTION_CONTROL_PORT_SET.equals(action)) {
            callback.onResult(migrateControlPort(params, context instanceof AdbSchemeActivity,
                    new PortMigrationRuntime()));
            return true;
        }
        if (ACTION_CONTROL_PORT_RECEIPT.equals(action)) {
            callback.onResult(portReceipt(params.get("requestId")));
            return true;
        }
        // 兼容已有 ADB Scheme：config?key=...&value=...
        if (StringUtil.isEmpty(action) && params.containsKey(KEY) && params.containsKey(VALUE)) {
            action = ACTION_SET;
        }

        if (ACTION_LIST.equals(action)) {
            callback.onResult(listConfigs());
            return true;
        }
        if (ACTION_GET.equals(action)) {
            callback.onResult(getConfig(params.get(KEY)));
            return true;
        }
        if (ACTION_SET.equals(action)) {
            if (!(context instanceof AdbSchemeActivity)) {
                callback.onResult(error("mutation_transport_required",
                        "Config changes require the ADB scheme transport"));
                return true;
            }
            callback.onResult(setConfig(params.get(KEY), params.get(VALUE)));
            return true;
        }

        callback.onResult(error("unsupported_action", "Unsupported config action"));
        return true;
    }

    private static Map<String, ConfigSpec> buildSpecs() {
        Map<String, ConfigSpec> result = new LinkedHashMap<>();
        // 外发地址、远程代码源和内部 ADB 目标只允许在 App 中修改，CLI 只读。
        add(result, KEY_PERFORMANCE_UPLOAD, TYPE_STRING, "性能数据上传地址", "", false, null, null);
        add(result, KEY_RECORD_SCREEN_UPLOAD, TYPE_STRING, "响应耗时录屏上传地址", "", false, null, null);
        add(result, KEY_PATCH_URL, TYPE_STRING, "插件源地址", PatchRequest.DEFAULT_PATCH_URL, false, null, null);
        add(result, KEY_OUTPUT_CHARSET, TYPE_STRING, "导出文件编码", "GBK", true, null, null);
        add(result, KEY_USE_LANGUAGE, TYPE_INT, "界面语言：0 跟随系统，1 中文，2 English", 0, true, 0L, 2L);
        add(result, KEY_ALLOW_REPLAY_DIFFERENT_APP, TYPE_BOOLEAN, "允许跨应用回放", false, true, null, null);
        add(result, KEY_RESTART_APP_ON_PLAY, TYPE_BOOLEAN, "回放前重启目标应用", true, true, null, null);
        add(result, KEY_DISPLAY_SYSTEM_APP, TYPE_BOOLEAN, "目标应用列表显示系统应用", false, true, null, null);
        add(result, KEY_REPLAY_AUTO_START, TYPE_BOOLEAN, "进入回放后自动开始", false, true, null, null);
        add(result, KEY_RECORD_COVER_MODE, TYPE_BOOLEAN, "录制覆盖模式", false, true, null, null);
        add(result, KEY_SKIP_ACCESSIBILITY, TYPE_BOOLEAN, "跳过自动开启辅助功能", true, true, null, null);
        add(result, KEY_MAX_WAIT_TIME, TYPE_LONG, "页面节点最长等待毫秒数", 10000L, true, 1L, 600000L);
        add(result, KEY_MAX_SCROLL_FIND_COUNT, TYPE_INT, "滑动查找节点的最大次数", 2, true, 0L, 100L);
        add(result, KEY_AUTO_CLEAR_FILES_DAYS, TYPE_INT, "自动清理文件天数，-1 表示关闭", 3, true, -1L, 3650L);
        add(result, KEY_SCREENSHOT_RESOLUTION, TYPE_INT, "截图短边分辨率", 720, true, 1L, 4320L);
        add(result, KEY_HIGHLIGHT_REPLAY_NODE, TYPE_BOOLEAN, "回放时高亮目标节点", true, true, null, null);
        add(result, KEY_CHECK_UPDATE, TYPE_BOOLEAN, "启动时检查更新", true, true, null, null);
        add(result, KEY_ADB_SERVER, TYPE_STRING, "SoloPi 内部 ADB 地址", "localhost:5555", false, null, null);
        add(result, KEY_HIDE_LOG, TYPE_BOOLEAN, "日志隐藏节点敏感信息", true, true, null, null);
        add(result, KEY_SCREEN_FACTOR_ROTATION, TYPE_INT,
                "默认屏幕方向索引：0/1/2/3（对应 0/90/180/270 度）", 0, true, 0L, 3L);
        add(result, KEY_SCREEN_ROTATION, TYPE_BOOLEAN, "交换屏幕坐标轴", false, true, null, null);
        // 全局参数和加密密钥可能包含业务敏感数据，不通过本机 HTTP 控制面读取或修改。
        add(result, KEY_GLOBAL_SETTINGS, TYPE_JSON, "全局参数 JSON 对象（敏感，仅 App UI）",
                "{}", false, null, null);
        // 这两个设置会迁移已有数据或存储目录，必须继续通过 App UI 完成。
        add(result, KEY_AES_KEY, TYPE_STRING, "用例参数加密密钥（修改会迁移历史用例）",
                "com.alipay.hulu", false, null, null);
        add(result, KEY_BASE_DIR, TYPE_STRING, "SoloPi 数据根目录（修改会切换存储目录）",
                "", false, null, null);
        // 通用 set 保持只读；仅固定、受 DUMP 保护的维护操作可以迁移此端口。
        add(result, KEY_CONTROL_PORT, TYPE_INT, "本地控制服务端口（修改会中断当前控制会话）",
                SPService.getDefaultControlPort(), false, 1024L, 65535L);
        return result;
    }

    private static void add(Map<String, ConfigSpec> specs, String key, String type,
                            String description, Object defaultValue, boolean writable,
                            Long min, Long max) {
        specs.put(key, new ConfigSpec(key, type, description, defaultValue, writable, min, max));
    }

    private Map<String, Object> listConfigs() {
        List<Map<String, Object>> configs = new ArrayList<>();
        for (ConfigSpec spec : SPECS.values()) {
            configs.add(spec.toMap(false));
        }
        Map<String, Object> result = success();
        result.put("count", configs.size());
        result.put("configs", configs);
        return result;
    }

    private Map<String, Object> getConfig(String key) {
        ConfigSpec spec = SPECS.get(key);
        if (spec == null) {
            return error("unsupported_config", "Unsupported config key: " + key);
        }
        Map<String, Object> result = success();
        result.put("config", spec.toMap(true));
        return result;
    }

    private Map<String, Object> setConfig(String key, String value) {
        ConfigSpec spec = SPECS.get(key);
        if (spec == null) {
            return error("unsupported_config", "Unsupported config key: " + key);
        }
        if (!spec.writable) {
            if (isSensitiveConfig(key)) {
                return error("sensitive_config_ui_required",
                        "This sensitive config is available only in the SoloPi UI: " + key);
            }
            return error("ui_migration_required",
                    "This config changes stored data and must be updated in the SoloPi UI: " + key);
        }
        if (value == null) {
            return error("missing_value", "Config value is required");
        }

        Object parsed;
        try {
            parsed = spec.parse(value);
        } catch (IllegalArgumentException e) {
            return error("invalid_config_value", e.getMessage());
        }

        if (TYPE_BOOLEAN.equals(spec.type)) {
            SPService.putBoolean(key, (Boolean) parsed);
        } else if (TYPE_INT.equals(spec.type)) {
            SPService.putInt(key, (Integer) parsed);
        } else if (TYPE_LONG.equals(spec.type)) {
            SPService.putLong(key, (Long) parsed);
        } else {
            SPService.putString(key, String.valueOf(parsed));
        }

        if (KEY_DISPLAY_SYSTEM_APP.equals(key)) {
            MyApplication.getInstance().reloadAppList();
        } else if (KEY_USE_LANGUAGE.equals(key)) {
            LauncherApplication.getInstance().setApplicationLanguage();
            LauncherApplication.getInstance().restartAllServices();
        } else if (KEY_SCREEN_FACTOR_ROTATION.equals(key)) {
            int rotation = (Integer) parsed;
            SPService.putBoolean(KEY_SCREEN_ROTATION, rotation == 1 || rotation == 3);
        } else if (KEY_BASE_DIR.equals(key)) {
            File target = new File(String.valueOf(parsed));
            FileUtils.setSolopiBaseDir(target.getAbsolutePath());
        }

        Map<String, Object> result = success();
        result.put("config", spec.toMap(true));
        return result;
    }

    static Map<String, Object> migrateControlPort(Map<String, String> params,
                                                 boolean adbTransport, PortMigrationRuntime runtime) {
        // Code security: this branch has no arbitrary key or host. The trusted
        // transport comes from the final, manifest DUMP-protected Activity class.
        if (!adbTransport) {
            return error("mutation_transport_required", "Port migration requires the ADB scheme transport");
        }
        String requestId = params.get("requestId");
        if (requestId == null || !requestId.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,127}")) {
            return error("invalid_request_id", "A valid migration requestId is required");
        }
        if (!"true".equals(params.get("confirmIdle"))) {
            return error("idle_confirmation_required", "Explicit idle confirmation is required");
        }
        if (params.size() != 4 || !params.containsKey(ACTION) || !params.containsKey("port")) {
            return error("invalid_port_migration", "Only action, port, confirmIdle and requestId are supported");
        }
        final int port;
        try {
            String rawPort = params.get("port");
            if (rawPort == null || !rawPort.matches("[0-9]{4,5}")) {
                throw new NumberFormatException();
            }
            port = Integer.parseInt(rawPort);
            if (port < 1024 || port > 65535) {
                throw new NumberFormatException();
            }
        } catch (NumberFormatException e) {
            return error("invalid_control_port", "Control port must be an integer from 1024 to 65535");
        }
        synchronized (PORT_RECEIPTS) {
            Map<String, Object> existing = PORT_RECEIPTS.get(requestId);
            if (existing != null) {
                return Integer.valueOf(port).equals(existing.get("devicePort"))
                        ? new LinkedHashMap<>(existing)
                        : error("request_id_conflict", "Migration requestId was already used for another port");
            }
            String owner = "control-port-migration:" + requestId;
            Map<String, Object> receipt = success();
            receipt.put("requestId", requestId);
            receipt.put("action", ACTION_CONTROL_PORT_SET);
            receipt.put("devicePort", port);
            receipt.put("packageName", runtime.packageName());
            receipt.put("terminal", true);
            boolean maintenance = false;
            try {
                maintenance = runtime.beginMaintenance(owner);
                if (!maintenance) {
                    receipt.putAll(error("control_port_busy", "An active session or maintenance operation blocks migration"));
                } else if (!runtime.idle()) {
                    receipt.putAll(error("control_port_not_idle", "Unable to verify that all control consumers are idle"));
                } else {
                    receipt.put("previousPort", runtime.currentPort());
                    boolean migrated = runtime.migrate(port);
                    receipt.putAll(migrated ? success()
                            : error("control_port_bind_failed", "The new loopback port could not be bound; the previous service was retained"));
                }
            } catch (RuntimeException e) {
                receipt.putAll(error("control_port_migration_failed", "Unable to complete control port migration"));
            } finally {
                if (maintenance) {
                    runtime.endMaintenance(owner);
                }
            }
            receipt.put("state", Boolean.TRUE.equals(receipt.get("success")) ? "completed" : "failed");
            PORT_RECEIPTS.put(requestId, new LinkedHashMap<>(receipt));
            while (PORT_RECEIPTS.size() > 32) {
                PORT_RECEIPTS.remove(PORT_RECEIPTS.keySet().iterator().next());
            }
            return receipt;
        }
    }

    static Map<String, Object> portReceipt(String requestId) {
        synchronized (PORT_RECEIPTS) {
            Map<String, Object> receipt = PORT_RECEIPTS.get(requestId);
            return receipt == null ? error("control_port_receipt_not_found", "Migration receipt is unavailable")
                    : new LinkedHashMap<>(receipt);
        }
    }

    static class PortMigrationRuntime {
        String packageName() { return LauncherApplication.getContext().getPackageName(); }
        int currentPort() { return SPService.getInt(KEY_CONTROL_PORT, SPService.getDefaultControlPort()); }
        boolean beginMaintenance(String owner) { return RuntimeSessionGuard.beginMaintenance(owner); }
        void endMaintenance(String owner) { RuntimeSessionGuard.endMaintenance(owner); }
        boolean migrate(int port) { return LauncherApplication.getInstance().migrateControlServerPort(port); }

        boolean idle() {
            // Code security: maintenance is held while checking and switching;
            // guarded record/replay/Agent/performance sessions cannot start here.
            if (ScreenRecorderLease.isHeld()) {
                return false;
            }
            return queryIdle("record", Collections.singletonMap("recordMode", "status"))
                    && queryIdle("performance", Collections.singletonMap("mode", "status"))
                    && queryIdle("performance", displayStatus())
                    && queryIdle("stress", Collections.singletonMap("action", "status"))
                    && queryIdle("screen-record", Collections.singletonMap("action", "status"))
                    && queryIdle("scan", Collections.singletonMap("action", "status"));
        }

        private Map<String, String> displayStatus() {
            Map<String, String> params = new LinkedHashMap<>();
            params.put("mode", "display");
            params.put("action", "status");
            return params;
        }

        private boolean queryIdle(String scheme, Map<String, String> params) {
            Map<String, SortedList<SchemeActionResolver>> registry = LauncherApplication.getInstance().getSchemeResolver();
            SortedList<SchemeActionResolver> resolvers = registry == null ? null : registry.get(scheme);
            if (resolvers == null) {
                return false;
            }
            for (SchemeActionResolver resolver : resolvers) {
                final Map<String, Object>[] result = new Map[1];
                final boolean[] failed = {false};
                boolean handled = resolver.processScheme(LauncherApplication.getContext(), params,
                        new Callback<Map<String, Object>>() {
                            @Override public void onResult(Map<String, Object> value) { result[0] = value; }
                            @Override public void onFailed() { failed[0] = true; }
                        });
                if (!handled) {
                    continue;
                }
                Map<String, Object> status = result[0];
                if (failed[0] || status == null || !Boolean.TRUE.equals(status.get("success"))
                        || !Boolean.FALSE.equals(status.get("active"))) {
                    return false;
                }
                if (Boolean.TRUE.equals(status.get("manualScanActive"))
                        || Boolean.TRUE.equals(status.get("protocolActivityAttached"))) {
                    return false;
                }
                Object items = status.get("runningItems");
                if (items instanceof java.util.Collection && !((java.util.Collection) items).isEmpty()) {
                    return false;
                }
                for (String key : new String[]{"targetCpuCount", "activeCpuCount", "targetMemoryMb", "actualMemoryMb"}) {
                    Object value = status.get(key);
                    if (value instanceof Number && ((Number) value).longValue() > 0L) {
                        return false;
                    }
                }
                return true;
            }
            return false;
        }
    }

    private static Object read(ConfigSpec spec) {
        try {
            if (TYPE_BOOLEAN.equals(spec.type)) {
                return SPService.getBoolean(spec.key, (Boolean) spec.defaultValue);
            }
            if (TYPE_INT.equals(spec.type)) {
                return SPService.getInt(spec.key, (Integer) spec.defaultValue);
            }
            if (TYPE_LONG.equals(spec.type)) {
                return SPService.getLong(spec.key, (Long) spec.defaultValue);
            }
            return SPService.getString(spec.key, String.valueOf(spec.defaultValue));
        } catch (ClassCastException e) {
            return spec.defaultValue;
        }
    }

    private static Map<String, Object> success() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        return result;
    }

    private static Map<String, Object> error(String code, String message) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", false);
        result.put("errorCode", code);
        result.put("error", message);
        return result;
    }

    private static class ConfigSpec {
        final String key;
        final String type;
        final String description;
        final Object defaultValue;
        final boolean writable;
        final Long min;
        final Long max;

        ConfigSpec(String key, String type, String description, Object defaultValue,
                   boolean writable, Long min, Long max) {
            this.key = key;
            this.type = type;
            this.description = description;
            this.defaultValue = defaultValue;
            this.writable = writable;
            this.min = min;
            this.max = max;
        }

        Object parse(String value) {
            if (TYPE_BOOLEAN.equals(type)) {
                if ("true".equalsIgnoreCase(value)) {
                    return true;
                }
                if ("false".equalsIgnoreCase(value)) {
                    return false;
                }
                throw new IllegalArgumentException("Boolean config requires true or false");
            }
            if (TYPE_INT.equals(type) || TYPE_LONG.equals(type)) {
                final long parsed;
                try {
                    parsed = Long.parseLong(value);
                } catch (NumberFormatException e) {
                    throw new IllegalArgumentException("Numeric config requires an integer");
                }
                if (min != null && parsed < min || max != null && parsed > max) {
                    throw new IllegalArgumentException("Config value is outside the supported range");
                }
                if (TYPE_INT.equals(type)) {
                    return (int) parsed;
                }
                return parsed;
            }
            if (TYPE_JSON.equals(type)) {
                JSONObject object;
                try {
                    object = JSON.parseObject(value);
                } catch (RuntimeException e) {
                    throw new IllegalArgumentException("JSON config requires an object");
                }
                if (object == null) {
                    throw new IllegalArgumentException("JSON config requires an object");
                }
                return object.toJSONString();
            }
            if (value.length() > 4096 || containsControlCharacter(value)) {
                throw new IllegalArgumentException("String config is too long or contains control characters");
            }
            if (KEY_OUTPUT_CHARSET.equals(key) && !Charset.isSupported(value)) {
                throw new IllegalArgumentException("Unsupported output charset");
            }
            return value;
        }

        Map<String, Object> toMap(boolean includeValue) {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("key", key);
            result.put("type", type);
            result.put("description", description);
            result.put("default", defaultValue);
            result.put("writable", writable);
            boolean sensitive = isSensitiveConfig(key);
            result.put("sensitive", sensitive);
            if (min != null) {
                result.put("min", min);
            }
            if (max != null) {
                result.put("max", max);
            }
            if (includeValue) {
                result.put("redacted", sensitive);
                result.put("value", sensitive ? null : read(this));
            }
            return result;
        }
    }

    private static boolean isSensitiveConfig(String key) {
        return KEY_AES_KEY.equals(key) || KEY_GLOBAL_SETTINGS.equals(key);
    }

    private static boolean containsControlCharacter(String value) {
        for (int i = 0; i < value.length(); i++) {
            char character = value.charAt(i);
            if (character < 0x20 || character == 0x7f) {
                return true;
            }
        }
        return false;
    }
}
