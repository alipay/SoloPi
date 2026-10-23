const MEDIA_PROCESS_QUEUE_SCHEMA_VERSION = 'glassbox.media-process-queue.v1';

class MediaProcessQueue {
  constructor(options = {}) {
    this.name = String(options.name || 'media-process');
    this.concurrency = Math.max(1, Number(options.concurrency || 1));
    this.pending = [];
    this.running = 0;
    this.sequence = 0;
    this.closed = false;
    this.onStateChange = typeof options.onStateChange === 'function'
      ? options.onStateChange
      : null;
  }

  snapshot() {
    return {
      schemaVersion: MEDIA_PROCESS_QUEUE_SCHEMA_VERSION,
      name: this.name,
      concurrency: this.concurrency,
      running: this.running,
      pending: this.pending.length,
      closed: this.closed,
    };
  }

  emitState(event, job) {
    this.onStateChange?.({
      ...this.snapshot(),
      event,
      jobId: job?.id || '',
      kind: job?.kind || '',
      taskId: job?.taskId || '',
      caseId: job?.caseId || '',
      timestamp: new Date().toISOString(),
    });
  }

  enqueue(metadata = {}, operation) {
    if (this.closed) {
      const error = new Error(`${this.name} queue is closed`);
      error.code = 'MEDIA_PROCESS_QUEUE_CLOSED';
      return Promise.reject(error);
    }
    if (typeof operation !== 'function') {
      return Promise.reject(new TypeError('Media process queue requires an operation function'));
    }

    this.sequence += 1;
    const job = {
      id: `${this.name}-${this.sequence}`,
      kind: String(metadata.kind || 'media'),
      taskId: String(metadata.taskId || ''),
      caseId: String(metadata.caseId || ''),
      operation,
      queuedAt: Date.now(),
    };

    const promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    this.pending.push(job);
    this.emitState('queued', job);
    this.drain();
    return promise;
  }

  drain() {
    while (!this.closed && this.running < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      this.running += 1;
      this.emitState('started', job);
      Promise.resolve()
        .then(job.operation)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.running -= 1;
          this.emitState('finished', job);
          this.drain();
        });
    }
  }

  close(reason = 'solopi-desktop media process queue was closed') {
    this.closed = true;
    const error = new Error(reason);
    error.code = 'MEDIA_PROCESS_QUEUE_CLOSED';
    while (this.pending.length > 0) {
      this.pending.shift().reject(error);
    }
    this.emitState('closed');
  }
}

module.exports = {
  MEDIA_PROCESS_QUEUE_SCHEMA_VERSION,
  MediaProcessQueue,
};
