/**
 * 分版本测试账目：W14 pages审批3项→注册记录2项，124→123；
 * W15 RO投影+1→124；W16确认空集+1与稳定性7→132；
 * W17+4→136；W18+2→138。后续新增页面反例单独计数。
 * scope/card分组只证明本地展示，不证明服务端跨scope授权。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CLIENTS_AREA } from '../src/api/areas';
import { DeviceList } from '../src/components/DeviceList';
import { ScreenViewPanel } from '../src/components/ScreenViewPanel';
import { ClientCards } from '../src/pages/ClientStatus';
import type { DeviceSummaryDraft } from '../src/api/devices-draft';
import type { ClientRecord } from '../src/api/types';

const U = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

/** fixtures 仅本测试文件使用，不进 src/ 与正式页面 */
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

afterEach(() => cleanup());

describe('W13 DeviceList', () => {
  it('wired=false：「尚未接入」卡——不渲染任何设备行', () => {
    render(<DeviceList clientId="c1" wired={false} rows={[fxDevice({})]} />);
    expect(document.querySelector('[data-testid="devices-unwired-c1"]')).not.toBeNull();
    expect(document.body.textContent ?? '').toMatch(/设备列表.*尚未接入/);
    expect(document.querySelectorAll('table').length).toBe(0); // 无表=无设备行
    expect(screen.queryByText('测试机')).toBeNull();
  });

  it('wired=true：四态徽标+kind标签+时间列全渲染', () => {
    const rows = [
      fxDevice({ deviceId: 'd1', deviceName: '我的手机', kind: 'phone', status: 'online' }),
      fxDevice({ deviceId: 'd2', deviceName: '眼镜A', kind: 'glasses', status: 'stale' }),
      fxDevice({ deviceId: 'd3', deviceName: '旧平板', kind: 'tablet', status: 'offline' }),
      fxDevice({ deviceId: 'd4', deviceName: '其他设备', kind: 'other', status: 'offline' }),
    ];
    render(<DeviceList clientId="c1" wired={true} rows={rows} />);
    expect(document.querySelectorAll('[data-testid="devices-list-c1"] tbody tr').length).toBe(4);
    expect(screen.getByText('我的手机')).toBeTruthy();
    expect(screen.getByText('眼镜')).toBeTruthy(); // kind标签
    expect(screen.getByText('在线')).toBeTruthy();
    expect(screen.getByText('陈旧')).toBeTruthy();
    expect(screen.getAllByText('离线').length).toBeGreaterThanOrEqual(2);
    // v0.2.0(519be67)：设备三态均由status唯一输出——页面不再渲染独立「未知」设备态
    expect(screen.queryByText('未知设备')).toBeNull();
  });

  it('wired=true 空集：显示服务端确认空集，不冒充设备', () => {
    render(<DeviceList clientId="c2" wired={true} rows={[]} />);
    expect(document.querySelector('[data-testid="devices-empty-c2"]')?.textContent ?? '').toMatch(
      /未上报任何连接设备/,
    );
  });
});

