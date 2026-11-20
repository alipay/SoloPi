export type H264Packet = { type: 'key' | 'delta'; timestamp: number; data: Uint8Array };
export type H264Batch = { format: 'h264-annexb'; codec: string; streamId: string; packets: H264Packet[]; frameId: string };
// Annex-B config (SPS/PPS) accompanies each keyframe, so no avcC/JPEG conversion.
export class H264PreviewDecoder {
  private decoder: VideoDecoder | null = null;
  private streamId = '';
  private codec = '';
  private closed = false;
  private chain: Promise<void> = Promise.resolve();
  private waiting = new Set<(error?: Error) => void>();
  constructor(private onFrame: (frame: VideoFrame, streamId: string) => void, private onError: (error: Error) => void) {}
  push(batch: H264Batch): Promise<void> {
    this.chain = this.chain.then(async () => {
      if (this.closed) return;
      if (!globalThis.VideoDecoder || !globalThis.EncodedVideoChunk) throw Error('当前页面不支持 WebCodecs 视频解码');
      if (!/^avc1\.[a-f0-9]{6}$/i.test(batch.codec) || !batch.streamId || !Array.isArray(batch.packets) || batch.packets.length > 8) throw Error('H.264 视频批次无效');
      if (this.streamId !== batch.streamId || this.codec !== batch.codec) {
        if (this.decoder && this.decoder.state !== 'closed') this.decoder.close(); this.decoder = null;
        if (batch.packets[0]?.type !== 'key') throw Error('新视频会话必须从关键帧开始');
        const config: VideoDecoderConfig = { codec: batch.codec, optimizeForLatency: true };
        const supported = await VideoDecoder.isConfigSupported(config);
        if (this.closed) return;
        if (!supported.supported) throw Error(`当前运行时不支持 ${batch.codec}`);
        const id = batch.streamId;
        this.decoder = new VideoDecoder({ output: frame => {
          if (this.closed || this.streamId !== id) { frame.close(); return; }
          this.onFrame(frame, id);
        }, error: error => { if (this.closed || this.streamId !== id) return; for (const done of [...this.waiting]) done(error); this.onError(error); } });
        this.streamId = id; this.codec = batch.codec;
        this.decoder.configure(config);
      }
      const decoder = this.decoder!;
      for (const packet of batch.packets) {
        if (!Number.isSafeInteger(packet.timestamp) || packet.timestamp < 0 || !['key', 'delta'].includes(packet.type)) throw Error('H.264 帧元数据无效');
        decoder.decode(new EncodedVideoChunk({ type: packet.type, timestamp: packet.timestamp, data: new Uint8Array(packet.data) }));
      }
      // Do not flush between batches: flush requires another keyframe. Bound
      // decode work while retaining all dependencies in normal playback.
      if (decoder.decodeQueueSize > 8) await new Promise<void>((resolve, reject) => {
        const done = (error?: Error) => { clearTimeout(timer); decoder.removeEventListener('dequeue', drain); this.waiting.delete(done); error ? reject(error) : resolve(); };
        const drain = () => { if (decoder.decodeQueueSize <= 8) done(); };
        const timer = setTimeout(() => done(Error('页面视频解码队列停滞')), 5000);
        this.waiting.add(done); decoder.addEventListener('dequeue', drain); drain();
      });
    });
    return this.chain;
  }
  close() { this.closed = true; for (const done of [...this.waiting]) done(Error('视频解码已停止')); if (this.decoder && this.decoder.state !== 'closed') this.decoder.close(); this.decoder = null; }
}
