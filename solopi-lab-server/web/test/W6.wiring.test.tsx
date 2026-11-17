/**
 * W6 真实只读接线回归：
 * - 有连接→数据区 wired、key带scope/token指纹（切scope/换token复位）；
 * - 无连接→未接线；连接清除→回未接线；
 * - 成功空集显示“已注册0台/0条”；401/403 清除行数据并显示原因（未知不回退0）；
 * - dev引导注入仅同源端点、已有连接不覆盖。
 */
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CLIENTS_AREA, ENROLLMENTS_AREA, type DataArea } from '../src/api/areas';
import { clearRuntimeConnection, getRuntimeConnection, setRuntimeConnection } from '../src/api/connection';
import { createClientsRead } from '../src/api/fetchers-v015';
import { useLiveArea } from '../src/hooks/useLiveArea';
import { usePollingArea } from '../src/hooks/usePollingArea';
import { ApiError } from '../src/api/http';
import type { ClientRecord, EnrollmentRequest } from '../src/api/types';

const U = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const T = '2026-11-03T16:00:00Z';

afterEach(() => {
  cleanup();
  clearRuntimeConnection();
});

function setConn(orgId = U, projectId = U, token = 'tok-A') {
  const err = setRuntimeConnection({
    apiBaseUrl: 'https://127.0.0.1:8791',
    adminToken: token,
    scope: { orgId, projectId },
    orgKey: 'solopi-lab',
    projectKey: 'glasses',
  });
  expect(err).toBeNull();
}

describe('W6 live数据区接线', () => {
  it('无连接→保持原未接线数据区（wired:false无fetchers）', () => {
    const h = renderHook(() => useLiveArea(CLIENTS_AREA, (conn) => createClientsRead(conn)));
    expect(h.result.current.wired).toBe(false);
    expect(h.result.current.fetchers).toBeUndefined();
  });

  it('有连接→wired且fetchers按当前连接构建；scope/token指纹进key', () => {
    setConn();
    const h = renderHook(() => useLiveArea(CLIENTS_AREA, (conn) => createClientsRead(conn)));
    expect(h.result.current.wired).toBe(true);
    expect(typeof h.result.current.fetchers?.read).toBe('function');
    expect(h.result.current.key).toContain(U);
    expect(h.result.current.key.startsWith('clients:')).toBe(true);
  });

  it('清除连接→自动回未接线', async () => {
    setConn();
    const h = renderHook(() => useLiveArea(CLIENTS_AREA, (conn) => createClientsRead(conn)));
    expect(h.result.current.wired).toBe(true);
    act(() => {
      clearRuntimeConnection();
    });
    expect(h.result.current.wired).toBe(false);
  });

  it('切换scope（或换token）→数据区key变化（usePollingArea自动复位旧数据）', async () => {
    setConn(U, U, 'tok-A');
    const h = renderHook(({ v }) => useLiveArea(CLIENTS_AREA, (conn) => createClientsRead(conn)), {
      initialProps: { v: 1 },
    });
    const keyA = h.result.current.key;
    act(() => {
      setConn('02' + U.slice(2), U, 'tok-A');
    });
    const keyB = h.result.current.key;
    expect(keyB).not.toBe(keyA);
    act(() => {
      setConn('02' + U.slice(2), U, 'tok-B');
    });
    expect(h.result.current.key).not.toBe(keyB);
  });
});

