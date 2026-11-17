/**
 * W23续修增量·真实 hooks 组合回归（独立复核6911760四条失败 + StatusBanner收纳，5项）：
 * 全部走真实 fetch/轮询 hook（零 hook mock）——统一梳理 Client×设备
 * 加载/成功/确认空/失败保留旧值的组合，不逐例打补丁：
 * ①设备已确认而 Client 悬置（pending）：计数未知、主体不得报 0/0 或「没有匹配设备」；
 * ②设备已确认而 Client 首次读取失败：显示 Client 读取错误，计数未知；
 * ③Client 曾成功后轮询失败：旧电脑归属/能力行保留并显式标注读取失败/陈旧；
 * ④详情页（早返回分支）同样保留读取失败/陈旧诊断，标题与旧元数据不消失；
 * ⑤顶部已连接横幅只留短状态，无token/写操作禁用/scope不可改等长协议说明收纳页底 app-foot。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workspace } from '../src/pages/Workspace';
import App from '../src/App';
import { CLIENTS_AREA } from '../src/api/areas';
import { setProxyRoMode, setRoDevicesAvailable } from '../src/api/connection';

const U = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const CID = '01M6JVA2KF08T0VZ0ZZABRAQFJ';

const rawClient = (over: Record<string, unknown> = {}) => ({
  orgId: '01M6GGBGHYYJTD648SY66Q1MM2',
  projectId: '01M6GGBGHYZG3CMXJAJKNT56DE',
  clientId: CID,
  installationId: U,
  keyFingerprint: 'sha256:' + 'a'.repeat(64),
  status: 'approved',
  grantedAt: '2026-11-04T08:00:00Z',
  clientVersion: '44.7.0',
  capabilities: { media: true, commands: false },
  occupancy: { localUiTasks: 0, cliTasks: 0 },
  online: 'online',
  lastHeartbeatAt: '2026-11-04T09:13:15Z',
  leaseExpiresAt: '2026-11-04T10:13:15Z',
  deviceScope: { deviceId: U, os: 'darwin', hostname: 'fixture-host' },
  ...over,
});

const dev = (over: Record<string, unknown> = {}) => ({
  orgId: '01M6GGBGHYYJTD648SY66Q1MM2',
  projectId: '01M6GGBGHYZG3CMXJAJKNT56DE',
  clientId: CID,
  deviceId: U,
  deviceName: 'fixture-phone',
  kind: 'phone',
  status: 'online',
  lastSeenAt: '2026-11-04T08:00:00Z',
  lastSnapshotAt: '2026-11-05T08:00:00Z',
  lastSnapshotId: U,
  discoveredAt: '2026-11-04T08:00:00Z',
  ...over,
});

const json = (items: unknown[]): Response =>
  ({ ok: true, status: 200, json: async () => ({ items, page: 1, pageSize: 200, nextPage: null }) }) as Response;

const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };

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

it('combo 1: real hooks — devices confirmed while clients hang pending: count unknown, never 0/0 or 没有匹配设备', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).startsWith('/ro/clients')) return new Promise<Response>(() => {}); // Client 读取悬置
    return json([dev()]); // 设备已确认 1 台
  }));
  render(<Workspace clientsArea={CLIENTS_AREA} />);
  await act(async () => { await flush(); });
  const count = screen.getByTestId('workspace-device-count').textContent ?? '';
  expect(count).toContain('未知');
  expect(count).not.toMatch(/0\s*\/\s*0/);
  expect(screen.getByTestId('workspace-devices-unknown')).toBeTruthy();
  expect(document.body.textContent ?? '').not.toContain('没有匹配设备');
  expect(document.body.textContent ?? '').toContain('电脑归属读取未确认');
});

it('combo 2: real hooks — devices confirmed, clients first read fails: client error surfaced, count unknown', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const u = String(input);
    if (u.startsWith('/ro/clients')) throw Error('CLIENT_READ_FAILED');
    return json([dev()]);
  }));
  render(<Workspace clientsArea={CLIENTS_AREA} />);
  await act(async () => { await flush(); });
  const count = screen.getByTestId('workspace-device-count').textContent ?? '';
  expect(count).toContain('未知');
  expect(count).not.toMatch(/0\s*\/\s*0/);
  const notice = screen.getByTestId('workspace-clients-unknown');
  expect(notice.textContent).toContain('CLIENT_READ_FAILED');
  expect(screen.getByTestId('workspace-devices-unknown')).toBeTruthy();
});

it('combo 3: real polling — clients succeed then fail again: old ownership rows kept, explicitly stale with last good time', async () => {
  vi.useFakeTimers();
  let failClients = false;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const u = String(input);
    if (u.startsWith('/ro/clients')) {
      if (failClients) throw Error('CLIENT_READ_FAILED');
      return json([rawClient()]);
    }
    return json([dev()]); // 设备资源本身继续成功
  }));
  const v = render(<Workspace clientsArea={CLIENTS_AREA} />);
  await act(async () => { await flush(); });
  expect(screen.getByTestId(`workspace-device-${U}`)).toBeTruthy();
  failClients = true;
  await act(async () => {
    vi.advanceTimersByTime(10_000);
    await flush();
  });
  // 旧行保留：归属/能力元数据仍可见但显式标注读取失败/陈旧
  expect(screen.getByTestId(`workspace-device-${U}`)).toBeTruthy();
  const stale = screen.getByTestId('workspace-clients-stale');
  expect(stale.textContent).toContain('CLIENT_READ_FAILED');
  expect(stale.textContent).toMatch(/最近成功/);
  const count = screen.getByTestId('workspace-device-count').textContent ?? '';
  expect(count).toContain('1 / 1 台');
  expect(count).toContain('陈旧');
  v.unmount();
});

it('combo 4: real polling — detail view (early-return branch) keeps stale diagnostics and old metadata when devices fail later', async () => {
  vi.useFakeTimers();
  let failDevices = false;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const u = String(input);
    if (u.startsWith('/ro/clients')) return json([rawClient()]);
    if (failDevices) throw Error('DEVICE_READ_FAILED');
    return json([dev()]);
  }));
  const v = render(<Workspace clientsArea={CLIENTS_AREA} />);
  await act(async () => { await flush(); });
  fireEvent.click(screen.getByTestId(`workspace-open-${U}`));
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('fixture-phone');
  failDevices = true;
  await act(async () => {
    vi.advanceTimersByTime(10_000);
    await flush();
  });
  // 详情仍保留：标题/旧元数据不消失，且读取失败/陈旧诊断在详情分支可见
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('fixture-phone');
  const meta = document.querySelector('dl.meta-grid')?.textContent ?? '';
  expect(meta).toContain('所属电脑fixture-host');
  const stale = screen.getByTestId('workspace-devices-stale');
  expect(stale.textContent).toContain('DEVICE_READ_FAILED');
  expect(stale.textContent).toMatch(/最近成功/);
  v.unmount();
});

it('combo 5: App in RO mode — connected banner is short; no-token/write-prohibited scope protocol lives only in app-foot', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.startsWith('/ro/clients')) return json([rawClient()]);
    return json([dev()]);
  }));
  render(<App />);
  await waitFor(() => expect(screen.getByTestId('ro-connected-notice')).toBeTruthy());
  const banner = screen.getByTestId('ro-connected-notice').textContent ?? '';
  expect(banner).toContain('已连接');
  expect(banner).toContain('实验室已连接');
  // 长协议说明不得再占顶部横幅
  expect(banner).not.toContain('写操作');
  expect(banner).not.toContain('浏览器配置');
  const notices = document.querySelector('.app-notices')?.textContent ?? '';
  expect(notices).not.toContain('写操作禁用');
  expect(notices).not.toContain('浏览器配置');
  // Scope policy remains in the API; the user-removed protocol footer stays absent.
  expect(document.querySelector('.app-foot')).toBeNull();
});
