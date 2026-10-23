const ERROR_SCHEMA_VERSION = 'glassbox.error.v1';

function normalizeText(value) {
  return String(value ?? '');
}

function getCombinedOutput(input = {}) {
  return [
    normalizeText(input.message),
    normalizeText(input.stderr),
    normalizeText(input.stdout),
  ].filter(Boolean).join('\n');
}

// Shared by the desktop installer and CLI ADB diagnostics. Versions never override PM errors.
function classifyApkInstallFailure(detail) {
  const androidErrorCode = String(detail).match(/\b(INSTALL_(?:FAILED|PARSE_FAILED)_[A-Z_]+)\b/)?.[1] || '';
  let errorCode = 'APK_INSTALL_FAILED';
  let message = 'APK 安装失败，原因尚未确定，请查看原始错误。';
  let recoveryActions = ['复制原始错误，联系安装包提供方确认原因。'];
  if (androidErrorCode === 'INSTALL_FAILED_UPDATE_INCOMPATIBLE' || /signatures? do not match|signatures? mismatch/i.test(detail)) {
    errorCode = 'APK_INSTALL_SIGNATURE_MISMATCH';
    message = 'APK 签名与设备上的已安装应用不一致。';
    recoveryActions = ['获取与设备现有应用或 ROM 签名兼容的 APK，或联系厂商提供 ROM 升级方案。', '提高版本号、覆盖安装或允许降级均不能解决签名冲突。不要默认卸载系统组件。'];
  } else if (androidErrorCode === 'INSTALL_FAILED_VERSION_DOWNGRADE') {
    errorCode = 'APK_INSTALL_VERSION_DOWNGRADE';
    message = 'APK 版本低于设备上的已安装版本，无法覆盖安装。';
    recoveryActions = ['选择 versionCode 不低于当前安装版本、且签名兼容的 APK。'];
  } else if (androidErrorCode === 'INSTALL_FAILED_USER_RESTRICTED') {
    errorCode = 'APK_INSTALL_USER_RESTRICTED';
    message = '设备用户权限或安装策略限制了 APK 安装。';
    recoveryActions = ['检查设备是否允许 USB 安装，以及是否存在用户或设备管理策略限制。', '如为厂商或组织管理的设备，请联系管理员或 ROM 维护方确认安装权限。'];
  } else if (androidErrorCode === 'INSTALL_FAILED_INSUFFICIENT_STORAGE') {
    errorCode = 'APK_INSTALL_INSUFFICIENT_STORAGE';
    message = '设备存储空间不足，无法安装 APK。';
    recoveryActions = ['检查设备可用存储空间，释放空间后重试。'];
  } else if (androidErrorCode === 'INSTALL_FAILED_NO_MATCHING_ABIS') {
    errorCode = 'APK_INSTALL_ABI_MISMATCH';
    message = 'APK 与当前设备的处理器架构不兼容。';
    recoveryActions = ['获取适配当前设备 ABI 的安装包。'];
  }
  return { errorCode, androidErrorCode, errorType: 'apk-install', message, recoveryActions };
}

