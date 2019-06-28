/*
  Edit from source Enhancer.java

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

import android.content.Context;
import android.util.Log;

import com.android.dx.Code;
import com.android.dx.Comparison;
import com.android.dx.DexMaker;
import com.android.dx.FieldId;
import com.android.dx.Label;
import com.android.dx.Local;
import com.android.dx.MethodId;
import com.android.dx.TypeId;

import java.io.File;
import java.io.IOException;
import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;


public class Enhancer <T> {
	private static final String TAG = "Enhancer";

	private static Map<String, Class> cachedClasses = new HashMap<>();

	private Context context;
	private Class<T> superclass;
	private MethodInterceptor interceptor;

	private MethodInterceptor[] interceptors;

	private CallbackFilter methodFilter;

	private ClassLoader classLoader;

	public Enhancer(Context context) {
		this.context = context;
	}

	public void setSuperclass(Class<T> cls) {
		this.superclass = cls;
	}

	public void setClassLoader(ClassLoader classLoader) {
		this.classLoader = classLoader;
	}

	public void setCallbackFilter(CallbackFilter methodFilter) {
		this.methodFilter = methodFilter;
	}

	public void setCallbacks(MethodInterceptor[] interceptors) {
		if (interceptors != null && interceptors.length == 0) {
			throw new IllegalArgumentException("Array cannot be empty");
		}
		this.interceptors = interceptors;
	}

	public void setCallback(MethodInterceptor interceptor) {
		this.interceptor = interceptor;
	}

	private Class<? extends T> getSubClass() {
		ClassLoader loader = classLoader;
		if (loader == null) {
			loader = superclass.getClassLoader();
		}

		if (cachedClasses.containsKey(superclass.getName())) {
			return cachedClasses.get(superclass.getName());
		}

		String superClsName = superclass.getName().replace(".", "/");
		String subClsName = superClsName + Const.SUBCLASS_SUFFIX;

		TypeId<T> superType = TypeId.get(superclass);
		TypeId<? extends T> subType = TypeId.get("L" + subClsName + ";");
		TypeId<?> interfaceTypeId = TypeId.get(EnhancerInterface.class);

		String cacheDir = context.getDir("dexfiles", Context.MODE_PRIVATE).getAbsolutePath();
//		System.out.println("[Enhancer::create()] Create class extends from \"" + superclass.getName() + "\" stored in " + cacheDir);

		DexMaker dexMaker = new DexMaker();
		dexMaker.declare(subType, superClsName + "_proxy", Modifier.PUBLIC, superType, interfaceTypeId);
		generateFieldsAndMethods(dexMaker, superclass, subType);
		ClassLoader _loader;
		try {
			_loader = dexMaker.generateAndLoad(loader, new File(cacheDir));
			Class<? extends T> subCls = (Class<? extends T>) _loader.loadClass(subClsName);
			cachedClasses.put(superclass.getName(), subCls);
			return subCls;
		} catch (IOException e) {
			Log.e(TAG, "Catch java.io.IOException: " + e.getMessage(), e);
		} catch (ClassNotFoundException e) {
			Log.e(TAG, "Catch java.lang.ClassNotFoundException: " + e.getMessage(), e);
		}
		return null;
	}

	/**
	 * 创建对象
	 * @param args
	 * @param classes
	 * @return
	 */
	public T create(Object[] args, Class<?>[] classes) {
		try {

			Class<?> subCls = getSubClass();
			if (subCls == null) {
				return null;
			}

			Constructor<?> constructor;
			try {
				constructor = subCls.getConstructor(classes);
			} catch (NoSuchMethodException e) {
				throw new IllegalArgumentException("No constructor for " + superclass.getName()
						+ " with no parameter");
			}
			Object obj;
			try {
				obj = constructor.newInstance(args);
			} catch (InvocationTargetException e) {
				throw new IllegalArgumentException("初始化失败", e);
			}

			((EnhancerInterface) obj).setMethodInterceptor$Enhancer$(interceptor);
			((EnhancerInterface) obj).setCallBackFilterMethod$Enhancer$(methodFilter);
			((EnhancerInterface) obj).setCallBacksMethod$Enhancer$(interceptors);
			return (T) obj;
		} catch (IllegalAccessException mE) {
			mE.printStackTrace();
		} catch (InstantiationException mE) {
			mE.printStackTrace();
		} catch (RuntimeException e) {
			Log.e(TAG, "运行时异常：parent=" + superclass.getSimpleName(), e);
		}

		return null;
	}

	public T create(Object... args) {
		Class<?>[] argsType;
		if (args == null || args.length == 0) {
			argsType = new Class[0];
		} else {
			argsType = new Class[args.length];
			for (int i = 0; i < args.length; i++) {
				if (args[i] == null) {
					argsType[i] = Object.class;
				} else {
					argsType[i] = args[i].getClass();
				}
			}
		}

		return create(args, argsType);
	}

	@SuppressWarnings({ "unchecked", "rawtypes" })
	private <S extends T, T> void generateFieldsAndMethods(DexMaker dexMaker, Class<T> superClass, TypeId<S> subType) {
		TypeId<T> superType = TypeId.get(superClass);
		TypeId<MethodInterceptor> methodInterceptorType = TypeId.get(MethodInterceptor.class);
		TypeId<MethodInterceptor[]> methodInterceptorsType = TypeId.get(MethodInterceptor[].class);

		TypeId<CallbackFilter> callbackFilterType = TypeId.get(CallbackFilter.class);
		TypeId<MethodProxyExecuter> methodProxyExecuterType = TypeId.get(MethodProxyExecuter.class);
		TypeId<Class> classType = TypeId.get(Class.class);
		TypeId<Class[]> classesType = TypeId.get(Class[].class);
		TypeId<String> stringType = TypeId.STRING;
		TypeId<Object> objectType = TypeId.OBJECT;
		TypeId<Object[]> objectsType = TypeId.get(Object[].class);

		FieldId<S, Object> referenceFieldId = subType.getField(objectType, "__reference_item");
		dexMaker.declare(referenceFieldId, Modifier.PRIVATE, null);


		// generate fields
		FieldId<S, MethodInterceptor> fieldId = subType.getField(methodInterceptorType, "__methodInterceptor");
		dexMaker.declare(fieldId, Modifier.PRIVATE, null);

		// generate fields callbackFilterType
		FieldId<S, CallbackFilter> fieldFilterId = subType.getField(callbackFilterType, "__methodCallbackFilter");
		dexMaker.declare(fieldFilterId, Modifier.PRIVATE, null);

		// generate fields methodInterceptors
		FieldId<S, MethodInterceptor[]> fieldIds = subType.getField(methodInterceptorsType, "__methodInterceptors");
		dexMaker.declare(fieldIds, Modifier.PRIVATE, null);

		for (Constructor<T> constructor : getConstructorsToOverwrite(superClass)) {
			if (constructor.getModifiers() == Modifier.FINAL) {
				continue;
			}
			TypeId<?>[] types = classArrayToTypeArray(constructor.getParameterTypes());
			MethodId<S, ?> method = subType.getConstructor(types);
			Code constructorCode = dexMaker.declare(method, Modifier.PUBLIC);
			Local<S> thisRef = constructorCode.getThis(subType);
			Local<?>[] params = new Local[types.length];
			for (int i = 0; i < params.length; ++i) {
				params[i] = constructorCode.getParameter(i, types[i]);
			}
			MethodId<T, ?> superConstructor = superType.getConstructor(types);
			constructorCode.invokeDirect(superConstructor, null, thisRef, params);
			constructorCode.returnVoid();
		}

		// setTarget$Enhancer$
		MethodId<?, Void> setTargetMethod = subType.getMethod(TypeId.VOID, "setTarget$Enhancer$", objectType);
		Code code = dexMaker.declare(setTargetMethod, Modifier.PUBLIC);
		code.iput(referenceFieldId, code.getThis(subType), code.getParameter(0, objectType));
		code.returnVoid();

		// getTarget$Enhancer$
		MethodId<?, Object> getTargetMethod = subType.getMethod(TypeId.OBJECT, "getTarget$Enhancer$");
		code = dexMaker.declare(getTargetMethod, Modifier.PUBLIC);
		Local<Object> obj = code.newLocal(TypeId.OBJECT);
		code.iget(referenceFieldId, obj, code.getThis(subType));
		code.returnValue(obj);

		// setMethodInterceptor$Enhancer$
		MethodId<?, Void> setMethodInterceptorMethodId = subType.getMethod(TypeId.VOID, "setMethodInterceptor$Enhancer$", methodInterceptorType);
		code = dexMaker.declare(setMethodInterceptorMethodId, Modifier.PUBLIC);
		code.iput(fieldId, code.getThis(subType), code.getParameter(0, methodInterceptorType));
		code.returnVoid();

		// setCallBacksMethod$Enhancer$
		MethodId<?, Void> setMethodInterceptorsMethodId = subType.getMethod(TypeId.VOID, "setCallBacksMethod$Enhancer$", methodInterceptorsType);
		code = dexMaker.declare(setMethodInterceptorsMethodId, Modifier.PUBLIC);
		code.iput(fieldIds, code.getThis(subType), code.getParameter(0, methodInterceptorsType));
		code.returnVoid();

		// setCallBackFilterMethod$Enhancer$
		MethodId<?, Void> setCallBackFilterMethodId = subType.getMethod(TypeId.VOID, "setCallBackFilterMethod$Enhancer$", callbackFilterType);
		code = dexMaker.declare(setCallBackFilterMethodId, Modifier.PUBLIC);
		code.iput(fieldFilterId, code.getThis(subType), code.getParameter(0, callbackFilterType));
		code.returnVoid();

//		// executeSuperMethod$Enhancer$
//		MethodId<?, Object> executeSuperMethodMethodId = subType.getMethod(TypeId.OBJECT, "executeSuperMethod$Enhancer$", objectType, stringType, classesType, objectsType);
//		code = dexMaker.declare(executeSuperMethodMethodId, Modifier.PUBLIC);
//		Local<Object> retObjLocal = code.newLocal(objectType);
//		Local<Class> superClassLocal = code.newLocal(classType);
//
//		TypeId<System> systemType = TypeId.get(System.class);
//		TypeId<PrintStream> printStreamType = TypeId.get(PrintStream.class);
//		Local<PrintStream> localSystemOut = code.newLocal(printStreamType);
//		Local<String> tmpString = code.newLocal(stringType);
//
//		code.loadConstant(superClassLocal, superClass);
//		FieldId<System, PrintStream> systemOutField = systemType.getField(printStreamType, "out");
//		code.sget(systemOutField, localSystemOut);
//		MethodId<PrintStream, Void> printlnMethod = printStreamType.getMethod(
//				TypeId.VOID, "println", TypeId.STRING);
//		code.cast(tmpString, code.getParameter(0, objectType));
//		code.invokeVirtual(printlnMethod, null, localSystemOut, tmpString);
//		code.cast(tmpString, superClassLocal);
//		code.invokeVirtual(printlnMethod, null, localSystemOut, tmpString);
//
//		MethodId methodId = methodProxyExecuterType.getMethod(TypeId.OBJECT, "executeMethod", classType, stringType, classesType, objectsType, objectType);
//		code.invokeStatic(methodId, retObjLocal, superClassLocal, code.getParameter(1, stringType), code.getParameter(2, classesType), code.getParameter(3, objectsType), code.getParameter(0, objectType));
//		code.returnValue(retObjLocal);

		// override super's methods
		List<Method> methods = getAllMethods(superClass);
		MethodId<?, ?> superMethodId = null;
		MethodId<?, ?> subMethodId = null;
		MethodId<?, ?> methodId;
		Local<Object> retObjLocal;
		Local<Class> superClassLocal;

		TypeId<?>[] argsTypeId = null;
		TypeId<?> methodReturnType = null;
		String methodName = null;
		boolean isVoid = false;
		boolean hasParams = false;
		Class retClass = null;
		Local thisLocal;
		Set<MethodHashable> methodSet = new HashSet<>();
		for (Method method : methods) {
			methodName = method.getName();
			if (methodName.contains("$")) {  // Android studio will generate access$super method for every class
				continue ;
			}

			// 静态方法不管，非public方法不管，final方法替换不了
			if (!Modifier.isPublic(method.getModifiers()) || Modifier.isFinal(method.getModifiers()) || Modifier.isStatic(method.getModifiers())) {
				continue;
			}

			retClass = method.getReturnType();
			isVoid = retClass == void.class;
//			if (retClass.isPrimitive() && retClass != void.class) {
//				methodReturnType = TypeId.get(Const.getPackedType(retClass));
//			} else {
				methodReturnType = TypeId.get(retClass);
//			}
			Class<?>[] argsClass = method.getParameterTypes();

			MethodHashable hashable = new MethodHashable(methodName, argsClass);
			if (methodSet.contains(hashable)) {
				Log.d(TAG, "方法" + method + "已被实现");
				continue;
			}
			methodSet.add(hashable);

			hasParams = argsClass != null && argsClass.length > 0;
			if (hasParams) {
				argsTypeId = new TypeId[argsClass.length];
				for (int i=0; i<argsClass.length; i++) {
//					if (argsClass[i].isPrimitive()) {
//						argsTypeId[i] = TypeId.get(Const.getPackedType(argsClass[i]));
//					} else {
						argsTypeId[i] = TypeId.get(argsClass[i]);
//					}
				}
				subMethodId = subType.getMethod(methodReturnType, methodName, argsTypeId);
			} else {
				subMethodId = subType.getMethod(methodReturnType, methodName);
			}

			code = dexMaker.declare(subMethodId, method.getModifiers());

//			if (Modifier.isStatic(method.getModifiers())){
////				Local tmpNumberLocal = null;
//				Local retLocal = code.newLocal(methodReturnType);
//
//				TypeId supType = TypeId.get(superclass);
////				tmpNumberLocal = code.newLocal(TypeId.get(Object.class));
//				if (hasParams) {
//					Local[] local = new Local[argsTypeId.length];
//					for (int i=0; i<argsTypeId.length; i++) {
//						local[i] = code.newLocal(argsTypeId[i]);//;
//					}
//
//					MethodId methodID
//							= supType.getMethod(methodReturnType, methodName, argsTypeId);
//					code.invokeStatic(methodID, retLocal, local);
//
//				}else {
//					MethodId methodID
//							= supType.getMethod(methodReturnType, methodName);
//					code.invokeStatic(methodID, retLocal);
//				}
//				if (isVoid){
//					code.returnVoid();
//				}else {
////					code.cast(retLocal, tmpNumberLocal);
//					code.returnValue(retLocal);
//				}
//				continue;
//			}

			Local retLocal = code.newLocal(methodReturnType);
			Local retPackLocal = null;
			if (retClass.isPrimitive()) {
				retPackLocal = code.newLocal(TypeId.get(Const.getPackedType(retClass)));
			}

			Local<Integer> intLocal = code.newLocal(TypeId.INT);
			Local<MethodInterceptor> methodInterceptorLocal = code.newLocal(methodInterceptorType);
			Local<MethodInterceptor[]> methodInterceptorsLocal = code.newLocal(methodInterceptorsType);
			Local<CallbackFilter> callbackFilterLocal = code.newLocal(callbackFilterType);

			Local<String> methodNameLocal = code.newLocal(TypeId.STRING);
			Local<Class> tmpClassLocal = code.newLocal(classType);
			superClassLocal = code.newLocal(classType);
			Local<Class[]> argsTypeLocal = code.newLocal(classesType);
			Local<Object[]> argsValueLocal = code.newLocal(objectsType);
			Local tmpNumberLocal = code.newLocal(objectType);
			retObjLocal = code.newLocal(TypeId.OBJECT);


			thisLocal = code.getThis(subType);
			code.iget(fieldId, methodInterceptorLocal, thisLocal);
			code.iget(fieldFilterId,callbackFilterLocal,thisLocal);
			code.iget(fieldIds,methodInterceptorsLocal,thisLocal);
			code.loadConstant(methodNameLocal, methodName);
			code.invokeVirtual(subType.getMethod(classType, "getClass"), superClassLocal, thisLocal);

			if (hasParams) {
				code.loadConstant(intLocal, argsClass.length);
				code.newArray(argsTypeLocal, intLocal);
				code.newArray(argsValueLocal, intLocal);

				for (int i=0; i<argsClass.length; i++) {
					code.loadConstant(intLocal, i);
					code.loadConstant(tmpClassLocal, argsClass[i]);
					code.aput(argsTypeLocal, intLocal, tmpClassLocal);

					if (argsClass[i].isPrimitive()) {
						TypeId packedClassType = TypeId.get(Const.getPackedType(argsClass[i]));
						methodId = packedClassType.getMethod(packedClassType, "valueOf", argsTypeId[i]);
						code.invokeStatic(methodId, tmpNumberLocal, code.getParameter(i, argsTypeId[i]));
						code.aput(argsValueLocal, intLocal, tmpNumberLocal);
					} else {
						code.aput(argsValueLocal, intLocal, code.getParameter(i, argsTypeId[i]));
					}
				}
			} else {
				// must add below code, or "bad method" error will occurs.
				code.loadConstant(argsTypeLocal, null);
				code.loadConstant(argsValueLocal, null);
			}

			methodId = methodProxyExecuterType.getMethod(TypeId.OBJECT, "executeInterceptor",methodInterceptorsType,callbackFilterType, methodInterceptorType, classType, stringType, classesType, objectsType, objectType);
			code.invokeStatic(methodId, isVoid ? null : retObjLocal,methodInterceptorsLocal,callbackFilterLocal, methodInterceptorLocal, superClassLocal, methodNameLocal, argsTypeLocal, argsValueLocal, thisLocal);

			if (isVoid) {
				code.returnVoid();
			} else {
				if (retClass.isPrimitive()) {
					// here use one label, if use two, need jump once and mark twice
					Label ifBody = new Label();
					code.loadConstant(retPackLocal, null);
					code.compare(Comparison.EQ, ifBody, retObjLocal, retPackLocal);

					code.cast(retPackLocal, retObjLocal);
					methodId = TypeId.get(Const.getPackedType(retClass)).getMethod(methodReturnType, Const.getPrimitiveValueMethodName(retClass));
					code.invokeVirtual(methodId, retLocal, retPackLocal);
					code.returnValue(retLocal);

					code.mark(ifBody);
					code.loadConstant(retLocal, 0);
					code.returnValue(retLocal);
				} else {
					code.cast(retLocal, retObjLocal);
					code.returnValue(retLocal);
				}
			}

			// generate method {methodName}$Super$ to invoke super's
			if (hasParams) {
				subMethodId = subType.getMethod(methodReturnType, methodName + Const.SUBCLASS_INVOKE_SUPER_SUFFIX, argsTypeId);
				superMethodId = superType.getMethod(methodReturnType, methodName, argsTypeId);
			} else {
				subMethodId = subType.getMethod(methodReturnType, methodName + Const.SUBCLASS_INVOKE_SUPER_SUFFIX);
				superMethodId = superType.getMethod(methodReturnType, methodName);
			}
			code = dexMaker.declare(subMethodId, method.getModifiers());
			retLocal = code.newLocal(methodReturnType);
			Local[] superArgsValueLocal = null;
			thisLocal = code.getThis(subType);
			if (hasParams) {
				superArgsValueLocal = new Local[argsClass.length];
				for (int i=0; i<argsClass.length; i++) {
					superArgsValueLocal[i] = code.getParameter(i, argsTypeId[i]);
				}
				code.invokeSuper(superMethodId, isVoid ? null : retLocal, thisLocal, superArgsValueLocal);
			} else {
				code.invokeSuper(superMethodId, isVoid ? null : retLocal, thisLocal);
			}
			if (isVoid) {
				code.returnVoid();
			} else {
				code.returnValue(retLocal);
			}
		}
	}

	public static List<Method> getAllMethods(Class clazz) {
		if (clazz == null) {
			Log.e(TAG, "无法获取空对象的方法");
		}

		List<Method> allMethods = new ArrayList<>();
		Class currentClass = clazz;
		while (currentClass != null && currentClass != Object.class && !currentClass.isPrimitive()) {
			Method[] currentLevelMethods = currentClass.getDeclaredMethods();
			// 添加该方法
			allMethods.addAll(Arrays.asList(currentLevelMethods));

			currentClass = currentClass.getSuperclass();

		}

		return allMethods;
	}

	private static class MethodHashable {
		String methodName;
		Class<?>[] params;

		public MethodHashable(String methodName, Class<?>[] params) {
			this.methodName = methodName;
			this.params = params;
		}

		@Override
		public boolean equals(Object o) {
			if (this == o) return true;
			if (o == null || getClass() != o.getClass()) return false;

			MethodHashable that = (MethodHashable) o;

			if (!methodName.equals(that.methodName)) return false;
			// Probably incorrect - comparing Object[] arrays with Arrays.equals
			return Arrays.equals(params, that.params);
		}

		@Override
		public int hashCode() {
			int result = methodName.hashCode();
			result = 31 * result + Arrays.hashCode(params);
			return result;
		}
	}

	private static <T> Constructor<T>[] getConstructorsToOverwrite(Class<T> clazz) {
		return (Constructor<T>[]) clazz.getDeclaredConstructors();
	}

	private static TypeId<?>[] classArrayToTypeArray(Class<?>[] input) {
		TypeId<?>[] result = new TypeId[input.length];
		for (int i = 0; i < input.length; ++i) {
			result[i] = TypeId.get(input[i]);
		}
		return result;
	}
}
