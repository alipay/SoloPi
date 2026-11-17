/**
 * W8 修复后断言（对应C13四阻塞，全部为“缺陷应以修复后行为为预期”的正向断言）：
 * ① 旧fetcher直接调用：出网计数=0（发请求前按代次/身份拒绝），挂载轮询取消之外的独立保证；
 * ② 显式断开base与全部身份/token输入清空、rows/时间随之清；
 * ③ bootstrap发起时捕获代次：clear/手工配置后迟到结果不覆盖/不恢复；
 * ④ untested仅显示待验证/数量未知，成功读取后绿色已连接，401/403继续失效。
 * 原样复放脚本（C13 runner w5/w6/w7-health 三文件）中四个“缺陷存在”用例此时应翻转为失败；
 * 本文件给出修复后的明确预期。普通暂时网络失败保留陈旧数据语义（不与显式断开混淆）。
 */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CLIENTS_AREA, type DataArea } from '../src/api/areas';
import {
  clearRuntimeConnection,
  getConnectionView,
  getRuntimeConnection,
  setRuntimeConnection,
  type RuntimeConnection,
} from '../src/api/connection';
import { createClientsRead } from '../src/api/fetchers-v015';
import { ApiError } from '../src/api/http';
import { StatusBanner } from '../src/components/StatusBanner';
import { ConnectionPanel } from '../src/components/ConnectionPanel';
import { useLiveArea } from '../src/hooks/useLiveArea';
import { usePollingArea } from '../src/hooks/usePollingArea';
import type { ClientRecord } from '../src/api/types';
import App from '../src/App';

const U = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const summary: ClientRecord = {
  clientId: U, displayName: 'd', installationId: U,
  scope: { org: U, project: U }, registration: { status: 'approved', approvedAt: '2026-11-03T16:00:00Z' },
  clientVersion: '0', capabilities: { media: false, command: false }, online: 'unknown',
  lastHeartbeatAt: null, leaseExpiresAt: null,
};

const cfg: RuntimeConnection = {
  apiBaseUrl: 'https://review.invalid',
  adminToken: 'synthetic-review-token',
  scope: { orgId: U, projectId: U },
  orgKey: 'review-org',
  projectKey: 'review-project',
};

afterEach(() => {
  cleanup();
  clearRuntimeConnection();
  vi.unstubAllGlobals();
});

describe('W8-① 旧fetcher准入（直接调用也不得发旧token）', () => {
  it('clear后调用持有的旧read：被前门拒绝，fetch出网计数=0', async () => {
    expect(setRuntimeConnection(cfg)).toBeNull();
    const read = createClientsRead(getRuntimeConnection()!);
    clearRuntimeConnection();
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ items: [], page: 1, pageSize: 200, nextPage: null }) }) as Response);
    vi.stubGlobal('fetch', fetchSpy);
    await expect(read('', new AbortController().signal)).rejects.toThrow(/连接已清除或已更换身份/);
    expect(fetchSpy).not.toHaveBeenCalled(); // 出网计数 0
  });

  it('换身份后调用旧read：同样拒绝出网；新read正常工作并带新token', async () => {
    expect(setRuntimeConnection(cfg)).toBeNull();
    const oldRead = createClientsRead(getRuntimeConnection()!);
    const newCfg: RuntimeConnection = { ...cfg, adminToken: 'token-B' };
    expect(setRuntimeConnection(newCfg)).toBeNull(); // 换身份（代次+身份变更）
    const newRead = createClientsRead(getRuntimeConnection()!);
    const fetchSpy = vi.fn(async (_input: unknown, init?: RequestInit) => {
      void init;
      return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 200, nextPage: null }) } as Response;
    });
    vi.stubGlobal('fetch', fetchSpy);
    await expect(oldRead('', new AbortController().signal)).rejects.toThrow(/连接已清除或已更换身份/);
    expect(fetchSpy).not.toHaveBeenCalled();
    await newRead('', new AbortController().signal);
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-B');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('分页中途换身份：后续页不再出网（单页即中断）', async () => {
    expect(setRuntimeConnection(cfg)).toBeNull();
    const read = createClientsRead(getRuntimeConnection()!);
    const fetchSpy = vi.fn(async (_input: unknown, init?: RequestInit) => {
      // 第一页返回有nextPage，使分页循环继续
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers.Authorization === 'Bearer synthetic-review-token') {
        return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 200, nextPage: 2 }) } as Response;
      }
      return { ok: true, json: async () => ({ items: [], page: 2, pageSize: 200, nextPage: null }) } as Response;
    });
    vi.stubGlobal('fetch', fetchSpy);
    const result = read('', new AbortController().signal);
    // 单个microtask后（第一页在途、未消费）中途换身份——不能用act（其会drain整个分页循环）
    await Promise.resolve();
    expect(setRuntimeConnection({ ...cfg, adminToken: 'token-C' })).toBeNull();
    const err: unknown = await result.catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/连接已清除或已更换身份/);
    expect(fetchSpy.mock.calls.length).toBe(1); // 仅第一页发出，第二页被准入拒绝
  });
});

