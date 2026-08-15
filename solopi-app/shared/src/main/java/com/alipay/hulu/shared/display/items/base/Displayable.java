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
package com.alipay.hulu.shared.display.items.base;

import java.util.List;
import java.util.Map;

/**
 * Created by cathor on 17/7/25.
 */

/**
 * 显示工具接口
 */
public interface Displayable {
    void start();

    void stop();

    /**
     * 实时数据获取
     *
     * @return 实时数据
     * @throws Exception
     */
    String getCurrentInfo() throws Exception;

    /**
     * 获取最小刷新间隔
     *
     * @return
     */
    long getRefreshFrequency();

    /**
     * 清理方法
     */
    void clear();

    /**
     * 开始录制
     */
    void startRecord();

    /**
     * 调用录制
     */
    void record();

    /**
     * 触发特定事件
     */
    void trigger();

    /**
     * 停止录制并返回录制数据
     * @return
     */
    Map<RecordPattern, List<RecordPattern.RecordItem>> stopRecord();
}
