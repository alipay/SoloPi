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
import android.support.annotation.Nullable;
import android.support.design.widget.TabLayout;
import android.support.v7.app.AlertDialog;
import android.support.v7.widget.LinearLayoutManager;
import android.support.v7.widget.RecyclerView;
import android.util.DisplayMetrics;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.animation.AnimationUtils;
import android.view.animation.LayoutAnimationController;
import android.widget.AdapterView;
import android.widget.ImageView;
import android.widget.TextView;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.R;
import com.alipay.hulu.activity.CaseEditActivity;
import com.alipay.hulu.activity.NewRecordActivity;
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
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.event.ScanSuccessEvent;
import com.alipay.hulu.service.CaseRecordManager;
import com.alipay.hulu.shared.io.OperationStepService;
import com.alipay.hulu.shared.io.bean.GeneralOperationLogBean;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.io.db.GreenDaoManager;
import com.alipay.hulu.shared.io.util.OperationStepUtil;
import com.alipay.hulu.shared.node.action.OperationExecutor;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
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

                dragEntities.add(wrapper);

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

                dragEntities.add(wrapper);

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
        int dp64 = ContextUtil.dip2px(getActivity(), 64);
        int colorWhile;
        int colorIf;
        if (Build.VERSION.SDK_INT >= 23) {
            colorWhile = getActivity().getColor(R.color.colorStatusBlue);
            colorIf = getActivity().getColor(R.color.colorStatusRed);
        } else {
            colorWhile = getResources().getColor(R.color.colorStatusBlue);
            colorIf = getResources().getColor(R.color.colorStatusRed);
        }

        // 转换模式
        Menu menu = new Menu(true, 0);
        menu.addItem(new MenuItem.Builder().setText(getString(R.string.step_edit__convert_if)).setTextColor(Color.WHITE).setWidth(dp64)
                .setDirection(MenuItem.DIRECTION_RIGHT)
                .setBackground(new ColorDrawable(colorIf)).build());
        menu.addItem(new MenuItem.Builder().setText(getString(R.string.step_edit__convert_while)).setTextColor(Color.WHITE)
                .setWidth(dp64)
                .setDirection(MenuItem.DIRECTION_RIGHT)
                .setBackground(new ColorDrawable(colorWhile)).build());

        // 空项
        Menu controlMenu = new Menu(false, 1);

        dragList.setMenu(menu, controlMenu);
        dragList.setDividerHeight(0);
        dragList.setAdapter(adapter);
        dragList.setOnMenuItemClickListener(new SlideAndDragListView.OnMenuItemClickListener() {
            @Override
            public int onMenuItemClick(View v, int itemPosition, int buttonPosition, int direction) {
                if (direction == MenuItem.DIRECTION_RIGHT) {
                    // 全部操作均支持转化
                    CaseStepAdapter.MyDataWrapper wrapper = dragEntities.get(itemPosition);

                    OperationMethod method = wrapper.currentStep.getOperationMethod();
                    PerformActionEnum origin = method.getActionEnum();

                    if (buttonPosition == 0) {
                        method.setActionEnum(PerformActionEnum.IF);
                        wrapper.scopeTo = wrapper.idx + 1;
                    } else if (buttonPosition == 1) {
                        method.setActionEnum(PerformActionEnum.WHILE);
                        wrapper.scopeTo = wrapper.idx + 1;
                    }
                    // 设置assert条件
                    method.putParam(LogicUtil.CHECK_PARAM, LogicUtil.ASSERT_ACTION_PREFIX + origin.getCode());
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
                showAddFunctionView();
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
     * 显示添加操作界面
     */
    private void showAddFunctionView() {
        FunctionSelectUtil.showFunctionView(getActivity(), null, GLOBAL_KEYS, GLOBAL_ICONS,
                GLOBAL_ACTION_MAP, null, null, null,
                new FunctionSelectUtil.FunctionListener() {
                    @Override
                    public void onProcessFunction(OperationMethod method, AbstractNodeTree node) {
                        PerformActionEnum action = method.getActionEnum();
                        if (action == PerformActionEnum.JUMP_TO_PAGE
                                || action == PerformActionEnum.LOAD_PARAM) {

                            if (StringUtil.equals(method.getParam("scan"), "1")) {
                                // 注册下Service
                                InjectorService injectorService = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
                                injectorService.register(CaseStepEditFragment.this);


                                Intent intent = new Intent(getActivity(), QRScanActivity.class);

                                if (action == PerformActionEnum.JUMP_TO_PAGE) {
                                    intent.putExtra(QRScanActivity.KEY_SCAN_TYPE, ScanSuccessEvent.SCAN_TYPE_SCHEME);
                                } else if (action == PerformActionEnum.LOAD_PARAM) {
                                    intent.putExtra(QRScanActivity.KEY_SCAN_TYPE, ScanSuccessEvent.SCAN_TYPE_PARAM);
                                }
                                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
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
                                dragEntities.add(dragEntities.size() - 1, wrapper);
                            } else {
                                wrapper.scopeTo = wrapper.idx;
                                dragEntities.add( wrapper);
                            }
                        } else {
                            dragEntities.add(wrapper);
                        }


                        adapter.notifyDataSetChanged();
                    }

                    @Override
                    public void onCancel() {

                    }
                });
    }

    protected static final List<Integer> GLOBAL_KEYS = new ArrayList<>();

    protected static final List<Integer> GLOBAL_ICONS = new ArrayList<>();

    protected static final Map<Integer, List<TwoLevelSelectLayout.SubMenuItem>> GLOBAL_ACTION_MAP = new HashMap<>();

    // 初始化二级菜单
    static {
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
}
