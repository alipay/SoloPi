// Metadata only: never accept report text, image paths, URLs or business logs.
const numericFields = [
  'durationMs', 'caseCount', 'visibleCaseCount', 'commitCount', 'renderSampleCount', 'renderMs', 'maxRenderMs',
  'longTaskCount', 'longTaskMs', 'maxLongTaskMs', 'longTaskObserverSupported', 'rendererHeapUsedBytes',
  'thumbnailRequests', 'thumbnailCacheHits', 'thumbnailSharedReads', 'thumbnailReads', 'thumbnailFailures', 'thumbnailDecodeFailures',
  'thumbnailCancelled', 'thumbnailPeakActive', 'thumbnailPeakQueued', 'thumbnailReadMs', 'thumbnailMaxReadMs',
  'thumbnailMaxQueueMs', 'thumbnailActive', 'thumbnailQueued', 'thumbnailCacheEntries',
];
function createReportPerformanceRecorder({ record = data => require('./diagnostics').record(data), now = Date.now } = {}) {
  const buckets = new WeakMap();
  return (event, payload) => {
    if (!payload || !['open','paint','sample','close'].includes(payload.stage)
      || typeof payload.taskId !== 'string' || !/^[\w.:-]{1,160}$/.test(payload.taskId)) {
      return { success:false, errorCode:'INVALID_REPORT_DIAGNOSTIC' };
    }
    const data = { event:'report.view.performance', source:'renderer', taskId:payload.taskId, stage:payload.stage };
    for (const field of numericFields) {
      if (payload[field] === undefined) continue;
      if (typeof payload[field] !== 'number' || !Number.isFinite(payload[field]) || payload[field] < 0 || payload[field] > 1e12) {
        return { success:false, errorCode:'INVALID_REPORT_DIAGNOSTIC' };
      }
      data[field] = payload[field];
    }
    const sender = event.sender, time = now();
    let bucket = buckets.get(sender);
    if (!bucket || time - bucket.start >= 60000) { bucket = {start:time, count:0}; buckets.set(sender,bucket); }
    if (++bucket.count > 12) return { success:false, errorCode:'REPORT_DIAGNOSTIC_RATE_LIMIT' };
    try { record(data); return { success:true }; }
    catch { return { success:false, errorCode:'REPORT_DIAGNOSTIC_WRITE_FAILED' }; }
  };
}
module.exports = { numericFields, createReportPerformanceRecorder };
