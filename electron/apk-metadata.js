const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execute = promisify(execFile);

function parseApkBadging(output) {
  const line = String(output).split(/\r?\n/).find(line => line.startsWith('package:')) || '';
  const field = name => line.match(new RegExp(`${name}='([^']*)'`))?.[1] || '';
  const packageName = field('name');
  if (!/^[\w]+(?:\.[\w]+)+$/.test(packageName)) throw new Error('无法读取 APK 包名。');
  return { packageName, versionName: field('versionName'), versionCode: field('versionCode') };
}

async function readApkMetadata(apkPath) {
  const roots = [...new Set([process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    path.join(os.homedir(), 'Library/Android/sdk'), path.join(os.homedir(), 'Android/Sdk')].filter(Boolean))];
  for (const root of roots) {
    const builds = path.join(root, 'build-tools');
    let versions;
    try { versions = fs.readdirSync(builds).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); }
    catch { continue; }
    for (const version of versions) {
      for (const name of ['aapt2', 'aapt']) {
        const tool = path.join(builds, version, name + (process.platform === 'win32' ? '.exe' : ''));
        if (!fs.existsSync(tool)) continue;
        const { stdout } = await execute(tool, ['dump', 'badging', apkPath], { timeout: 10000, maxBuffer: 1024 * 1024 });
        return parseApkBadging(stdout);
      }
    }
  }
  throw new Error('未找到 Android SDK build-tools 的 aapt/aapt2，目标包名及版本未读取。');
}

async function readInstalledMetadata(runAdb, serial, packageName) {
  if (!/^[\w]+(?:\.[\w]+)+$/.test(packageName)) throw new Error('APK 包名无效，未查询已安装版本。');
  const output = String(await runAdb(['-s', serial, 'shell', 'dumpsys', 'package', packageName], 10000));
  // Restrict parsing to this package, rather than dependencies or disabled system packages.
  const escaped = packageName.replace(/\./g, '\\.');
  const section = output.match(new RegExp(`Package \\[${escaped}\\][\\s\\S]*?(?=\\n\\s*Package \\[|$)`))?.[0] || '';
  const versionCode = section.match(/\bversionCode=(\d+)/)?.[1];
  if (!versionCode) throw new Error('未读取到目标包的当前安装版本（可能尚未安装）。');
  return { packageName, versionCode, versionName: section.match(/\bversionName=([^\r\n]*)/)?.[1]?.trim() || '' };
}
module.exports = { readApkMetadata, readInstalledMetadata, parseApkBadging };
