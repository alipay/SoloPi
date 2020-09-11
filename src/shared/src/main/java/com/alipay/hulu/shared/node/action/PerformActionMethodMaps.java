/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * 	http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.alipay.hulu.shared.node.action;

import com.alipay.hulu.shared.R;
import com.alipay.hulu.shared.node.action.provider.ActionProviderManager;
import com.alipay.hulu.shared.node.utils.LogicUtil;

import java.util.HashMap;
import java.util.Map;

/**
 * Created by qiaoruikai on 2019-08-23 15:19.
 */
class PerformActionMethodMaps {
    public static Map<String, Integer> GLOBAL_PARAMS = new HashMap<>();
    static {
        GLOBAL_PARAMS.put("localClickPos", R.string.action_param__local_pos);
    }


    public static Map<String, Integer> INPUT_PARAMS = new HashMap<>(GLOBAL_PARAMS);
    static {
        INPUT_PARAMS.put(OperationExecutor.INPUT_TEXT_KEY, R.string.action_param__input_content);
        };

    public static Map<String, Integer> SEARCH_PARAMS = new HashMap<>(GLOBAL_PARAMS);
    static {
        SEARCH_PARAMS.put(OperationExecutor.INPUT_TEXT_KEY, R.string.action_param__search_content);
    }

    public static Map<String, Integer> SLEEP_PARAMS = new HashMap<>(GLOBAL_PARAMS);
    static {
        SLEEP_PARAMS.put(OperationExecutor.INPUT_TEXT_KEY, R.string.action_param__sleep_time);
    }

    public static Map<String, Integer> SCREENSHOT_PARAMS = new HashMap<>(GLOBAL_PARAMS);
    static {
        SCREENSHOT_PARAMS.put(OperationExecutor.INPUT_TEXT_KEY, R.string.action_param__screenshot_name);
    }

    public static Map<String, Integer> MULTICLICK_PARAMS = new HashMap<>(GLOBAL_PARAMS);
    static {
        MULTICLICK_PARAMS.put(OperationExecutor.INPUT_TEXT_KEY, R.string.action_param__repeat_click);
    }

    public static Map<String, Integer> SLEEP_UNTIL_PARAMS = new HashMap<>(GLOBAL_PARAMS);
    static {
        SLEEP_UNTIL_PARAMS.put(OperationExecutor.INPUT_TEXT_KEY, R.string.action_param__max_sleep);
    }

    public static Map<String, Integer> SCROLL_PARAMS = new HashMap<>(GLOBAL_PARAMS);
    static {
        SCROLL_PARAMS.put(OperationExecutor.INPUT_TEXT_KEY, R.string.action_param__scroll_percent);
    }

    public static Map<String, Integer> SHELL_PARAMS = new HashMap<>(GLOBAL_PARAMS);
    static {
        SHELL_PARAMS.put(OperationExecutor.INPUT_TEXT_KEY, R.string.action_param__shell_command);
    }

    public static Map<String, Integer> LONG_CLICK_PARAMS = new HashMap<>(GLOBAL_PARAMS);
    static {
        LONG_CLICK_PARAMS.put(OperationExecutor.INPUT_TEXT_KEY, R.string.action_param__press_time);
    }

    public static Map<String, Integer> ASSERT_PARAMS = new HashMap<>(GLOBAL_PARAMS);
    static {
        ASSERT_PARAMS.put(OperationExecutor.ASSERT_INPUT_CONTENT, R.string.action_param__assert_content);
        ASSERT_PARAMS.put(OperationExecutor.ASSERT_MODE, R.string.action_param__assert_mode);
    }

    public static Map<String, Integer> LET_PARAMS = new HashMap<>(GLOBAL_PARAMS);
    static {
        LET_PARAMS.put(LogicUtil.ALLOC_TYPE, R.string.action_param__param_type);
        LET_PARAMS.put(LogicUtil.ALLOC_VALUE_PARAM, R.string.action_param__param_value);
        LET_PARAMS.put(LogicUtil.ALLOC_KEY_PARAM, R.string.action_param__param_name);
    }

    public static Map<String, Integer> JUMP_PAGE_PARAMS = new HashMap<>(GLOBAL_PARAMS);
    static {
        JUMP_PAGE_PARAMS.put(OperationExecutor.SCHEME_KEY, R.string.action_param__jump_scheme);
    }

    public static Map<String, Integer> LOAD_PARAM_PARAMS = new HashMap<>(GLOBAL_PARAMS);
    static {
        LOAD_PARAM_PARAMS.put(OperationExecutor.APP_URL_KEY, R.string.action_param__param_download);
    }

    public static Map<String, Integer> CHANGE_MODE_PARAMS = new HashMap<>(GLOBAL_PARAMS);
    static {
        CHANGE_MODE_PARAMS.put(OperationExecutor.GET_NODE_MODE, R.string.action_param__node_mode);
    }

    public static Map<String, Integer> LOGIC_PARAMS = new HashMap<>(GLOBAL_PARAMS);
    static {
        LOGIC_PARAMS.put(LogicUtil.CHECK_PARAM, R.string.action_param__check_field);
    }

    public static Map<String, Integer> OTHER_PARAMS = new HashMap<>(GLOBAL_PARAMS);
    static {
        OTHER_PARAMS.put(ActionProviderManager.KEY_TARGET_ACTION_DESC, R.string.action_param__target_action_desc);
        OTHER_PARAMS.put(ActionProviderManager.KEY_TARGET_ACTION, R.string.action_param__target_action);
    }

    public static Map<String, Integer> GESTURE_PARAMS = new HashMap<>(GLOBAL_PARAMS);
    static {
        GESTURE_PARAMS.put(OperationExecutor.GESTURE_PATH, R.string.action_param__gesture_path);
        GESTURE_PARAMS.put(OperationExecutor.GESTURE_FILTER, R.string.action_param__gesture_filter);
    }

    public static Map<String, Integer> CHECK_PARAMS = new HashMap<>(GLOBAL_PARAMS);
    static {
        CHECK_PARAMS.put(LogicUtil.CHECK_PARAM, R.string.action_param__check_field);
    }
}
