const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');

// Format: https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/am/EventLogTags.logtags
// am_crash is emitted once by ActivityManager for an application crash (Java or native).
// Process death, force-stop, service restart and ANR are deliberately not crash events.
function parseCrashEvent(line, packageName) {
  const match = line.match(/^\s*(\d+\.\d+)\s+\d+\s+\d+\s+[A-Z]\s+am_crash\s*:\s*\[(.*)\]\s*$/);
  if (!match) return null;
  const fields = match[2].split(',');
  // Current Android: user,pid,process,flags,...; older Android omitted user.
  const offset = /^\d+$/.test(fields[1]?.trim()) ? 1 : 0;
  const pid = fields[offset]?.trim(), processName = fields[offset + 1]?.trim();
  if (!/^\d+$/.test(pid || '') || !processName) return null;
  const exception = fields[offset + 3]?.trim() || '';
  return { id: crypto.createHash('sha256').update(line.trim()).digest('hex'),
    timestamp: new Date(Number(match[1]) * 1000).toISOString(), deviceTime: Number(match[1]),
    pid, processName, isTarget: isTargetProcess(processName, packageName), sources: ['am_crash'], type: /native/i.test(exception) ? 'native' : 'java', exception,
    message: fields.slice(offset + 4).join(','), evidence: line };
}

function isTargetProcess(processName, packageName) {
  return Boolean(packageName && (processName === packageName || processName.startsWith(`${packageName}:`)));
}

// AndroidRuntime reports fatal Java exceptions even when a custom handler prevents am_crash.
// Ordinary error messages, ANR and process death do not establish a crash.
function createCrashLogParser(packageName) {
  const active = new Map();
  return line => {
    const match = line.match(/^\s*(\d+\.\d+)\s+(\d+)\s+\d+\s+([A-Z])\s+(AndroidRuntime|libc|DEBUG)\s*:\s*(.*)$/);
    if (!match) return null;
    const [, time, writerPid, , tag, message] = match;
    const fatal = tag === 'AndroidRuntime' && /^(?:\*\*\* )?FATAL EXCEPTION(?::| IN SYSTEM PROCESS:)/.test(message);
    const signal = tag === 'libc' && message.match(/^Fatal signal (.+)/);
    const signalProcess = signal && message.match(/\bpid (\d+) \(([^)]+)\)/);
    const nativeProcess = tag === 'DEBUG' && message.match(/^pid: (\d+),.*>>> (.+?) <<</);
    if (signal || nativeProcess) {
      const pid = signal ? (signalProcess?.[1] || writerPid) : nativeProcess[1];
      const processName = signal ? (signalProcess?.[2] || '') : nativeProcess[2];
      const event = { id: crypto.createHash('sha256').update(line.trim()).digest('hex'),
        timestamp: new Date(Number(time) * 1000).toISOString(), deviceTime: Number(time), pid, processName,
        isTarget: isTargetProcess(processName, packageName), type: 'native', exception: signal ? `Fatal signal ${signal[1]}` : 'Native crash',
        message, evidence: line, sources: [tag === 'libc' ? 'libc' : 'tombstone'] };
      if (nativeProcess) { active.set(`native:${writerPid}`, event); if (active.size > 256) active.delete(active.keys().next().value); }
      return { ...event };
    }
    if (tag === 'DEBUG') {
      const event = active.get(`native:${writerPid}`);
      if (!event || Number(time) - event.deviceTime > 5) return null;
      event.evidence = (event.evidence + '\n' + line).slice(0, 16384);
      return { ...event };
    }
    if (tag !== 'AndroidRuntime') return null;
    if (fatal) {
      active.delete(writerPid);
      active.set(writerPid, { id: crypto.createHash('sha256').update(line.trim()).digest('hex'),
        timestamp: new Date(Number(time) * 1000).toISOString(), deviceTime: Number(time), pid: writerPid,
        processName: '', type: 'java', exception: '', message, evidence: line, sources: ['AndroidRuntime'] });
      if (active.size > 256) active.delete(active.keys().next().value);
    }
    const event = active.get(writerPid);
    if (!event || Number(time) - event.deviceTime > 5) return null;
    if (!fatal && event.evidence.length < 16384) event.evidence = (event.evidence + '\n' + line).slice(0, 16384);
    const process = message.match(/^Process: (.+?), PID: (\d+)/);
    if (process) { event.processName = process[1]; event.pid = process[2]; }
    else if (!fatal && !event.exception && /(?:Exception|Error|Throwable)(?::|$)/.test(message)) event.exception = message;
    event.isTarget = isTargetProcess(event.processName, packageName);
    return { ...event };
  };
}

