const path = require('node:path');
const { performance } = require('node:perf_hooks');

// One lazy worker shares the write queue; JSON traversal and disk I/O stay off the UI thread.
const { Worker } = require('node:worker_threads');
let worker, sequence = 0;
const requests = new Map();
function reportWorker() {
  if (worker) return worker;
  const current = new Worker(path.join(__dirname, 'task-json-worker.js'));
  worker = current;
  current.on('message', ({id, metrics, error}) => {
    const request = requests.get(id);
    if (!request) return;
    requests.delete(id);
    if (error) request.reject(Object.assign(new Error(error.message), {code:error.code}));
    else request.resolve({...metrics, setupMs:request.setupMs, queueMs:Math.max(0, performance.now()-request.started-request.setupMs-metrics.serializeMs-metrics.diskWriteMs)});
    if (!requests.size) current.unref();
  });
  const fail = error => {
    if (worker === current) worker = null;
    for (const request of requests.values()) request.reject(error);
    requests.clear();
  };
  current.on('error', fail);
  current.on('exit', code => { if (worker === current) fail(Object.assign(new Error(`报告写入进程退出：${code}`), {code:'REPORT_WORKER_EXIT'})); });
  current.unref();
  return current;
}
function writeTaskJson(file, task) {
  return new Promise((resolve,reject) => {
    const current = reportWorker(), id = ++sequence, started = performance.now();
    const request = {resolve,reject,started,setupMs:0};
    requests.set(id,request); current.ref();
    try { current.postMessage({id,file,task}); request.setupMs=performance.now()-started; }
    catch (error) { requests.delete(id); if(!requests.size)current.unref(); reject(error); }
  });
}
function createTaskReportWriter({ write = writeTaskJson, onCommit = () => {}, onError = () => {}, delayMs = 1000 } = {}) {
  const records = new Map();
  let statistics = {};
  function start(file, record) {
    if (record.running) return record.running;
    clearTimeout(record.timer); record.timer = null;
    record.running = (async () => {
      while (record.pending) {
        const task = record.pending; record.pending = null;
        try {
          const start = performance.now(); const metrics = await write(file, task);
          const written = performance.now(); const commitMetrics = await onCommit(file, task);
          statistics = { measuredAt: new Date().toISOString(), ...metrics, ...commitMetrics,
            writeMs: written - start, indexCommitMs: performance.now() - written,
            coalescedCount: record.coalescedCount || 0 };
          require('./diagnostics').record({event:'report.persist',taskId:task.id,...statistics});
          record.error = null;
        }
        catch (error) { record.error = error; require('./diagnostics').record({event:'report.persist-error',taskId:task.id,code:error.code || 'REPORT_WRITE_FAILED'}); try { onError(error, task); } catch (diagnosticError) { console.error(diagnosticError); } break; }
      }
    })().finally(() => { record.running = null; });
    return record.running;
  }
  return {
    snapshot: () => ({ ...statistics }),
    schedule(file, task) {
      let record = records.get(file);
      if (!record) { record = {}; records.set(file, record); }
      // The runner updates records immutably. Snapshot the collector's append-only arrays.
      if(record.pending)record.coalescedCount=(record.coalescedCount || 0)+1;
      record.pending = { ...task, performanceReports: task.performanceReports && Object.fromEntries(
        Object.entries(task.performanceReports).map(([key, report]) => [key, { ...report, samples: [...(report.samples || [])] }])) };
      if (!record.running && !record.timer) record.timer = setTimeout(() => void start(file, record), delayMs);
    },
    async flush(file) {
      const entries = file ? [[file, records.get(file)]] : [...records];
      for (const [name, record] of entries) {
        if (!record) continue;
        if (record.running) await record.running;
        if (record.pending) await start(name, record);
        if (record.error) throw record.error;
        clearTimeout(record.timer);
        if (!record.running && !record.pending) records.delete(name);
      }
    },
  };
}
module.exports = { createTaskReportWriter, writeTaskJson };