describe('W13 ScreenViewPanel', () => {
  it('wired=false：按钮禁用、无任何 img/video/canvas（不假报画面）', () => {
    render(<ScreenViewPanel clientId="c1" deviceId="d1" state={{ wired: false }} />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/查看屏幕.*尚未接入/);
    expect(text).toMatch(/不因只读列表自动获得/);
    const buttons = screen.getAllByRole('button');
    for (const b of buttons) expect(b.hasAttribute('disabled')).toBe(true);
    expect(document.querySelectorAll('img, video, canvas').length).toBe(0); // 关键：零画面元素
    expect(document.querySelectorAll('[data-testid^="screen-panel-"] .screen-frame').length).toBe(0);
  });

  it('wired=true + active + 挂载点：渲染children画面区+四层证据', () => {
    render(
      <ScreenViewPanel
        clientId="c1"
        deviceId="d1"
        state={{
          wired: true,
          sessionStatus: 'active',
          evidenceLayers: { packetReceived: 120, decodedFrames: 118, rendered: 118, audioPlayed: null },
          lastEvidenceAt: '2026-11-04T09:20:00Z',
        }}
      >
        <video data-testid="real-live-video" />
      </ScreenViewPanel>,
    );
    expect(screen.getByText('投屏中')).toBeTruthy();
    expect(document.querySelector('[data-testid="screen-panel-c1-d1-mount"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="real-live-video"]')).not.toBeNull();
    const ev = screen.getByTestId('screen-panel-c1-d1-evidence').textContent ?? '';
    expect(ev).toContain('120');
    expect(ev).toContain('声音播放 未知'); // audioPlayed=null→未知（audio=false已知约束如实）
    // active态：停止可点，查看屏幕禁用
    const stop = screen.getByRole('button', { name: '停止查看' });
    expect(stop.hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: '查看屏幕' }).hasAttribute('disabled')).toBe(true);
  });

  it('wired=true + active 无证据/无挂载点：明确「会话建立≠出帧」，不渲染画面', () => {
    render(<ScreenViewPanel clientId="c1" deviceId="d2" state={{ wired: true, sessionStatus: 'active' }} />);
    expect(document.body.textContent ?? '').toMatch(/不以会话建立冒充出帧/);
    expect(document.querySelectorAll('img, video, canvas').length).toBe(0);
  });

  it('状态机：stopped→可重新查看；failed→显示原因；abandoned→超时文案', () => {
    const onStop = vi.fn();
    const { rerender } = render(
      <ScreenViewPanel clientId="c1" deviceId="d3" state={{ wired: true, sessionStatus: 'active' }} onStop={onStop} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '停止查看' }));
    expect(onStop).toHaveBeenCalledTimes(1);
    rerender(
      <ScreenViewPanel clientId="c1" deviceId="d3" state={{ wired: true, sessionStatus: 'failed', error: '证据超时' }} />,
    );
    expect(document.body.textContent ?? '').toMatch(/投屏失败：证据超时/);
    rerender(
      <ScreenViewPanel clientId="c1" deviceId="d3" state={{ wired: true, sessionStatus: 'abandoned' }} />,
    );
    expect(document.body.textContent ?? '').toMatch(/授权已超时放弃/);
    rerender(
      <ScreenViewPanel clientId="c1" deviceId="d3" state={{ wired: true, sessionStatus: 'stopped' }} />,
    );
    expect(screen.getByRole('button', { name: '查看屏幕' }).hasAttribute('disabled')).toBe(false);
  });

  it('stale/offline 语义：面板unknown态不冒称投屏可用', () => {
    render(
      <ScreenViewPanel clientId="c1" deviceId="d4" state={{ wired: true, sessionStatus: 'unknown' }} />,
    );
    expect(document.body.textContent ?? '').toMatch(/证据未知/);
  });
});

describe('W13 正式页面集成（fixtures不进正式页；卡片语义）', () => {
  it('ClientCard未确认设备态：诚实「待端点部署」块与屏panel未接入（无画面元素）', () => {
    render(<ClientCards rows={[fxClient]} devicesAvailable={false} />);
    expect(document.body.textContent ?? '').toMatch(/设备与投屏（待端点部署）/);
    expect(document.querySelector('[data-testid="devices-unwired-01M6JVA2KF08T0VZ0ZZABRAQFJ"]')).not.toBeNull();
    // W20（r5.1媒体面已部署）:未确认设备态不渲染per-device查看面板——无从指定目标不造假入口
    expect(document.querySelectorAll('[data-testid^="media-viewer-"]').length).toBe(0);
    expect(document.querySelectorAll('img, video, canvas').length).toBe(0); // 正式页零画面元素
    expect(document.body.textContent ?? '').not.toContain('测试机'); // fixture名称不出现
  });

  it('ClientCard已确认空集态：显示0台（真实空集）而非「待端点部署」', () => {
    render(<ClientCards rows={[fxClient]} devicesAvailable={true} devicesByClient={new Map()} />);
    expect(document.body.textContent ?? '').toMatch(/设备与投屏（0 台）/);
    expect(document.body.textContent ?? '').not.toMatch(/待端点部署/);
  });
});

