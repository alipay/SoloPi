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
package com.alipay.hulu.event;

/**
 * Created by lezhou.wyl on 2018/8/2.
 */

public class RecordCaseChangedEvent {

    public static final int TYPE_LOCAL_DELETE = 1;
    public static final int TYPE_SERVER_DELETE = 2;
    public static final int TYPE_CASE_ADD = 3;

    private int type;
    private long caseId;

    public int getType() {
        return type;
    }

    public void setType(int type) {
        this.type = type;
    }

    public long getCaseId() {
        return caseId;
    }

    public void setCaseId(long caseId) {
        this.caseId = caseId;
    }


    public RecordCaseChangedEvent(int type, long caseId) {
        this.type = type;
        this.caseId = caseId;
    }
}