function createPerformanceCrashCollector({ serial, packageName, runtime = 'android', adbPath,
  artifactPath, onUpdate, spawnProcess = spawn, run = (args, signal) => new Promise((resolve, reject) => {
    execFile(adbPath, args, { timeout: 5000, maxBuffer: 1024 * 1024, signal }, (error, stdout) => error ? reject(error) : resolve(stdout));
  }) }) {
  let child, started = false, stopping = false, pending = '', stderr = '', stopPromise;
  const controller = new AbortController();
  const decoder = new StringDecoder('utf8'), parseLog = createCrashLogParser(packageName);
  const occurrenceIds = new Map();
  const state = { status: runtime === 'android' ? 'pending' : 'unsupported', source: 'android.logcat.crashes', scope: 'device', targetPackageName: packageName,
    startedAt: '', endedAt: '', count: 0, targetCount: 0, events: [], error: runtime === 'android' ? '' : '当前崩溃统计仅支持 Android；鸿蒙未采集', artifactPath };
  const snapshot = () => ({ ...state, events: state.events.map(event => ({ ...event, sources: [...event.sources], evidenceBySource: { ...event.evidenceBySource } })) });
  const publish = () => {
    if (artifactPath) {
      try {
        fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
        fs.writeFileSync(`${artifactPath}.tmp`, JSON.stringify(state), { mode: 0o600 });
        fs.renameSync(`${artifactPath}.tmp`, artifactPath);
      } catch (error) { state.error = `崩溃证据保存失败：${error.message}`; state.status = 'failed'; }
    }
    onUpdate?.(snapshot());
  };
  const fail = error => {
    if (state.status === 'failed') return;
    state.status = 'failed'; state.endedAt = new Date().toISOString();
    state.error = String(error.message || error); publish();
    child?.kill('SIGTERM');
  };
  let ready = Promise.resolve();
  return {
    start() {
      if (started || stopping) return ready;
      started = true; state.startedAt = new Date().toISOString();
      if (runtime !== 'android') { publish(); return ready; }
      ready = (async () => {
        try {
          // Establish a device-clock watermark without clearing shared log buffers.
          const baseline = String(await run(['-s', serial, 'shell', 'date', '+%s.%N'], controller.signal)).trim();
          if (!/^\d+\.\d+$/.test(baseline)) throw new Error('无法建立设备日志时间边界，未开始崩溃统计');
          // Round upwards: logcat -T supports milliseconds; never include older history.
          const watermark = Math.ceil(Number(baseline) * 1000) / 1000;
          if (stopping) return;
          child = spawnProcess(adbPath, ['-s', serial, 'logcat', '-b', 'events', '-b', 'main', '-b', 'crash', '-v', 'epoch', '-T', watermark.toFixed(3), 'am_crash:I', 'AndroidRuntime:E', 'libc:F', 'DEBUG:F', '*:S'], { stdio: ['ignore', 'pipe', 'pipe'] });
          const consume = chunk => {
            pending += decoder.write(chunk);
            let end, changed = false;
            while ((end = pending.indexOf('\n')) >= 0) {
              const line = pending.slice(0, end).replace(/\r$/, ''); pending = pending.slice(end + 1);
              const event = parseCrashEvent(line, packageName) || parseLog(line);
              if (!event || event.deviceTime <= watermark) continue;
              // Same occurrence can appear in main/crash buffers and later in am_crash.
              // Match only across sources; a new fatal from the same source remains a new crash.
              let existing = occurrenceIds.get(event.id);
              if (!existing) existing = [...state.events].reverse().find(item => item.pid === event.pid &&
                (!item.processName || !event.processName || item.processName === event.processName || (item.type === 'native' &&
                  ((item.sources.includes('libc') && item.processName.length <= 15 && event.processName.endsWith(item.processName)) ||
                   (event.sources.includes('libc') && event.processName.length <= 15 && item.processName.endsWith(event.processName))))) && item.type === event.type &&
                Math.abs(item.deviceTime - event.deviceTime) <= 5 &&
                !item.sources.some(source => event.sources.includes(source)));
              if (existing) {
                if (event.processName && (!existing.processName || event.sources.some(source => source === 'am_crash' || source === 'tombstone') || event.sources[0] === 'AndroidRuntime')) { existing.processName = event.processName; existing.isTarget = event.isTarget; }
                existing.evidenceBySource[event.sources[0]] = event.evidence;
                existing.sources = [...new Set([...existing.sources, ...event.sources])];
                existing.evidence = existing.sources.map(source => existing.evidenceBySource[source]).join('\n').slice(0, 49152);
                existing.exception ||= event.exception;
                occurrenceIds.set(event.id, existing);
              } else {
                event.evidenceBySource = { [event.sources[0]]: event.evidence };
                state.events.push(event); occurrenceIds.set(event.id, event);
              }
              changed = true;
            }
            if (changed) {
              state.count = state.events.length;
              state.targetCount = state.events.filter(event => event.isTarget).length;
              publish();
            }
            if (pending.length > 1024 * 1024) { fail(new Error('崩溃日志行超过读取上限，采集不完整')); pending = ''; }
          };
          child.stdout.on('data', consume);
          child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4096); });
          child.once('error', error => { if (!stopping) fail(error); });
          child.once('close', (code, signal) => { if (pending) consume(Buffer.from('\n')); if (!stopping) fail(new Error(`崩溃监听中断 (${code ?? signal}) ${stderr}`)); });
          state.status = 'running'; publish();
        } catch (error) { if (!stopping) fail(error); }
      })();
      return ready;
    },
    snapshot,
    stop() {
      if (stopPromise) return stopPromise;
      stopping = true; controller.abort();
      stopPromise = (async () => {
        await ready;
        if (child && child.exitCode === null && child.signalCode === null) {
          await new Promise(resolve => {
            let killTimer, deadline;
            const done = () => { clearTimeout(killTimer); clearTimeout(deadline); resolve(); };
            child.once('close', done); child.kill('SIGTERM');
            killTimer = setTimeout(() => child.kill('SIGKILL'), 500);
            deadline = setTimeout(done, 1500);
          });
        }
        state.endedAt ||= new Date().toISOString();
        if (state.status === 'running' || state.status === 'pending') state.status = 'stopped';
        publish(); return snapshot();
      })();
      return stopPromise;
    },
  };
}
module.exports = { parseCrashEvent, createCrashLogParser, createPerformanceCrashCollector };
