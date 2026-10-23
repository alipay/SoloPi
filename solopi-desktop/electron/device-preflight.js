function normalizeText(value) {
  return String(value || '').trim();
}

function classifyRequiredDeviceFailure(error = {}, fallbackCode = 'DEVICE_TRANSPORT_UNAVAILABLE') {
  const message = [error.message, error.stderr, error.stdout].filter(Boolean).join('\n').toLowerCase();

  if (/unauthorized/.test(message)) return 'DEVICE_UNAUTHORIZED';
  if (/device offline|\boffline\b/.test(message)) return 'DEVICE_OFFLINE';
  if (/device not found|no devices|not found/.test(message)) return 'DEVICE_NOT_FOUND';
  if (error.timeoutMs || error.timedOut) return 'DEVICE_SHELL_UNAVAILABLE';
  return fallbackCode;
}

function createRequiredDeviceCheckPlan(target = {}) {
  const serial = normalizeText(target.serial);
  const packageName = normalizeText(target.packageName);
  const checks = [
    {
      kind: 'adb-state',
      args: ['-s', serial, 'get-state'],
      errorCode: 'DEVICE_TRANSPORT_UNAVAILABLE',
      validate(result = {}) {
        return normalizeText(result.stdout) === 'device';
      },
      invalidMessage(result = {}) {
        return `ADB get-state 未返回 device：${normalizeText(result.stdout) || '(empty)'}`;
      },
    },
    {
      kind: 'basic-shell',
      args: ['-s', serial, 'shell', 'true'],
      errorCode: 'DEVICE_SHELL_UNAVAILABLE',
      validate() {
        return true;
      },
      invalidMessage() {
        return 'ADB 基础 shell 命令不可用';
      },
    },
  ];

  if (packageName) {
    checks.push({
      kind: 'package-installed',
      args: ['-s', serial, 'shell', 'pm', 'path', packageName],
      errorCode: 'DEVICE_PACKAGE_NOT_FOUND',
      validate(result = {}) {
        return normalizeText(result.stdout).split(/\r?\n/).some((line) => line.startsWith('package:'));
      },
      invalidMessage() {
        return `目标包未安装或无法读取：${packageName}`;
      },
    });
  }

  return checks;
}

async function runRequiredDevicePreflight(target = {}, execute) {
  const serial = normalizeText(target.serial);
  const packageName = normalizeText(target.packageName);
  const checks = [];

  for (const check of createRequiredDeviceCheckPlan({ serial, packageName })) {
    try {
      const result = await execute(check.args, 5000);
      const passed = check.validate(result);
      const record = {
        kind: check.kind,
        serial,
        packageName,
        args: check.args,
        success: passed,
        stdout: String(result?.stdout || ''),
        stderr: String(result?.stderr || ''),
      };
      if (!passed) {
        record.error = check.invalidMessage(result);
        record.errorCode = check.errorCode;
        checks.push(record);
        return { success: false, serial, packageName, checks, failure: record };
      }
      checks.push(record);
    } catch (error) {
      const record = {
        kind: check.kind,
        serial,
        packageName,
        args: check.args,
        success: false,
        error: error?.message || String(error),
        errorCode: classifyRequiredDeviceFailure(error, check.errorCode),
        errorType: error?.errorType || 'device-preflight',
        exitCode: error?.exitCode ?? null,
        signal: error?.signal ?? null,
        timeoutMs: error?.timeoutMs ?? null,
        stdout: String(error?.stdout || ''),
        stderr: String(error?.stderr || ''),
        recoveryActions: Array.isArray(error?.recoveryActions) ? error.recoveryActions : [],
        diagnostics: error?.diagnostics,
      };
      checks.push(record);
      return { success: false, serial, packageName, checks, failure: record };
    }
  }

  return { success: true, serial, packageName, checks };
}

function createScreenAwakeWarning(result = {}) {
  if (result.success) return null;
  return {
    code: 'DEVICE_SCREEN_AWAKE_WARNING',
    serial: result.serial || '',
    command: result.command || '',
    exitCode: result.exitCode ?? null,
    signal: result.signal ?? null,
    timedOut: Boolean(result.timeoutMs),
    timeoutMs: result.timeoutMs ?? null,
    stderr: result.stderr || result.error || '',
    recoveryActions: [
      '屏幕常亮设置失败不影响业务执行；必要时可在设备端手动保持亮屏。',
      '若频繁出现 exitCode=137，检查设备系统对 svc power 命令的限制。',
    ],
  };
}

module.exports = {
  classifyRequiredDeviceFailure,
  createRequiredDeviceCheckPlan,
  createScreenAwakeWarning,
  runRequiredDevicePreflight,
};
