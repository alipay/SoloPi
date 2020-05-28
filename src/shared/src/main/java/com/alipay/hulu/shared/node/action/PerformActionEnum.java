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


import android.support.annotation.IntDef;

import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.R;

import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import static com.alipay.hulu.shared.node.action.PerformActionMethodMaps.*;

/**
 * AccessibilityNodeInfo 操作Enum
 * Created by cathor on 2017/12/6.
 */
public enum PerformActionEnum {
    CANCEL("cancel", R.string.action__cancel, 0, 0, R.drawable.dialog_action_drawable_cancel),
    CLICK("click", R.string.action__click, 1, 0, R.drawable.dialog_action_drawable_click),
    LONG_CLICK("longClick", R.string.action__long_click, 1, 0, R.drawable.dialog_action_drawable_long_click, LONG_CLICK_PARAMS),
    INPUT("input", R.string.action__input, 1, 0, R.drawable.dialog_action_drawable_input, INPUT_PARAMS),
    MULTI_CLICK("multiClick", R.string.action__multi_click, 1, 0, R.drawable.dialog_action_drawable_multi_click, MULTICLICK_PARAMS),
    CLICK_IF_EXISTS("clickIfExists", R.string.action__find_click, 1, 0, R.drawable.dialog_action_drawable_click_if_exists),
    CLICK_QUICK("clickQuick", R.string.action__quick_click, 1, 0, R.drawable.dialog_action_drawable_quick_click_2),
    INPUT_SEARCH("inputSearch", R.string.action__input_search, 1, 0, R.drawable.dialog_action_drawable_search, SEARCH_PARAMS),
    SCROLL_TO_BOTTOM("scrollToBottom", R.string.action__scroll_to_bottom, 1, 0, R.drawable.dialog_action_drawable_scroll_up, SCROLL_PARAMS),
    SCROLL_TO_TOP("scrollToTop", R.string.action_scroll_to_top, 1, 0, R.drawable.dialog_action_drawable_scroll_down, SCROLL_PARAMS),
    SCROLL_TO_RIGHT("scrollToRight", R.string.action__scroll_to_right, 1, 0, R.drawable.dialog_action_drawable_scroll_left, SCROLL_PARAMS),
    SCROLL_TO_LEFT("scrollToLeft", R.string.action__scroll_to_left, 1, 0, R.drawable.dialog_action_drawable_scroll_right, SCROLL_PARAMS),
    GESTURE("gesture", R.string.action__gesture, 1, 0, R.drawable.dialog_action_drawable_gesture, GESTURE_PARAMS),
    ASSERT("assert", R.string.action__assert, 1, 0, R.drawable.dialog_action_drawable_assert, ASSERT_PARAMS),
    SLEEP_UNTIL("sleepUntil", R.string.action__sleep_until, 1, 0, R.drawable.dialog_action_drawable_sleep, SLEEP_UNTIL_PARAMS),
    OTHER_NODE("otherNode", R.string.action__other_node, 1, 0, R.drawable.dialog_action_drawable_extra, OTHER_PARAMS),

    BACK("back", R.string.action__back, 2, 0, R.drawable.dialog_action_drawable_back),
    RELOAD("reload", R.string.action__reload, 2, 0, R.drawable.dialog_action_drawable_restart_app),
    HANDLE_ALERT("handleAlert", R.string.action__handle_alert, 2, 0, R.drawable.dialog_action_drawable_handle_alert),
    JUMP_TO_PAGE("jumpToPage", R.string.action__scheme_jump, 2, 0, R.drawable.dialog_action_drawable_scheme, JUMP_PAGE_PARAMS),
    CHANGE_MODE("changeMode", R.string.action__change_mode, 4, 0, R.drawable.dialog_action_drawable_change_mode, CHANGE_MODE_PARAMS),

    GLOBAL_SCROLL_TO_BOTTOM("globalScrollToBottom", R.string.action__global_scroll_down, 2, 0, R.drawable.dialog_action_drawable_scroll_up),
    GLOBAL_SCROLL_TO_TOP("globalScrollToTop", R.string.action__global_scroll_up, 2, 0, R.drawable.dialog_action_drawable_scroll_down),
    GLOBAL_SCROLL_TO_RIGHT("globalScrollToRight", R.string.action__global_scroll_right, 2, 0, R.drawable.dialog_action_drawable_scroll_left),
    GLOBAL_SCROLL_TO_LEFT("globalScrollToLeft", R.string.action__global_scroll_left, 2, 0, R.drawable.dialog_action_drawable_scroll_right),
    GLOBAL_PINCH_OUT("globalPinchOut", R.string.action__pinch_out, 2, 0, R.drawable.dialog_action_drawable_pinch_out),
    GLOBAL_PINCH_IN("globalPinchIn", R.string.action__pinch_in, 2, 0, R.drawable.dialog_action_drawable_pinch_in),
    GLOBAL_GESTURE("globalGesture", R.string.action__gesture, 2, 0, R.drawable.dialog_action_drawable_gesture, GESTURE_PARAMS),
    GOTO_INDEX("goToIndex", R.string.action__goto_index, 2, 0, R.drawable.dialog_action_drawable_goto_index),
    CLEAR_DATA("clearData", R.string.action__clear_data, 2, 0, R.drawable.dialog_action_drawable_app_operation),
    ASSERT_TOAST("assertToast", R.string.action__assert_toast, 2, 0, R.drawable.dialog_action_drawable_assert, ASSERT_PARAMS),

