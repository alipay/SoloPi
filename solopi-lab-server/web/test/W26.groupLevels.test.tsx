/**
 * W26 设备组层级回归（DG142 前端消费面）：RO 只读投影 /ro/group-levels——层级宽渲染、语义三分
 * （登记/停止意图/终态合取）、吊销默认隐藏与历史入口、坏封套拒绝不冒充空集、迟到代次隔离、
 * 分页、真实空态、页面零写请求。断言不放宽：所有 DOM 数据均来自 fetch 替身响应，不造数据。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GroupLevels } from '../src/pages/GroupLevels';

const S = vi.hoisted(() => ({
  available: true,
  levels: [] as unknown[],
  failRead: false,
}));

const exec = (id: string, over: Record<string, unknown> = {}) => ({
  groupExecutionId: id,
  requestId: 'req-' + id,
  taskId: 'task-' + id,
  phase: 'prepared',
  updatedAtMs: Date.parse('2026-11-08T20:00:00Z'),
  ...over,
});

const group = (id: string, over: Record<string, unknown> = {}) => ({
  groupId: id, name: '组-' + id.slice(0, 4), revision: 1, deleted: false, updatedAtMs: Date.parse('2026-11-08T20:00:00Z'),
  members: [], executions: [], ...over,
});

const level = (clientId: string, over: Record<string, unknown> = {}) => ({
  clientId,
  clientStatus: 'approved',
  deviceScope: { hostname: 'Desk-' + clientId.slice(-4) },
  groups: [], ...over,
});

const OK_BODY = { page: 1, pageSize: 50, nextPage: null };

beforeEach(() => {
  S.available = true;
  S.failRead = false;
  S.levels = [
    level('01M6JVA2KF08T0VZ0ZZABRAQFJA', {
      groups: [
        group('g-111', {
          members: [
            { deviceId: 'd-1', role: 'phone', deviceKind: 'phone', deviceName: '真机', deviceStatus: 'online' },
            { deviceId: 'd-2', role: null, deviceKind: 'other', deviceName: '未确认设备', deviceStatus: 'online' },
            { deviceId: 'd-3', role: 'glasses', deviceKind: null, deviceName: null, deviceStatus: null },
          ],
          executions: [
            exec('e-prep'), // prepared≠成功
            exec('e-done', { phase: 'done', receipt: { taskId: 'task-e-done', terminal: true, resourcesReleased: true, outcome: 'succeeded', reportRef: 'report-1' } }),
            exec('e-cancel', { phase: 'done', stopRequestedAt: '2026-11-08T19:30:00Z', receipt: { taskId: 'task-e-cancel', terminal: true, resourcesReleased: true, outcome: 'cancelled', reportRef: null } }),
            exec('e-resonly', { phase: 'done', receipt: { taskId: 'task-e-resonly', terminal: false, resourcesReleased: true, outcome: null, reportRef: null } }),
            exec('e-nofinal', { phase: 'done', receipt: { taskId: 'task-e-nofinal', terminal: true, resourcesReleased: false, outcome: 'failed', reportRef: null } }),
            exec('e-unknown', { phase: 'unknown' }),
          ],
        }),
        group('g-tomb', { deleted: true, name: '已删组', revision: 3 }),
      ],
    }),
    level('01M6JVA2KF08T0VZ0ZZABRAQFJR', { clientStatus: 'revoked', groups: [group('g-rev', { name: '吊销机历史组' })] }),
  ];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const u = String(input);
    if (init?.method != null && init.method.toUpperCase() === 'POST') throw new Error('W26组层级页不得产生写请求: ' + u);
    if (u.includes('/ro/group-levels?')) {
      if (!S.available) return { ok: false, status: 404, json: async () => ({ error: { code: 'VALIDATION_FAILED' } }), text: async () => '' } as unknown as Response;
      if (S.failRead) throw new Error('LEVELS_READ_FAILED');
      return { ok: true, json: async () => ({ ...OK_BODY, items: S.levels }) } as unknown as Response;
    }
    return { ok: false, status: 404, json: async () => ({ error: { code: 'VALIDATION_FAILED' } }), text: async () => '' } as unknown as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('层级正例: Desktop/组/成员真值渲染+吊销默认隐藏可切历史', async () => {
  render(<GroupLevels />);
  await waitFor(() => expect(screen.getByTestId('levels-count')).toBeTruthy());
  const card = screen.getByTestId('levels-desktop-01M6JVA2KF08T0VZ0ZZABRAQFJA');
  expect(card.textContent).toContain('Desk');
  expect(screen.queryByTestId('levels-desktop-01M6JVA2KF08T0VZ0ZZABRAQFJR')).toBeNull(); // 吊销默认隐藏（原用户决定）
  fireEvent.click(screen.getByTestId('levels-toggle-revoked'));
  const rev = screen.getByTestId('levels-desktop-01M6JVA2KF08T0VZ0ZZABRAQFJR');
  expect(rev.textContent).toContain('已吊销');
  expect(rev.textContent).toContain('吊销机历史组'); // 历史登记如实展示
  fireEvent.click(screen.getByTestId('levels-toggle-revoked'));
  expect(screen.queryByTestId('levels-desktop-01M6JVA2KF08T0VZ0ZZABRAQFJR')).toBeNull();
});

it('成员真值: role缺=null登记未声明、kind=other不推断、无记录=null', async () => {
  render(<GroupLevels />);
  await waitFor(() => expect(screen.getByTestId('levels-member-0')).toBeTruthy());
  const m1 = screen.getByTestId('levels-member-0').textContent;
  expect(m1).toContain('真机'); expect(m1).toContain('手机 · 手机');
  const m2 = screen.getByTestId('levels-member-1').textContent;
  expect(m2).toContain('未确认角色（other）'); // other=真值，不按名字推断
  expect(m2).toContain('登记未声明角色');       // role null=登记未声明，非空缺标签冒充
  const m3 = screen.getByTestId('levels-member-2').textContent;
  expect(m3).toContain('眼镜 · 设备库无记录');   // kind 无记录=null，不虚构
  expect(m3).toContain('状态未知');
});

it('执行语义三分: prepared≠成功、终态合取、resourcesReleased单独不推成功、停止意图与取消分开、unknown如实', async () => {
  render(<GroupLevels />);
  await waitFor(() => expect(screen.getByTestId('levels-group-g-111')).toBeTruthy());
  const g = screen.getByTestId('levels-group-g-111').textContent;
  expect(g).toContain('已登记·未执行');            // prepared只是登记
  expect(g).not.toContain('登记住');               // 防御断言改错文案
  expect(screen.getByTestId('levels-exec-e-done').textContent).toContain('回执终态：成功');
  expect(screen.getByTestId('levels-exec-e-cancel').textContent).toContain('已取消');
  expect(screen.getByTestId('levels-exec-e-cancel-stop').textContent).toContain('已请求停止'); // 停止意图另列
  expect(screen.getByTestId('levels-exec-e-resonly').textContent).toContain('不构成终态证据');   // resourcesReleased单独
  expect(screen.getByTestId('levels-exec-e-resonly').textContent).not.toContain('成功');
  expect(screen.getByTestId('levels-exec-e-nofinal').textContent).toContain('资源收尾未证实');
  expect(screen.getByTestId('levels-exec-e-unknown').textContent).toContain('结果未知');
  expect(g).toContain('report-1');                 // 报告标识原样（不构造链接）
});

it('墓碑真值照常展示', async () => {
  render(<GroupLevels />);
  await waitFor(() => expect(screen.getByTestId('levels-group-g-tomb')).toBeTruthy());
  const tomb = screen.getByTestId('levels-group-g-tomb');
  expect(tomb.textContent).toContain('墓碑');
  expect(tomb.textContent).toContain('revision 3');
  expect(tomb.className).toContain('levels-group-tombstone');
});

it('坏封套拒收: 缺nextPage按读取失败、无旧数据不冒充空集', async () => {
  S.levels = [];
  vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => {
    return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 50 }) } as unknown as Response; // 缺 nextPage
  }));
  render(<GroupLevels />);
  await waitFor(() => expect(screen.getByTestId('levels-read-error')).toBeTruthy());
  expect(screen.getByTestId('levels-read-error').textContent).toContain('组层级读取失败');
  expect(screen.queryByTestId('levels-empty-real')).toBeNull(); // 不冒充确认空集
});

it('读面未部署: probe 404如实显示、不造数据', async () => {
  S.available = false;
  render(<GroupLevels />);
  await waitFor(() => expect(screen.getByTestId('levels-readface-absent')).toBeTruthy());
  expect(screen.getByTestId('levels-readface-absent').textContent).toContain('未部署');
  expect(screen.queryByTestId('levels-count')).toBeNull();
});

it('迟到代次隔离: 旧页响应不覆盖新代次', async () => {
  let page2First = true;
  const hold: { resolve: ((r: Response) => void) | null } = { resolve: null };
  const deferred = new Promise<Response>((res) => { hold.resolve = res; });
  const A = S.levels[0];
  const stale = level('01M6JVA2KF08T0VZ0ZZABRAQFJS', { deviceScope: { hostname: 'STALE-OLD' }, groups: [group('g-old', { name: '旧响应组' })] });
  const fresh = level('01M6JVA2KF08T0VZ0ZZABRAQFKB', { deviceScope: { hostname: 'FRESH-NEW' }, groups: [group('g-new', { name: '新响应组' })] });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const u = String(input);
    if (u.includes('pageSize=1')) return { ok: true, json: async () => ({ ...OK_BODY, items: [] }) } as unknown as Response;
    if (u.includes('page=2')) {
      if (page2First) { page2First = false; return deferred as unknown as Promise<Response>; }
      return { ok: true, json: async () => ({ items: [fresh], page: 2, pageSize: 50, nextPage: null }) } as unknown as Response;
    }
    return { ok: true, json: async () => ({ items: [A], page: 1, pageSize: 50, nextPage: 2 }) } as unknown as Response;
  }));
  render(<GroupLevels />);
  await waitFor(() => expect(screen.getByTestId('levels-desktop-01M6JVA2KF08T0VZ0ZZABRAQFJA')).toBeTruthy());
  // 翻页：第一次页2请求挂起（旧代次），再点一次同页（新代次）先返回
  fireEvent.click(screen.getByTestId('levels-next'));
  fireEvent.click(screen.getByTestId('levels-next'));
  await waitFor(() => expect(screen.getByTestId('levels-desktop-01M6JVA2KF08T0VZ0ZZABRAQFKB')).toBeTruthy());
  expect(screen.getByTestId('levels-desktop-01M6JVA2KF08T0VZ0ZZABRAQFKB').textContent).toContain('FRESH-NEW');
  hold.resolve?.({ ok: true, json: async () => ({ items: [stale], page: 2, pageSize: 50, nextPage: null }) } as unknown as Response);
  await act(async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
  // 迟到旧代次响应按失配丢弃：不得出现旧响应内容
  expect(screen.queryByTestId('levels-desktop-01M6JVA2KF08T0VZ0ZZABRAQFJS')).toBeNull();
  expect(screen.queryByText('旧响应组')).toBeNull();
  expect(screen.getByTestId('levels-desktop-01M6JVA2KF08T0VZ0ZZABRAQFKB').textContent).toContain('FRESH-NEW');
});

it('分页: nextPage驱动下一页、末页禁用', async () => {
  let call = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const u = String(input);
    call += 1;
    if (u.includes('page=2')) return { ok: true, json: async () => ({ items: [{ ...(S.levels[1] as Record<string, unknown>), clientStatus: 'approved' }], page: 2, pageSize: 50, nextPage: null }) } as unknown as Response;
    return { ok: true, json: async () => ({ ...OK_BODY, items: [S.levels[0]], page: 1, pageSize: 50, nextPage: 2 }) } as unknown as Response;
  }));
  render(<GroupLevels />);
  await waitFor(() => expect(screen.getByTestId('levels-next')).toBeTruthy());
  expect(screen.getByTestId('levels-next').textContent).toContain('第 2 页');
  fireEvent.click(screen.getByTestId('levels-next'));
  await waitFor(() => expect(screen.getByTestId('levels-desktop-01M6JVA2KF08T0VZ0ZZABRAQFJR')).toBeTruthy());
  expect((screen.getByTestId('levels-next') as HTMLButtonElement).disabled).toBe(true);
  expect(call).toBeGreaterThanOrEqual(2);
});

it('真实空态: items空=如实空、不占位', async () => {
  S.levels = [];
  render(<GroupLevels />);
  await waitFor(() => expect(screen.getByTestId('levels-empty-real')).toBeTruthy());
  expect(screen.getByTestId('levels-empty-real').textContent).toContain('没有任何设备组登记');
  expect(screen.getByTestId('levels-count').textContent).toContain('0 台 Desktop');
});
