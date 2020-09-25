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
package com.alipay.hulu.fragment;

import android.app.Dialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Parcel;
import android.provider.Settings;
import androidx.annotation.Nullable;

import com.alipay.hulu.shared.scan.ScanCodeType;
import com.google.android.material.tabs.TabLayout;
import androidx.appcompat.app.AlertDialog;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import android.util.DisplayMetrics;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.animation.AnimationUtils;
import android.view.animation.LayoutAnimationController;
import android.widget.AdapterView;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.TextView;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.R;
import com.alipay.hulu.activity.CaseEditActivity;
import com.alipay.hulu.activity.QRScanActivity;
import com.alipay.hulu.adapter.CaseStepAdapter;
import com.alipay.hulu.adapter.CaseStepMethodAdapter;
import com.alipay.hulu.adapter.CaseStepNodeAdapter;
import com.alipay.hulu.bean.CaseStepHolder;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.RunningThread;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.event.ScanSuccessEvent;
import com.alipay.hulu.service.CaseRecordManager;
import com.alipay.hulu.shared.io.OperationStepService;
import com.alipay.hulu.shared.io.bean.GeneralOperationLogBean;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.io.util.OperationStepUtil;
import com.alipay.hulu.shared.node.action.OperationExecutor;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.OperationNode;
import com.alipay.hulu.shared.node.tree.accessibility.tree.AccessibilityNodeTree;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;
import com.alipay.hulu.shared.node.utils.AppUtil;
import com.alipay.hulu.shared.node.utils.LogicUtil;
import com.alipay.hulu.shared.node.utils.PrepareUtil;
import com.alipay.hulu.ui.MaxHeightScrollView;
import com.alipay.hulu.ui.TwoLevelSelectLayout;
import com.alipay.hulu.util.CaseAppendOperationProcessor;
import com.alipay.hulu.util.FunctionSelectUtil;
import com.yydcdut.sdlv.Menu;
import com.yydcdut.sdlv.MenuItem;
import com.yydcdut.sdlv.SlideAndDragListView;
import com.zhy.view.flowlayout.FlowLayout;
import com.zhy.view.flowlayout.TagAdapter;
import com.zhy.view.flowlayout.TagFlowLayout;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static com.alipay.hulu.shared.node.utils.LogicUtil.SCOPE;

public class CaseStepEditFragment extends BaseFragment implements TagFlowLayout.OnTagClickListener, CaseEditActivity.OnCaseSaveListener{
    private static final String TAG = "CaseStepEditFragment";
    private boolean isOverrideInstall = false;

    private boolean selectMode = false;

    private RecordCaseInfo recordCase;

    private int tmpPosition = -1;

    private TagFlowLayout tagGroup;

    private SlideAndDragListView dragList;

    private List<OperationStep> stepList;

    private String storePath;

    private List<CaseStepAdapter.MyDataWrapper> dragEntities;

    private AtomicInteger currentIdx;

    private CaseStepAdapter adapter;

    /**
     * 通过RecordCase初始化
     *
     * @param
     */
    public static CaseStepEditFragment getInstance(RecordCaseInfo recordCaseInfo) {
        CaseStepEditFragment fragment = new CaseStepEditFragment();
        fragment.recordCase = recordCaseInfo;
        return fragment;
    }

    @Nullable
    @Override
    public View onCreateView(LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View root = inflater.inflate(R.layout.fragment_case_step_edit, container, false);
        // 加载相关控件
        tagGroup = (TagFlowLayout) root.findViewById(R.id.case_step_edit_tag_group);
        dragList = (SlideAndDragListView) root.findViewById(R.id.case_step_edit_drag_list);

        LayoutAnimationController controller = new LayoutAnimationController(
                AnimationUtils.loadAnimation(getContext(), android.R.anim.fade_in));
        controller.setDelay(0);
        dragList.setLayoutAnimation(controller);
        return root;
    }

    @Override
    public void onActivityCreated(@Nullable Bundle savedInstanceState) {
        super.onActivityCreated(savedInstanceState);
        initData();
    }

    @Subscriber(value = @Param(sticky = false), thread = RunningThread.MAIN_THREAD)
    public void onScanEvent(final ScanSuccessEvent event) {
        switch (event.getType()) {
            case ScanSuccessEvent.SCAN_TYPE_SCHEME:
                // 向handler发送请求
                OperationMethod method = new OperationMethod(PerformActionEnum.JUMP_TO_PAGE);
                method.putParam(OperationExecutor.SCHEME_KEY, event.getContent());
                OperationStep step = new OperationStep();
                step.setOperationMethod(method);
                step.setOperationIndex(currentIdx.get());
                step.setOperationId(stepList.get(stepList.size() - 1).getOperationId());

                CaseStepAdapter.MyDataWrapper wrapper = new CaseStepAdapter.MyDataWrapper(step, currentIdx.getAndIncrement());

                if (tmpPosition != -1) {
                    dragEntities.add(tmpPosition, wrapper);
                    tmpPosition = -1;
                } else {
                    dragEntities.add(wrapper);
                }

                adapter.notifyDataSetChanged();
                break;
            case ScanSuccessEvent.SCAN_TYPE_PARAM:
                // 向handler发送请求
                method = new OperationMethod(PerformActionEnum.LOAD_PARAM);
                method.putParam(OperationExecutor.APP_URL_KEY, event.getContent());
                step = new OperationStep();
                step.setOperationMethod(method);
                step.setOperationIndex(currentIdx.get());
                step.setOperationId(stepList.get(stepList.size() - 1).getOperationId());

                wrapper = new CaseStepAdapter.MyDataWrapper(step, currentIdx.getAndIncrement());

                if (tmpPosition != -1) {
                    dragEntities.add(tmpPosition, wrapper);
                    tmpPosition = -1;
                } else {
                    dragEntities.add(wrapper);
                }

                adapter.notifyDataSetChanged();

                // 录制模式需要记录下

                break;

            case ScanSuccessEvent.SCAN_TYPE_QR_CODE:
            case ScanSuccessEvent.SCAN_TYPE_BAR_CODE:
                // 向handler发送请求
                method = new OperationMethod(event.getType() == ScanSuccessEvent.SCAN_TYPE_QR_CODE?
                        PerformActionEnum.GENERATE_QR_CODE: PerformActionEnum.GENERATE_BAR_CODE);
                method.putParam(OperationExecutor.SCHEME_KEY, event.getContent());
                if (event.getType() == ScanSuccessEvent.SCAN_TYPE_BAR_CODE) {
                    ScanCodeType type = event.getCodeType();
                    if (type != null) {
                        method.putParam(OperationExecutor.GENERATE_CODE_TYPE, type.getCode());
                    }
                }

                // 录制模式需要记录下
                step = new OperationStep();
                step.setOperationMethod(method);
                step.setOperationIndex(currentIdx.get());
                step.setOperationId(stepList.get(stepList.size() - 1).getOperationId());

                wrapper = new CaseStepAdapter.MyDataWrapper(step, currentIdx.getAndIncrement());

                if (tmpPosition != -1) {
                    dragEntities.add(tmpPosition, wrapper);
                    tmpPosition = -1;
                } else {
                    dragEntities.add(wrapper);
                }

                adapter.notifyDataSetChanged();

                // 录制模式需要记录下
                break;
            default:
                break;
        }
    }

