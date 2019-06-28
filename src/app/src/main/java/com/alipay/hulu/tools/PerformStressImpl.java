/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * 	http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.alipay.hulu.tools;

import com.alipay.hulu.common.utils.LogUtil;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

public class PerformStressImpl implements IPerformStress {

	private static final String TAG = "PerformStressImpl";
	private static PerformStressImpl instance;

	public static PerformStressImpl getInstanceImpl() {
		if (instance == null) {
			synchronized (PerformStressImpl.class) {
				if (instance == null) {
					instance = new PerformStressImpl();
				}
			}
		}
		return instance;
	}

	ExecutorService cachedThreadPool;
	private AtomicInteger currentCount = new AtomicInteger();
	private volatile int targetCount = 0;
	private int stress = 0;

	PerformStressImpl() {
		cachedThreadPool = Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors());
	}

	public void addOrReduceToTargetThread(int count) {

	}

	public synchronized void performCpuStressByCount(final int stress, int count) {
		this.stress = stress;
		this.targetCount = count;

		if (count > currentCount.get()) {
			for (int i = currentCount.get() + 1; i <= count; i++) {
				LogUtil.d(TAG, "新建一个线程");
                final int finalI = i;
                cachedThreadPool.execute(new Runnable() {
					@Override
					public void run() {
						performCpuStress(finalI);
					}
				});
			}
			currentCount.set(count);
		}

	}

	void performCpuStress(int idx) {
		int base = Integer.MAX_VALUE / 10;
		long start = System.currentTimeMillis();
		for (int i = 0; i < base; i++) {
			// just loop, do nothing
		}

		long end = System.currentTimeMillis();

		LogUtil.d(TAG, "初试计算时长：" + (end - start) + "-- 初试计算值：" + base);
		
		while (idx <= targetCount) {
			long sleep = Math.round((end - start) * (100 - stress) / (float) 100);
			long count = Math.round((base / (float) 100) * stress );

			for (long i = 0; i < count; i++) {
				// just loop, do nothing
			}

			try {
				Thread.sleep(sleep);
			} catch (InterruptedException e) {
				// TODO Auto-generated catch block
				e.printStackTrace();
			}
		}
		LogUtil.d(TAG, "释放一个线程");
		currentCount.decrementAndGet();
	}

	@Override
	public void PerformEntry(int param) {
		// TODO Auto-generated method stub

	}

}
