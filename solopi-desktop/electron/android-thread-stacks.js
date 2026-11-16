const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const quote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
const fail = (code, message) => Object.assign(new Error(message), { code });
function normalizeThreadStackOptions(value) {
  if (!value || value.enabled === false || value.enabled === undefined) return { enabled: false };
  if (typeof value !== 'object' || Array.isArray(value)) throw fail('STACK_CONFIG_INVALID', '线程栈配置必须是对象');
  if (value.enabled !== true) throw fail('STACK_CONFIG_INVALID', 'enabled 必须为布尔值');
  const number = (key, fallback, min, max) => {
    const n = Number(value[key] ?? fallback);
    if (!Number.isInteger(n) || n < min || n > max) throw fail('STACK_CONFIG_INVALID', `${key} 必须在 ${min}～${max} 之间`);
    return n;
  };
  const mode = value.mode || 'manual';
  if (!['manual', 'interval', 'checkpoint', 'failure'].includes(mode)) throw fail('STACK_CONFIG_INVALID', '未知线程栈采集模式');
  const checkpoints = value.checkpoints || [];
  if (!Array.isArray(checkpoints) || checkpoints.some(x => typeof x !== 'string' || !x.trim())) throw fail('STACK_CONFIG_INVALID', 'checkpoints 必须是节点 ID 数组');
  if (mode === 'checkpoint' && !checkpoints.length) throw fail('STACK_CONFIG_INVALID', '检查点模式必须指定节点 ID（在节点执行前采集）');
  return { enabled: true, mode, checkpoints, intervalMs: number('intervalMs', 60000, 30000, 3600000),
    maxCount: number('maxCount', 10, 1, 100), maxBytes: number('maxBytes', 16777216, 1024, 67108864),
    waitMs: number('waitMs', 5000, 500, 15000) };
}
function parseProcStat(text) {
  const end = String(text).lastIndexOf(')');
  const fields = String(text).slice(end + 2).trim().split(/\s+/);
  if (end < 0 || !/^\d+$/.test(fields[19] || '')) throw fail('STACK_IDENTITY_UNAVAILABLE', '无法读取进程启动标识');
  return { startTime: fields[19] };
}
function validateTrace(text, identity, signalEpoch = 0) {
  // Require a complete ART dump, with both exact PID and cmdline in the same section.
  const blocks = String(text).match(/----- pid \d+ at [^\n]+-----[\s\S]*?----- end \d+ -----/g) || [];
  return blocks.some(block => new RegExp(`^----- pid ${identity.pid} at `).test(block)
    && block.endsWith(`----- end ${identity.pid} -----`)
    && block.split(/\r?\n/).includes(`Cmd line: ${identity.packageName}`)
    && (!signalEpoch || Date.parse(block.match(/^----- pid \d+ at (.*?) -----/)[1]) >= (signalEpoch - 1) * 1000));
}
function createThreadStackCollector({ config: input, targets, directory, run, adbPath = 'adb', onUpdate = () => {}, now = Date.now, delay = ms => new Promise(r => setTimeout(r, ms)) }) {
  const config = normalizeThreadStackOptions(input);
  const signalTimes = new Map();
  const records = []; let count = 0, bytes = 0, lastAttempt = -Infinity, pending = null, stopped = false;
  const publish = () => { fs.mkdirSync(directory, { recursive: true }); const f = path.join(directory, 'index.json');
    fs.writeFileSync(`${f}.tmp`, JSON.stringify({ config, records }, null, 2)); fs.renameSync(`${f}.tmp`, f); onUpdate(records.map(r => ({ ...r }))); };
  const captureTarget = async (target, context, reason) => {
    const record = { id: crypto.randomUUID(), target: target.role, packageName: target.packageName, serial: target.serial,
      ...context, reason, startedAt: new Date(now()).toISOString(), status: 'collecting', commands: [], files: [], kind: 'ART-thread-stack-snapshot' };
    records.push(record); publish();
    const budgetDeadline = now() + 25000;
    const command = async (script, maxBuffer = 1048576) => {
      if (stopped) throw fail('STACK_CANCELLED', '采集已停止');
      if (now() >= budgetDeadline) throw fail('STACK_BUDGET_EXCEEDED', '采集总时间超过 25 秒上限');
      const item = { command: [adbPath, '-s', target.serial, 'shell', script], startedAt: new Date(now()).toISOString() };
      record.commands.push(item);
      try { const r = await run(['-s', target.serial, 'shell', script], { timeout: Math.min(5000, budgetDeadline - now()), maxBuffer });
        if (script.includes('kill -3')) item.stdout = r.stdout || '';
        Object.assign(item, { exitCode: r.exitCode ?? 0, stderr: r.stderr || '', endedAt: new Date(now()).toISOString() }); return String(r.stdout || '');
      } catch (e) { Object.assign(item, { exitCode: e.exitCode ?? null, stderr: e.stderr || '', error: e.message, endedAt: new Date(now()).toISOString() }); throw e; }
    };
    try {
      if (target.runtime && target.runtime !== 'android') throw fail('STACK_UNSUPPORTED_RUNTIME', '仅支持 Android ART');
      if (!target.serial || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+(?:\:[A-Za-z0-9_.]+)?$/.test(target.packageName || '')) throw fail('STACK_TARGET_INVALID', '设备或包名配置无效');
      const ids = (await command(`pidof ${quote(target.packageName)}`)).trim().split(/\s+/).filter(Boolean);
      if (ids.length !== 1 || !/^\d+$/.test(ids[0])) throw fail('STACK_PROCESS_NOT_FOUND', '目标进程不存在或不唯一');
      const pid = ids[0]; record.pid = pid;
      const stat = await command(`cat /proc/${pid}/stat`); const identity = { pid, packageName: target.packageName, ...parseProcStat(stat) }; record.identity = identity;
      const cmdline = await command(`cat /proc/${pid}/cmdline`);
      const maps = await command(`cat /proc/${pid}/maps`, 4194304);
      if (cmdline.split('\0')[0].trim() !== target.packageName || !/\/libart\.so(?:\s|$)/m.test(maps)) throw fail('STACK_NOT_CONFIRMED_ART', '目标身份或 ART 运行时无法确认，未发送信号');
      const properties = (await command('getprop dalvik.vm.stack-trace-dir; getprop dalvik.vm.stack-trace-file')).split(/\r?\n/).map(p => p.trim());
      const roots = [...new Set(['/data/anr', properties[0], properties[1] ? path.posix.dirname(properties[1]) : ''].filter(Boolean))];
      if (roots.some(p => !/^\/[A-Za-z0-9_./-]+$/.test(p) || p.includes('..') || p === '/')) throw fail('STACK_PATH_UNSUPPORTED', '系统报告的 trace 路径不支持安全探测');
      // Enumerate each directory separately to retain exact paths and permission errors.
      const list = async () => {
        const files = [];
        for (const root of roots) {
          const names = await command(`[ ! -d ${quote(root)} ] || ls -1 ${quote(root)}`);
          for (const name of names.trim().split(/\r?\n/).filter(Boolean)) {
            if (!/^[A-Za-z0-9_.-]+$/.test(name)) continue;
            if (files.length >= 64) throw fail('STACK_DIRECTORY_LIMIT', 'trace 目录文件超过 64 个，停止遍历');
            const remote = `${root}/${name}`;
            const info = (await command(`stat -c '%s %Y %i' ${quote(remote)}`)).trim().split(/\s+/);
            if (!info.every(v => /^\d+$/.test(v)) || info.length !== 3) throw fail('STACK_PATH_UNSUPPORTED', '无法读取 trace 文件属性');
            files.push({ remote, size: Number(info[0]), stamp: info.join(' ') });
          }
        }
        if (files.length > 64) throw fail('STACK_DIRECTORY_LIMIT', 'trace 目录文件超过 64 个，停止遍历');
        return files;
      };
      const baseline = new Map((await list()).map(f => [f.remote, f]));
      // Capture bounded baseline content to detect appends without accepting old sections.
      let baselineBytes = 0;
      for (const file of baseline.values()) {
        if (file.size <= config.maxBytes - bytes - baselineBytes) {
          file.content = await command(`cat ${quote(file.remote)}`, config.maxBytes + 1024);
          baselineBytes += Buffer.byteLength(file.content);
          if (baselineBytes > config.maxBytes) throw fail('STACK_CAPACITY_LIMIT', '基线文件读取超过容量上限');
        }
      }
      if (parseProcStat(await command(`cat /proc/${pid}/stat`)).startTime !== identity.startTime) throw fail('STACK_PROCESS_CHANGED', '进程已重启，未发送信号');
      // Recheck cmdline and starttime immediately in the signal shell; never signal a guessed PID.
      const script = `s=$(cat /proc/${pid}/stat) || exit; s=\${s##*) }; set -- $s; [ "\${20}" = ${quote(identity.startTime)} ] && [ "$(tr '\\000' '\\n' < /proc/${pid}/cmdline | head -n 1)" = ${quote(target.packageName)} ] || exit 42; kill -3 ${pid}`;
      const signalEpoch = Number((await command('date +%s')).trim());
      if (!Number.isFinite(signalEpoch) || signalEpoch <= 0) throw fail('STACK_CLOCK_UNAVAILABLE', '无法读取设备时间以验证新 trace');
      const signalKey = `${target.serial}:${target.packageName}`;
      if (now() - (signalTimes.get(signalKey) ?? -Infinity) < config.intervalMs) throw fail('STACK_RATE_LIMIT', '目标进程信号间隔未达到下限');
      if (budgetDeadline - now() < 500) throw fail('STACK_BUDGET_EXCEEDED', '剩余预算不足以验证 trace，未发送信号');
      signalTimes.set(signalKey, now());
      record.signalDeviceEpoch = signalEpoch;
      record.signalAt = new Date(now()).toISOString(); await command(script); record.signalSucceeded = true; publish();
      const deadline = Math.min(budgetDeadline, now() + config.waitMs);
      while (now() < deadline) {
        if (stopped) throw fail('STACK_CANCELLED', '采集已停止');
        const current = parseProcStat(await command(`cat /proc/${pid}/stat`));
        if (current.startTime !== identity.startTime) throw fail('STACK_PROCESS_CHANGED', '信号后目标进程已重启');
        for (const file of await list()) {
          const old = baseline.get(file.remote);
          if (old?.stamp === file.stamp || !file.size) continue;
          if (file.size > config.maxBytes - bytes) throw fail('STACK_CAPACITY_LIMIT', 'trace 超过剩余容量上限');
          const text = await command(`cat ${quote(file.remote)}`, config.maxBytes + 1024);
          const fresh = old ? (old.content !== undefined && text.startsWith(old.content) ? text.slice(old.content.length) : old.content !== undefined && text !== old.content ? text : '') : text;
          // Rewritten files require a new content hash and a current device-time header.
          if (!validateTrace(fresh, identity, signalEpoch)) continue;
          const size = Buffer.byteLength(text); if (size > config.maxBytes - bytes) throw fail('STACK_CAPACITY_LIMIT', 'trace 超过剩余容量上限');
          const localPath = path.join(directory, `${record.id}-${pid}.txt`); fs.writeFileSync(localPath, text); bytes += size;
          record.files.push({ path: localPath, remotePath: file.remote, bytes: size, sha256: crypto.createHash('sha256').update(text).digest('hex') });
          record.status = 'success'; return record;
        }
        await delay(250);
      }
      throw fail('STACK_TRACE_NOT_VERIFIED', '信号已发送，但有限等待内未验证到目标进程的新完整 trace');
    } catch (e) {
      record.status = 'failed'; record.errorCode = /permission denied|not permitted/i.test(`${e.message} ${e.stderr}`) ? 'STACK_PERMISSION_DENIED'
        : e.exitCode === 42 ? 'STACK_PROCESS_CHANGED'
        : /No such (file|process)/i.test(`${e.message} ${e.stderr}`) && record.commands.at(-1)?.command.at(-1)?.includes('/proc/') ? 'STACK_PROCESS_EXITED'
        : e.code || 'STACK_ADB_ERROR';
      record.error = e.message;
    } finally { record.endedAt = new Date(now()).toISOString(); publish(); }
    return record;
  };
  return { config, records, capture(context = {}, reason = 'manual') {
    if (!config.enabled || stopped) return Promise.resolve({ skipped: true, errorCode: 'STACK_DISABLED_OR_STOPPED' });
    if (pending) return Promise.resolve({ skipped: true, errorCode: 'STACK_BUSY' });
    if (count >= config.maxCount || bytes >= config.maxBytes || now() - lastAttempt < config.intervalMs) return Promise.resolve({ skipped: true, errorCode: 'STACK_LIMIT' });
    count++; lastAttempt = now();
    pending = (async () => { const result = []; for (const target of targets) { if (stopped) break; result.push(await captureTarget(target, context, reason)); } return result; })().finally(() => { pending = null; }); return pending;
  }, async drain() { await pending; }, async stop() { stopped = true; await pending; return records; } };
}
module.exports = { normalizeThreadStackOptions, createThreadStackCollector, parseProcStat, validateTrace };
