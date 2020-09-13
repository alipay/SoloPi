package com.alipay.hulu.scheme;

import android.content.Context;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.common.scheme.SchemeActionResolver;
import com.alipay.hulu.common.scheme.SchemeResolver;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;

import java.util.Map;

import static com.alipay.hulu.common.service.SPService.*;

@SchemeResolver("config")
public class ConfigSchemeResolver implements SchemeActionResolver {
    private static final String TAG = ConfigSchemeResolver.class.getSimpleName();

    private static final String KEY = "key";
    private static final String VALUE = "value";

    @Override
    public boolean processScheme(Context context, Map<String, String> params) {
        String key = params.get(KEY);
        String value = params.get(VALUE);
        if (StringUtil.isEmpty(key) || value == null) {
            return false;
        }

        return processConfigSet(key, value);
    }

    /**
     * 分别处理不同类型设置项
     * @param key
     * @param value
     * @return
     */
    private boolean processConfigSet(String key, String value) {
        switch (key) {
            case KEY_AUTO_CLEAR_FILES_DAYS:
                return processInt(key, value, null, -1);
            case KEY_SCREEN_FACTOR_ROTATION:
                return processInt(key, value, 3, 0);
            case KEY_SCREENSHOT_RESOLUTION:
                return processInt(key, value, null, 0);
            case KEY_DISPLAY_SYSTEM_APP:
            case KEY_HIGHLIGHT_REPLAY_NODE:
            case KEY_REPLAY_AUTO_START:
            case KEY_SCREEN_ROTATION:
            case KEY_RECORD_COVER_MODE:
                if (StringUtil.equalsIgnoreCase(value, "true")) {
                    LogUtil.i(TAG, "Update Config " + key + " to value " + true);
                    SPService.putBoolean(key, true);
                } else if (StringUtil.equalsIgnoreCase(value, "false")) {
                    LogUtil.i(TAG, "Update Config " + key + " to value " + false);
                    SPService.putBoolean(key, false);
                } else {
                    return false;
                }
                break;
            case KEY_GLOBAL_SETTINGS:
                JSONObject obj = JSON.parseObject(value);
                if (obj == null) {
                    return false;
                }
                LogUtil.i(TAG, "Update Config " + key + " to value " + obj);
                SPService.putString(key, obj.toJSONString());
                break;
            case KEY_OV_PASSWORD:
            case KEY_ADB_SERVER:
            case KEY_PATCH_URL:
            case KEY_PERFORMANCE_UPLOAD:
                LogUtil.i(TAG, "Update Config " + key + " to value " + value);
                SPService.putString(key, value);
                break;
        }
        return true;
    }

    /**
     * 处理数字
     * @param key
     * @param value
     * @param max
     * @param min
     * @return
     */
    private boolean processInt(String key, String value, Integer max, Integer min) {
        try {
            int val = Integer.parseInt(value);
            if (max != null && val > max) {
                LogUtil.w(TAG, "Value " + value + " bigger than max value: " + max + " for key " + key);
                return false;
            }

            if (min != null && val < min) {
                LogUtil.w(TAG, "Value " + value + " smaller than min value: " + min + " for key " + key);
                return false;
            }

            LogUtil.i(TAG, "Update Config " + key + " to value " + val);
            SPService.putInt(key, val);
            return true;
        } catch (NumberFormatException e) {
            LogUtil.e(TAG, "Can't parse int value " + value + " for key " + key, e);
            return false;
        }
    }
}
