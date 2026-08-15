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
package com.alipay.hulu.common.service;

import android.graphics.Bitmap;

import com.alipay.hulu.common.service.base.ExportService;

import java.io.File;

/**
 * Created by qiaoruikai on 2019-04-19 20:12.
 */
public interface ScreenCaptureService extends ExportService {
    /**
     * 截图操作
     * @param outFile
     * @return
     */
    Bitmap captureScreen(File outFile, int originW, int originH, int outW, int outH);
}
