const { installApkToDevice } = require('../apk-install');
async function deviceOperation(action, args, { runAdb, signal }) {
  const execute = (argv, timeout) => {
    if (signal?.aborted) throw Error('设备操作已取消');
    return runAdb(argv, timeout, signal);
  };
  if (action === 'install') return installApkToDevice(args, { runAdb: execute });
  if (action !== 'uninstall') throw Error('未知设备操作');
  const { serial, packageName } = args;
  if (typeof serial !== 'string' || !serial.trim() || serial.length > 256 || /[\0\r\n]/.test(serial)) throw Error('请指定有效设备 SN');
  if (typeof packageName !== 'string' || !/^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+$/.test(packageName)) throw Error('请指定有效应用包名');
  const output = String(await execute(['-s', serial, 'uninstall', packageName], 120000)).trim();
  if (!/^Success\s*$/i.test(output)) throw Error(`卸载未成功：${output || 'ADB 未返回成功结果'}`);
  return { success: true, serial, packageName, output };
}
module.exports = { deviceOperation };
