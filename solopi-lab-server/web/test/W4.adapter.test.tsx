/**
 * W4 针对性回归：只读合同适配与真实API配置入口（未接线状态保持）。
 *
 * 覆盖：v0.1.5行映射（状态/身份条件、权威presence）、分页聚合边界、
 * 错误envelope解析（401/403/422/429）、取数工厂的URL/头构造
 * （token绝不进URL）、连接配置内存生命周期与不回显。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConnectionPanel } from '../src/components/ConnectionPanel';
import {
  AdapterError,
  fetchAllPages,
  mapClientSummary,
  mapEnrollmentRow,
} from '../src/api/adapters-v015';
import { ApiError, ErrorEnvelope, fetchJson } from '../src/api/http';
import {
  clearRuntimeConnection,
  describeRuntimeConnection,
  getRuntimeConnection,
  setRuntimeConnection,
} from '../src/api/connection';
import { createClientsRead, createEnrollmentsRead } from '../src/api/fetchers-v015';
import { ENROLLMENTS_AREA, CLIENTS_AREA } from '../src/api/areas';
import type { ClientSummary15, EnrollmentRow15 } from '../src/api/contract-v015';

const U = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const T = '2026-11-03T16:00:00Z';

const row: EnrollmentRow15 = {
  enrollmentId: U,
  installationId: U,
  status: 'pending',
  keyFingerprint: 'sha256:YWJj',
  clientVersion: '0.1.143',
  scope: { orgId: U, projectId: U },
  deviceScope: { deviceId: 'd', os: 'darwin', hostname: 'h' },
  requestedAt: T,
  clientId: null,
};

const summary: ClientSummary15 = {
  orgId: U,
  projectId: U,
  clientId: U,
  installationId: U,
  keyFingerprint: 'sha256:YWJj',
  status: 'approved',
  online: 'unknown',
  lastHeartbeatAt: null,
  leaseExpiresAt: null,
  clientVersion: null,
  capabilities: { commands: true, media: false },
  occupancy: { localUiTasks: 0, cliTasks: 0 },
  deviceScope: { deviceId: 'd', os: 'darwin', hostname: 'paybox-01' },
};

afterEach(() => {
  cleanup();
  clearRuntimeConnection();
});

describe('W4 适配层（v0.1.5行→视图）', () => {
  it('enrollmentRow：pending行clientId=null合法映射，scope标签可用orgKey/projectKey', () => {
    const mapped = mapEnrollmentRow(row, { orgKey: 'lab-alpha', projectKey: 'glasses' });
    expect(mapped.scope.org).toBe('lab-alpha');
    expect(mapped.scope.project).toBe('glasses');
    expect(mapped.publicKeyFingerprint).toBe('sha256:YWJj');
    expect(mapped.createdAt).toBe(T);
  });

  it('条件反例：approved缺clientId、pending带clientId 均抛CONTRACT_MISMATCH（不渲染可疑数据）', () => {
    const badApproved = { ...row, status: 'approved' as const };
    expect(() => mapEnrollmentRow(badApproved)).toThrowError(AdapterError);
    const leakyPending = { ...row, clientId: U };
    expect(() => mapEnrollmentRow(leakyPending)).toThrow(AdapterError);
  });

  it('clientSummary：权威presence直取；非法online值降级unknown（不推导）', () => {
    const online = mapClientSummary({ ...summary, online: 'online', lastHeartbeatAt: '2000-01-01T00:00:00Z' });
    expect(online.online).toBe('online'); // 心跳古老但权威字段为online，按字段显示
    const bad = mapClientSummary({ ...summary, online: 'sometimes' as unknown as ClientSummary15['online'] });
    expect(bad.online).toBe('unknown');
    const revoked = mapClientSummary({ ...summary, status: 'revoked', online: 'offline' });
    expect(revoked.registration.status).toBe('revoked');
    expect(revoked.displayName).toBe('paybox-01');
  });

  it('分页聚合：nextPage=null停止；nextPage不前进拒绝死循环；超上限显式报错不静默截断', async () => {
    const pagesOk = vi
      .fn()
      .mockResolvedValueOnce({ items: [row], page: 1, pageSize: 200, nextPage: 2 })
      .mockResolvedValueOnce({ items: [{ ...row, enrollmentId: '02A' }], page: 2, pageSize: 200, nextPage: null });
    const all = await fetchAllPages<EnrollmentRow15>(pagesOk, new AbortController().signal, 10);
    expect(all.length).toBe(2);
    expect(pagesOk).toHaveBeenCalledTimes(2);

    const loop = vi.fn(async (page: number) => ({ items: [], page, pageSize: 200, nextPage: 1 }));
    await expect(fetchAllPages(loop, new AbortController().signal, 10)).rejects.toThrow(/死循环/);

    const many = vi.fn(async (page: number) => ({ items: [], page, pageSize: 200, nextPage: page + 1 }));
    await expect(fetchAllPages(many, new AbortController().signal, 3)).rejects.toThrow(/分页超过.*上限/);
  });
});

describe('W4 错误envelope（过期/吊销/403/429）', () => {
  it('fetchJson 4xx解析合同错误envelope（code/message/retryable）', async () => {
    const envelope: ErrorEnvelope = { code: 'AUTH_TOKEN_INVALID', message: 'token无效或已吊销', retryable: false };
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      ({ ok: false, status: 401, text: async () => JSON.stringify({ error: envelope }) }) as Response,
    );
    try {
      await fetchJson('http://127.0.0.1:1/x', new AbortController().signal);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(401);
      expect(apiErr.envelope?.code).toBe('AUTH_TOKEN_INVALID');
      expect(apiErr.envelope?.retryable).toBe(false);
      expect(apiErr.message).toMatch(/token无效或已吊销/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('429解析retryAfterSec；非JSON错误体envelope=null但不抛解析错误', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      ({ ok: false, status: 429, text: async () => JSON.stringify({ error: { code: 'RATE_LIMITED', message: '限流', retryable: true, retryAfterSec: 30 } }) }) as Response,
    );
    try {
      await fetchJson('http://127.0.0.1:1/x', new AbortController().signal);
      expect.unreachable();
    } catch (err) {
      expect((err as ApiError).envelope?.retryAfterSec).toBe(30);
    } finally {
      globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'oops-html' }) as Response);
      await expect(fetchJson('http://127.0.0.1:1/x', new AbortController().signal)).rejects.toThrow(/HTTP 500/);
      globalThis.fetch = original;
    }
  });

  it('错误envelope缺必需字段时置null（不误判部分JSON为合同错误）', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      ({ ok: false, status: 503, text: async () => JSON.stringify({ error: { code: 'X' } }) }) as Response,
    );
    try {
      await fetchJson('http://127.0.0.1:1/x', new AbortController().signal);
      expect.unreachable();
    } catch (err) {
      expect((err as ApiError).envelope).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('W4 取数工厂（未接线准备件）', () => {
  const conn = {
    apiBaseUrl: 'https://lab.example:18999',
    adminToken: 'secret-token-value',
    scope: { orgId: U, projectId: U },
    orgKey: 'lab',
    projectKey: 'paybox',
  };

  it('clientsRead：URL只含ULID/分页参数，token仅进Authorization头', async () => {
    const calls: { url: string; headers: HeadersInit }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), headers: init?.headers ?? {} });
      return {
        ok: true,
        json: async () => ({ items: [summary], page: 1, pageSize: 200, nextPage: null }),
      } as Response;
    });
    try {
      // W8新增准入门槛：工厂发起请求前核对store当前身份——测试同步设置同一身份
      expect(setRuntimeConnection(conn)).toBeNull();
      const rows = await createClientsRead(conn)('', new AbortController().signal);
      expect(rows.length).toBe(1);
      expect(rows[0].clientId).toBe(U);
      expect(rows[0].online).toBe('unknown');
      expect(calls.length).toBe(1);
      const { url, headers } = calls[0];
      expect(url.startsWith('https://lab.example:18999/v1/clients?')).toBe(true);
      expect(url).toContain(`orgId=${U}`);
      expect(url).toContain(`projectId=${U}`);
      expect(url).toContain('page=1');
      expect(url).toContain('pageSize=200');
      expect(url).not.toContain('secret-token-value'); // token绝不进URL
      const h = headers as Record<string, string>;
      expect(h.Authorization).toBe(`Bearer ${conn.adminToken}`);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('enrollmentsRead：默认status=pending，聚合两页', async () => {
    const original = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      const page = new URL(String(input)).searchParams.get('page');
      return {
        ok: true,
        json: async () =>
          page === '1'
            ? { items: [row], page: 1, pageSize: 200, nextPage: 2 }
            : { items: [{ ...row, enrollmentId: '02A' }], page: 2, pageSize: 200, nextPage: null },
      } as Response;
    });
    try {
      expect(setRuntimeConnection(conn)).toBeNull();
      const rows = await createEnrollmentsRead(conn)('', new AbortController().signal);
      expect(rows.length).toBe(2);
      expect(urls[0]).toContain('status=pending');
      expect(urls[1]).toContain('page=2');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('生产数据区仍未接线：工厂未被areas引用（静态约定回归）', () => {
    // areas.ts的三个正式数据区fetchers必须保持未定义，且/pages不导入fetchers-v015
    expect(ENROLLMENTS_AREA.fetchers).toBeUndefined();
    expect(CLIENTS_AREA.fetchers).toBeUndefined();
  });
});

describe('W4 连接配置（内存生命周期与不回显）', () => {
  it('set/validate/clear：ULID校验、token仅内存、快照不回显明文', () => {
    const bad = setRuntimeConnection({
      apiBaseUrl: 'https://x.example',
      adminToken: 't',
      scope: { orgId: 'not-ulid', projectId: U },
    });
    expect(bad).toMatch(/ULID/);
    expect(getRuntimeConnection()).toBeNull();

    const ok = setRuntimeConnection({
      apiBaseUrl: 'https://x.example',
      adminToken: 'tok-123',
      scope: { orgId: U, projectId: U },
    });
    expect(ok).toBeNull();
    const conn = getRuntimeConnection();
    expect(conn?.adminToken).toBe('tok-123'); // 内存内可用
    const snap = describeRuntimeConnection();
    expect(JSON.stringify(snap)).not.toContain('tok-123'); // 快照与JSON形态均不回显

    clearRuntimeConnection();
    expect(getRuntimeConnection()).toBeNull();
  });

  it('ConnectionPanel：保存后token不落DOM，仅显示已配置状态；清除生效', () => {
    render(<ConnectionPanel onClose={() => undefined} />);
    fireEvent.change(screen.getByPlaceholderText(/保存后不再显示/), { target: { value: 'tok-456' } });
    fireEvent.change(screen.getByPlaceholderText(/https:\/\/lab-server/), {
      target: { value: 'https://x.example' },
    });
    const textInputs = screen.getAllByRole('textbox');
    for (const input of textInputs) {
      if ((input as HTMLInputElement).value === '') {
        fireEvent.change(input, { target: { value: U } });
      }
    }
    fireEvent.click(screen.getByRole('button', { name: '保存（仅内存）' }));
    expect(screen.getByTestId('connection-state').textContent).toMatch(/已配置/);
    expect(document.body.textContent ?? '').not.toContain('tok-456'); // 保存后DOM无token明文

    fireEvent.click(screen.getByRole('button', { name: '清除配置' }));
    expect(screen.getByTestId('connection-state').textContent).toMatch(/未配置/);
    expect(getRuntimeConnection()).toBeNull();
  });
});
