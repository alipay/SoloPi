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

import java.util.ArrayList;
import java.util.List;

/**
 * 元数据树
 * Created by qiaoruikai on 2018/10/8 2:13 PM.
 */
public class MetaTree {
    private Object currentNode;

    private List<MetaTree> children = new ArrayList<>();

    public Object getCurrentNode() {
        return currentNode;
    }

    public void setCurrentNode(Object currentNode) {
        this.currentNode = currentNode;
    }

    public List<MetaTree> getChildren() {
        return children;
    }

    public void setChildren(List<MetaTree> children) {
        this.children = children;
    }

    @Override
    public String toString() {
        return "MetaTree{" +
                "currentNode=" + (currentNode == null? null: currentNode.getClass().getSimpleName()) +
                ", children=" + (children == null? -1: children.size()) +
                '}';
    }
}
