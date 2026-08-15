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

import android.os.Parcel;
import android.os.Parcelable;

import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.scan.ScanCodeType;
import com.google.zxing.BarcodeFormat;

/**
 * Created by lezhou.wyl on 2018/2/7.
 */

public class ScanSuccessEvent implements Parcelable {

    public static final int SCAN_TYPE_SCHEME = 1;
    public static final int SCAN_TYPE_PARAM = 6;
    public static final int SCAN_TYPE_OTHER = 7;
    public static final int SCAN_TYPE_QR_CODE = 10;
    public static final int SCAN_TYPE_BAR_CODE = 11;
    private int type;
    private String content;
    private ScanCodeType codeType;

    public int getType() {
        return type;
    }

    public void setType(int type) {
        this.type = type;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public ScanCodeType getCodeType() {
        return codeType;
    }

    public void setCodeType(ScanCodeType codeType) {
        this.codeType = codeType;
    }

    @Override
    public int describeContents() {
        return 0;
    }

    @Override
    public void writeToParcel(Parcel dest, int flags) {
        dest.writeInt(this.type);
        dest.writeString(this.content);
        if (this.codeType != null) {
            dest.writeString(this.codeType.getCode());
        }
    }

    public ScanSuccessEvent() {
    }

    protected ScanSuccessEvent(Parcel in) {
        this.type = in.readInt();
        this.content = in.readString();
        String code = in.readString();
        if (StringUtil.isNotEmpty(code)) {
            this.codeType = ScanCodeType.getByCode(code);
        }
    }

    public static final Parcelable.Creator<ScanSuccessEvent> CREATOR = new Creator<ScanSuccessEvent>() {
        @Override
        public ScanSuccessEvent createFromParcel(Parcel source) {
            return new ScanSuccessEvent(source);
        }

        @Override
        public ScanSuccessEvent[] newArray(int size) {
            return new ScanSuccessEvent[size];
        }
    };
}
