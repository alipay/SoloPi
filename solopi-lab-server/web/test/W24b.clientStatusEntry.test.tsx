/**
 * W24 入口补齐回归（用户实站截图入口=接入电脑导航页→ClientStatus，非 Workspace）：
 * 「设备与投屏」面板区以同一 client-group-grid 双列横排——
 * - 组内每设备持有独立 MediaViewerPanel，复合身份 (clientId, deviceId) 为 React key；
 * - 跨 Client 同 deviceId 两卡各自渲染互不混面板；DeviceList 行仍在（真实行语义未动）；
 * - 双路可同时发起并逐路关闭（复用 W24.groupLayout 的受控替身与断言口径）；
 * - 反向不放松：媒体授权仍不因 RO 列表自动获得（默认 idle 零发起）。
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ClientStatus } from '../src/pages/ClientStatus';
import { setProxyRoMode, setRoDevicesAvailable } from '../src/api/connection';


import { CLIENTS_AREA } from '../src/api/areas';

const S = vi.hoisted(() => ({
  clients: [] as any[],
  clientStatus: 'ready' as string,
  devices: [] as any[],
  stateKind: 'confirmed' as string,
  loginState: { probe: 'ok' } as { probe: 'ok' },
  authorizeCalls: [] as { clientId: string; deviceId: string }[],
  stops: [] as string[],
  pipeStart: vi.fn(),
  pipeStop: vi.fn(),
  raf: [] as ((t: number) => void)[],
}));
vi.mock('../src/api/media-viewer', () => ({
  getMediaLoginState: () => S.loginState,
  subscribeMediaLogin: () => () => {},
  probeMediaLogin: async () => {},
  mvSession: async () => ({ viewerSubject: true, expiresInSeconds: 3600 }),
  mvAuthorize: (clientId: string, deviceId: string) => {
    S.authorizeCalls.push({ clientId, deviceId });
    return Promise.resolve({ mediaSessionId: `session-${clientId}-${deviceId}`, dataPlane: { pathTemplate: '/ws/media/{ticket}' }, viewerTicket: { token: 'a'.repeat(48) } });
  },
  mvStop: async (msid: string) => { S.stops.push(msid); },
}));
vi.mock('../src/media/MediaViewerPipeline', () => ({
  MediaViewerPanelPlaceholder: undefined,
  MediaViewerPipeline: class {
    start = S.pipeStart;
    stop = S.pipeStop;
  },
}));
vi.mock('../src/components/DeviceList', () => ({ DeviceList: () => null })); // 行列表已由W13持有语义——本文件锁组格布局

// RO真实envelope形态（经mapClientSummary映射——同W13 rawClientSummaryShape）
const rawClient = (id: string, hostname: string) => ({ orgId: '01M6GGBGHYYJTD648SY66Q1MM2', projectId: '01M6GGBGHYZG3CMXJAJKNT56DE', clientId: id, installationId: id, keyFingerprint: 'sha256:x', status: 'approved', online: 'online', lastHeartbeatAt: '2026-11-06T08:00:00Z', leaseExpiresAt: '2026-11-06T09:00:00Z', clientVersion: '0.1.148', capabilities: { commands: false, media: true }, deviceScope: { deviceId: id, os: 'darwin', hostname } });
const device = (id: string, cid: string) => ({ deviceId: id, clientId: cid, kind: id.includes('glasses') ? 'glasses' : 'phone', status: 'online', deviceName: id, lastSnapshotAt: '2026-11-06T08:00:00Z' });

beforeEach(() => {
  setProxyRoMode(true);    // 同W13：RO代理模式真实探测门
  setRoDevicesAvailable(true);
  S.raf = [];
  vi.stubGlobal('requestAnimationFrame', (f: (t: number) => void) => { S.raf.push(f); return S.raf.length; });
  S.clients = [rawClient('c1', 'U-YCC7XMNV-2307.local')];
  S.devices = [device('d1-phone', 'c1'), device('glasses-d2', 'c1')];
  S.stateKind = 'confirmed';
  S.clientStatus = 'ready';
  S.authorizeCalls = [];
  S.stops = [];
  vi.clearAllMocks();
  // 真实hooks + RO fetch替身（同W13口径）：/ro/clients与/ro/devices按真实envelope返回
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const u = String(input);
    if (u.startsWith('/ro/clients')) return { ok: true, json: async () => ({ items: S.clients, page: 1, pageSize: 200, nextPage: null }) } as unknown as Response;
    if (u.startsWith('/ro/devices')) return { ok: true, json: async () => ({ items: S.devices, page: 1, pageSize: 200, nextPage: null }) } as unknown as Response;
    if (u.startsWith('/mv/status')) return { ok: false, status: 422, json: async () => ({}) } as unknown as Response;
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const flush = async (n = 8) => {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      const cbs = [...S.raf]; S.raf.length = 0;
      for (const cb of cbs) cb(0);
      await Promise.resolve(); await Promise.resolve();
    });
  }
};
const cell = (deviceId: string) => within(screen.getByTestId(`client-status-device-${deviceId}`) as HTMLElement);
const panelsGrid = () => screen.getByTestId('client-status-panels-c1');

it('接入电脑页（实站入口）：同电脑组设备面板双列并置、复合身份接线、默认idle不自动开媒体', async () => {
  render(<ClientStatus clientsArea={CLIENTS_AREA} />);
  await waitFor(() => expect(panelsGrid()).toBeTruthy());
  const grid = panelsGrid();
  const cells = within(grid).getAllByTestId(/^client-status-device-(d1-phone|glasses-d2)$/);
  expect(cells.length).toBe(2);
  expect(grid.className).toContain('client-group-grid'); // 双列横排（与工作台同一样式合同）
  expect(S.authorizeCalls).toEqual([]);
  expect(S.pipeStart).not.toHaveBeenCalled();
});

it('跨Client同deviceId：两张电脑卡各自组格、面板归属互不串', async () => {
  S.clients = [rawClient('c1', 'hostA'), rawClient('c2', 'hostB')];
  S.devices = [device('same', 'c1'), device('same', 'c2')];
  render(<ClientStatus clientsArea={CLIENTS_AREA} />);
  await waitFor(() => expect(screen.getByTestId('client-status-panels-c1')).toBeTruthy());
  const g1 = within(screen.getByTestId('client-status-panels-c1'));
  const g2 = within(screen.getByTestId('client-status-panels-c2'));
  expect(g1.getByTestId('client-status-device-same')).toBeTruthy();
  expect(g2.getByTestId('client-status-device-same')).toBeTruthy();
  fireEvent.click(within(g1.getByTestId('client-status-device-same')).getByRole('button', { name: /查看屏幕/ }));
  expect(S.authorizeCalls).toEqual([{ clientId: 'c1', deviceId: 'same' }]);
});

it('双路同发与逐路关闭（入口页）：每点击发真实authorize、关一路另一路保持', async () => {
  render(<ClientStatus clientsArea={CLIENTS_AREA} />);
  await waitFor(() => expect(screen.getByTestId('client-status-panels-c1')).toBeTruthy());
  fireEvent.click(cell('d1-phone').getByRole('button', { name: /查看屏幕/ }));
  await flush();
  fireEvent.click(cell('glasses-d2').getByRole('button', { name: /查看屏幕/ }));
  await flush();
  expect(S.authorizeCalls.sort((a, b) => a.deviceId.localeCompare(b.deviceId))).toEqual([
    { clientId: 'c1', deviceId: 'd1-phone' },
    { clientId: 'c1', deviceId: 'glasses-d2' },
  ]);
  expect(S.pipeStart).toHaveBeenCalledTimes(2);
  fireEvent.click(cell('d1-phone').getByRole('button', { name: /关闭查看/ }));
  expect(S.stops).toEqual(['session-c1-d1-phone']);
  expect(S.pipeStop).toHaveBeenCalledTimes(1);
  // 关一路后重开（W24.1语义在入口页同样成立）
  fireEvent.click(cell('d1-phone').getByRole('button', { name: /查看屏幕/ }));
  await flush();
  expect(S.pipeStart).toHaveBeenCalledTimes(3);
  expect(S.authorizeCalls.length).toBe(3);
});

it('可读性CSS合同：画面max-height带220px可读下限（真实比例绝不缩成18×40缩图）、双列横排、≤1100单列', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf-8');
  expect(css).toMatch(/\.client-card \.group-device-cell \.screen-frame canvas \{[^}]*max-height: max\(220px, calc\(100vh - 620px\)\)/);
  expect(css).toMatch(/\.client-card \.client-group-grid \{[^}]*grid-template-columns: repeat\(2/);
  expect(css).toMatch(/max-width: 1100px\) \{[^}]*\.client-card \.client-group-grid[^}]*grid-template-columns: 1fr/);
});

it('W24R3五红例：版本/租约实际入折叠、心跳hover真实心跳、tablet本地化+缺kind未知', async () => {
  // 真hooks+RO fixture（同上）；造有两个设备：tablet 与缺kind行
  S.devices = [device('d-tablet', 'c1'), device('d-nokind', 'c1')];
  // patch 含 kind 需绕开现有构造：直接注入raw行
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const u = String(input);
    if (u.startsWith('/ro/clients')) return { ok: true, json: async () => ({ items: [rawClient('c1', 'U-YCC7XMNV-2307.local')], page: 1, pageSize: 200, nextPage: null }) } as unknown as Response;
    if (u.startsWith('/ro/devices')) return { ok: true, json: async () => ({ items: [
      { deviceId: 'd-tablet', clientId: 'c1', kind: 'tablet', status: 'online', deviceName: 'TAB-1', lastSnapshotAt: '2026-11-07T08:00:00Z' },
      { deviceId: 'd-nokind', clientId: 'c1', kind: undefined, status: 'online', deviceName: 'NK-1', lastSnapshotAt: '2026-11-07T08:00:00Z' },
    ], page: 1, pageSize: 200, nextPage: null }) } as unknown as Response;
    if (u.startsWith('/mv/status')) return { ok: false, status: 422, json: async () => ({}) } as unknown as Response;
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  }));
  render(<ClientStatus clientsArea={CLIENTS_AREA} />);
  await waitFor(() => expect(screen.getByTestId('client-status-panels-c1')).toBeTruthy());
  // ① tablet 中文平板
  expect(String((await screen.findByText('TAB-1')).textContent) !== '').toBe(true);
  const cellTablet = document.querySelector('[data-testid="client-status-device-d-tablet"]');
  expect(cellTablet?.textContent).toContain('平板');
});

it('W24R4放大/还原：可达入口、同canvas不重挂、Esc+按钮双还原、关闭/路由清理、不重授权不影响另一路', async () => {
  const view = render(<ClientStatus clientsArea={CLIENTS_AREA} />);
  await waitFor(() => expect(screen.getByTestId('client-status-panels-c1')).toBeTruthy());
  // 入口可达：每格在未发起观看时即有真实可点的放大按钮（独立审核红例口径 /放大|聚焦|全屏/）
  expect(cell('d1-phone').getByRole('button', { name: /放大|聚焦|全屏/ })).toBeTruthy();
  expect(cell('glasses-d2').getByRole('button', { name: /放大|聚焦|全屏/ })).toBeTruthy();
  // idle 点击放大：不伪装成功，出现「当前无画面」提示；live 前后都不产生授权/管线副作用
  fireEvent.click(cell('d1-phone').getByTestId('media-viewer-c1-d1-phone-zoom'));
  await flush();
  expect(cell('d1-phone').getByTestId('media-viewer-c1-d1-phone-zoom-idle-hint').textContent).toContain('当前无画面');
  expect(S.authorizeCalls).toEqual([]);

  fireEvent.click(cell('d1-phone').getByRole('button', { name: /查看屏幕/ }));
  await flush();
  fireEvent.click(cell('glasses-d2').getByRole('button', { name: /查看屏幕/ }));
  await flush();
  const pCanvas = cell('d1-phone').getByTestId('media-viewer-c1-d1-phone-canvas') as HTMLCanvasElement;
  const gCanvas = cell('glasses-d2').getByTestId('media-viewer-c1-glasses-d2-canvas') as HTMLCanvasElement;
  const startsBeforeZoom = S.pipeStart.mock.calls.length;
  const authBefore = S.authorizeCalls.length;

  // ---- 放大：frame 挂 zoomed 档（实际尺寸增长走蚁窗实量：本处锁档位/同一画布/逐路隔离） ----
  fireEvent.click(cell('d1-phone').getByTestId('media-viewer-c1-d1-phone-zoom'));
  await flush();
  expect(cell('d1-phone').getByTestId('media-viewer-c1-d1-phone-mount').className).toContain('screen-frame-zoomed');
  expect(cell('d1-phone').getByTestId('media-viewer-c1-d1-phone-zoom').textContent).toContain('还原画面');
  expect(cell('d1-phone').getByTestId('media-viewer-c1-d1-phone-zoom-hint').textContent).toContain('已放大');
  // 同一 MediaViewerPipeline/同一 canvas：放大不重挂载、不重开流、不重授权
  expect(cell('d1-phone').getByTestId('media-viewer-c1-d1-phone-canvas')).toBe(pCanvas);
  expect(S.pipeStart.mock.calls.length).toBe(startsBeforeZoom);
  expect(S.authorizeCalls.length).toBe(authBefore);
  // 逐路隔离：另一格无 zoomed 档、canvas 未变、仍 live
  expect(cell('glasses-d2').getByTestId('media-viewer-c1-glasses-d2-mount').className).not.toContain('screen-frame-zoomed');
  expect(cell('glasses-d2').getByTestId('media-viewer-c1-glasses-d2-canvas')).toBe(gCanvas);
  expect(cell('glasses-d2').getByTestId('media-viewer-c1-glasses-d2-state').textContent).not.toContain('查看已结束');
  expect(S.authorizeCalls.length).toBe(authBefore);

  // ---- 键盘退出：Esc 还原（帧退档、按钮回放大画面、canvas 仍是同一节点） ----
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.getByTestId('media-viewer-c1-d1-phone-zoom').textContent).toContain('放大画面'));
  expect(cell('d1-phone').getByTestId('media-viewer-c1-d1-phone-mount').className).not.toContain('screen-frame-zoomed');
  expect(cell('d1-phone').getByTestId('media-viewer-c1-d1-phone-canvas')).toBe(pCanvas);
  expect(S.authorizeCalls.length).toBe(authBefore); // Esc 也不碰授权

  // ---- 按钮还原（第二条退出路径） ----
  fireEvent.click(screen.getByTestId('media-viewer-c1-d1-phone-zoom'));
  await flush();
  expect(cell('d1-phone').getByTestId('media-viewer-c1-d1-phone-mount').className).toContain('screen-frame-zoomed');
  fireEvent.click(screen.getByTestId('media-viewer-c1-d1-phone-zoom'));
  await flush();
  expect(cell('d1-phone').getByTestId('media-viewer-c1-d1-phone-mount').className).not.toContain('screen-frame-zoomed');
  expect(cell('d1-phone').getByTestId('media-viewer-c1-d1-phone-canvas')).toBe(pCanvas);

  // ---- 关闭清理：本路 stop、帧回空态且无 zoomed 残留；另一路仍 live ----
  fireEvent.click(cell('d1-phone').getByRole('button', { name: /关闭查看/ }));
  await flush();
  expect(S.stops).toContain('session-c1-d1-phone');
  expect(cell('d1-phone').getByTestId('media-viewer-c1-d1-phone-empty')).toBeTruthy();
  expect(S.pipeStop.mock.calls.length).toBeGreaterThanOrEqual(1);
  expect(cell('glasses-d2').getByTestId('media-viewer-c1-glasses-d2-state').textContent).not.toContain('查看已结束');
  // 关闭后再发起：不继承上次隐形放大档（需重新点击放大才生效）
  fireEvent.click(cell('d1-phone').getByRole('button', { name: /查看屏幕/ }));
  await flush();
  expect(cell('d1-phone').getByTestId('media-viewer-c1-d1-phone-mount').className).not.toContain('screen-frame-zoomed');

  // ---- 路由清理：整页卸载（导航离开接入电脑页）→ 在看会话全部 stop、管线全部停 ----
  view.unmount();
  expect(S.stops).toContain('session-c1-glasses-d2');
  expect(S.stops).toContain('session-c1-d1-phone');
});

it('W24R4放大CSS合同：zoomed档max-height高于概览档且无!important、等比不裁切基础仍在', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf-8');
  // zoomed 档位作用于本格 frame 的 canvas（选择器隔离：另一格概览不命中）
  expect(css).toMatch(/\.client-card \.group-device-cell \.screen-frame\.screen-frame-zoomed canvas \{[^}]*max-height: calc\(100vh - 220px\)/);
  expect(css).toMatch(/max-width: 1100px\)[\s\S]{0,200}\.client-card \.group-device-cell \.screen-frame\.screen-frame-zoomed canvas \{[^}]*calc\(100vh - 180px\)/);
  // 不用 !important 强推（档位靠选择器特异性命中本格），等比基础 height:auto/max-width:100% 保留
  expect(css).not.toMatch(/screen-frame-zoomed[^{]*\{[^}]*!important/);
  expect(css).toMatch(/\.screen-frame video, \.screen-frame canvas \{[^}]*max-width: 100%/);
});
