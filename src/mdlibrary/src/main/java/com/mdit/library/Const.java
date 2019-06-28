/*
  Edit from source Const.java

  Copyright 2016 zhangke

  Licensed under the Apache License, Version 2.0 (the "License"); you may not use
  this file except in compliance with the License. You may obtain a copy of the
  License at http://www.apache.org/licenses/LICENSE-2.0 Unless required by applicable
  law or agreed to in writing, software distributed under the License is distributed
  on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
  or implied. See the License for the specific language governing permissions and
  imitations under the License.
 */
package com.mdit.library;

public class Const {
	
	public static final String SUBCLASS_SUFFIX = "_Proxy";
	
	public static final String SUBCLASS_INVOKE_SUPER_SUFFIX = "$Super$";
	
	public static Class getPackedType(Class primitive) {
		if (primitive == boolean.class) {
			return Boolean.class;
		} else if (primitive == byte.class) {
			return Byte.class;
		} else if (primitive == char.class) {
			return Character.class;
		} else if (primitive == double.class) {
			return Double.class;
		} else if (primitive == float.class) {
			return Float.class;
		} else if (primitive == int.class) {
			return Integer.class;
		} else if (primitive == long.class) {
			return Long.class;
		} else if (primitive == short.class) {
			return Short.class;
		} else if (primitive == void.class) {
			return Void.class;
		} else {
			return primitive;
		}
	}
	
	public static String getPrimitiveValueMethodName(Class primitive) {
		if (primitive == boolean.class) {
			return "booleanValue";
		} else if (primitive == byte.class) {
			return "byteValue";
		} else if (primitive == char.class) {
			return "charValue";
		} else if (primitive == double.class) {
			return "doubleValue";
		} else if (primitive == float.class) {
			return "floatValue";
		} else if (primitive == int.class) {
			return "intValue";
		} else if (primitive == long.class) {
			return "longValue";
		} else if (primitive == short.class) {
			return "shortValue";
		} else {
			throw new ProxyException(primitive.getName() + " dit not primitive class");
		}
	}

}
