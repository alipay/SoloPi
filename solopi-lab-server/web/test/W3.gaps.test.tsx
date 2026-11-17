/**
 * W3 针对性回归：C6（客户端对W2的独立复核，Board 6733198）三失败的修复验证。
 * 输入为客户侧独立测试原样复放（w2-independent.test.tsx）确认的三个缺口：
 *
 * 1. 超时只 abort 而不失效代次/释放占位——忽略 AbortSignal 的 reader 永久 loading；
 * 2. 该类 reader 迟返回仍能回写 rows/lastUpdatedAt/错误态；
 * 3. http.fetchJson 输入 signal 预先已 abort 时仍发起 fetch。
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CLIENTS_AREA } from '../src/api/areas';
import { fetchJson } from '../src/api/http';
import { usePollingArea } from '../src/hooks/usePollingArea';
import type { DataArea } from '../src/api/areas';

const deferred = () => {
  let resolve!: (v: unknown[]) => void;
  const promise = new Promise<unknown[]>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

type TestRead = (base: string, signal: AbortSignal) => Promise<unknown[]>;

const area = (read: TestRead, ms = 10_000, key = 'a'): DataArea<unknown> => ({
  ...CLIENTS_AREA,
  key,
  wired: true,
  fetchers: { read },
  pollIntervalMs: ms,
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

it('W3-1 超时使代次失效并释放占位：忽略signal的reader转入error且可重试', async () => {
  vi.useFakeTimers();
  const d = deferred();
  const read = vi.fn(() => d.promise); // 完全忽略 AbortSignal 的reader
  const value = { ...area(read, 0), requestTimeoutMs: 20 };
  const h = renderHook(() => usePollingArea(value));
  await act(async () => {
    vi.advanceTimersByTime(21);
  });
  expect(h.result.current.status).toBe('error');
  expect(h.result.current.refreshing).toBe(false);
  act(() => {
    h.result.current.refresh();
  });
  expect(read).toHaveBeenCalledTimes(2); // 占位已被超时释放
  vi.useRealTimers();
});

it('W3-2 超时后迟成功不回写rows/lastUpdatedAt（状态不被旧响应复活）', async () => {
  vi.useFakeTimers();
  const d = deferred();
  const value = { ...area(() => d.promise, 0), requestTimeoutMs: 20 };
  const h = renderHook(() => usePollingArea(value));
  await act(async () => {
    vi.advanceTimersByTime(21);
  });
  await act(async () => {
    d.resolve(['late-after-timeout']);
  });
  expect(h.result.current.rows).toEqual([]);
  expect(h.result.current.lastUpdatedAt).toBe(null);
  vi.useRealTimers();
});

it('W3-2b 超时后迟失败也不清除已提示的错误信息', async () => {
  vi.useFakeTimers();
  const rejectDeferred = () => {
    // eslint 友好：显式构造可拒绝的挂起promise
    let reject!: (e: unknown) => void;
    const promise = new Promise<unknown[]>((_res, rej) => {
      reject = rej;
    });
    void promise.catch(() => undefined); // 抑制未处理拒绝
    return { promise, reject };
  };
  const d = rejectDeferred();
  const value = { ...area(() => d.promise, 0), requestTimeoutMs: 20 };
  const h = renderHook(() => usePollingArea(value));
  await act(async () => {
    vi.advanceTimersByTime(21);
  });
  const errBefore = h.result.current.error;
  expect(errBefore).toMatch(/超时/);
  await act(async () => {
    d.reject(new Error('late-network-failure'));
  });
  expect(h.result.current.error).toBe(errBefore); // 迟拒绝不覆盖超时语义
  vi.useRealTimers();
});

it('W3-3 预aborted调用方signal：fetchJson直接取消，不发起fetch（计数为0）', async () => {
  const originalFetch = globalThis.fetch;
  const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ unexpected: true }) }) as Response);
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  const caller = new AbortController();
  caller.abort();
  try {
    await expect(fetchJson('/never-network', caller.signal, 100)).rejects.toThrow(/请求已取消/);
    expect(fetchSpy).not.toHaveBeenCalled(); // 更严：一次网络请求都不能发
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it('W3-4 超时释放占位后，轮询定时器下一轮能重新读取', async () => {
  vi.useFakeTimers();
  const read = vi.fn(() => new Promise<unknown[]>(() => undefined)); // 永不settles且忽略signal
  const value = { ...area(read, 100), requestTimeoutMs: 20 };
  renderHook(() => usePollingArea(value));
  await act(async () => {
    vi.advanceTimersByTime(110);
  });
  expect(read.mock.calls.length).toBeGreaterThanOrEqual(2); // 超时释放后被轮询重试
  vi.useRealTimers();
});

it('W3-5 正常路径回归：可用reader在超时窗口内完成时不受影响', async () => {
  const read = vi.fn(() => Promise.resolve(['ok-row']));
  const value = { ...area(read, 0), requestTimeoutMs: 5_000 };
  const h = renderHook(() => usePollingArea(value));
  await act(async () => {
    await Promise.resolve();
  });
  expect(h.result.current.status).toBe('ready');
  expect(h.result.current.rows).toEqual(['ok-row']);
  expect(h.result.current.error).toBeNull();
});
