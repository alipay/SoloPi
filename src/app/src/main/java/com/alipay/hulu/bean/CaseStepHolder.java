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

import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Created by qiaoruikai on 2019-04-25 20:29.
 */
public class CaseStepHolder {
    private static Map<Integer, RecordCaseInfo> caseHolder = new HashMap<>();
    private static Map<Integer, ReplayResultBean> replayHolder = new HashMap<>();
    private static List<OperationStep> pasteContentHolder;
    private static final AtomicInteger counter = new AtomicInteger(1);
    private static final AtomicInteger replayCounter = new AtomicInteger(1);

    /**
     * 暂存用例
     * @param caseInfo
     * @return
     */
    public static int storeCase(RecordCaseInfo caseInfo) {
        int id = counter.getAndIncrement();
        caseHolder.put(id, caseInfo);

        return id;
    }

    /**
     * 暂存拷贝步骤
     * @param pasteContent
     */
    public static void storePasteContent(List<OperationStep> pasteContent) {
        pasteContentHolder = new ArrayList<>(pasteContent);
    }

    /**
     * 获取并置空拷贝步骤
     * @return
     */
    public static List<OperationStep> getPasteContent() {
        if (pasteContentHolder == null) {
            return Collections.EMPTY_LIST;
        }

        return new ArrayList<>(pasteContentHolder);
    }

    /**
     * 是否包含拷贝步骤
     * @return
     */
    public static boolean containsPasteContent() {
        return pasteContentHolder != null;
    }

    /**
     * 获取用例
     * @param id
     * @return
     */
    public static RecordCaseInfo getCase(int id) {
        return caseHolder.remove(id);
    }

    /**
     * 暂存结果
     * @param caseInfo
     * @return
     */
    public static int storeResult(ReplayResultBean caseInfo) {
        int id = replayCounter.getAndIncrement();
        replayHolder.put(id, caseInfo);

        return id;
    }

    /**
     * 获取结果
     * @param id
     * @return
     */
    public static ReplayResultBean getResult(int id) {
        return replayHolder.remove(id);
    }
}
