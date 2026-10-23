package com.mdit.library;

/**
 * <pre>
 *     author : zhangke
 *     e-mail : zhangke3016@gmail.com
 *     time   : 2017/05/07
 *     desc   :
 * </pre>
 */

public interface NoOp {

    public static final MethodInterceptor INSTANCE = new MethodInterceptor(){

        @Override
        public Object intercept(Object object, Object[] args, MethodProxy methodProxy) throws Exception {
            return methodProxy.invokeSuper(object, args);
        }
    };
    public static final MethodInterceptor INSTANCE_EMPTY = new MethodInterceptor(){

        @Override
        public Object intercept(Object object, Object[] args, MethodProxy methodProxy) throws Exception {
            //methodProxy.invokeSuper(object,args)
            return null;
        }
    };
}
