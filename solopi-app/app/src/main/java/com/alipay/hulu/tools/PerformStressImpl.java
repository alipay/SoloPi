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

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.service.base.ExportService;
import com.alipay.hulu.common.service.base.LocalService;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.RuntimeSessionGuard;
import com.alipay.hulu.shared.display.items.MemoryTools;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicInteger;

@LocalService
public class PerformStressImpl implements ExportService {
	public static final String PERFORMANCE_STRESS_CPU_COUNT = "performanceStressCpuCount";
	public static final String PERFORMANCE_STRESS_CPU_PERCENT = "performanceStressCpuPercent";
	public static final String PERFORMANCE_STRESS_MEMORY = "performanceStressMemory";

	private static final String TAG = "PerformStressImpl";
	private static final String RUNTIME_SESSION_OWNER = "stress-load";
	private static final String MAINTENANCE_BLOCKED_ERROR =
			"Plugin maintenance prevents starting CPU or memory stress";

	ExecutorService cachedThreadPool;
	private final Object cpuWorkerLock = new Object();
	private final Map<Integer, CpuWorker> cpuWorkers = new HashMap<>();
	private final AtomicInteger currentCount = new AtomicInteger();
	private volatile int targetCount = 0;
	private volatile int stress = 0;
	private volatile int targetMemory = 0;
	private volatile int memory = 0;
	private volatile boolean shuttingDown;
	private volatile String lastLoadError;
	private boolean runtimeSessionHeld;

	@Subscriber(@Param(PERFORMANCE_STRESS_CPU_COUNT))
	public void setTargetCount(int targetCount) {
		synchronized (cpuWorkerLock) {
			if (shuttingDown) {
				this.targetCount = 0;
				return;
			}
			int requestedCount = Math.max(0, targetCount);
			if (requestedCount > 0 && !acquireRuntimeSessionLocked()) {
				this.targetCount = 0;
				reconcileCpuWorkersLocked();
				return;
			}
			this.targetCount = requestedCount;
			reconcileCpuWorkersLocked();
			releaseRuntimeSessionIfIdleLocked();
		}
	}

	@Subscriber(@Param(PERFORMANCE_STRESS_CPU_PERCENT))
	public void setStress(int stress) {
		synchronized (cpuWorkerLock) {
			if (shuttingDown) {
				this.stress = 0;
				return;
			}
			this.stress = stress;
			reconcileCpuWorkersLocked();
		}
	}

	@Subscriber(@Param(PERFORMANCE_STRESS_MEMORY))
	public synchronized void setMemory(int memory) {
		final int previousTarget;
		final boolean rejected;
		synchronized (cpuWorkerLock) {
			if (shuttingDown) {
				this.targetMemory = 0;
				return;
			}
			previousTarget = this.targetMemory;
			rejected = memory > 0 && !acquireRuntimeSessionLocked();
			// 非零目标本身就是占用预留，必须与守卫申请在同一个临界区内发布。
			this.targetMemory = rejected ? 0 : memory;
		}
		if (rejected) {
			if (this.memory != 0) {
				try {
					this.memory = MemoryTools.dummyMem(0);
				} catch (RuntimeException | OutOfMemoryError e) {
					this.memory = 0;
					LogUtil.w(TAG, "Unable to clear rejected memory stress", e);
				}
			}
			return;
		}
		if (memory == previousTarget && (memory != 0 || this.memory == 0)) {
			releaseRuntimeSessionIfIdle();
			return;
		}
        performMemoryStress();
		releaseRuntimeSessionIfIdle();
    }

	/**
	 * 内存不足时调整一下内存数据
	 */
	@Subscriber(@Param(value = LauncherApplication.ON_TRIM_MEMORY, sticky = false))
	public void onTrimMemory() {
		LogUtil.w(TAG, "Urgent!!!!, lower memory");
		if (memory > 0) {
			int newMemory = (int) (memory * 0.8);
			notifyMemoryTarget(newMemory);
		}
	}

	@Override
	public void onCreate(Context context) {
		synchronized (cpuWorkerLock) {
			shuttingDown = false;
			cpuWorkers.clear();
			currentCount.set(0);
			runtimeSessionHeld = false;
			lastLoadError = null;
			cachedThreadPool = Executors.newFixedThreadPool(
					Runtime.getRuntime().availableProcessors());
		}
		InjectorService.g().register(this);
	}

