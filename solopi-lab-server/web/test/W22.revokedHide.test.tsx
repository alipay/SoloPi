/**
 * 分版本测试账目：W22（已吊销前端隐藏+能力提示一致性）独立计数文件；W22.1修订（本版）后共 11 项：
 * W22.1 Client列表/媒体入口隐藏 3 项；W22.2 总览计数一致 3 项；
 * W22.3 注册记录同样隐藏revoked（W22.1修订：含去聚合单请求断言）3 项；W22.4 能力提示登记值口径 2 项。
 * 口令/票据均 fixture。已吊销吊销语义只看 registration.status==='revoked' 权威值——offline/unknown 不混判。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Overview } from '../src/pages/Overview';
import { ClientStatus } from '../src/pages/ClientStatus';
import { RegistrationRecords } from '../src/pages/RegistrationRecords';
import { CLIENTS_AREA, ENROLLMENTS_AREA } from '../src/api/areas';
import { setProxyRoMode, setRoDevicesAvailable } from '../src/api/connection';

const U = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const baseClient = (over: Record<string, unknown>) => ({
  // ClientSummary15 wire形状（RO /ro/clients 原始行）——经 mapClientSummary 映射后入页
  orgId: '01M6GGBGHYYJTD648SY66Q1MM2',
  projectId: '01M6GGBGHYZG3CMXJAJKNT56DE',
  clientId: '01M6JVA2KF08T0VZ0ZZABRAQFJ',
  installationId: U,
  keyFingerprint: 'sha256:' + 'f'.repeat(64),
  status: 'approved',
  grantedAt: '2026-11-04T08:00:00Z',
  clientVersion: '44.7.0',
  capabilities: { media: true, commands: false },
  occupancy: { localUiTasks: 0, cliTasks: 0 },
  online: 'online',
  lastHeartbeatAt: '2026-11-04T09:13:15Z',
  leaseExpiresAt: '2026-11-04T10:13:15Z',
  deviceScope: { deviceId: U, os: 'darwin', hostname: 'U-CC-W21-HOST' },
  ...over,
});
const revokedClient = () => baseClient({
  clientId: '01M6JVA2KF08T0VZ0ZZABRAREVOK',
  status: 'revoked',
  grantedAt: null,
  /* 关键：吊销+在线——吊销判定只能来自 status='revoked'，须从列表隐藏；offline/unknown不混判 */
  online: 'online',
  deviceScope: { deviceId: U, os: 'darwin', hostname: 'revoked-host' },
});
const dev = { deviceId: '01M6DEVICE0000000000000001', deviceName: 'dev', kind: 'phone', status: 'online', lastSeenAt: '2026-11-04T08:00:00Z', lastSnapshotAt: '2026-11-04T08:00:00Z', lastSnapshotId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', discoveredAt: '2026-11-04T08:00:00Z', clientId: '01M6JVA2KF08T0VZ0ZZABRAQFJ' };

function stubRo(clients: unknown[], devices: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) }) as Response;
    if (url.startsWith('/ro/devices')) return json({ items: devices, page: 1, pageSize: 200, nextPage: null });
    return json({ items: clients, page: 1, pageSize: 200, nextPage: null, status: 'approved' });
  }));
}

