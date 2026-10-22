const AUDIO_REMOTE_FILE_DEFAULT_TIMEOUT_MS = 15000;
const AUDIO_REMOTE_FILE_PROBE_TIMEOUT_MS = 5000;
const AUDIO_REMOTE_FILE_STATE_TIMEOUT_MS = 3000;

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function combinedErrorText(error = {}) {
  return [error.message, error.stderr, error.stdout].filter(Boolean).join('\n');
}

function classifyAudioRemoteFileProbeFailure(error = {}) {
  const output = combinedErrorText(error);
  if (/unauthorized/i.test(output)) return 'unauthorized';
  if (/device offline|\boffline\b/i.test(output)) return 'offline';
  if (/no devices?\/emulators? found|device ['"]?[^'"\n]+['"]? not found|cannot connect to|transport (?:error|is closing)|connection reset/i.test(output)) {
    return 'transport';
  }
  if (error.timeoutMs || error.timedOut || error.signal === 'SIGTERM') return 'timeout';
  if (error.exitCode === 1 || error.code === 1) return 'missing';
  return 'unknown';
}

function getAudioRemoteFileFailureDescriptor(kind, remotePath) {
  if (kind === 'unauthorized') {
    return {
      code: 'DEVICE_ADB_UNAUTHORIZED',
      message: '手机 ADB 未授权，无法确认音频文件是否已推送完成。',
      recoveryActions: ['解锁手机并在 USB 调试授权弹窗中选择“允许”。', '返回 solopi-desktop 刷新设备后重试。'],
    };
  }
  if (kind === 'offline') {
    return {
      code: 'DEVICE_ADB_OFFLINE',
      message: '手机 ADB 处于 offline 状态，无法确认音频文件是否已推送完成。',
      recoveryActions: ['检查 USB 数据线和手机连接状态。', '确认 adb devices 中设备恢复为 device 后重试。'],
    };
  }
  if (kind === 'transport') {
    return {
      code: 'DEVICE_ADB_TRANSPORT_UNAVAILABLE',
      message: '手机 ADB 连接不可用，无法确认音频文件是否已推送完成。',
      recoveryActions: ['确认所选手机仍连接到电脑且序列号未变化。', '刷新设备后重试当前音频节点。'],
    };
  }
  if (kind === 'timeout') {
    return {
      code: 'AUDIO_REMOTE_FILE_CHECK_TIMEOUT',
      message: `音频已完成 push，但 ADB 文件校验持续超时：${remotePath}`,
      recoveryActions: [
        '等待设备 ADB 通道恢复后重试当前音频节点。',
        '若频繁出现，关闭重复的投屏、录屏或日志进程，再刷新设备。',
        '查看 diagnostics.details 中的校验次数、ADB 状态与最后一次命令错误。',
      ],
    };
  }
  if (kind === 'missing') {
    return {
      code: 'AUDIO_REMOTE_FILE_NOT_FOUND',
      message: `音频 push 完成后仍未在手机目标路径发现文件：${remotePath}`,
      recoveryActions: ['确认目标应用包名和 remotePath 正确。', '确认手机允许访问目标应用的外部 files 目录后重试。'],
    };
  }
  return {
    code: 'AUDIO_REMOTE_FILE_CHECK_FAILED',
    message: `无法确认手机侧音频文件状态：${remotePath}`,
    recoveryActions: ['检查手机 ADB 状态及结构化命令输出后重试。'],
  };
}

function createAudioRemoteFileError(kind, options = {}) {
  const descriptor = getAudioRemoteFileFailureDescriptor(kind, options.remotePath || '');
  const lastError = options.lastError || {};
  const error = new Error(descriptor.message);
  error.code = descriptor.code;
  error.errorCode = descriptor.code;
  error.errorType = 'audio-remote-file-check';
  error.exitCode = lastError.exitCode ?? null;
  error.signal = lastError.signal ?? null;
  error.timeoutMs = lastError.timeoutMs ?? null;
  error.stdout = String(lastError.stdout || '');
  error.stderr = String(lastError.stderr || '');
  error.recoveryActions = descriptor.recoveryActions;
  error.diagnostics = {
    schemaVersion: 'glassbox.error.v1',
    code: descriptor.code,
    type: error.errorType,
    message: descriptor.message,
    recoveryActions: descriptor.recoveryActions,
    details: {
      serial: options.serial || '',
      remotePath: options.remotePath || '',
      filePushed: true,
      triggerSucceeded: false,
      attempts: options.attempts || [],
      adbState: options.adbState || '',
      exitCode: error.exitCode,
      signal: error.signal,
      timeoutMs: error.timeoutMs,
      command: String(lastError.command || ''),
      causeMessage: String(lastError.message || ''),
      stdout: error.stdout,
      stderr: error.stderr,
    },
  };
  return error;
}

