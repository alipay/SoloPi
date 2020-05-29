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
package com.alipay.hulu.tools;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.inputmethodservice.InputMethodService;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputMethodManager;

import com.alipay.hulu.R;
import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.RunningThread;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.OperationService;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;

/**
 * Created by lezhou.wyl on 2018/2/8.
 */
public class AdbIME extends InputMethodService {
    private static final String TAG = "AdbIME";
    public static final String MSG_HIDE_INPUT =  "MSG_HIDE_INPUT";

    public static final String IME_MESSAGE = "ADB_INPUT_TEXT";
    public static final String IME_SEARCH_MESSAGE = "ADB_SEARCH_TEXT";
    public static final String IME_CHARS = "ADB_INPUT_CHARS";
    public static final String IME_KEYCODE = "ADB_INPUT_CODE";
    public static final String IME_EDITORCODE = "ADB_EDITOR_CODE";
    private BroadcastReceiver mReceiver = null;
    private InputMethodManager manager;

    @Override
    public void onCreate() {
        super.onCreate();

        // System Alert类型，不影响背景显示
        getWindow().getWindow().setType(WindowManager.LayoutParams.TYPE_SYSTEM_ALERT);

        this.manager = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                while (!LauncherApplication.getInstance().hasFinishInit()) {
                    MiscUtil.sleep(50);
                }

                // 初始化好后再注册
                InjectorService.g().register(AdbIME.this);
            }
        });
    }

    @Subscriber(value = @Param(value = MSG_HIDE_INPUT, sticky = false), thread = RunningThread.MAIN_THREAD)
    public void hideInput() {
        requestHideSelf(0);
    }

    @Subscriber(value = @Param(value = IME_MESSAGE, sticky = false), thread = RunningThread.MAIN_THREAD)
    public boolean inputText(String text) {
        if (text != null) {
            InputConnection ic = getCurrentInputConnection();
            if (ic != null) {
                ic.commitText(text, 1);
                return true;
            }
        }

        return false;
    }

    @Subscriber(value = @Param(value = IME_SEARCH_MESSAGE, sticky = false), thread = RunningThread.MAIN_THREAD)
    public boolean inputSearchText(String text) {
        if (text != null) {
            InputConnection ic = getCurrentInputConnection();
            if (ic != null) {
                ic.commitText(text, 1);

                // 需要额外点击发送
                EditorInfo editorInfo = getCurrentInputEditorInfo();
                if (editorInfo != null) {
                    int options = editorInfo.imeOptions;
                    final int actionId = options & EditorInfo.IME_MASK_ACTION;

                    switch (actionId) {
                        case EditorInfo.IME_ACTION_SEARCH:
                            sendDefaultEditorAction(true);
                            break;
                        case EditorInfo.IME_ACTION_GO:
                            sendDefaultEditorAction(true);
                            break;
                        case EditorInfo.IME_ACTION_SEND:
                            sendDefaultEditorAction(true);
                            break;
                        default:
                            ic.sendKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER));
                    }
                }
                return true;
            }
        }
        return false;
    }

    @Subscriber(value = @Param(value = IME_CHARS, sticky = false), thread = RunningThread.MAIN_THREAD)
    public boolean inputChars(int[] chars) {
        if (chars != null) {
            String msg = new String(chars, 0, chars.length);
            InputConnection ic = getCurrentInputConnection();
            if (ic != null){
                ic.commitText(msg, 1);
                return true;
            }
        }
        return false;
    }

    @Subscriber(value = @Param(value = IME_KEYCODE, sticky = false), thread = RunningThread.MAIN_THREAD)
    public boolean inputKeyCode(int code) {
        if (code != -1) {
            InputConnection ic = getCurrentInputConnection();
            if (ic != null) {
                ic.sendKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, code));
                return true;
            }
        }
        return false;
    }

    @Subscriber(value = @Param(value = IME_EDITORCODE, sticky = false), thread = RunningThread.MAIN_THREAD)
    public boolean inputEditorCode(int code) {
        if (code != -1) {
            InputConnection ic = getCurrentInputConnection();
            if (ic != null) {
                ic.performEditorAction(code);
                return true;
            }
        }
        return false;
    }

    @Override
    public View onCreateInputView() {
        View mInputView = getLayoutInflater().inflate(R.layout.input_view, null);

        if (mReceiver == null) {
            IntentFilter filter = new IntentFilter(IME_MESSAGE);
            filter.addAction(IME_SEARCH_MESSAGE);
            filter.addAction(IME_CHARS);
            filter.addAction(IME_KEYCODE);
            filter.addAction(IME_EDITORCODE);
            mReceiver = new AdbReceiver();
            registerReceiver(mReceiver, filter);
        }

        // 当出现特殊情况，没有切换回系统输入法，需要用户手动点击切换
        mInputView.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                manager.showInputMethodPicker();
            }
        });

        return mInputView;
    }

    public void onDestroy() {
        if (mReceiver != null) {
            unregisterReceiver(mReceiver);
        }

        super.onDestroy();
    }

    class AdbReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            boolean sendFlag = false;

            if (intent.getAction().equals(IME_MESSAGE)) {
                String msg = intent.getStringExtra("msg");
                sendFlag = inputText(msg);
            } else if (intent.getAction().equals(IME_SEARCH_MESSAGE)) {
                // 输入并搜索
                String msg = intent.getStringExtra("msg");
                sendFlag = inputSearchText(msg);
            } else if (intent.getAction().equals(IME_CHARS)) {
                int[] chars = intent.getIntArrayExtra("chars");
                sendFlag = inputChars(chars);
            } else if (intent.getAction().equals(IME_KEYCODE)) {
                int code = intent.getIntExtra("code", -1);
                sendFlag = inputKeyCode(code);
            } else if (intent.getAction().equals(IME_EDITORCODE)) {
                int code = intent.getIntExtra("code", -1);
                sendFlag = inputEditorCode(code);
            }

            // 进行了输入，发广播通知切换回原始输入法
            if (sendFlag) {
                hideInput();
            }
        }
    }
}
