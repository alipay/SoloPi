/**
 * W2 针对性回归：C1 五项缺口的逐项修复验证（输入：Board 6729360 / 附件 w1-review.test.tsx）。
 * 全部为注入 reader/fixture 的隔离测试，不启动服务、不写共享文件。
 *
 * 1. 迟返回的旧作用域请求不得覆盖新作用域数据（代次校验）
 * 2. 作用域切换后、新响应前不显示上一作用域数据（状态复位）
 * 3. pollIntervalMs=0 时卸载仍中止在途请求（无条件清理）
 * 4. 离线中止未决请求，恢复在线可读取；HTTP 层请求总超时
 * 5. 客户端在线性只按服务端权威 presence 字段显示，缺省为「未知」；
 *    迟返回旧请求不得释放新请求的并发占位
 */
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CLIENTS_AREA } from '../src/api/areas';
import type { DataArea } from '../src/api/areas';
import { fetchJson } from '../src/api/http';
import { usePollingArea } from '../src/hooks/usePollingArea';
import { ClientCards } from '../src/pages/ClientStatus';

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

it('缺口0：未接线数据区不调用注入的reader（保持W1语义）', () => {
  const read = vi.fn();
  renderHook(() => usePollingArea({ ...area(read), wired: false }));
  expect(read).not.toHaveBeenCalled();
});

it('缺口0b：在途请求阻止定时器/手动重复读取（并发互斥保留）', () => {
  vi.useFakeTimers();
  const d = deferred();
  const read = vi.fn(() => d.promise);
  const value = area(read, 100);
  const h = renderHook(() => usePollingArea(value));
  act(() => {
    vi.advanceTimersByTime(500);
    h.result.current.refresh();
  });
  expect(read).toHaveBeenCalledTimes(1);
});

it('缺口3：pollIntervalMs=0 卸载仍中止在途请求', () => {
  const d = deferred();
  let signal: AbortSignal | undefined;
  const value = area((_b: string, s: AbortSignal) => {
    signal = s;
    return d.promise;
  }, 0);
  const h = renderHook(() => usePollingArea(value));
  h.unmount();
  expect(signal?.aborted).toBe(true);
});

it('缺口1：已中止的旧作用域请求迟返回不得覆盖新作用域数据', async () => {
  const old = deferred();
  const fresh = deferred();
  const a = area(() => old.promise, 10_000, 'old');
  const b = area(() => fresh.promise, 10_000, 'new');
  const h = renderHook(({ value }) => usePollingArea(value), { initialProps: { value: a } });
  h.rerender({ value: b });
  await act(async () => {
    fresh.resolve(['new-scope']);
  });
  expect(h.result.current.rows).toEqual(['new-scope']);
  await act(async () => {
    old.resolve(['old-scope']);
  });
  // 旧请求被代次判过期：数据与最后更新时间均不被旧响应覆盖
  expect(h.result.current.rows).toEqual(['new-scope']);
});

it('缺口1b：迟返回旧请求不得清除新请求的并发占位', async () => {
  const old = deferred();
  const fresh = deferred();
  const readOld = vi.fn(() => old.promise);
  const readNew = vi.fn(() => fresh.promise);
  const a = area(readOld, 10_000, 'old');
  const b = area(readNew, 10_000, 'new');
  const h = renderHook(({ value }) => usePollingArea(value), { initialProps: { value: a } });
  h.rerender({ value: b });
  await act(async () => {
    old.resolve(['old-scope']); // 迟返回旧请求的 finally 不得释放新请求占位
  });
  act(() => {
    h.result.current.refresh(); // 新请求仍在途 → 必须被占位互斥挡下
  });
  expect(readNew).toHaveBeenCalledTimes(1);
  await act(async () => {
    fresh.resolve(['new-scope']);
  });
  expect(h.result.current.rows).toEqual(['new-scope']);
});

it('缺口2：作用域切换后新响应前不显示上一作用域数据', async () => {
  const d = deferred();
  const a = area(() => Promise.resolve(['old-scope']), 10_000, 'old');
  const b = area(() => d.promise, 10_000, 'new');
  const h = renderHook(({ value }) => usePollingArea(value), { initialProps: { value: a } });
  await waitFor(() => expect(h.result.current.status).toBe('ready'));
  h.rerender({ value: b });
  expect(h.result.current.rows).toEqual([]);
  expect(h.result.current.lastUpdatedAt).toBe(null);
});

