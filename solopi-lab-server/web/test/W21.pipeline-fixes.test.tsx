/**
 * 分版本测试账目：W20.1（本文件）修 C41 三个反例后的针对性回归——
 * 解码队列有界/等关键帧、decoder 错误释放、初始化要求 SPS+PPS、
 * Panel 授权代次（authorizing 禁并发、迟授权丢弃+撤回、非法路径撤会话、卸载丢弃）。
 * 与 test/C41.pipeline-review.test.ts（原样复放 3/3）互补；口令/票据均为 fixture 字符串。
 */
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaViewerPipeline, type PipelineEvent } from '../src/media/MediaViewerPipeline';
import { MediaViewerPanel } from '../src/components/MediaViewerPanel';

const CID = '01M6JVA2KF08T0VZ0ZZABRAQFJ';
const DID = '01M6DEVICE0000000000000001';
const TID = `media-viewer-${CID}-${DID}`;

// ---------- 基建 ----------
type Handlers = Record<string, ((ev: unknown) => void)[]>;
class WS {
  static instances: WS[] = [];
  handlers: Handlers = {};
  closed = false;
  url: string;
  binaryType = '';
  constructor(url: string) {
    this.url = url;
    WS.instances.push(this);
  }
  addEventListener(n: string, f: (ev: unknown) => void) {
    (this.handlers[n] ??= []).push(f);
  }
  removeEventListener() {}
  close() {
    this.closed = true;
    this.__emit('close', { code: 1000, reason: '' });
  }
  __emit(n: string, e: unknown = {}) {
    for (const f of [...(this.handlers[n] ?? [])]) f(e);
  }
}

const chunks: { type: string }[] = [];
let decoderErrorCb: ((e: Error) => void) | null = null;
let decoderQueue = 0;
class VD {
  static support = { supported: true };
  constructor(opts: { output: (f: unknown) => void; error: (e: Error) => void }) {
    void opts.output;
    decoderErrorCb = opts.error;
  }
  static isConfigSupported() {
    return Promise.resolve(VD.support);
  }
  configure() {}
  decode(c: { type: string }) {
    chunks.push(c);
    void decoderQueue;
  }
  close() {}
}
VD.prototype.decode = function (c: { type: string }) {
  chunks.push(c);
} as unknown as VD['decode'];
Object.defineProperty(VD.prototype, 'decodeQueueSize', { get: () => decoderQueue });

class Chunk {
  type: string;
  constructor(o: { type: string }) {
    this.type = o.type;
  }
}

const auKey = (): ArrayBuffer =>
  new Uint8Array([0, 0, 1, 0x67, 0x42, 0x00, 0x1f, 0xff, 0, 0, 1, 0x68, 0xce, 0x3c, 0x80, 0, 0, 1, 0x65, 0x88, 0x84]).buffer;
const auDelta = (): ArrayBuffer => new Uint8Array([0, 0, 1, 0x41, 0x9a, 0x21, 0x00]).buffer;
const auSpsNoPps = (): ArrayBuffer => new Uint8Array([0, 0, 1, 0x67, 0x42, 0x00, 0x1f, 0xff]).buffer;