    KILL_PROCESS("killProcess", R.string.action__kill_process, 2, 0, R.drawable.dialog_action_drawable_kill_process),
    SLEEP("sleep", R.string.action__sleep, 2, 0, R.drawable.dialog_action_drawable_sleep, SLEEP_PARAMS),
    SCREENSHOT("screenshot", R.string.action__screen_shot, 3, 0, R.drawable.dialog_action_drawable_screenshot, SCREENSHOT_PARAMS),
    HOME("home", R.string.action__home, 3, 0, R.drawable.dialog_action_drawable_home),
    NOTIFICATION("notification", R.string.action__notification, 3, 0, R.drawable.dialog_action_drawable_notification),
    RECENT_TASK("recentTask", R.string.action__recent_task, 3, 0, R.drawable.dialog_action_drawable_tasks),
    DEVICE_INFO("deviceInfo", R.string.action__device_info, 3, 2, R.drawable.dialog_action_drawable_device_info),
    EXECUTE_SHELL("executeShell", R.string.action__exe_shell, 2, 0, R.drawable.dialog_action_drawable_cmdline, SHELL_PARAMS),

    PAUSE("pause", R.string.action__pause, 3, 2, R.drawable.dialog_action_drawable_cancel),
    RESUME("resume", R.string.action__resume, 3, 2, R.drawable.dialog_action_drawable_cancel),
    OTHER_GLOBAL("otherGlobal", R.string.action__other_gloabl, 3, 0, R.drawable.dialog_action_drawable_extra, OTHER_PARAMS),
    FINISH("finish", R.string.action__finish, 4, 0, R.drawable.dialog_action_drawable_finish),
    FOCUS("focus", R.string.action__focus, 0, 0, R.drawable.dialog_action_drawable_long_click),

    /**
     * 运行时设置变量
     */
    LET_NODE("letNode", R.string.action__let_node, 1, 1, R.drawable.dialog_action_drawable_variable, LET_PARAMS),
    LET("let", R.string.action__let, 4, 1, R.drawable.dialog_action_drawable_variable, LET_PARAMS),
    LOAD_PARAM("load", R.string.action__load_param, 4, 1, R.drawable.dialog_action_drawable_load_param, LOAD_PARAM_PARAMS),
    CHECK_NODE("checkNode", R.string.action__check_node, 1, 1, R.drawable.dialog_action_drawable_cancel),
    CHECK("check", R.string.action__check, 4, 1, R.drawable.dialog_action_drawable_cancel),

    /**
     * 本地模式专用 5
     */

    /**
     * 内部操作，不对外
     */
    HANDLE_PERMISSION_ALERT("permissionAlert", R.string.action__permission_alert, -2, 0, R.drawable.dialog_action_drawable_cancel),
    HIDE_INPUT_METHOD("inputMethod", R.string.action__hide_input, -2, 0, R.drawable.dialog_action_drawable_cancel),


    /**
     * 对用例操作
     */
    DELETE_CASE("deleteCase", R.string.action__delete_case, -3, 0, R.drawable.dialog_action_drawable_cancel),
    EXPORT_CASE("exportCase", R.string.action__export_case, -3, 0, R.drawable.dialog_action_drawable_export),
    PLAY_MULTI_TIMES("playMultiTimes", R.string.action__play_multi_time, -3, 0, R.drawable.dialog_action_drawable_multi_times),
    GEN_MULTI_PARAM("genMultiParam", R.string.action__gen_multi_param, -3, 0, R.drawable.dialog_action_drawable_params_gen),
    /**
     * 逻辑判断部分，由StepProvider内部处理
     */
    WHILE("while", R.string.action__while, -2, 1, R.drawable.dialog_action_drawable_loop, LOGIC_PARAMS),
    IF("if", R.string.action__if, -2, 1, R.drawable.dialog_action_drawable_if, LOGIC_PARAMS),
    CONTINUE("continue", R.string.action__continue, -2, 1, R.drawable.dialog_action_drawable_continue),
    BREAK("break", R.string.action__break, -2, 1, R.drawable.dialog_action_drawable_break);

    /**
     * 无效操作
     */
    public static final int CATEGORY_INVALID_OPERATION = 0;

    /**
     * 节点操作
     */
    public static final int CATEGORY_NODE_OPERATION = 1;


    /**
     * 应用操作
     */
    public static final int CATEGORY_APP_OPERATION = 2;

    /**
     * 设备操作
     */
    public static final int CATEGORY_DEVICE_OPERATION = 3;

    /**
     * 流程控制操作
     */
    public static final int CATEGORY_CONTROL_OPERATION = 4;

    /**
     * 切片操作
     */
    public static final int CATEGORY_INTERNAL_NODE_OPERATION = -1;

