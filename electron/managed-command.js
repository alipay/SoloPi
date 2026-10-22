const { spawn } = require('node:child_process');
const activeCommands = new Set();
function cancelAllManagedCommands() {
  for (const cancel of [...activeCommands]) cancel();
}

// Each command owns a separate process group: never signal the app or other tasks.
function runManagedCommand(command, args, options = {}, registerCancel = () => () => {}) {
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();
    const startedClock = process.hrtime.bigint();
    let settled = false, timer, child;
    let unregister = () => {};
    let stdout = '', stderr = '';
    let spawnedAt = null, exitedAt = null, exitCode = null, exitSignal = null;
    let firstOutputAt = null, lastOutputAt = null;
    const execution = (terminationReason, terminationSignal = null) => ({
      command, args: [...args], pid: child?.pid ?? null, startedAt, spawnedAt,
      endedAt: new Date().toISOString(), durationMs: Number(process.hrtime.bigint() - startedClock) / 1e6,
      configuredTimeoutMs: options.timeout || null, terminationReason,
      timedOut: terminationReason === 'timeout', timeoutAt: terminationReason === 'timeout' ? new Date().toISOString() : null,
      terminationSignal, exitObserved: exitedAt !== null, exitedAt, exitCode, exitSignal,
      firstOutputAt, lastOutputAt, stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr),
    });
    try {
      child = spawn(command, args, { cwd: options.cwd, env: options.env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(Object.assign(error, { stdout, stderr, meta: { commandExecution: execution('spawn-error') } }));
      return;
    }
    const finish = (error, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeCommands.delete(cancel);
      unregister();
      const meta = { commandExecution: execution(reason) };
      if (error) reject(Object.assign(error, { stdout, stderr, exitCode, meta }));
      else resolve({ stdout, stderr, success: true, exitCode, signal: exitSignal, meta });
    };
    child.once('spawn', () => { spawnedAt = new Date().toISOString(); });
    child.once('exit', (code, signal) => { exitedAt = new Date().toISOString(); exitCode = code; exitSignal = signal; });
    child.once('error', error => finish(error, 'spawn-error'));
    child.once('close', (code, signal) => {
      if (exitedAt === null && typeof code === 'number' && code >= 0) {
        exitedAt = new Date().toISOString(); exitCode = code; exitSignal = signal;
      }
      finish(code === 0 ? null : Object.assign(new Error(`Command failed: ${command}`), { code, signal }), code === 0 ? 'completed' : 'exit-error');
    });
    const cancel = (stopped = true, overflow = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeCommands.delete(cancel);
      unregister();
      // Settle within the budget without waiting for inherited pipes. The snapshot explicitly
      // distinguishes a requested kill from an observed child exit; don't invent an exit code.
      let terminationError = '';
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') {
          try { child.kill('SIGKILL'); } catch (fallbackError) { terminationError = fallbackError.message; }
        }
      }
      child.stdout.destroy();
      child.stderr.destroy();
      const reason = stopped ? 'stopped' : overflow ? 'output-limit' : 'timeout';
      const error = new Error(stopped ? '工作流已停止' : overflow ? '命令输出超过缓冲区限制' : `命令执行超时（${options.timeout}ms）`);
      Object.assign(error, { code: stopped ? 'WORKFLOW_STOPPED' : overflow ? 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' : 'ETIMEDOUT',
        killed: true, signal: 'SIGKILL', stdout, stderr, exitCode,
        meta: { commandExecution: { ...execution(reason, 'SIGKILL'), terminationError } } });
      reject(error);
    };
    const receive = (channel, chunk) => {
      const now = new Date().toISOString();
      firstOutputAt ||= now; lastOutputAt = now;
      if (channel === 'stdout') stdout += chunk; else stderr += chunk;
      if (Buffer.byteLength(channel === 'stdout' ? stdout : stderr) > (options.maxBuffer || 10485760)) cancel(false, true);
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => receive('stdout', chunk));
    child.stderr.on('data', chunk => receive('stderr', chunk));
    activeCommands.add(cancel);
    unregister = registerCancel(cancel);
    if (settled) unregister();
    if (!settled && options.timeout > 0) timer = setTimeout(() => cancel(false), options.timeout);
  });
}

module.exports = { runManagedCommand, cancelAllManagedCommands };
