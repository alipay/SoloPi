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
package com.alipay.hulu.shared.io.bean;

import android.os.Parcel;
import android.os.Parcelable;

import com.alibaba.fastjson.annotation.JSONField;

import org.greenrobot.greendao.annotation.Entity;
import org.greenrobot.greendao.annotation.Generated;
import org.greenrobot.greendao.annotation.Id;
import org.greenrobot.greendao.annotation.Transient;

/**
 * Created by lezhou.wyl on 2018/1/30.
 */

@Entity
public class RecordCaseInfo implements Parcelable {

    public static final int DEFAULT_PRIORITY = 2;
    public static final int LOWEST_PRIORITY = 2;
    public static final int HIGHEST_PRIORITY = 0;

    @Id(autoincrement = true)
    @JSONField(serialize = false)
    private Long id;
    private String caseName;
    private String caseDesc;
    private String targetAppPackage;
    private String targetAppLabel;
    private String recordMode;
    private String advanceSettings;
    private String operationLog;
    private int priority=DEFAULT_PRIORITY;
    private long gmtCreate;
    private long gmtModify;
    @Transient
    private boolean selected = false;

    public boolean isSelected() {
        return selected;
    }

    public void setSelected(boolean selected) {
        this.selected = selected;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getCaseName() {
        return caseName;
    }

    public void setCaseName(String caseName) {
        this.caseName = caseName;
    }

    public String getCaseDesc() {
        return caseDesc;
    }

    public void setCaseDesc(String caseDesc) {
        this.caseDesc = caseDesc;
    }

    public String getTargetAppPackage() {
        return targetAppPackage;
    }

    public void setTargetAppPackage(String targetAppPackage) {
        this.targetAppPackage = targetAppPackage;
    }

    public String getTargetAppLabel() {
        return targetAppLabel;
    }

    public void setTargetAppLabel(String targetAppLabel) {
        this.targetAppLabel = targetAppLabel;
    }

    public String getRecordMode() {
        return recordMode;
    }

    public void setRecordMode(String recordMode) {
        this.recordMode = recordMode;
    }

    public String getAdvanceSettings() {
        return advanceSettings;
    }

    public void setAdvanceSettings(String advanceSettings) {
        this.advanceSettings = advanceSettings;
    }

    public String getOperationLog() {
        return operationLog;
    }

    public void setOperationLog(String operationLog) {
        this.operationLog = operationLog;
    }

    public boolean isIdeRecord() {
        return "ide_record".equals(recordMode);
    }

    public long getGmtCreate() {
        return gmtCreate;
    }

    public void setGmtCreate(long gmtCreate) {
        this.gmtCreate = gmtCreate;
    }

    public long getGmtModify() {
        return gmtModify;
    }

    public void setGmtModify(long gmtModify) {
        this.gmtModify = gmtModify;
    }

    public RecordCaseInfo clone() {
        return new RecordCaseInfo(id, caseName, caseDesc, targetAppPackage,
                targetAppLabel, recordMode, advanceSettings, operationLog, priority,
                gmtCreate, gmtModify);
    }

    public RecordCaseInfo() {

    }


    @Override
    public int describeContents() {
        return 0;
    }

    @Override
    public void writeToParcel(Parcel dest, int flags) {
        dest.writeValue(this.id);
        dest.writeString(this.caseName);
        dest.writeString(this.caseDesc);
        dest.writeString(this.targetAppPackage);
        dest.writeString(this.targetAppLabel);
        dest.writeString(this.recordMode);
        dest.writeString(this.advanceSettings);
        dest.writeString(this.operationLog);
        dest.writeInt(this.priority);
        dest.writeLong(this.gmtCreate);
        dest.writeLong(this.gmtModify);
    }

    public boolean getSelected() {
        return this.selected;
    }

    public int getPriority() {
        return this.priority;
    }

    public void setPriority(int priority) {
        this.priority = priority;
    }

    protected RecordCaseInfo(Parcel in) {
        this.id = (Long) in.readValue(Long.class.getClassLoader());
        this.caseName = in.readString();
        this.caseDesc = in.readString();
        this.targetAppPackage = in.readString();
        this.targetAppLabel = in.readString();
        this.recordMode = in.readString();
        this.advanceSettings = in.readString();
        this.operationLog = in.readString();
        this.priority = in.readInt();
        this.gmtCreate = in.readLong();
        this.gmtModify = in.readLong();
    }

    @Generated(hash = 1201720745)
    public RecordCaseInfo(Long id, String caseName, String caseDesc, String targetAppPackage,
            String targetAppLabel, String recordMode, String advanceSettings,
            String operationLog, int priority, long gmtCreate, long gmtModify) {
        this.id = id;
        this.caseName = caseName;
        this.caseDesc = caseDesc;
        this.targetAppPackage = targetAppPackage;
        this.targetAppLabel = targetAppLabel;
        this.recordMode = recordMode;
        this.advanceSettings = advanceSettings;
        this.operationLog = operationLog;
        this.priority = priority;
        this.gmtCreate = gmtCreate;
        this.gmtModify = gmtModify;
    }

    public static final Creator<RecordCaseInfo> CREATOR = new Creator<RecordCaseInfo>() {
        @Override
        public RecordCaseInfo createFromParcel(Parcel source) {
            return new RecordCaseInfo(source);
        }

        @Override
        public RecordCaseInfo[] newArray(int size) {
            return new RecordCaseInfo[size];
        }
    };


}
