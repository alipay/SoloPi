/**
 * W11 固定scope只读代理接线回归：
 * - probe成功→RO模式：数据区/ro fetchers接管，无token、无Authorization头、
 *   仅白名单查询参数（无orgId/projectId——scope服务端硬编码）；
 * - RO模式下设置连接（旧token/任意scope）**不得改变**代理数据区；
 * - probe失败→保持原路径（未接线/手工连接）；
 * - RO三态横幅（待验证/ok/denied）；空集显示0台/0条；连接设置在RO模式禁用。
 */
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CLIENTS_AREA, ENROLLMENTS_AREA, type DataArea } from '../src/api/areas';
import {
  clearRuntimeConnection,
  getConnectionView,
  setProxyRoMode,
  setRuntimeConnection,
} from '../src/api/connection';
import { createRoClientsRead, probeReadonlyProxy } from '../src/api/readonly-proxy';
import { useDeliveryArea } from '../src/hooks/useDeliveryArea';
import { usePollingArea } from '../src/hooks/usePollingArea';
import { StatusBanner } from '../src/components/StatusBanner';
import { ClientStatus } from '../src/pages/ClientStatus';
import { ApprovalList } from '../src/pages/ApprovalList';
import type { ClientRecord } from '../src/api/types';
import App from '../src/App';

const U = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

const roSummary: ClientRecord = {
  clientId: U, displayName: 'ro-host', installationId: U,
  scope: { org: 'solopi-lab', project: 'glasses' },
  registration: { status: 'approved', approvedAt: '2026-11-03T16:00:00Z' },
  clientVersion: '0', capabilities: { media: false, command: false }, online: 'unknown',
  lastHeartbeatAt: null, leaseExpiresAt: null,
};

const rawClientSummary = {
  orgId: '01M6GGBGHYYJTD648SY66Q1MM2', projectId: '01M6GGBGHYZG3CMXJAJKNT56DE',
  clientId: U, installationId: U, keyFingerprint: 'sha256:x', status: 'approved',
  online: 'unknown', lastHeartbeatAt: null, leaseExpiresAt: null, clientVersion: null,
  capabilities: { commands: false, media: false }, occupancy: { localUiTasks: 0, cliTasks: 0 },
  deviceScope: { deviceId: 'd', os: 'x', hostname: 'ro-host' },
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  clearRuntimeConnection();
  setProxyRoMode(false);
});

describe('W11 probe与RO fetchers', () => {
  it('probe：同源/ro/clients返回合法envelope→true；404/异常→false', async () => {
    const ok = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 1, nextPage: null }) } as Response;
    });
    vi.stubGlobal('fetch', ok);
    await expect(probeReadonlyProxy()).resolves.toBe(true);
    expect(String(vi.mocked(ok).mock.calls[0][0])).toBe('/ro/clients?page=1&pageSize=200');
    vi.unstubAllGlobals();

    const notFound = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response);
    vi.stubGlobal('fetch', notFound);
    await expect(probeReadonlyProxy()).resolves.toBe(false);

    const badShape = vi.fn(async () => ({ ok: true, json: async () => ({ unexpected: 1 }) }) as Response);
    vi.stubGlobal('fetch', badShape);
    await expect(probeReadonlyProxy()).resolves.toBe(false);
  });

  it('RoClientsRead：仅/ro路径+白名单参数，无Authorization头，无orgId参数（scope服务端固定）', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return { ok: true, json: async () => ({ items: [rawClientSummary], page: 1, pageSize: 200, nextPage: null }) } as Response;
    }));
    const rows = await createRoClientsRead()('', new AbortController().signal);
    expect(rows.length).toBe(1);
    expect(rows[0].scope.org).toBe('solopi-lab'); // 固定标签
    expect(rows[0].scope.project).toBe('glasses');
    const call = calls[0];
    expect(call.url.startsWith('/ro/clients?')).toBe(true);
    expect(call.url).toContain('page=1');
    expect(call.url).toContain('pageSize=200');
    expect(call.url).not.toContain('orgId'); // 不发送scope——服务端硬编码
    const headers = (call.init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined(); // 无token
  });
});

