/**
 * 媒体 viewer 接收/解码/呈现管线（浏览器，W20 接线；W20.1 修 C41 复核反例）。
 *
 * 服务端 r5.1 合同限定：single viewer 单 client、client→viewer 单向 binary
 * （Annex-B access unit，首帧 IDR+SPS/PPS）、viewer 方向禁入（发送即会话 failed）、
 * 背压/上限由服务端裁决。本管线的责任：
 * - 握手：与同源数据面建立 WSS（由 /mv/authorize 短时单用途票）；
 * - 解码：WebCodecs VideoDecoder（annexb 格式，零额外依赖）；初始化单路串行化
 *   （C41-1：isConfigSupported 在飞期间后续 AU 只进有界待处理槽，绝不产生第二个 decoder），
 *   且首帧必须 SPS+PPS+IDR 完整才送解码；
 *   （C45：等待槽只留关键帧防引用链缺口；C46：缺口事实独立跟踪——补送保留帧不清除，
 *   唯有新完整IDR按实际到达顺序入队才恢复）；
 *   队列上限对 key/delta 一视同仁（C45-B2），任何丢弃切回等关键帧态（C45-B1）；
 *   终态后的迟到回调（error/open）按生命周期代次隔离（C45-B4/B6）；
 *   configure 抛错在归属登记后释放新 decoder（C45-B5）；
 * - 呈现：VideoFrame 画到 canvas；decoded/rendered/首帧耗时为**浏览器本地观测**证据；
 *   关停/终态后迟到的解码回调一律只释放 VideoFrame 不再上画（C41-3）；
 * - 释放：stop()幂等——关 socket、清首帧计时器、撤 pagehide 兜底、decoder.close()；
 *   服务器断开同样走终态释放并清除计时器（C41-2——disconnected 不被 8s 空窗覆盖）；
 *   页面卸载时尽力投递 /mv/stop（keepalive），服务端 sweep 为最终兜底。
 *
 * 时间戳语义（W20.1 对齐 C41/合同核对结论）：EncodedVideoChunk.timestamp 使用
 * 解码顺序合成的监视呈现时间轴（33ms/AU）——它**不是** scrcpy 原 PTS 的透传：
 * 当前原码 WS 消息只含 Annex-B AU，不含 scrcpy 12 字节头（原 PTS 源），
 * Annex-B 流内亦不保证存在可解复用的 PTS。原 PTS 语义以合同单负责人裁定为准，
 * 本文件与页面文案不宣称「PTS 透传/保留原 PTS」。
 */

import { annexbFindNal, auHasKeyframe, spsToAvc1Codec } from './h264-annexb';

/** 管线对外状态（页面消费；不含任何票据/口令内文） */
export type ViewerPipelineState =
  | { kind: 'connecting' } // WSS 握手中
  | { kind: 'connected' } // 101 已建立，等待首帧
  | { kind: 'presenting' } // 已呈现真实画面（首帧已画上 canvas）
  | { kind: 'no-first-frame'; waitedMs: number } // 空窗超时——连接在但无首帧（Client未上线/未采集）
  | { kind: 'unsupported'; reason: string } // 浏览器不支持 WebCodecs/该 H264 配置
  | { kind: 'error'; message: string } // 解码器运行期错误（终态——已释放本地资源）
  | { kind: 'disconnected'; code: number | null; reason: string | null } // 对端断开（服务器关闭码语义）
  | { kind: 'stopped' }; // 用户主动关停并释放

/** 浏览器本地观测证据（照实展示，不与服务端/客户端上报混淆） */
export interface ViewerEvidence {
  packets: number;
  bytes: number;
  accessUnits: number;
  decodedFrames: number;
  renderedFrames: number;
  firstFrameMs: number | null;
  /** 解码积压越限被丢弃的 AU 数（丢到下一关键帧为止——有界队列策略） */
  droppedAUs: number;
}

export type PipelineEvent =
  | { type: 'state'; state: ViewerPipelineState }
  | { type: 'evidence'; evidence: ViewerEvidence };

export interface PipelineOptions {
  wssUrl: string;
  canvas: HTMLCanvasElement;
  firstFrameTimeoutMs?: number;
  onEvent: (event: PipelineEvent) => void;
  /** 解码队列有界上限：decoder.decodeQueueSize 超过即丢 delta 至下一关键帧 */
  maxDecodeQueueSize?: number;
  /** Coalesce decoded output to the display refresh; never skip encoded reference frames. */
  presentOnAnimationFrame?: boolean;
  bufferEncodedBursts?: boolean;
  /**
   * 会话内证据刷新节流间隔（C76）：正常解码/绘制后，接收/解码/呈现计数按此间隔
   * 刷新到观测面——同窗口内多帧只合并为一次观测通知，不逐帧触发外层重渲染。
   * 阶段语义不受节流影响：presenting 等状态仍由真实事件即时发出，节流只影响
   * 「计数文本」的刷新频率，绝不把观测通知伪作新帧。尾随 timer 保证停止输入后
   * 末次累计仍会到达（末次不丢）。
   */
  evidenceIntervalMs?: number;
}

