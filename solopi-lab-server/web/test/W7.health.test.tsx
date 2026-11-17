/**
 * W7 回归：bootstrap交付边界与连接健康度。
 * - 三态横幅：未连接 / 已连接 / denied（401或403后不得显示“已连接”）；
 * - 健康度由真实读取驱动：成功ok、401/403 denied、清除或换身份回untested；
 * - 清除连接后旧fetcher不再被引擎调用（轮询停、无新请求带旧token）。
 */
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CLIENTS_AREA, type DataArea } from '../src/api/areas';
import type { RuntimeConnection } from '../src/api/connection';
import {
  clearRuntimeConnection,
  getConnectionView,
  setRuntimeConnection,
} from '../src/api/connection';
import { createClientsRead } from '../src/api/fetchers-v015';
import { ApiError } from '../src/api/http';
import { useLiveArea } from '../src/hooks/useLiveArea';
import { usePollingArea } from '../src/hooks/usePollingArea';
import { StatusBanner } from '../src/components/StatusBanner';
import type { ClientRecord } from '../src/api/types';

const U = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

afterEach(() => {
  cleanup();
  clearRuntimeConnection();
});

const conn: RuntimeConnection = {
  apiBaseUrl: 'https://127.0.0.1:8791',
  adminToken: 'tok-W7',
  scope: { orgId: U, projectId: U },
};

function denied401(): Promise<ClientRecord[]> {
  return Promise.reject(
    new ApiError(401, 'HTTP 401：token无效', { code: 'AUTH_TOKEN_INVALID', message: 'token无效', retryable: false }),
  );
}

describe('W7 三态横幅', () => {
  it('无连接→未连接横幅（未知）', () => {
    render(<StatusBanner />);
    expect(document.querySelector('[data-testid="unconnected-notice"]')).not.toBeNull();
  });

  it('有连接(untested)→【预期翻转 W8/C13④】不显示已连接，显示待验证横幅（数量未知）', () => {
    expect(setRuntimeConnection(conn)).toBeNull();
    render(<StatusBanner />);
    expect(document.querySelector('[data-testid="connected-notice"]')).toBeNull();
    expect(document.querySelector('[data-testid="waiting-notice"]')).not.toBeNull();
    const text = document.querySelector('[data-testid="waiting-notice"]')?.textContent ?? '';
    expect(text).toMatch(/待验证/);
    expect(text).toMatch(/数量：未知/);
    cleanup();
  });

  it('denied→显示授权失效横幅，不显示“已连接”字样（401/403语义维持）', async () => {
    expect(setRuntimeConnection(conn)).toBeNull();
    // 驱动一次真实401使健康度转denied
    const area: DataArea<ClientRecord> = {
      ...CLIENTS_AREA, key: 'w7-denied', wired: true,
      fetchers: { read: denied401 }, pollIntervalMs: 10_000,
    };
    const h = renderHook(() => usePollingArea(area));
    await waitFor(() => expect(h.result.current.status).toBe('error'));
    expect(getConnectionView().health).toBe('denied');
    cleanup();
    render(<StatusBanner />);
    const banner = document.querySelector('[data-testid="denied-notice"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent ?? '').toMatch(/拒绝访问|数量：未知/);
    expect(banner?.textContent ?? '').not.toMatch(/已连接（只读列表）/);
  });

  it('denied后真实读取成功→恢复已连接横幅', async () => {
    expect(setRuntimeConnection(conn)).toBeNull();
    const area: DataArea<ClientRecord> = {
      ...CLIENTS_AREA, key: 'w7-recover', wired: true,
      fetchers: {
        read: vi
          .fn<() => Promise<ClientRecord[]>>()
          .mockRejectedValueOnce(
            new ApiError(403, 'HTTP 403：越权', { code: 'AUTH_SCOPE_DENIED', message: '越权', retryable: false }),
          )
          .mockResolvedValueOnce([]),
      },
      pollIntervalMs: 10_000,
    };
    const h = renderHook(() => usePollingArea(area));
    await waitFor(() => expect(h.result.current.status).toBe('error'));
    expect(getConnectionView().health).toBe('denied');
    act(() => { h.result.current.refresh(); });
    await waitFor(() => expect(getConnectionView().health).toBe('ok'));
    cleanup();
    render(<StatusBanner />);
    expect(document.querySelector('[data-testid="connected-notice"]')).not.toBeNull();
  });

  it('清除/换身份→健康度回untested', () => {
    expect(setRuntimeConnection(conn)).toBeNull();
    const area: DataArea<ClientRecord> = {
      ...CLIENTS_AREA, key: 'w7-clear', wired: true,
      fetchers: { read: denied401 }, pollIntervalMs: 10_000,
    };
    const h = renderHook(() => usePollingArea(area));
    // 清除连接：健康度复位、不可再写健康状态
    clearRuntimeConnection();
    expect(getConnectionView().connection).toBeNull();
    expect(getConnectionView().health).toBe('untested');
    // markConnectionHealth在无连接时为no-op
    act(() => { h.unmount(); });
    setRuntimeConnection(conn);
    expect(getConnectionView().health).toBe('untested'); // 换身份回到未测
  });
});

describe('W7 清除连接后的fetcher边界（C11要求）', () => {
  it('清除连接后：旧fetcher不再被轮询引擎调用（无新请求携带旧token）', async () => {
    const calls: { auth: string }[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ auth: headers.Authorization ?? '' });
      return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 200, nextPage: null }) } as Response;
    });
    try {
      expect(setRuntimeConnection(conn)).toBeNull();
      const build = (c: RuntimeConnection) => {
        // 工厂内部捕获创建时连接；清除全局store后该闭包若被调用仍会带旧token——
        // 因此轮询引擎必须在连接清除后停止一切调用
        return createClientsRead(c);
      };
      const h = renderHook(() => {
        const area = useLiveArea(CLIENTS_AREA, build);
        const poll = usePollingArea(area);
        return { area, poll };
      });
      await waitFor(() => expect(h.result.current.poll.status).toBe('empty'));
      expect(calls.length).toBe(1);
      expect(calls[0].auth).toBe('Bearer tok-W7');

      act(() => { clearRuntimeConnection(); });
      const unwiredAfterClear = h.result.current.area.wired === false;
      // 等待多个轮询周期（假定时器不可跨hook简单推进：等待真实microtask白噪声）
      await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
      expect(unwiredAfterClear).toBe(true);
      expect(calls.length).toBe(1); // 无任何后续调用（不可能携带旧token）
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('换身份（新token）后：旧连接闭包不被复用，区域key变化复位', async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push(headers.Authorization ?? '');
      return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 200, nextPage: null }) } as Response;
    });
    try {
      expect(setRuntimeConnection(conn)).toBeNull();
      const h = renderHook(() => {
        const area = useLiveArea(CLIENTS_AREA, (c) => createClientsRead(c));
        return usePollingArea(area);
      });
      await waitFor(() => expect(h.result.current.status).toBe('empty'));
      expect(calls[0]).toBe('Bearer tok-W7');
      const before = h.result.current.lastUpdatedAt;
      act(() => {
        expect(
          setRuntimeConnection({ ...conn, adminToken: 'tok-W7-new' }),
        ).toBeNull();
      });
      await waitFor(() => expect(h.result.current.status).toBe('empty'));
      expect(h.result.current.lastUpdatedAt).not.toBe(before); // 新请求发生
      expect(calls.some((c) => c === 'Bearer tok-W7-new')).toBe(true);
      // 旧token仅出现在清除前的历史调用中，新请求不重复带旧值
      expect(calls.filter((c) => c === 'Bearer tok-W7').length).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
