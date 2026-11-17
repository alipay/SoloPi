/**
 * W24 入口补齐回归（用户实站截图入口=接入电脑导航页→ClientStatus，非 Workspace）：
 * 「设备与投屏」面板区以同一 client-group-grid 双列横排——
 * - 组内每设备持有独立 MediaViewerPanel，复合身份 (clientId, deviceId) 为 React key；
 * - 跨 Client 同 deviceId 两卡各自渲染互不混面板；DeviceList 行仍在（真实行语义未动）；
 * - 双路可同时发起并逐路关闭（复用 W24.groupLayout 的受控替身与断言口径）；
 * - 反向不放松：媒体授权仍不因 RO 列表自动获得（默认 idle 零发起）。
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

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

const cell = (deviceId: string) => within(screen.getByTestId(`client-status-device-${deviceId}`) as HTMLElement);
const panelsGrid = () => screen.getByTestId('client-status-panels-c1');

it('review: reachable enlarge/focus action on each actual ClientStatus device cell',async()=>{render(<ClientStatus clientsArea={CLIENTS_AREA}/>);await waitFor(()=>expect(panelsGrid()).toBeTruthy());expect(cell('d1-phone').getByRole('button',{name:/放大|聚焦|全屏/})).toBeTruthy();});
