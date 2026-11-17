/** Deduplicate report reads, bound waiting, and require explicit retries after failure. */
export function createReportDetailRequests<T>(timeoutMs = 30_000) {
  const requests = new Map<string, { promise: Promise<T>; settled: boolean }>();
  return {
    load(key: string, read: () => Promise<T>, retry = false): Promise<T> {
      const existing = requests.get(key);
      if (existing && (!retry || !existing.settled)) return existing.promise;
      let timer: ReturnType<typeof setTimeout>;
      const entry = { promise: undefined as unknown as Promise<T>, settled: false };
      entry.promise = Promise.race([
        Promise.resolve().then(read),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('报告详情读取超时，请重试并检查报告源目录')), timeoutMs);
        }),
      ]).finally(() => {
        clearTimeout(timer);
        entry.settled = true;
      });
      requests.set(key, entry);
      void entry.promise.then(() => {
        // The task store owns loaded details; do not retain a second report cache.
        if (requests.get(key) === entry) requests.delete(key);
      }, () => { /* Keep failed reads until an explicit retry or a new revision. */ });
      return entry.promise;
    },
  };
}
