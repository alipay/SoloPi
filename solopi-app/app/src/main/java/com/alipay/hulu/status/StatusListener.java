package com.alipay.hulu.status;

import com.alibaba.fastjson.JSONObject;

import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import androidx.annotation.StringDef;

import static java.lang.annotation.ElementType.PARAMETER;
import static java.lang.annotation.RetentionPolicy.SOURCE;

public interface StatusListener {
    public static final String STATUS_START = "START";
    public static final String STATUS_PREPARED = "PREPARED";
    public static final String STATUS_STOP = "STOP";
    public static final String STATUS_STEP = "STEP";

    @StringDef({
            STATUS_START,
            STATUS_PREPARED,
            STATUS_STEP,
            STATUS_STOP
    })
    @Retention(SOURCE)
    @Target({PARAMETER})
    @interface StateDefine{};


    /**
     * 通知状态变化
     * @param state
     * @param extra
     */
    void onStatusChange(@StateDefine String state, JSONObject extra);
}
