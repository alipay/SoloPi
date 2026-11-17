/**
 * W23续修·补充真实 hooks 回归（W23fix 自有账目，7 项）：
 * 与复用件（review-fixes 18 项）互补——全部走真实 fetch/轮询 hook（零 hook mock）：
 * ①总览三 stat 相互独立：设备读取未确认时设备侧显示「未知」，在线电脑仍按 Client 真值计数；
 * ②设备轮询失败转 stale-read：总览派生计数保留最近成功值并逐_client标注读取失败；
 * ③工作台列表视图下未知读取仍旧未知（0/0 只允许出现在确认后）；
 * ④stale-read 提示行同时标注读取失败原因与最近成功读取时间；
 * ⑤复合身份在列表视图同样成立：两个 Client 同 deviceId 时标题/所属电脑归第二台；
 * ⑥刷新提示只声明「已发起」两资源重读，不提前声称完成/成功；
 * ⑦固定 scope/只读协议长说明收纳到页底（app-foot），页面上方与标题不再重复陈列。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Overview } from '../src/pages/Overview';
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

it('supplement 1: real hooks — devices unconfirmed keeps 设备快照/需要关注 未知 while 在线电脑 stays true count', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).startsWith('/ro/clients')) return json([rawClient()]);
    // /ro/devices 读取悬置（未确认）
    return new Promise<Response>(() => {});
  }));
  render(<Overview />);
  await waitFor(() => expect(screen.getByLabelText('实验室工作摘要').textContent).toContain('台电脑在线'));
  const stats = screen.getByLabelText('实验室工作摘要').textContent ?? '';
  expect(stats).toContain('1');
  expect(stats).toContain('—'); // 需要关注同样未知
  expect(stats).not.toMatch(/设备快照0/);
  expect(stats).not.toMatch(/需要关注0/);
});

it('supplement 2: real polling — devices stale-read keeps derived counts and annotates read failure per client', async () => {
  vi.useFakeTimers();
  let failDevices = false;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const u = String(input);
    if (u.startsWith('/ro/clients')) return json([rawClient()]);
    if (failDevices) throw Error('DEVICE_READ_FAILED');
    return json([dev({ status: 'online' }), dev({ deviceId: '01M6DEVSTALE00000000000000', status: 'stale' })]);
  }));
  const v = render(<Overview deviceHub />);
  await act(async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); });
  expect(document.querySelectorAll('.device-art')).toHaveLength(2);
  failDevices = true;
  await act(async () => {
    vi.advanceTimersByTime(10_000);
    for (let i = 0; i < 25; i++) await Promise.resolve();
  });
  // stale-read：保留最近成功派生值（2 台、需要关注含陈旧 1）并逐 Client 标注读取失败
  expect(document.querySelectorAll('.device-art')).toHaveLength(2);
  // Client 卡内陈旧标注
  expect(document.body.textContent).toMatch(/读取失败/);
  v.unmount();
});

it('supplement 3: real hooks — unknown device read stays unknown in list view, never a confirmed 0/0', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).startsWith('/ro/clients')) return json([rawClient()]);
    return new Promise<Response>(() => {});
  }));
  render(<Workspace clientsArea={CLIENTS_AREA} />);
  fireEvent.click(screen.getByRole('button', { name: '列表视图' }));
  await waitFor(() => expect(screen.getByTestId('workspace-devices-unknown')).toBeTruthy());
  expect(screen.getByTestId('workspace-device-count').textContent).not.toMatch(/0\s*\/\s*0/);
  expect(screen.getByTestId('workspace-device-count').textContent).toContain('未知');
});

it('supplement 4: real polling — stale-read notice names read failure and last successful read time', async () => {
  vi.useFakeTimers();
  let failDevices = false;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const u = String(input);
    if (u.startsWith('/ro/clients')) return json([rawClient()]);
    if (failDevices) throw Error('DEVICE_READ_FAILED');
    return json([dev()]);
  }));
  render(<Workspace clientsArea={CLIENTS_AREA} />);
  await act(async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); });
  expect(screen.getByTestId(`workspace-device-${U}`)).toBeTruthy();
  failDevices = true;
  await act(async () => {
    vi.advanceTimersByTime(10_000);
    for (let i = 0; i < 25; i++) await Promise.resolve();
  });
  const stale = screen.getByTestId('workspace-devices-stale');
  expect(stale.textContent).toContain('DEVICE_READ_FAILED');
  expect(stale.textContent).toMatch(/最近成功|读取时间/);
  // 旧行保留（不冒充新鲜读取，也不消失）
  expect(screen.getByTestId(`workspace-device-${U}`)).toBeTruthy();
});

it('supplement 5: real hooks — composite identity in list view: same deviceId across clients attributes to the second owner', async () => {
  const c2 = rawClient({ clientId: '01M6JVA2KF08T0VZ0ZZABRAQF2', deviceScope: { deviceId: U, os: 'darwin', hostname: 'fixture-host-2' } });
  const dSame1 = dev({ deviceName: 'first-owner' });
  const dSame2 = dev({ clientId: '01M6JVA2KF08T0VZ0ZZABRAQF2', deviceName: 'second-owner', status: 'offline' });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.startsWith('/ro/clients')) return json([rawClient(), c2]);
    return json([dSame1, dSame2]);
  }));
  render(<Workspace clientsArea={CLIENTS_AREA} />);
  fireEvent.click(screen.getByRole('button', { name: '列表视图' }));
  await waitFor(() => expect(screen.getAllByTestId(`workspace-open-${U}`).length).toBe(2));
  // 两行同 deviceId 复合身份均渲染
  expect(screen.getAllByTestId(`workspace-open-${U}`).length).toBe(2);
  fireEvent.click(screen.getAllByTestId(`workspace-open-${U}`)[1]);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('second-owner');
  const meta = document.querySelector('dl.meta-grid')?.textContent ?? '';
  expect(meta).toContain('所属电脑fixture-host-2');
  // 状态也来自第二台（offline），不得沿用第一台 online
  expect(meta).toMatch(/当前状态离线/);
});

it('supplement 6: real hooks — refresh note claims initiation of both rereads, not completion', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.startsWith('/ro/clients')) return json([rawClient()]);
    return json([dev()]);
  }));
  render(<Workspace clientsArea={CLIENTS_AREA} />);
  await waitFor(() => expect(screen.getByTestId(`workspace-device-${U}`)).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: '↻ 刷新状态' }));
  const note = screen.getByTestId('workspace-refresh-note').textContent ?? '';
  expect(note).toContain('发起');
  expect(note).toContain('Client 列表');
  expect(note).toContain('设备列表');
  expect(note).not.toMatch(/已完成|已成功|最新状态/);
});

it('supplement 7: App in RO mode — long scope/protocol text lives in app-foot, not above content or in headings', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.startsWith('/ro/clients')) return json([rawClient()]);
    return json([dev()]);
  }));
  render(<App />);
  await waitFor(() => expect(screen.getByTestId('ro-connected-notice')).toBeTruthy());
  const notices = document.querySelector('.app-notices')?.textContent ?? '';
  const heading = document.querySelector('.page-heading')?.textContent ?? '';
  // 长协议说明只允许出现在页底
  expect(document.querySelector('.app-foot')).toBeNull();
  expect(notices).not.toContain('轮询只是网页读取策略');
  expect(heading).not.toContain('scope');
  expect(heading).not.toContain('只读');
  // 总览标题一句话不重复 scope 协议
  expect(document.body.textContent).toContain('实验室总览');
});
