// Batch receive ACKs retain decoder backpressure. Presentation counters travel
// with them; only the first visible frame needs an immediate readiness signal.
export class PreviewFeedback {
  private streamId = '';
  private presented = 0;
  private first = true;
  constructor(private send: (payload: Record<string, unknown>) => void) {}
  reset(streamId: string) {
    if (streamId === this.streamId) return;
    this.streamId = streamId; this.presented = 0; this.first = true;
  }
  draw(streamId: string) {
    if (streamId !== this.streamId) return;
    if (this.first) { this.first = false; this.send({ streamId, presentedCount: 1 }); }
    else this.presented++;
  }
  ack(frameId: string, streamId: string) {
    if (streamId !== this.streamId) return;
    const presentedCount = this.presented; this.presented = 0;
    this.send({ frameId, streamId, presentedCount });
  }
  flush() {
    if (!this.presented) return;
    const presentedCount = this.presented; this.presented = 0;
    this.send({ streamId: this.streamId, presentedCount });
  }
}