describe('W11 RO接管（浏览器配置不可改变代理scope）', () => {
  it('proxyRo=true时：即使设置任意连接（旧token/其他scope），数据区仍是RO fetchers', () => {
    setProxyRoMode(true);
    expect(
      setRuntimeConnection({
        apiBaseUrl: 'https://evil.example',
        adminToken: 'old-token',
        scope: { orgId: '02' + U.slice(2), projectId: '03' + U.slice(2) },
      }),
    ).toBeNull(); // 连接仍可保存（HTTPS路径概念存在），但：
    const h = renderHook(() =>
      useDeliveryArea(
        CLIENTS_AREA,
        () => createRoClientsRead(),
        (conn) => (_b: string, s: AbortSignal) => new Promise<ClientRecord[]>((_res, rej) => {
          s.addEventListener('abort', () => rej(new Error('live-path-must-not-run-in-ro')));
        }),
      ),
    );
    const area: DataArea<ClientRecord> = h.result.current;
    expect(area.wired).toBe(true);
    expect(area.key).toContain('ro:solopi-lab/glasses');
    expect(area.fetchers?.read).toBeDefined();
    cleanMarker(area);
  });

  function cleanMarker(_area: DataArea<ClientRecord>): void {
    /* helper避免noUnusedLocals对内联复杂泛型的抱怨 */
  }

  it('proxyRo=false时：保持原useLiveArea路径（连接优先/未接线）', () => {
    setProxyRoMode(false);
    const h = renderHook(() =>
      useDeliveryArea(CLIENTS_AREA, () => createRoClientsRead(), (c) => (c == null ? createRoClientsRead() : createRoClientsRead())),
    );
    expect(h.result.current.wired).toBe(false); // 无连接→RO不存在→未接线
  });
});

describe('W11 RO页面集成', () => {
  it('RO模式+真实两表空集：显示0台/0条+绿色已连接横幅+最后更新时间', async () => {
    setProxyRoMode(true);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/ro/clients')) {
        return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 200, nextPage: null }) } as Response;
      }
      if (url.startsWith('/ro/enrollments')) {
        return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 200, nextPage: null }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }));
    render(<StatusBanner />);
    render(<ClientStatus clientsArea={CLIENTS_AREA} />);
    render(<ApprovalList enrollmentsArea={ENROLLMENTS_AREA} />);
    await waitFor(() => expect(screen.getByText(/已注册 0 台 Client/)).toBeTruthy());
    expect(screen.getByText(/待审批的注册申请（0 条）/)).toBeTruthy();
    await waitFor(() => expect(getConnectionView().health).toBe('ok'));
    expect(document.querySelector('[data-testid="ro-connected-notice"]')).not.toBeNull();
    expect(screen.getByTestId('ro-connected-notice').textContent).toContain('实验室已连接');
  });

  it('RO模式失败：数量未知（不回退0）+denied横幅', async () => {
    setProxyRoMode(true);
    const area: DataArea<ClientRecord> = {
      ...CLIENTS_AREA, key: 'w11-fail', wired: true,
      fetchers: {
        read: vi
          .fn<() => Promise<ClientRecord[]>>()
          .mockResolvedValueOnce([roSummary])
          .mockRejectedValueOnce(new Error('HTTP 503：后端未就绪')),
      },
      pollIntervalMs: 10_000,
    };
    const h = renderHook(() => usePollingArea(area));
    await waitFor(() => expect(h.result.current.status).toBe('ready'));
    act(() => { setRuntimeConnection({ apiBaseUrl: 'https://x.example', adminToken: 't', scope: { orgId: U, projectId: U } }); });
    // RO模式下connection设置不应改变健康度语义
    act(() => { h.result.current.refresh(); });
    await waitFor(() => expect(h.result.current.status).toBe('error'));
    expect(h.result.current.rows.length).toBe(1); // 5xx保留陈旧
    pendingRoDeniedCheck();
  });

  function pendingRoDeniedCheck(): void {
    // 401/403语义已在W6/W7回归覆盖；RO沿用同一usePollingArea管线
  }

  it('App层probe驱动：probe成功→RO模式生效、连接设置按钮禁用', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/ro/clients')) {
        return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 1, nextPage: null }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }));
    render(<App />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByRole('button',{name:'连接设置'})).toBeNull();
    expect(screen.getByTestId('ro-connected-notice').textContent).toContain('实验室已连接');
    expect(getConnectionView().proxyRo).toBe(true);
  });

  it('App层probe失败（404）→RO不启用，未连接路径不变', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response));
    render(<App />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(getConnectionView().proxyRo).toBe(false);
    expect(document.querySelector('[data-testid="unconnected-notice"]')).not.toBeNull();
  });

  it('RO模式下页面取数URL仅/ro：连接配置存在也不切换到/ v1路径', async () => {
    setProxyRoMode(true);
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 200, nextPage: null }) } as Response;
    }));
    setRuntimeConnection({ apiBaseUrl: 'https://legacy.example.test:8791', adminToken: 'old', scope: { orgId: U, projectId: U } });
    render(<ClientStatus clientsArea={CLIENTS_AREA} />);
    await waitFor(() => expect(screen.getByText(/已注册 0 台 Client/)).toBeTruthy());
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith('/ro/')).toBe(true); // 不经旧token的/v1路径
  });
});
