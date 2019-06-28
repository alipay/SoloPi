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
package com.alipay.hulu.replay;

import android.text.TextUtils;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.bean.AdvanceCaseSetting;
import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.bean.ReplayStepInfoBean;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.tools.CmdTools;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.io.bean.GeneralOperationLogBean;
import com.alipay.hulu.shared.io.bean.RecordCaseInfo;
import com.alipay.hulu.shared.node.OperationService;
import com.alipay.hulu.shared.node.action.OperationExecutor;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.OperationNode;
import com.alipay.hulu.shared.node.tree.export.bean.OperationStep;
import com.alipay.hulu.shared.node.utils.LogicUtil;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Stack;
import java.util.Vector;
import static com.alipay.hulu.shared.node.utils.LogicUtil.CHECK_PARAM;
import static com.alipay.hulu.shared.node.utils.LogicUtil.SCOPE;

/**
 * Created by qiaoruikai on 2018/10/16 1:43 AM.
 */
public class OperationStepProvider extends AbstractStepProvider {
    private static final String TAG = "OpStepProvider";
    protected OperationService operationService;

    private List<OperationStep> stepList = new ArrayList<>();
    protected Map<Integer, ReplayStepInfoBean> currentStepInfo;

    protected Map<String, String> screenshotFiles;

    protected String targetApp;

    protected RecordCaseInfo caseInfo;

    /**
     * IF位置
     */
    protected int ifIdx = -1;


    /**
     * Loop信息栈
     */
    protected Stack<LoopParam> loopParams = new PeekableStack<>();

    /**
     * 等待check
     */
    protected boolean waitForCheck;

    /**
     * check结果
     */
    protected int checkIdx = -1;

    private String errorReason;

    protected int currentIdx;

    public OperationStepProvider(RecordCaseInfo caseInfo) {
        this.caseInfo = caseInfo;
        loadOperation(caseInfo.getOperationLog());
        currentStepInfo = new HashMap<>();
        screenshotFiles = new LinkedHashMap<>();
        currentIdx = 0;

        // 加载OperationService
        operationService = LauncherApplication.getInstance().findServiceByName(OperationService.class.getName());
    }

    @Override
    public void prepare() {
        super.prepare();
        CmdTools.startAppLog();
        operationService.initParams();
        MyApplication.getInstance().updateAppAndNameTemp(caseInfo.getTargetAppPackage(), caseInfo.getTargetAppLabel());
        targetApp = caseInfo.getTargetAppLabel();
    }

    public void loadOperation(String content) {
        if (StringUtil.isEmpty(content)) {
            return;
        }
        GeneralOperationLogBean generalOperation = JSON.parseObject(content, GeneralOperationLogBean.class);
        if (generalOperation.getSteps() != null) {
            stepList.addAll(generalOperation.getSteps());
        }

        addSetupStepsIfNeeded();
    }

    protected void addSetupStepsIfNeeded() {
        if (!TextUtils.isEmpty(caseInfo.getAdvanceSettings()) && stepList != null && stepList.size() > 0) {
            AdvanceCaseSetting setting = JSON.parseObject(caseInfo.getAdvanceSettings(), AdvanceCaseSetting.class);
            if (setting != null) {
                if (!StringUtil.isEmpty(setting.getDescriptorMode())) {
                    OperationMethod method = new OperationMethod(PerformActionEnum.CHANGE_MODE);
                    method.putParam(OperationExecutor.GET_NODE_MODE, setting.getDescriptorMode().trim());
                    OperationStep changeModeBean = createOperationStep(null, method
                            , stepList.get(0).getOperationId());
                    stepList.add(0, changeModeBean);
                }
            }
        }
    }

