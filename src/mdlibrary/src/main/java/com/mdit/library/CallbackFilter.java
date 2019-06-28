package com.mdit.library;

import java.lang.reflect.Method;

/**
 * <pre>
 *     author : zhangke
 *     e-mail : zhangke3016@gmail.com
 *     time   : 2017/05/07
 *     desc   :
 * </pre>
 */
public interface CallbackFilter {
    /**
     * 过滤方法
     * @param method
     * @return
     */
    public int accept(Method method);
}