async function flush(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

beforeEach(() => {
  setProxyRoMode(true);
  setRoDevicesAvailable(true);
});

afterEach(() => {
  cleanup();
  setProxyRoMode(false);
  setRoDevicesAvailable(false);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('W22.1 设备/Client列表已吊销隐藏', () => {
  it('首次加载：已吊销 Client 卡不渲染（含其设备与媒体查看面板入口），approved 正常', async () => {
    stubRo([baseClient({ deviceScope: { deviceId: U, os: 'darwin', hostname: 'live-host' } }), revokedClient()], [dev]);
    render(<ClientStatus clientsArea={CLIENTS_AREA} />);
    await waitFor(() => expect(screen.getByTestId('client-card-01M6JVA2KF08T0VZ0ZZABRAQFJ')).toBeTruthy());
    await flush();
    expect(screen.queryByTestId('client-card-01M6JVA2KF08T0VZ0ZZABRAREVOK')).toBeNull();
    expect(document.body.textContent).not.toContain('revoked-host');
    // 吊销设备入口随之隐藏——媒体查看面板不存在
    expect(document.querySelectorAll('[data-testid^="media-viewer-01M6JVA2KF08T0VZ0ZZABRAREVOK"]').length).toBe(0);
    // approved 设备的媒体查看面板仍在
    expect(document.querySelectorAll('[data-testid^="media-viewer-01M6JVA2KF08T0VZ0ZZABRAQFJ"]').length).toBeGreaterThan(0);
  });

  it('刷新后吊销：轮询返回同刻把该 Client 置 revoked——卡片消失不见', async () => {
    let clients: unknown[] = [baseClient({ deviceScope: { deviceId: U, os: 'darwin', hostname: 'live-host' }, clientId: '01M6JVA2KF08T0VZ0ZZABRAREVOK' })];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) }) as Response;
      if (url.startsWith('/ro/devices')) return json({ items: [dev], page: 1, pageSize: 200, nextPage: null });
      return json({ items: clients, page: 1, pageSize: 200, nextPage: null });
    }));
    render(<ClientStatus clientsArea={CLIENTS_AREA} />);
    await waitFor(() => expect(screen.getByTestId('client-card-01M6JVA2KF08T0VZ0ZZABRAREVOK')).toBeTruthy());
    clients = [revokedClient()];
    cleanup(); // 隔离两帧DOM——本条验证的是「吊销返回后下一帧渲染」语义（轮询周期由area自己的interval驱动，测试以串行两帧替代）
    render(<ClientStatus clientsArea={CLIENTS_AREA} />);
    await waitFor(() => expect(screen.getByText(/台 Client（本地筛选/)).toBeTruthy());
    expect(document.querySelectorAll('[data-testid^="media-viewer-01M6JVA2KF08T0VZ0ZZABRAREVOK"]').length).toBe(0);
    expect(screen.queryByTestId('client-card-01M6JVA2KF08T0VZ0ZZABRAREVOK')).toBeNull();
  });

  it('吊销≠离线/未知：offline 且 approved 的 Client 仍展示（仅 registration.status=revoked 隐藏）', async () => {
    stubRo([baseClient({ deviceScope: { deviceId: U, os: 'darwin', hostname: 'offline-host' }, online: 'offline' }), baseClient({ deviceScope: { deviceId: U, os: 'darwin', hostname: 'unknown-host' }, clientId: '01M6JVA2KF08T0VZ0ZZABRAUNKW', online: 'unknown' })], []);
    render(<ClientStatus clientsArea={CLIENTS_AREA} />);
    await waitFor(() => expect(screen.getByTestId('client-card-01M6JVA2KF08T0VZ0ZZABRAQFJ')).toBeTruthy());
    expect(screen.getByTestId('client-card-01M6JVA2KF08T0VZ0ZZABRAUNKW')).toBeTruthy();
  });
});

describe('W22.2 总览统计与摘要一致排除', () => {
  it('Client在线计数与摘要卡均排除吊销（不把吊销算入在线/总数/空态误判）', async () => {
    stubRo([baseClient({ deviceScope: { deviceId: U, os: 'darwin', hostname: 'live-host' } }), revokedClient()], [dev]);
    render(<Overview />);
    await waitFor(() => expect(document.querySelectorAll('[data-testid="ov-client-01M6JVA2KF08T0VZ0ZZABRAQFJ"]').length).toBe(1));
    await flush();
    expect(screen.queryByTestId('ov-client-01M6JVA2KF08T0VZ0ZZABRAREVOK')).toBeNull();
    expect(document.body.textContent).not.toContain('revoked-host');
    // stat行（W23账目注记：标签随原型改为「在线电脑」）——吊销不入分母
    await waitFor(() => expect(document.body.textContent).toMatch(/1\s*台电脑在线/));
  });
  it('全员吊销：总览摘要区显示真实空态（对全部可见 Client 而言），不复制吊销主机名', async () => {
    stubRo([revokedClient()], []);
    render(<Overview />);
    await waitFor(() => expect(screen.getByText(/尚未接入电脑/)).toBeTruthy());
    expect(document.body.textContent).not.toContain('revoked-host');
  });
  it('吊销 Client 的设备不计入「连接设备」渠道快照聚合（快照面按服务端返回为来源——本条仅证总览摘要不渲染吊销客户设备行）', async () => {
    stubRo([revokedClient()], [dev]);
    render(<Overview />);
    await waitFor(() => expect(screen.getByText(/尚未接入电脑/)).toBeTruthy());
    expect(document.querySelectorAll('.device-rows').length).toBe(0);
  });
});

