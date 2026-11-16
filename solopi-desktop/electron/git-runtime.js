const fs = require('node:fs');
const path = require('node:path');

// Keep Git's helpers (including LFS smudge/clean filters and hooks) on the same
// runtime as explicit `git lfs` calls. Packaged apps never silently use Homebrew.
function gitRuntimeCommand(command, args, options = {}) {
  if (command !== 'git') return { command, args, env: options.env };
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const root = options.resourcesPath || path.join(__dirname, '..', 'resources');
  const executable = path.join(root, 'git-runtime', `${platform}-${arch}`, 'bin', `git-lfs${platform === 'win32' ? '.exe' : ''}`);
  let bundled = false;
  try { bundled = fs.statSync(executable).isFile(); if (bundled) fs.accessSync(executable, fs.constants.X_OK); }
  catch (error) {
    if (options.isPackaged || bundled) throw Object.assign(new Error(`solopi-desktop 内置 Git LFS 不可用，请修复或重新安装应用（${executable}）：${error.message}`), { code: 'BUNDLED_GIT_LFS_UNAVAILABLE' });
  }
  if (!bundled && options.isPackaged) throw Object.assign(new Error(`solopi-desktop 安装包缺少内置 Git LFS：${executable}；请修复或重新安装应用。`), { code: 'BUNDLED_GIT_LFS_UNAVAILABLE' });
  const env = { ...process.env, ...options.env };
  if (bundled) env.PATH = [path.dirname(executable), env.PATH || ''].filter(Boolean).join(path.delimiter);
  return { command: bundled && args[0] === 'lfs' ? executable : command, args: bundled && args[0] === 'lfs' ? args.slice(1) : args, env, source: bundled ? 'bundled' : 'system', executable: bundled ? executable : 'git-lfs' };
}
module.exports = { gitRuntimeCommand };
