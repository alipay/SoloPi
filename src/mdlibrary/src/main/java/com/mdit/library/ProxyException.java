package com.mdit.library;

public class ProxyException extends RuntimeException {
	
	private static final long serialVersionUID = 702035040596969930L;

	public ProxyException() {
		super();
	}
	
	public ProxyException(String msg) {
		super(msg);
	}

	public ProxyException(String msg, Throwable t) {
		super(msg, t);
	}

}
