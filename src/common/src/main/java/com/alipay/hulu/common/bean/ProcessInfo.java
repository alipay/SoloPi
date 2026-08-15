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
package com.alipay.hulu.common.bean;

/**
 * Created by qiaoruikai on 2018/10/24 6:33 PM.
 */
public class ProcessInfo {
    private int pid;
    private String processName;

    public ProcessInfo(int pid, String processName) {
        this.pid = pid;
        this.processName = processName;
    }

    public int getPid() {
        return pid;
    }

    public String getProcessName() {
        return processName;
    }

    public void setPid(int pid) {
        this.pid = pid;
    }

    public void setProcessName(String processName) {
        this.processName = processName;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;

        ProcessInfo that = (ProcessInfo) o;

        if (pid != that.pid) return false;
        return processName.equals(that.processName);
    }

    @Override
    public int hashCode() {
        int result = pid;
        result = 31 * result + processName.hashCode();
        return result;
    }

    @Override
    public String toString() {
        final StringBuffer sb = new StringBuffer("ProcessInfo{");
        sb.append("pid=").append(pid);
        sb.append(", processName='").append(processName).append('\'');
        sb.append('}');
        return sb.toString();
    }
}
