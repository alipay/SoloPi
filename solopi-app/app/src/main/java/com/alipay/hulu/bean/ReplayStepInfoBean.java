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
package com.alipay.hulu.bean;

import android.os.Parcel;
import android.os.Parcelable;

import com.alipay.hulu.shared.node.tree.OperationNode;

import java.util.ArrayList;
import java.util.List;

/**
 * 回放步骤信息
 */
public class ReplayStepInfoBean implements Parcelable {
    List<String> prepareActionList;

    OperationNode findNode;

    public ReplayStepInfoBean() {
        prepareActionList = new ArrayList<>();
    }

    /**
     * 添加一步准备动作
     * @param action
     */
    public void addPrepareAction(String action) {
        prepareActionList.add(action);
    }

    public List<String> getPrepareActionList() {
        return prepareActionList;
    }

    public void setPrepareActionList(List<String> prepareActionList) {
        this.prepareActionList = prepareActionList;
    }

    public OperationNode getFindNode() {
        return findNode;
    }

    public void setFindNode(OperationNode findNode) {
        this.findNode = findNode;
    }

    @Override
    public int describeContents() {
        return 0;
    }

    @Override
    public void writeToParcel(Parcel dest, int flags) {
        dest.writeStringList(this.prepareActionList);
        dest.writeParcelable(this.findNode, flags);
    }

    protected ReplayStepInfoBean(Parcel in) {
        this.prepareActionList = in.createStringArrayList();
        this.findNode = in.readParcelable(OperationNode.class.getClassLoader());
    }

    public static final Creator<ReplayStepInfoBean> CREATOR = new Creator<ReplayStepInfoBean>() {
        @Override
        public ReplayStepInfoBean createFromParcel(Parcel source) {
            return new ReplayStepInfoBean(source);
        }

        @Override
        public ReplayStepInfoBean[] newArray(int size) {
            return new ReplayStepInfoBean[size];
        }
    };
}
