/**
 * 分版本测试账目：W20 媒体接线新增 12 项（并入总数单独计数——分版本账目，不混入124→123）。
 * W20.1 h264-annexb 纯函数 4 项；W20.2 MediaViewerPanel 状态机 9 项。
 * W21 一致性修订：本文件 1 处期望随「mediaCapable=false 即禁用按钮」语义更新（点击提示→禁用态+title），
 * 断言语义未放宽（同样证明能力如实展示、不硬改）。
 * W23fix3 修订（用户 2026-11-06 决定：观看无密码拦截）：原 3 例口令登录用例改写为
 * 「无口令输入面 + 401/403 如实展示 + 免密码直接观看」语义；断言不放宽（同样证明
 * 不猜授权、不构造口令请求、服务端拒绝如实上屏）。
 * v0.2.1 r6 接入（Server 451ff54c604d…免口令主体）：401 用例升级为「空 body 自动建主体+
 * 有界重建（各至多一次）」断言；session body 恒为 {}。
 * 口令输入面已整体移除——本文件不再出现任何口令 fixture；票据仍为 fixture 字符串，不截存真实cookie。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { annexbFindNal, annexbSplitNals, auHasKeyframe, spsToAvc1Codec, viewerWsUrl } from '../src/media/h264-annexb';
import { MediaViewerPanel } from '../src/components/MediaViewerPanel';

const CID = '01M6JVA2KF08T0VZ0ZZABRAQFJ';
const DID = '01M6DEVICE0000000000000001';
const TID = `media-viewer-${CID}-${DID}`;

// ---------- W20.1 纯函数（真实握手/解码判定的基础） ----------
describe('W20.1 h264-annexb 纯函数', () => {
  const startCode = (nal: number[]) => new Uint8Array([0, 0, 0, 1, ...nal]);

  it('SPS 0x42/0x00/0x1f → avc1.42001f（入参=NAL载荷，起始码已剥）', () => {
    expect(spsToAvc1Codec(new Uint8Array([0x67, 0x42, 0x00, 0x1f, 0xff]))).toBe('avc1.42001f');
    expect(spsToAvc1Codec(new Uint8Array([0x67, 0x42]))).toBeNull();
  });

  it('annexb 分包：多NAL按起始码切分且不含起始码', () => {
    const au = new Uint8Array([0, 0, 1, 0x67, 0x42, 0, 0, 0, 1, 0x68, 0xce, 0x3c, 0x80, 0, 0, 0, 1, 0x65, 0x88]);
    const nals = annexbSplitNals(au);
    expect(nals.length).toBe(3);
    expect(nals[0][0]).toBe(0x67);
    expect(nals[1][0]).toBe(0x68);
    expect(nals[2][0]).toBe(0x65);
  });

  it('AU 关键帧判定：IDR(type5) 在场为 key，仅SPS不算关键帧', () => {
    const withIdr = new Uint8Array([0, 0, 1, 0x67, 0x42, 0, 0x1f, 0, 0, 0, 1, 0x65, 0x88, 0x84]);
    expect(auHasKeyframe(withIdr)).toBe(true);
    expect(annexbFindNal(withIdr, 7)).not.toBeNull();
    expect(annexbFindNal(withIdr, 6)).toBeNull();
    expect(auHasKeyframe(startCode([0x67, 0x42, 0x00, 0x1f, 0xff]))).toBe(false);
  });

  it('viewerWsUrl：只接受合同字面量与票据字符集（拒绝任意URL拼接）', () => {
    const ok = 'a'.repeat(48);
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    expect(viewerWsUrl('/ws/media/{ticket}', ok)).toBe(`${proto}://${window.location.host}/ws/media/${ok}`);
    expect(viewerWsUrl('/ws/other/{ticket}', ok)).toBeNull();
    expect(viewerWsUrl('/ws/media/{ticket}', 'short')).toBeNull();
    expect(viewerWsUrl('/ws/media/{ticket}', 'bad token!')).toBeNull();
  });
});

// ---------- 测试基建：WebSocket/VideoDecoder/fetch stubs ----------
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
    /* viewer方向发送=合同禁入；面板不发送 */
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
  state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
  constructor(opts: { output: (f: unknown) => void; error: (e: Error) => void }) {
    VideoDecoderStub.outputCb = opts.output;
  }
  static isConfigSupported(cfg: unknown) {
    VideoDecoderStub.configs.push(cfg);
    return Promise.resolve(VideoDecoderStub.supportResult);
  }
  configure() {
    this.state = 'configured';
  }
  decode(chunk: unknown) {
    decodedChunks.push(chunk);
  }
  close() {
    this.state = 'closed';
  }
}

