const fs = require('node:fs');
const path = require('node:path');
const { monitorEventLoopDelay } = require('node:perf_hooks');

function createRuntimeDiagnostics({ directory, version, getTaskIds = () => [], getMetrics = () => [], histogram = monitorEventLoopDelay({ resolution: 100 }) }) {
  histogram.enable();
  let last = {}, promptOpen = false, lastDiskSample=0;
  function sample() {
    last = { measuredAt: new Date().toISOString(), windowMs: 10000,
      meanMs: Number.isFinite(histogram.mean) ? histogram.mean / 1e6 : 0,
      maxMs: histogram.max / 1e6, p99Ms: histogram.percentile(99) / 1e6 };
    histogram.reset();
    if(Date.now()-lastDiskSample>=60000){
      lastDiskSample=Date.now();
      try{const storage=fs.statfsSync(directory);require('./diagnostics').record({event:'storage.performance',diskFreeBytes:storage.bavail*storage.bsize});}
      catch(error){require('./diagnostics').record({event:'performance.sample-error',source:'storage',code:error.code});}
    }
    const memory=process.memoryUsage();require('./diagnostics').record({event:'process.node-memory',pid:process.pid,heapUsedBytes:memory.heapUsed,rssBytes:memory.rss,externalBytes:memory.external,arrayBuffersBytes:memory.arrayBuffers,uptimeSeconds:process.uptime(),eventLoopMaxMs:last.maxMs,eventLoopP99Ms:last.p99Ms});
    try{
      for (const metric of getMetrics()) require('./diagnostics').record({event:'process.performance', processType:metric.type, pid:metric.pid,cpuPercent:metric.cpu?.percentCPUUsage, workingSetKb:metric.memory?.workingSetSize, eventLoopMaxMs:last.maxMs, eventLoopP99Ms:last.p99Ms});
    }catch(error){require('./diagnostics').record({event:'performance.sample-error',source:'process',code:error.code});}
  }
  const timer=setInterval(sample,10000);
  timer.unref?.();
  const snapshot = () => ({ ...last, currentMaxMs: histogram.max / 1e6 });
  function record(type, details = {}) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, 'runtime.jsonl');
    // Bounded local diagnostics. No URLs, command output or business logs.
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, `${file}.previous`);
    fs.appendFileSync(file, JSON.stringify({ timestamp: new Date().toISOString(), type, version,
      pid: process.pid, mainProcessMemory: process.memoryUsage(), taskIds: getTaskIds(), eventLoop: snapshot(), ...details }) + '\n', { mode: 0o600 });
    return file;
  }
  return {
    snapshot, record, sample,
    async recover(window, dialog, shell, type, details = {}) {
      let diagnosticsPath = directory;
      try { diagnosticsPath = record(type, details); } catch (error) { console.error('[diagnostics]', error.message); }
      if (promptOpen || window.isDestroyed()) return;
      promptOpen = true;
      try {
        const result = await dialog.showMessageBox(window, { type: 'error', title: 'solopi-desktop 界面异常',
          message: type === 'renderer-crash' ? '界面进程已退出' : '界面暂时无响应',
          detail: '任务状态由主进程保存。可重新加载界面查看当前进度；关闭应用会停止任务。',
          buttons: ['重新加载界面', '打开诊断目录', '暂不处理'], defaultId: 0, cancelId: 2 });
        if (result.response === 0 && !window.isDestroyed()) window.webContents.reload();
        if (result.response === 1) shell.showItemInFolder(diagnosticsPath);
      } finally { promptOpen = false; }
    },
    close() { clearInterval(timer); histogram.disable(); },
  };
}
module.exports = { createRuntimeDiagnostics };