function classifyAdbFailure(input = {}, context = {}) {
  const combined = getCombinedOutput(input);
  const packageName = normalizeText(context.packageName || input.packageName).trim();
  if (/\bINSTALL_(?:FAILED|PARSE_FAILED)_|signatures? do not match/i.test(combined)) return classifyApkInstallFailure(combined);

  if (/\bdevice\b[^\n]*\bunauthorized\b|\bunauthorized\b/i.test(combined)) {
    return {
      errorCode: 'DEVICE_ADB_UNAUTHORIZED',
      errorType: 'device-preflight',
      message: '手机 ADB 未授权。请解锁手机，在 USB 调试授权弹窗中选择“允许”，然后刷新设备并重试。',
      recoveryActions: [
        '解锁手机并保持屏幕亮起。',
        '在手机的 USB 调试授权弹窗中选择“允许”。',
        '返回 solopi-desktop 刷新设备后重试当前操作。',
      ],
    };
  }

  if (/\bdevice\b[^\n]*\boffline\b|\boffline\b/i.test(combined)) {
    return {
      errorCode: 'DEVICE_ADB_OFFLINE',
      errorType: 'device-preflight',
      message: '手机 ADB 当前处于 offline 状态。请检查 USB 连接，待设备恢复为 device 状态后刷新设备并重试。',
      recoveryActions: [
        '检查手机 USB 数据线和连接状态。',
        '确认 adb devices 中设备状态已恢复为 device。',
        '返回 solopi-desktop 刷新设备后重试当前操作。',
      ],
    };
  }

  if (
    /no devices?\/emulators? found|device ['"]?[^'"\n]+['"]? not found|cannot connect to|transport (?:error|is closing)|closed|connection reset/i.test(combined)
  ) {
    return {
      errorCode: 'DEVICE_ADB_TRANSPORT_UNAVAILABLE',
      errorType: 'device-preflight',
      message: '未找到可用的手机 ADB 传输连接。请检查设备连接和序列号，刷新设备后重试。',
      recoveryActions: [
        '检查手机是否已通过可传输数据的 USB 连接到电脑。',
        '确认所选设备序列号仍出现在 adb devices 列表中。',
        '返回 solopi-desktop 刷新设备后重试当前操作。',
      ],
    };
  }

  if (
    context.packageMissing === true
    || /unknown package|package [^\s]+ (?:was )?not found|package not installed|could not access the package manager/i.test(combined)
  ) {
    return {
      errorCode: 'DEVICE_PACKAGE_NOT_INSTALLED',
      errorType: 'device-preflight',
      message: packageName
        ? `手机中未安装目标应用 ${packageName}。请确认包名或安装对应应用后重试。`
        : '手机中未安装目标应用。请确认包名或安装对应应用后重试。',
      recoveryActions: [
        '确认当前选择的手机和应用包名正确。',
        packageName ? `确认手机中已安装 ${packageName}。` : '确认手机中已安装目标应用。',
        '刷新应用信息后重试当前操作。',
      ],
    };
  }

  return {
    errorCode: 'ADB_COMMAND_FAILED',
    errorType: 'device-preflight',
    message: '手机 ADB 命令执行失败。请根据结构化诊断检查设备连接和命令输出。',
    recoveryActions: [
      '检查手机连接状态和所选设备序列号。',
      '查看 exitCode、signal、stdout、stderr 和 command 定位失败原因。',
      '修复设备或命令问题后重试当前操作。',
    ],
  };
}

function createAdbDiagnosticError(input = {}, context = {}) {
  const classification = classifyAdbFailure(input, context);
  const serial = normalizeText(context.serial || input.serial).trim();
  const packageName = normalizeText(context.packageName || input.packageName).trim();
  const command = normalizeText(context.command || input.command).trim();
  const stdout = normalizeText(input.stdout);
  const stderr = normalizeText(input.stderr);
  const exitCode = typeof input.exitCode === 'number'
    ? input.exitCode
    : (typeof input.code === 'number' ? input.code : null);
  const signal = input.signal || null;
  const timeoutMs = input.timeoutMs ?? null;
  const diagnostics = {
    schemaVersion: ERROR_SCHEMA_VERSION,
    androidErrorCode: classification.androidErrorCode || undefined,
    code: classification.errorCode,
    type: classification.errorType,
    message: classification.message,
    recoveryActions: classification.recoveryActions,
    details: {
      deviceRole: context.deviceRole || 'phone',
      serial,
      packageName,
      command,
      exitCode,
      signal,
      timeoutMs,
      stdout,
      stderr,
    },
  };
  const error = new Error(classification.message);
  Object.assign(error, {
    androidErrorCode: classification.androidErrorCode || undefined,
    code: classification.errorCode,
    errorCode: classification.errorCode,
    errorType: classification.errorType,
    deviceRole: context.deviceRole || 'phone',
    serial,
    packageName,
    command,
    exitCode,
    signal,
    timeoutMs,
    stdout,
    stderr,
    recoveryActions: classification.recoveryActions,
    diagnostics,
  });
  return error;
}

function isMissingRemoteFileError(input = {}, expectedPath = '') {
  const combined = getCombinedOutput(input);
  if (!/No such file or directory/i.test(combined)) {
    return false;
  }
  const normalizedPath = normalizeText(expectedPath).trim();
  return !normalizedPath || combined.includes(normalizedPath);
}

module.exports = {
  classifyApkInstallFailure,
  classifyAdbFailure,
  createAdbDiagnosticError,
  isMissingRemoteFileError,
};
