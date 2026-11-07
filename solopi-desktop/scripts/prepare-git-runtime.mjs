import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const value = key => { const i = process.argv.indexOf(key); return i < 0 ? '' : process.argv[i + 1] || ''; };
const binary = value('--binary') || process.env.GLASSBOX_GIT_LFS_BINARY;
const license = value('--license') || process.env.GLASSBOX_GIT_LFS_LICENSE;
if (!binary || !license) throw Error('Provide --binary <git-lfs> and --license <LICENSE.md>, or GLASSBOX_GIT_LFS_BINARY / GLASSBOX_GIT_LFS_LICENSE');
const platform = process.env.GLASSBOX_GIT_PLATFORM || process.platform;
const arch = process.env.GLASSBOX_GIT_ARCH || process.arch;
const destination = path.join(root, 'resources/git-runtime', `${platform}-${arch}`);
const staging = `${destination}.staging-${process.pid}`;
try {
  fs.mkdirSync(path.join(staging, 'bin'), { recursive: true }); fs.mkdirSync(path.join(staging, 'LICENSES'));
  fs.copyFileSync(binary, path.join(staging, 'bin', `git-lfs${platform === 'win32' ? '.exe' : ''}`));
  fs.chmodSync(path.join(staging, 'bin', `git-lfs${platform === 'win32' ? '.exe' : ''}`), 0o755);
  fs.copyFileSync(license, path.join(staging, 'LICENSES/git-lfs-LICENSE.md'));
  execFileSync(process.execPath, [path.join(root, 'scripts/verify-git-runtime.mjs'), '--runtime', staging], { stdio: 'inherit' });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.rmSync(destination, { recursive: true, force: true }); fs.renameSync(staging, destination);
} finally { fs.rmSync(staging, { recursive: true, force: true }); }
