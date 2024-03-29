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
package com.alipay.hulu.common.constant;

import android.os.Build;
import android.view.WindowManager;

public class Constant {

    public static final String OV_DEFAULT_PASSWORD = "a1234567";

    public static final String AES_KEY = "com.alipay.hulu";

    public static final String MAIL_ADDERSS = "ruikai.qrk@antgroup.com";


    public static final String EVENT_RECORD_SCREEN_CODE = "recordScreenCode";

    public static final String HOTPATCH_NAME = "hulu_hotPatch";
    public static final int HOTPATCH_VERSION = 1;
    public static final int TYPE_ALERT = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_SYSTEM_ALERT);


    /**
     * 屏幕方向监控
     */
    public static final String SCREEN_ORIENTATION = "screenOrientation";

    public static class IME {
        public static final String IME_STATUS = "ime_status";
        public static final String IME_INPUT_TEXT = "ime_inputText";
        public static final String IME_INPUT_TEXT_ENTER = "ime_inputTextEnter";
        public static final String IME_INPUT_KEY_CODE = "ime_inputKeyCode";
        public static final String IME_CLEAR_TEXT = "ime_clearText";
        public static final String IME_HIDE_IME = "ime_hideIme";
        public static final String IME_OPERATION_ACTION = "ime_operationAction";
    }
}
