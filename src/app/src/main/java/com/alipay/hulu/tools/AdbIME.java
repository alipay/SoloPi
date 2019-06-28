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
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputMethodManager;

import com.alipay.hulu.R;
import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.common.application.LauncherApplication;
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

    private String IME_MESSAGE = "ADB_INPUT_TEXT";
    private String IME_SEARCH_MESSAGE = "ADB_SEARCH_TEXT";
    private String IME_CHARS = "ADB_INPUT_CHARS";
    private String IME_KEYCODE = "ADB_INPUT_CODE";
    private String IME_EDITORCODE = "ADB_EDITOR_CODE";
    private BroadcastReceiver mReceiver = null;
    private InputMethodManager manager;

    @Override
    public void onCreate() {
        super.onCreate();
        this.manager = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
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
                if (msg != null) {
                    InputConnection ic = getCurrentInputConnection();
                    if (ic != null) {
                        ic.commitText(msg, 1);
                        sendFlag = true;
                    }
                }
            }

            // 输入并搜索
            if (intent.getAction().equals(IME_SEARCH_MESSAGE)) {
                String msg = intent.getStringExtra("msg");
                if (msg != null) {
                    InputConnection ic = getCurrentInputConnection();
                    if (ic != null) {
                        sendFlag = true;

                        ic.commitText(msg, 1);

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
                    }
                }
            }

            if (intent.getAction().equals(IME_CHARS)) {
                int[] chars = intent.getIntArrayExtra("chars");
                if (chars != null) {
                    String msg = new String(chars, 0, chars.length);
                    InputConnection ic = getCurrentInputConnection();
                    if (ic != null){
                        ic.commitText(msg, 1);
                        sendFlag = true;
                    }
                }
            }

            if (intent.getAction().equals(IME_KEYCODE)) {
                int code = intent.getIntExtra("code", -1);
                if (code != -1) {
                    InputConnection ic = getCurrentInputConnection();
                    if (ic != null) {
                        ic.sendKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, code));
                        sendFlag = true;
                    }
                }
            }

            if (intent.getAction().equals(IME_EDITORCODE)) {
                int code = intent.getIntExtra("code", -1);
                if (code != -1) {
                    InputConnection ic = getCurrentInputConnection();
                    if (ic != null) {
                        ic.performEditorAction(code);
                        sendFlag = true;
                    }
                }
            }

            // 进行了输入，发广播通知切换回原始输入法
            if (sendFlag) {
                String defaultIme = intent.getStringExtra("default");
                if (defaultIme == null) {
                    defaultIme = MyApplication.getCurSysInputMethod();
                }
                if (!StringUtil.isEmpty(defaultIme)) {
                    final String finalDefaultIme = defaultIme;
                    // 两秒后切回原始输入法
                    BackgroundExecutor.execute(new Runnable() {
                        @Override
                        public void run() {
                            CmdTools.execAdbCmd("settings put secure default_input_method " + finalDefaultIme, 2000);
                            OperationService service = LauncherApplication.getInstance().findServiceByName(OperationService.class.getName());

                            MiscUtil.sleep(1000);
                            // 1.5s后检查下是否需要隐藏输入法
                            service.doSomeAction(new OperationMethod(PerformActionEnum.HIDE_INPUT_METHOD), null);
                        }
                    }, 500);
                }
            }
        }
    }
}
