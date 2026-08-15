package com.alipay.hulu.common.trigger;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
public @interface Trigger {
    String TRIGGER_TIME_START = "TRIGGER_TIME_START";
    String TRIGGER_TIME_START_FINISH = "TRIGGER_TIME_START_FINISH";
    String TRIGGER_TIME_HOME_PAGE = "TRIGGER_TIME_HOME_PAGE";
    String TRIGGER_TIME_SCHEME_INIT = "TRIGGER_TIME_SCHEME_INIT";
    String TRIGGER_TIME_ADB_CONNECT = "TRIGGER_TIME_ADB_CONNECT";

    /**
     * 触发环节
     * @return
     */
    String[] value() default "";

    /**
     * 触发器级别，越大越优先触发
     * @return
     */
    int level() default 1;
}
