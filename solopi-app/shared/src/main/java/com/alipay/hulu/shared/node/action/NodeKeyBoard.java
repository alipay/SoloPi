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

import static com.alipay.hulu.common.constant.Constant.IME.IME_CLEAR_TEXT;
import static com.alipay.hulu.common.constant.Constant.IME.IME_HIDE_IME;
import static com.alipay.hulu.common.constant.Constant.IME.IME_INPUT_KEY_CODE;
import static com.alipay.hulu.common.constant.Constant.IME.IME_INPUT_TEXT;
import static com.alipay.hulu.common.constant.Constant.IME.IME_INPUT_TEXT_ENTER;
import static com.alipay.hulu.common.constant.Constant.IME.IME_STATUS;

import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.StringUtil;

/**
 * 封装键盘
 */
public class NodeKeyBoard {

    private volatile boolean keyBoardShown = false;
    private CmdExecutor executor;

    @Subscriber(@Param(IME_STATUS))
    public void setKeyBoardShown(boolean keyBoardShown) {
        this.keyBoardShown = keyBoardShown;
    }

    public NodeKeyBoard(CmdExecutor executor) {
        InjectorService.g().register(this);
        this.executor = executor;
    }

    public void disconnect() {
        InjectorService.g().unregister(this);
    }

    /**
     * 在激活的输入窗口输入内容
     * @param text
     */
    public void inputInActiveIme(String text) {
        // 如果不是AdbIME，切换到对应IDE中
        String defaultIme = getCurrentIme();
        if (!StringUtil.equals(defaultIme, "com.alipay.hulu/.common.tools.AdbIME") &&
                !StringUtil.equals(defaultIme, "com.alipay.hulu/com.alipay.hulu.common.tools.AdbIME")) {
            CmdTools.switchToIme("com.alipay.hulu/.common.tools.AdbIME");
            MiscUtil.sleep(500);
        }

        // 有键盘显示，输入内容
        if (keyBoardShown) {
            InjectorService.g().pushMessage(IME_CLEAR_TEXT);
            MiscUtil.sleep(500);
            InjectorService.g().pushMessage(IME_INPUT_TEXT, text);
            MiscUtil.sleep(500);
        }

        // 切换回原始IME
        if (!StringUtil.equals(defaultIme, "com.alipay.hulu/.common.tools.AdbIME") &&
                !StringUtil.equals(defaultIme, "com.alipay.hulu/com.alipay.hulu.common.tools.AdbIME")) {
            CmdTools.switchToIme(defaultIme);
        }
    }

    /**
     * 输入
     * @param text 待输入文字
     * @param x y 输入区域
     */
    public void inputText(String text, int x, int y) {
        String defaultIme = getCurrentIme();
        if (!StringUtil.equals(defaultIme, "com.alipay.hulu/.common.tools.AdbIME") &&
                !StringUtil.equals(defaultIme, "com.alipay.hulu/com.alipay.hulu.common.tools.AdbIME")) {
            CmdTools.switchToIme("com.alipay.hulu/.common.tools.AdbIME");
            MiscUtil.sleep(500);
        }

        // 点击特定区域触发IME显示
        executor.executeClick(x, y);
        MiscUtil.sleep(1000);

        if (keyBoardShown) {
            InjectorService.g().pushMessage(IME_CLEAR_TEXT);
            MiscUtil.sleep(500);
            InjectorService.g().pushMessage(IME_INPUT_TEXT, text);
            MiscUtil.sleep(500);
            InjectorService.g().pushMessage(IME_HIDE_IME);
            MiscUtil.sleep(500);
        } else {
            // 还是没有IME显示，直接Input输入
            executor.executeCmdSync("input text " + text);
            MiscUtil.sleep(1500);
        }

        if (!StringUtil.equals(defaultIme, "com.alipay.hulu/.common.tools.AdbIME") &&
                !StringUtil.equals(defaultIme, "com.alipay.hulu/com.alipay.hulu.common.tools.AdbIME")) {
            CmdTools.switchToIme(defaultIme);
        }
    }

    /**
     * 输入并搜索
     * @param text 待输入文字
     */
    public void inputTextSearch(String text, int x, int y) {
        String defaultIme = getCurrentIme();
        if (!StringUtil.equals(defaultIme, "com.alipay.hulu/.common.tools.AdbIME") &&
                !StringUtil.equals(defaultIme, "com.alipay.hulu/com.alipay.hulu.common.tools.AdbIME")) {
            CmdTools.switchToIme("com.alipay.hulu/.common.tools.AdbIME");
        }
        MiscUtil.sleep(500);
        executor.executeClick(x, y);
        MiscUtil.sleep(1000);

        if (keyBoardShown) {
            InjectorService.g().pushMessage(IME_CLEAR_TEXT);
            MiscUtil.sleep(500);
            InjectorService.g().pushMessage(IME_INPUT_TEXT_ENTER, text);
            MiscUtil.sleep(500);
            InjectorService.g().pushMessage(IME_HIDE_IME);
            MiscUtil.sleep(500);
        } else {
            executor.executeCmd("input text " + text);
            MiscUtil.sleep(1500);
            executor.executeCmd("input keyevent 66");
            MiscUtil.sleep(500);
        }

        if (!StringUtil.equals(defaultIme, "com.alipay.hulu/.common.tools.AdbIME") &&
                !StringUtil.equals(defaultIme, "com.alipay.hulu/com.alipay.hulu.common.tools.AdbIME")) {
            CmdTools.switchToIme(defaultIme);
        }
    }

    /**
     * 输入keyCode
     * @param keyCode
     */
    public void inputKeyCode(int keyCode) {
        if (keyBoardShown) {
            InjectorService.g().pushMessage(IME_INPUT_KEY_CODE, keyCode);
        } else {
            executor.executeCmd("input keyevent " + keyCode);
            MiscUtil.sleep(1500);
        }
    }

    /**
     * 获取当前输入法
     * @return
     */
    private String getCurrentIme() {
        return StringUtil.trim(executor.executeCmdSync("settings get secure default_input_method"));
    }
}
