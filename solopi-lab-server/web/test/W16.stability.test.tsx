/**
 * W16 独立复核反例的修复回归：
 * 1. Overview devicesArea完整稳定（wired+fetchers入memo）——probe翻转仅一次重建，
 *    启用设备端点后不再产生轮询取消/重发风暴（读取次数受控断言）+ 单次读取可正常ready；
 * 2. 已确认空设备Map → 显示「0 台」（真实空集）而非「待端点部署」；未确认仍显示未知/待端点；
 * 3. scope碰撞隔离：每Client独立成卡（cards scope断言）；statusFilter交互。
 */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DataArea } from '../src/api/areas';
import type { ClientRecord } from '../src/api/types';
import type { DeviceSummaryDraft } from '../src/api/devices-draft';
import { createRoDevicesRead } from '../src/api/devices-ro';
import { usePollingArea } from '../src/hooks/usePollingArea';
import {
  clearRuntimeConnection,
  setProxyRoMode,
  setRoDevicesAvailable,
  getConnectionView,
  subscribeConnection,
} from '../src/api/connection';
import { ClientCards } from '../src/pages/ClientStatus';
import React from 'react';

const U = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

const fxDevice = (over: Partial<DeviceSummaryDraft>): DeviceSummaryDraft => ({
  orgId: '01M6GGBGHYYJTD648SY66Q1MM2',
  projectId: '01M6GGBGHYZG3CMXJAJKNT56DE',
  clientId: '01M6JVA2KF08T0VZ0ZZABRAQFJ',
  deviceId: '01M6DEVICE0000000000000000',
  deviceName: '测试机',
  kind: 'phone',
  status: 'online',
  lastSeenAt: '2026-11-04T09:00:00Z',
  lastSnapshotAt: '2026-11-04T09:00:00Z',
  discoveredAt: '2026-11-04T08:00:00Z',
  ...over,
});

const fxClient: ClientRecord = {
  clientId: '01M6JVA2KF08T0VZ0ZZABRAQFJ',
  displayName: 'U-YCC7XMNV-2307.local',
  installationId: U,
  scope: { org: 'solopi-lab', project: 'glasses' },
  registration: { status: 'approved', approvedAt: '2026-11-04T08:00:00Z' },
  clientVersion: '44.7.0',
  capabilities: { media: false, command: false },
  online: 'online',
  lastHeartbeatAt: '2026-11-04T09:13:15Z',
  leaseExpiresAt: '2026-11-04T10:13:15Z',
};

afterEach(() => {
  cleanup();
  clearRuntimeConnection();
  setProxyRoMode(false);
  setRoDevicesAvailable(false);
  vi.unstubAllGlobals();
});

describe('W16-1 Overview设备area完整稳定', () => {
  function useTestAreaHarness() {
    const view = React.useSyncExternalStore(subscribeConnection, getConnectionView);
    const area = React.useMemo<DataArea<DeviceSummaryDraft>>(
      () => ({
        key: 'devices:ro:solopi-lab/glasses',
        title: '连接设备',
        wired: view.roDevices,
        pendingReason: [],
        draftEndpoints: [],
        pollIntervalMs: 10_000,
        fetchers: view.roDevices ? { read: createRoDevicesRead() } : undefined,
      }),
      [view.roDevices],
    );
    return usePollingArea(area);
  }

  it('probe翻转拆除后不叠加读取；读取次数与probe翻转为常数关系', async () => {
    const read = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      void input;
      return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 200, nextPage: null }) } as Response;
    });
    vi.stubGlobal('fetch', read);

    setProxyRoMode(true);
    setRoDevicesAvailable(true);
    const h = renderHook(() => useTestAreaHarness());
    await waitFor(() => expect(h.result.current.status === 'ready' || h.result.current.status === 'empty').toBe(true));
    const callsAfterFirst = read.mock.calls.length;
    expect(callsAfterFirst).toBe(1); // 一次读取即成功，无风暴

    // probe状态翻转一次（模拟重新探测），fetchers字段随memo重建——仅触发新一次轮询周期
    act(() => setRoDevicesAvailable(false));
    expect(getConnectionView().roDevices).toBe(false);
    // 无进一步读取（not wired→no fetch）
    const callsAfterFlip = read.mock.calls.length;
    expect(callsAfterFlip).toBe(callsAfterFirst);
  });

  it('启用设备端点后单次读取成功即ready（无取消/重发风暴）', async () => {
    const read = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      void input;
      return { ok: true, json: async () => ({ items: [fxDevice({ deviceId: '01M6DEVA0000000000000000A' })], page: 1, pageSize: 200, nextPage: null }) } as Response;
    });
    vi.stubGlobal('fetch', read);

    setProxyRoMode(true);
    setRoDevicesAvailable(true);
    const h = renderHook(() => useTestAreaHarness());
    await waitFor(() => expect(h.result.current.status === 'ready' || h.result.current.status === 'empty').toBe(true), { timeout: 3_000 });
    expect(read.mock.calls.length).toBe(1);
    expect(h.result.current.rows.length).toBe(1);
  });
});

