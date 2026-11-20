export type ReportMetrics = Record<string, number>;
export function createReportPerformanceSession({ taskId, emit, snapshot, now = () => performance.now() }: {
  taskId: string; emit: (data: Record<string, unknown>) => void; snapshot: () => ReportMetrics; now?: () => number;
}) {
  const started = now();
  let closed = false, commits = 0, renderMs = 0, maxRenderMs = 0, longTasks = 0, longTaskMs = 0, maxLongTaskMs = 0;
  let signature = '';
  function send(stage: string, force = false) {
    if (closed) return;
    try {
      const metrics = { ...snapshot(), renderSampleCount: commits, ...(commits ? { commitCount: commits, renderMs, maxRenderMs } : {}), longTaskCount: longTasks, longTaskMs, maxLongTaskMs };
      const next = JSON.stringify(metrics);
      if (!force && next === signature) return;
      signature = next;
      emit({ event: 'report.view.performance', taskId, stage, durationMs: Math.max(0, now() - started), ...metrics });
    } catch { /* Observation cannot break reports. */ }
  }
  send('open', true);
  return {
    commit(duration: number) { if (!closed && Number.isFinite(duration) && duration >= 0) { commits++; renderMs += duration; maxRenderMs = Math.max(maxRenderMs, duration); } },
    longTask(duration: number) { if (!closed && Number.isFinite(duration) && duration >= 50) { longTasks++; longTaskMs += duration; maxLongTaskMs = Math.max(maxLongTaskMs, duration); } },
    sample() { send('sample'); },
    paint() { send('paint', true); },
    close() { if (!closed) { send('close', true); closed = true; } },
  };
}