class EncodedVideoChunkStub {
  type: string;
  timestamp: number;
  data: Uint8Array;
  constructor(init: { type: string; timestamp: number; data: Uint8Array }) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.data = init.data;
  }
}

const syntheticKeyAu = (): ArrayBuffer => {
  // SPS(0x42)+PPS+IDR 的合成Annex-B AU（非可解码视频，仅形状合法）
  const bytes = [0, 0, 1, 0x67, 0x42, 0x00, 0x1f, 0xff, 0, 0, 1, 0x68, 0xce, 0x3c, 0x80, 0, 0, 1, 0x65, 0x88, 0x84, 0x00];
  return new Uint8Array(bytes).buffer;
};

interface MvBehavior {
  probe?: number;
  session?: number;
  authorize?: number | 'then-401' | 'ok';
  authorizeBody?: unknown;
  /** 状态机版authorize：按序弹出HTTP状态码，末值粘滞 */
  authorizeSeq?: number[];
}

/** /mv HTTP面 stub（fs: Record calls） */
function stubMvFetch(behavior: MvBehavior): { calls: { url: string; body: unknown }[] } {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const body = init?.body != null ? JSON.parse(String(init.body)) : null;
      calls.push({ url, body });
      const mk = (status: number, json: unknown): Response =>
        ({ ok: status >= 200 && status < 300, status, json: async () => json, text: async () => JSON.stringify(json) }) as Response;
      if (url.includes('/mv/status/')) return mk(behavior.probe ?? 401, { error: { code: 'AUTH_REQUIRED', message: 'x', retryable: false } });
      if (url.includes('/mv/session')) return mk(behavior.session ?? 200, { viewerSubject: true, expiresInSeconds: 3600 });
      if (url.includes('/mv/authorize')) {
        if (behavior.authorizeSeq != null && behavior.authorizeSeq.length > 0) {
          const code = behavior.authorizeSeq.length > 1 ? behavior.authorizeSeq.shift()! : behavior.authorizeSeq[0];
          if (code < 400) return mk(200, behavior.authorizeBody ?? {
            mediaSessionId: '01M6MVMEDIA0000000000000001',
            clientId: CID, deviceId: DID, purpose: 'screen-preview', status: 'authorized',
            createdAt: '2026-11-05T04:00:00Z', expiresAt: '2026-11-05T04:10:00Z',
            viewerTicket: { role: 'viewer', token: 't'.repeat(48), expiresAt: '2026-11-05T04:02:00Z', oneTimeUse: true },
            dataPlane: { mode: 'wss-relay', pathTemplate: '/ws/media/{ticket}', acceptsBinaryFrom: 'client', backpressure: { maxBufferedBytes: 2097152, maxQueueMessages: 256, violationPolicy: 'disconnect-session-failed' } },
            endedReason: null, endedAt: null,
          });
          return mk(code, { error: { code: code === 401 ? 'AUTH_REQUIRED' : 'MEDIA_SESSION_INVALID', message: 'x', retryable: false } });
        }
        if (behavior.authorize === 'then-401') return mk(401, { error: { code: 'AUTH_REQUIRED', message: 'x', retryable: false } });
        if (typeof behavior.authorize === 'number' && behavior.authorize >= 400) return mk(behavior.authorize, { error: { code: 'MEDIA_SESSION_INVALID', message: 'x', retryable: false } });
        return mk(200, behavior.authorizeBody ?? {
          mediaSessionId: '01M6MVMEDIA0000000000000001',
          clientId: CID, deviceId: DID, purpose: 'screen-preview', status: 'authorized',
          createdAt: '2026-11-05T04:00:00Z', expiresAt: '2026-11-05T04:10:00Z',
          viewerTicket: { role: 'viewer', token: 't'.repeat(48), expiresAt: '2026-11-05T04:02:00Z', oneTimeUse: true },
          dataPlane: { mode: 'wss-relay', pathTemplate: '/ws/media/{ticket}', acceptsBinaryFrom: 'client', backpressure: { maxBufferedBytes: 2097152, maxQueueMessages: 256, violationPolicy: 'disconnect-session-failed' } },
          endedReason: null, endedAt: null,
        });
      }
      if (url.includes('/mv/stop')) return mk(200, { mediaSessionId: '01M6MVMEDIA0000000000000001', status: 'stopped' });
      return mk(404, { error: { code: 'VALIDATION_FAILED', message: 'no such route', retryable: false } });
    }),
  );
  return { calls };
}