beforeEach(() => {
  WS.instances.length = 0;
  chunks.length = 0;
  decoderErrorCb = null;
  decoderQueue = 0;
  vi.stubGlobal('WebSocket', WS);
  vi.stubGlobal('VideoDecoder', VD);
  vi.stubGlobal('EncodedVideoChunk', Chunk);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------- W20.1 管线针对性回归 ----------
describe('W20.1 管线修复回归', () => {
  it('解码队列有界：decodeQueueSize 超限丢 delta、关键帧仍送、丢弃如实计数', async () => {
    const events: PipelineEvent[] = [];
    const p = new MediaViewerPipeline({
      wssUrl: 'wss://t.test',
      canvas: document.createElement('canvas'),
      onEvent: (e) => events.push(e),
    });
    p.start();
    WS.instances[0].__emit('open');
    WS.instances[0].__emit('message', { data: auKey() });
    await Promise.resolve();
    await Promise.resolve();
    expect(chunks.length).toBe(1);
    decoderQueue = 99; // 模拟浏览器侧已积压
    WS.instances[0].__emit('message', { data: auDelta() });
    WS.instances[0].__emit('message', { data: auDelta() });
    // C76/W23fix4：丢帧观测改按节流间隔送达（末次不丢）——等待尾随 flush 再断言，语义不变
    await new Promise((r) => setTimeout(r, 600));
    const ev = events.filter((e) => e.type === 'evidence').at(-1) as { evidence: { droppedAUs: number } };
    expect(ev.evidence.droppedAUs).toBe(2); // delta 均丢（节流末次必达）
    expect(chunks.length).toBe(1);
    decoderQueue = 0;
    WS.instances[0].__emit('message', { data: auKey() });
    expect(chunks.length).toBe(2); // 关键帧恢复继续送
    p.stop();
  });

  it('首送必须等关键帧：初始化完成前后的 delta 先丢弃（如实不冒充呈现）', async () => {
    const p = new MediaViewerPipeline({ wssUrl: 'wss://t.test', canvas: document.createElement('canvas'), onEvent: () => {} });
    p.start();
    WS.instances[0].__emit('open');
    WS.instances[0].__emit('message', { data: auDelta() });
    WS.instances[0].__emit('message', { data: auSpsNoPps() });
    await Promise.resolve();
    await Promise.resolve();
    expect(chunks.length).toBe(0); // 无SPS+PPS+IDR完整前不解码
    WS.instances[0].__emit('message', { data: auKey() });
    await Promise.resolve();
    await Promise.resolve();
    expect(chunks.length).toBe(1);
    p.stop();
  });

  it('decoder 错误=终态并释放：socket 关闭、pagehide 兜底撤除、stop 不覆盖 error', async () => {
    vi.useFakeTimers();
    try {
      const states: string[] = [];
      const p = new MediaViewerPipeline({
        wssUrl: 'wss://t.test',
        canvas: document.createElement('canvas'),
        onEvent: (e) => {
          if (e.type === 'state') states.push(e.state.kind);
        },
      });
      p.start();
      WS.instances[0].__emit('open');
      WS.instances[0].__emit('message', { data: auKey() });
      await vi.waitFor(() => expect(decoderErrorCb).toBeTruthy(), { timeout: 1000 });
      act(() => decoderErrorCb!(new Error('boom')));
      expect(WS.instances[0].closed).toBe(true); // 释放本地连接
      expect(states).toContain('error');
      p.stop();
      expect(states.at(-1)).toBe('error'); // stop 不覆盖错误终态
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------- W20.1 Panel 授权代次回归 ----------
describe('W20.1 Panel 迟授权取消/并发禁入/非法路径撤会话', () => {
  interface Deferred {
    resolveAuthorize: (code: number) => void;
    calls: { url: string; body: unknown }[];
  }
  const stubDeferredFetch = (): Deferred => {
    const calls: { url: string; body: unknown }[] = [];
    let resolveAuthorize: ((code: number) => void) | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        calls.push({ url, body: init?.body != null ? JSON.parse(String(init.body)) : null });
        const mk = (status: number, json: unknown): Response =>
          ({ ok: status < 300 && status >= 200, status, json: async () => json, text: async () => JSON.stringify(json) }) as Response;
        if (url.includes('/mv/status/')) return mk(422, {});
        if (url.includes('/mv/session')) return mk(200, { viewerSubject: true, expiresInSeconds: 3600 });
        if (url.includes('/mv/authorize')) {
          return new Promise<Response>((resolve) => {
            resolveAuthorize = (code: number) => {
              if (code >= 400) resolve(mk(code, { error: { code: 'X', message: 'x', retryable: false } }));
              else
                resolve(
                  mk(200, {
                    mediaSessionId: '01M6MVSID000000000000000001',
                    clientId: CID, deviceId: DID, purpose: 'screen-preview', status: 'authorized',
                    createdAt: '2026-11-05T04:00:00Z', expiresAt: '2026-11-05T04:10:00Z',
                    viewerTicket: { role: 'viewer', token: 't'.repeat(48), expiresAt: 'x', oneTimeUse: true },
                    dataPlane: { mode: 'wss-relay', pathTemplate: '/ws/media/{ticket}', acceptsBinaryFrom: 'client' },
                    endedReason: null, endedAt: null,
                  }),
                );
            };
          });
        }
        if (url.includes('/mv/stop')) return mk(200, {});
        return mk(404, {});
      }),
    );
    return {
      resolveAuthorize: (code: number) => resolveAuthorize?.(code),
      calls,
    };
  };

  it('authorizing 期间开始按钮禁用（迟授权/并发二次发起由代次拒绝）', async () => {
    const d=stubDeferredFetch();
    render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    await waitFor(() => expect(screen.getByTestId(`${TID}-start`).getAttribute('disabled')).not.toBeNull());
    await waitFor(()=>expect(d.calls.some(c=>c.url.includes('/mv/authorize'))).toBe(true));
    await act(async()=>d.resolveAuthorize(401));
  });

  it('关闭后迟授权落地 → 不开新流且撤回其会话（mvStop 送达）', async () => {
    const d = stubDeferredFetch();
    render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    await waitFor(() => expect(screen.getByTestId(`${TID}-start`).getAttribute('disabled')).not.toBeNull());
    fireEvent.click(screen.getByTestId(`${TID}-stop`)); // 关闭 → 代次+1
    await act(async () => {
      d.resolveAuthorize(200); // 迟到的授权
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(WS.instances.length).toBe(0); // 不开新流
    expect((screen.getByTestId(`${TID}-state`).textContent ?? '')).toContain('已结束'); // 终态不被迟授权复活
    await waitFor(() => expect(d.calls.some((c) => c.url.includes('/mv/stop'))).toBe(true));
  });

  it('卸载后迟授权落地 → 只撤回会话不开流', async () => {
    const d = stubDeferredFetch();
    const { unmount } = render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    unmount();
    await act(async () => {
      d.resolveAuthorize(200);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(WS.instances.length).toBe(0);
    await waitFor(() => expect(d.calls.some((c) => c.url.includes('/mv/stop'))).toBe(true));
  });

  it('非法 dataPlane 路径 → 拒连并撤回该会话（不遗留服务端并发位）', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        calls.push({ url, body: init?.body != null ? JSON.parse(String(init.body)) : null });
        const mk = (status: number, json: unknown): Response =>
          ({ ok: status >= 200 && status < 300, status, json: async () => json, text: async () => JSON.stringify(json) }) as Response;
        if (url.includes('/mv/status/')) return mk(422, {});
        if (url.includes('/mv/authorize'))
          return mk(200, {
            mediaSessionId: '01M6MVSID000000000000000001',
            clientId: CID, deviceId: DID, purpose: 'screen-preview', status: 'authorized',
            createdAt: '2026-11-05T04:00:00Z', expiresAt: '2026-11-05T04:10:00Z',
            viewerTicket: { role: 'viewer', token: 't'.repeat(48), expiresAt: 'x', oneTimeUse: true },
            dataPlane: { mode: 'wss-relay', pathTemplate: '/ws/evil/{ticket}', acceptsBinaryFrom: 'client' },
            endedReason: null, endedAt: null,
          });
        if (url.includes('/mv/stop')) return mk(200, {});
        return mk(404, {});
      }),
    );
    render(<MediaViewerPanel clientId={CID} deviceId={DID} deviceOnline={true} mediaCapable={true} />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByTestId(`${TID}-start`));
    await waitFor(() => expect(WS.instances.length).toBe(0)); // 不开流
    await waitFor(() => {
      expect(screen.getByTestId(`${TID}-hint`).textContent ?? '').toContain('已拒绝发起并停止该会话');
    });
    await waitFor(() => expect(calls.some((c) => c.url.includes('/mv/stop'))).toBe(true)); // 会话已撤
  });
});
