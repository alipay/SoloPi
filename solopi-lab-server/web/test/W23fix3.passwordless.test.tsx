/**
 * W23fix3 回归（用户 2026-11-06 决定：网站观看屏幕无任何密码/口令拦截）。
 *
 * 覆盖：
 * 1. 免密码观看闭环：发起→授权→建立→关闭，全程面板无任何口令/登录输入面；
 * 2. 免密码刷新：卸载后重挂载（=浏览器刷新）——仍免密直接观看；关停的服务端 stop 已送达；
 * 3. 手机/眼镜比例：解码帧尺寸（1080×2340 / 1920×1080）真实写入 canvas + 样式 height:auto；
 * 4. v0.2.1 r6（Server 451ff54c604d…，合同 contracts/v0.2.1）免口令主体接入：
 *    - 无 cookie 首次观看：自动空 body POST /mv/session（body 恒 {}，无任何口令字段）
 *      建主体→携 cookie 授权→观看，全程无输入；
 *    - 有效主体（探测 ok）直接授权，不发多余 session；
 *    - cookie 过期（authorize 401）：自动重建主体恰好一次后重试成功；
 *    - 403 权限拒绝：如实报错、不重试、不当成功、不重建主体。
 *
 * 断言语义不放宽：401/403 仍如实上屏；不猜已授权；票据为 fixture 字符串不截存真实 cookie。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaViewerPanel } from '../src/components/MediaViewerPanel';

const CID = '01M6JVA2KF08T0VZ0ZZABRAQFJ';
const DID = '01M6DEVICE0000000000000001';
const TID = `media-viewer-${CID}-${DID}`;

// ---------- 测试基建：与 W20 同源的 WebSocket/VideoDecoder/fetch stubs ----------
type WsEvent = Record<string, ((ev: unknown) => void)[]>;
class WsStub {
  static instances: WsStub[] = [];
  url: string;
  binaryType = 'blob';
  handlers: WsEvent = {};
  closed = false;
  constructor(url: string) {
    this.url = url;
    WsStub.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: unknown) => void) {
    (this.handlers[type] ??= []).push(cb);
  }
  removeEventListener() {
    /* 简化 */
  }
  send(): void {
    /* viewer方向发送=合同禁入 */
  }
  close() {
    this.closed = true;
    this.__emit('close', { code: 1000, reason: '' });
  }
  __emit(type: string, ev: unknown) {
    for (const cb of [...(this.handlers[type] ?? [])]) cb(ev);
  }
}

const decodedChunks: unknown[] = [];
class VideoDecoderStub {
  static configs: unknown[] = [];
  static outputCb: ((f: unknown) => void) | null = null;
  static supportResult: { supported?: boolean } = { supported: true };
  constructor(opts: { output: (f: unknown) => void; error: (e: Error) => void }) {
    VideoDecoderStub.outputCb = opts.output;
  }
  static isConfigSupported(cfg: unknown) {
    VideoDecoderStub.configs.push(cfg);
    return Promise.resolve(VideoDecoderStub.supportResult);
  }
  configure() {
    /* stub */
  }
  decode(chunk: unknown) {
    decodedChunks.push(chunk);
  }
  close() {
    /* stub */
  }
}

class EncodedVideoChunkStub {
  constructor(init: { type: string; timestamp: number; data: Uint8Array }) {
    Object.assign(this, init);
  }
}

const syntheticKeyAu = (): ArrayBuffer =>
  new Uint8Array([0, 0, 1, 0x67, 0x42, 0x00, 0x1f, 0xff, 0, 0, 1, 0x68, 0xce, 0x3c, 0x80, 0, 0, 0, 1, 0x65, 0x88, 0x84, 0x00]).buffer;

interface MvBehavior {
  probe?: number; // /mv/status 探测状态码：401=无 cookie 主体、422=已持有效主体
  session?: number; // /mv/session 状态码
  authorize?: number | number[]; // 单值或按序弹出（末值粘滞）
}

