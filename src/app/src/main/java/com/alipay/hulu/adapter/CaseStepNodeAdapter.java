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

import android.graphics.Rect;
import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.TextView;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.R;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.tree.OperationNode;
import com.alipay.hulu.shared.node.tree.export.OperationStepExporter;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Created by qiaoruikai on 2019/2/20 8:05 PM.
 */
public class CaseStepNodeAdapter extends RecyclerView.Adapter<CaseStepNodeAdapter.NodePropertyHolder> {
    private static final String TAG = "CaseStepNodeApt";
    private OperationNode node;
    private List<String> properties;

    public CaseStepNodeAdapter(@NonNull OperationNode node) {
        this.node = node;
        properties = loadPropertiesKey(node);
    }

    @Override
    public NodePropertyHolder onCreateViewHolder(ViewGroup parent, int viewType) {
        if (parent == null) {
            return null;
        }

        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_case_step_edit_input, parent, false);

        return new NodePropertyHolder(view, node);
    }

    @Override
    public int getItemViewType(int position) {
        return StringUtil.equals(properties.get(position), OperationStepExporter.CAPTURE_IMAGE_BASE64)? 1: 0;
    }

    @Override
    public void onBindViewHolder(NodePropertyHolder holder, int position) {
        String property = properties.get(position);
        String value = extractNodeProperties(node, property);
        holder.wrapData(property, value);
    }

    @Override
    public int getItemCount() {
        return properties.size();
    }

    public static class NodePropertyHolder extends RecyclerView.ViewHolder implements TextWatcher {
        private String key;

        private TextView title;
        private EditText editText;
        private TextView infoText;
        private OperationNode node;

        public NodePropertyHolder(View itemView, OperationNode node) {
            super(itemView);
            this.node = node;

            title = (TextView) itemView.findViewById(R.id.item_case_step_name);
            editText = (EditText) itemView.findViewById(R.id.item_case_step_edit);
            editText.addTextChangedListener(this);
            infoText = (TextView) itemView.findViewById(R.id.item_case_step_create_param);
            infoText.setText("");
        }

        private void wrapData(String key, String value) {
            this.key = key;

            editText.setText(value);
            title.setText(key);
        }

        @Override
        public void beforeTextChanged(CharSequence s, int start, int count, int after) {

        }

        @Override
        public void onTextChanged(CharSequence s, int start, int before, int count) {

        }

        @Override
        public void afterTextChanged(Editable s) {
            boolean result = updateNodeProperty(key, s.toString(), node);
            if (!result) {
                infoText.setText(R.string.node__invalid_param);
            } else {
                infoText.setText("");
            }
        }
    }

    /**
     * 解析node属性
     * @param node
     * @return
     */
    static String extractNodeProperties(OperationNode node, String key) {
        switch (key) {
            case "xpath":
                return node.getXpath();
            case "description":
                return node.getDescription();
            case "text":
                return node.getText();
            case "resourceId":
                return node.getResourceId();
            case "className":
                return node.getClassName();
            case "depth":
                return Integer.toString(node.getDepth());
            case "nodeType":
                return node.getNodeType();
            case "assistantNodes":
                return JSON.toJSONString(node.getAssistantNodes());
            case "nodeBound":
                Rect nb = node.getNodeBound();
                return String.format("%d,%d,%d,%d", nb.left, nb.top, nb.right, nb.bottom);
            default:
                if (node.getExtra() == null) {
                    return null;
                }
                return node.getExtra().get(key);
        }
    }

    static List<String> loadPropertiesKey(OperationNode node) {
        List<String> list = new ArrayList<>(12);
        list.add("xpath");
        list.add("description");
        list.add("text");
        list.add("resourceId");
        list.add("className");
        list.add("depth");
        Rect nb = node.getNodeBound();
        if (nb != null) {
            list.add("nodeBound");
        }

        if (node.getAssistantNodes() != null && node.getAssistantNodes().size() > 0) {
            list.add("assistantNodes");
        }
        list.add("nodeType");

        if (node.getExtra() != null) {
            Map<String, String> extras = node.getExtra();
            list.addAll(extras.keySet());
        }

        // 截图放最前面
        if (list.contains(OperationStepExporter.CAPTURE_IMAGE_BASE64)) {
            list.remove(OperationStepExporter.CAPTURE_IMAGE_BASE64);
            list.add(0, OperationStepExporter.CAPTURE_IMAGE_BASE64);
        }

        return list;
    }

    /**
     * 设置Node属性值
     * @param key
     * @param value
     * @param node
     * @return
     */
    static boolean updateNodeProperty(String key, String value, OperationNode node) {
        switch (key) {
            case "xpath":
                node.setXpath(value);
                return true;
            case "description":
                node.setDescription(value);
                return true;
            case "text":
                node.setText(value);
                return true;
            case "resourceId":
                node.setResourceId(value);
                return true;
            case "className":
                node.setClassName(value);
                return true;
            case "depth":
                try {
                    int depth = Integer.parseInt(value);
                    node.setDepth(depth);
                    return true;
                } catch (NumberFormatException e) {
                    LogUtil.w(TAG, "无法解析数字:" + value, e);
                    return false;
                }
            case "nodeBound":
                // 逗号分隔
                String[] split = StringUtil.split(value, ",");
                if (split == null || split.length != 4) {
                    return false;
                }
                try {
                    Rect bound = new Rect(Integer.parseInt(split[0]),
                            Integer.parseInt(split[1]),
                            Integer.parseInt(split[2]),
                            Integer.parseInt(split[3]));
                    node.setNodeBound(bound);
                    return true;
                } catch (NumberFormatException e) {
                    LogUtil.w(TAG, "parse content failed for " + value, e);
                    return false;
                }
            case "assistantNodes":
                try {
                    List<OperationNode.AssistantNode> assis = JSON.parseArray(value, OperationNode.AssistantNode.class);
                    node.setAssistantNodes(assis);
                    return true;
                } catch (Exception e) {
                    LogUtil.w(TAG, "can't parse " + value, e);
                    return false;
                }
            case "nodeType":
                node.setNodeType(value);
                return true;
            default:
                if (node.getExtra() != null) {
                    node.getExtra().put(key, value);
                    return true;
                }
                return false;
        }
    }
}
