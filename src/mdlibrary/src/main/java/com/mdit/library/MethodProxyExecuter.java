package com.mdit.library;

import java.lang.reflect.Method;
import java.util.Arrays;

public class MethodProxyExecuter {
	
	@SuppressWarnings({ "rawtypes" })
	public static Object executeInterceptor(MethodInterceptor[] interceptors, CallbackFilter callbackFilter, MethodInterceptor interceptor, Class superClass, String methodName,
											Class[] argsType, Object[] argsValue, Object object) {
		if (interceptor == null && interceptors == null && callbackFilter == null) {
//			throw new ProxyException("Did not set method interceptor !");
			MethodProxy methodProxy = new MethodProxy(superClass, methodName, argsType);
			return methodProxy.invokeSuper(object,argsValue);
		}
		try {
			if (interceptors!=null && callbackFilter!=null){
				MethodProxy methodProxy = new MethodProxy(superClass, methodName, argsType);
				return interceptors[callbackFilter.accept(object.getClass().getDeclaredMethod(methodName,argsType))].intercept(object, argsValue, methodProxy);
			}
			MethodProxy methodProxy = new MethodProxy(superClass, methodName, argsType);
			return interceptor.intercept(object, argsValue, methodProxy);
		} catch (Exception e) {
			throw new ProxyException(e.getMessage(), e);
		}
	}
	
	@SuppressWarnings({ "unchecked", "rawtypes" })
	public static Object executeMethod(String methodName, Class[] argsType, Object[] argsValue, Object object) {
		try {
			Method method = findTargetMethod(methodName, argsType, object);
			if (method == null) {
				throw new ProxyException("No such method：" + methodName + "(" + Arrays.toString(argsType) + ")");
			}
			return method.invoke(object, argsValue);
		} catch (Exception e) {
			throw new ProxyException(e.getMessage(), e);
		}
	}

	/**
	 * 向父类查找方法
	 * @param method
	 * @param argsType
	 * @param target
	 * @return
	 */
	private static Method findTargetMethod(String method, Class[] argsType, Object target) {
		Class currentClass = target.getClass();
		while (currentClass != null && currentClass != Object.class && !currentClass.isPrimitive()) {
			try {
				return currentClass.getMethod(method, argsType);
			} catch (NoSuchMethodException e) {
				continue;
			}
		}

		return null;
	}

}
