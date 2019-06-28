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
package com.alipay.hulu.shared.node.tree;

import android.graphics.Rect;
import android.os.Parcel;
import android.os.Parcelable;

import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.utils.StringUtil;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.PriorityQueue;

/**
 * 操作节点信息
 * Created by cathor on 2017/12/12.
 */
public class OperationNode implements Parcelable {
    /**
     * 操作节点xpath
     */
    private String xpath;

    /**
     * 操作节点描述
     */
    private String description;

    /**
     * 文本
     */
    private String text;

    /**
     * 节点ResourceID
     */
    private String resourceId;

    /**
     * 节点ID
     */
    private String id;

    /**
     * 节点类型
     */
    private String className;

    /**
     * 节点包名
     */
    private String packageName;

    /**
     * 节点深度
     */
    private int depth;

    /**
     * 节点边界
     */
    private Rect nodeBound;

    /**
     * 协助定位子节点
     */
    private List<AssistantNode> assistantNodes = new ArrayList<>();

    /**
     * 透传字段
     */
    private Map<String, String> extra = new HashMap<>();

    /**
     * 节点类型
     */
    private String nodeType;

    /**
     * 根据属性排序子节点
     * @param assistantNodes
     * @return
     */
    public static AssistantNode[] sortAssistantNodes(List<AssistantNode> assistantNodes) {
        if (assistantNodes == null || assistantNodes.size() == 0) {
            return new AssistantNode[0];
        }

        PriorityQueue<AssistantNode> sorted = new PriorityQueue<>(assistantNodes.size(), new Comparator<AssistantNode>() {
            @Override
            public int compare(AssistantNode lhs, AssistantNode rhs) {
                int lhsP = lhs.calculatePriority();
                int rhsP = rhs.calculatePriority();
                return rhsP- lhsP;
            }
        });
        sorted.addAll(assistantNodes);
        return sorted.toArray(new AssistantNode[assistantNodes.size()]);
    }

    @Override
    public int describeContents() {
        return CONTENTS_FILE_DESCRIPTOR;
    }

    @Override
    public void writeToParcel(Parcel dest, int flags) {
        dest.writeString(className);
        dest.writeString(packageName);
        dest.writeString(text);
        dest.writeString(resourceId);
        dest.writeString(description);
        dest.writeString(xpath);
        dest.writeString(id);
        dest.writeInt(depth);
        dest.writeParcelable(nodeBound, flags);
        dest.writeList(assistantNodes);
        dest.writeMap(extra);
        dest.writeString(nodeType);
    }

    public static final Creator<OperationNode> CREATOR = new Creator<OperationNode>() {
        @Override
        public OperationNode createFromParcel(Parcel source) {
            return new OperationNode(source);
        }

        @Override
        public OperationNode[] newArray(int size) {
            return new OperationNode[size];
        }
    };

    public OperationNode() {}

    /**
     * Parcel生成
     * @param in
     */
    private OperationNode(Parcel in) {
        className = in.readString();
        packageName = in.readString();
        text = in.readString();
        resourceId = in.readString();
        description = in.readString();
        xpath = in.readString();
        id = in.readString();
        depth = in.readInt();
        nodeBound = in.readParcelable(Rect.class.getClassLoader());
        assistantNodes = in.readArrayList(AssistantNode.class.getClassLoader());
        extra = in.readHashMap(String.class.getClassLoader());
        nodeType = in.readString();
    }

    /**
     * Getter method for property <tt>xpath</tt>.
     *
     * @return property value of xpath
     */
    public String getXpath() {
        return xpath;
    }

    /**
     * Setter method for property <tt>xpath</tt>.
     *
     * @param xpath value to be assigned to property xpath
     */
    public void setXpath(String xpath) {
        this.xpath = xpath;
    }

    /**
     * Getter method for property <tt>description</tt>.
     *
     * @return property value of description
     */
    public String getDescription() {
        return description;
    }

    /**
     * Setter method for property <tt>description</tt>.
     *
     * @param description value to be assigned to property description
     */
    public void setDescription(String description) {
        this.description = description;
    }

