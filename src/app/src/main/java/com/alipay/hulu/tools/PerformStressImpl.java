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

import android.content.Context;
import android.widget.Toast;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.service.base.ExportService;
import com.alipay.hulu.common.service.base.LocalService;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.shared.display.items.MemoryTools;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

@LocalService
public class PerformStressImpl implements IPerformStress, ExportService {
	public static final String PERFORMANCE_STRESS_CPU_COUNT = "performanceStressCpuCount";
	public static final String PERFORMANCE_STRESS_CPU_PERCENT = "performanceStressCpuPercent";
	public static final String PERFORMANCE_STRESS_MEMORY = "performanceStressMemory";

	private static final String TAG = "PerformStressImpl";

	ExecutorService cachedThreadPool;
	private AtomicInteger currentCount = new AtomicInteger();
	private volatile int targetCount = 0;
	private int stress = 0;
	private int memory = 0;

	@Subscriber(@Param(PERFORMANCE_STRESS_CPU_COUNT))
	public void setTargetCount(int targetCount) {
		if (targetCount == this.targetCount) {
			return;
		}
		this.targetCount = targetCount;
		performCpuStressByCount();
	}

	@Subscriber(@Param(PERFORMANCE_STRESS_CPU_PERCENT))
	public void setStress(int stress) {
		if (stress == this.stress) {
			return;
		}
		this.stress = stress;
		performCpuStressByCount();
	}

	@Subscriber(@Param(PERFORMANCE_STRESS_MEMORY))
	public void setMemory(int memory) {
		if (memory == this.memory) {
			return;
		}
		this.memory = memory;
        performMemoryStress();
    }

    @Override
    public void onCreate(Context context) {
        cachedThreadPool = Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors());
        InjectorService.g().register(this);
    }

    @Override
    public void onDestroy(Context context) {
        cachedThreadPool.shutdownNow();
        InjectorService.g().unregister(this);
    }

	public void addOrReduceToTargetThread(int count) {

	}

    public void performCpuStressByCount() {
        if (targetCount > currentCount.get()) {
            for (int i = 0; i < targetCount - currentCount.get(); i++) {
				LogUtil.d(TAG, "新建一个线程");
                final int finalI = i;
                cachedThreadPool.execute(new Runnable() {
					@Override
					public void run() {
						performCpuStress(finalI);
					}
				});
			}
            currentCount.set(targetCount);
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

	/**
	 * 开始性能加压
	 */
	void performMemoryStress() {
		try {
			this.memory = MemoryTools.dummyMem(memory);
			InjectorService.g().pushMessage(PERFORMANCE_STRESS_MEMORY, memory);
		} catch (OutOfMemoryError e) {
			LauncherApplication.getInstance().showToast("内存不足:" + e.getMessage());
			LogUtil.e(TAG, "Alloc memory throw oom: " + e.getMessage(), e);
		}

	}

	@Override
	public void PerformEntry(int param) {
		// TODO Auto-generated method stub

	}

}