const DEFAULT_FIRST_FRAME_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_DECODE_QUEUE_SIZE = 8;
const DEFAULT_EVIDENCE_INTERVAL_MS = 500;

export class MediaViewerPipeline {
  private readonly opts: PipelineOptions;
  private ws: WebSocket | null = null;
  private decoder: VideoDecoder | null = null;
  private closed = false;
  private configured = false;
  private evidence: ViewerEvidence = { packets: 0, bytes: 0, accessUnits: 0, decodedFrames: 0, renderedFrames: 0, firstFrameMs: null, droppedAUs: 0 };
  private encodedPending: Uint8Array[] = [];
  private encodedPendingBytes = 0;
  private decodePump: ReturnType<typeof setTimeout> | null = null;
  private pendingPresentation: VideoFrame | null = null;
  private presentationRequest: number | null = null;
  private openedAt = 0;
  private timestampBase = 0; // 解码顺序合成时钟（us）——监视呈现时间轴，非原 PTS（见文件头注释）
  private firstFrameTimer: ReturnType<typeof setTimeout> | null = null;
  /** C76：证据节流尾随 timer——同一窗口至多一次观测通知；释放/终态即取消 */
  private evidenceTimer: ReturnType<typeof setTimeout> | null = null;
  private releaseBound: (() => void) | null = null;
  /** 终态（unsupported/error/disconnected/stopped）——已发出后 stop() 不再覆盖展示 */
  private terminal: ViewerPipelineState | null = null;
  /** C41-1：初始化单飞标记——isConfigSupported 在飞时后续 AU 最多保留最新一条待处理 */
  private initInFlight = false;
  private pendingAu: Uint8Array | null = null;
  /** 首帧未呈（尚未送出含 IDR 的 AU）——积压越限或丢帧后仍要求关键帧从头 */
  private awaitingKey = true;
  /**
   * C46：参考链缺口独立跟踪——最后一次保留（保留/入队）的 AU 之后丢过 delta。
   * 该事实独立于 awaitingKey：配置落定后的补送 feed（初始 AU / 等待槽 AU 为保留帧）
   * 不得清除它；只有新完整 IDR 按实际到达顺序成功入队时恢复。
   */
  private chainBroken = false;

  constructor(opts: PipelineOptions) {
    this.opts = opts;
  }

