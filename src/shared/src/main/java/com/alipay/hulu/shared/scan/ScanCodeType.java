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
package com.alipay.hulu.shared.scan;

import com.alipay.hulu.common.utils.StringUtil;
import com.google.zxing.BarcodeFormat;

/**
 * 支持处理码类型
 */
public enum ScanCodeType {
    EAN_13("EAN-13", BarcodeFormat.EAN_13),
    EAN_8("EAN-8", BarcodeFormat.EAN_8),
    CODE_128("CODE 128", BarcodeFormat.CODE_128),
    CODE_39("CODE 39", BarcodeFormat.CODE_39),
    QR_CODE("QR CODE", BarcodeFormat.QR_CODE),
    PDF_417("PDF 417", BarcodeFormat.PDF_417),
    DATA_MATRIX("Datamatrix", BarcodeFormat.DATA_MATRIX),
    ;

    String code;
    BarcodeFormat targetFormat;

    ScanCodeType(String code, BarcodeFormat format) {
        this.code = code;
        this.targetFormat = format;
    }

    /**
     * 根据编码查找扫描类型
     * @param code
     * @return
     */
    public static ScanCodeType getByCode(String code) {
        if (StringUtil.isEmpty(code)) {
            return null;
        }

        for (ScanCodeType type: values()) {
            if (code.equals(type.code)) {
                return type;
            }
        }

        return null;
    }

    /**
     * 根据类型查找扫描类型
     * @param format
     * @return
     */
    public static ScanCodeType getByFormat(BarcodeFormat format) {
        if (format == null) {
            return null;
        }

        for (ScanCodeType type: values()) {
            if (format == type.targetFormat) {
                return type;
            }
        }

        return null;
    }

    public String getCode() {
        return code;
    }

    public BarcodeFormat getTargetFormat() {
        return targetFormat;
    }
}
