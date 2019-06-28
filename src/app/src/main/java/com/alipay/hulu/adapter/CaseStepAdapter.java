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
package com.alipay.hulu.adapter;

import android.content.Context;
import android.graphics.Bitmap;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.ImageView;
import android.widget.RelativeLayout;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.actions.ImageCompareActionProvider;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.action.OperationExecutor;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.action.provider.ActionProviderManager;
import com.alipay.hulu.shared.node.tree.OperationNode;
import com.alipay.hulu.shared.node.tree.export.OperationStepProvider;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;
import com.alipay.hulu.shared.node.utils.BitmapUtil;
import com.alipay.hulu.shared.node.utils.LogicUtil;
import com.alipay.hulu.ui.CaseStepStatusView;
import com.alipay.hulu.ui.ReverseImageView;
import com.yydcdut.sdlv.SlideAndDragListView;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Created by qiaoruikai on 2019/2/18 9:50 PM.
 */
public class CaseStepAdapter extends BaseAdapter implements View.OnClickListener, SlideAndDragListView.OnDragDropListener {
    private Context context;
    private int SCOPE_OFFSET_DP = 10;
    private List<MyDataWrapper> data;

    private List<int[]> runningScope = new ArrayList<>();

    private MyDataWrapper currentDragEntity;

    public CaseStepAdapter(Context context, List<MyDataWrapper> data) {
        this.context = context;
        this.data = data;

        reloadScope();
    }

    @Override
    public int getItemViewType(int position) {
        OperationMethod method = data.get(position).currentStep.getOperationMethod();
        // 逻辑操作项不支持继续添加
        if (method.getActionEnum() == PerformActionEnum.IF
                || method.getActionEnum() == PerformActionEnum.WHILE
                || method.getActionEnum() == PerformActionEnum.BREAK
                || method.getActionEnum() == PerformActionEnum.CONTINUE) {
            return 1;
        }
        return 0;
    }

    @Override
    public void notifyDataSetChanged() {
        reloadScope();
        super.notifyDataSetChanged();
    }

    @Override
    public int getViewTypeCount() {
        return 2;
    }

    @Override
    public int getCount() {
        return data.size();
    }

    @Override
    public Object getItem(int position) {
        return data.get(position);
    }

    @Override
    public long getItemId(int position) {
        return 0;
    }

    @Override
    public View getView(int position, View convertView, ViewGroup parent) {
        boolean init = false;
        if (convertView == null) {
            convertView = LayoutInflater.from(ContextUtil.getContextThemeWrapper(context,
                    R.style.AppTheme)).inflate(R.layout.item_case_step_content, parent, false);
            init = true;
        }

        // 设置tag
        convertView.setTag(position);

        // 加载控件
        CaseStepStatusView status = (CaseStepStatusView) convertView.findViewById(R.id.case_step_edit_content_status);
        ReverseImageView img = (ReverseImageView) convertView.findViewById(R.id.case_step_edit_content_icon);
        ImageView capture = (ImageView) convertView.findViewById(R.id.case_step_edit_content_capture);

        TextView title = (TextView) convertView.findViewById(R.id.case_step_edit_content_title);
        TextView param = (TextView) convertView.findViewById(R.id.case_step_edit_content_param);
        ImageView icon = (ImageView) convertView.findViewById(R.id.case_step_edit_content_close);
        icon.setTag(position);

        // 如果是第一次加载，设置下ClickListener
        if (init) {
            icon.setOnClickListener(this);
        }

        List<Integer> occurred = new ArrayList<>();
        int start = -1;
        List<Integer> end = new ArrayList<>();
        int offset = 0;
        String text = null;
        for (int i = 0; i < runningScope.size(); i++) {
            int[] scope = runningScope.get(i);
            // 空scope
            if (scope[0] == scope[1]) {
                continue;
            }

            if (position == scope[0]) {
                start = i;
            } else if (position > scope[0] && position < scope[1]) {
                occurred.add(i);
                offset += 1;
            } else if (position == scope[1]) {
                end.add(i);
                offset += 1;
                text = data.get(scope[0]).currentStep.getOperationMethod().getActionEnum().getDesc();
            }
        }

        // 如果有文字
        status.setText(text);
        status.setLevelStatus(occurred, start, end);
        RelativeLayout.LayoutParams lp = new RelativeLayout.LayoutParams(status.getLayoutParams());
        lp.setMargins(0, 0, ContextUtil.dip2px(context, SCOPE_OFFSET_DP) * offset, 0);
        status.setLayoutParams(lp);

        MyDataWrapper content = (MyDataWrapper) getItem(position);
        OperationMethod method = content.currentStep.getOperationMethod();
        OperationNode node = content.currentStep.getOperationNode();

        PerformActionEnum actionEnum = method.getActionEnum();

        // 设置图标、标题
        title.setText(loadTitle(actionEnum, method));

        String base64 = null;
        if (method.containsParam(ImageCompareActionProvider.KEY_TARGET_IMAGE)) {
            base64 = method.getParam(ImageCompareActionProvider.KEY_TARGET_IMAGE);
        } else if (node != null && node.containsExtra(OperationStepProvider.CAPTURE_IMAGE_BASE64)) {
            base64 = node.getExtraValue(OperationStepProvider.CAPTURE_IMAGE_BASE64);
        }

        // 如果有截图的话，使用截图作为图标
        if (base64 == null) {
            img.setVisibility(View.VISIBLE);
            capture.setVisibility(View.INVISIBLE);
            if (img.getTag() == null || ((int) img.getTag()) != actionEnum.getIcon()) {
                img.setTag(actionEnum.getIcon());
                img.resetImage(R.drawable.round_rect_mask, actionEnum.getIcon());
            }
        } else {
            img.setVisibility(View.INVISIBLE);
            capture.setVisibility(View.VISIBLE);
            Bitmap bitmap = BitmapUtil.base64ToBitmap(base64);
            capture.setImageBitmap(bitmap);
        }

        // 如果有控件，取控件text或description
        String paramsContent = null;

        // 如果参数包含值，随便取一个值
        for (String key : method.getParamKeys()) {
            if (StringUtil.equals(key, OperationExecutor.LOCAL_CLICK_POS_KEY)) {
                // screenSize,localClickPos不用
                continue;
            } else if (StringUtil.equals(key, LogicUtil.SCOPE)) {
                // 执行范围不显示
                continue;
            }

            paramsContent = key + "=" + method.getParam(key);
            break;
        }

        // 如果没有参数，取控件文本信息
        if (paramsContent == null && node != null) {
            if (!StringUtil.isEmpty(node.getText())) {
                paramsContent = "node=" + node.getText();
            } else if (!StringUtil.isEmpty(node.getDescription())) {
                paramsContent = "node=" + node.getDescription();
            }
        }

        param.setText(paramsContent);

        return convertView;
    }