  start(): void {
    if (this.ws != null || this.closed) return;
    this.emitState({ kind: 'connecting' });
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.wssUrl);
    } catch {
      this.emitState({ kind: 'error', message: 'WSS 地址构造失败' });
      this.terminal = { kind: 'error', message: 'WSS 地址构造失败' };
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.addEventListener('open', () => {
      // C45-B6：关停后的迟 open 回调不得恢复 connected/重建计时器（生命周期代次=Closed判定）
      if (this.closed) return;
      this.openedAt = performance.now();
      this.emitState({ kind: 'connected' });
      this.firstFrameTimer = setTimeout(() => {
        if (!this.closed && this.evidence.renderedFrames === 0) {
          this.emitState({ kind: 'no-first-frame', waitedMs: Math.round(performance.now() - this.openedAt) });
        }
      }, this.opts.firstFrameTimeoutMs ?? DEFAULT_FIRST_FRAME_TIMEOUT_MS);
    });
    ws.addEventListener('message', (ev) => this.handleMessage(ev));
    ws.addEventListener('close', (ev) => {
      // C41-2：服务器断开与用户停止同路走完整本地释放（清首帧计时器/撤兜底），
      // disconnected 为终态——不被 8s 空窗计时器覆盖。
      const wasUserStop = this.closed;
      this.releaseLocal();
      if (wasUserStop) return;
      this.emitState({ kind: 'disconnected', code: ev.code ?? null, reason: ev.reason || null });
    });
    ws.addEventListener('error', () => {
      // 连接失败最终会伴随 close 事件——此处不单独起态，保证状态机单一路径
    });
    // 页面隐藏/卸载兜底：立即释放本地连接；stop 请求由组件调用方负责投递
    this.releaseBound = () => this.stop();
    window.addEventListener('pagehide', this.releaseBound);
  }

  /** 用户主动停止：本地立即释放；服务端 stop 由组件调用方负责 */
  stop(): void {
    if (this.closed) {
      return;
    }
    this.releaseLocal();
    if (this.terminal == null) {
      this.emitState({ kind: 'stopped' });
    }
  }

  /** 全路径共用的本地释放（不发状态——终态由调用方先/后emit）；幂等 */
  private releaseLocal(): void {
    this.closed = true;
    if(this.decodePump!==null)clearTimeout(this.decodePump);this.decodePump=null;this.encodedPending=[];this.encodedPendingBytes=0;
    this.clearFirstFrameTimer();
    if(this.presentationRequest!==null)cancelAnimationFrame(this.presentationRequest);
    this.presentationRequest=null;this.pendingPresentation?.close();this.pendingPresentation=null;
    this.clearEvidenceTimer(); // C76：关停/终态取消待发观测通知——迟帧不回写已结束面板
    this.teardownDecoder();
    this.initInFlight = false;
    this.pendingAu = null;
    if (this.releaseBound != null) window.removeEventListener('pagehide', this.releaseBound);
    try {
      this.ws?.close(1000, 'viewer-stopped');
    } catch {
      /* 已经关闭 */
    }
  }

  private emitState(state: ViewerPipelineState): void {
    if (state.kind === 'unsupported' || state.kind === 'error' || state.kind === 'disconnected' || state.kind === 'stopped') this.terminal = state;
    // C76：状态变化即时携带最新证据快照——待发节流尾随 timer 已被本次覆盖，取消之
    this.clearEvidenceTimer();
    this.opts.onEvent({ type: 'state', state });
    this.opts.onEvent({ type: 'evidence', evidence: { ...this.evidence } });
  }

  /** 直接广播证据快照（末次不丢保障/测试锚点）——面板观测行内容保持真值，不涉及阶段语义 */
  private emitEvidenceOnly(): void {
    this.opts.onEvent({ type: 'evidence', evidence: { ...this.evidence } });
  }

  /**
   * C76 证据节流：计数变化只标记「待发」，同窗口至多一次观测通知（默认500ms，尾随timer）。
   * - 不逐帧触发外层重渲染；
   * - 阶段语义不受影响（presenting/结束等状态从不由本路径发出）；
   * - 停止输入后末次累计仍会在间隔到达时送出；关停/终态即取消，迟帧/迟计数不回写。
   */
  private scheduleEvidenceFlush(): void {
    if (this.closed) return;
    if (this.evidenceTimer != null) return;
    this.evidenceTimer = setTimeout(() => {
      this.evidenceTimer = null;
      if (this.closed) return;
      this.emitEvidenceOnly();
    }, this.opts.evidenceIntervalMs ?? DEFAULT_EVIDENCE_INTERVAL_MS);
  }

  private clearEvidenceTimer(): void {
    if (this.evidenceTimer != null) {
      clearTimeout(this.evidenceTimer);
      this.evidenceTimer = null;
    }
  }

  private clearFirstFrameTimer(): void {
    if (this.firstFrameTimer != null) {
      clearTimeout(this.firstFrameTimer);
      this.firstFrameTimer = null;
    }
  }

  private handleMessage(ev: MessageEvent): void {
    if (this.closed) return;
    if (typeof ev.data === 'string') return; // 合同为纯 binary；文本帧忽略（协议外输入不进解码器）
    const data = new Uint8Array(ev.data as ArrayBuffer);
    this.evidence.packets += 1;
    this.evidence.bytes += data.byteLength;
    this.evidence.accessUnits += 1;
    this.scheduleEvidenceFlush(); // C76：接收计数节流刷新（同窗口合并为一次观测通知）

    if (!this.configured) {
      if (this.initInFlight) {
        // C41-1/C45-B3：初始化在飞——等待槽只保留关键帧AU（其后的delta若覆盖前位会留引用链缺口）；
        // 非关键帧在槽外如实丢弃并计数，配置落定后只补送关键帧；绝不并发起第二个 decoder
        if (auHasKeyframe(data)) {
          this.pendingAu = data;
          this.chainBroken = false; // 新保留的IDR重立参考链——其后的delta不依赖更早的缺失
        } else {
          this.evidence.droppedAUs += 1;
          this.chainBroken = true; // C46：最后保留AU之后出现引用链缺口——落定后不可被补送清除
          this.scheduleEvidenceFlush();
        }
        return;
      }
      const sps = annexbFindNal(data, 7);
      if (sps == null) return; // 首帧必须含 SPS——期间数据计入包计数，不解码不呈现
      if (annexbFindNal(data, 8) == null) return; // 合同 initialization=idr-with-sps-pps-first：PPS 同帧前置
      const codec = spsToAvc1Codec(sps);
      if (codec == null) {
        this.emitState({ kind: 'unsupported', reason: 'SPS 不可解析' });
        this.releaseLocal();
        return;
      }
      const { VideoDecoder: VD } = globalThis as { VideoDecoder?: typeof VideoDecoder };
      if (typeof VD !== 'function') {
        this.emitState({ kind: 'unsupported', reason: '此浏览器无 WebCodecs VideoDecoder' });
        this.releaseLocal();
        return;
      }
      const config: VideoDecoderConfig = {
        codec,
        optimizeForLatency: true,
        // annexb：配置不需要 description；codedWidth/Height 由解码器从 SPS 推导
      };
      this.initInFlight = true;
      this.pendingAu = null;
      const supportCheck = VD.isConfigSupported(config) as Promise<{ supported?: boolean }>;
      supportCheck
        .then((support) => {
          if (this.closed) return;
          if (support?.supported !== true) {
            this.emitState({ kind: 'unsupported', reason: `不支持解码 ${codec}` });
            this.releaseLocal();
            return;
          }
          const decoder = new VD({
            output: (frame) => this.drawFrame(frame),
            error: (e) => {
              // C45-B4：迟到的错误回调按生命周期隔离——已关停/已换代的decoder不再改终态
              if (this.closed || this.decoder !== decoder) return;
              // 解码器错误=终态：如实报错并释放本地资源（不为坏流保活）
              this.emitState({ kind: 'error', message: (e as Error).message || '解码器错误' });
              this.releaseLocal();
            },
          });
          // C45-B5：先归属再configure——configure抛错时 releaseLocal 能释放这个新分配的decoder
          this.decoder = decoder;
          try {
            decoder.configure(config);
          } catch (e) {
            this.emitState({ kind: 'error', message: `decoder配置失败：${(e as Error).message}` });
            this.releaseLocal();
            return;
          }
          this.configured = true;
          this.initInFlight = false;
          // 初始化AU与等待槽AU都是"保留帧"补送（C46：非live到达）——
          // 它们的入队不证明后续delta的参考链完整，不得据此清除chainBroken
          this.feed(data, false);
          const catchUp = this.pendingAu;
          this.pendingAu = null;
          if (catchUp != null) this.feed(catchUp, false);
        })
        .catch(() => {
          this.initInFlight = false;
          if (!this.closed) {
            this.emitState({ kind: 'unsupported', reason: `无法确认解码配置 ${codec}` });
            this.releaseLocal();
          }
        });
      return;
    }
    this.acceptAu(data);
  }

  private acceptAu(data: Uint8Array): void {
    const bound=this.opts.maxDecodeQueueSize ?? DEFAULT_MAX_DECODE_QUEUE_SIZE;
    if(!this.opts.bufferEncodedBursts || (!this.encodedPending.length && (this.decoder?.decodeQueueSize ?? 0)<=bound)){this.feed(data);return;}
    this.encodedPending.push(data);this.encodedPendingBytes+=data.byteLength;
    if(this.encodedPending.length>60 || this.encodedPendingBytes>2*1024*1024){
      this.evidence.droppedAUs+=this.encodedPending.length;this.encodedPending=[];this.encodedPendingBytes=0;this.awaitingKey=true;this.chainBroken=true;
      if(auHasKeyframe(data)){this.evidence.droppedAUs--;this.encodedPending=[data];this.encodedPendingBytes=data.byteLength;}
      this.scheduleEvidenceFlush();
    }
    this.pumpDecode();
  }

  private pumpDecode(): void {
    if(this.closed)return;
    const bound=this.opts.maxDecodeQueueSize ?? DEFAULT_MAX_DECODE_QUEUE_SIZE;
    while(this.encodedPending.length && (this.decoder?.decodeQueueSize ?? 0)<=bound){const au=this.encodedPending.shift()!;this.encodedPendingBytes-=au.byteLength;this.feed(au);}
    if(this.encodedPending.length && this.decodePump===null)this.decodePump=setTimeout(()=>{this.decodePump=null;this.pumpDecode();},8);
  }

  /**
   * 单条 UB 已按合同为完整 access unit。有界解码队列：decodeQueueSize 超上限时丢 delta
   * 至下一关键帧（监视呈现语义下旧 delta 无意义）；首送必须是 IDR 关键帧。
   * liveArrival=false 表示本 AU 是初始化落定后的保留帧补送（初始化AU/等待槽AU）——
   * 不清除 chainBroken（C46）；只有新 AU 按实际到达顺序成功入队才恢复参考链。
   */
  private feed(au: Uint8Array, liveArrival: boolean = true): void {
    const decoder = this.decoder;
    if (decoder == null || this.closed) return;
    const isKey = auHasKeyframe(au);
    if (this.awaitingKey && !isKey) {
      this.evidence.droppedAUs += 1; // 等关键帧期间先到的delta如实丢弃并计数（引用链不完整）
      this.scheduleEvidenceFlush();
      return;
    }
    const queued = (decoder as unknown as { decodeQueueSize?: number }).decodeQueueSize ?? 0;
    const bound = this.opts.maxDecodeQueueSize ?? DEFAULT_MAX_DECODE_QUEUE_SIZE;
    if (queued > bound) {
      // C45-B1/B2：队列上限对 key/delta 一视同仁——真实流可能短GOP/慢解码，关键帧不豁免；
      // 任何丢弃都会在参考链上留缺口，此后等待下一个可解码关键帧再恢复送帧
      this.evidence.droppedAUs += 1;
      this.awaitingKey = true;
      this.scheduleEvidenceFlush();
      return;
    }
    if (liveArrival && isKey) {
      this.chainBroken = false; // C46：新完整IDR按实际到达顺序成功入队——重立参考链
    }
    if (this.chainBroken && !isKey) {
      // C46：缺口未恢复——非关键帧依赖已丢的引用帧，如实丢弃并计数，直到新IDR到齐
      this.evidence.droppedAUs += 1;
      this.scheduleEvidenceFlush();
      return;
    }
    const isKeyFeed = isKey;
    const timestamp = this.timestampBase;
    this.timestampBase += 33_000; // 合成监视时间轴（非原 PTS——见文件头注释）
    const chunk = new EncodedVideoChunk({
      type: isKeyFeed ? 'key' : 'delta',
      timestamp,
      data: au,
    } as EncodedVideoChunkInit);
    this.awaitingKey = false; // 送出后等待后续 key/ delta 正常流（丢帧只丢 delta）
    try {
      decoder.decode(chunk);
    } catch (e) {
      this.emitState({ kind: 'error', message: `送帧失败：${(e as Error).message}` });
      this.releaseLocal();
    }
  }

  private drawFrame(frame: VideoFrame): void {
    if(this.closed){frame.close();return;}
    this.evidence.decodedFrames += 1;
    if(!this.opts.presentOnAnimationFrame || this.evidence.renderedFrames===0){this.paintFrame(frame);return;}
    this.pendingPresentation?.close();this.pendingPresentation=frame;
    this.scheduleEvidenceFlush();
    if(this.presentationRequest===null)this.presentationRequest=requestAnimationFrame(()=>{
      this.presentationRequest=null;const latest=this.pendingPresentation;this.pendingPresentation=null;
      if(latest)this.paintFrame(latest);
    });
  }

  private paintFrame(frame: VideoFrame): void {
    // C41-3：关停/终态后迟到的解码回调——只释放VideoFrame，不上画、不改计数与状态
    if (this.closed) {
      try {
        frame.close();
      } catch {
        /* 已释放 */
      }
      return;
    }
    let flushedInline = false;
    try {
      const canvas = this.opts.canvas;
      const ctx = canvas.getContext('2d');
      if (ctx != null) {
        if (canvas.width !== frame.codedWidth || canvas.height !== frame.codedHeight) {
          canvas.width = frame.codedWidth;
          canvas.height = frame.codedHeight;
        }
        ctx.drawImage(frame, 0, 0);
        this.evidence.renderedFrames += 1;
        if (this.evidence.firstFrameMs == null) {
          this.evidence.firstFrameMs = Math.round(performance.now() - this.openedAt);
          this.clearFirstFrameTimer();
          this.emitState({ kind: 'presenting' });
          flushedInline = true; // 首帧证据已随 presenting 状态即时送达——不再排尾随 timer
        }
      }
      // ctx null（测试环境/极端）——decoded 计数已如实增加，但不声称 rendered/presenting
    } finally {
      if (!flushedInline) this.scheduleEvidenceFlush(); // C76：解码/呈现在持续时按节流刷新
      frame.close();
    }
  }

  private teardownDecoder(): void {
    const d = this.decoder;
    this.decoder = null;
    this.configured = false;
    this.awaitingKey = true;
    if (d != null) {
      try {
        if (d.state == null || d.state === 'configured' || d.state === 'unconfigured') d.close();
      } catch {
        /* 已关闭 */
      }
    }
  }
}
