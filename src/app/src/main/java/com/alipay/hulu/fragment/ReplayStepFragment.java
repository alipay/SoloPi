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

import android.content.DialogInterface;
import android.os.Bundle;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.support.v7.app.AlertDialog;
import android.support.v7.widget.LinearLayoutManager;
import android.support.v7.widget.RecyclerView;
import android.util.Pair;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TableRow;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.actions.ImageCompareActionProvider;
import com.alipay.hulu.bean.CaseStepStatus;
import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.bean.ReplayStepInfoBean;
import com.alipay.hulu.common.utils.GlideApp;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.tree.export.OperationStepExporter;
import com.alipay.hulu.shared.node.tree.OperationNode;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;
import com.alipay.hulu.shared.node.utils.BitmapUtil;
import com.alipay.hulu.util.DialogUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class ReplayStepFragment extends Fragment {
    public static final String RESULT_BEAN_TAG = "ReplayStepBean";

    private ReplayResultBean resultBean;

    private List<Pair<OperationStep, ReplayStepInfoBean>> contents = null;

    private RecyclerView recyclerView;

    public static ReplayStepFragment newInstance(ReplayResultBean data) {
        ReplayStepFragment fragment = new ReplayStepFragment();
        Bundle args = new Bundle();
        args.putParcelable(RESULT_BEAN_TAG, data);
        fragment.setArguments(args);
        return fragment;
    }

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Bundle bundle = getArguments();
        if (bundle == null) {
            return;
        }

        resultBean = bundle.getParcelable(RESULT_BEAN_TAG);
        wrapDisplayData();
    }

    /**
     * 加载显示项
     */
    private void wrapDisplayData() {
        List<OperationStep> operationSteps = resultBean.getCurrentOperationLog();
        Map<Integer, ReplayStepInfoBean> actions = resultBean.getActionLogs();

        if (contents != null) {
            contents.clear();
        }
        contents = new ArrayList<>(operationSteps.size() + 1);

        for (int i = 0; i < operationSteps.size(); i++) {
            OperationStep operationStep = operationSteps.get(i);
            contents.add(new Pair<>(operationStep, actions.get(i)));
        }
    }

    @Nullable
    @Override
    public View onCreateView(LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_replay_result_main, container, false);
    }

    @Override
    public void onViewCreated(View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        initViewUI(view);

        initViewData(view);
    }

    private void initViewUI(View v) {
        recyclerView = (RecyclerView) v.findViewById(R.id.recycler_view_result_main);
    }

    private void initViewData(View v) {
        recyclerView.setLayoutManager(new LinearLayoutManager(this.getActivity()));
        recyclerView.setAdapter(new RecyclerView.Adapter<ResultItemViewHolder>() {
            private LayoutInflater mInflater = LayoutInflater.from(getActivity());
            @Override
            public ResultItemViewHolder onCreateViewHolder(ViewGroup parent, int viewType) {
                return new ResultItemViewHolder(mInflater.inflate(R.layout.item_case_result_step_actions, parent, false));
            }

            @Override
            public void onBindViewHolder(ResultItemViewHolder holder, int position) {
                Pair<OperationStep, ReplayStepInfoBean> data = contents.get(position);
                CaseStepStatus action = CaseStepStatus.FINISH;
                if (!StringUtil.isEmpty(resultBean.getExceptionMessage())) {
                    if (resultBean.getExceptionStep() == position) {
                        action = CaseStepStatus.FAIL;
                    } else if (resultBean.getExceptionStep() < position) {
                        action = CaseStepStatus.UNENFORCED;
                    }
                }
                holder.bindData(data.first, data.second == null? new ReplayStepInfoBean(): data.second, action);
            }

            @Override
            public int getItemCount() {
                return contents == null? 0: contents.size();
            }
        });

    }

    private static class ResultItemViewHolder extends RecyclerView.ViewHolder implements View.OnClickListener {
        TextView mActionName;
        TextView mActionParam;
        TextView mPrepareActions;
        TextView mStatus;
        TableRow mParamRow;
        TableRow mPrepareRow;
        TableRow mNodeRow;
        TableRow mCaptureRow;

        View mTargetNode;
        View mFindNode;

        ImageView mTargetCapture;
        ImageView mFindCapture;

        OperationStep logBean = null;
        ReplayStepInfoBean replayInfo = null;

        private byte[] findBytes;
        private byte[] targetBytes;

        ResultItemViewHolder(View v) {
            super(v);
            mActionName = (TextView) v.findViewById(R.id.text_case_result_step_title);
            mActionParam = (TextView) v.findViewById(R.id.text_case_result_step_param);
            mPrepareActions = (TextView) v.findViewById(R.id.text_case_result_step_prepare);
            mStatus = (TextView) v.findViewById(R.id.text_case_result_step_status);


            mParamRow = (TableRow) v.findViewById(R.id.row_case_result_step_param);
            mPrepareRow = (TableRow) v.findViewById(R.id.row_case_result_step_prepare);
            mNodeRow = (TableRow) v.findViewById(R.id.row_case_result_step_node);
            mCaptureRow = (TableRow) v.findViewById(R.id.row_case_result_step_capture);

            mTargetNode = mNodeRow.findViewById(R.id.text_case_result_step_target_node);
            mFindNode = mNodeRow.findViewById(R.id.text_case_result_step_find_node);

            mTargetCapture = (ImageView) mCaptureRow.findViewById(R.id.img_case_result_target);
            mFindCapture = (ImageView) mCaptureRow.findViewById(R.id.img_case_result_find);

            mTargetNode.setOnClickListener(this);
            mFindNode.setOnClickListener(this);
            mTargetCapture.setOnClickListener(this);
            mFindCapture.setOnClickListener(this);
        }

        void bindData(OperationStep operation, ReplayStepInfoBean replay, CaseStepStatus status) {
            mActionName.setText(operation.getOperationMethod().getActionEnum().getDesc());
            StringBuilder sb;

            logBean = operation;
            replayInfo = replay;

            // 配置操作参数
            OperationMethod method = operation.getOperationMethod();
            OperationNode node = operation.getOperationNode();
            OperationNode findNode = replay.getFindNode();
            if (method != null && method.getParamSize() > 0) {
                sb = new StringBuilder();
                for (String key : method.getParamKeys()) {
                    // 回放结果页，截图字段过长
                    String param = method.getParam(key);
                    // 限制不超过100个字符
                    if (param != null && param.length() > 100) {
                        param = param.substring(0, 97) + "...";
                    }
                    sb.append(key).append('=').append(param).append('\n');
                }
                mParamRow.setVisibility(View.VISIBLE);
                mActionParam.setText(sb.substring(0, sb.length() - 1));
            } else {
                mParamRow.setVisibility(View.GONE);
            }

            // 配置准备操作
            List<String> prepareActions = replay.getPrepareActionList();
            if (prepareActions != null && prepareActions.size() > 0) {
                sb = new StringBuilder();
                for (String action : prepareActions) {
                    sb.append(action).append('\n');
                }
                mPrepareRow.setVisibility(View.VISIBLE);
                mPrepareActions.setText(sb.substring(0, sb.length() - 1));
            } else {
                mPrepareRow.setVisibility(View.GONE);
            }

            // 配置状态
            if (status == CaseStepStatus.FINISH) {
                mStatus.setTextColor(0xff65c0ba);
            } else if (status == CaseStepStatus.FAIL) {
                mStatus.setTextColor(0xfff76262);
            } else {
                mStatus.setTextColor(mStatus.getResources().getColor(R.color.secondaryText));
            }
            mStatus.setText(status.getName());


            boolean captureFlag = false;
            try {
                // 获取base64信息
                findBytes = BitmapUtil.decodeBase64(findNode == null? null:
                        findNode.getExtraValue(OperationStepExporter.CAPTURE_IMAGE_BASE64));
                targetBytes = null;
                if (method != null) {
                    if (method.containsParam(ImageCompareActionProvider.KEY_TARGET_IMAGE)) {
                        targetBytes = BitmapUtil.decodeBase64(method.getParam(ImageCompareActionProvider.KEY_TARGET_IMAGE));
                    } else if (node != null && node.containsExtra(OperationStepExporter.CAPTURE_IMAGE_BASE64)) {
                        targetBytes = BitmapUtil.decodeBase64(node.getExtraValue(OperationStepExporter.CAPTURE_IMAGE_BASE64));
                    }
                }

                // 设置截图信息
                if (findBytes != null) {
                    GlideApp.with(mFindCapture).load(findBytes).into(mFindCapture);
                    captureFlag = true;
                } else {
                    mFindCapture.setImageDrawable(null);
                }

                if (targetBytes != null) {
                    GlideApp.with(mTargetCapture).load(targetBytes).into(mTargetCapture);
                    captureFlag = true;
                } else {
                    mTargetCapture.setImageDrawable(null);
                }
            } catch (Exception e) {
                LogUtil.e("ReplayStepFrag", "配置控件截图信息失败", e);
            }

            if (node != null) {
                mNodeRow.setVisibility(View.VISIBLE);
            } else {
                mNodeRow.setVisibility(View.GONE);
            }
            // 如果有设置截图信息
            if (captureFlag) {
                mCaptureRow.setVisibility(View.VISIBLE);
            } else {
                mCaptureRow.setVisibility(View.GONE);
            }
        }

        @Override
        public void onClick(View v) {
            OperationNode node = null;
            if (v == mTargetNode) {
                node = logBean.getOperationNode();
            } else if (v == mFindNode) {
                node = replayInfo.getFindNode();
            } else if (v == mTargetCapture) {
                if (targetBytes != null) {
                    DialogUtils.showImageDialog(v.getContext(), targetBytes);
                }
            } else if (v == mFindCapture) {
                if (findBytes != null) {
                    DialogUtils.showImageDialog(v.getContext(), findBytes);
                }
            }

            if (node != null) {
                showContentDialog(node);
            }
        }

        private void showContentDialog(OperationNode node) {
            AlertDialog dialog = new AlertDialog.Builder(mTargetNode.getContext())
                    .setView(wrapView(node))
                    .setTitle(R.string.replay__node_struct)
                    .setPositiveButton(R.string.constant__confirm, new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            dialog.dismiss();
                        }
                    }).create();

            dialog.show();
        }

        /**
         * 包装node界面
         * @param node
         * @return
         */
        private View wrapView(OperationNode node) {
            LayoutInflater inflater = LayoutInflater.from(mTargetNode.getContext());
            View nodeContentView = inflater.inflate(R.layout.item_operation_node, null);

            TextView className = (TextView) nodeContentView.findViewById(R.id.text_node_classname);
            className.setText(node.getClassName());

            TextView id = (TextView) nodeContentView.findViewById(R.id.text_node_id);
            id.setText(node.getResourceId());

            TextView text = (TextView) nodeContentView.findViewById(R.id.text_node_text);
            text.setText(node.getText());

            TextView description = (TextView) nodeContentView.findViewById(R.id.text_node_description);
            description.setText(node.getDescription());

            TextView xpath = (TextView) nodeContentView.findViewById(R.id.text_node_xpath);
            xpath.setText(node.getXpath());

            if (node.getNodeBound() != null) {
                TextView size = (TextView) nodeContentView.findViewById(R.id.text_node_size);
                size.setText(StringUtil.getString(R.string.replay_step_fragment__node_size_format, node.getNodeBound().width(), node.getNodeBound().height()));
            }

            TextView depth = (TextView) nodeContentView.findViewById(R.id.text_node_depth);
            depth.setText(String.valueOf(node.getDepth()));

            ViewGroup.LayoutParams params = new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            nodeContentView.setLayoutParams(params);
            return nodeContentView;
        }
    }


}