describe('W22.3 注册记录同样隐藏真实的 revoked 项', () => {
  const enrollmentRow = (status: string, eid: string) => ({ enrollmentId: eid, installationId: eid, clientId: eid, status, keyFingerprint: 'sha256:' + 'a'.repeat(64), clientVersion: '44.7.0', scope: { orgId: '01M6GGBGHYYJTD648SY66Q1MM2', projectId: '01M6GGBGHYZG3CMXJAJKNT56DE' }, requestedAt: '2026-11-04T08:00:00Z' });
  const stubRows = (rowsByStatus: Record<string, unknown[]>) =>
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      const st = new URL(url, 'http://x').searchParams.get('status') ?? '';
      const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) }) as Response;
      return json({ items: rowsByStatus[st] ?? [], page: 1, pageSize: 200, nextPage: null });
    }));
  it('首次加载：revoked 行不渲染（记录页同样隐藏），approved 行如实展示', async () => {
    stubRows({ pending: [enrollmentRow('pending', '01ENRpend'), enrollmentRow('revoked', '01ENRrevoked')] });
    render(<RegistrationRecords enrollmentsArea={ENROLLMENTS_AREA} />);
    await waitFor(() => expect(document.body.textContent).toContain('01ENRpend'));
    expect(document.body.textContent).not.toContain('01ENRrevoked');
    expect(document.body.textContent).toContain('已吊销记录不在本页展示');
  });
  it('刷新后吊销：同刻返回改为 revoked——下一帧记录行消失', async () => {
    let rowsForPending: unknown[] = [enrollmentRow('pending', '01ENRflip')];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) }) as Response;
      return json({ items: rowsForPending, page: 1, pageSize: 200, nextPage: null });
    }));
    render(<RegistrationRecords enrollmentsArea={ENROLLMENTS_AREA} />);
    await waitFor(() => expect(document.body.textContent).toContain('01ENRflip'));
    rowsForPending = [enrollmentRow('revoked', '01ENRflip')];
    cleanup();
    render(<RegistrationRecords enrollmentsArea={ENROLLMENTS_AREA} />);
    await waitFor(() => expect(document.body.textContent).not.toContain('01ENRflip'));
    expect(document.querySelector('[data-testid="enrollment-status-01ENRflip"]')).toBeNull();
  });
  it('单请求语义回归：只请求一个 status 白名单值，不再有 approved+revoked 留档聚合', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.includes('/ro/enrollments')) seen.push(new URL(url, 'http://x').searchParams.get('status') ?? '');
      const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) }) as Response;
      return json({ items: [], page: 1, pageSize: 200, nextPage: null });
    }));
    render(<RegistrationRecords enrollmentsArea={ENROLLMENTS_AREA} />);
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    await flush();
    expect(seen).toEqual(['pending']); // 无 approved/revoked 聚合请求
    expect(seen.filter((x) => x === 'approved' || x === 'revoked').length).toBe(0);
  });
});

describe('W22.4 截图能力提示与按钮状态一致', () => {
  it('media=false：查看屏幕按钮禁用（不硬改能力），提示语义含 run dev 须核接线、不要求必装打包版', async () => {
    stubRo([baseClient({ deviceScope: { deviceId: U, os: 'darwin', hostname: 'dev-instance' }, capabilities: { media: false, commands: false } })], [dev]);
    render(<ClientStatus clientsArea={CLIENTS_AREA} />);
    await waitFor(() => expect(screen.getByText('dev-instance')).toBeTruthy());
    await flush();
    const btn = screen.getByTestId('media-viewer-01M6JVA2KF08T0VZ0ZZABRAQFJ-01M6DEVICE0000000000000001-start');
    expect(btn.getAttribute('disabled')).not.toBeNull();
    expect(btn.getAttribute('title')).toContain('未声明');
    expect(btn.getAttribute('title')).toContain('登记值为准');
    expect(btn.getAttribute('title')).toContain('重新建立会话');
    // 不默认归因入口接线或打包
    expect(btn.getAttribute('title')).not.toContain('mediaFactory');
    expect(btn.getAttribute('title')).not.toContain('打包');
  });
  it('media=true：按钮可用且提示叠加原授权语义（不因禁用条件混入）', async () => {
    stubRo([baseClient({ deviceScope: { deviceId: U, os: 'darwin', hostname: 'live-host' } })], [dev]);
    render(<ClientStatus clientsArea={CLIENTS_AREA} />);
    await waitFor(() => expect(screen.getByText('live-host')).toBeTruthy());
    await flush();
    const btn = screen.getByTestId('media-viewer-01M6JVA2KF08T0VZ0ZZABRAQFJ-01M6DEVICE0000000000000001-start');
    expect(btn.getAttribute('disabled')).toBeNull();
    expect(btn.getAttribute('title')).toContain('/mv 授权');
  });
});
