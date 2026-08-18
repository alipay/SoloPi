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
import com.alipay.hulu.upgrade.PatchRequest;

import java.io.File;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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
    private static final String KEY = "key";
    private static final String VALUE = "value";

    private static final String TYPE_BOOLEAN = "boolean";
    private static final String TYPE_INT = "int";
    private static final String TYPE_LONG = "long";
    private static final String TYPE_STRING = "string";
    private static final String TYPE_JSON = "json";

    private static final Map<String, ConfigSpec> SPECS = buildSpecs();

    @Override
    public boolean processScheme(Context context, Map<String, String> params,
                                 Callback<Map<String, Object>> callback) {
        String action = params.get(ACTION);
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
        // 控制端口不是设置页控件，但属于既有 Scheme 能力。
        add(result, KEY_CONTROL_PORT, TYPE_INT, "本地控制服务端口（修改会中断当前控制会话）",
                23342, false, 5000L, 65535L);
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
        } else if (KEY_CONTROL_PORT.equals(key)) {
            LauncherApplication.getInstance().startHttpServerAtPort((Integer) parsed);
        }

        Map<String, Object> result = success();
        result.put("config", spec.toMap(true));
        return result;
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