    /**
     * 初始化用例数据
     */
    private void initData() {
        if (recordCase == null) {
            return;
        }

        currentIdx = new AtomicInteger();

        GeneralOperationLogBean generalOperation = JSON.parseObject(recordCase.getOperationLog(), GeneralOperationLogBean.class);

        // load from file
        OperationStepUtil.afterLoad(generalOperation);
        storePath = generalOperation.getStorePath();

        if (generalOperation.getSteps() != null) {
            stepList = generalOperation.getSteps();
        }

        // 可以全新添加步骤
        if (stepList == null) {
            stepList = new ArrayList<>();
        }

        dragEntities = new ArrayList<>(stepList.size() + 1);
        final List<String> stepTags = new ArrayList<>(stepList.size() + 2);

        // 每一步添加一个实体
        stepTags.add(getString(R.string.step_edit__new_step));
        stepTags.add(getString(R.string.step_edit__select_mode));
        stepTags.add(getString(R.string.step_edit__paste));
        stepTags.add(getString(R.string.step_edit__record_step));
        for (OperationStep step: stepList) {
            CaseStepAdapter.MyDataWrapper entity = new CaseStepAdapter.MyDataWrapper(clone(step), currentIdx.getAndIncrement());
            dragEntities.add(entity);
            stepTags.add(step.getOperationMethod().getActionEnum().getDesc());

            String drag = step.getOperationMethod().getParam(SCOPE);
            if (drag != null) {
                entity.scopeTo = Integer.parseInt(drag) + entity.idx;
            }
        }

        tagGroup.setMaxSelectCount(0);
        tagGroup.setAdapter(new TagAdapter<String>(stepTags) {
            @Override
            public View getView(FlowLayout parent, int position, String o) {
                View tag = LayoutInflater.from(getActivity()).inflate(R.layout.item_case_step_tag, null);
                TextView title = (TextView) tag.findViewById(R.id.case_step_edit_tag_title);
                ImageView icon = (ImageView) tag.findViewById(R.id.case_step_edit_tag_icon);

                if (position == 0) {
                    if (!selectMode) {
                        title.setText(R.string.step_edit__new_step);
                        icon.setImageResource(R.drawable.case_step_add);
                    } else {
                        title.setText(R.string.step_edit__copy);
                        icon.setImageResource(R.drawable.case_step_copy);
                    }
                } else if (position == 1) {
                    if (selectMode) {
                        title.setText(R.string.step_edit__exit_select);
                    } else {
                        title.setText(R.string.step_edit__select_mode);
                    }
                    icon.setImageResource(R.drawable.case_step_select);
                } else if (position == 2) {
                    title.setText(o);
                    icon.setImageResource(R.drawable.case_step_paste);
                } else if (position == 3) {
                    title.setText(o);
                    icon.setImageResource(R.drawable.recording);
                } else {

                    // 加载下
                    OperationStep step = stepList.get(position - 4);
                    PerformActionEnum actionEnum = step.getOperationMethod().getActionEnum();

                    // 设置资源
                    title.setText(actionEnum.getDesc());
                    icon.setImageResource(actionEnum.getIcon());
                }
                return tag;
            }
        });
        tagGroup.setOnTagClickListener(this);

        // 用例adapter
        adapter = new CaseStepAdapter(getActivity(), dragEntities);
        adapter.setCurrentMode(selectMode);

        // 设置菜单相关样式
        int dp64 = getResources().getDimensionPixelSize(R.dimen.control_dp64);
        int textSize13 = ContextUtil.px2sp(getActivity(), getResources().getDimensionPixelSize(R.dimen.textsize_14));
        int colorWhile;
        int colorIf;
        int colorDelete;
        int colorExtra;
        if (Build.VERSION.SDK_INT >= 23) {
            colorWhile = getActivity().getColor(R.color.colorStatusBlue);
            colorIf = getActivity().getColor(R.color.colorStatusYellow);
            colorDelete = getActivity().getColor(R.color.colorStatusRed);
            colorExtra = getActivity().getColor(R.color.colorStatusGay);
        } else {
            colorWhile = getResources().getColor(R.color.colorStatusBlue);
            colorIf = getResources().getColor(R.color.colorStatusYellow);
            colorDelete = getResources().getColor(R.color.colorStatusRed);
            colorExtra = getResources().getColor(R.color.colorStatusGay);
        }

        // 转换模式
        Menu menu = new Menu(true, 0);
        menu.addItem(new MenuItem.Builder().setText(getString(R.string.step_edit__remove)).setTextColor(Color.WHITE)
                .setWidth(dp64)
                .setTextSize(textSize13)
                .setDirection(MenuItem.DIRECTION_RIGHT)
                .setBackground(new ColorDrawable(colorDelete)).build());
        menu.addItem(new MenuItem.Builder().setText(getString(R.string.step_edit__convert_if)).setTextColor(Color.WHITE)
                .setWidth(dp64)
                .setTextSize(textSize13)
                .setDirection(MenuItem.DIRECTION_RIGHT)
                .setBackground(new ColorDrawable(colorIf)).build());
        menu.addItem(new MenuItem.Builder().setText(getString(R.string.step_edit__convert_while)).setTextColor(Color.WHITE)
                .setWidth(dp64)
                .setTextSize(textSize13)
                .setDirection(MenuItem.DIRECTION_RIGHT)
                .setBackground(new ColorDrawable(colorWhile)).build());

        // 空项
        Menu controlMenu = new Menu(false, 1);
        controlMenu.addItem(new MenuItem.Builder().setText(getString(R.string.step_edit__remove)).setTextColor(Color.WHITE)
                .setWidth(dp64)
                .setTextSize(textSize13)
                .setDirection(MenuItem.DIRECTION_RIGHT)
                .setBackground(new ColorDrawable(colorDelete)).build());
        controlMenu.addItem(new MenuItem.Builder().setText(getString(R.string.step_edit__restore_step)).setTextColor(Color.WHITE)
                .setWidth(dp64)
                .setTextSize(textSize13)
                .setDirection(MenuItem.DIRECTION_RIGHT)
                .setBackground(new ColorDrawable(colorIf)).build());

        // 空项
        Menu controlSubMenu = new Menu(false, 2);
        controlSubMenu.addItem(new MenuItem.Builder().setText(getString(R.string.step_edit__remove)).setTextColor(Color.WHITE)
                .setWidth(dp64)
                .setTextSize(textSize13)
                .setDirection(MenuItem.DIRECTION_RIGHT)
                .setBackground(new ColorDrawable(colorDelete)).build());

        // 转换模式
        Menu clickMenu = new Menu(true, 3);
        clickMenu.addItem(new MenuItem.Builder().setText(getString(R.string.step_edit__remove)).setTextColor(Color.WHITE)
                .setWidth(dp64)
                .setTextSize(textSize13)
                .setDirection(MenuItem.DIRECTION_RIGHT)
                .setBackground(new ColorDrawable(colorDelete)).build());
        clickMenu.addItem(new MenuItem.Builder().setText(getString(R.string.step_edit__convert_if)).setTextColor(Color.WHITE).setWidth(dp64)
                .setDirection(MenuItem.DIRECTION_RIGHT)
                .setTextSize(textSize13)
                .setBackground(new ColorDrawable(colorIf)).build());
        clickMenu.addItem(new MenuItem.Builder().setText(getString(R.string.step_edit__convert_while)).setTextColor(Color.WHITE)
                .setWidth(dp64)
                .setDirection(MenuItem.DIRECTION_RIGHT)
                .setTextSize(textSize13)
                .setBackground(new ColorDrawable(colorWhile)).build());
        clickMenu.addItem(new MenuItem.Builder().setText(getString(R.string.step_edit__convert_click_if_exist)).setTextColor(Color.WHITE)
                .setWidth(dp64)
                .setTextSize(textSize13)
                .setDirection(MenuItem.DIRECTION_RIGHT)
                .setBackground(new ColorDrawable(colorExtra)).build());


        // 转换模式
        Menu clickIfMenu = new Menu(true, 4);
        clickIfMenu.addItem(new MenuItem.Builder().setText(getString(R.string.step_edit__remove)).setTextColor(Color.WHITE)
                .setWidth(dp64)
                .setTextSize(textSize13)
                .setDirection(MenuItem.DIRECTION_RIGHT)
                .setBackground(new ColorDrawable(colorDelete)).build());
        clickIfMenu.addItem(new MenuItem.Builder().setText(getString(R.string.step_edit__convert_if)).setTextColor(Color.WHITE).setWidth(dp64)
                .setDirection(MenuItem.DIRECTION_RIGHT)
                .setTextSize(textSize13)
                .setBackground(new ColorDrawable(colorIf)).build());
        clickIfMenu.addItem(new MenuItem.Builder().setText(getString(R.string.step_edit__convert_while)).setTextColor(Color.WHITE)
                .setWidth(dp64)
                .setDirection(MenuItem.DIRECTION_RIGHT)
                .setTextSize(textSize13)
                .setBackground(new ColorDrawable(colorWhile)).build());
        clickIfMenu.addItem(new MenuItem.Builder().setText(getString(R.string.step_edit__convert_click)).setTextColor(Color.WHITE)
                .setWidth(dp64)
                .setTextSize(textSize13)
                .setDirection(MenuItem.DIRECTION_RIGHT)
                .setBackground(new ColorDrawable(colorExtra)).build());

        dragList.setMenu(menu, controlMenu, controlSubMenu, clickMenu, clickIfMenu);
        dragList.setDividerHeight(0);
        dragList.setAdapter(adapter);
        adapter.setListener(new CaseStepAdapter.OnStepListener() {
            @Override
            public void insertAfter(int position) {
                showSelectModeAction(position + 1);
            }

            @Override
            public void scroll(final int px) {
                LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        dragList.smoothScrollBy(px, 100);
                    }
                }, 100);
            }
        });
        dragList.setOnMenuItemClickListener(new SlideAndDragListView.OnMenuItemClickListener() {
            @Override
            public int onMenuItemClick(View v, final int itemPosition, int buttonPosition, int direction) {
                if (direction == MenuItem.DIRECTION_RIGHT) {
                    if (buttonPosition == 0) {
                        LauncherApplication.getInstance().showDialog(getActivity(), "是否删除该步骤？", "确定", new Runnable() {
                            @Override
                            public void run() {
                                dragEntities.remove(itemPosition);
                                adapter.notifyDataSetChanged();
                            }
                        }, "取消", null);
                        return Menu.ITEM_NOTHING;
                    } else if (buttonPosition == 3) {
                        CaseStepAdapter.MyDataWrapper wrapper = dragEntities.get(itemPosition);
                        OperationMethod method = wrapper.currentStep.getOperationMethod();
                        PerformActionEnum origin = method.getActionEnum();
                        if (origin == PerformActionEnum.CLICK) {
                            method.setActionEnum(PerformActionEnum.CLICK_IF_EXISTS);
                            adapter.notifyDataSetChanged();
                            return Menu.ITEM_SCROLL_BACK;
                        } else if (origin == PerformActionEnum.CLICK_IF_EXISTS) {
                            method.setActionEnum(PerformActionEnum.CLICK);
                            adapter.notifyDataSetChanged();
                            return Menu.ITEM_SCROLL_BACK;
                        } else {
                            CaseStepEditFragment.this.toastShort("不支持转化步骤: " + origin.getDesc());
                            return Menu.ITEM_SCROLL_BACK;
                        }


                    }

                    // 全部操作均支持转化
                    CaseStepAdapter.MyDataWrapper wrapper = dragEntities.get(itemPosition);

                    OperationMethod method = wrapper.currentStep.getOperationMethod();
                    PerformActionEnum origin = method.getActionEnum();

                    if (buttonPosition == 1) {
                        if (origin == PerformActionEnum.IF || origin == PerformActionEnum.WHILE) {
                            String checkVal = method.getParam(LogicUtil.CHECK_PARAM);
                            if (!StringUtil.startWith(checkVal, LogicUtil.ASSERT_ACTION_PREFIX)) {
                                LauncherApplication.getInstance().showToast("无法转化为原始方法");
                                return Menu.ITEM_SCROLL_BACK;
                            }
                            String originCode = checkVal.substring(LogicUtil.ASSERT_ACTION_PREFIX.length());
                            PerformActionEnum action = PerformActionEnum.getActionEnumByCode(originCode);
                            method.setActionEnum(action);
                            wrapper.scopeTo = -1;
                            method.removeParam(LogicUtil.CHECK_PARAM);
                            method.removeParam(SCOPE);
                        } else {
                            method.setActionEnum(PerformActionEnum.IF);
                            wrapper.scopeTo = wrapper.idx + 1;
                            // 设置assert条件
                            method.putParam(LogicUtil.CHECK_PARAM, LogicUtil.ASSERT_ACTION_PREFIX + origin.getCode());
                        }
                    } else if (buttonPosition == 2) {
                        method.setActionEnum(PerformActionEnum.WHILE);
                        wrapper.scopeTo = wrapper.idx + 1;
                        // 设置assert条件
                        method.putParam(LogicUtil.CHECK_PARAM, LogicUtil.ASSERT_ACTION_PREFIX + origin.getCode());
                    }
                    adapter.notifyDataSetChanged();

                    return Menu.ITEM_SCROLL_BACK;
                }
                return 0;
            }
        });

        dragList.setOnDragDropListener(adapter);
        dragList.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                showEditDialog(dragEntities.get(position));
            }
        });
    }

    /**
     * 切换选择模式
     */
    private void switchSelectMode() {
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                selectMode = !selectMode;
                tagGroup.getAdapter().notifyDataChanged();
                adapter.setCurrentMode(selectMode);
            }
        });
    }

    @Override
    public boolean onTagClick(View view, int position, FlowLayout parent) {
        if (position == 0) {
            if (!selectMode) {
                showSelectModeAction(dragEntities.size());
            } else {
                List<CaseStepAdapter.MyDataWrapper> wrappers = adapter.getAndClearSelectOperationSteps();
                if (wrappers.size() == 0) {
                    return true;
                }
                List<OperationStep> steps = new ArrayList<>(wrappers.size() + 1);
                for (CaseStepAdapter.MyDataWrapper wrapper: wrappers) {
                    steps.add(wrapper.currentStep);
                }

                CaseStepHolder.storePasteContent(steps);
                switchSelectMode();
            }
            return true;
        } else if (position == 1) {
            switchSelectMode();
            return true;
        } else if (position == 2) {
            List<OperationStep> pasteSteps = CaseStepHolder.getPasteContent();
            if (pasteSteps != null && pasteSteps.size() > 0) {
                for (OperationStep step: pasteSteps) {
                    CaseStepAdapter.MyDataWrapper wrapper = new CaseStepAdapter.MyDataWrapper(step, currentIdx.getAndIncrement());
                    dragEntities.add(wrapper);
                }

                adapter.notifyDataSetChanged();
            }
            return true;
        } else if (position == 3) {
            return addRecordCases(-1);
        }

        OperationStep step = stepList.get(position - 4);
        CaseStepAdapter.MyDataWrapper entity = new CaseStepAdapter.MyDataWrapper(clone(step), currentIdx.getAndIncrement());

        // 如果是if和while，需要设置为0
        OperationMethod method = step.getOperationMethod();
        if (method.getActionEnum() == PerformActionEnum.IF || method.getActionEnum() == PerformActionEnum.WHILE) {
            entity.scopeTo = 0;
        }

        dragEntities.add(entity);
        // 添加用例步骤
        adapter.notifyDataSetChanged();

        return true;
    }

    /**
     * 将scopeTo信息存储到param中
     */
    private void saveScopeInfo() {
        for (int i = 0; i < dragEntities.size(); i++) {
            CaseStepAdapter.MyDataWrapper wrapper = dragEntities.get(i);

            if (wrapper.scopeTo > -1) {
                for (int j = i + 1; j < dragEntities.size(); j++) {
                    CaseStepAdapter.MyDataWrapper to = dragEntities.get(j);

                    if (to.idx == wrapper.scopeTo) {
                        wrapper.currentStep.getOperationMethod().putParam(SCOPE, Integer.toString(j - i));
                        break;
                    }
                }
            }
        }
    }

    private boolean addRecordCases(final int position) {
        final CaseEditActivity activity = (CaseEditActivity) getActivity();
        activity.wrapRecordCase();

        final RecordCaseInfo caseInfo = activity.getRecordCase();
        if (caseInfo == null) {
            return false;
        }
        // 检查权限
        PermissionUtil.requestPermissions(Arrays.asList("adb", Settings.ACTION_ACCESSIBILITY_SETTINGS), activity, new PermissionUtil.OnPermissionCallback() {
            @Override
            public void onPermissionResult(boolean result, String reason) {
                if (result) {
                    showProgressDialog(getString(R.string.step_edit__now_loading));
                    BackgroundExecutor.execute(new Runnable() {
                        @Override
                        public void run() {
                            boolean prepareResult = PrepareUtil.doPrepareWork(caseInfo.getTargetAppPackage(), new PrepareUtil.PrepareStatus() {
                                @Override
                                public void currentStatus(int progress, int total, String message, boolean status) {
                                    updateProgressDialog(progress, total, message);
                                }
                            });


                            if (prepareResult) {
                                final CaseAppendOperationProcessor processor = new CaseAppendOperationProcessor(caseInfo);
                                dismissProgressDialog();
                                if (position > -1) {
                                    processor.setInsertPosition(position);
                                }
                                activity.runOnUiThread(new Runnable() {
                                    @Override
                                    public void run() {
                                        LauncherApplication.service(OperationStepService.class).registerStepProcessor(processor);
                                        CaseRecordManager manager = LauncherApplication.service(CaseRecordManager.class);
                                        manager.setRecordCase(caseInfo);

                                        AppUtil.startApp(caseInfo.getTargetAppPackage());
                                        activity.finish();
                                    }
                                });
                            } else {
                                dismissProgressDialog();
                                toastShort(getString(R.string.step_edit__prepare_env_fail));
                            }
                        }
                    });
                }
            }
        });

        return true;
    }

    @Override
    public void onCaseSave() {
        // 同步下scope信息
        saveScopeInfo();

        List<OperationStep> operations = new ArrayList<>(dragEntities.size() + 1);
        for (CaseStepAdapter.MyDataWrapper wrapper: dragEntities) {
            operations.add(wrapper.currentStep);
        }

        GeneralOperationLogBean logBean = new GeneralOperationLogBean();
        logBean.setSteps(operations);
        logBean.setStorePath(storePath);
        OperationStepUtil.beforeStore(logBean);

        recordCase.setOperationLog(JSON.toJSONString(logBean));
    }

    /**
     * 显示编辑框
     * @param wrapper
     */
    private void showEditDialog(final CaseStepAdapter.MyDataWrapper wrapper) {
        final View v = LayoutInflater.from(getActivity()).inflate(R.layout.dialog_case_step_edit, null);
        final RecyclerView r = (RecyclerView) v.findViewById(R.id.dialog_case_step_edit_recycler);
        MaxHeightScrollView scroll = (MaxHeightScrollView) v.findViewById(R.id.dialog_case_step_edit_scroll);
        DisplayMetrics dm = new DisplayMetrics();
        ((WindowManager) LauncherApplication.getInstance().getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getMetrics(dm);
        final int height = dm.heightPixels;
        scroll.setMaxHeight(height / 2);

        // 拷贝一份
        final OperationStep clone = clone(wrapper.currentStep);
        r.setLayoutManager(new LinearLayoutManager(getActivity()));

        final CaseStepNodeAdapter nodeAdapter;
        final TabLayout tab = (TabLayout) v.findViewById(R.id.dialog_case_step_edit_tab);
        if (clone.getOperationNode() != null) {
            TabLayout.Tab tabItem = tab.newTab();
            tabItem.setText(R.string.step_edit__node_info);
            tab.addTab(tabItem);
            tabItem.select();
            nodeAdapter = new CaseStepNodeAdapter(clone.getOperationNode());
        } else {
            nodeAdapter = null;
        }
        TabLayout.Tab tabItem = tab.newTab();
        tabItem.setText(R.string.step_edit__method_info);
        tab.addTab(tabItem, 0);

        // 配置后续列表
        final List<CaseStepAdapter.MyDataWrapper> laterList;
        int curPos = dragEntities.indexOf(wrapper);
        if (wrapper.scopeTo > -1) {
            laterList = dragEntities.subList(curPos + 1, dragEntities.size());

            boolean flag = false;
            for (int pos = curPos + 1; pos < dragEntities.size(); pos++) {
                if (dragEntities.get(pos).idx == wrapper.scopeTo) {
                    clone.getOperationMethod().putParam(SCOPE, Integer.toString(pos - curPos));
                    flag = true;
                    break;
                }
            }
            if (!flag) {
                clone.getOperationMethod().putParam(SCOPE, "1");
            }
        } else {
            laterList = new ArrayList<>();
        }

        final CaseStepMethodAdapter paramAdapter = new CaseStepMethodAdapter(laterList,
                clone.getOperationMethod());

        tab.addOnTabSelectedListener(new TabLayout.OnTabSelectedListener() {
            @Override
            public void onTabSelected(TabLayout.Tab tab) {
                if (StringUtil.equals(tab.getText(), getString(R.string.step_edit__node_info))) {
                    r.setAdapter(nodeAdapter);
                } else {
                    r.setAdapter(paramAdapter);
                }
            }

            @Override
            public void onTabUnselected(TabLayout.Tab tab) {

            }

            @Override
            public void onTabReselected(TabLayout.Tab tab) {

            }
        });

        // 配置选中的tab
        if (paramAdapter.getItemCount() > 0) {
            tabItem.select();
            r.setAdapter(paramAdapter);
        } else {
            if (nodeAdapter == null) {
                tabItem.select();
                r.setAdapter(paramAdapter);
            } else {
                TabLayout.Tab nodeTab = tab.getTabAt(1);
                if (nodeTab != null) {
                    nodeTab.select();
                }

                r.setAdapter(nodeAdapter);
            }
        }

        DialogInterface.OnClickListener dialogClick = new DialogInterface.OnClickListener() {
            @Override
            public void onClick(DialogInterface dialog, int which) {
                if (which == Dialog.BUTTON_POSITIVE) {
                    wrapper.currentStep = clone;

                    // 如果需要配置scopeTo
                    if (wrapper.scopeTo > -1) {
                        int pos = Integer.parseInt(clone.getOperationMethod().getParam(SCOPE)) - 1;
                        wrapper.scopeTo = laterList.get(pos).idx;
                    }

                    adapter.notifyDataSetChanged();
                }
            }
        };

        final AlertDialog dialog = new AlertDialog.Builder(getActivity())
                .setView(v).setPositiveButton(R.string.constant__confirm, dialogClick)
                .setNegativeButton(R.string.constant__cancel, dialogClick)
                .setTitle(clone.getOperationMethod().getActionEnum().getDesc()).create();
        dialog.show();

        // 选择第一个
        dialog.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM);
    }

    /**
     * 基于Parcel拷贝一份数据
     * @param origin
     * @return
     */
    private OperationStep clone(OperationStep origin) {
        Parcel p = Parcel.obtain();
        origin.writeToParcel(p, 0);
        p.setDataPosition(0);
        return OperationStep.CREATOR.createFromParcel(p);
    }

    /**
     * 展示选择添加步骤模式
     */
    private void showSelectModeAction(final int position) {
        final String[] actions = new String[]{getString(R.string.case_step_edit__node_action),
                getString(R.string.case_step_edit__global_action),
                getString(R.string.case_step_edit__record_add_action)};
        AlertDialog.Builder builder = new AlertDialog.Builder(getActivity(), R.style.AppDialogTheme)
                .setTitle(R.string.case_step_edit__select_add_action)
                .setSingleChoiceItems(actions, -1, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        LogUtil.i(TAG, "Click " + which);

                        if (dialog != null) {
                            dialog.dismiss();
                        }

                        if (which == 0) {
                            showCreateNodeView(position);
                        } else if (which == 1){
                            showAddFunctionView(null, position);
                        } else if (which == 2) {
                            addRecordCases(position);
                        }
                    }
                }).setNegativeButton(R.string.constant__cancel, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        dialog.dismiss();
                    }
                });

        AlertDialog dialog = builder.create();
        dialog.setCanceledOnTouchOutside(false);
        dialog.setCancelable(false);
        dialog.show();
    }

    /**
     * 展示创建控件界面
     */
    private void showCreateNodeView(final int position) {
        // 渲染创建控件的View
        View createNodeView = LayoutInflater.from(getActivity()).inflate(R.layout.dialog_create_node, null);
        final EditText className = (EditText) createNodeView.findViewById(R.id.create_node_classname);
        final EditText text = (EditText) createNodeView.findViewById(R.id.create_node_text);
        final EditText resId = (EditText) createNodeView.findViewById(R.id.create_node_res_id);
        final EditText xpath = (EditText) createNodeView.findViewById(R.id.create_node_xpath);

        final AlertDialog dialog = new AlertDialog.Builder(getActivity())
                .setView(createNodeView).setPositiveButton(R.string.case_step_edit__select_action, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        OperationNode node = new OperationNode();
                        String classNameText = className.getText().toString();
                        if (StringUtil.isEmpty(classNameText)) {
                            classNameText = "*";
                        }
                        node.setClassName(classNameText);

                        String textText = text.getText().toString();
                        if (StringUtil.isEmpty(textText)) {
                            textText = null;
                        }
                        node.setText(textText);
                        node.setDescription(textText);

                        String resIdText = resId.getText().toString();
                        if (StringUtil.isEmpty(resIdText)) {
                            resIdText = null;
                        }
                        node.setResourceId(resIdText);

                        String xpathText = xpath.getText().toString();
                        if (StringUtil.isEmpty(xpathText)) {
                            xpathText = null;
                        }
                        node.setXpath(xpathText);

                        if (dialog != null) {
                            dialog.dismiss();
                        }

                        // 默认使用辅助功能控件
                        node.setNodeType(AccessibilityNodeTree.class.getSimpleName());
                        showAddFunctionView(node, position);
                    }
                })
                .setNegativeButton(R.string.constant__cancel, null)
                .setTitle(R.string.case_step_edit__set_node_info).create();
        dialog.show();

        // 选择第一个
        dialog.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM);
    }

    /**
     * 显示添加操作界面
     */
    private void showAddFunctionView(final OperationNode node, final int position) {
        if (node != null) {
            AbstractNodeTree tmpNode = new FakeLocatingNode(node);
            FunctionSelectUtil.showFunctionView(getActivity(), tmpNode, NODE_KEYS, NODE_ICONS,
                    NODE_ACTION_MAP, null, null, null,
                    new FunctionSelectUtil.FunctionListener() {
                        @Override
                        public void onProcessFunction(final OperationMethod method, AbstractNodeTree fake) {
                            PerformActionEnum action = method.getActionEnum();
                            OperationStep step = new OperationStep();
                            step.setOperationMethod(method);
                            OperationStep lastStep = stepList.get(stepList.size() - 1);
                            step.setOperationId(lastStep.getOperationId());
                            step.setOperationIndex(lastStep.getOperationIndex() + 1);
                            step.setOperationNode(node);

                            CaseStepAdapter.MyDataWrapper wrapper = new CaseStepAdapter.MyDataWrapper(step, currentIdx.getAndIncrement());
                            dragEntities.add(position, wrapper);
                            adapter.notifyDataSetChanged();
                        }

                        @Override
                        public void onCancel() {

                        }
                    });
        } else {
            FunctionSelectUtil.showFunctionView(getActivity(), null, GLOBAL_KEYS, GLOBAL_ICONS,
                    GLOBAL_ACTION_MAP, null, null, null,
                    new FunctionSelectUtil.FunctionListener() {
                        @Override
                        public void onProcessFunction(OperationMethod method, AbstractNodeTree node) {
                            PerformActionEnum action = method.getActionEnum();
                            if (action == PerformActionEnum.JUMP_TO_PAGE
                                    || action == PerformActionEnum.GENERATE_QR_CODE
                                    || action == PerformActionEnum.LOAD_PARAM) {

                                if (StringUtil.equals(method.getParam("scan"), "1")) {
                                    // 注册下Service
                                    InjectorService injectorService = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
                                    injectorService.register(CaseStepEditFragment.this);


                                    Intent intent = new Intent(getActivity(), QRScanActivity.class);
                                    if (action == PerformActionEnum.JUMP_TO_PAGE) {
                                        intent.putExtra(QRScanActivity.KEY_SCAN_TYPE, ScanSuccessEvent.SCAN_TYPE_SCHEME);
                                    } else if (action == PerformActionEnum.GENERATE_QR_CODE) {
                                        intent.putExtra(QRScanActivity.KEY_SCAN_TYPE, ScanSuccessEvent.SCAN_TYPE_QR_CODE);
                                    } else if (action == PerformActionEnum.LOAD_PARAM) {
                                        intent.putExtra(QRScanActivity.KEY_SCAN_TYPE, ScanSuccessEvent.SCAN_TYPE_PARAM);
                                    }
                                    intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                    if (position != dragEntities.size()) {
                                        tmpPosition = position;
                                    } else {
                                        tmpPosition = -1;
                                    }
                                    startActivity(intent);
                                    return;
                                }
                            }

                            OperationStep step = new OperationStep();
                            step.setOperationMethod(method);

                            // 从空添加
                            if (stepList.size() > 0) {
                                OperationStep lastStep = stepList.get(stepList.size() - 1);
                                step.setOperationId(lastStep.getOperationId());
                                step.setOperationIndex(lastStep.getOperationIndex() + 1);
                            } else {
                                step.setOperationId("1");
                                step.setOperationIndex(1);
                            }

                            CaseStepAdapter.MyDataWrapper wrapper = new CaseStepAdapter.MyDataWrapper(step, currentIdx.getAndIncrement());

                            // if和while设置下scope，不要在最后一位
                            if (method.getActionEnum() == PerformActionEnum.IF || method.getActionEnum() == PerformActionEnum.WHILE) {
                                if (dragEntities.size() > 0) {
                                    CaseStepAdapter.MyDataWrapper last = dragEntities.get(dragEntities.size() - 1);
                                    wrapper.scopeTo = last.idx;
                                    dragEntities.add(Math.min(dragEntities.size() - 1, position), wrapper);
                                } else {
                                    wrapper.scopeTo = wrapper.idx;
                                    dragEntities.add(position, wrapper);
                                }
                            } else {
                                dragEntities.add(position, wrapper);
                            }


                            adapter.notifyDataSetChanged();
                        }

                        @Override
                        public void onCancel() {

                        }
                    });
        }
    }

    protected static final List<Integer> GLOBAL_KEYS = new ArrayList<>();

    protected static final List<Integer> GLOBAL_ICONS = new ArrayList<>();

    protected static final Map<Integer, List<TwoLevelSelectLayout.SubMenuItem>> GLOBAL_ACTION_MAP = new HashMap<>();

    protected static final List<Integer> NODE_KEYS = new ArrayList<>();

    protected static final List<Integer> NODE_ICONS = new ArrayList<>();

    protected static final Map<Integer, List<TwoLevelSelectLayout.SubMenuItem>> NODE_ACTION_MAP = new HashMap<>();


    // 初始化二级菜单
    static {
        // 节点操作
        NODE_KEYS.add(R.string.function_group__click);
        NODE_ICONS.add(R.drawable.dialog_action_drawable_quick_click_2);
        List<TwoLevelSelectLayout.SubMenuItem> clickActions = new ArrayList<>();
        clickActions.add(convertPerformActionToSubMenu(PerformActionEnum.CLICK));
        clickActions.add(convertPerformActionToSubMenu(PerformActionEnum.LONG_CLICK));
        clickActions.add(convertPerformActionToSubMenu(PerformActionEnum.CLICK_IF_EXISTS));
        clickActions.add(convertPerformActionToSubMenu(PerformActionEnum.CLICK_QUICK));
        clickActions.add(convertPerformActionToSubMenu(PerformActionEnum.MULTI_CLICK));
        NODE_ACTION_MAP.put(R.string.function_group__click, clickActions);

        NODE_KEYS.add(R.string.function_group__input);
        NODE_ICONS.add(R.drawable.dialog_action_drawable_input);
        List<TwoLevelSelectLayout.SubMenuItem> inputActions = new ArrayList<>();
        inputActions.add(convertPerformActionToSubMenu(PerformActionEnum.INPUT));
        inputActions.add(convertPerformActionToSubMenu(PerformActionEnum.INPUT_SEARCH));
        NODE_ACTION_MAP.put(R.string.function_group__input, inputActions);

        NODE_KEYS.add(R.string.function_group__scroll);
        NODE_ICONS.add(R.drawable.dialog_action_drawable_scroll);
        List<TwoLevelSelectLayout.SubMenuItem> scrollActions = new ArrayList<>();
        scrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.SCROLL_TO_BOTTOM));
        scrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.SCROLL_TO_TOP));
        scrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.SCROLL_TO_LEFT));
        scrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.SCROLL_TO_RIGHT));
        scrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.GESTURE));
        NODE_ACTION_MAP.put(R.string.function_group__scroll, scrollActions);

        NODE_KEYS.add(R.string.function_group__assert);
        NODE_ICONS.add(R.drawable.dialog_action_drawable_assert);
        List<TwoLevelSelectLayout.SubMenuItem> assertActions = new ArrayList<>();
        assertActions.add(convertPerformActionToSubMenu(PerformActionEnum.ASSERT));
        assertActions.add(convertPerformActionToSubMenu(PerformActionEnum.SLEEP_UNTIL));
        assertActions.add(convertPerformActionToSubMenu(PerformActionEnum.LET_NODE));
        assertActions.add(convertPerformActionToSubMenu(PerformActionEnum.CHECK_NODE));
        NODE_ACTION_MAP.put(R.string.function_group__assert, assertActions);

        // 全局操作
        GLOBAL_KEYS.add(R.string.function_group__device);
        GLOBAL_ICONS.add(R.drawable.dialog_action_drawable_device_operation);
        List<TwoLevelSelectLayout.SubMenuItem> gDeviceActions = new ArrayList<>();
        gDeviceActions.add(convertPerformActionToSubMenu(PerformActionEnum.BACK));
        gDeviceActions.add(convertPerformActionToSubMenu(PerformActionEnum.HOME));
        gDeviceActions.add(convertPerformActionToSubMenu(PerformActionEnum.HANDLE_ALERT));
        gDeviceActions.add(convertPerformActionToSubMenu(PerformActionEnum.SCREENSHOT));
        gDeviceActions.add(convertPerformActionToSubMenu(PerformActionEnum.SLEEP));
        gDeviceActions.add(convertPerformActionToSubMenu(PerformActionEnum.EXECUTE_SHELL));
        gDeviceActions.add(convertPerformActionToSubMenu(PerformActionEnum.NOTIFICATION));
        gDeviceActions.add(convertPerformActionToSubMenu(PerformActionEnum.RECENT_TASK));
        GLOBAL_ACTION_MAP.put(R.string.function_group__device, gDeviceActions);

        GLOBAL_KEYS.add(R.string.function_group__app);
        GLOBAL_ICONS.add(R.drawable.dialog_action_drawable_app_operation);
        List<TwoLevelSelectLayout.SubMenuItem> gAppActions = new ArrayList<>();
        gAppActions.add(convertPerformActionToSubMenu(PerformActionEnum.GOTO_INDEX));
        gAppActions.add(convertPerformActionToSubMenu(PerformActionEnum.CHANGE_MODE));
        gAppActions.add(convertPerformActionToSubMenu(PerformActionEnum.JUMP_TO_PAGE));
        gAppActions.add(convertPerformActionToSubMenu(PerformActionEnum.GENERATE_QR_CODE));
        gAppActions.add(convertPerformActionToSubMenu(PerformActionEnum.GENERATE_BAR_CODE));
        gAppActions.add(convertPerformActionToSubMenu(PerformActionEnum.KILL_PROCESS));
        GLOBAL_ACTION_MAP.put(R.string.function_group__app, gAppActions);

        GLOBAL_KEYS.add(R.string.function_group__scroll);
        GLOBAL_ICONS.add(R.drawable.dialog_action_drawable_scroll);
        List<TwoLevelSelectLayout.SubMenuItem> gScrollActions = new ArrayList<>();
        gScrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.GLOBAL_SCROLL_TO_BOTTOM));
        gScrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.GLOBAL_SCROLL_TO_TOP));
        gScrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.GLOBAL_SCROLL_TO_LEFT));
        gScrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.GLOBAL_SCROLL_TO_RIGHT));
        gScrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.GLOBAL_PINCH_OUT));
        gScrollActions.add(convertPerformActionToSubMenu(PerformActionEnum.GLOBAL_PINCH_IN));
        GLOBAL_ACTION_MAP.put(R.string.function_group__scroll, gScrollActions);

        // 循环逻辑控制
        GLOBAL_KEYS.add(R.string.function_group__logic);
        GLOBAL_ICONS.add(R.drawable.dialog_action_drawable_logic);
        List<TwoLevelSelectLayout.SubMenuItem> gLoopActions = new ArrayList<>();
        gLoopActions.add(convertPerformActionToSubMenu(PerformActionEnum.IF));
        gLoopActions.add(convertPerformActionToSubMenu(PerformActionEnum.LET));
        gLoopActions.add(convertPerformActionToSubMenu(PerformActionEnum.CHECK));
        gLoopActions.add(convertPerformActionToSubMenu(PerformActionEnum.WHILE));
        gLoopActions.add(convertPerformActionToSubMenu(PerformActionEnum.CONTINUE));
        gLoopActions.add(convertPerformActionToSubMenu(PerformActionEnum.BREAK));
        gLoopActions.add(convertPerformActionToSubMenu(PerformActionEnum.LOAD_PARAM));
        GLOBAL_ACTION_MAP.put(R.string.function_group__logic, gLoopActions);
    }

    /**
     * 转换为菜单
     * @param actionEnum
     * @return
     */
    private static TwoLevelSelectLayout.SubMenuItem convertPerformActionToSubMenu(PerformActionEnum actionEnum) {
        return new TwoLevelSelectLayout.SubMenuItem(actionEnum.getDesc(),
                actionEnum.getCode(), actionEnum.getIcon());
    }


    private static class FakeLocatingNode extends AbstractNodeTree {
        private FakeLocatingNode(OperationNode node) {
            setClassName(node.getClassName());
            setText(node.getText());
            setDescription(node.getDescription());
            setXpath(node.getXpath());
            setResourceId(node.getResourceId());
            setVisible(true);
        }

        @Override
        public boolean canDoAction(PerformActionEnum action) {
            return false;
        }

        @Override
        public StringBuilder printTrace(StringBuilder builder) {
            return null;
        }

        @Override
        public boolean isSelfUsableForLocating() {
            return true;
        }
    }
}
