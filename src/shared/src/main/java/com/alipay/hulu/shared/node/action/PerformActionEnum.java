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

import com.alipay.hulu.shared.R;

import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.util.ArrayList;
import java.util.List;

/**
 * AccessibilityNodeInfo 操作Enum
 * Created by cathor on 2017/12/6.
 */
public enum PerformActionEnum {
    CANCEL("cancel", "取消", 0, 0, R.drawable.dialog_action_drawable_cancel),
    CLICK("click", "点击", 1, 0, R.drawable.dialog_action_drawable_click),
    LONG_CLICK("longClick", "长按", 1, 0, R.drawable.dialog_action_drawable_long_click),
    INPUT("input", "输入", 1, 0, R.drawable.dialog_action_drawable_input),
    MULTI_CLICK("multiClick", "重复点击", 1, 0, R.drawable.dialog_action_drawable_multi_click),
    CLICK_IF_EXISTS("clickIfExists", "发现则点击", 1, 0, R.drawable.dialog_action_drawable_click_if_exists),
    CLICK_QUICK("clickQuick", "快速点击", 1, 0, R.drawable.dialog_action_drawable_quick_click_2),
    INPUT_SEARCH("inputSearch", "输入并搜索", 1, 0, R.drawable.dialog_action_drawable_search),
    SCROLL_TO_BOTTOM("scrollToBottom", "下滑", 1, 0, R.drawable.dialog_action_drawable_scroll_up),
    SCROLL_TO_TOP("scrollToTop", "上滑", 1, 0, R.drawable.dialog_action_drawable_scroll_down),
    SCROLL_TO_RIGHT("scrollToRight", "右滑", 1, 0, R.drawable.dialog_action_drawable_scroll_left),
    SCROLL_TO_LEFT("scrollToLeft", "左滑", 1, 0, R.drawable.dialog_action_drawable_scroll_right),
    ASSERT("assert", "断言", 1, 0, R.drawable.dialog_action_drawable_assert),
    SLEEP_UNTIL("sleepUntil", "等待节点出现", 1, 0, R.drawable.dialog_action_drawable_sleep),
    OTHER_NODE("otherNode", "附加功能", 1, 0, R.drawable.dialog_action_drawable_extra),


    BACK("back", "返回", 2, 0, R.drawable.dialog_action_drawable_back),
    RELOAD("reload", "重载界面", 2, 0, R.drawable.dialog_action_drawable_restart_app),
    HANDLE_ALERT("handleAlert", "处理弹窗", 2, 0, R.drawable.dialog_action_drawable_handle_alert),
    JUMP_TO_PAGE("jumpToPage", "Scheme跳转", 2, 0, R.drawable.dialog_action_drawable_scheme),
    CHANGE_MODE("changeMode", "切换查找模式", 4, 0, R.drawable.dialog_action_drawable_change_mode),


    GLOBAL_SCROLL_TO_BOTTOM("globalScrollToBottom", "全局下滑", 2, 0, R.drawable.dialog_action_drawable_scroll_up),
    GLOBAL_SCROLL_TO_TOP("globalScrollToTop", "全局上滑", 2, 0, R.drawable.dialog_action_drawable_scroll_down),
    GLOBAL_SCROLL_TO_RIGHT("globalScrollToRight", "全局右滑", 2, 0, R.drawable.dialog_action_drawable_scroll_left),
    GLOBAL_SCROLL_TO_LEFT("globalScrollToLeft", "全局左滑", 2, 0, R.drawable.dialog_action_drawable_scroll_right),
    GOTO_INDEX("goToIndex", "回到首页", 2, 0, R.drawable.dialog_action_drawable_goto_index),
    CLEAR_DATA("clearData", "清理数据", 2, 0, R.drawable.dialog_action_drawable_app_operation),


    KILL_PROCESS("killProcess", "结束进程", 2, 0, R.drawable.dialog_action_drawable_kill_process),
    SLEEP("sleep", "Sleep", 2, 0, R.drawable.dialog_action_drawable_sleep),
    SCREENSHOT("screenshot", "截图", 3, 0, R.drawable.dialog_action_drawable_screenshot),
    HOME("home", "主页键", 3, 0, R.drawable.dialog_action_drawable_home),
    NOTIFICATION("notification", "通知页", 3, 0, R.drawable.dialog_action_drawable_notification),
    RECENT_TASK("recentTask", "最近任务", 3, 0, R.drawable.dialog_action_drawable_tasks),
    DEVICE_INFO("deviceInfo", "设备信息", 3, 2, R.drawable.dialog_action_drawable_device_info),
    EXECUTE_SHELL("executeShell", "执行adb命令", 2, 0, R.drawable.dialog_action_drawable_cmdline),

    PAUSE("pause", "暂停", 3, 2, R.drawable.dialog_action_drawable_cancel),
    OTHER_GLOBAL("otherGlobal", "附加功能", 3, 0, R.drawable.dialog_action_drawable_extra),
    FINISH("finish", "结束", 4, 0, R.drawable.dialog_action_drawable_finish),
    FOCUS("focus", "切换焦点", 0, 0, R.drawable.dialog_action_drawable_long_click),

    /**
     * 运行时设置变量
     */
    LET_NODE("letNode", "设置变量", 1, 1, R.drawable.dialog_action_drawable_variable),
    LET("let", "设置变量", 4, 1, R.drawable.dialog_action_drawable_variable),
    CHECK_NODE("checkNode", "检查变量", 1, 1, R.drawable.dialog_action_drawable_cancel),
    CHECK("check", "检查", 4, 1, R.drawable.dialog_action_drawable_cancel),

    /**
     * 本地模式专用 5
     */

    /**
     * 远程模式专用 6
     */
    SLAVE_EXIT("slaveExit", "退出分组", 6, 2, R.drawable.dialog_action_drawable_slave_exit),

    /**
     * 内部操作，不对外
     */
    HANDLE_PERMISSION_ALERT("permissionAlert", "权限弹窗", -2, 0, R.drawable.dialog_action_drawable_cancel),
    HIDE_INPUT_METHOD("inputMethod", "隐藏输入法", -2, 0, R.drawable.dialog_action_drawable_cancel),


    /**
     * 对用例操作
     */
    DELETE_CASE("deleteCase", "删除用例", -3, 0, R.drawable.dialog_action_drawable_cancel),
    EXPORT_CASE("exportCase", "导出用例", -3, 0, R.drawable.dialog_action_drawable_export),
    PLAY_MULTI_TIMES("playMultiTimes", "重复播放", -3, 0, R.drawable.dialog_action_drawable_multi_times),
    EDIT_CASE("editCase", "编辑用例", -3, 0, R.drawable.dialog_action_drawable_extra),

    /**
     * 逻辑判断部分，由StepProvider内部处理
     */
    WHILE("while", "循环", -2, 1, R.drawable.dialog_action_drawable_loop),
    IF("if", "判断", -2, 1, R.drawable.dialog_action_drawable_if),
    CONTINUE("continue", "继续循环", -2, 1, R.drawable.dialog_action_drawable_continue),
    BREAK("break", "中断循环", -2, 1, R.drawable.dialog_action_drawable_break);

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
    private String desc;

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

    PerformActionEnum(String code, String desc, int category, int action, int icon) {
        this.code = code;
        this.desc = desc;
        this.category = category;
        this.actionType = action;
        this.icon = icon;
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
        return desc;
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
}
