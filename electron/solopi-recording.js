const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { convertSoloPiCase, MAX_BYTES } = require('./solopi-case-converter');

// Desktop owns the bundled recording provider and only the sessions started here.
function createSoloPiRecording({ directory, gate, provider, operationTimeoutMs }) {
  const entries = new Map();
  let loaded = false, closing = false;
  const file = () => path.join(directory(), 'solopi-recording.json');
  function save() {
    fs.mkdirSync(directory(), { recursive: true });
    const next = `${file()}.tmp`;
    fs.writeFileSync(next, JSON.stringify({ providerVersion: 1, sessions: [...entries.values()].map(({ lease, busy, cancelCall, discarding, skipPermissionPrecheck, ...e }) => e) }), { mode: 0o600 });
    fs.renameSync(next, file());
  }
  function load() {
    if (loaded) return;
    loaded = true;
    if (!fs.existsSync(file())) return;
    const stored = JSON.parse(fs.readFileSync(file(), 'utf8'));
    for (const storedEntry of stored.sessions || []) {
      const { settings: legacySettings, ...entry } = storedEntry;
      const lease = entry.finished ? { release() {} } : gate.acquire({ id: entry.id, name: 'SoloPi 录制恢复', reservedDeviceSerials: [entry.serial] });
      entries.set(entry.id, { ...entry, state: entry.finished ? 'stopped' : 'recovery-required', lease });
    }
  }
  async function call(entry, command, args = []) {
    if (!provider) throw new Error('内置录制组件不可用');
    let timer;
    const cancel = reason => { provider.cancelPending?.(entry.id); rejectCall(Object.assign(new Error(reason), { code: 'SOLOPI_OPERATION_CANCELLED' })); };
    let rejectCall;
    const cancelled = new Promise((_, reject) => { rejectCall = reject; });
    entry.cancelCall = cancel;
    const timeout = operationTimeoutMs ?? (command === 'record-start' ? 180000 : command === 'record-status' ? 15000 : 45000);
    timer = setTimeout(() => cancel('录制操作超时，可放弃本次导入后重新录制'), timeout);
    try {
      const result = await Promise.race([provider.execute(entry, command, args), cancelled]);
      if (result?.success !== true) throw Object.assign(new Error(result?.error || `录制 ${command} 失败`), { receipt: result });
      return result;
    } finally { clearTimeout(timer); if (entry.cancelCall === cancel) delete entry.cancelCall; }
  }

  function view(e) { return { id: e.id, serial: e.serial, name: e.name, state: e.state, error: e.error || '', finished: Boolean(e.finished), startMode: e.startMode || 'app-launch' }; }
  function current() { load(); return { provider: 'builtin', packageName: 'com.alipay.hulu', sessions: [...entries.values()].map(view) }; }
  function owned(id) { load(); const e = entries.get(id); if (!e) throw new Error('不是 desktop 创建的录制会话'); return e; }
  async function resolveSession(e) {
    if (e.sessionId) return;
    const status = await call(e, 'record-status');
    if (status.caseName !== e.providerName || status.targetPackage !== e.targetPackage || !status.sessionId) throw new Error('无法确认录制会话归属；保留设备占用，请核对 SoloPi 状态后重试');
    e.sessionId = status.sessionId; save();
  }
  async function start({ serial, name, targetPackage, startMode = 'app-launch', preparationShell = '', skipPermissionPrecheck = false }) {
    load();
    if (closing) throw new Error('应用正在退出');
    if (typeof serial !== 'string' || !serial.trim() || serial.startsWith('-')) throw new Error('请指定手机序列号');
    if (typeof name !== 'string' || !name.trim()) throw new Error('请填写用例名称');
    if (!/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/.test(targetPackage || '')) throw new Error('请填写有效的录制目标包名');
    if (typeof skipPermissionPrecheck !== 'boolean') throw new Error('权限预检选项无效');
    if (!['app-launch', 'command-prepared'].includes(startMode)) throw new Error('录制启动模式无效');
    if (typeof preparationShell !== 'string' || preparationShell.length > 32768 || preparationShell.includes('\0')) throw new Error('前置命令无效或超过 32 KiB');
    if (startMode === 'command-prepared' && !preparationShell.trim()) throw new Error('请填写进入目标页面的 ADB Shell 前置命令');
    preparationShell = startMode === 'command-prepared' ? `set -e\n${preparationShell.trim()}` : '';
    const id = crypto.randomUUID();
    const e = { id, serial, name: name.trim(), targetPackage, startMode, preparationShell, skipPermissionPrecheck, providerName: `desktop-${id}`, state: 'starting', finished: false,
      lease: gate.acquire({ id, name: 'SoloPi 操作录制', reservedDeviceSerials: [serial] }), busy: true };
    entries.set(id, e);
    try { save(); } catch (error) { entries.delete(id); e.lease.release(); throw error; }
    try {
      const result = await call(e, 'record-start', ['--name', e.providerName, '--target-package', targetPackage]);
      if (result.caseName !== e.providerName || result.targetPackage !== targetPackage || !result.sessionId || result.state !== 'recording') throw new Error('SoloPi 录制启动回执不匹配');
      e.sessionId = result.sessionId; e.state = result.state; save(); return view(e);
    } catch (error) {
      if (error.notDispatched) { entries.delete(id); e.lease.release(); save(); throw error; }
      if (error.receipt?.sessionId && error.receipt.phase === 'record-start') e.sessionId = error.receipt.sessionId;
      // Before a session id is acknowledged, start outcome can be uncertain. Never stop another session.
      e.state = 'recovery-required'; e.error = error.message; save();
      throw Object.assign(error, { recording: view(e) });
    } finally { e.busy = false; }
  }
  async function releasePhone(e) {
    if (e.phoneReleased) return;
    const result = await call(e, 'record-release');
    if (result.released) { e.phoneReleased = true; save(); }
  }
  async function stop(id, { convert = true } = {}) {
    const e = owned(id);
    if (e.busy) throw new Error('此录制请求仍在处理，请稍后重试');
    e.busy = true;
    try {
      if (!e.finished) {
        await resolveSession(e);
        const result = await call(e, 'record-stop', ['--session-id', e.sessionId]);
        if (result.sessionId !== e.sessionId || result.state !== 'stopped') throw new Error('SoloPi 未确认此会话已停止');
        e.state = 'stopped'; e.finished = true;
        save();
      }
      if (!convert) return { session: view(e) };
      const exported = e.exportedCase || await call(e, 'case-get', ['--case', e.providerName]);
      if (exported.case?.caseName !== e.providerName || exported.case?.targetAppPackage !== e.targetPackage) throw new Error('SoloPi 导出用例与本次录制不匹配');
      // Save the complete export before stopping the companion HTTP service.
      e.exportedCase = exported; save();
      await releasePhone(e);
      const conversion = convertSoloPiCase(exported, { phoneSerial: e.serial, ...(e.startMode === 'command-prepared' ? { replayStart: 'current-page', preparationShell: e.preparationShell } : {}) });
      e.error = ''; save();
      conversion.testCase.name = e.name;
      conversion.testCase.conversionSource.title = e.name;
      return { session: view(e), ...conversion };
    } catch (error) { e.error = error.message; if (!e.finished) e.state = 'recovery-required'; save(); throw error; }
    finally { e.busy = false; if (e.finished) e.lease.release(); }
  }
  async function stopAll() {
    closing = true;
    load();
    provider?.cancelPending?.();
    const deadline = Date.now() + 2100;
    const stopping = Promise.allSettled([...entries.values()].filter(e => !e.finished).map(async e => {
      while (e.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      if (e.busy) { e.error = '应用退出前未能确认录制停止，请恢复此会话'; e.state = 'recovery-required'; save(); return; }
      return stop(e.id, { convert: false });
    }));
    let timer;
    await Promise.race([stopping, new Promise(resolve => { timer = setTimeout(resolve, 2200); })]);
    clearTimeout(timer);
    await provider?.close?.();
  }
  async function discard(id) {
    const e = owned(id);
    if (e.discarding) throw new Error('正在放弃本次导入，请稍候');
    e.discarding = true;
    let warning = '';
    try {
      // A failed conversion/stop must not make discard unreachable. Cancel only this entry.
      if (e.busy) {
        e.cancelCall?.('本次操作已取消，正在放弃导入');
        const deadline = Date.now() + 1000;
        while (e.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        if (e.busy) throw new Error('录制操作正在取消，请稍后重试放弃');
      }
      e.busy = true;
      if (!e.finished) {
        // Always re-check, including when an old sessionId is already stored locally.
        let status;
        try { status = await call(e, 'record-status'); }
        catch (error) { warning = `已放弃本地导入，但未能确认手机录制状态：${error.message}。再次录制前会重新核验手机状态。`; }
        if (status && (status.kind !== 'recording' || typeof status.active !== 'boolean')) throw new Error('SoloPi 状态回执无效，设备占用已保留');
        const same = status?.sessionId && (e.sessionId ? status.sessionId === e.sessionId :
          status.caseName === e.providerName && status.targetPackage === e.targetPackage);
        if (same && status.active) {
          e.sessionId = status.sessionId;
          const result = await call(e, 'record-stop', ['--session-id', e.sessionId]);
          if (result.sessionId !== e.sessionId || (result.state !== 'stopped' && !(result.state === 'failed' && result.active === false))) throw new Error('SoloPi 未确认本次录制已结束');
        }
        if (same) { e.sessionId = status.sessionId; await releasePhone(e); }
        // Inactive or different current session: detach our stale local entry, never stop others.
      }
      if (e.finished && !e.phoneReleased) await releasePhone(e);
      const archive = path.join(directory(), 'solopi-recording-history');
      fs.mkdirSync(archive, { recursive: true });
      fs.writeFileSync(path.join(archive, `${e.id}.json`), JSON.stringify({ ...view(e), providerName: e.providerName, sessionId: e.sessionId, warning, discardedAt: new Date().toISOString() }), { mode: 0o600 });
      entries.delete(id);
      try { save(); } catch (error) { entries.set(id, e); throw error; }
      e.lease.release();
      return { discarded: true, warning };
    } catch (error) { e.state = 'recovery-required'; e.error = error.message; save(); throw error; }
    finally { e.busy = false; delete e.discarding; }
  }

  return { current, start, stop, discard, stopAll };
}
module.exports = { createSoloPiRecording };
