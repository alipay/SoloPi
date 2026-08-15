package com.mdit.library;

public interface EnhancerInterface {
	
	public void setMethodInterceptor$Enhancer$(MethodInterceptor methodInterceptor);

	/**
	 *
     */
	public void setCallBacksMethod$Enhancer$(MethodInterceptor[] methodInterceptor);

	public void setTarget$Enhancer$(Object o);

	public Object getTarget$Enhancer$();
	/**
	 * filter
     */
	public void setCallBackFilterMethod$Enhancer$(CallbackFilter callbackFilter);

}
