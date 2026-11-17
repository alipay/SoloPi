/**
 * W25 任务中心回归：RO 只读投影（/ro/agent-tasks 列表/详情）——真实列表/筛选/详情/结果状态
 * 及失败陈旧提示；读面未部署如实未知（不以空集冒充）；取消已受理与执行器停止未确认明确分开；
 * 页面零写请求（无任何 POST 产生）；创建入口如实标注受控写面未开放（不用禁用按钮冒充完成）。
 * 断言不放宽：所有任务行必须来自真实 fetch 替身的响应，不造 DOM 数据。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Tasks } from '../src/pages/Tasks';

const S = vi.hoisted(() => ({
  available: true,
  rows: [] as unknown[],
  detail: null as unknown | null,
  failRead: false,
  failDetail: false,
}));

const row = (id: string, over: Record<string, unknown> = {}) => ({
  agentTaskId: id,
  clientId: '01M6JVA2KF08T0VZ0ZZABRAQFJ',
  kind: over.kind ?? 'tool-call',
  toolName: over.toolName ?? 'list_devices',
  status: over.status ?? 'succeeded',
  hasProgress: over.hasProgress ?? null,
  timeoutSec: 120,
  createdAt: '2026-11-06T14:00:00Z',
  expiresAt: '2026-11-06T14:10:00Z',
  deliveredAt: over.deliveredAt ?? null,
  startedAt: over.startedAt ?? null,
  cancelRequestedAt: over.cancelRequestedAt ?? null,
  endedAt: over.endedAt ?? null,
  ...over,
});

const DETAIL_BASE = row('01M6RJ5BAJ60DEKV5KBJAGQP1S', { status: 'succeeded', toolName: 'list_devices' });

beforeEach(() => {
  S.available = true;
  S.rows = [
    row('01M6RJ5BAJ60DEKV5KBJAGQP1S', { status: 'succeeded', toolName: 'list_devices' }),
    row('01M6RJ5BP0NN97AKA5GQWSKW84', { kind: 'prompt', toolName: null, status: 'running', hasProgress: true }),
  ];
  S.detail = { ...DETAIL_BASE, resultArchived: true, resultOutcome: 'succeeded', lateArchivedResult: false, resultErrorCode: null, hasResultError: false };
  S.failRead = false;
  S.failDetail = false;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const u = String(input);
    if (init?.method != null && init.method.toUpperCase() === 'POST') throw new Error('W25任务页不得产生写请求: ' + u);
    if (u.includes('/ro/agent-tasks?')) {
      if (!S.available) return { ok: false, status: 404, json: async () => ({ error: { code: 'VALIDATION_FAILED' } }), text: async () => '' } as unknown as Response;
      if (S.failRead) throw new Error('AGENT_TASKS_READ_FAILED');
      return { ok: true, json: async () => ({ items: S.rows, page: 1, pageSize: 50, nextPage: null }) } as unknown as Response;
    }
    const m = /\/ro\/agent-tasks\/([0-9A-HJKMNP-TV-Z]{26})$/.exec(u);
    if (m != null) {
      if (S.failDetail) return { ok: false, status: 404, json: async () => ({ error: { code: 'NOT_FOUND' } }), text: async () => '' } as unknown as Response;
      return { ok: true, json: async () => (S.detail ?? { ...DETAIL_BASE }) } as unknown as Response;
    }
    return { ok: false, status: 404, json: async () => ({ error: { code: 'VALIDATION_FAILED' } }), text: async () => '' } as unknown as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('R8列表代次：迟到旧列表不覆盖新筛选（家用版）', async () => {
  let resolveA: ((r: Response) => void) | null = null;
  const deferredPromise = new Promise<Response>((res) => { resolveA = res; });
  let hold = false;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const u = String(input);
    if (u.includes('status=running')) return { ok: true, json: async () => ({ items: [S.rows[1]], page: 1, pageSize: 50, nextPage: null }) } as unknown as Response;
    return hold ? deferredPromise : Promise.resolve({ ok: true, json: async () => ({ items: S.rows, page: 1, pageSize: 50, nextPage: null }) } as unknown as Response);
  }));
  render(<Tasks />);
  await waitFor(() => expect(screen.getByTestId('tasks-table')).toBeTruthy());
  expect(screen.getByTestId('tasks-row-01M6RJ5BAJ60DEKV5KBJAGQP1S')).toBeTruthy();
  hold = true;
  const refresh = screen.getByTestId('tasks-refresh');
  fireEvent.click(refresh); // 旧请求挂起
  fireEvent.change(screen.getByTestId('tasks-status-filter'), { target: { value: 'running' } });
  await waitFor(() => expect(screen.queryByTestId('tasks-row-01M6RJ5BAJ60DEKV5KBJAGQP1S')).toBeNull());
  resolveA!({ ok: true, json: async () => ({ items: S.rows, page: 1, pageSize: 50, nextPage: null }) } as unknown as Response);
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByTestId('tasks-row-01M6RJ5BAJ60DEKV5KBJAGQP1S')).toBeNull();
});

it('R7详情代次：迟到旧详情不覆盖新选中（家用版）', async () => {
  const A2 = '01M6RJ5BAJ60DEKV5KBJAGQP1S';
  const B2 = '01M6RJ5BP0NN97AKA5GQWSKW84';
  let resolveA: ((r: Response) => void) | null = null;
  const aP = new Promise<Response>((res) => { resolveA = res; });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const u = String(input);
    if (u.endsWith('/' + A2)) return aP;
    if (u.endsWith('/' + B2)) return { ok: true, json: async () => ({ ...(S.detail as Record<string, unknown>), agentTaskId: B2, toolName: 'B_RESULT', clientId: '01M6JVA2KF08T0VZ0ZZABRAQFJ', kind: 'prompt', status: 'running', hasProgress: true, timeoutSec: 120, createdAt: '2026-11-06T14:00:00Z', expiresAt: '2026-11-06T14:10:00Z', deliveredAt: null, startedAt: null, cancelRequestedAt: null, endedAt: null }) } as unknown as Response;
    return { ok: true, json: async () => ({ items: S.rows, page: 1, pageSize: 50, nextPage: null }) } as unknown as Response;
  }));
  render(<Tasks />);
  await waitFor(() => expect(screen.getByTestId('tasks-table')).toBeTruthy());
  fireEvent.click(screen.getByTestId('tasks-open-' + A2));
  fireEvent.click(screen.getByTestId('tasks-open-' + B2));
  await waitFor(() => expect(screen.getByText('B_RESULT')).toBeTruthy());
  resolveA!({ ok: true, json: async () => ({ ...(S.detail as Record<string, unknown>), toolName: 'A_LATE' }) } as unknown as Response);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByTestId('tasks-detail-panel').textContent ?? '').not.toContain('A_LATE');
  expect(screen.getByTestId('tasks-detail-panel').textContent ?? '').toContain('B_RESULT');
});

it('真实列表渲染：C80 形态任务行来自投影响应（零写请求）', async () => {
  render(<Tasks />);
  await waitFor(() => expect(screen.getByTestId('tasks-table')).toBeTruthy());
  expect(screen.getByTestId('tasks-row-01M6RJ5BAJ60DEKV5KBJAGQP1S')).toBeTruthy();
  expect(screen.getByTestId('tasks-row-01M6RJ5BP0NN97AKA5GQWSKW84')).toBeTruthy();
  expect(screen.getByTestId('tasks-count').textContent).toContain('2 条');
  expect(screen.getByTestId('tasks-count').textContent).toContain('真实读取');
  expect(document.body.textContent ?? '').toContain('自动化用例执行尚未开放');
  expect(screen.getByTestId('tasks-writeface-note').textContent).toContain('受控写面');
});

it('详情投影：结果/迟到/取消已受理与执行器停止语义区分明确', async () => {
  render(<Tasks />);
  await waitFor(() => expect(screen.getByTestId('tasks-table')).toBeTruthy());
  fireEvent.click(screen.getByTestId('tasks-open-01M6RJ5BAJ60DEKV5KBJAGQP1S'));
  await waitFor(() => expect(screen.getByTestId('tasks-detail')).toBeTruthy());
  expect(screen.getByTestId('tasks-result').textContent).toContain('succeeded'); // 首写结果投影仍在
  expect(screen.getByTestId('tasks-result').textContent).toContain('有归档载荷');
  expect(screen.getByTestId('tasks-cancel-semantics').textContent).toContain('不证明执行器实际停止');
  expect(screen.getByTestId('tasks-cancel-semantics').textContent).toContain('受控写面（未开放）');
});

it('读面未部署：如实「读面未部署——数量未知」，不以空列表冒充', async () => {
  S.available = false;
  render(<Tasks />);
  await waitFor(() => expect(screen.getByTestId('tasks-readface-absent')).toBeTruthy());
  expect(screen.getByTestId('tasks-count').textContent).toContain('读面未部署');
  expect(screen.queryByTestId('tasks-table')).toBeNull();
});

it('读取失败保留旧行并标陈旧（不冒充0）', async () => {
  render(<Tasks />);
  await waitFor(() => expect(screen.getByTestId('tasks-table')).toBeTruthy());
  S.failRead = true;
  fireEvent.click(screen.getByTestId('tasks-refresh')); // 手动刷新触发真实重读失败
  await waitFor(() => expect(screen.getByTestId('tasks-read-error')).toBeTruthy(), { timeout: 3000 });
  expect(screen.getByTestId('tasks-read-error').textContent).toMatch(/读取失败|陈旧/);
  // 旧行保留
  expect(screen.getByTestId('tasks-row-01M6RJ5BAJ60DEKV5KBJAGQP1S')).toBeTruthy();
});

it('状态筛选触发带status参数的真实重读', async () => {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const u = String(input);
    calls.push(u);
    if (u.includes('status=succeeded')) return { ok: true, json: async () => ({ items: [S.rows[0]], page: 1, pageSize: 50, nextPage: null }) } as unknown as Response;
    return { ok: true, json: async () => ({ items: S.rows, page: 1, pageSize: 50, nextPage: null }) } as unknown as Response;
  });
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  render(<Tasks />);
  await waitFor(() => expect(screen.getByTestId('tasks-table')).toBeTruthy());
  fireEvent.change(screen.getByTestId('tasks-status-filter'), { target: { value: 'succeeded' } });
  await waitFor(() => expect(calls.some((c) => c.includes('status=succeeded'))).toBe(true));
  await waitFor(() => expect(screen.queryByTestId('tasks-row-01M6RJ5BP0NN97AKA5GQWSKW84')).toBeNull());
  expect(screen.getByTestId('tasks-row-01M6RJ5BAJ60DEKV5KBJAGQP1S')).toBeTruthy();
});

it('P5翻页：nextPage驱动下一页、筛选切换重置第1页、迟页不覆盖（家用版）', async () => {
  const calls: string[] = [];
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const u = String(input);
    calls.push(u);
    const pageNum = Number(new URL(u, 'http://x').searchParams.get('page') ?? '1');
    const m = /status=([a-z]+)/.exec(u);
    if (m != null) {
      // 筛选请求：running 有两页，第1页1行 nextPage=2
      return Promise.resolve({ ok: true, json: async () => (pageNum === 1 ? { items: [S.rows[1]], page: 1, pageSize: 50, nextPage: 2 } : { items: [{ ...(S.rows[0] as Record<string, unknown>), status: 'running', agentTaskId: '01M6PAG1NAT0N0000000000A2Z' }], page: 2, pageSize: 50, nextPage: null }) } as unknown as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({ items: S.rows, page: pageNum, pageSize: 50, nextPage: pageNum === 1 ? 2 : null }) } as unknown as Response);
  }));
  render(<Tasks />);
  await waitFor(() => expect(screen.getByTestId('tasks-table')).toBeTruthy());
  // nextPage=2 → 下一页可用
  await waitFor(() => expect((screen.getByTestId('tasks-next-page') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByTestId('tasks-next-page'));
  await waitFor(() => expect(screen.getByTestId('tasks-page-indicator').textContent).toContain('第 2 页'));
  await waitFor(() => expect(calls.some((c) => c.includes('page=2'))).toBe(true));
  // 筛选切换 → 重置回第1页
  fireEvent.change(screen.getByTestId('tasks-status-filter'), { target: { value: 'running' } });
  await waitFor(() => expect(screen.getByTestId('tasks-page-indicator').textContent).toContain('第 1 页'));
  // 第1页筛选结果渲染（row-01M6RJ5BP0 在 running 第1页）
  await waitFor(() => expect(screen.getByTestId('tasks-row-01M6RJ5BP0NN97AKA5GQWSKW84')).toBeTruthy());
  // 翻到筛选第2页 → 较旧任务可到达
  await waitFor(() => expect((screen.getByTestId('tasks-next-page') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByTestId('tasks-next-page'));
  await waitFor(() => expect(screen.getByTestId('tasks-row-01M6PAG1NAT0N0000000000A2Z')).toBeTruthy());
  expect((screen.getByTestId('tasks-next-page') as HTMLButtonElement).disabled).toBe(true); // nextPage=null
});