    /**
     * 内部操作
     */
    public static final int CATEGORY_INTERNAL_OPERATION = -2;

    /**
     * 用例操作
     */
    public static final int CATEGORY_CASE_OPERATION = -3;



    /**
     * 基础操作
     */
    public static final int ACTION_TYPE_BASE = 0;

    /**
     * 录制回放专属
     */
    public static final int ACTION_TYPE_REPLAY = 1;

    /**
     * 一机多控专属
     */
    public static final int ACTION_TYPE_REMOTE = 2;

    /**
     * 操作码
     */
    private String code;

    /**
     * 描述
     */
    private int desc;

    /**
     * 分类
     */
    private int category;

    /**
     * transformation 为 0， action 为 1
     */
    private int actionType;

    /**
     * 图标资源
     */
    private int icon;

    /**
     * 操作方法
     */
    private Map<String, Integer> actionParams;

    PerformActionEnum(String code, int desc, int category, int action, int icon) {
        this(code, desc, category, action, icon, PerformActionMethodMaps.GLOBAL_PARAMS);
    }

    PerformActionEnum(String code, int desc, int category, int action, int icon, Map<String, Integer> methods) {
        this.code = code;
        this.desc = desc;
        this.category = category;
        this.actionType = action;
        this.icon = icon;
        this.actionParams = methods;
    }

    @IntDef({
            CATEGORY_INVALID_OPERATION,
            CATEGORY_NODE_OPERATION,
            CATEGORY_APP_OPERATION,
            CATEGORY_DEVICE_OPERATION,
            CATEGORY_CONTROL_OPERATION,
            CATEGORY_INTERNAL_NODE_OPERATION,
            CATEGORY_INTERNAL_OPERATION,
            CATEGORY_CASE_OPERATION
    })
    @Retention(RetentionPolicy.SOURCE)
    private  @interface CATEGORY {}

    @IntDef({
            ACTION_TYPE_BASE,
            ACTION_TYPE_REPLAY,
            ACTION_TYPE_REMOTE,
    })
    @Retention(RetentionPolicy.SOURCE)
    private  @interface ACTION_TYPE {}

    /**
     * 根据状态码返回操作Enum
     *
     * @param code 状态码
     * @return 找不到为null
     */
    public static PerformActionEnum getActionEnumByCode(String code) {
        if (code == null || code.length() == 0) {
            return null;
        }

        for (PerformActionEnum actionEnum : values()) {
            if (actionEnum.code.equals(code)) {
                return actionEnum;
            }
        }

        return null;
    }

    /**
     * 根据分类查找Action
     *
     * @param category
     * @return
     */
    public static List<PerformActionEnum> getActionsByCatagory(@CATEGORY int category) {
        List<PerformActionEnum> actionEnums = new ArrayList<>();
        for (PerformActionEnum actionEnum : values()) {
            if (actionEnum.category == category) {
                actionEnums.add(actionEnum);
            }
        }

        return actionEnums;
    }

    /**
     * 根据分类查找Action
     *
     * @param category
     * @return
     */
    public static List<PerformActionEnum> getActionsByCatagory(@CATEGORY int category, int mode) {
        int blockMode = -1;
        if (mode == ACTION_TYPE_REPLAY) {
            blockMode = ACTION_TYPE_REMOTE;
        } else if (mode == ACTION_TYPE_REMOTE) {
            blockMode = ACTION_TYPE_REPLAY;
        }

        List<PerformActionEnum> actionEnums = new ArrayList<>();
        for (PerformActionEnum actionEnum : values()) {
            if (actionEnum.category == category && actionEnum.getActionType() != blockMode) {
                actionEnums.add(actionEnum);
            }
        }

        return actionEnums;
    }

    /**
     * 根据分类查找Action
     *
     * @param categories
     * @return
     */
    public static List<PerformActionEnum> getActionsByCatagories(List<Integer> categories, @ACTION_TYPE int mode) {
        int blockMode = -1;
        if (mode == ACTION_TYPE_REPLAY) {
            blockMode = ACTION_TYPE_REMOTE;
        } else if (mode == ACTION_TYPE_REMOTE) {
            blockMode = ACTION_TYPE_REPLAY;
        }

        List<PerformActionEnum> actionEnums = new ArrayList<>();
        for (PerformActionEnum actionEnum : values()) {
            if (categories.contains(actionEnum.category) && actionEnum.getActionType() != blockMode) {
                actionEnums.add(actionEnum);
            }
        }

        return actionEnums;
    }

    @CATEGORY
    public int getCategory() {
        return category;
    }

    public String getCode() {
        return code;
    }

    public String getDesc() {
        return StringUtil.getString(desc);
    }

    /**
     * Getter method for property <tt>actionType</tt>.
     *
     * @return property value of actionType
     */
    @ACTION_TYPE
    public int getActionType() {
        return actionType;
    }

    /**
     * Getter method for property <tt>icon</tt>.
     *
     * @return property value of icon
     */
    public int getIcon() {
        return icon;
    }

    public Map<String, Integer> getActionParams() {
        return actionParams;
    }
}
