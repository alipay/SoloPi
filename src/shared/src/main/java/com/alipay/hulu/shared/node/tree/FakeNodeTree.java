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

import com.alibaba.fastjson.JSONObject;
import com.alipay.hulu.shared.node.action.PerformActionEnum;

import java.util.ArrayList;
import java.util.List;

/**
 * Created by qiaoruikai on 2018/11/5 12:23 PM.
 */
public class FakeNodeTree extends AbstractNodeTree {
    @Override
    public boolean canDoAction(PerformActionEnum action) {
        return false;
    }

    @Override
    public StringBuilder printTrace(StringBuilder builder) {
        if (childrenNodes != null) {
            for (AbstractNodeTree child : getChildrenNodes()) {
                child.printTrace(builder);
            }
        }
        return builder;
    }

    @Override
    public JSONObject exportToJsonObject() {
        JSONObject obj = new JSONObject(4);
        obj.put("type", getClass().getSimpleName());
        if (childrenNodes != null) {
            List<JSONObject> children = new ArrayList<>(childrenNodes.size() + 1);
            for (AbstractNodeTree child : getChildrenNodes()) {
                JSONObject childObj = child.exportToJsonObject();
                if (childObj != null) {
                    children.add(childObj);
                }
            }
            obj.put("children", children);
        }
        return obj;
    }

    @Override
    public boolean isSelfUsableForLocating() {
        return false;
    }

    @Override
    public int getDepth() {
        return 0;
    }

    @Override
    public int getIndex() {
        return 0;
    }
}
