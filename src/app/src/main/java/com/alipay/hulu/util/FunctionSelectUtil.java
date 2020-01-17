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
package com.alipay.hulu.util;

import android.content.Context;
import android.content.DialogInterface;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.PointF;
import android.graphics.Rect;
import android.graphics.drawable.BitmapDrawable;
import android.os.Build;
import android.support.v7.app.AlertDialog;
import android.support.v7.widget.AppCompatSpinner;
import android.text.Editable;
import android.text.InputType;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.util.DisplayMetrics;
import android.util.Pair;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.AdapterView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.R;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.service.ScreenCaptureService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.OperationService;
import com.alipay.hulu.shared.node.action.Constant;
import com.alipay.hulu.shared.node.action.OperationExecutor;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.action.RunningModeEnum;
import com.alipay.hulu.shared.node.action.provider.ActionProviderManager;
import com.alipay.hulu.shared.node.action.provider.ViewLoadCallback;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.utils.BitmapUtil;
import com.alipay.hulu.shared.node.utils.LogicUtil;
import com.alipay.hulu.tools.HighLightService;
import com.alipay.hulu.ui.CheckableRelativeLayout;
import com.alipay.hulu.ui.FlowRadioGroup;
import com.alipay.hulu.ui.GesturePadView;
import com.alipay.hulu.ui.TwoLevelSelectLayout;

import java.io.File;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 操作选择界面
 * Created by qiaoruikai on 2019/2/22 8:18 PM.
 */
public class FunctionSelectUtil {
    private static final String TAG = "FunctionSelect";
    public static final String ACTION_EXTRA = "ACTION_EXTRA";

