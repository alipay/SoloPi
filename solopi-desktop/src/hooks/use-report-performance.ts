import { useCallback, useEffect, useRef, type ProfilerOnRenderCallback } from 'react';
import { createReportPerformanceSession } from '../lib/report-performance';
import type { createReportThumbnailStore } from '../lib/report-thumbnail-store';

type Invoke = (channel: string, payload: unknown) => Promise<unknown>;
export function useReportPerformance(taskId: string, caseCount: number, store: ReturnType<typeof createReportThumbnailStore>, invoke?: Invoke) {
  const session = useRef<ReturnType<typeof createReportPerformanceSession> | null>(null);
  const view = useRef({ taskId, caseCount });
  if (view.current.taskId === taskId) view.current.caseCount = caseCount;
  else view.current = { taskId, caseCount };
  useEffect(() => {
    if (!taskId || !invoke) return;
    const currentView = view.current;
    let longTaskObserverSupported = 0;
    const current = createReportPerformanceSession({ taskId,
      emit: data => { try { void invoke('workflow-report:performance', data).catch(() => {}); } catch { /* Optional diagnostics. */ } },
      snapshot: () => ({ caseCount: currentView.caseCount, visibleCaseCount: document.querySelectorAll('[data-report-case-detail]').length,
        ...store.metrics(), longTaskObserverSupported,
        rendererHeapUsedBytes: (performance as Performance & { memory?: {usedJSHeapSize?: number} }).memory?.usedJSHeapSize || 0,
      }),
    });
    session.current = current;
    let observer: PerformanceObserver | undefined;
    try {
      if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
        observer = new PerformanceObserver(list => list.getEntries().forEach(entry => current.longTask(entry.duration)));
        observer.observe({ entryTypes: ['longtask'] }); longTaskObserverSupported = 1;
      }
    } catch { /* Unsupported observers do not affect report rendering. */ }
    const frame = requestAnimationFrame(() => current.paint());
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') current.sample(); }, 10000);
    return () => {
      cancelAnimationFrame(frame); window.clearInterval(timer);
      observer?.takeRecords().forEach(entry => current.longTask(entry.duration)); observer?.disconnect();
      current.close(); session.current = null;
    };
  }, [taskId, store, invoke]);
  return useCallback<ProfilerOnRenderCallback>((_id, _phase, actualDuration) => session.current?.commit(actualDuration), []);
}