    /**
     * 加载特定操作名称
     * @param actionEnum
     * @param method
     * @return
     */
    private String loadTitle(PerformActionEnum actionEnum, OperationMethod method) {
        if (actionEnum == PerformActionEnum.OTHER_GLOBAL || actionEnum == PerformActionEnum.OTHER_NODE) {
            String desc = method.getParam(ActionProviderManager.KEY_TARGET_ACTION_DESC);
            if (StringUtil.isEmpty(desc)) {
                desc = method.getParam(ActionProviderManager.KEY_TARGET_ACTION);
            }

            // 降级到其他操作
            if (StringUtil.isEmpty(desc)) {
                desc = actionEnum.getDesc();
            }

            // 设置文案
            return desc;
        } else {
            if (actionEnum == PerformActionEnum.IF || actionEnum == PerformActionEnum.WHILE) {
                String content;

                String info = method.getParam(LogicUtil.CHECK_PARAM);

                // 实际内容
                if (StringUtil.startWith(info, LogicUtil.LOOP_PREFIX)) {
                    content = info.substring(LogicUtil.LOOP_PREFIX.length()) + "次";
                } else if (StringUtil.startWith(info, LogicUtil.ASSERT_ACTION_PREFIX)) {
                    PerformActionEnum wrapAction = PerformActionEnum.getActionEnumByCode(info.substring(LogicUtil.ASSERT_ACTION_PREFIX.length()));
                    content = loadTitle(wrapAction, method);
                } else {
                    content = info;
                }

                return String.format(Locale.CHINA, "[%s]%s", actionEnum.getDesc(), content);
            }

            return actionEnum.getDesc();
        }
    }

    @Override
    public void onClick(View v) {
        int position = (int) v.getTag();
        data.remove(position);
        notifyDataSetChanged();
    }

    public static class MyDataWrapper {
        public OperationStep currentStep;
        /**
         * idx，全局唯一
         */
        public final int idx;

        public int scopeTo = -1;

        public MyDataWrapper(OperationStep currentStep, int idx) {
            this.currentStep = currentStep;
            this.idx = idx;
        }
    }

    private void reloadScope() {
        List<int[]> group = new ArrayList<>();
        for (int i = 0; i < data.size() - 1; i++) {
            MyDataWrapper item = data.get(i);
            if (item.scopeTo > -1) {
                for (int j = i + 1; j < data.size(); j++) {
                    if (data.get(j).idx == item.scopeTo) {
                        group.add(new int[] {i, j});
                        break;
                    }
                }
            }
        }

        // 反向一下
        Collections.reverse(group);
        runningScope.clear();
        runningScope.addAll(group);
    }

    @Override
    public void onDragViewStart(int beginPosition) {
        currentDragEntity = data.get(beginPosition);
    }

    @Override
    public void onDragDropViewMoved(int fromPosition, int toPosition) {
        MyDataWrapper applicationInfo = data.remove(fromPosition);
        data.add(toPosition, applicationInfo);
    }

    @Override
    public void onDragViewDown(int finalPosition) {
        data.set(finalPosition, currentDragEntity);
    }
}