async function waitForRemoteAudioFile(options = {}) {
  if (typeof options.execute !== 'function') {
    throw new TypeError('waitForRemoteAudioFile requires an execute(args, timeoutMs) function');
  }
  const serial = String(options.serial || '').trim();
  const remotePath = String(options.remotePath || '').trim();
  const timeoutMs = normalizePositiveInteger(options.timeoutMs, AUDIO_REMOTE_FILE_DEFAULT_TIMEOUT_MS);
  const probeTimeoutMs = normalizePositiveInteger(options.probeTimeoutMs, AUDIO_REMOTE_FILE_PROBE_TIMEOUT_MS);
  const stateTimeoutMs = normalizePositiveInteger(options.stateTimeoutMs, AUDIO_REMOTE_FILE_STATE_TIMEOUT_MS);
  const retryDelayMs = normalizePositiveInteger(options.retryDelayMs, 250);
  const maxProbeAttempts = normalizePositiveInteger(options.maxProbeAttempts, 6);
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const delay = typeof options.delay === 'function'
    ? options.delay
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const deadline = now() + timeoutMs;
  const attempts = [];
  let lastError = null;
  let lastKind = 'missing';
  let adbState = '';
  let probeCount = 0;

  while (now() < deadline && probeCount < maxProbeAttempts) {
    probeCount += 1;
    const remaining = Math.max(1, deadline - now());
    try {
      await options.execute(
        ['-s', serial, 'shell', 'test', '-f', remotePath],
        Math.min(probeTimeoutMs, remaining)
      );
      return { ready: true, attemptCount: probeCount, adbState: adbState || 'device' };
    } catch (error) {
      lastError = error;
      lastKind = classifyAudioRemoteFileProbeFailure(error);
      attempts.push({
        phase: 'file-probe',
        kind: lastKind,
        exitCode: error.exitCode ?? null,
        signal: error.signal ?? null,
        timeoutMs: error.timeoutMs ?? null,
      });

      if (['unauthorized', 'offline', 'transport'].includes(lastKind)) {
        throw createAudioRemoteFileError(lastKind, { serial, remotePath, attempts, lastError, adbState });
      }

      if (lastKind === 'timeout') {
        try {
          const stateResult = await options.execute(
            ['-s', serial, 'get-state'],
            Math.min(stateTimeoutMs, Math.max(1, deadline - now()))
          );
          adbState = String(stateResult?.stdout || '').trim();
          attempts.push({ phase: 'adb-state', kind: adbState === 'device' ? 'ready' : 'transport', state: adbState });
          if (adbState !== 'device') {
            throw createAudioRemoteFileError('transport', { serial, remotePath, attempts, lastError, adbState });
          }
        } catch (stateError) {
          if (stateError?.errorType === 'audio-remote-file-check') throw stateError;
          const stateKind = classifyAudioRemoteFileProbeFailure(stateError);
          attempts.push({
            phase: 'adb-state',
            kind: stateKind,
            exitCode: stateError.exitCode ?? null,
            signal: stateError.signal ?? null,
            timeoutMs: stateError.timeoutMs ?? null,
          });
          if (['unauthorized', 'offline', 'transport'].includes(stateKind)) {
            throw createAudioRemoteFileError(stateKind, {
              serial,
              remotePath,
              attempts,
              lastError: stateError,
              adbState,
            });
          }
        }
      }

      if (now() < deadline) {
        await delay(Math.min(retryDelayMs, Math.max(1, deadline - now())));
      }
    }
  }

  throw createAudioRemoteFileError(lastKind, { serial, remotePath, attempts, lastError, adbState });
}

module.exports = {
  AUDIO_REMOTE_FILE_DEFAULT_TIMEOUT_MS,
  AUDIO_REMOTE_FILE_PROBE_TIMEOUT_MS,
  classifyAudioRemoteFileProbeFailure,
  createAudioRemoteFileError,
  waitForRemoteAudioFile,
};