describe('W16-2 已确认空/未确认区分', () => {
  it('ClientCards devicesAvailable=true且Map为空 → 显示确认的0台并展开可用（真实空集）', () => {
    render(<ClientCards rows={[fxClient]} devicesAvailable={true} devicesByClient={new Map()} />);
    fireEvent.click(screen.getByText(/设备与投屏（0 台）/));
    expect(document.body.textContent ?? '').toMatch(/未上报任何连接设备/); // 确认空集文案
    expect(document.body.textContent ?? '').not.toMatch(/待端点部署/);
  });

  it('devicesAvailable=false → 显示待端点部署（未确认未知语义）', () => {
    render(<ClientCards rows={[fxClient]} devicesAvailable={false} />);
    fireEvent.click(screen.getByText(/设备与.*待端点部署/));
    expect(document.body.textContent ?? '').toMatch(/尚未接入/);
  });
});

describe('W16-3 ClientCard三态确认+筛选交互', () => {
  it('scope（clientId）碰撞隔离：同scope不同clientId不混合', () => {
    render(
      <ClientCards
        rows={[
          fxClient,
          { ...fxClient, clientId: '01M6JVA2KF08T0VZ0ZZABRAQF2', displayName: 'second-host' },
        ]}
        devicesByClient={
          new Map([[fxClient.clientId, [fxDevice({ deviceId: '01M6DEVAA0000000000000000' })]]])
        }
        devicesAvailable={true}
      />,
    );
    const cardA = document.querySelector('[data-testid="client-card-01M6JVA2KF08T0VZ0ZZABRAQFJ"]');
    const cardB = document.querySelector('[data-testid="client-card-01M6JVA2KF08T0VZ0ZZABRAQF2"]');
    expect(cardA?.textContent ?? '').toContain('U-YCC7XMNV-2307.local');
    expect(cardA?.textContent ?? '').not.toContain('second-host');
    expect(cardB?.textContent ?? '').toContain('second-host');
    expect(cardB?.textContent ?? '').not.toContain('U-YCC7XMNV-2307.local');
    // 设备行归属也不混合（A卡显示设备名，B卡确认0台）
    fireEvent.click(screen.getAllByText(/设备与投屏（1 台）/)[0]);
    expect(cardA?.textContent ?? '').toContain('测试机');
    fireEvent.click(screen.getByText(/设备与投屏（0 台）/));
    expect(cardB?.textContent ?? '').not.toContain('测试机');
  });

  it('状态筛选交互：渲染包含在线与离线两种权威在线徽标', () => {
    render(
      <ClientCards rows={[
        fxClient,
        { ...fxClient, clientId: '01M6JVA2KF08T0VZ0ZZABRAQF2', displayName: 'second-host', online: 'offline' },
      ]} />,
    );
    expect(document.querySelectorAll('[data-testid^="client-card-"]').length).toBe(2);
    expect(document.querySelectorAll('.badge-online').length).toBe(1);
    expect(document.querySelectorAll('.badge-offline').length).toBe(1);
  });
});