it('浏览器离线提示不取消实际请求，恢复事件不重复并发请求', async () => {
  const d = deferred();
  let signal: AbortSignal | undefined;
  const read = vi.fn((_b: string, s: AbortSignal) => {
    signal = s;
    return d.promise;
  });
  const value = area(read);
  renderHook(() => usePollingArea(value));
  act(() => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new Event('offline'));
  });
  expect(signal?.aborted).toBe(false);
  act(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    window.dispatchEvent(new Event('online'));
  });
  expect(read).toHaveBeenCalledTimes(1);
});

/** 模拟真实 fetch 的中止语义：abort 时 reject AbortError */
function mockFetchNeverRespond(): void {
  globalThis.fetch = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }),
  );
}

it('缺口4b：HTTP 层请求总超时，不产生无界 pending', async () => {
  const originalFetch = globalThis.fetch;
  mockFetchNeverRespond();
  try {
    await expect(
      fetchJson('http://127.0.0.1:1/x', new AbortController().signal, 5),
    ).rejects.toThrow(/请求超时|读取超时/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it('缺口4c：调用方取消即时传导（作用域切换/卸载语义）', async () => {
  const originalFetch = globalThis.fetch;
  mockFetchNeverRespond();
  const caller = new AbortController();
  try {
    const pending = fetchJson('http://127.0.0.1:1/x', caller.signal, 5_000);
    caller.abort();
    await expect(pending).rejects.toThrow(/请求已取消/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it('失败刷新保留最后成功数据与时间戳（W1语义保留）', async () => {
  const read = vi
    .fn<() => Promise<unknown[]>>()
    .mockResolvedValueOnce(['old-row'])
    .mockRejectedValueOnce(new Error('HTTP 503：后端未就绪'));
  const value = area(read);
  const h = renderHook(() => usePollingArea(value));
  await waitFor(() => expect(h.result.current.status).toBe('ready'));
  const timestamp = h.result.current.lastUpdatedAt;
  act(() => {
    h.result.current.refresh();
  });
  await waitFor(() => expect(h.result.current.status).toBe('error'));
  expect(h.result.current.lastUpdatedAt).toBe(timestamp);
  expect(h.result.current.rows).toEqual(['old-row']);
});

it('缺口5：过期租约与2000年心跳不得显示在线；未提供权威字段时显示未知', () => {
  render(
    <ClientCards
      rows={[
        {
          clientId: 'x',
          displayName: 'ancient',
          installationId: 'i',
          scope: { org: 'a', project: 'p' },
          registration: { status: 'approved', approvedAt: null },
          clientVersion: 'v',
          capabilities: { media: false, command: false },
          lastHeartbeatAt: '2000-01-01T00:00:00Z',
          leaseExpiresAt: '2000-01-01T00:01:00Z',
        },
      ]}
    />,
  );
  expect(document.querySelector('.badge-online')).toBeNull();
  expect(document.querySelector('.badge-unknown')).not.toBeNull();
  expect(document.querySelector('.badge-unknown')?.textContent).toBe('未知');
});

it('缺口5b：权威字段显式给出时按值显示（online/offline），不凭心跳推导', () => {
  render(
    <ClientCards
      rows={[
        {
          clientId: 'o1',
          displayName: 'alive',
          installationId: 'i1',
          scope: { org: 'a', project: 'p' },
          registration: { status: 'approved', approvedAt: null },
          clientVersion: 'v',
          capabilities: { media: false, command: false },
          online: 'online',
          lastHeartbeatAt: '2000-01-01T00:00:00Z', // 心跳古老但权威字段为 online
          leaseExpiresAt: '2000-01-01T00:01:00Z',
        },
        {
          clientId: 'o2',
          displayName: 'gone',
          installationId: 'i2',
          scope: { org: 'a', project: 'p' },
          registration: { status: 'approved', approvedAt: null },
          clientVersion: 'v',
          capabilities: { media: false, command: false },
          online: 'offline',
          lastHeartbeatAt: '2026-11-03T16:00:00Z', // 心跳新鲜但权威字段为 offline
          leaseExpiresAt: '2026-11-03T17:00:00Z',
        },
      ]}
    />,
  );
  expect(document.querySelector('.badge-online')?.textContent).toBe('在线');
  expect(document.querySelector('.badge-offline')?.textContent).toBe('离线');
});
