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
package com.alipay.hulu.common.tools;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.inputmethodservice.InputMethodService;
import android.os.Build;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.ExtractedTextRequest;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputMethodManager;
import android.widget.TextView;

import com.alipay.hulu.common.R;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.constant.Constant;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.RunningThread;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.injector.provider.Provider;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.StringUtil;

/**
 * Created by lezhou.wyl on 2018/2/8.
 */
@Provider(@Param(value = Constant.IME.IME_STATUS, type = Boolean.class))
public class AdbIME extends InputMethodService {
    private static final String TAG = "AdbIME";

    private static final String IME_MESSAGE = "ADB_INPUT_TEXT";
    private static final String IME_SEARCH_MESSAGE = "ADB_SEARCH_TEXT";
    private static final String IME_CHARS = "ADB_INPUT_CHARS";
    private static final String IME_KEYCODE = "ADB_INPUT_CODE";
    private static final String IME_EDITORCODE = "ADB_EDITOR_CODE";
    private BroadcastReceiver mReceiver = null;
    private InputMethodManager manager;
    private TextView title;

    private String currentStatus = null;

    @Override
    public void onCreate() {
        try {
            super.onCreate();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                getWindow().getWindow().setNavigationBarColor(Color.rgb(0x44, 0x44, 0x44));
            }

            // 输入法
            getWindow().getWindow().setType(WindowManager.LayoutParams.TYPE_INPUT_METHOD);

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
        } catch (Exception e) {
            LogUtil.e(TAG, "Init ime failed", e);
        }
    }

    @Subscriber(value = @Param("RUNNING_STATUS"), thread = RunningThread.MAIN_THREAD)
    public void setCurrentStatus(String currentStatus) {
        this.currentStatus = currentStatus;
        if (title != null) {
            title.setText(StringUtil.equals(currentStatus, "record")? "点击输入": "点击切换输入法");
        }
    }

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
        return getLayoutInflater().inflate(R.layout.adb_ime_input, null, false);
    }

    @Override
    public View onCreateCandidatesView() {
        View mInputView = getLayoutInflater().inflate(R.layout.input_view, null);

        title = mInputView.findViewById(R.id.adb_ime_title);
        if (StringUtil.equals(currentStatus, "record")) {
            title.setText(R.string.ime__click_to_input);
        } else {
            title.setText(R.string.ime__click_change);
        }

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

    @Override
    public void onFinishInput() {
        try {
            super.onFinishInput();
            setCandidatesViewShown(false);
        } catch (Exception e) {
            LogUtil.e(TAG, "What happened to finish input");
        }
        InjectorService.g().pushMessage(Constant.IME.IME_STATUS, false);
    }

    @Override
    public void onStartInputView(EditorInfo info, boolean restarting) {
        try {
            super.onStartInputView(info, restarting);
            setCandidatesViewShown(true);
        } catch (Exception e) {
            LogUtil.e(TAG, "What happened to start input");
        }
        InjectorService.g().pushMessage(Constant.IME.IME_STATUS, true);
    }

    public void onDestroy() {
        if (mReceiver != null) {
            unregisterReceiver(mReceiver);
        }

        super.onDestroy();
    }


    /**
     * 输入文字
     * @param content
     */
    @Subscriber(value = @Param(value = Constant.IME.IME_INPUT_TEXT, sticky = false), thread = RunningThread.MAIN_THREAD)
    public boolean inputText(String content) {
        if (StringUtil.isEmpty(content)) {
            return false;
        }
        InputConnection ic = getCurrentInputConnection();
        if (ic != null) {
            ic.commitText(content, 1);
            return true;
        }
        return false;
    }

    /**
     * 输入文字并发送
     * @param content
     */
    @Subscriber(value = @Param(value = Constant.IME.IME_INPUT_TEXT_ENTER, sticky = false), thread = RunningThread.MAIN_THREAD)
    public boolean inputTextEnter(String content) {
        if (content == null) {
            return false;
        }
        InputConnection ic = getCurrentInputConnection();
        if (ic != null) {
            ic.commitText(content, 1);

            // 需要额外点击发送
            pressEnter(ic);
            return true;
        }
        return false;
    }

    /**
     * 输入keyCode
     * @param keyCode
     */
    @Subscriber(value = @Param(value = Constant.IME.IME_INPUT_KEY_CODE, sticky = false), thread = RunningThread.MAIN_THREAD)
    public boolean inputKeyCode(int keyCode) {
        if (keyCode != -1) {
            InputConnection ic = getCurrentInputConnection();
            if (ic != null) {
                ic.sendKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, keyCode));
                return true;
            }
        }
        return false;
    }

    @Subscriber(value = @Param(value = Constant.IME.IME_CLEAR_TEXT, sticky = false), thread = RunningThread.MAIN_THREAD)
    public void clearText() {
        InputConnection ic = getCurrentInputConnection();
        CharSequence currentText = ic.getExtractedText(new ExtractedTextRequest(), 0).text;
        CharSequence beforCursorText = ic.getTextBeforeCursor(currentText.length(), 0);
        CharSequence afterCursorText = ic.getTextAfterCursor(currentText.length(), 0);
        ic.deleteSurroundingText(beforCursorText.length(), afterCursorText.length());
    }

    @Subscriber(value = @Param(value = Constant.IME.IME_HIDE_IME, sticky = false), thread = RunningThread.MAIN_THREAD)
    public void hideIme() {
        requestHideSelf(0);
    }


    @Subscriber(value = @Param(value = Constant.IME.IME_OPERATION_ACTION, sticky = false), thread = RunningThread.MAIN_THREAD)
    public void receiveImeOperation(KeyboardActionEnum action) {
        if (action == null) {
            LogUtil.e(TAG, "Keyboard action is null");
            return;
        }

        InputConnection ic = getCurrentInputConnection();
        if (ic == null) {
            LogUtil.e(TAG, "No valid input connection");
            return;
        }

        switch (action) {
            case ENTER:
                pressEnter(ic);
                break;
            case BACKSPACE:
                ic.deleteSurroundingText(1, 0);
                break;
            case LEFT:
                int leftTextLength = getTextLengthBefore(ic);
                ic.setSelection(leftTextLength - 1, leftTextLength - 1);
                break;
            case RIGHT:
                leftTextLength = getTextLengthBefore(ic);
                ic.setSelection(leftTextLength + 1, leftTextLength + 1);
                break;
            case CLEAR:
                ic.deleteSurroundingText(Integer.MAX_VALUE, Integer.MAX_VALUE);
                break;
        }
    }

    /**
     * 获得左侧文字长度
     * @param ic
     * @return
     */
    private int getTextLengthBefore(InputConnection ic) {
        CharSequence cs = ic.getTextBeforeCursor(Integer.MAX_VALUE, 0);
        if (cs != null) {
            return cs.length();
        }

        return 0;
    }

    /**
     * Enter键
     * @param ic
     */
    private void pressEnter(InputConnection ic) {
        if (ic != null) {

            // 需要额外点击发送
            EditorInfo editorInfo = getCurrentInputEditorInfo();
            if (editorInfo != null) {
                int options = editorInfo.imeOptions;
                final int actionId = options & EditorInfo.IME_MASK_ACTION;

                switch (actionId) {
                    case EditorInfo.IME_ACTION_SEARCH:
                    case EditorInfo.IME_ACTION_GO:
                    case EditorInfo.IME_ACTION_SEND:
                        sendDefaultEditorAction(true);
                        break;
                    default:
                        ic.sendKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER));
                }
            }
        }
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
                clearText();
                sendFlag = inputTextEnter(msg);
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
                hideIme();
            }
        }
    }

    public enum KeyboardActionEnum {
        ENTER("enter"),
        BACKSPACE("backspace"),
        LEFT("left"),
        RIGHT("right"),
        CLEAR("clear")
        ;
        private String name;
        KeyboardActionEnum(String name) {
            this.name = name;
        }

        public static KeyboardActionEnum getActionByName(String name) {
            if (StringUtil.isEmpty(name)) {
                return null;
            }

            for (KeyboardActionEnum action: values()) {
                if (name.equalsIgnoreCase(action.name)) {
                    return action;
                }
            }

            return null;
        }
    }
}