    @Override
    public OperationStep provideStep() {
        /**
         * loop循环
         */
        LoopParam param;

        while ((param = loopParams.peek()) != null) {
            // 执行完当前循环范围
            if (currentIdx == param.loopEnd + 1) {
                if (param.loopCount >= 0) {
                    param.loopCount -= 1;
                    currentIdx = param.loopPos;

                    // 移除无用循环参数
                    if (param.loopCount == -1) {
                        loopParams.pop();
                    }
                    break;
                } else {
                    // 移除当前loop信息
                    loopParams.pop();
                }
            } else {
                break;
            }
        }

        // 如果循环超过列表长度
        if (currentIdx >= stepList.size()) {
            return null;
        }

        OperationStep step = stepList.get(currentIdx++);
        OperationMethod method = step.getOperationMethod();

        // screen shot改下名
        if (method.getActionEnum() == PerformActionEnum.SCREENSHOT) {
            String screenShotName = method.getParam(OperationExecutor.INPUT_TEXT_KEY);
            Date now = new Date();
            SimpleDateFormat format = new SimpleDateFormat("yyyyMMddHHmmssSSS_", Locale.CHINA);
            String newFileName = format.format(now) + screenShotName;
            method.putParam(OperationExecutor.INPUT_TEXT_KEY, newFileName);
            screenshotFiles.put(screenShotName, newFileName);
        } else if (method.getActionEnum() == PerformActionEnum.IF) {
            OperationStep checkStep = new OperationStep();

            OperationMethod checkMethod;
            if (step.getOperationNode() != null) {
                checkMethod = new OperationMethod(PerformActionEnum.CHECK_NODE);
            } else {
                checkMethod = new OperationMethod(PerformActionEnum.CHECK);
            }
            checkMethod.getOperationParam().putAll(step.getOperationMethod().getOperationParam());
            checkStep.setOperationMethod(checkMethod);
            checkStep.setOperationNode(step.getOperationNode());
            checkStep.setOperationId(step.getOperationId());
            checkStep.setOperationIndex(step.getOperationIndex());

            waitForCheck = true;
            checkIdx = currentIdx - 1;
            ifIdx = currentIdx - 1;

            return checkStep;
        } else if (method.getActionEnum() == PerformActionEnum.WHILE) {
            String status = method.getParam(CHECK_PARAM);
            if (StringUtil.startWith(status, LogicUtil.LOOP_PREFIX)) {
                LoopParam newParam = new LoopParam(currentIdx,
                        currentIdx - 1 + Integer.parseInt(method.getParam(SCOPE)),
                        Integer.parseInt(status.substring(6)) - 2);

                // 循环次数小于1,直接跳出去
                if (newParam.loopCount < -1) {
                    currentIdx = newParam.loopEnd + 1;
                } else {
                    loopParams.push(newParam);
                }
                // 直接进行下一步
                return provideStep();
            }

            OperationStep checkStep = new OperationStep();

            OperationMethod checkMethod;
            if (step.getOperationNode() != null) {
                checkMethod = new OperationMethod(PerformActionEnum.CHECK_NODE);
            } else {
                checkMethod = new OperationMethod(PerformActionEnum.CHECK);
            }
            checkMethod.getOperationParam().putAll(step.getOperationMethod().getOperationParam());
            checkStep.setOperationMethod(checkMethod);
            checkStep.setOperationNode(step.getOperationNode());
            checkStep.setOperationId(step.getOperationId());
            checkStep.setOperationIndex(step.getOperationIndex());

            waitForCheck = true;
            checkIdx = currentIdx - 1;

            // 循环配置
            LoopParam newParam = new LoopParam(currentIdx - 1,
                    currentIdx - 1 + Integer.parseInt(method.getParam(SCOPE)), 0);
            loopParams.push(newParam);

            return checkStep;
        } else if (method.getActionEnum() == PerformActionEnum.CONTINUE) {
            if ((param = loopParams.peek()) != null) {
                if (param.loopCount >= 0) {
                    param.loopCount -= 1;
                    currentIdx = param.loopPos;

                    // 移除无用循环参数
                    if (param.loopCount == -1) {
                        loopParams.pop();
                    }
                } else {
                    // 移除当前loop信息，移动至末尾
                    loopParams.pop();
                    currentIdx = param.loopEnd + 1;
                }

                return provideStep();
            } else {
                return step;
            }
        } else if (method.getActionEnum() == PerformActionEnum.BREAK) {
            if ((param = loopParams.peek()) != null) {
                // 移除当前loop信息，移动至末尾
                loopParams.pop();
                currentIdx = param.loopEnd + 1;
                return provideStep();
            } else {
                return step;
            }
        }

        return step;
    }

