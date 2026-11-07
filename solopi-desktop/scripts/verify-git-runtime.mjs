import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.env.GLASSBOX_GIT_PLATFORM || process.platform;
const arch = process.env.GLASSBOX_GIT_ARCH || process.arch;
const index = process.argv.indexOf('--runtime');
const runtime = index >= 0 ? path.resolve(process.argv[index + 1]) : path.join(root, 'resources/git-runtime', `${platform}-${arch}`);
const executable = path.join(runtime, 'bin', `git-lfs${platform === 'win32' ? '.exe' : ''}`);
fs.accessSync(executable, fs.constants.X_OK);
const license = path.join(runtime, 'LICENSES', 'git-lfs-LICENSE.md');
if (!fs.readFileSync(license, 'utf8').trim()) throw Error('Git LFS license notice is missing');
if (platform === 'darwin') {
  const dependencies = execFileSync('otool', ['-L', executable], { encoding: 'utf8' });
  if (/\/opt\/homebrew|\/usr\/local\/(Cellar|opt)/.test(dependencies)) throw Error('Bundled Git LFS depends on Homebrew');
}
const binary = fs.readFileSync(executable);
if (platform === 'linux') {
  if (!binary.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46]))) throw Error('Git LFS is not a Linux ELF executable');
  const machine = binary.readUInt16LE(18);
  if (machine !== (arch === 'x64' ? 62 : 183)) throw Error('Git LFS ELF architecture mismatch');
}
// Candidate archives are verified before notarization; do not execute their code.
// The source runtime still gets its normal native version smoke before packaging.
const nativeExecutionVerified = !process.argv.includes('--static') && platform === process.platform && arch === process.arch;
const version = nativeExecutionVerified ? execFileSync(executable, ['version'], { encoding: 'utf8', timeout: 5000 }).trim() : null;
if (version && (!version.startsWith('git-lfs/') || !version.includes(`${platform} ${arch === 'x64' ? 'amd64' : arch}`))) throw Error(`Wrong Git LFS platform/architecture: ${version}`);
const digest = crypto.createHash('sha256').update(binary).digest('hex');
console.log(JSON.stringify({ success: true, runtime, version, sha256: digest, nativeExecutionVerified }));