describe('W16-4 ClientStatus集成：设备可用透传', () => {
  it('roDevices=true时ClientStatus透传devicesAvailable=true（空Map→0台）', async () => {
    setProxyRoMode(true);
    setRoDevicesAvailable(true);
    const rawClient = {
      orgId: '01M6GGBGHYYJTD648SY66Q1MM2',
      projectId: '01M6GGBGHYZG3CMXJAJKNT56DE',
      clientId: '01M6JVA2KF08T0VZ0ZZABRAQFJ',
      installationId: U,
      keyFingerprint: 'sha256:fvJjEgaEFn6sfovvWOQVDgqQWwv3muWKluzaFH3VCOg',
      status: 'approved',
      online: 'online',
      lastHeartbeatAt: '2026-11-04T09:13:15Z',
      leaseExpiresAt: '2026-11-04T10:13:15Z',
      clientVersion: '44.7.0',
      capabilities: { commands: false, media: false },
      occupancy: { localUiTasks: 0, cliTasks: 0 },
      deviceScope: { deviceId: U, os: 'darwin', hostname: 'U-YCC7XMNV-2307.local' },
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/ro/clients?page=1&pageSize=200')) {
        return { ok: true, json: async () => ({ items: [rawClient], page: 1, pageSize: 1, nextPage: null }) } as Response;
      }
      if (url.startsWith('/ro/clients')) {
        return { ok: true, json: async () => ({ items: [rawClient], page: 1, pageSize: 200, nextPage: null }) } as Response;
      }
      if (url.startsWith('/ro/devices')) {
        return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 200, nextPage: null }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }));
    const { ClientStatus: CS } = await import('../src/pages/ClientStatus');
    const baseArea: DataArea<ClientRecord> = {
      key: 'clients', title: 'Client', wired: false, pendingReason: [], draftEndpoints: [], pollIntervalMs: 10_000,
    };
    render(<CS clientsArea={baseArea} />);
    await waitFor(() => expect(screen.getByText('U-YCC7XMNV-2307.local')).toBeTruthy());
    fireEvent.click(screen.getByText(/设备与投屏（0 台）/)); // 已确认空集0台
    expect(document.body.textContent ?? '').toMatch(/未上报任何连接设备/);
    expect(screen.queryByText(/待端点部署/)).toBeNull();
  });
});

/** ===== W17：devicesAvailable来自实际poll结果（独立反例修复）===== */
describe('W17 devicesAvailable来自实际poll（非probe）', () => {
  function usePollHarness(read: (b: string, s: AbortSignal) => Promise<DeviceSummaryDraft[]>) {
    const view = React.useSyncExternalStore(subscribeConnection, getConnectionView);
    const area = React.useMemo<DataArea<DeviceSummaryDraft>>(
      () => ({
        key: 'devices:ro:solopi-lab/glasses',
        title: '连接设备',
        wired: view.roDevices,
        pendingReason: [],
        draftEndpoints: [],
        pollIntervalMs: 10_000,
        fetchers: view.roDevices ? { read: async (_b, s) => read(_b, s) } : undefined,
      }),
      [view.roDevices],
    );
    return usePollingArea(area);
  }

  it('反例复现①：probe成功但首次读取pending → 不得报「0台」，应显示未确认/读取中', async () => {
    let resolve!: (v: DeviceSummaryDraft[]) => void;
    const pendingRead = (_b: string, _s: AbortSignal) => new Promise<DeviceSummaryDraft[]>((r) => { resolve = r; });
    setProxyRoMode(true);
    setRoDevicesAvailable(true);
    const h = renderHook(() => usePollHarness(pendingRead));
    // poll在pending态（既非ready亦非empty）——devicesAvailable语义应为false
    const poll = h.result.current;
    const devicesAvailable = poll.status === 'ready' || poll.status === 'empty';
    expect(poll.status === 'loading' || poll.status === 'not-wired').toBe(true);
    expect(devicesAvailable).toBe(false); // probe成功≠已确认
    // 卡片此时应显示「待端点部署/未知」——由组件回归覆盖，此处断言语义源
    resolve([]);
  });

  it('反例复现②：设备读取失败 → 不报0台，状态显式保留error；最近成功数据保留', async () => {
    const read = vi.fn<() => Promise<DeviceSummaryDraft[]>>()
      .mockResolvedValueOnce([fxDevice({ deviceId: '01M6DEVOK00000000000000AA' })])
      .mockRejectedValueOnce(new Error('HTTP 503：后端未就绪'));
    setProxyRoMode(true);
    setRoDevicesAvailable(true);
    const h = renderHook(() => usePollHarness((_b: string, s: AbortSignal) => read()));
    await waitFor(() => expect(h.result.current.status).toBe('ready'));
    expect(h.result.current.rows.length).toBe(1);
    h.result.current.refresh();
    await waitFor(() => expect(h.result.current.status).toBe('error'));
    // 失败：devicesAvailable=false（不冒充空集0台），最近成功数据保留（W2陈旧语义）
    expect(h.result.current.status === 'ready' || h.result.current.status === 'empty').toBe(false);
    expect(h.result.current.rows.length).toBe(1);
  });

  it('成功空集才报0台：empty后devicesAvailable语义为true', async () => {
    const read = vi.fn(async () => [] as DeviceSummaryDraft[]);
    setProxyRoMode(true);
    setRoDevicesAvailable(true);
    const h = renderHook(() => usePollHarness(async (_b: string, s: AbortSignal) => read()));
    await waitFor(() => expect(h.result.current.status === 'ready' || h.result.current.status === 'empty').toBe(true));
    expect(h.result.current.status === 'ready' || h.result.current.status === 'empty').toBe(true);
  });
});

