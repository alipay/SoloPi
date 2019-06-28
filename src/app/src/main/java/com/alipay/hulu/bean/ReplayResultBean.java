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

import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;

import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 回放日志Bean
 */
public class ReplayResultBean implements Parcelable {
    private static final String TAG = "ReplayResultBean";

    /**
     * 用例名称
     */
    private String caseName;

    /**
     * 目标应用
     */
    private String targetApp;

    /**
     * 开始时间
     */
    private Date startTime;

    /**
     * 结束时间
     */
    private Date endTime;

    /**
     * 日志文件地址
     */
    private String logFile;

    /**
     * 操作记录
     */
    private Map<Integer, ReplayStepInfoBean> actionLogs;

    /**
     * 步骤信息
     */
    private List<OperationStep> currentOperationLog;

    /**
     * 故障信息
     */
    private String exceptionMessage;

    /**
     * 故障步骤
     */
    private int exceptionStep;

    /**
     * 截图文件
     */
    private Map<String, String> screenshotFiles;

    public String getCaseName() {
        return caseName;
    }

    public void setCaseName(String caseName) {
        this.caseName = caseName;
    }

    public String getTargetApp() {
        return targetApp;
    }

    public void setTargetApp(String targetApp) {
        this.targetApp = targetApp;
    }

    public Date getStartTime() {
        return startTime;
    }

    public void setStartTime(Date startTime) {
        this.startTime = startTime;
    }

    public Date getEndTime() {
        return endTime;
    }

    public void setEndTime(Date endTime) {
        this.endTime = endTime;
    }

    public String getLogFile() {
        return logFile;
    }

    public void setLogFile(String logFile) {
        this.logFile = logFile;
    }

    public Map<Integer, ReplayStepInfoBean> getActionLogs() {
        return actionLogs;
    }

    public void setActionLogs(Map<Integer, ReplayStepInfoBean> actionLogs) {
        this.actionLogs = actionLogs;
    }

    public List<OperationStep> getCurrentOperationLog() {
        return currentOperationLog;
    }

    public void setCurrentOperationLog(List<OperationStep> currentOperationLog) {
        this.currentOperationLog = currentOperationLog;
    }

    public String getExceptionMessage() {
        return exceptionMessage;
    }

    public void setExceptionMessage(String exceptionMessage) {
        this.exceptionMessage = exceptionMessage;
    }

    public int getExceptionStep() {
        return exceptionStep;
    }

    public void setExceptionStep(int exceptionStep) {
        this.exceptionStep = exceptionStep;
    }

    public Map<String, String> getScreenshotFiles() {
        return screenshotFiles;
    }

    public void setScreenshotFiles(Map<String, String> screenshotFiles) {
        this.screenshotFiles = screenshotFiles;
    }

    public ReplayResultBean() {}

    @Override
    public int describeContents() {
        return 0;
    }

    @Override
    public void writeToParcel(Parcel dest, int flags) {
        dest.writeString(this.caseName);
        dest.writeLong(this.startTime != null ? this.startTime.getTime() : -1);
        dest.writeLong(this.endTime != null ? this.endTime.getTime() : -1);
        dest.writeString(this.logFile);
        dest.writeString(this.targetApp);
        if (this.actionLogs == null) {
            dest.writeInt(-1);
        } else {
            dest.writeInt(this.actionLogs.size());
            for (Map.Entry<Integer, ReplayStepInfoBean> entry : this.actionLogs.entrySet()) {
                dest.writeInt(entry.getKey());
                dest.writeParcelable(entry.getValue(), flags);
            }
        }
        dest.writeList(this.currentOperationLog);
        dest.writeString(this.exceptionMessage);
        dest.writeInt(this.exceptionStep);
        if (this.screenshotFiles == null) {
            dest.writeInt(-1);
        } else {
            dest.writeInt(this.screenshotFiles.size());
            for (Map.Entry<String, String> entry : this.screenshotFiles.entrySet()) {
                dest.writeString(entry.getKey());
                dest.writeString(entry.getValue());
            }
        }
    }

    protected ReplayResultBean(Parcel in) {
        this.caseName = in.readString();
        long tmpStartTime = in.readLong();
        this.startTime = tmpStartTime == -1 ? null : new Date(tmpStartTime);
        long tmpEndTime = in.readLong();
        this.endTime = tmpEndTime == -1 ? null : new Date(tmpEndTime);
        this.logFile = in.readString();
        this.targetApp = in.readString();
        int actionLogsSize = in.readInt();
        if (actionLogsSize > -1) {
            this.actionLogs = new HashMap<>(actionLogsSize);
            for (int i = 0; i < actionLogsSize; i++) {
                int key = in.readInt();
                ReplayStepInfoBean value = in.readParcelable(ReplayStepInfoBean.class.getClassLoader());
                this.actionLogs.put(key, value);
            }
        }
        this.currentOperationLog = in.readArrayList(OperationStep.class.getClassLoader());
        this.exceptionMessage = in.readString();
        this.exceptionStep = in.readInt();
        int screenshotFilesSize = in.readInt();
        if (screenshotFilesSize > -1) {
            this.screenshotFiles = new HashMap<>(screenshotFilesSize + 1);
            for (int i = 0; i < screenshotFilesSize; i++) {
                String key = in.readString();
                String value = in.readString();
                this.screenshotFiles.put(key, value);
            }
        }
    }

    public static final Creator<ReplayResultBean> CREATOR = new Creator<ReplayResultBean>() {
        @Override
        public ReplayResultBean createFromParcel(Parcel source) {
            return new ReplayResultBean(source);
        }

        @Override
        public ReplayResultBean[] newArray(int size) {
            return new ReplayResultBean[size];
        }
    };
}