	@Override
	public synchronized void onDestroy(Context context) {
		ExecutorService executor;
		synchronized (cpuWorkerLock) {
			shuttingDown = true;
			targetCount = 0;
			stress = 0;
			targetMemory = 0;
			for (CpuWorker worker : cpuWorkers.values()) {
				worker.requestStop();
			}
			cpuWorkers.clear();
			currentCount.set(0);
			runtimeSessionHeld = false;
			executor = cachedThreadPool;
			cachedThreadPool = null;
		}
		try {
			targetMemory = 0;
			memory = MemoryTools.dummyMem(0);
		} catch (RuntimeException | OutOfMemoryError e) {
			memory = 0;
			LogUtil.w(TAG, "Unable to release stress memory during shutdown", e);
		}
		if (executor != null) {
			executor.shutdownNow();
		}
		RuntimeSessionGuard.endSession(RUNTIME_SESSION_OWNER);
		InjectorService.g().unregister(this);
	}

	/** 当前要求保留的 CPU 压力线程数。 */
	public int getTargetCpuCount() {
		return targetCount;
	}

	/** 当前仍在运行或等待退出的 CPU 压力线程数。 */
	public int getActiveCpuCount() {
		return currentCount.get();
	}

	/** 当前 CPU 压力占比。 */
	public int getCpuPercent() {
		return stress;
	}

	/** 当前请求保留的内存负载，单位 MB。 */
	public int getTargetMemoryMb() {
		return targetMemory;
	}

	/** native 层实际持有的内存负载，单位 MB。 */
	public int getMemoryLoadMb() {
		return memory;
	}

	/** 最近一次非零负载被拒绝的明确原因；成功取得守卫后会清空。 */
	public String getLastLoadError() {
		return lastLoadError;
	}

	/** 插件维护持有独占门闩时，新的压力负载必须保持为 0。 */
	public boolean isLoadBlockedByMaintenance() {
		return RuntimeSessionGuard.isMaintenanceActive();
	}

	public void performCpuStressByCount() {
		synchronized (cpuWorkerLock) {
			reconcileCpuWorkersLocked();
		}
	}

	/**
	 * 每个目标 CPU 槽位最多对应一个 Worker。缩容时停止超出目标的槽位，扩容时只补缺失槽位，
	 * 避免 2 -> 4 时重复创建 0/1 号 Worker，继而导致 4 -> 2 无法退出。
	 */
	private void reconcileCpuWorkersLocked() {
		if (shuttingDown) {
			return;
		}

		for (CpuWorker worker : cpuWorkers.values()) {
			if (worker.slot >= targetCount) {
				worker.requestStop();
			} else {
				worker.keepRunning = true;
			}
		}

		ExecutorService executor = cachedThreadPool;
		if (executor == null || executor.isShutdown()) {
			if (targetCount > 0) {
				failCpuWorkerStartLocked("CPU stress executor is unavailable");
			}
			currentCount.set(cpuWorkers.size());
			return;
		}
		for (int slot = 0; slot < targetCount; slot++) {
			if (cpuWorkers.containsKey(slot)) {
				continue;
			}
			LogUtil.d(TAG, "新建 CPU 压力线程，槽位=" + slot);
			CpuWorker worker = new CpuWorker(slot);
			cpuWorkers.put(slot, worker);
			currentCount.set(cpuWorkers.size());
			try {
				executor.execute(worker);
			} catch (RejectedExecutionException e) {
				cpuWorkers.remove(slot);
				currentCount.set(cpuWorkers.size());
				failCpuWorkerStartLocked("Unable to start CPU stress worker");
				LogUtil.w(TAG, "CPU 压力线程提交失败", e);
				break;
			}
		}
	}

	private void failCpuWorkerStartLocked(String reason) {
		lastLoadError = reason;
		targetCount = 0;
		stress = 0;
		for (CpuWorker worker : cpuWorkers.values()) {
			worker.requestStop();
		}
		releaseRuntimeSessionIfIdleLocked();
	}

	private boolean shouldWorkerRun(CpuWorker worker) {
		synchronized (cpuWorkerLock) {
			return !shuttingDown
					&& worker.keepRunning
					&& worker.slot < targetCount
					&& cpuWorkers.get(worker.slot) == worker;
		}
	}

	private void onWorkerFinished(CpuWorker worker) {
		synchronized (cpuWorkerLock) {
			if (cpuWorkers.get(worker.slot) == worker) {
				cpuWorkers.remove(worker.slot);
			}
			currentCount.set(cpuWorkers.size());
			// 目标可能在旧 Worker 退出的同时再次增大；退出后立即补齐缺失槽位。
			reconcileCpuWorkersLocked();
			releaseRuntimeSessionIfIdleLocked();
		}
	}