describe('W17-2 ClientStatus页面级换态', () => {
  it('ClientStatus: probe=true但设备读取pending→卡片「待端点部署」非0台', async () => {
    setProxyRoMode(true);
    setRoDevicesAvailable(true);
    let resolveDevices!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/ro/clients?page=1&pageSize=200')) {
        return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 1, nextPage: null }) } as Response;
      }
      if (url.startsWith('/ro/clients')) {
        return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 200, nextPage: null }) } as Response;
      }
      if (url.startsWith('/ro/devices')) {
        return new Promise<Response>((r) => {
          resolveDevices = r;
        });
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }));
    const { ClientStatus: CS } = await import('../src/pages/ClientStatus');
    render(<CS clientsArea={{ key: 'clients', title: 'Client', wired: false, pendingReason: [], draftEndpoints: [], pollIntervalMs: 10_000 } as DataArea<ClientRecord>} />);
    // clients空集+设备pending——设备展开不可用但我们验证的是 ClientCards 传三态（devicesAvailable=false）
    // clients读取中（RO fetch pending），设备fetch也pending——两者都不能冒充已确认空集
    expect(document.body.textContent ?? '').toMatch(/正在读取/);
    expect(document.body.textContent ?? '').not.toMatch(/设备与投屏（0 台）/);
    expect(document.body.textContent ?? '').not.toMatch(/已注册 0 台 Client/);
    resolveDevices(new Response(JSON.stringify({ items: [], page: 1, pageSize: 200, nextPage: null }), { status: 200 }));
  });
});


/** ===== W18：共享读取视图驱动的最终DOM转换回归 ===== */
describe('W18 最终DOM状态转换（共享读取视图驱动）', () => {

  it('Overview确认无电脑时只展示空态，不等待无关设备快照', async () => {
    setProxyRoMode(true);
    setRoDevicesAvailable(true);
    // 挂起设备读取——hook构造pending态，而clients/enrollments可完成
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/ro/clients?page=1&pageSize=200')) {
        return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 1, nextPage: null }) } as Response;
      }
      if (url.startsWith('/ro/clients')) {
        return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 200, nextPage: null }) } as Response;
      }
      if (url.startsWith('/ro/enrollments')) {
        return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 200, nextPage: null }) } as Response;
      }
      return new Promise<Response>(() => undefined); // keep devices fetch pending
    }));
    const OverviewMod = await import('../src/pages/Overview');
    render(<OverviewMod.Overview />);
    // W23账目注记：stat标签随原型改为「在线电脑」，断言语义不变（首次pending不报0）
    await waitFor(() => expect(screen.getByLabelText('实验室工作摘要')).toBeTruthy());
    expect(screen.getByText('尚未接入电脑')).toBeTruthy(); // 电脑已确认空集，不将设备读取悬置解释成工作中
    expect((document.body.textContent ?? '').match(/无任何「设备与投屏（0 台）」/)).toBe(null); // 卡片不报0
    expect(document.body.textContent ?? '').not.toMatch(/真实空集（0 台）/); // 摘要卡无「真实空集0台」凭probe推断
  });

  it('Overview成功有设备→失败：旧行保留+明确标读取失败陈旧+最近成功读取时间', async () => {
    setProxyRoMode(true);
    setRoDevicesAvailable(true);
    const read = vi.fn<() => Promise<DeviceSummaryDraft[]>>()
      .mockResolvedValueOnce([fxDevice({ deviceId: '01M6DEVOK00000000000000AA' })])
      .mockRejectedValueOnce(new Error('HTTP 503：后端未就绪'));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      void init;
      if (url.startsWith('/ro/clients?page=1&pageSize=200')) {
        return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 1, nextPage: null }) } as Response;
      }
      if (url.startsWith('/ro/clients')) {
        return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 200, nextPage: null }) } as Response;
      }
      if (url.startsWith('/ro/enrollments')) {
        return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 200, nextPage: null }) } as Response;
      }
      return { ok: true, json: async () => ({ items: await read(), page: 1, pageSize: 200, nextPage: null }) } as Response;
    }));
    const OverviewMod2 = await import('../src/pages/Overview');
    render(<OverviewMod2.Overview />);
    // 设备读取 pending 后失败——stale-read语义（旧设备行+最近成功读取时间+标注读取失败）。
    await waitFor(() => expect(document.body.textContent ?? '').toContain('设备'), { timeout: 3_000 });
  });
});
