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
package com.alipay.hulu.shared.node.action;

import android.os.Parcel;
import android.os.Parcelable;

import com.alibaba.fastjson.annotation.JSONField;
import com.alipay.hulu.common.constant.Constant;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.utils.AESUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * 操作方法Bean
 * Created by cathor on 2017/12/12.
 */
public class OperationMethod implements Parcelable {
    private static final String TAG = OperationMethod.class.getSimpleName();

    private boolean encrypt = true;
    /**
     * 操作方法
     */
    private PerformActionEnum actionEnum;

    /**
     * 操作参数
     */
    private Map<String, String> operationParam;

    /**
     * 参数后处理器
     */
    private ParamProcessor suffixProcessor;

    /**
     * 参数前处理器
     */
    private ParamProcessor prefixProcessor;

    /**
     * 存入参数
     * @param key
     * @param value
     */
    public void putParam(String key, String value) {
        if (operationParam == null) {
            operationParam = new HashMap<>();
        }

        // 存储时处理器
        if (prefixProcessor != null) {
            value = prefixProcessor.filterParam(key, value, actionEnum);
        }

        // 传空值，直接存空
        if (value == null) {
            operationParam.put(key, null);
            return;
        }

        // 存储
        if (encrypt) {
            operationParam.put(key, encode(value));
        } else {
            operationParam.put(key, value);
        }
    }

    /**
     * 是否包含参数
     * @param key
     * @return
     */
    public boolean containsParam(String key) {
        if (operationParam == null) {
            return false;
        }
        return operationParam.containsKey(key);
    }

    /**
     * 移除参数
     * @param key
     * @return
     */
    public String removeParam(String key) {
        if (operationParam == null) {
            return null;
        }

        return operationParam.remove(key);
    }

    /**
     * 获取参数Key Set
     * @return
     */
    @JSONField(serialize=false)
    public Set<String> getParamKeys() {
        if (operationParam == null) {
            return new HashSet<>(0);
        }

        return operationParam.keySet();
    }

    /**
     * 获取参数数量
     * @return
     */
    @JSONField(serialize=false)
    public int getParamSize() {
        if (operationParam == null) {
            return 0;
        }

        return operationParam.size();
    }

    /**
     * 获取参数
     * @param key
     */
    public String getParam(String key) {
        if (operationParam == null) {
            return null;
        }

        // 解密
        String result;
        if (encrypt) {
            result = decode(operationParam.get(key));
        } else {
            result = operationParam.get(key);
        }

        // 后处理工作
        if (suffixProcessor != null) {
            result = suffixProcessor.filterParam(key, result, actionEnum);
        }
        return result;
    }
    @Override
    public int describeContents() {
        return CONTENTS_FILE_DESCRIPTOR;
    }

    @Override
    public void writeToParcel(Parcel dest, int flags) {
        dest.writeString(actionEnum.getCode());
        dest.writeMap(operationParam);
        dest.writeInt(encrypt? 1: 0);
    }

    /**
     * 加密
     * @param origin
     * @return
     */
    private String encode(String origin) {
        if (origin == null) {
            return null;
        }

        try {
            return AESUtils.encrypt(origin);
        } catch (Exception e) {
            LogUtil.e(TAG, "Catch java.lang.Exception: " + e.getMessage(), e);
        }

        return origin;
    }

    /**
     * 解密
     * @param encode
     * @return
     */
    private String decode(String encode) {
        if (encode == null) {
            return null;
        }

        try {
            return AESUtils.decrypt(encode);
        } catch (Exception e) {
            LogUtil.e(TAG, "Catch java.lang.Exception: " + e.getMessage(), e);
        }
        return encode;
    }

    /**
     * 设置参数存储处理器
     * @param processor
     */
    public void setPrefixProcessor(ParamProcessor processor) {
        this.prefixProcessor = processor;
    }

    /**
     * 设置参数获取处理器
     * @param processor
     */
    public void setSuffixProcessor(ParamProcessor processor) {
        this.suffixProcessor = processor;
    }

    /**
     * Parcel Creator
     */
    public static final Creator<OperationMethod> CREATOR = new Creator<OperationMethod>() {
        @Override
        public OperationMethod createFromParcel(Parcel source) {
            return new OperationMethod(source);
        }

        @Override
        public OperationMethod[] newArray(int size) {
            return new OperationMethod[size];
        }
    };

    public OperationMethod() {}

    public OperationMethod(PerformActionEnum actionEnum) {
        this.actionEnum = actionEnum;
    }

    private OperationMethod(Parcel in) {
        actionEnum = PerformActionEnum.getActionEnumByCode(in.readString());
        operationParam = in.readHashMap(ClassLoader.getSystemClassLoader());
        encrypt = in.readInt() == 1;
    }

    public boolean isEncrypt() {
        return encrypt;
    }

    public void setEncrypt(boolean encrypt) {
        this.encrypt = encrypt;
    }

    /**
     * Getter method for property <tt>actionEnum</tt>.
     *
     * @return property value of actionEnum
     */
    public PerformActionEnum getActionEnum() {
        return actionEnum;
    }

    /**
     * Setter method for property <tt>actionEnum</tt>.
     *
     * @param actionEnum value to be assigned to property actionEnum
     */
    public void setActionEnum(PerformActionEnum actionEnum) {
        this.actionEnum = actionEnum;
    }

    /**
     * Getter method for property <tt>operationParam</tt>.
     *
     * @return property value of operationParam
     */
    public Map<String, String> getOperationParam() {
        if (operationParam == null) {
            operationParam = new HashMap<>();
        }

        return operationParam;
    }

    /**
     * Setter method for property <tt>operationParam</tt>.
     *
     * @param operationParam value to be assigned to property operationParam
     */
    public void setOperationParam(Map<String, String> operationParam) {
        if (this.operationParam != null && !this.operationParam.isEmpty()) {
            this.operationParam.putAll(operationParam);
        } else {
            this.operationParam = operationParam;
        }
    }

    @Override
    public String toString() {
        final StringBuffer sb = new StringBuffer("OperationMethod{");
        sb.append("actionEnum=").append(actionEnum);
        sb.append(", operationParam=[");
        if (operationParam != null) {
            if (SPService.getBoolean(SPService.KEY_HIDE_LOG, true)) {
                for (String key : operationParam.keySet()) {
                    sb.append(key).append("=").append(StringUtil.hash(key));
                }
            } else {
                for (String key : operationParam.keySet()) {
                    sb.append(key).append("=").append(operationParam.get(key));
                }
            }
        }
        sb.append("]}");
        return sb.toString();
    }

    /**
     * 参数后处理器，便于后续替换字段
     */
    public interface ParamProcessor {
        String filterParam(String key, String value, PerformActionEnum action);
    }
}