    /**
     * Getter method for property <tt>text</tt>.
     *
     * @return property value of text
     */
    public String getText() {
        return text;
    }

    /**
     * Setter method for property <tt>text</tt>.
     *
     * @param text value to be assigned to property text
     */
    public void setText(String text) {
        this.text = text;
    }

    /**
     * Getter method for property <tt>resourceId</tt>.
     *
     * @return property value of resourceId
     */
    public String getResourceId() {
        return resourceId;
    }

    /**
     * Setter method for property <tt>resourceId</tt>.
     *
     * @param resourceId value to be assigned to property resourceId
     */
    public void setResourceId(String resourceId) {
        this.resourceId = resourceId;
    }

    /**
     * Getter method for property <tt>id</tt>.
     *
     * @return property value of id
     */
    public String getId() {
        return id;
    }

    /**
     * Setter method for property <tt>id</tt>.
     *
     * @param id value to be assigned to property id
     */
    public void setId(String id) {
        this.id = id;
    }

    public int getDepth() {
        return depth;
    }

    public void setDepth(int depth) {
        this.depth = depth;
    }

    public Rect getNodeBound() {
        return nodeBound;
    }

    public void setNodeBound(Rect nodeBound) {
        this.nodeBound = nodeBound;
    }

    /**
     * Getter method for property <tt>className</tt>.
     *
     * @return property value of className
     */
    public String getClassName() {
        return className;
    }

    /**
     * Setter method for property <tt>className</tt>.
     *
     * @param className value to be assigned to property className
     */
    public void setClassName(String className) {
        this.className = className;
    }

    /**
     * Getter method for property <tt>packageName</tt>.
     *
     * @return property value of packageName
     */
    public String getPackageName() {
        return packageName;
    }

    /**
     * Setter method for property <tt>packageName</tt>.
     *
     * @param packageName value to be assigned to property packageName
     */
    public void setPackageName(String packageName) {
        this.packageName = packageName;
    }


    /**
     * Getter method for property <tt>assistantNodes</tt>.
     *
     * @return property value of assistantNodes
     */
    public List<AssistantNode> getAssistantNodes() {
        return assistantNodes;
    }

    /**
     * Setter method for property <tt>assistantNodes</tt>.
     *
     * @param assistantNodes value to be assigned to property assistantNodes
     */
    public void setAssistantNodes(List<AssistantNode> assistantNodes) {
        this.assistantNodes = assistantNodes;
    }

    public Map<String, String> getExtra() {
        return extra;
    }

    public void setExtra(Map<String, String> extra) {
        this.extra = extra;
    }

    /**
     * 判断是否包含字段
     * @param key
     * @return
     */
    public boolean containsExtra(String key) {
        if (extra == null) {
            return false;
        }
        return extra.containsKey(key);
    }

    /**
     * 获取Extra值
     * @param key
     * @return
     */
    public String getExtraValue(String key) {
        if (extra == null) {
            return null;
        }
        return extra.get(key);
    }

    public String getNodeType() {
        return nodeType;
    }

    public void setNodeType(String nodeType) {
        this.nodeType = nodeType;
    }

    @Override
    public String toString() {
        return "OperationNode{" +
                "xpath='" + StringUtil.hide(xpath) + '\'' +
                ", description='" + StringUtil.hide(description) + '\'' +
                ", text='" + StringUtil.hide(text) + '\'' +
                ", resourceId='" + StringUtil.hide(resourceId) + '\'' +
                ", id='" + id + '\'' +
                ", className='" + className + '\'' +
                ", packageName='" + StringUtil.hide(packageName) + '\'' +
                ", depth=" + depth +
                ", nodeBound=" + (nodeBound == null? null: nodeBound.toShortString()) +
                ", assistantNodes=" + assistantNodes +
                ", extra=" + StringUtil.hide(extra) +
                ", nodeType='" + nodeType + '\'' +
                '}';
    }

