const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const { createWorkflowLogJournal } = require('./workflow-log-journal');

// One owner per task/device. Reports and assertions consume the same stdout.
function startTaskLogCapture({ directory, devices, adbPath, spawnProcess = spawn, onSession = () => {}, onStop = () => {} }) {
  for (const device of devices) if (!device.serial) throw new Error(`完整日志采集缺少${device.deviceType === 'glasses' ? '眼镜' : '手机'}设备 SN`);
  fs.mkdirSync(directory, { recursive: true });
  const unique = [...new Map(devices.map(device => [device.serial, device])).values()];
  const started = [];
  let sessions;
  try { sessions = unique.map(({ deviceType, serial }) => {
    const artifact = { deviceType, serial, path: path.join(directory, `${deviceType}-${serial.replace(/[^a-zA-Z0-9_-]/g, '_')}-full-logcat.txt`), startedAt: new Date().toISOString(), error: '' };
    const journal = createWorkflowLogJournal(directory);
    const stream = fs.createWriteStream(artifact.path);
    let child;
    try { child = spawnProcess(adbPath, ['-s', serial, 'logcat', '-v', 'threadtime', '-T', '1', '*:V'], { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { journal.close(); stream.on('error', () => {}); stream.end(); throw error; }
    const decoder = new StringDecoder('utf8');
    const session = { taskOwned: true, serial, deviceType, process: child, artifact, waiters: new Set(), buffer: '', lineSequence: 0, receivedBytes: 0, recentLines: [], recentLineSeqs: [], lastError: '', journal, exited: false };
    let stopping = false, closed = false;
    const fail = message => {
      artifact.error = `${artifact.error}\n${message}`.trim().slice(-8000);
      session.lastError = artifact.error;
    };
    const rejectWaiters = error => { error.code = 'LOG_EVIDENCE_UNAVAILABLE'; error.errorType = 'log-infrastructure'; for (const waiter of [...session.waiters]) { clearTimeout(waiter.timer); waiter.reject(error); } session.waiters.clear(); };
    stream.on('error', error => { fail(error.message); session.journalError = error; rejectWaiters(error); child.kill('SIGTERM'); });
    child.stdout.pipe(stream);
    child.stdout.on('data', chunk => {
      if (session.exited) return;
      session.receivedBytes += Buffer.byteLength(chunk);
      session.buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      const lines = session.buffer.split(/\r?\n/); session.buffer = lines.pop() || '';
      const completeLines = lines.filter(Boolean);
      try { if (!session.journalError && completeLines.length) session.journal.append(completeLines, session.lineSequence + 1); }
      catch (error) { session.journalError = error; fail(error.message); rejectWaiters(error); }
      for (const line of completeLines) {
        session.lineSequence++;
        session.recentLines.push(line); session.recentLineSeqs.push(session.lineSequence);
        if (session.recentLines.length > 2000) { session.recentLines.shift(); session.recentLineSeqs.shift(); }
        if (session.journalError) continue;
        for (const waiter of [...session.waiters]) {
          try { if (waiter.matcher(line)) { clearTimeout(waiter.timer); session.waiters.delete(waiter); waiter.resolve(line); } }
          catch (error) { clearTimeout(waiter.timer); session.waiters.delete(waiter); waiter.reject(error); }
        }
      }
    });
    child.stderr.on('data', data => fail(data.toString()));
    const processDone = new Promise(resolve => {
      child.once('error', error => { fail(error.message); session.exited = true; rejectWaiters(error); stream.end(); resolve(); });
      child.once('close', code => { closed = true; session.exited = true; if (!stopping) fail(`日志进程提前退出 (${code})，完整日志可能不完整`); rejectWaiters(new Error(session.lastError || '日志监听已停止')); stream.end(); resolve(); });
    });
    const streamDone = new Promise(resolve => stream.once('close', resolve));
    onSession(session);
    const owned = { session, artifact, async stop() {
      stopping = true;
      rejectWaiters(new Error('任务日志采集已停止'));
      if (!closed) child.kill('SIGTERM');
      const timer = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 3000);
      let deadline;
      await Promise.race([Promise.all([processDone, streamDone]), new Promise(resolve => { deadline = setTimeout(() => {
        fail('日志进程关闭未在 5 秒内确认，证据可能不完整'); child.stdout.unpipe(stream); stream.end(); resolve();
      }, 5000); })]);
      clearTimeout(timer); clearTimeout(deadline);
      session.exited = true;
      session.journal.close(); onStop(session);
      artifact.endedAt = new Date().toISOString();
      return artifact;
    } };
    started.push(owned);
    return owned;
  }); } catch (error) {
    for (const owned of started) void owned.stop();
    throw error;
  }
  let stopPromise;
  return { sessions: Object.fromEntries(sessions.map(item => [item.session.serial, item.session])), logs: sessions.map(item => item.artifact), stop() { return stopPromise ||= Promise.all(sessions.map(item => item.stop())); } };
}
module.exports = { startTaskLogCapture };