describe('W6 空集与授权失效语义', () => {
  const summary: ClientRecord = {
    clientId: U, displayName: 'd', installationId: U,
    scope: { org: U, project: U }, registration: { status: 'approved', approvedAt: T },
    clientVersion: '0', capabilities: { media: false, command: false }, online: 'unknown',
    lastHeartbeatAt: null, leaseExpiresAt: null,
  };

  it('成功返回空集→status=empty（页面渲染“已注册 0 台”）', async () => {
    const area: DataArea<ClientRecord> = {
      ...CLIENTS_AREA, key: 'w6-empty', wired: true,
      fetchers: { read: () => Promise.resolve([]) }, pollIntervalMs: 10_000,
    };
    const h = renderHook(() => usePollingArea(area));
    await waitFor(() => expect(h.result.current.status).toBe('empty'));
    expect(h.result.current.rows).toEqual([]);
    expect(h.result.current.lastUpdatedAt).not.toBeNull(); // 成功读取，时间戳有效
  });

  it('执行ClientStatus空态文案含“已注册 0 台”', async () => {
    const { ClientStatus } = await import('../src/pages/ClientStatus');
    const area: DataArea<ClientRecord> = {
      ...CLIENTS_AREA, key: 'w6-empty-ui', wired: true,
      fetchers: { read: () => Promise.resolve([]) }, pollIntervalMs: 10_000,
    };
    render(<ClientStatus clientsArea={area} />);
    await waitFor(() => expect(screen.getByText(/服务端确认空集/)).toBeTruthy());
    expect(screen.getByText(/已注册 0 台 Client/)).toBeTruthy();
  });

  it('401授权失效→清除已取行与时间戳（未知不回退为0）；错误带原因', async () => {
    const area: DataArea<ClientRecord> = {
      ...CLIENTS_AREA, key: 'w6-401', wired: true,
      fetchers: {
        read: vi
          .fn<() => Promise<ClientRecord[]>>()
          .mockResolvedValueOnce([summary])
          .mockRejectedValueOnce(new ApiError(401, 'HTTP 401：token无效', { code: 'AUTH_TOKEN_INVALID', message: 'token无效', retryable: false })),
      },
      pollIntervalMs: 10_000,
    };
    const h = renderHook(() => usePollingArea(area));
    await waitFor(() => expect(h.result.current.status).toBe('ready'));
    const ts = h.result.current.lastUpdatedAt;
    expect(h.result.current.rows.length).toBe(1);
    act(() => { h.result.current.refresh(); });
    await waitFor(() => expect(h.result.current.status).toBe('error'));
    expect(h.result.current.rows).toEqual([]); // 授权失效即清除
    expect(h.result.current.lastUpdatedAt).toBe(null);
    expect(h.result.current.error).toMatch(/token无效/);
    expect(ts).not.toBeNull();
  });

  it('403越权→同样清除（不残留其他scope可见期的行）', async () => {
    const area: DataArea<ClientRecord> = {
      ...CLIENTS_AREA, key: 'w6-403', wired: true,
      fetchers: {
        read: vi
          .fn<() => Promise<ClientRecord[]>>()
          .mockResolvedValueOnce([summary])
          .mockRejectedValueOnce(new ApiError(403, 'HTTP 403：跨组织访问被拒', { code: 'AUTH_SCOPE_DENIED', message: '跨组织访问被拒', retryable: false })),
      },
      pollIntervalMs: 10_000,
    };
    const h = renderHook(() => usePollingArea(area));
    await waitFor(() => expect(h.result.current.status).toBe('ready'));
    act(() => { h.result.current.refresh(); });
    await waitFor(() => expect(h.result.current.status).toBe('error'));
    expect(h.result.current.rows).toEqual([]);
  });

  it('普通网络失败→保留陈旧数据语义（W2回归不变）', async () => {
    const area: DataArea<ClientRecord> = {
      ...CLIENTS_AREA, key: 'w6-503', wired: true,
      fetchers: {
        read: vi
          .fn<() => Promise<ClientRecord[]>>()
          .mockResolvedValueOnce([summary])
          .mockRejectedValueOnce(new Error('HTTP 503：后端未就绪')),
      },
      pollIntervalMs: 10_000,
    };
    const h = renderHook(() => usePollingArea(area));
    await waitFor(() => expect(h.result.current.status).toBe('ready'));
    act(() => { h.result.current.refresh(); });
    await waitFor(() => expect(h.result.current.status).toBe('error'));
    expect(h.result.current.rows.length).toBe(1); // 陈旧数据保留
    expect(h.result.current.lastUpdatedAt).not.toBeNull();
  });
});

describe('W6 dev引导注入（同源受控端点）', () => {
  it('App引导：200→setRuntimeConnection；404→保持未配置；已有连接不覆盖', async () => {
    const { default: App } = await import('../src/App');
    const originalFetch = globalThis.fetch;

    // 404：保持未配置
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) =>
      ({ ok: false, status: 404, json: async () => ({}) }) as Response,
    );
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('[data-testid="unconnected-notice"]')).not.toBeNull();
    cleanup();

    // 200：注入配置
    const payload = {
      apiBaseUrl: 'https://127.0.0.1:8791',
      adminToken: 'dev-handoff-token',
      scope: { orgId: U, projectId: U },
      orgKey: 'solopi-lab',
      projectKey: 'glasses',
    };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/dev-connection.json')
        ? ({ ok: true, json: async () => payload } as Response)
        : ({ ok: false, status: 404, json: async () => ({}) }) as Response,
    );
    render(<App />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // 配置已保存，但实际列表返回404；应显示真实读取失败而非永远待验证。
    expect(document.body.textContent).toContain('暂时无法读取实验室数据');
    expect(document.querySelector('[data-testid="connected-notice"]')).toBeNull();
    expect(document.body.textContent ?? '').not.toContain('dev-handoff-token'); // token不入DOM
    cleanup();
    clearRuntimeConnection();

    // 已有连接不覆盖
    setConn(undefined, undefined, 'tok-existing');
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/dev-connection.json')
        ? ({ ok: true, json: async () => payload } as Response)
        : ({ ok: false, status: 404, json: async () => ({}) }) as Response,
    );
    render(<App />);
    await act(async () => { await Promise.resolve(); });
    expect(document.body.textContent ?? '').toContain('暂时无法读取实验室数据'); // 实际列表404，已有配置仍保留
    expect(getRuntimeConnection()?.adminToken).toBe('tok-existing');
    cleanup();

    globalThis.fetch = originalFetch;
  }, 15000);
});

describe('W6 审批页接线', () => {
  it('无连接→审批页保持未接入卡', async () => {
    const { ApprovalList } = await import('../src/pages/ApprovalList');
    render(<ApprovalList enrollmentsArea={ENROLLMENTS_AREA} />);
    expect(screen.getByText(/「注册审批」尚未接入/)).toBeTruthy();
  });

  it('有连接且服务端空集→显示“0 条”', async () => {
    setConn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      ({ ok: true, json: async () => ({ items: [], page: 1, pageSize: 200, nextPage: null }) }) as Response,
    );
    const { ApprovalList } = await import('../src/pages/ApprovalList');
    render(<ApprovalList enrollmentsArea={ENROLLMENTS_AREA} />);
    await waitFor(() => expect(screen.getByText(/待审批的注册申请（0 条）/)).toBeTruthy());
    globalThis.fetch = originalFetch;
  });
});

describe('数据类型完备性（避免any混入W6路径）', () => {
  it('EnrollmentRequest/ClientRecord mapped rows可静态使用（冒烟）', () => {
    const e: EnrollmentRequest = {
      enrollmentId: U, installationId: U, publicKeyFingerprint: 'sha256:x',
      scope: { org: 'lab', project: 'glasses' }, clientVersion: '0', createdAt: T,
    };
    expect(e.enrollmentId).toBe(U);
  });
});
