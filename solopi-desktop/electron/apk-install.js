const fs = require('fs');
const path = require('path');
const { classifyApkInstallFailure } = require('./adb-error');
const { readApkMetadata, readInstalledMetadata } = require('./apk-metadata');

function createApkInstallError(message, errorCode, recoveryActions = []) {
  const error = new Error(message);
  error.errorCode = errorCode;
  error.recoveryActions = recoveryActions;
  return error;
}

function getAdbUnavailableRecoveryActions() {
  return [
    '确认设备已连接，并在设备上允许 USB 调试。',
    '部分厂商需要在手机上单独打开 ADB，或联系厂商协助开启。请检查相关配置是否已打开。',
    '返回 solopi-desktop 刷新设备后重试。',
  ];
}

function resolveApkInstallRequest(payload = {}) {
  const runtime = String(payload.runtime || 'android').trim().toLowerCase();
  const serial = String(payload.serial || '').trim();
  const inputPath = String(payload.apkPath || '').trim();

  if (runtime !== 'android') {
    throw createApkInstallError(
      'APK 只能安装到 Android 设备，请先把系统切换为 Android。',
      'APK_INSTALL_ANDROID_REQUIRED'
    );
  }
  if (!serial || serial.length > 256 || serial.includes('\0')) {
    throw createApkInstallError('请先选择目标设备。', 'APK_INSTALL_DEVICE_REQUIRED');
  }
  if (!inputPath || !path.isAbsolute(inputPath)) {
    throw createApkInstallError('请选择有效的本地 APK 文件。', 'APK_INSTALL_FILE_INVALID');
  }

  let apkPath;
  try {
    apkPath = fs.realpathSync.native(inputPath);
  } catch (_error) {
    throw createApkInstallError('APK 文件不存在或已被移动。', 'APK_INSTALL_FILE_MISSING');
  }
  if (path.extname(apkPath).toLowerCase() !== '.apk') {
    throw createApkInstallError('仅支持安装 .apk 文件。', 'APK_INSTALL_FILE_TYPE_INVALID');
  }
  if (!fs.statSync(apkPath).isFile()) {
    throw createApkInstallError('请选择 APK 文件，不能选择文件夹。', 'APK_INSTALL_FILE_INVALID');
  }

  return { runtime, serial, apkPath };
}

function normalizeInstallFailure(error, serial) {
  const detail = [error?.stderr, error?.stdout, error?.message]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n');
  if (/^APK_INSTALL_/.test(String(error?.errorCode || ''))) {
    error.technicalDetails = error.technicalDetails || detail;
    error.serial = serial;
    return error;
  }
  const lower = detail.toLowerCase();
  const disconnected = /unauthorized|offline|no devices|device .* not found|connect error|cannot connect|transport .*closing|connection reset|write: closed/.test(lower);
  const classification = classifyApkInstallFailure(detail);
  const normalizedError = createApkInstallError(
    disconnected
      ? '设备 ADB 连接不可用，未能完成 APK 安装。'
      : classification.message,
    disconnected ? 'APK_INSTALL_DEVICE_UNAVAILABLE' : classification.errorCode,
    disconnected
      ? getAdbUnavailableRecoveryActions()
      : classification.recoveryActions
  );
  normalizedError.androidErrorCode = classification.androidErrorCode;
  normalizedError.technicalDetails = detail;
  normalizedError.serial = serial;
  return normalizedError;
}

async function installApkToDevice(payload, options = {}) {
  if (typeof options.runAdb !== 'function') {
    throw new Error('installApkToDevice requires runAdb');
  }
  const request = resolveApkInstallRequest(payload);

  let metadata = { packageName: '', currentVersion: null, targetVersion: null, metadataErrors: [] };
  try {
    const state = String(await options.runAdb(['-s', request.serial, 'get-state'], 10000)).trim();
    if (state !== 'device') {
      throw createApkInstallError(
        '设备 ADB 当前不可用，无法安装 APK。',
        'APK_INSTALL_DEVICE_UNAVAILABLE',
        getAdbUnavailableRecoveryActions()
      );
    }
    const readTarget = options.readApkMetadata || readApkMetadata;
    try {
      const target = await readTarget(request.apkPath);
      metadata.packageName = target.packageName;
      metadata.targetVersion = target;
      metadata.currentVersion = await readInstalledMetadata(options.runAdb, request.serial, target.packageName);
    } catch (error) {
      metadata.metadataErrors.push(error.message || String(error));
    }
    const output = String(await options.runAdb(
      ['-s', request.serial, 'install', '-r', request.apkPath],
      10 * 60 * 1000
    ));
    if (/\bFailure\s*\[|\bINSTALL_(?:FAILED|PARSE_FAILED)_/.test(output) || !/(?:^|\s)Success(?:\s|$)/i.test(output)) {
      const detail = output.trim() || 'ADB 未返回安装成功结果。';
      throw new Error(detail);
    }
    return {
      success: true,
      ...metadata,
      serial: request.serial,
      apkPath: request.apkPath,
      fileName: path.basename(request.apkPath),
      output: output.trim(),
    };
  } catch (error) {
    const failure = normalizeInstallFailure(error, request.serial);
    Object.assign(failure, metadata);
    throw failure;
  }
}

module.exports = {
  installApkToDevice,
  resolveApkInstallRequest,
};
