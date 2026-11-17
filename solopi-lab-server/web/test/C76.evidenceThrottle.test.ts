/**
 * C76 evidence 刷新回归（独立测试）：会话内接收/解码/呈现计数按节流间隔刷新观测面，
 * 不逐帧触发外层重渲染；阶段语义保持真实（presenting 由真实首帧即时发出，
 * 观测通知从不伪作新帧）；节流末次状态必达；关停/路由/卸载取消 timer、
 * 迟帧不回写；错误/停止终态不被延迟通知覆盖；切换会话计数归零且与旧会话隔离。
 *
 * 直接对 MediaViewerPipeline 断言（观测责任所在层）；面板消费路径与免密码/读取归属
 * 回归保持在 W20/W21/W23fix* 既有文件，本文件不放宽任何既有断言。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaViewerPipeline, type PipelineEvent, type ViewerEvidence } from '../src/media/MediaViewerPipeline';

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
  static outputCb: ((f: unknown) => void) | null = null;
  /** 测试开关：置true后 decode() 抛错——驱动送帧失败→error 终态路径 */
  static decodeThrows = false;
  constructor(opts: { output: (f: unknown) => void; error: (e: Error) => void }) {
    VideoDecoderStub.outputCb = opts.output;
  }
  static isConfigSupported(): Promise<{ supported?: boolean }> {
    return Promise.resolve({ supported: true });
  }
  configure() {
    /* stub */
  }
  decode(chunk: unknown) {
    if (VideoDecoderStub.decodeThrows) throw new Error('decoder broken');
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

const keyAu = (): ArrayBuffer =>
  new Uint8Array([0, 0, 1, 0x67, 0x42, 0x00, 0x1f, 0xff, 0, 0, 1, 0x68, 0xce, 0x3c, 0x80, 0, 0, 0, 1, 0x65, 0x88, 0x84, 0x00]).buffer;
const frame = (w = 320, h = 240) => ({ codedWidth: w, codedHeight: h, close: () => {} });

const mkCanvas = () =>
  ({ getContext: () => ({ drawImage: () => {} }), width: 0, height: 0 }) as unknown as HTMLCanvasElement;

interface Recorded {
  states: string[];
  evidence: ViewerEvidence[];
  events: number;
}
const recorded = (): Recorded => ({ states: [], evidence: [], events: 0 });

const startPipeline = (evidenceIntervalMs: number): { pipeline: MediaViewerPipeline; rec: Recorded } => {
  const rec = recorded();
  const pipeline = new MediaViewerPipeline({
    wssUrl: 'ws://127.0.0.1:1/ws/media/' + 'a'.repeat(48),
    canvas: mkCanvas(),
    evidenceIntervalMs,
    onEvent: (ev: PipelineEvent) => {
      rec.events += 1;
      if (ev.type === 'state') rec.states.push(ev.state.kind);
      else rec.evidence.push(ev.evidence);
    },
  });
  pipeline.start();
  return { pipeline, rec };
};

/** 模拟一帧真实到达：AU 到达(接收计数) + 送解码 + 解码输出(解码/呈现计数)。
 * 微任务刷新等待 isConfigSupported/decoder configure 落定（与真实异步时序一致）。 */
const pushFrame = async (ws: WsStub, w = 320, h = 240): Promise<void> => {
  ws.__emit('message', { data: keyAu() });
  await vi.advanceTimersByTimeAsync(0);
  VideoDecoderStub.outputCb?.(frame(w, h));
};

beforeEach(() => {
  vi.useFakeTimers();
  WsStub.instances.length = 0;
  VideoDecoderStub.outputCb = null;
  VideoDecoderStub.decodeThrows = false;
  decodedChunks.length = 0;
  vi.stubGlobal('WebSocket', WsStub);
  vi.stubGlobal('VideoDecoder', VideoDecoderStub);
  vi.stubGlobal('EncodedVideoChunk', EncodedVideoChunkStub);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('C76 evidence 节流刷新', () => {
  it('持续多帧只在间隔到达时合并刷新观测计数——不逐帧触发外层通知（重渲染）', async () => {
    const { pipeline, rec } = startPipeline(100);
    const ws = WsStub.instances[0];
    ws.__emit('open', {});
    await vi.advanceTimersByTimeAsync(9_000); // 越过首帧空窗（no-first-frame如实出现）
    await pushFrame(ws); // 首帧：presenting 即时 + 证据随状态即时
    expect(rec.states).toContain('presenting'); // 阶段语义不被节流延迟

    let eventsBefore = rec.events;
    for (let i = 0; i < 9; i++) await pushFrame(ws); // 同窗口 9 帧
    expect(rec.events).toBe(eventsBefore); // 未到间隔→无逐帧观测通知/重渲染
    vi.advanceTimersByTime(100);
    expect(rec.events - eventsBefore).toBe(1); // 合并为一次
    const e1 = rec.evidence.at(-1)!;
    expect(e1.decodedFrames).toBe(10); // 计数为会话累计真值
    expect(e1.renderedFrames).toBe(10);
    expect(rec.states.filter((s) => s === 'presenting').length).toBe(1); // 观测通知不伪作新帧/新阶段

    eventsBefore = rec.events;
    for (let i = 0; i < 5; i++) await pushFrame(ws);
    vi.advanceTimersByTime(100);
    const e2 = rec.evidence.at(-1)!;
    expect(e2.decodedFrames).toBe(15); // 下一窗口继续增长
    expect(rec.events - eventsBefore).toBe(1); // 仍只一次
    pipeline.stop();
  });

  it('节流末次状态必达：输入停止后尾随 timer 送达最终累计', async () => {
    const { pipeline, rec } = startPipeline(100);
    const ws = WsStub.instances[0];
    ws.__emit('open', {});
    await vi.advanceTimersByTimeAsync(9_000);
    const last = { decoded: 0 };
    const batch = Math.floor(100 / 60); // 60ms/帧——每100ms窗口约1.6帧
    for (let i = 0; i < 12; i++) {
      await pushFrame(ws);
      vi.advanceTimersByTime(60); // 帧间隔60ms——窗口内多次计数才属同窗口
      if ((i + 1) > batch) last.decoded = rec.evidence.at(-1)!.decodedFrames; // 中途窗口值
    }
    const before = rec.evidence.length;
    vi.advanceTimersByTime(100); // 静默后尾随间隔到达
    expect(rec.evidence.length).toBeGreaterThan(before);
    const e = rec.evidence.at(-1)!;
    expect(e.decodedFrames).toBe(12); // 末次累计=全部真值
    expect(e.renderedFrames).toBe(12);
    expect(last.decoded).toBeLessThanOrEqual(12); // 中途观测为窗口值，末次到位
    pipeline.stop();
  });

  it('关闭/路由/卸载同走本地释放：取消 timer，迟AU/迟帧/待发观测通知全部不回写', async () => {
    const { pipeline, rec } = startPipeline(100);
    const ws = WsStub.instances[0];
    ws.__emit('open', {});
    await vi.advanceTimersByTimeAsync(9_000);
    for (let i = 0; i < 3; i++) await pushFrame(ws); // 存在尾随 timer
    await vi.advanceTimersByTimeAsync(40); // 未到间隔即关闭
    pipeline.stop(); // 用户关闭/路由离开/卸载同走 stop→releaseLocal
    expect(rec.states.at(-1)).toBe('stopped');
    const eventsAtStop = rec.events;
    ws.__emit('message', { data: keyAu() }); // 迟AU
    VideoDecoderStub.outputCb?.(frame()); // 迟帧
    vi.advanceTimersByTime(5_000); // 全部待发窗口耗尽
    expect(rec.events).toBe(eventsAtStop); // 无迟写/复活/覆盖
    expect(rec.evidence.at(-1)!.decodedFrames).toBe(3); // 关闭时刻的最后状态不被改动
    pipeline.stop();
  });

  it('错误与停止终态不被延迟观测通知覆盖', async () => {
    const { pipeline, rec } = startPipeline(100);
    const ws = WsStub.instances[0];
    ws.__emit('open', {});
    await vi.advanceTimersByTimeAsync(9_000);
    await pushFrame(ws);
    vi.advanceTimersByTime(40);
    VideoDecoderStub.decodeThrows = true;
    ws.__emit('message', { data: keyAu() }); // 送帧抛错 → error 终态
    vi.advanceTimersByTime(5_000);
    expect(rec.states.at(-1)).toBe('error'); // 迟到间隔不覆盖错误终态
    pipeline.stop();

    const { pipeline: p2, rec: rec2 } = startPipeline(100);
    VideoDecoderStub.decodeThrows = false; // 新会话回到正常解码——独立环境语义
    const ws2 = WsStub.instances[1];
    ws2.__emit('open', {});
    await vi.advanceTimersByTimeAsync(9_000);
    await pushFrame(ws2);
    vi.advanceTimersByTime(40);
    p2.stop();
    vi.advanceTimersByTime(5_000);
    expect(rec2.states.at(-1)).toBe('stopped'); // 停止终态同样不被覆盖
  });

  it('切换会话计数归零且与旧会话隔离：旧尾随通知不污染新会话观测', async () => {
    const first = startPipeline(100);
    const ws1 = WsStub.instances[0];
    ws1.__emit('open', {});
    await vi.advanceTimersByTimeAsync(9_000);
    for (let i = 0; i < 6; i++) await pushFrame(ws1);
    vi.advanceTimersByTime(40);
    first.pipeline.stop(); // 旧会话累计6帧、存在未送达尾随窗口

    const second = startPipeline(100);
    const ws2 = WsStub.instances[1];
    ws2.__emit('open', {});
    await vi.advanceTimersByTimeAsync(9_000);
    await pushFrame(ws2, 1080, 2340); // 新会话首帧（手机比例）
    const e = second.rec.evidence.at(-1)!;
    expect(e.decodedFrames).toBe(1); // 归零起步，不携带旧会话累计
    expect(e.renderedFrames).toBe(1);
    expect(e.accessUnits).toBe(1);
    vi.advanceTimersByTime(500); // 旧会话残timer已随release取消，不污染新会话
    expect(second.rec.evidence.at(-1)!.decodedFrames).toBe(1);
    second.pipeline.stop();
  });
});
