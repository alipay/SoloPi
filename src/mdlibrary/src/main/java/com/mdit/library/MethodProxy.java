package com.mdit.library;

import java.lang.reflect.Method;

public class MethodProxy {

	private Class subClass;
	private String methodName;
	private Class[] argsType;
	
	@SuppressWarnings("rawtypes")
	public MethodProxy(Class subClass, String methodName, Class[] argsType) {
		this.subClass = subClass;
		this.methodName = methodName;
		this.argsType = argsType;
	}

	public String getMethodName() {
		return methodName;
	}
	
	@SuppressWarnings("unchecked")
	public Method getOriginalMethod() {
		try {
			return subClass.getDeclaredMethod(methodName, argsType);
		} catch (NoSuchMethodException e) {
			throw new ProxyException(e.getMessage());
		}
	}

	@SuppressWarnings("unchecked")
	public Method getProxyMethod() {
		try {
			return subClass.getDeclaredMethod(methodName + Const.SUBCLASS_INVOKE_SUPER_SUFFIX, argsType);
		} catch (NoSuchMethodException e) {
			throw new ProxyException(e.getMessage());
		}
	}


	public Object invokeSuper(Object value, Object[] argsValue) {
		return MethodProxyExecuter.executeMethod(methodName, argsType, argsValue, value);
	}

}
