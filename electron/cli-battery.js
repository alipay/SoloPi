const fs = require('node:fs');
const path = require('node:path');
const owner = 'solopi-desktop-cli';
function createBatteryControl({ jobs, directory }) {
  async function status(id) {
    try { const { result, ...job } = jobs.get(owner, id); return { success: true, ...job }; }
    catch (_) {
      // Previous broker may have exited. Never restart an interrupted import implicitly.
      for (const entry of await fs.promises.readdir(directory(), { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; })) {
        if (!entry.isDirectory() || !/^analysis-[A-Za-z0-9_-]+$/.test(entry.name)) continue;
        const file = path.join(directory(), entry.name, 'status.json');
        let record;
        try { record = JSON.parse(await fs.promises.readFile(file, 'utf8')); } catch (_) { continue; }
        if (record.id !== id) continue;
        const interrupted = ['collecting','parsing','saving'].includes(record.status);
        return { success: true, ...record, status: interrupted ? 'interrupted' : record.status, reportKey: entry.name,
          ...(interrupted ? { error: '导入进程已结束，任务未完成；请重新提交' } : {}) };
      }
      throw Error('耗电导入任务不存在');
    }
  }
  return async input => {
    switch (input.operation) {
      case 'start': {
        if (Boolean(input.path) === Boolean(input.serial)) throw Error('仅选择日志文件或设备其中一个');
        const payload = input.path ? { mode: 'upload', ...jobs.registerUpload(owner, input.path) } : { mode: 'device', serial: input.serial };
        const { result, ...job } = jobs.start(owner, payload);
        await jobs.flush(owner, job.id);
        return { success: true, ...job };
      }
      case 'status': return status(input.id);
      case 'cancel': {
        const current = await status(input.id);
        if (!['collecting','parsing','saving'].includes(current.status)) return current;
        const { result, ...job } = await jobs.cancel(owner, input.id);
        return { success: true, ...job };
      }
      case 'history': return { success: true, ...await jobs.listReports() };
      case 'show': return { success: true, ...await jobs.openReport(input.key, owner) };
      default: throw Error('不支持的耗电操作');
    }
  };
}
module.exports = { createBatteryControl };