/** ===== W13b：RO设备面接线（/ro/devices probe门控 + 按Client分组）===== */
import { createRoDevicesRead, groupDevicesByClient, probeRoDevices } from '../src/api/devices-ro';
import { setProxyRoMode, setRoDevicesAvailable } from '../src/api/connection';

describe('W13b RO设备探测与接线', () => {
  it('probeRoDevices：合法分页envelope→true；SPA回退HTML（非JSON）→false；404→false', async () => {
    const okEnv = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 1, nextPage: null }) } as Response;
    });
    vi.stubGlobal('fetch', okEnv);
    await expect(probeRoDevices()).resolves.toBe(true);
    expect(String(vi.mocked(okEnv).mock.calls[0][0])).toBe('/ro/devices?page=1&pageSize=200');
    vi.unstubAllGlobals();

    const htmlFallback = vi.fn(async () => ({ ok: true, json: async () => { throw new Error('Unexpected token <'); } }) as unknown as Response);
    vi.stubGlobal('fetch', htmlFallback);
    await expect(probeRoDevices()).resolves.toBe(false);
    vi.unstubAllGlobals();

    const notFound = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response);
    vi.stubGlobal('fetch', notFound);
    await expect(probeRoDevices()).resolves.toBe(false);
  });

  it('W15：DeviceSummaryDraft（519be67）无 adbSerial/discoveryFingerprint/冗余online——RO最小投影形状断言', () => {
    const d = fxDevice({});
    expect(Object.hasOwn(d, 'adbSerial')).toBe(false);
    expect(Object.hasOwn(d, 'discoveryFingerprint')).toBe(false);
    expect(Object.hasOwn(d, 'online')).toBe(false); // 唯一status字段，冗余online废除
    expect(d.status).toBe('online');
    expect(d.discoveredAt).toBeTruthy();
  });

  it('createRoDevicesRead：URL仅/ro/devices+page/pageSize，无Authorization、无orgId（scope服务端固定）', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 200, nextPage: null }) } as Response;
    }));
    const rows = await createRoDevicesRead()('', new AbortController().signal);
    expect(rows).toEqual([]);
    expect(calls[0].url.startsWith('/ro/devices?')).toBe(true);
    expect(calls[0].url).not.toContain('orgId');
    expect(((calls[0].init?.headers ?? {}) as Record<string, string>).Authorization).toBeUndefined();
  });

  it('groupDevicesByClient：按clientId分组不混（跨client行不互渗）', () => {
    const a: DeviceSummaryDraft = { ...fxDevice({ clientId: 'clientA', deviceId: 'dA' }) };
    const b: DeviceSummaryDraft = { ...fxDevice({ clientId: 'clientB', deviceId: 'dB' }) };
    const map = groupDevicesByClient([a, b]);
    expect(map.get('clientA')).toEqual([a]);
    expect(map.get('clientB')).toEqual([b]);
    expect(map.size).toBe(2);
  });

  it('ClientStatus集成：roDevices=true时按Client渲染真实设备行（含pending设备行屏panel仍诚实未接入）', async () => {
    setProxyRoMode(true);
    setRoDevicesAvailable(true);
    const realDevice = fxDevice({
      clientId: '01M6JVA2KF08T0VZ0ZZABRAQFJ',
      deviceId: '01M6DEVREAL0000000000000Y0',
      deviceName: '我的Android测试机',
      kind: 'phone',
      status: 'online',
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/ro/clients')) {
        return { ok: true, json: async () => ({ items: [rawClientSummaryShape()], page: 1, pageSize: 200, nextPage: null }) } as Response;
      }
      if (url.startsWith('/ro/devices')) {
        return { ok: true, json: async () => ({ items: [realDevice], page: 1, pageSize: 200, nextPage: null }) } as Response;
      }
      if (url.startsWith('/ro/enrollments')) {
        return { ok: true, json: async () => ({ items: [], page: 1, pageSize: 200, nextPage: null }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }));
    const { ClientStatus } = await import('../src/pages/ClientStatus');
    render(<ClientStatus clientsArea={CLIENTS_AREA} />);
    // W24R2入口补齐：设备名现同时出现在DeviceList行与组内面板格头（同一真实行两处呈现）
    await waitFor(() => expect(screen.getAllByText('我的Android测试机').length).toBeGreaterThan(0));
    expect(screen.getByText('设备与投屏（1 台）')).toBeTruthy(); // summary计数
    // W20（r5.1媒体面已部署）:按设备行挂载真实查看面板（媒体授权不因RO获得——须/mv登录授权）
    expect(document.querySelectorAll('[data-testid^="media-viewer-"]').length).toBeGreaterThan(0);
    expect(document.body.textContent ?? '').toMatch(/屏幕查看.*未在查看/); // 诚实初态：非查看中
    expect(document.body.textContent ?? '').not.toMatch(/投屏中|已呈现/); // 未呈现不冒充
    expect(document.querySelectorAll('img, video, canvas').length).toBe(0); // 未查看态零画面元素
  });

  it('ClientStatus集成：roDevices=false（端点未部署）→设备列表保持诚实「尚未接入」', async () => {
    setProxyRoMode(true);
    setRoDevicesAvailable(false); // SPA回退→probe false
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/ro/clients')) {
        return { ok: true, json: async () => ({ items: [rawClientSummaryShape()], page: 1, pageSize: 200, nextPage: null }) } as Response;
      }
      if (url.startsWith('/ro/devices')) {
        return { ok: true, json: async () => { throw new Error('Unexpected token <'); } } as unknown as Response; // SPA HTML回退
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }));
    const { ClientStatus } = await import('../src/pages/ClientStatus');
    render(<ClientStatus clientsArea={CLIENTS_AREA} />);
    await waitFor(() => expect(screen.getByText('U-YCC7XMNV-2307.local')).toBeTruthy());
    // 设备面probe=false→面积不轮询，客户端行设备格保持诚实未接入卡
    expect(document.querySelector('[data-testid="devices-unwired-01M6JVA2KF08T0VZ0ZZABRAQFJ"]')).not.toBeNull();
    expect(screen.queryByText('我的Android测试机')).toBeNull(); // 无设备数据渲染
  });

  /** 合同raw clientSummary形状（服务端JSON），映射由createRoClientsRead完成 */
  function rawClientSummaryShape(): Record<string, unknown> {
    return {
      orgId: '01M6GGBGHYYJTD648SY66Q1MM2',
      projectId: '01M6GGBGHYZG3CMXJAJKNT56DE',
      clientId: '01M6JVA2KF08T0VZ0ZZABRAQFJ',
      installationId: '01M6JSXAY61X7FJMGJBY06ER9M',
      keyFingerprint: 'sha256:fvJjEgaEFn6sfovvWOQVDgqQWwv3muWKluzaFH3VCOg',
      status: 'approved',
      online: 'online',
      lastHeartbeatAt: '2026-11-04T09:13:15Z',
      leaseExpiresAt: '2026-11-04T10:13:15Z',
      clientVersion: '44.7.0',
      capabilities: { commands: false, media: false },
      occupancy: { localUiTasks: 0, cliTasks: 0 },
      deviceScope: { deviceId: '01M6JSXAY61X7FJMGJBY06ER9M', os: 'darwin', hostname: 'U-YCC7XMNV-2307.local' },
    };
  }
});
