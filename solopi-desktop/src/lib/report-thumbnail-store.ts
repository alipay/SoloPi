type ImageResult = { success?: boolean; dataUrl?: string };
type ReadImage = (path: string) => Promise<ImageResult>;
type Listener = (url: string) => void;

/** Report-scoped, bounded thumbnail cache. Original images never enter this cache. */
export function createReportThumbnailStore(concurrency = 3, capacity = 48) {
  const cache = new Map<string, string>();
  const jobs = new Map<string, { path: string; read: ReadImage; listeners: Set<Listener>; queuedAt: number }>();
  const queue: Array<NonNullable<ReturnType<typeof jobs.get>>> = [];
  let active = 0;
  const totals = { thumbnailRequests: 0, thumbnailCacheHits: 0, thumbnailSharedReads: 0, thumbnailReads: 0,
    thumbnailFailures: 0, thumbnailDecodeFailures: 0, thumbnailCancelled: 0, thumbnailPeakActive: 0, thumbnailPeakQueued: 0,
    thumbnailReadMs: 0, thumbnailMaxReadMs: 0, thumbnailMaxQueueMs: 0 };
  const now = () => performance.now();
  function pump() {
    while (active < concurrency && queue.length) {
      const job = queue.shift()!;
      if (!job.listeners.size) { totals.thumbnailCancelled++; jobs.delete(job.path); continue; }
      active++;
      totals.thumbnailReads++;
      totals.thumbnailPeakActive = Math.max(totals.thumbnailPeakActive, active);
      const started = now();
      totals.thumbnailMaxQueueMs = Math.max(totals.thumbnailMaxQueueMs, started - job.queuedAt);
      void Promise.resolve().then(() => job.read(job.path)).then(result => {
        const url = result.success && result.dataUrl ? result.dataUrl : '';
        if (!url) totals.thumbnailFailures++;
        if (url && job.listeners.size) {
          cache.set(job.path, url);
          while (cache.size > capacity) cache.delete(cache.keys().next().value!);
        }
        job.listeners.forEach(listener => listener(url));
      }, () => { totals.thumbnailFailures++; job.listeners.forEach(listener => listener('')); }).finally(() => {
        const elapsed = Math.max(0, now() - started);
        totals.thumbnailReadMs += elapsed; totals.thumbnailMaxReadMs = Math.max(totals.thumbnailMaxReadMs, elapsed);
        active--;
        jobs.delete(job.path);
        pump();
      });
    }
  }
  return {
    imageFailed: (path: string) => { totals.thumbnailDecodeFailures++; cache.delete(path); },
    metrics: () => ({ ...totals, thumbnailActive: active, thumbnailQueued: queue.length, thumbnailCacheEntries: cache.size }),
    subscribe(path: string, read: ReadImage, listener: Listener) {
      totals.thumbnailRequests++;
      const cached = cache.get(path);
      if (cached) {
        totals.thumbnailCacheHits++;
        cache.delete(path); cache.set(path, cached);
        listener(cached);
        return () => {};
      }
      let job = jobs.get(path);
      if (!job) {
        job = { path, read, listeners: new Set(), queuedAt: now() };
        jobs.set(path, job); queue.push(job);
        totals.thumbnailPeakQueued = Math.max(totals.thumbnailPeakQueued, queue.length);
      }
      else totals.thumbnailSharedReads++;
      job.listeners.add(listener);
      pump();
      return () => { job!.listeners.delete(listener); };
    },
  };
}
