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
package com.alipay.hulu.shared.io.util;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.io.bean.GeneralOperationLogBean;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;

import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.util.List;
import java.util.UUID;

public class OperationStepUtil {
    private static final String TAG = "OperationStepUtil";
    public static void beforeStore(GeneralOperationLogBean logBean) {
        LogUtil.i(TAG, "BeforeStoreCaseToDB");
        saveCases(logBean);
    }

    /**
     * load steps from file
     *
     * @param logBean
     */
    public static void afterLoad(GeneralOperationLogBean logBean) {
        LogUtil.i(TAG, "AfterLoadCaseFromDB");
        loadCases(logBean);
    }



    /**
     * load steps
     * @param logBean
     */
    private static void loadCases(GeneralOperationLogBean logBean) {
        if (logBean == null) {
            return;
        }

        // if stored in path
        String path = logBean.getStorePath();
        if (!StringUtil.isEmpty(path)) {
            LogUtil.i(TAG, "Should load case from " + path);
            File f = new File(path);
            if (f.exists()) {
                try {
                    FileReader reader = new FileReader(f);
                    StringBuilder sb = new StringBuilder();
                    char[] content = new char[8192];
                    int count;
                    while ((count = reader.read(content)) > 0) {
                        sb.append(content, 0, count);
                    }
                    List<OperationStep> steps = JSON.parseArray(sb.toString(), OperationStep.class);
                    logBean.setSteps(steps);
                } catch (IOException e) {
                    LogUtil.e(TAG, "Throw IOException: " + e.getMessage(), e);
                }
            }
        }
    }

    /**
     * save steps to file, store file path
     * @param logBean
     */
    private static void saveCases(GeneralOperationLogBean logBean) {
        if (logBean == null) {
            return;
        }

        File targetFile = null;

        if (StringUtil.isEmpty(logBean.getStorePath())) {
            File root = LauncherApplication.getContext().getExternalFilesDir("steps");
            if (root == null) {
                return;
            }

            // delete file
            if (root.exists() && root.isFile()) {
                FileUtils.deleteFile(root);
            }
            if (!root.exists()) {
                root.mkdirs();
            }

            // create directory failed
            if (!root.exists() || root.isFile()) {
                return;
            }

            // generateRandomFile
            while (targetFile == null) {
                String tmpName = UUID.randomUUID().toString();
                if (tmpName.length() > 16) {
                    tmpName = tmpName.substring(0, 16);
                }
                targetFile = new File(root, tmpName);
                if (targetFile.exists()) {
                    targetFile = null;
                }
            }
        } else {
            targetFile = new File(logBean.getStorePath());
        }

        LogUtil.i(TAG, "Store steps to file: " + targetFile);

        // store steps to file
        try {
            JSON.writeJSONStringTo(logBean.getSteps(), new FileWriter(targetFile));
            logBean.setStorePath(targetFile.getPath());
            logBean.setSteps(null);
        } catch (IOException e) {
            LogUtil.e(TAG, "Throw IOException: " + e.getMessage(), e);
        }
    }
}