	private boolean acquireRuntimeSessionLocked() {
		if (runtimeSessionHeld) {
			return true;
		}
		if (!RuntimeSessionGuard.beginSession(RUNTIME_SESSION_OWNER)) {
			lastLoadError = MAINTENANCE_BLOCKED_ERROR;
			targetCount = 0;
			stress = 0;
			targetMemory = 0;
			reconcileCpuWorkersLocked();
			LogUtil.w(TAG, MAINTENANCE_BLOCKED_ERROR);
			return false;
		}
		runtimeSessionHeld = true;
		lastLoadError = null;
		return true;
	}

	private void releaseRuntimeSessionIfIdle() {
		synchronized (cpuWorkerLock) {
			releaseRuntimeSessionIfIdleLocked();
		}
	}

	private void releaseRuntimeSessionIfIdleLocked() {
		if (runtimeSessionHeld && targetCount == 0 && currentCount.get() == 0
				&& targetMemory == 0 && memory == 0) {
			runtimeSessionHeld = false;
			RuntimeSessionGuard.endSession(RUNTIME_SESSION_OWNER);
		}
	}

	private final class CpuWorker implements Runnable {
		final int slot;
		volatile boolean keepRunning = true;
		volatile Thread runningThread;

		CpuWorker(int slot) {
			this.slot = slot;
		}

		void requestStop() {
			keepRunning = false;
			Thread thread = runningThread;
			if (thread != null) {
				thread.interrupt();
			}
		}

		@Override
		public void run() {
			runningThread = Thread.currentThread();
			try {
				performCpuStress(this);
			} finally {
				runningThread = null;
				onWorkerFinished(this);
			}
		}
	}

	private void performCpuStress(CpuWorker worker) {
		int base = Integer.MAX_VALUE / 10;
		long start = System.currentTimeMillis();
		for (int i = 0; i < base; i++) {
			if ((i & 0xFFFFF) == 0 && !shouldWorkerRun(worker)) {
				return;
			}
		}

		long end = System.currentTimeMillis();
		long baseDuration = Math.max(1L, end - start);

		LogUtil.d(TAG, "初试计算时长：" + baseDuration + "-- 初试计算值：" + base);

		while (shouldWorkerRun(worker)) {
			int currentStress = stress;
			long sleep = Math.round(baseDuration * (100 - currentStress) / (float) 100);
			long count = Math.round((base / (float) 100) * currentStress);

			for (long i = 0; i < count; i++) {
				if ((i & 0x3FFFFL) == 0L && !shouldWorkerRun(worker)) {
					return;
				}
			}

			try {
				if (sleep > 0L) {
					Thread.sleep(sleep);
				} else {
					Thread.yield();
				}
			} catch (InterruptedException e) {
				if (!shouldWorkerRun(worker)) {
					return;
				}
			}
		}
	}

	/**
	 * 开始性能加压
	 */
	void performMemoryStress() {
		int requestedMemory = targetMemory;
		try {
			int actualMemory = MemoryTools.dummyMem(requestedMemory);
			this.memory = actualMemory;
			if (actualMemory != requestedMemory) {
				synchronized (cpuWorkerLock) {
					this.targetMemory = actualMemory;
				}
				notifyMemoryTarget(actualMemory);
			}
		} catch (OutOfMemoryError e) {
			LauncherApplication.getInstance().showToast("内存不足:" + e.getMessage());
			LogUtil.e(TAG, "Alloc memory throw oom: " + e.getMessage(), e);
			synchronized (cpuWorkerLock) {
				this.targetMemory = 0;
			}
			try {
				this.memory = MemoryTools.dummyMem(0);
			} catch (RuntimeException | OutOfMemoryError releaseError) {
				this.memory = 0;
				LogUtil.w(TAG, "Unable to release memory after allocation failure", releaseError);
			}
			notifyMemoryTarget(0);
		} catch (RuntimeException e) {
			LogUtil.e(TAG, "Alloc memory stress failed: " + e.getMessage(), e);
			synchronized (cpuWorkerLock) {
				this.targetMemory = 0;
			}
			try {
				this.memory = MemoryTools.dummyMem(0);
			} catch (RuntimeException | OutOfMemoryError releaseError) {
				this.memory = 0;
				LogUtil.w(TAG, "Unable to release memory after stress failure", releaseError);
			}
			notifyMemoryTarget(0);
		}

	}

	private void notifyMemoryTarget(int target) {
		try {
			InjectorService injector = InjectorService.g();
			if (injector != null) {
				injector.pushMessage(PERFORMANCE_STRESS_MEMORY, target);
			}
		} catch (RuntimeException e) {
			LogUtil.w(TAG, "Unable to publish adjusted memory stress", e);
		}
	}
}