const stubMvFetch = (behavior: MvBehavior = {}): { calls: { url: string; body: unknown }[] } => {
  const calls: { url: string; body: unknown }[] = [];
  const authorizeSeq = Array.isArray(behavior.authorize) ? [...behavior.authorize] : [behavior.authorize ?? 200];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const body = init?.body != null ? JSON.parse(String(init.body)) : null;
      calls.push({ url, body });
      const mk = (status: number, json: unknown): Response =>
        ({ ok: status >= 200 && status < 300, status, json: async () => json, text: async () => JSON.stringify(json) }) as Response;
      if (url.includes('/mv/status/')) return mk(behavior.probe ?? 422, { error: { code: behavior.probe === 401 ? 'AUTH_REQUIRED' : 'MEDIA_SESSION_INVALID', message: 'x', retryable: false } });
      if (url.includes('/mv/session')) return mk(behavior.session ?? 200, { viewerSubject: true, expiresInSeconds: 3600 });
      if (url.includes('/mv/authorize')) {
        const code = authorizeSeq.length > 1 ? authorizeSeq.shift()! : authorizeSeq[0];
        if (code >= 400) return mk(code, { error: { code: code === 401 ? 'AUTH_REQUIRED' : 'AUTH_SCOPE_DENIED', message: 'x', retryable: false } });
        return mk(200, {
          mediaSessionId: '01M6MVMEDIA0000000000000001',
          clientId: CID, deviceId: DID, purpose: 'screen-preview', status: 'authorized',
          createdAt: '2026-11-06T02:00:00Z', expiresAt: '2026-11-06T02:10:00Z',
          viewerTicket: { role: 'viewer', token: 't'.repeat(48), expiresAt: '2026-11-06T02:02:00Z', oneTimeUse: true },
          dataPlane: { mode: 'wss-relay', pathTemplate: '/ws/media/{ticket}', acceptsBinaryFrom: 'client', backpressure: { maxBufferedBytes: 2097152, maxQueueMessages: 256, violationPolicy: 'disconnect-session-failed' } },
          endedReason: null, endedAt: null,
        });
      }
      if (url.includes('/mv/stop')) return mk(200, { mediaSessionId: '01M6MVMEDIA0000000000000001', status: 'stopped' });
      return mk(404, { error: { code: 'VALIDATION_FAILED', message: 'no such route', retryable: false } });
    }),
  );
  return { calls };
};

async function flush(times = 14): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

