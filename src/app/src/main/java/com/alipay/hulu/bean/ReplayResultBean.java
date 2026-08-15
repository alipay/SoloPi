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

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.common.bean.DeviceInfo;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;

import java.io.File;
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
     * 目标应用包名
     */
    private String targetAppPkg;

    /**
     * 目标应用版本号
     */
    private String targetAppVersion;

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
     * 故障步骤ID
     */
    private String exceptionStepId;

    private DeviceInfo deviceInfo;

    /**
     * 平台
     */
    private String platform;

    /**
     * 平台版本
     */
    private String platformVersion;

    /**
     * 截图文件
     */
    private Map<String, String> screenshotFiles;

    /**
     * （仅用于本地结果）结果截图列表
     */
    private List<ScreenshotBean> screenshots;

    /**
     * （仅用于本地结果）结果目录
     */
    private File baseDir;

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

    public String getTargetAppPkg() {
        return targetAppPkg;
    }

    public void setTargetAppPkg(String targetAppPkg) {
        this.targetAppPkg = targetAppPkg;
    }

    public String getTargetAppVersion() {
        return targetAppVersion;
    }

    public void setTargetAppVersion(String targetAppVersion) {
        this.targetAppVersion = targetAppVersion;
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

    public List<ScreenshotBean> getScreenshots() {
        return screenshots;
    }

    public void setScreenshots(List<ScreenshotBean> screenshots) {
        this.screenshots = screenshots;
    }

    public File getBaseDir() {
        return baseDir;
    }

    public void setBaseDir(File baseDir) {
        this.baseDir = baseDir;
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

    public String getExceptionStepId() {
        return exceptionStepId;
    }

    public void setExceptionStepId(String exceptionStepId) {
        this.exceptionStepId = exceptionStepId;
    }

    public Map<String, String> getScreenshotFiles() {
        return screenshotFiles;
    }

    public void setScreenshotFiles(Map<String, String> screenshotFiles) {
        this.screenshotFiles = screenshotFiles;
    }

    public DeviceInfo getDeviceInfo() {
        return deviceInfo;
    }

    public void setDeviceInfo(DeviceInfo deviceInfo) {
        this.deviceInfo = deviceInfo;
    }

    public String getPlatform() {
        return platform;
    }

    public void setPlatform(String platform) {
        this.platform = platform;
    }

    public String getPlatformVersion() {
        return platformVersion;
    }

    public void setPlatformVersion(String platformVersion) {
        this.platformVersion = platformVersion;
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
        dest.writeString(this.targetAppPkg);
        dest.writeString(this.targetAppVersion);
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
        dest.writeString(this.exceptionStepId);
        if (this.screenshotFiles == null) {
            dest.writeInt(-1);
        } else {
            dest.writeInt(this.screenshotFiles.size());
            for (Map.Entry<String, String> entry : this.screenshotFiles.entrySet()) {
                dest.writeString(entry.getKey());
                dest.writeString(entry.getValue());
            }
        }
        DeviceInfo deviceInfo = this.deviceInfo;
        if (deviceInfo == null) {
            dest.writeString("");
        } else {
            dest.writeString(JSON.toJSONString(deviceInfo));
        }
        dest.writeString(this.platform);
        dest.writeString(this.platformVersion);
    }

    protected ReplayResultBean(Parcel in) {
        this.caseName = in.readString();
        long tmpStartTime = in.readLong();
        this.startTime = tmpStartTime == -1 ? null : new Date(tmpStartTime);
        long tmpEndTime = in.readLong();
        this.endTime = tmpEndTime == -1 ? null : new Date(tmpEndTime);
        this.logFile = in.readString();
        this.targetApp = in.readString();
        this.targetAppPkg = in.readString();
        this.targetAppVersion = in.readString();
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
        this.exceptionStepId = in.readString();
        int screenshotFilesSize = in.readInt();
        if (screenshotFilesSize > -1) {
            this.screenshotFiles = new HashMap<>(screenshotFilesSize + 1);
            for (int i = 0; i < screenshotFilesSize; i++) {
                String key = in.readString();
                String value = in.readString();
                this.screenshotFiles.put(key, value);
            }
        }
        String deviceInfo = in.readString();
        if (!StringUtil.isEmpty(deviceInfo)) {
            this.deviceInfo = JSON.parseObject(deviceInfo, DeviceInfo.class);
        }
        this.platform = in.readString();
        this.platformVersion = in.readString();
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
