// SoloPi companion permissions, checked against the companion's live health receipt.
const PACKAGE = 'com.alipay.hulu';
const SERVICE = `${PACKAGE}/com.alipay.hulu.shared.event.accessibility.AccessibilityServiceImpl`;
const DETAILS = {
  adb: ['内部 ADB 连接', '解锁手机并确认 USB/RSA 调试授权后重试'],
  float: ['悬浮窗', '在系统设置中允许 SoloPi 显示悬浮窗'],
  background: ['后台运行', '在系统设置中允许 SoloPi 后台运行'],
  accessibility: ['无障碍服务', '在系统无障碍设置中启用 SoloPi 服务'],
  powerSave: ['电池优化白名单', '在系统电池设置中允许 SoloPi 不受限制运行'],
};
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
function permissionError(missing, root, attempts = [], cause) {
  const permissionCheck = { root, missing: missing.map(key => ({ key, label: DETAILS[key]?.[0] || key, action: DETAILS[key]?.[1] || '完成手机初始化后重试' })), attempts };
  return Object.assign(Error(`SoloPi 权限未就绪：${permissionCheck.missing.map(item => item.label).join('、')}`), {
    code: 'SOLOPI_PERMISSIONS_REQUIRED', permissionCheck, cause,
  });
}
async function ensureSoloPiPermissions({ read, shell: executeShell, connectAdb, mode = 'record', signal, pause = ms => new Promise(r => setTimeout(r, ms)), now = Date.now }) {
  const shell = words => { signal.throwIfAborted(); return executeShell(words); };
  let required = ['adb', 'float', 'background', 'accessibility', 'powerSave'];
  const health = async () => {
    signal.throwIfAborted();
    const value = await read('harness', { type: 'health' });
    if (mode === 'replay' && value?.executionProfiles?.host) required = ['adb', 'accessibility'];
    if (value?.success !== true || !value.permissions || required.some(key => typeof value.permissions[key] !== 'boolean')) {
      throw permissionError(['无法确认手机权限状态'], false);
    }
    return value;
  };
  let state = await health(), root = false;
  const missing = () => required.filter(key => key !== 'adb' && state.permissions[key] !== true);
  const attempts = [];
  if (missing().length) {
    let elevated;
    // Do not restart adbd, request adb root, or assume that an installed su is authorized.
    try {
      if ((await shell(['id', '-u'])).trim() === '0') { root = true; elevated = shell; }
      else if ((await shell(['su', '-c', 'id -u'])).trim() === '0') {
        root = true; elevated = words => shell(['su', '-c', words.map(quote).join(' ')]);
      }
    } catch (error) { signal.throwIfAborted(); }
    if (root) {
      const user = (await shell(['am', 'get-current-user'])).trim();
      if (!/^\d+$/.test(user)) throw permissionError(missing(), root);
      for (const key of missing()) {
        signal.throwIfAborted();
        try {
          if (key === 'float') await elevated(['cmd', 'appops', 'set', '--user', user, PACKAGE, 'SYSTEM_ALERT_WINDOW', 'allow']);
          else if (key === 'powerSave') await elevated(['cmd', 'deviceidle', 'whitelist', `+${PACKAGE}`]);
          else if (key === 'accessibility') {
            const previous = (await elevated(['settings', '--user', user, 'get', 'secure', 'enabled_accessibility_services'])).trim();
            const services = previous && previous !== 'null' ? previous.split(':').filter(Boolean) : [];
            if (!services.includes(SERVICE)) services.push(SERVICE);
            await elevated(['settings', '--user', user, 'put', 'secure', 'enabled_accessibility_services', services.join(':')]);
            await elevated(['settings', '--user', user, 'put', 'secure', 'accessibility_enabled', '1']);
          } else continue; // Vendor-only restrictions have no portable automatic grant.
          attempts.push({ key, commandSucceeded: true });
        } catch (error) {
          signal.throwIfAborted();
          attempts.push({ key, commandSucceeded: false });
        }
      }
      const deadline = now() + 5000;
      do { state = await health(); if (!missing().length) break; await pause(250); } while (now() < deadline);
    }
  }
  if (missing().length) throw permissionError(missing(), root, attempts);
  if (state.permissions.adb !== true) {
    try { await connectAdb(); } catch (error) {
      signal.throwIfAborted();
      throw permissionError(['adb'], root, attempts, error);
    }
    state = await health();
  }
  const remaining = required.filter(key => state.permissions[key] !== true);
  if (remaining.length) throw permissionError(remaining, root, attempts);
  return { root, missing: [], attempts };
}
module.exports = { ensureSoloPiPermissions, permissionError, SERVICE };