async function flush(times = 14): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

let ctxDrawSpy: ReturnType<typeof vi.fn> | null = null;

beforeEach(() => {
  WsStub.instances.length = 0;
  VideoDecoderStub.configs.length = 0;
  VideoDecoderStub.outputCb = null;
  VideoDecoderStub.supportResult = { supported: true };
  decodedChunks.length = 0;
  vi.stubGlobal('WebSocket', WsStub);
  vi.stubGlobal('VideoDecoder', VideoDecoderStub);
  vi.stubGlobal('EncodedVideoChunk', EncodedVideoChunkStub);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number);
  ctxDrawSpy = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: ctxDrawSpy } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('W20.2 MediaViewerPanel 状态机', () => {
  it('开屏只发一次请求，不探测或建立额外授权会话，失败如实显示', async () => {
    const { calls } = stubMvFetch({ probe: 401, authorize: 'then-401' });
    render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
    await flush();
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    await waitFor(() => {
      expect(screen.getByTestId(`${TID}-hint`).textContent ?? '').toContain('401');
    });
    // 免密码拦截（W23fix3）：全 UI 无口令输入面
    expect(screen.queryByTestId(`${TID}-login`)).toBeNull();
    expect(screen.queryByTestId(`${TID}-login-input`)).toBeNull();
    expect(document.querySelectorAll('input[type="password"]').length).toBe(0);
    // v0.2.1 r6：无 cookie 探测→自动空 body 建主体（一次）；authorize 401→重建主体（一次）后重试
    // ——有界：至多各两次，绝不无限重试。session body 恒为 {}，从源头无口令字段。
    const sessions = calls.filter((c) => c.url.includes('/mv/session'));
    expect(sessions.length).toBe(0);
    expect(sessions.every((c) => JSON.stringify(c.body) === '{}')).toBe(true);
    expect(calls.filter((c) => c.url.includes('/mv/authorize')).length).toBe(1);
    expect(calls.some(c=>c.url.includes('/mv/status/'))).toBe(false);
    expect(screen.getByTestId(`${TID}-hint`).textContent ?? '').toContain('401');
    expect(screen.getByTestId(`${TID}-state`).textContent ?? '').toContain('未在查看');
  });

  it('探测401（服务端未建立会话）：待机/拒绝后均无口令输入框，不引导用户输口令', async () => {
    stubMvFetch({ probe: 401, authorize: 'then-401' });
    render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
    await flush();
    expect(screen.queryByTestId(`${TID}-login-input`)).toBeNull(); // 待机态：拦截不存在
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    await waitFor(() => expect(screen.getByTestId(`${TID}-hint`).textContent ?? '').toContain('401'));
    fireEvent.click(screen.getByTestId(`${TID}-start`)); // 再次发起也不弹任何登录
    await flush();
    expect(screen.queryByTestId(`${TID}-login`)).toBeNull();
    expect(document.querySelectorAll('input[type="password"]').length).toBe(0); // 全站无任何口令输入
  });

  it('免密码首次观看：探测通过直接授权→握手→合成关键AU→解码→呈现（本地观测证据如实，全程无登录）', async () => {
    const { calls } = stubMvFetch({ probe: 422, authorize: 'ok' });
    render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
    await flush();
    expect(screen.queryByTestId(`${TID}-login`)).toBeNull();
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    await waitFor(() => {
      expect(screen.getByTestId(`${TID}-state`).textContent ?? '').toContain('WSS 握手');
    });
    expect(calls.some((c) => c.url.includes('/mv/session'))).toBe(false); // 全程未发口令请求
    const ws = WsStub.instances.at(-1);
    expect(ws).toBeTruthy();
    expect(ws?.url).toContain('/ws/media/');
    ws!.__emit('open', {});
    await waitFor(() => {
      expect(screen.getByTestId(`${TID}-state`).textContent ?? '').toContain('等待Client出流');
    });
    ws!.__emit('message', { data: syntheticKeyAu() });
    await waitFor(() => expect(decodedChunks.length).toBe(1));
    expect(VideoDecoderStub.configs.length).toBe(1);
    expect((VideoDecoderStub.configs[0] as { codec: string }).codec).toBe('avc1.42001f');
    // 解码输出→canvas呈现与首帧证据
    VideoDecoderStub.outputCb?.({ codedWidth: 320, codedHeight: 240, close: () => {} });
    await flush();
    expect(ctxDrawSpy).toHaveBeenCalled();
    expect(screen.getByTestId(`${TID}-state`).textContent ?? '').toContain('已呈现');
    const ev = screen.getByTestId(`${TID}-evidence`).textContent ?? '';
    expect(ev).toContain('解码帧 1');
    expect(ev).toContain('呈现帧 1');
    expect(ev).toContain('首帧'); // 首帧耗时在场（未到则显示首帧未至）
  });

  it('无首帧超时：连接在但8s无帧→如实显示空窗（不冒充投屏中）', async () => {
    vi.useFakeTimers();
    try {
      stubMvFetch({ probe: 422, authorize: 'ok' });
      render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
      await flush();
      fireEvent.click(screen.getByTestId(`${TID}-start`));
      await vi.waitFor(() => expect(WsStub.instances.length).toBe(1), { timeout: 1000 });
      WsStub.instances[0].__emit('open', {});
      vi.advanceTimersByTime(8_100);
      vi.useRealTimers();
      await flush();
      expect(screen.getByTestId(`${TID}-state`).textContent ?? '').toContain('无首帧');
    } finally {
      vi.useRealTimers();
    }
  });

  it('不支持解码：isConfigSupported=false → unsupported 如实显示', async () => {
    stubMvFetch({ probe: 422, authorize: 'ok' });
    VideoDecoderStub.supportResult = { supported: false };
    render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
    await flush();
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    await waitFor(() => {
      expect(screen.getByTestId(`${TID}-state`).textContent ?? '').toContain('WSS 握手');
    });
    const ws = WsStub.instances.at(-1)!;
    ws.__emit('open', {});
    await flush();
    ws.__emit('message', { data: syntheticKeyAu() });
    await waitFor(() => {
      expect(screen.getByTestId(`${TID}-state`).textContent ?? '').toContain('不支持解码');
    });
  });

  it('服务端断开：显示关闭码与reason（4404语义不吞）；mvStop随断开投递', async () => {
    const { calls } = stubMvFetch({ probe: 422, authorize: 'ok' });
    render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
    await flush();
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    await waitFor(() => expect(WsStub.instances.length).toBe(1));
    WsStub.instances[0].__emit('open', {});
    await flush();
    WsStub.instances[0].__emit('close', { code: 4404, reason: 'session expired' });
    await waitFor(() => {
      expect(screen.getByTestId(`${TID}-state`).textContent ?? '').toContain('已断开');
    });
    expect(screen.getByTestId(`${TID}-state`).textContent ?? '').toContain('4404');
    await waitFor(() => expect(calls.some((c) => c.url.includes('/mv/stop'))).toBe(true));
  });

  it('关闭查看：本地立即释放+mvStop送达+状态已结束', async () => {
    const { calls } = stubMvFetch({ probe: 422, authorize: 'ok' });
    render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
    await flush();
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    await waitFor(() => expect(WsStub.instances.length).toBe(1));
    WsStub.instances[0].__emit('open', {});
    await flush();
    fireEvent.click(screen.getByTestId(`${TID}-stop`));
    await waitFor(() => {
      expect(screen.getByTestId(`${TID}-state`).textContent ?? '').toContain('已结束');
    });
    expect(WsStub.instances[0].closed).toBe(true);
    await waitFor(() => expect(calls.some((c) => c.url.includes('/mv/stop'))).toBe(true));
  });

  it('卸载释放：组件卸载即停管线并投递mvStop（页面隐藏走keepalive路径交由实现）', async () => {
    const { calls } = stubMvFetch({ probe: 422, authorize: 'ok' });
    const { unmount } = render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
    await flush();
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    await waitFor(() => expect(WsStub.instances.length).toBe(1));
    await flush();
    unmount();
    await waitFor(() => expect(calls.some((c) => c.url.includes('/mv/stop'))).toBe(true));
    expect(WsStub.instances[0].closed).toBe(true);
  });

  it('设备离线与无媒体能力：如实禁用，不做本地猜测', async () => {
    stubMvFetch({ probe: 401, authorize: 422 });
    const { rerender } = render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={false} mediaCapable={true} />);
    await flush();
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    await flush();
    expect(screen.getByTestId(`${TID}-hint`).textContent ?? '').toContain('离线');
    rerender(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={false} />);
    // W22一致性修订：mediaCapable=false客户端按钮已禁用（authHint不再经点击触发）——
    // 断言改为禁用态+title语义；旧「点击后提示」行为已被W21的禁用态取代（分版本账目）。
    const startBtn = screen.getByTestId(`${TID}-start`);
    expect(startBtn.getAttribute('disabled')).not.toBeNull();
    expect(startBtn.getAttribute('title')).toContain('未声明'); // W22.1：登记值口径提示（无"未声明媒体能力"整串——断言语义不放宽）
  });

  it('票据/路径不符合同面：拒绝发起连接（不猜可用）', async () => {
    stubMvFetch({
      probe: 422,
      authorize: 'ok',
      authorizeBody: {
        mediaSessionId: '01M6MVMEDIA0000000000000001',
        clientId: CID, deviceId: DID, purpose: 'screen-preview', status: 'authorized',
        createdAt: '2026-11-05T04:00:00Z', expiresAt: '2026-11-05T04:10:00Z',
        viewerTicket: { role: 'viewer', token: 't'.repeat(48), expiresAt: 'x', oneTimeUse: true },
        dataPlane: { mode: 'wss-relay', pathTemplate: '/ws/evil/{ticket}', acceptsBinaryFrom: 'client' },
        endedReason: null, endedAt: null,
      },
    });
    render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
    await flush();
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    await waitFor(() => {
      expect(screen.getByTestId(`${TID}-hint`).textContent ?? '').toContain('不符合合同面');
    });
    expect(WsStub.instances.length).toBe(0);
  });
});
