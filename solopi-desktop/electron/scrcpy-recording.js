const SCRCPY_RECORDING_ERROR_CODE = 'SCRCPY_RECORDING_FAILED';
const SCRCPY_OUTPUT_LIMIT = 8000;

function getScrcpyRecordingRecoveryActions(session = {}) {
  const serial = String(session.serial || '<serial>');
  return [
    `确认设备 ${serial} 在线、已授权 USB 调试且 scrcpy 可以稳定连接。`,
    '确认录屏输出目录可写且磁盘空间充足，然后用报告中的 command 单独复现 scrcpy 录制。',
    '检查 diagnostics.details.scrcpyOutput；若包含音频通道、编码器或媒体封装错误，请修复对应 scrcpy/设备媒体能力后重试。',
  ];
}

function normalizeScrcpyOutput(value) {
  const output = String(value || '').trim();
  if (output.length <= SCRCPY_OUTPUT_LIMIT) return output;
  return output.slice(-SCRCPY_OUTPUT_LIMIT);
}

function evaluateScrcpyRecording(session = {}, fileInfo = {}) {
  const output = normalizeScrcpyOutput(session.error);
  const fileExists = fileInfo.exists === true;
  const isFile = fileInfo.isFile !== false;
  const sizeBytes = Number.isFinite(Number(fileInfo.sizeBytes))
    ? Number(fileInfo.sizeBytes)
    : 0;
  const exitCode = Number.isInteger(session.exitCode) ? session.exitCode : null;
  const signal = session.exitSignal || null;
  const failureReasons = [];

  if (session.startFailed) failureReasons.push('START_FAILED');
  if (!fileExists) failureReasons.push('FILE_MISSING');
  if (fileExists && !isFile) failureReasons.push('OUTPUT_NOT_FILE');
  if (fileExists && isFile && sizeBytes <= 0) failureReasons.push('FILE_EMPTY');
  if (/\brecording failed\b/i.test(output)) failureReasons.push('SCRCPY_REPORTED_FAILURE');
  if (exitCode !== null && exitCode !== 0) failureReasons.push('PROCESS_EXIT_NONZERO');
  if (signal && !['SIGINT', 'SIGTERM'].includes(String(signal).toUpperCase())) {
    failureReasons.push('PROCESS_SIGNAL_UNEXPECTED');
  }
  if (!session.startFailed && session.exited !== true) failureReasons.push('PROCESS_DID_NOT_EXIT');
  if (fileInfo.statError) failureReasons.push('FILE_STAT_FAILED');

  const base = {
    deviceType: session.deviceType,
    serial: session.serial,
    path: session.path,
    command: session.command,
    taskId: session.taskId || '',
    lifecycleScope: session.lifecycleScope || '',
    readyAtMs: Number.isFinite(Number(session.readyAtMs)) ? Number(session.readyAtMs) : null,
    recordingStartedAtMs: Number.isFinite(Number(session.recordingStartedAtMs))
      ? Number(session.recordingStartedAtMs)
      : null,
    recordingStoppedAtMs: Number.isFinite(Number(session.recordingStoppedAtMs))
      ? Number(session.recordingStoppedAtMs)
      : null,
    sizeBytes,
    exitCode,
    signal,
    scrcpyOutput: output,
    transportDiagnostics: session.transportDiagnostics || [],
  };

  if (failureReasons.length === 0) {
    return {
      ...base,
      success: true,
      error: '',
      errorCode: '',
      recoveryActions: [],
      diagnostics: null,
    };
  }

  const message = [
    'scrcpy 录屏失败',
    failureReasons.includes('FILE_MISSING')
      ? '未生成录屏文件'
      : failureReasons.includes('FILE_EMPTY') ? '录屏文件为 0 bytes' : '',
    failureReasons.includes('SCRCPY_REPORTED_FAILURE') ? 'scrcpy 输出 Recording failed' : '',
    exitCode !== null && exitCode !== 0 ? `退出码 ${exitCode}` : '',
    signal && !['SIGINT', 'SIGTERM'].includes(String(signal).toUpperCase()) ? `信号 ${signal}` : '',
  ].filter(Boolean).join('；');
  const recoveryActions = getScrcpyRecordingRecoveryActions(session);
  const diagnostics = {
    schemaVersion: 'glassbox.error.v1',
    errorCode: SCRCPY_RECORDING_ERROR_CODE,
    code: SCRCPY_RECORDING_ERROR_CODE,
    errorType: 'screen-recording',
    type: 'screen-recording',
    message,
    recoveryActions,
    details: {
      deviceType: session.deviceType || '',
      serial: session.serial || '',
      path: session.path || '',
      command: session.command || '',
      fileExists,
      isFile,
      sizeBytes,
      statError: String(fileInfo.statError || ''),
      processExited: session.exited === true,
      readyAtMs: Number.isFinite(Number(session.readyAtMs)) ? Number(session.readyAtMs) : null,
      recordingStartedAtMs: Number.isFinite(Number(session.recordingStartedAtMs))
        ? Number(session.recordingStartedAtMs)
        : null,
      recordingStoppedAtMs: Number.isFinite(Number(session.recordingStoppedAtMs))
        ? Number(session.recordingStoppedAtMs)
        : null,
      exitCode,
      signal,
      failureReasons,
      scrcpyOutput: output,
      transportDiagnostics: session.transportDiagnostics || [],
    },
  };

  return {
    ...base,
    success: false,
    error: message,
    errorCode: SCRCPY_RECORDING_ERROR_CODE,
    recoveryActions,
    diagnostics,
  };
}

module.exports = {
  SCRCPY_RECORDING_ERROR_CODE,
  evaluateScrcpyRecording,
  getScrcpyRecordingRecoveryActions,
};