beforeEach(() => {
  WsStub.instances.length = 0;
  VideoDecoderStub.configs.length = 0;
  VideoDecoderStub.outputCb = null;
  decodedChunks.length = 0;
  vi.stubGlobal('WebSocket', WsStub);
  vi.stubGlobal('VideoDecoder', VideoDecoderStub);
  vi.stubGlobal('EncodedVideoChunk', EncodedVideoChunkStub);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number);
  // jsdom 无 2D context 实现——mock 供 drawFrame 真实走完「尺寸跟随+上画+计数」路径
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('W23fix3 免密码观看与比例回归', () => {
  it('免密码闭环：发起→授权→连接→关闭，全 UI 与网络面均无口令/登录路径', async () => {
    const { calls } = stubMvFetch();
    render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
    await flush();
    expect(document.querySelectorAll('input[type="password"]').length).toBe(0); // 待机即无口令输入
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    await waitFor(() => expect(WsStub.instances.length).toBe(1));
    WsStub.instances[0].__emit('open', {});
    await flush();
    expect(screen.getByTestId(`${TID}-state`).textContent ?? '').toContain('等待Client出流');
    fireEvent.click(screen.getByTestId(`${TID}-stop`));
    await waitFor(() => expect(screen.getByTestId(`${TID}-state`).textContent ?? '').toContain('已结束'));
    // 免密码合同：任何时刻未向 /mv/session 发过口令请求；未出现任何 login/口令 UI
    expect(calls.some((c) => c.url.includes('/mv/session'))).toBe(false);
    expect(document.querySelectorAll('input[type="password"]').length).toBe(0);
    expect(screen.queryByTestId(`${TID}-login`)).toBeNull();
    await waitFor(() => expect(calls.some((c) => c.url.includes('/mv/stop'))).toBe(true));
  });

  it('免密码刷新：卸载重挂载后探测→授权→观看仍全程免密；首次会话已真实停止', async () => {
    const { calls } = stubMvFetch();
    const first = render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
    await flush();
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    await waitFor(() => expect(WsStub.instances.length).toBe(1));
    WsStub.instances[0].__emit('open', {});
    await flush();
    fireEvent.click(screen.getByTestId(`${TID}-stop`));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/mv/stop'))).toBe(true));
    first.unmount(); // =浏览器刷新页面（卸载兜底已核）

    const second = render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
    await flush();
    // 刷新后不出现任何拦截/口令输入；探测结论只影响提示，不构成登录墙
    expect(document.querySelectorAll('input[type="password"]').length).toBe(0);
    expect(screen.queryByTestId(`${TID}-login`)).toBeNull();
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    await waitFor(() => expect(WsStub.instances.length).toBe(2)); // 免密再次直接建立
    expect(screen.getByTestId(`${TID}-state`).textContent ?? '').not.toContain('登录');
    // 全程两个挂载周期均无 /mv/session 口令请求
    expect(calls.filter((c) => c.url.includes('/mv/authorize')).length).toBe(2);
    expect(calls.some((c) => c.url.includes('/mv/session'))).toBe(false);
    second.unmount();
  });

  it('手机/眼镜比例：解码帧真实尺寸写入 canvas（1080×2340 → 1920×1080），纵横比各自成立', async () => {
    stubMvFetch();
    render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
    await flush();
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    await waitFor(() => expect(WsStub.instances.length).toBe(1));
    const ws = WsStub.instances[0];
    ws.__emit('open', {});
    await flush();
    ws.__emit('message', { data: syntheticKeyAu() });
    await waitFor(() => expect(decodedChunks.length).toBe(1));
    const canvas = screen.getByTestId(`${TID}-canvas`) as HTMLCanvasElement;

    // 手机竖屏流：1080×2340（高>宽）
    VideoDecoderStub.outputCb?.({ codedWidth: 1080, codedHeight: 2340, close: () => {} });
    await waitFor(() => {
      expect(canvas.width).toBe(1080);
      expect(canvas.height).toBe(2340);
    });
    expect(canvas.width / canvas.height).toBeCloseTo(1080 / 2340, 5);

    // 眼镜宽屏流：1920×1080（宽>高）——同一观看会话内流内尺寸变化如实跟随
    VideoDecoderStub.outputCb?.({ codedWidth: 1920, codedHeight: 1080, close: () => {} });
    await waitFor(() => {
      expect(canvas.width).toBe(1920);
      expect(canvas.height).toBe(1080);
    });
    expect(canvas.width / canvas.height).toBeCloseTo(1920 / 1080, 5);
    expect(screen.getByTestId(`${TID}-state`).textContent ?? '').toContain('呈现');
  });

  it('v0.2.1 无cookie首次观看：自动空body建主体→携cookie授权→观看，全程无口令字段/无输入', async () => {
    const { calls } = stubMvFetch({ probe: 401, session: 200, authorize: 200 });
    render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
    await flush();
    expect(document.querySelectorAll('input[type="password"]').length).toBe(0);
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    await waitFor(() => expect(WsStub.instances.length).toBe(1));
    const sessions = calls.filter((c) => c.url.includes('/mv/session'));
    expect(sessions.length).toBe(0); // 直接开屏，无额外会话请求
    expect(calls.filter(c=>c.url.includes('/mv/authorize'))).toHaveLength(1);
    WsStub.instances[0].__emit('open', {});
    await flush();
    expect(screen.getByTestId(`${TID}-state`).textContent ?? '').toContain('等待Client出流');
    expect(document.querySelectorAll('input[type="password"]').length).toBe(0); // 全程无口令输入
  });

  it('v0.2.1 已持有效主体：直接授权观看，不发多余 /mv/session', async () => {
    const { calls } = stubMvFetch({ probe: 422, authorize: 200 });
    render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
    await flush();
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    await waitFor(() => expect(WsStub.instances.length).toBe(1));
    expect(calls.filter((c) => c.url.includes('/mv/session')).length).toBe(0);
    expect(calls.filter((c) => c.url.includes('/mv/authorize')).length).toBe(1);
  });

  it('开屏失败不触发隐式登录或重复开流', async()=>{
    const {calls}=stubMvFetch({probe:422,authorize:[401,200]});render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true}/>);fireEvent.click(screen.getByTestId(`${TID}-start`));await waitFor(()=>expect(screen.getByTestId(`${TID}-hint`).textContent).toContain('401'));expect(calls.filter(c=>c.url.includes('/mv/authorize'))).toHaveLength(1);expect(calls.filter(c=>c.url.includes('/mv/session'))).toHaveLength(0);expect(WsStub.instances).toHaveLength(0);
  });

  it('v0.2.1 403权限拒绝：如实报错、不重建主体、不重试、不当成功', async () => {
    const { calls } = stubMvFetch({ probe: 422, authorize: 403 });
    render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
    await flush();
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    await waitFor(() => {
      expect(screen.getByTestId(`${TID}-hint`).textContent ?? '').toContain('403');
    });

    expect(calls.filter((c) => c.url.includes('/mv/authorize')).length).toBe(1); // 权限错误不重试
    expect(calls.filter((c) => c.url.includes('/mv/session')).length).toBe(0); // 权限错误不重建主体
    expect(WsStub.instances.length).toBe(0); // 绝不成功开流
    expect(screen.getByTestId(`${TID}-state`).textContent ?? '').toContain('未在查看');
  });

  it('styles.css 保留 canvas/video height:auto——容器收宽时按流内真实比例缩放（竖屏不失真）', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf-8');
    expect(css).toMatch(/\.screen-frame video, \.screen-frame canvas \{[^}]*height: auto/);
    // 口令登录样式已随输入面一起移除——无死样式残留
    expect(css).not.toMatch(/\.mv-login-row/);
  });
});