describe('W8-② 显式断开清全部输入', () => {
  it('clear后：base/ULID/标签/token输入全部为空', () => {
    expect(setRuntimeConnection(cfg)).toBeNull();
    render(<ConnectionPanel onClose={() => undefined} />);
    fireEvent.click(screen.getByText('清除配置'));
    expect(getRuntimeConnection()).toBeNull();
    expect(screen.queryByDisplayValue('https://review.invalid')).toBeNull();
    expect(screen.queryByDisplayValue(U)).toBeNull();
    expect(screen.queryByDisplayValue('review-org')).toBeNull();
    expect(screen.queryByDisplayValue('review-project')).toBeNull();
    const stateText = screen.getByTestId('connection-state').textContent ?? '';
    expect(stateText).toMatch(/未配置/);
  });

  it('clear后rows/时间随数据区回未接线清空（与W6语义一致）', async () => {
    expect(setRuntimeConnection(cfg)).toBeNull();
    const h = renderHook(() => usePollingArea(useLiveArea(CLIENTS_AREA, (c) => createClientsRead(c))));
    await waitFor(() => expect(h.result.current.status).not.toBe('loading'));
    act(() => { clearRuntimeConnection(); });
    expect(h.result.current.status).toBe('not-wired');
    expect(h.result.current.rows).toEqual([]);
    expect(h.result.current.lastUpdatedAt).toBeNull();
  });

  it('普通暂时网络失败≠显式断开：保留陈旧数据（语义不混淆）', async () => {
    expect(setRuntimeConnection(cfg)).toBeNull();
    const area: DataArea<ClientRecord> = {
      ...CLIENTS_AREA, key: 'w8-503', wired: true,
      fetchers: {
        read: vi
          .fn<() => Promise<ClientRecord[]>>()
          .mockResolvedValueOnce([summary])
          .mockRejectedValueOnce(new Error('HTTP 503：暂时不可用')),
      },
      pollIntervalMs: 10_000,
    };
    const h = renderHook(() => usePollingArea(area));
    await waitFor(() => expect(h.result.current.status).toBe('ready'));
    act(() => { h.result.current.refresh(); });
    await waitFor(() => expect(h.result.current.status).toBe('error'));
    expect(h.result.current.rows.length).toBe(1); // 陈旧保留
    expect(getConnectionView().health).not.toBe('denied'); // 5xx不算授权失效
  });
});

describe('W8-③ 迟到bootstrap不覆盖/不恢复', () => {
  it('用户clear后迟到bootstrap：不恢复连接', async () => {
    let resolve!: (v: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { resolve = r; })));
    expect(setRuntimeConnection(cfg)).toBeNull();
    render(<App />);
    act(() => { clearRuntimeConnection(); });
    await act(async () => { resolve({ ok: true, json: async () => cfg } as Response); });
    expect(getRuntimeConnection()).toBeNull(); // 不恢复
  });

  it('用户手工配置后迟到bootstrap：不覆盖手工配置', async () => {
    let resolve!: (v: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { resolve = r; })));
    render(<App />);
    const manual: RuntimeConnection = { ...cfg, adminToken: 'manual-token-w8' };
    act(() => { expect(setRuntimeConnection(manual)).toBeNull(); });
    await act(async () => { resolve({ ok: true, json: async () => cfg } as Response); });
    expect(getRuntimeConnection()?.adminToken).toBe('manual-token-w8'); // 手工配置保持
  });

  it('无扰动时bootstrap照常注入（代次捕获不破坏正常路径）', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/dev-connection.json')
        ? ({ ok: true, json: async () => cfg } as Response)
        : ({ ok: false, status: 404, json: async () => ({}) }) as Response,
    ));
    render(<App />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(getRuntimeConnection()?.scope.orgId).toBe(U);
    expect(document.body.textContent ?? '').not.toContain('synthetic-review-token');
  });
});

describe('W8-④ untested横幅=待验证', () => {
  it('未读取时：待验证横幅，不出现“已连接”', () => {
    expect(setRuntimeConnection(cfg)).toBeNull();
    render(<StatusBanner />);
    expect(document.querySelector('[data-testid="waiting-notice"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="connected-notice"]')).toBeNull();
    const text = document.querySelector('[data-testid="waiting-notice"]')?.textContent ?? '';
    expect(text).toMatch(/待验证/);
    expect(text).toMatch(/数量：未知/);
  });

  it('成功读取→绿色已连接；401→denied（不再“已连接”）', async () => {
    expect(setRuntimeConnection(cfg)).toBeNull();
    const area: DataArea<ClientRecord> = {
      ...CLIENTS_AREA, key: 'w8-h', wired: true,
      fetchers: {
        read: vi
          .fn<() => Promise<ClientRecord[]>>()
          .mockResolvedValueOnce([])
          .mockRejectedValueOnce(new ApiError(401, 'HTTP 401', { code: 'AUTH_TOKEN_INVALID', message: 'x', retryable: false })),
      },
      pollIntervalMs: 10_000,
    };
    const h = renderHook(() => usePollingArea(area));
    await waitFor(() => expect(h.result.current.status).toBe('empty'));
    expect(getConnectionView().health).toBe('ok');
    act(() => { h.result.current.refresh(); });
    await waitFor(() => expect(getConnectionView().health).toBe('denied'));
    render(<StatusBanner />);
    expect(document.querySelector('[data-testid="denied-notice"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="connected-notice"]')).toBeNull();
  });
});