    /**
     * 展示操作界面
     *
     * @param node
     */
    public static void showFunctionView(final Context context, final AbstractNodeTree node,
                                  final List<Integer> keys, final List<Integer> icons,
                                  final Map<Integer,List<TwoLevelSelectLayout.SubMenuItem>> secondLevel,
                                  final HighLightService highLightService,
                                  final OperationService operationService,
                                  final Pair<Float, Float> localClickPos,
                                        final FunctionListener listener) {
        // 没有操作
        DialogUtils.showLeveledFunctionView(context, keys, icons, secondLevel, new DialogUtils.FunctionViewCallback<TwoLevelSelectLayout.SubMenuItem>() {
            @Override
            public void onExecute(DialogInterface dialog, TwoLevelSelectLayout.SubMenuItem action) {
                PerformActionEnum actionEnum = PerformActionEnum.getActionEnumByCode(action.key);
                if (actionEnum == null) {
                    dialog.dismiss();
                    listener.onCancel();
                    return;
                }

                LogUtil.d(TAG, "点击操作: %s, extra: %s", actionEnum, action.extra);

                if (actionEnum == PerformActionEnum.OTHER_GLOBAL ||
                        actionEnum == PerformActionEnum.OTHER_NODE) {
                    final OperationMethod method = new OperationMethod(actionEnum);

                    // 添加控件点击位置
                    if (localClickPos != null) {
                        method.putParam(OperationExecutor.LOCAL_CLICK_POS_KEY, localClickPos.first + "," + localClickPos.second);
                    }
                    // 先隐藏Dialog
                    dialog.dismiss();
                    // 隐藏高亮
                    if (highLightService != null) {
                       highLightService.removeHightLightSync();
                    }

                    method.putParam(ActionProviderManager.KEY_TARGET_ACTION_DESC, action.name);
                    method.putParam(ActionProviderManager.KEY_TARGET_ACTION, action.extra);

                    // 等500ms
                    LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            operationService.getActionProviderMng().loadActionView(context, method, node,
                                    new ViewLoadCallback() {
                                        @Override
                                        public void onViewLoaded(View v, Runnable preCall) {
                                            if (v == null) {
                                                listener.onProcessFunction(method, node);
                                            } else {
                                                showProvidedView(node, method, context, v,
                                                        preCall, highLightService,
                                                        listener);
                                            }
                                        }
                                    });
                        }
                    });
                } else {
                    LogUtil.i(TAG, "Perform Action: " + action);
                    final OperationMethod method = new OperationMethod(
                            PerformActionEnum.getActionEnumByCode(action.key));

                    // 透传一下
                    if (!StringUtil.isEmpty(action.extra)) {
                        method.putParam(ACTION_EXTRA, action.extra);
                    }

                    // 添加控件点击位置
                    if (localClickPos != null) {
                        method.putParam(OperationExecutor.LOCAL_CLICK_POS_KEY, localClickPos.first + "," + localClickPos.second);
                    }

                    // 隐藏Dialog
                    dialog.dismiss();

                    // 隐藏高亮
                    if (highLightService != null) {
                        highLightService.removeHightLightSync();
                    }

                    // 等界面变化完毕
                    LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            // 处理操作
                            boolean result = processAction(method, node, context, operationService,
                                    listener);

                            // 如果没有处理，走默认处理
                            if (result) {
                                return;
                            }

                            // 向handler发送点击请求
                            listener.onProcessFunction(method, node);
                        }
                    }, 200);
                }
            }

            @Override
            public void onCancel(DialogInterface dialog) {
                LogUtil.d(TAG, "Dialog canceled");

                dialog.dismiss();

                // 定时执行
                if (highLightService != null) {
                    highLightService.removeHightLightSync();
                }
                listener.onCancel();
            }

            @Override
            public void onDismiss(DialogInterface dialog) {

            }
        });
    }

    /**
     * 自身处理一些操作
     *
     * @param method
     * @param node
     * @param context
     * @return
     */
    protected static boolean processAction(OperationMethod method, AbstractNodeTree node,
                                    final Context context, OperationService operationService,
                                    FunctionListener listener) {
        PerformActionEnum action = method.getActionEnum();
        if (action == PerformActionEnum.INPUT
                || action == PerformActionEnum.INPUT_SEARCH
                || action == PerformActionEnum.LONG_CLICK
                || action == PerformActionEnum.MULTI_CLICK
                || action == PerformActionEnum.SLEEP_UNTIL
                || action == PerformActionEnum.SLEEP
                || action == PerformActionEnum.SCREENSHOT
                || action == PerformActionEnum.SCROLL_TO_BOTTOM
                || action == PerformActionEnum.SCROLL_TO_TOP
                || action == PerformActionEnum.SCROLL_TO_LEFT
                || action == PerformActionEnum.SCROLL_TO_RIGHT
                || action == PerformActionEnum.EXECUTE_SHELL) {
            showEditView(node, method, context, listener);
            return true;
        } else if (action == PerformActionEnum.ASSERT
                || action == PerformActionEnum.ASSERT_TOAST) {
            chooseAssertMode(node, action, context, listener);
            return true;
        } else if (action == PerformActionEnum.LET_NODE) {
            chooseLetMode(node, context, listener);
            return true;
        } else if (action == PerformActionEnum.JUMP_TO_PAGE
                || action == PerformActionEnum.LOAD_PARAM) {
            showSelectView(method, context, listener);
            return true;
        } else if (action == PerformActionEnum.CHANGE_MODE) {
            showChangeModeView(context, listener);
            return true;
        } else if (action == PerformActionEnum.WHILE) {
            showWhileView(method, context, listener);
            return true;
        } else if (action == PerformActionEnum.IF) {
            method.putParam(LogicUtil.CHECK_PARAM, "");
        } else if (action == PerformActionEnum.GESTURE || action == PerformActionEnum.GLOBAL_GESTURE) {
            captureAndShowGesture(action, node, context, listener);
            return true;
        }

        return false;
    }

    /**
     * 显示修改模式Dialog
     */
    private static void showChangeModeView(Context context, final FunctionListener listener) {
        try {
            final RunningModeEnum[] modes = RunningModeEnum.values();
            final String[] actions = new String[modes.length];

            for (int i = 0; i < modes.length; i++) {
                actions[i] = modes[i].getDesc();
            }

            AlertDialog.Builder builder = new AlertDialog.Builder(context, R.style.AppDialogTheme)
                    .setTitle(R.string.function__set_mode)
                    .setSingleChoiceItems(actions, 0, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            LogUtil.i(TAG, "Click " + which);

                            if (dialog != null) {
                                dialog.dismiss();
                            }

                            // 执行操作
                            OperationMethod method = new OperationMethod(PerformActionEnum.CHANGE_MODE);
                            method.putParam(OperationExecutor.GET_NODE_MODE, modes[which].getCode());
                            listener.onProcessFunction(method, null);
                        }
                    }).setNegativeButton(R.string.constant__cancel, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            dialog.dismiss();

                            listener.onCancel();
                        }
                    });

            AlertDialog dialog = builder.create();
            dialog.getWindow().setType(WindowManager.LayoutParams.TYPE_SYSTEM_ALERT);
            dialog.setCanceledOnTouchOutside(false);
            dialog.setCancelable(false);
            dialog.show();
        } catch (Exception e) {
            e.printStackTrace();

            listener.onCancel();
        }
    }

    /**
     * 展示选择框
     * @param method
     * @param context
     */
    private static void showSelectView(final OperationMethod method, final Context context,
                                final FunctionListener listener) {
        try {
            final PerformActionEnum actionEnum = method.getActionEnum();
            View customView = LayoutInflater.from(context).inflate(R.layout.dialog_select_view, null);
            View itemScan = customView.findViewById(R.id.item_scan);
            View itemUrl = customView.findViewById(R.id.item_url);
            final AlertDialog dialog = new AlertDialog.Builder(context, R.style.AppDialogTheme)
                    .setView(customView)
                    .setTitle(R.string.function__select_function)
                    .setNegativeButton(R.string.constant__cancel, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            dialog.dismiss();
                            listener.onCancel();
                        }
                    }).create();
            dialog.getWindow().setType(WindowManager.LayoutParams.TYPE_SYSTEM_ALERT);
            dialog.setCanceledOnTouchOutside(false);                                   //点击外面区域不会让dialog消失
            dialog.setCancelable(false);

            View.OnClickListener _listener = new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (actionEnum == PerformActionEnum.JUMP_TO_PAGE) {
                        if (v.getId() == R.id.item_scan) {
                            method.putParam("scan", "1");
                            listener.onProcessFunction(method, null);
                        } else if (v.getId() == R.id.item_url) {
                            dialog.dismiss();
                            showUrlEditView(method, context, listener);
                            return;
                        }
                    } else if (actionEnum == PerformActionEnum.LOAD_PARAM) {
                        if (v.getId() == R.id.item_scan) {
                            method.putParam("scan", "1");
                            listener.onProcessFunction(method, null);
                        } else if (v.getId() == R.id.item_url) {
                            dialog.dismiss();
                            showUrlEditView(method, context, listener);
                            return;
                        }
                    } else {
                        dialog.dismiss();
                        listener.onCancel();
                    }


                    dialog.dismiss();
                }
            };
            itemScan.setOnClickListener(_listener);
            itemUrl.setOnClickListener(_listener);
            dialog.show();
        } catch (Exception e) {
            LogUtil.e(TAG, e.getMessage());
            listener.onCancel();
        }
    }

    /**
     * URL编辑框
     * @param method
     * @param context
     * @param listener
     */
    private static void showUrlEditView(final OperationMethod method, Context context,
                                 final FunctionListener listener) {
        final PerformActionEnum actionEnum = method.getActionEnum();
        View v = LayoutInflater.from(ContextUtil.getContextThemeWrapper(context, R.style.AppDialogTheme)).inflate(R.layout.dialog_record_name, null);
        final EditText edit = (EditText) v.findViewById(R.id.dialog_record_edit);
        edit.setHint(R.string.function__please_input_url);

        AlertDialog dialog = new AlertDialog.Builder(context, R.style.AppDialogTheme)
                .setTitle(R.string.function__input_url)
                .setView(v)
                .setPositiveButton(R.string.function__input, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        LogUtil.i(TAG, "Positive " + which);
                        String data = edit.getText().toString();

                        dialog.dismiss();

                        if (actionEnum == PerformActionEnum.JUMP_TO_PAGE) {

                            // 向handler发送请求
                            method.putParam(OperationExecutor.SCHEME_KEY, data);
                            listener.onProcessFunction(method, null);
                        } else if (actionEnum == PerformActionEnum.LOAD_PARAM) {
                            method.putParam(OperationExecutor.APP_URL_KEY, data);

                            // 向handler发送请求
                            listener.onProcessFunction(method, null);
                        }
                    }
                }).setNegativeButton(R.string.constant__cancel, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {

                        dialog.dismiss();
                        listener.onCancel();
                    }
                }).create();
        dialog.getWindow().setType(WindowManager.LayoutParams.TYPE_SYSTEM_ALERT);
        dialog.setCanceledOnTouchOutside(false);                                   //点击外面区域不会让dialog消失
        dialog.setCancelable(false);
        dialog.show();
    }

    /**
     * 设置变量框
     * @param node
     * @param context
     * @param listener
     */
    private static void chooseLetMode(AbstractNodeTree node, final Context context,
                                      final FunctionListener listener) {
        if (node == null) {
            LogUtil.e(TAG, "Receive null node, can't let value");

            listener.onCancel();
            return;
        }

        // 如果是TextView外面包装的一层，解析内部的TextView
        if (node.getChildrenNodes() != null && node.getChildrenNodes().size() == 1) {
            AbstractNodeTree child = node.getChildrenNodes().get(0);

            if (StringUtil.equals(child.getClassName(), "android.widget.TextView")) {
                node = child;
            }
        }

        // 获取页面
        View letView = LayoutInflater.from(ContextUtil.getContextThemeWrapper(context,
                R.style.AppDialogTheme)).inflate(R.layout.dialog_action_let, null);

        // 分别设置内容
        final CheckableRelativeLayout textWrapper = (CheckableRelativeLayout) letView.findViewById(
                R.id.dialog_action_let_text);
        ((TextView)textWrapper.findViewById(R.id.dialog_action_let_item_title)).setText(R.string.function_select__text);
        ((TextView)textWrapper.findViewById(R.id.dialog_action_let_item_value)).setText(node.getText());
        final CheckableRelativeLayout descWrapper = (CheckableRelativeLayout) letView.findViewById(
                R.id.dialog_action_let_description);
        ((TextView)descWrapper.findViewById(R.id.dialog_action_let_item_title)).setText(R.string.function_select__description);
        ((TextView)descWrapper.findViewById(R.id.dialog_action_let_item_value)).setText(node.getDescription());
        final CheckableRelativeLayout classWrapper = (CheckableRelativeLayout) letView.findViewById(
                R.id.dialog_action_let_class_name);
        ((TextView)classWrapper.findViewById(R.id.dialog_action_let_item_title)).setText(R.string.function_select__class_name);
        ((TextView)classWrapper.findViewById(R.id.dialog_action_let_item_value)).setText(node.getClassName());
        final CheckableRelativeLayout xpathWrapper = (CheckableRelativeLayout) letView.findViewById(
                R.id.dialog_action_let_xpath);
        ((TextView)xpathWrapper.findViewById(R.id.dialog_action_let_item_title)).setText(R.string.function_select__xpath);
        ((TextView)xpathWrapper.findViewById(R.id.dialog_action_let_item_value)).setText(node.getXpath());
        final CheckableRelativeLayout resIdWrapper = (CheckableRelativeLayout) letView.findViewById(
                R.id.dialog_action_let_resource_id);
        ((TextView)resIdWrapper.findViewById(R.id.dialog_action_let_item_title)).setText(R.string.function_select__res_id);
        ((TextView)resIdWrapper.findViewById(R.id.dialog_action_let_item_value)).setText(node.getResourceId());
        final CheckableRelativeLayout otherWrapper = (CheckableRelativeLayout) letView.findViewById(
                R.id.dialog_action_let_other);
        final EditText valExpr = (EditText) otherWrapper.findViewById(R.id.dialog_action_let_other_value);
        final RadioGroup valType = (RadioGroup) otherWrapper.findViewById(R.id.dialog_action_let_other_type);

        final CheckableRelativeLayout[] previous = {textWrapper};
        final String[] valValue = { "${node.text}" };

        previous[0].setChecked(true);
        CheckableRelativeLayout.OnCheckedChangeListener checkedChangeListener = new CheckableRelativeLayout.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CheckableRelativeLayout checkable, boolean isChecked) {
                // 如果是自己点自己，不允许取消勾选
                if (previous[0] == checkable) {
//                    checkable.setChecked(true);
                    return;
                }

                if (previous[0] == otherWrapper) {
                    valExpr.setEnabled(false);
                    valType.setEnabled(false);
                }

                previous[0].setChecked(false);
                if (checkable == textWrapper) {
                    valValue[0] = "${node.text}";
                } else if (checkable == descWrapper) {
                    valValue[0] = "${node.description}";
                } else if (checkable == classWrapper) {
                    valValue[0] = "${node.className}";
                } else if (checkable == xpathWrapper) {
                    valValue[0] = "${node.xpath}";
                } else if (checkable == resIdWrapper) {
                    valValue[0] = "${node.resourceId}";
                } else if (checkable == otherWrapper) {
                    valValue[0] = "";
                    valExpr.setEnabled(true);
                    valType.setEnabled(true);
                }

                previous[0] = checkable;
            }
        };
        textWrapper.setOnCheckedChangeListener(checkedChangeListener);
        descWrapper.setOnCheckedChangeListener(checkedChangeListener);
        classWrapper.setOnCheckedChangeListener(checkedChangeListener);
        xpathWrapper.setOnCheckedChangeListener(checkedChangeListener);
        resIdWrapper.setOnCheckedChangeListener(checkedChangeListener);
        otherWrapper.setOnCheckedChangeListener(checkedChangeListener);

        final EditText valName = (EditText) letView.findViewById(R.id.dialog_action_let_variable_name);

        final AbstractNodeTree finalNode = node;
        AlertDialog dialog = new AlertDialog.Builder(context, R.style.AppDialogTheme)
                .setTitle(R.string.function__set_variable)
                .setView(letView)
                .setPositiveButton(R.string.constant__confirm, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        LogUtil.i(TAG, "Positive " + which);
                        String targetValValue = valValue[0];
                        String targetValName = valName.getText().toString();
                        int targetValType = LogicUtil.ALLOC_TYPE_STRING;
                        if (previous[0] == otherWrapper) {
                            targetValValue = valExpr.getText().toString();
                            targetValType = valType.getCheckedRadioButtonId() == R.id.dialog_action_let_other_type_int?
                                    LogicUtil.ALLOC_TYPE_INTEGER: LogicUtil.ALLOC_TYPE_STRING;
                        }

                        dialog.dismiss();
                        OperationMethod method = new OperationMethod(PerformActionEnum.LET_NODE);
                        method.putParam(LogicUtil.ALLOC_TYPE, Integer.toString(targetValType));
                        method.putParam(LogicUtil.ALLOC_VALUE_PARAM, targetValValue);
                        method.putParam(LogicUtil.ALLOC_KEY_PARAM, targetValName);

                        listener.onProcessFunction(method, finalNode);
                    }
                }).setNegativeButton(R.string.constant__cancel, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {

                        dialog.dismiss();
                        listener.onCancel();
                    }
                }).create();
        dialog.getWindow().setType(WindowManager.LayoutParams.TYPE_SYSTEM_ALERT);
        dialog.setCanceledOnTouchOutside(false);                                   //点击外面区域不会让dialog消失
        dialog.setCancelable(false);
        dialog.show();
    }

    /**
     * 选择断言模式
     *
     * @param node
     */
    private static void chooseAssertMode(final AbstractNodeTree node, final PerformActionEnum action,
                                  final Context context, final FunctionListener listener) {
        try {
            // 文字Assert Mode
            final String[] actionsType = {Constant.ASSERT_ACCURATE, Constant.ASSERT_CONTAIN, Constant.ASSERT_REGULAR};
            // 数字Assert Mode
            final String[] numActionsType = {Constant.ASSERT_DAYU, Constant.ASSERT_DAYUANDEQUAL,
                    Constant.ASSERT_XIAOYU, Constant.ASSERT_XIAOYUANDEQUAL, Constant.ASSERT_EQUAL};

            // 判断当前内容是否是数字
            StringBuilder matchTxtBuilder = new StringBuilder();
            if (action == PerformActionEnum.ASSERT) {
                for (AbstractNodeTree item : node) {
                    if (!TextUtils.isEmpty(item.getText())) {
                        matchTxtBuilder.append(item.getText());
                    }
                }
            } else if (action == PerformActionEnum.ASSERT_TOAST) {
                matchTxtBuilder.append(InjectorService.g().getMessage(com.alipay.hulu.shared.event.constant.Constant.EVENT_TOAST_MSG, String.class));
            }

            final int[] selectNumIndex = new int[1];
            final String[] strResult = {null};

            String matchTxt = matchTxtBuilder.toString();

            if (StringUtil.isNumeric(matchTxt) && !TextUtils.isEmpty(matchTxt)) {
                View content = LayoutInflater.from(ContextUtil.getContextThemeWrapper(context, R.style.AppDialogTheme)).inflate(R.layout.dialog_assert_number, null);
                final EditText assertNumContentEdit = (EditText) content.findViewById(R.id.assert_num_edittext);
                FlowRadioGroup assertGroup = (FlowRadioGroup) content.findViewById(R.id.assert_choice);
                assertGroup.setOnCheckedChangeListener(new RadioGroup.OnCheckedChangeListener() {
                    @Override
                    public void onCheckedChanged(RadioGroup group, int checkedId) {
                        switch (checkedId) {
                            case R.id.ch1:
                                selectNumIndex[0] = 0;
                                break;
                            case R.id.ch2:
                                selectNumIndex[0] = 1;
                                break;
                            case R.id.ch3:
                                selectNumIndex[0] = 2;
                                break;
                            case R.id.ch4:
                                selectNumIndex[0] = 3;
                                break;
                            case R.id.ch5:
                                selectNumIndex[0] = 4;
                                break;
                        }
                    }
                });

                assertNumContentEdit.addTextChangedListener(new TextWatcher() {
                    @Override
                    public void onTextChanged(CharSequence s, int start, int before, int count) {

                    }

                    @Override
                    public void beforeTextChanged(CharSequence s, int start,
                                                  int count, int after) {

                    }

                    @Override
                    public void afterTextChanged(Editable s) {
                        if (!TextUtils.isEmpty(assertNumContentEdit.getEditableText().toString())) {
                            strResult[0] = assertNumContentEdit.getEditableText().toString();
                        }
                    }
                });

                AlertDialog dialog = new AlertDialog.Builder(context, R.style.AppDialogTheme)
                        .setTitle(R.string.function__input_number_assert)
                        .setView(content)
                        .setPositiveButton(R.string.constant__confirm, null)
                        .setNegativeButton(R.string.constant__cancel, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                LogUtil.i(TAG, "Negative " + which);
                                dialog.dismiss();
                                listener.onCancel();
                            }
                        }).create();
                dialog.setOnShowListener(new DialogInterface.OnShowListener() {
                    @Override
                    public void onShow(final DialogInterface dialog) {
                        Button button = ((AlertDialog) dialog).getButton(AlertDialog.BUTTON_POSITIVE);
                        button.setOnClickListener(new View.OnClickListener() {
                            @Override
                            public void onClick(View v) {
                                if (StringUtil.isNumeric(strResult[0])) {
                                    HashMap<String, String> param = new HashMap<>();
                                    param.put(OperationExecutor.ASSERT_MODE, numActionsType[selectNumIndex[0]]);
                                    param.put(OperationExecutor.ASSERT_INPUT_CONTENT, strResult[0]);
                                    postiveClick(action, node, dialog, param, listener);
                                } else {
                                    LauncherApplication.toast(R.string.function__input_number);
                                }
                            }
                        });
                    }
                });
                dialog.getWindow().setType(WindowManager.LayoutParams.TYPE_SYSTEM_ALERT);
                dialog.setCanceledOnTouchOutside(false);
                dialog.setCancelable(false);
                dialog.show();
            } else {
                View content = LayoutInflater.from(ContextUtil.getContextThemeWrapper(context, R.style.AppDialogTheme)).inflate(R.layout.dialog_assert_string, null);
                final EditText editText = (EditText) content.findViewById(R.id.assert_string_edittext);
                final String[] assertInputContent = new String[1];
                if (!TextUtils.isEmpty(matchTxt)) {
                    editText.setText(matchTxt);
                    assertInputContent[0] = matchTxt;
                }

                final int[] selectIndex = new int[1];
                FlowRadioGroup assertGroup = (FlowRadioGroup) content.findViewById(R.id.assert_choice);
                assertGroup.setOnCheckedChangeListener(new RadioGroup.OnCheckedChangeListener() {
                    @Override
                    public void onCheckedChanged(RadioGroup group, int checkedId) {
                        switch (checkedId) {
                            case R.id.ch1:
                                selectIndex[0] = 0;
                                break;
                            case R.id.ch2:
                                selectIndex[0] = 1;
                                break;
                            case R.id.ch3:
                                selectIndex[0] = 2;
                                break;
                        }
                    }
                });

                editText.addTextChangedListener(new TextWatcher() {
                    @Override
                    public void onTextChanged(CharSequence s, int start, int before, int count) {
                    }

                    @Override
                    public void beforeTextChanged(CharSequence s, int start,
                                                  int count, int after) {

                    }

                    @Override
                    public void afterTextChanged(Editable s) {
                        assertInputContent[0] = editText.getEditableText().toString();
                    }
                });

                AlertDialog dialog = new AlertDialog.Builder(context, R.style.AppDialogTheme)
                        .setTitle(R.string.function__input_select_assert)
                        .setView(content)
                        .setPositiveButton(R.string.constant__confirm, null)
                        .setNegativeButton(R.string.constant__cancel, new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface dialog, int which) {
                                LogUtil.i(TAG, "Negative " + which);

                                dialog.dismiss();
                                listener.onCancel();
                            }
                        }).create();
                dialog.setOnShowListener(new DialogInterface.OnShowListener() {
                    @Override
                    public void onShow(final DialogInterface dialog) {
                        Button button = ((AlertDialog) dialog).getButton(AlertDialog.BUTTON_POSITIVE);
                        button.setOnClickListener(new View.OnClickListener() {
                            @Override
                            public void onClick(View v) {
                                if (!TextUtils.isEmpty(assertInputContent[0])) {
                                    HashMap<String, String> param = new HashMap<>();
                                    param.put(OperationExecutor.ASSERT_MODE, actionsType[selectIndex[0]]);
                                    param.put(OperationExecutor.ASSERT_INPUT_CONTENT, assertInputContent[0]);

                                    postiveClick(action, node, dialog,
                                            param, listener);

                                } else {
                                    LauncherApplication.toast(R.string.function__input_content);
                                }
                            }
                        });
                    }
                });
                dialog.getWindow().setType(WindowManager.LayoutParams.TYPE_SYSTEM_ALERT);
                dialog.setCanceledOnTouchOutside(false);
                dialog.setCancelable(false);
                dialog.show();
            }
        } catch (Exception e) {
            LogUtil.e(TAG, "Throw exception: " + e.getMessage(), e);
            listener.onCancel();
        }
    }



    private static void postiveClick(final PerformActionEnum action, final AbstractNodeTree node,
                                     DialogInterface dialog, HashMap<String, String> param,
                                     final FunctionListener listener) {
        // 拼装参数
        final OperationMethod method = new OperationMethod(action);
        if (param != null) {
            for (String key : param.keySet()) {
                method.putParam(key, param.get(key));
            }
        }
        // 隐藏Dialog
        dialog.dismiss();

        // 等隐藏Dialog
        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                // 向handler发送点击请求
                listener.onProcessFunction(method, node);
            }
        }, 200);
    }

    /**
     * 展示输入界面
     *
     * @param node
     */
    protected static void showEditView(final AbstractNodeTree node, final OperationMethod method,
                                final Context context, final FunctionListener listener) {

        try {
            PerformActionEnum action = method.getActionEnum();
            String title = StringUtil.getString(R.string.function__input_title);
            View v = LayoutInflater.from(ContextUtil.getContextThemeWrapper(context, R.style.AppDialogTheme)).inflate(R.layout.dialog_record_name, null);
            final EditText edit = (EditText) v.findViewById(R.id.dialog_record_edit);
            final Pattern textPattern;
            if (action == PerformActionEnum.SLEEP) {
                edit.setHint(R.string.function__sleep_time);
                title = StringUtil.getString(R.string.function__set_sleep_time);
                textPattern = Pattern.compile("\\d+");
            } else if (action == PerformActionEnum.SCREENSHOT) {
                edit.setHint(R.string.function__screenshot_name);
                title = StringUtil.getString(R.string.function__set_screenshot_name);
                textPattern = Pattern.compile("\\S+(.*\\S+)?");
            } else if (action ==PerformActionEnum.MULTI_CLICK) {
                edit.setHint(R.string.function__click_time);
                title = StringUtil.getString(R.string.function__set_click_time);
                textPattern = Pattern.compile("\\d{1,2}");
            } else if (action ==PerformActionEnum.SLEEP_UNTIL) {
                edit.setHint(R.string.function__max_wait);
                edit.setText(R.string.default_sleep_time);
                title = StringUtil.getString(R.string.function__set_max_wait);
                textPattern = Pattern.compile("\\d+");
            } else if (action == PerformActionEnum.SCROLL_TO_BOTTOM
                    || action == PerformActionEnum.SCROLL_TO_TOP
                    || action == PerformActionEnum.SCROLL_TO_LEFT
                    || action == PerformActionEnum.SCROLL_TO_RIGHT) {
                edit.setHint(R.string.function__scroll_percent);
                edit.setText(R.string.default_scroll_percentage);
                title = StringUtil.getString(R.string.function__set_scroll_percent);
                textPattern = Pattern.compile("\\d+");
            } else if (action == PerformActionEnum.EXECUTE_SHELL) {
                edit.setHint(R.string.function__adb_cmd);
                title = StringUtil.getString(R.string.function__set_adb_cmd);
                textPattern = null;
            } else if (action == PerformActionEnum.LONG_CLICK) {
                edit.setHint(R.string.function__long_press);
                title = StringUtil.getString(R.string.function__set_long_press);
                textPattern = Pattern.compile("[1-9]\\d+");
                edit.setText(R.string.default_long_click_time);
            } else {
                edit.setHint(R.string.function__input_content);
                textPattern = null;
            }

            final AlertDialog dialog = new AlertDialog.Builder(context, R.style.AppDialogTheme)
                    .setTitle(title)
                    .setView(v)
                    .setPositiveButton(R.string.function__input, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            LogUtil.i(TAG, "Positive " + which);
                            String data = edit.getText().toString();

                            // 拼装参数
                            method.putParam(OperationExecutor.INPUT_TEXT_KEY, data);

                            // 隐藏Dialog
                            dialog.dismiss();

                            // 抛给主线程
                            LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    // 操作记录
                                    listener.onProcessFunction(method, node);
                                }
                            }, 500);
                        }
                    }).setNegativeButton(R.string.constant__cancel, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            LogUtil.i(TAG, "Negative " + which);

                            dialog.dismiss();
                            listener.onCancel();
                        }
                    }).create();

            dialog.getWindow().setType(WindowManager.LayoutParams.TYPE_SYSTEM_ALERT);
            dialog.setCanceledOnTouchOutside(false);                                   //点击外面区域不会让dialog消失
            dialog.setCancelable(false);
            dialog.show();

            // 校验输入
            edit.addTextChangedListener(new TextWatcher() {
                @Override
                public void beforeTextChanged(CharSequence s, int start, int count, int after) {

                }

                @Override
                public void onTextChanged(CharSequence s, int start, int before, int count) {

                }

                @Override
                public void afterTextChanged(Editable s) {
                    Button positiveButton = dialog.getButton(DialogInterface.BUTTON_POSITIVE);
                    boolean enable = true;
                    if (textPattern != null) {
                        String content = s.toString();
                        enable = textPattern.matcher(content).matches();
                    }

                    // 如果不是目标状态，改变下
                    if (positiveButton.isEnabled() != enable) {
                        positiveButton.setEnabled(enable);
                    }
                }
            });

            dialog.getWindow().setLayout(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT);

        } catch (Exception e) {
            LogUtil.e(TAG, "Throw exception: " + e.getMessage(), e);

        }
    }

    /**
     * 展示WHILE编辑界面
     * @param method
     * @param context
     * @param listener
     */
    private static void showWhileView(final OperationMethod method, final Context context, final FunctionListener listener) {
        View v = LayoutInflater.from(ContextUtil.getContextThemeWrapper(context, R.style.AppDialogTheme)).inflate(R.layout.dialog_while_setting_panel, null);
        final EditText edit = (EditText) v.findViewById(R.id.edit_while_param);
        final AppCompatSpinner spinner = (AppCompatSpinner) v.findViewById(R.id.spinner_while_mode);
        final TextView hint = (TextView) v.findViewById(R.id.text_while_param_hint);

        spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                // 清理文字
                edit.setText("");
                edit.clearComposingText();

                if (position == 0) {
                    hint.setText(R.string.function__loop_count);
                    edit.setHint(R.string.function__loop_count);
                    edit.setInputType(InputType.TYPE_CLASS_NUMBER);
                } else {
                    hint.setText(R.string.function__loop_condition);
                    edit.setHint(R.string.function__loop_condition);
                    edit.setInputType(InputType.TYPE_CLASS_TEXT);
                }
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {

            }
        });

        final AlertDialog dialog = new AlertDialog.Builder(context, R.style.AppDialogTheme)
                .setTitle(R.string.function__add_loop)
                .setView(v)
                .setPositiveButton(R.string.function__add, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        LogUtil.i(TAG, "Positive " + which);
                        String data = edit.getText().toString();

                        String prefix = "";
                        if (spinner.getSelectedItemPosition() == 0) {
                            prefix = LogicUtil.LOOP_PREFIX;
                        }
                        // 拼装参数
                        method.putParam(LogicUtil.CHECK_PARAM, prefix + data);

                        // 隐藏Dialog
                        dialog.dismiss();

                        // 抛给主线程
                        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                // 操作记录
                                listener.onProcessFunction(method, null);
                            }
                        }, 500);
                    }
                }).setNegativeButton(R.string.constant__cancel, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        LogUtil.i(TAG, "Negative " + which);

                        dialog.dismiss();
                        listener.onCancel();
                    }
                }).create();

        dialog.getWindow().setType(WindowManager.LayoutParams.TYPE_SYSTEM_ALERT);
        dialog.setCanceledOnTouchOutside(false);                                   //点击外面区域不会让dialog消失
        dialog.setCancelable(false);
        dialog.show();
        dialog.getWindow().setLayout(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT);
    }

    /**
     * 展示提供的View
     * @param node
     * @param method
     * @param context
     * @param content 目标界面
     */
    private static void showProvidedView(final AbstractNodeTree node, final OperationMethod method,
                                  final Context context, View content,
                                  final Runnable confirmListener,
                                  final HighLightService highLightService,
                                  final FunctionListener listener) {
        ScrollView view = (ScrollView) LayoutInflater.from(ContextUtil.getContextThemeWrapper(
                context, R.style.AppDialogTheme))
                .inflate(R.layout.dialog_setting, null);
        LinearLayout wrapper = (LinearLayout) view.findViewById(R.id.dialog_content);

        LinearLayout.LayoutParams layoutParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        wrapper.addView(content, layoutParams);

        // 显示Dialog
        AlertDialog dialog = new AlertDialog.Builder(context, R.style.AppDialogTheme)
                .setView(view)
                .setCancelable(false)
                .setPositiveButton(R.string.constant__confirm, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        LogUtil.i(TAG, "Positive " + which);

                        // 隐藏Dialog
                        dialog.dismiss();

                        // 如果有回调，在后台执行
                        if (confirmListener != null) {
                            BackgroundExecutor.execute(new Runnable() {
                                @Override
                                public void run() {
                                    confirmListener.run();
                                    listener.onProcessFunction(method, node);
                                }
                            });
                        } else {
                            listener.onProcessFunction(method, node);
                        }
                    }
                }).setNegativeButton(R.string.constant__cancel, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        LogUtil.i(TAG, "Negative " + which);

                        dialog.dismiss();

                        listener.onCancel();

                        if (highLightService != null) {
                            highLightService.removeHighLight();
                        } // 去除高亮
                    }
                }).create();

        dialog.setTitle(null);
        dialog.setCanceledOnTouchOutside(false);
        dialog.getWindow().setType(WindowManager.LayoutParams.TYPE_SYSTEM_ALERT);
        dialog.show();
    }

    /**
     * 展示登录信息框
     * @param action
     * @param context
     */
    private static void captureAndShowGesture(final PerformActionEnum action, final AbstractNodeTree target, Context context, final FunctionListener listener) {
        try {
            View v = LayoutInflater.from(ContextUtil.getContextThemeWrapper(context, R.style.AppDialogTheme)).inflate(R.layout.dialog_node_gesture, null);
            final GesturePadView gesturePadView = (GesturePadView) v.findViewById(R.id.node_gesture_gesture_view);
            final RadioGroup group = (RadioGroup) v.findViewById(R.id.node_gesture_time_filter);
            group.setOnCheckedChangeListener(new RadioGroup.OnCheckedChangeListener() {
                @Override
                public void onCheckedChanged(RadioGroup group, int checkedId) {
                    int targetTime;
                    switch (checkedId) {
                        case R.id.node_gesture_time_filter_25:
                            targetTime = 25;
                            break;
                        case R.id.node_gesture_time_filter_50:
                            targetTime = 50;
                            break;
                        case R.id.node_gesture_time_filter_200:
                            targetTime = 200;
                            break;
                        case R.id.node_gesture_time_filter_100:
                        default:
                            targetTime = 100;
                            break;
                    }
                    gesturePadView.setGestureFilter(targetTime);
                    gesturePadView.clear();
                }
            });
            Bitmap nodeBitmap;
            if (target != null) {
                String capture = target.getCapture();
                if (StringUtil.isEmpty(capture)) {
                    File captureFile = new File(FileUtils.getSubDir("tmp"), "test.jpg");
                    Bitmap bitmap = capture(captureFile);
                    if (bitmap == null) {
                        LauncherApplication.getInstance().showToast(context.getString(R.string.action_gesture__capture_screen_failed));
                        listener.onCancel();
                        return;
                    }

                    Rect displayRect = target.getNodeBound();

                    nodeBitmap = Bitmap.createBitmap(bitmap, displayRect.left,
                            displayRect.top, displayRect.width(),
                            displayRect.height());
                    target.setCapture(BitmapUtil.bitmapToBase64(nodeBitmap));
                } else {
                    nodeBitmap = BitmapUtil.base64ToBitmap(capture);
                }
            } else {
                File captureFile = new File(FileUtils.getSubDir("tmp"), "test.jpg");
                nodeBitmap = capture(captureFile);
                if (nodeBitmap == null) {
                    LauncherApplication.getInstance().showToast(context.getString(R.string.action_gesture__capture_screen_failed));
                    listener.onCancel();
                    return;
                }
            }

            gesturePadView.setTargetImage(new BitmapDrawable(nodeBitmap));

            AlertDialog dialog = new AlertDialog.Builder(context, R.style.AppDialogTheme)
                    .setTitle(R.string.gesture__please_record_gesture)
                    .setView(v)
                    .setPositiveButton(R.string.constant__confirm, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            LogUtil.i(TAG, "Positive " + which);
                            List<PointF> path = gesturePadView.getGesturePath();
                            int gestureFilter = gesturePadView.getGestureFilter();
                            // 拼装参数
                            // 拼装参数
                            OperationMethod method = new OperationMethod(action);
                            method.putParam(OperationExecutor.GESTURE_PATH, JSON.toJSONString(path));
                            method.putParam(OperationExecutor.GESTURE_FILTER, Integer.toString(gestureFilter));

                            // 隐藏Dialog
                            dialog.dismiss();

                            listener.onProcessFunction(method, target);
                        }
                    }).setNegativeButton(R.string.constant__cancel, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            LogUtil.i(TAG, "Negative " + which);

                            dialog.dismiss();
                            listener.onCancel();
                        }
                    }).create();
            dialog.getWindow().setType(WindowManager.LayoutParams.TYPE_SYSTEM_ALERT);
            dialog.setCanceledOnTouchOutside(false);                                   //点击外面区域不会让dialog消失
            dialog.setCancelable(false);
            dialog.show();

            dialog.getWindow().setLayout(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT);

        } catch (Exception e) {
            LogUtil.e(TAG, "Login info dialog throw exception: " + e.getMessage(), e);
        }
    }

    /**
     * 截图
     * @param captureFile 截图保留文件
     * @return
     */
    private static Bitmap capture(File captureFile) {
        DisplayMetrics metrics = new DisplayMetrics();
        ((WindowManager) LauncherApplication.getInstance().getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRealMetrics(metrics);

        ScreenCaptureService captureService = LauncherApplication.service(ScreenCaptureService.class);
        Bitmap bitmap = captureService.captureScreen(captureFile, metrics.widthPixels, metrics.heightPixels,
                metrics.widthPixels, metrics.heightPixels);
        // 原有截图方案失败
        if (bitmap == null) {
            String path = FileUtils.getPathInShell(captureFile);
            CmdTools.execHighPrivilegeCmd("screencap -p \"" + path + "\"");
            MiscUtil.sleep(1000);
            bitmap = BitmapFactory.decodeFile(captureFile.getPath());
            // 长宽不对
            if (bitmap != null && bitmap.getWidth() != metrics.widthPixels) {
                bitmap = Bitmap.createScaledBitmap(bitmap, metrics.widthPixels, metrics.heightPixels, false);
            }
        }
        return bitmap;
    }

    /**
     * 回调
     */
    public interface FunctionListener {
        void onProcessFunction(OperationMethod method, AbstractNodeTree node);

        void onCancel();
    }
}