    @Override
    public boolean hasNext() {
        if (errorReason != null) {
            return false;
        }

        // loop到队列结尾了
        LoopParam loop = loopParams.peek();
        if (loop != null && loop.loopEnd == stepList.size() - 1 && currentIdx == loop.loopEnd + 1) {
            return true;
        }
        return stepList.size() > currentIdx;
    }

    @Override
    public boolean reportErrorStep(OperationStep step, String reason) {
        // 未查找到，也接收
        if (waitForCheck && currentIdx == checkIdx + 1 &&
                (StringUtil.equals(reason, "执行失败") || StringUtil.equals(reason, "节点未查找到"))) {

            LoopParam l;
            if (ifIdx > -1 && currentIdx == ifIdx + 1) {
                OperationStep ifStep = stepList.get(ifIdx);

                // 跳步骤
                int jump = Integer.parseInt(ifStep.getOperationMethod().getParam(SCOPE));
                currentIdx += jump;

                ifIdx = -1;

            // Loop信息校验
            } else if ((l = loopParams.peek()) != null && currentIdx == l.loopPos + 1) {
                OperationStep whileStep = stepList.get(l.loopPos);

                // 跳步骤
                int jump = Integer.parseInt(whileStep.getOperationMethod().getParam(SCOPE));
                currentIdx += jump;

                loopParams.pop();
            } else {
                this.errorReason = reason;
                return true;
            }

            waitForCheck = false;
            return false;
        }

        this.errorReason = reason;
        return true;
    }

    @Override
    public void onStepInfo(ReplayStepInfoBean bean) {
        currentStepInfo.put(currentIdx - 1, bean);
    }

    @Override
    public List<ReplayResultBean> genReplayResult() {
        MyApplication.getInstance().invalidTempAppInfo();
        List<ReplayResultBean> resultBeans = super.genReplayResult();
        operationService.initParams();


        if (resultBeans.size() >= 1) {
            ReplayResultBean resultBean = resultBeans.get(0);
            // 终止adb日志
            File appLogFile = CmdTools.stopAppLog();

            if (appLogFile != null && appLogFile.exists()) {
                resultBean.setLogFile(appLogFile.getAbsolutePath());
            }

            resultBean.setScreenshotFiles(screenshotFiles);
            resultBean.setTargetApp(targetApp);
            resultBean.setCurrentOperationLog(stepList);

            resultBean.setActionLogs(currentStepInfo);
            resultBean.setCaseName(caseInfo.getCaseName());
            if (errorReason != null) {
                resultBean.setExceptionStep(currentIdx - 1);
                resultBean.setExceptionMessage(errorReason);
            }
        }

        return resultBeans;
    }

    /**
     * 创建OperationStep
     *
     * @param method
     * @param operationId
     * @return
     */
    private OperationStep createOperationStep(OperationNode node, OperationMethod method, String operationId) {
        OperationStep step = new OperationStep();
        step.setOperationNode(node);
        step.setOperationMethod(method);
        step.setOperationIndex(0);
        step.setOperationId(operationId);
        return step;
    }


    /**
     * Loop状态
     */
    private static class LoopParam {
        /**
         * loop位置
         */
        int loopPos = -1;

        /**
         * loop结尾
         */
        int loopEnd = -1;

        /**
         * loop次数
         */
        int loopCount = -1;

        public LoopParam(int loopPos, int loopEnd, int loopCount) {
            this.loopPos = loopPos;
            this.loopEnd = loopEnd;
            this.loopCount = loopCount;
        }
    }

    /**
     * Peek不抛异常的Stack
     * @param <T>
     */
    public static class PeekableStack<T> extends Stack<T> {
        @Override
        public synchronized T peek() {
            int len = size();
            if (len == 0) {
                return null;
            } else {
                return elementAt(len - 1);
            }
        }
    }
}
