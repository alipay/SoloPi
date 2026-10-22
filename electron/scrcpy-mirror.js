const SCRCPY_MIRROR_ERROR_CODE = 'SCRCPY_MIRROR_START_FAILED';
const SCRCPY_OUTPUT_LIMIT = 8000;

function normalizeScrcpyMirrorOutput(value) {
  const output = String(value || '').trim();
  if (output.length <= SCRCPY_OUTPUT_LIMIT) return output;
  return output.slice(-SCRCPY_OUTPUT_LIMIT);
}

function getScrcpyMirrorRecoveryActions(session = {}) {
  const serial = String(session.serial || '<serial>');
  const label = session.deviceType === 'phone' ? '手机' : '眼镜';
  return [
    `确认${label}设备 ${serial} 在线，并已授权 USB 调试。`,
    '关闭其他占用同一设备的投屏窗口后重试。',
    '打开执行产物中的 scrcpy 投屏日志，根据退出码和 stderr 排查设备、编码器或运行时问题。',
  ];
}

function evaluateScrcpyMirror(session = {}) {
  const output = normalizeScrcpyMirrorOutput(session.error);
  const exitCode = Number.isInteger(session.exitCode) ? session.exitCode : null;
  const signal = session.exitSignal || null;
  const ready = session.startedSuccessfully === true || Boolean(session.readyAtMs);
  const failureReasons = [];

  if (!session.serial) failureReasons.push('DEVICE_SERIAL_MISSING');
  if (!session.scrcpyPath) failureReasons.push('SCRCPY_RUNTIME_MISSING');
  if (session.startFailed) failureReasons.push('START_FAILED');
  if (session.runtimeFailed) failureReasons.push('STREAM_INTERRUPTED');
  if (!ready) failureReasons.push('NOT_READY');
  if (!ready && session.exited) failureReasons.push('PROCESS_EXITED_BEFORE_READY');
  if (!ready && exitCode !== null && exitCode !== 0) failureReasons.push('PROCESS_EXIT_NONZERO');
  if (!ready && signal) failureReasons.push('PROCESS_SIGNAL');

  const base = {
    deviceType: session.deviceType || '',
    serial: session.serial || '',
    path: session.logPath || '',
    command: session.command || '',
    ready,
    startedAt: session.startedAt || '',
    readyAt: session.readyAtMs ? new Date(session.readyAtMs).toISOString() : '',
    exitCode,
    signal,
    scrcpyOutput: output,
  };

  if (failureReasons.length === 0) {
    return {
      ...base,
      success: true,
      status: session.stoppedIntentionally ? 'stopped' : 'ready',
      error: '',
      errorCode: '',
      recoveryActions: [],
      diagnostics: null,
    };
  }

  const label = session.deviceType === 'phone' ? '手机' : '眼镜';
  const errorCode = session.runtimeFailed ? 'SCRCPY_MIRROR_INTERRUPTED' : SCRCPY_MIRROR_ERROR_CODE;
  const message = [
    `${label}投屏${session.runtimeFailed ? '运行中断' : '启动失败'}`,
    output,
    failureReasons.includes('SCRCPY_RUNTIME_MISSING') ? '安装包缺少内置 scrcpy' : '',
    failureReasons.includes('DEVICE_SERIAL_MISSING') ? `未选择${label}设备` : '',
    failureReasons.includes('PROCESS_EXITED_BEFORE_READY') ? 'scrcpy 在投屏就绪前退出' : '',
    exitCode !== null && exitCode !== 0 ? `退出码 ${exitCode}` : '',
    signal ? `信号 ${signal}` : '',
  ].filter(Boolean).join('；');
  const recoveryActions = getScrcpyMirrorRecoveryActions(session);
  const diagnostics = {
    schemaVersion: 'glassbox.error.v1',
    errorCode,
    code: errorCode,
    errorType: 'screen-mirror',
    type: 'screen-mirror',
    message,
    recoveryActions,
    details: {
      deviceType: base.deviceType,
      serial: base.serial,
      logPath: base.path,
      command: base.command,
      ready,
      processExited: session.exited === true,
      exitCode,
      signal,
      failureReasons,
      scrcpyOutput: output,
    },
  };

  return {
    ...base,
    success: false,
    status: session.runtimeFailed ? 'interrupted' : 'failed',
    error: message,
    errorCode,
    recoveryActions,
    diagnostics,
  };
}

module.exports = {
  SCRCPY_MIRROR_ERROR_CODE,
  evaluateScrcpyMirror,
  getScrcpyMirrorRecoveryActions,
};
