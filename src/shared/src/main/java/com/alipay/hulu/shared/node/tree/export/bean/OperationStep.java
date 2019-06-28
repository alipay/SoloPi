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
package com.alipay.hulu.shared.node.tree.export.bean;

import android.os.Parcel;
import android.os.Parcelable;

import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.tree.OperationNode;

/**
 * 操作步骤
 * Created by cathor on 2017/12/12.
 */
public class OperationStep implements Parcelable {

    /**
     * 操作节点
     */
    private OperationNode operationNode;

    /**
     * 操作方法
     */
    private OperationMethod operationMethod;

    /**
     * 操作顺序
     */
    private int operationIndex;

    /**
     * 操作ID
     */
    private String operationId;


    @Override
    public int describeContents() {
        return operationNode.describeContents() | operationMethod.describeContents();
    }

    @Override
    public void writeToParcel(Parcel dest, int flags) {
        dest.writeParcelable(operationNode, flags);
        dest.writeParcelable(operationMethod, flags);
        dest.writeInt(operationIndex);
        dest.writeString(operationId);
    }

    public static final Creator<OperationStep> CREATOR = new Creator<OperationStep>() {
        @Override
        public OperationStep createFromParcel(Parcel source) {
            return new OperationStep(source);
        }

        @Override
        public OperationStep[] newArray(int size) {
            return new OperationStep[size];
        }
    };

    public OperationStep(){}

    private OperationStep(Parcel in) {
        operationNode = in.readParcelable(OperationNode.class.getClassLoader());
        operationMethod = in.readParcelable(OperationMethod.class.getClassLoader());
        operationIndex = in.readInt();
        operationId = in.readString();
    }

    /**
     * Getter method for property <tt>operationNode</tt>.
     *
     * @return property value of operationNode
     */
    public OperationNode getOperationNode() {
        return operationNode;
    }

    /**
     * Setter method for property <tt>operationNode</tt>.
     *
     * @param operationNode value to be assigned to property operationNode
     */
    public void setOperationNode(OperationNode operationNode) {
        this.operationNode = operationNode;
    }

    /**
     * Getter method for property <tt>operationMethod</tt>.
     *
     * @return property value of operationMethod
     */
    public OperationMethod getOperationMethod() {
        return operationMethod;
    }

    /**
     * Setter method for property <tt>operationMethod</tt>.
     *
     * @param operationMethod value to be assigned to property operationMethod
     */
    public void setOperationMethod(OperationMethod operationMethod) {
        this.operationMethod = operationMethod;
    }

    /**
     * Getter method for property <tt>operationIndex</tt>.
     *
     * @return property value of operationIndex
     */
    public int getOperationIndex() {
        return operationIndex;
    }

    /**
     * Setter method for property <tt>operationIndex</tt>.
     *
     * @param operationIndex value to be assigned to property operationIndex
     */
    public void setOperationIndex(int operationIndex) {
        this.operationIndex = operationIndex;
    }

    /**
     * Getter method for property <tt>operationId</tt>.
     *
     * @return property value of operationId
     */
    public String getOperationId() {
        return operationId;
    }

    /**
     * Setter method for property <tt>operationId</tt>.
     *
     * @param operationId value to be assigned to property operationId
     */
    public void setOperationId(String operationId) {
        this.operationId = operationId;
    }

}
