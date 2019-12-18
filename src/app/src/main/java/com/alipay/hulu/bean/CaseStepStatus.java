package com.alipay.hulu.bean;

import android.support.annotation.StringRes;

import com.alipay.hulu.R;
import com.alipay.hulu.common.utils.StringUtil;

/**
 * Created by qiaoruikai on 2019/12/18 2:29 PM.
 */
public enum  CaseStepStatus {
    FINISH("finish", R.string.case_step_status__finish),
    FAIL("fail", R.string.case_step_status__fail),
    UNENFORCED("unenforced", R.string.case_step_status__unenforced),
    ;
    private String code;
    private int desc;

    CaseStepStatus(String code, @StringRes int desc) {
        this.code = code;
        this.desc = desc;
    }

    /**
     * 根据Code查找
     * @param code
     * @return
     */
    public static CaseStepStatus getByCode(String code) {
        for (CaseStepStatus status: values()) {
            if (status.code.equals(code)) {
                return status;
            }
        }

        return null;
    }

    public String getCode() {
        return code;
    }

    public String getName() {
        return StringUtil.getString(desc);
    }
}
