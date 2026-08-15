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


import java.io.File;

/**
 * 步骤执行结果
 */
public class OperationStepResult {
    /**
     * 操作步骤信息
     */
    public String method;

    /**
     * 失败原因
     */
    public String error;

    /**
     * 执行结果
     */
    public boolean result;

    /**
     * 结果截图
     */
    public File screenCaptureFile;
}