    /**
     * 协助定位子节点
     */
    public static class AssistantNode implements Parcelable {
        /**
         * 子节点类名
         */
        private String className = null;

        /**
         * 子节点resourceId
         */
        private String resourceId = null;

        /**
         * 子节点text
         */
        private String text = null;

        /**
         * 子节点description
         */
        private String description = null;

        /**
         * 子节点在父节点层级
         */
        private int parentHeight = 0;

        /**
         * JSON用
         */
        public AssistantNode() {}

        public AssistantNode(String className, String resourceId, String text, String description, int parentHeight) {
            this.className = className;
            this.resourceId = resourceId;
            this.text = text;
            this.parentHeight = parentHeight;
            this.description = description;
        }

        /**
         * 计算节点优先级
         * @return
         */
        private int calculatePriority() {
            int text = StringUtil.isEmpty(getText())? 0: 2;
            int resourceId = StringUtil.isEmpty(getResourceId()) ? 0 : 1;
            int description = StringUtil.isEmpty(getDescription())? 0: 2;
            return text + resourceId + description;
        }



        @Override
        public String toString() {
            return "AssistantNode{className='" + className + '\'' +
                    ", resourceId='" + StringUtil.hide(resourceId) + '\'' +
                    ", text='" + StringUtil.hide(text) + '\'' +
                    ", description='" + StringUtil.hide(description) + '\'' +
                    ", parentHeight=" + parentHeight +
                    '}';
        }

        /**
         * Getter method for property <tt>className</tt>.
         *
         * @return property value of className
         */
        public String getClassName() {
            return className;
        }

        /**
         * Setter method for property <tt>className</tt>.
         *
         * @param className value to be assigned to property className
         */
        public void setClassName(String className) {
            this.className = className;
        }

        /**
         * Getter method for property <tt>resourceId</tt>.
         *
         * @return property value of resourceId
         */
        public String getResourceId() {
            return resourceId;
        }

        /**
         * Setter method for property <tt>resourceId</tt>.
         *
         * @param resourceId value to be assigned to property resourceId
         */
        public void setResourceId(String resourceId) {
            this.resourceId = resourceId;
        }

        /**
         * Getter method for property <tt>text</tt>.
         *
         * @return property value of text
         */
        public String getText() {
            return text;
        }

        /**
         * Setter method for property <tt>text</tt>.
         *
         * @param text value to be assigned to property text
         */
        public void setText(String text) {
            this.text = text;
        }

        /**
         * Getter method for property <tt>parentHeight</tt>.
         *
         * @return property value of parentHeight
         */
        public int getParentHeight() {
            return parentHeight;
        }

        /**
         * Setter method for property <tt>parentHeight</tt>.
         *
         * @param parentHeight value to be assigned to property parentHeight
         */
        public void setParentHeight(int parentHeight) {
            this.parentHeight = parentHeight;
        }

        /**
         * Getter method for property <tt>description</tt>.
         *
         * @return property value of description
         */
        public String getDescription() {
            return description;
        }

        /**
         * Setter method for property <tt>description</tt>.
         *
         * @param description value to be assigned to property description
         */
        public void setDescription(String description) {
            this.description = description;
        }

        @Override
        public int describeContents() {
            return 0;
        }

        @Override
        public void writeToParcel(Parcel dest, int flags) {
            dest.writeString(this.className);
            dest.writeString(this.resourceId);
            dest.writeString(this.text);
            dest.writeString(this.description);
            dest.writeInt(this.parentHeight);
        }

        protected AssistantNode(Parcel in) {
            this.className = in.readString();
            this.resourceId = in.readString();
            this.text = in.readString();
            this.description = in.readString();
            this.parentHeight = in.readInt();
        }

        public static final Creator<AssistantNode> CREATOR = new Creator<AssistantNode>() {
            @Override
            public AssistantNode createFromParcel(Parcel source) {
                return new AssistantNode(source);
            }

            @Override
            public AssistantNode[] newArray(int size) {
                return new AssistantNode[size];
            }
        };
    }
}
