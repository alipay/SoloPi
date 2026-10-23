import { signAsync } from '@electron/osx-sign';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const SHA1_PATTERN = /^[A-F0-9]{40}$/;

function resolveIdentityName(identityHash) {
  const output = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const matchingLine = output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.includes(identityHash));
  const match = matchingLine?.match(/^[0-9]+\)\s+[A-F0-9]{40}\s+"(.+)"$/);
  if (!match) {
    throw new Error(`Configured signing identity is not currently valid: ${identityHash}`);
  }
  return match[1];
}

// Resource blobs (for example V8 snapshots) are sealed by their enclosing
// bundle. Only Mach-O files can carry the required Developer ID timestamp.
export function ignoreResourceBlob(filePath) {
  if (!fs.statSync(filePath).isFile()) return false;
  const fd = fs.openSync(filePath, 'r'), header = Buffer.alloc(4);
  try { fs.readSync(fd, header, 0, 4, 0); } finally { fs.closeSync(fd); }
  return !['feedface','cefaedfe','feedfacf','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca'].includes(header.toString('hex'));
}

export async function withTimestampRetry(operation, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= 2 || !String(error.stderr || error.message).includes('A timestamp was expected but was not found')) throw error;
      console.warn(`[sign] Apple timestamp response missing; retry ${attempt + 1}/2 (secure timestamp remains mandatory)`);
      await wait(2000 * (attempt + 1));
    }
  }
}

export function createIgnorePredicate(inherited) {
  const rules = Array.isArray(inherited) ? inherited : inherited ? [inherited] : [];
  return filePath => rules.some(rule => typeof rule === 'function' ? rule(filePath) : Boolean(filePath.match(rule))) || ignoreResourceBlob(filePath);
}

export async function sign(options) {
  const identityHash = String(process.env.GLASSBOX_CODESIGN_IDENTITY_SHA1 || '').trim().toUpperCase();
  if (!SHA1_PATTERN.test(identityHash)) {
    throw new Error(
      'Electron Builder signing requires GLASSBOX_CODESIGN_IDENTITY_SHA1 to be an exact 40-character SHA-1 hash.',
    );
  }
  const identityName = resolveIdentityName(identityHash);
  const isAppleDevelopment = identityName.startsWith('Apple Development:');
  const inheritedOptionsForFile = options.optionsForFile;

  return withTimestampRetry(() => signAsync({
    ...options,
    identity: identityHash,
    // osx-sign normalizes a single predicate; an array is discarded by some versions.
    ignore: createIgnorePredicate(options.ignore),
    // Apple Development certificates are local QA identities and do not
    // support the secure timestamp required by Developer ID distribution.
    // @electron/osx-sign consumes this setting per file (not at the top level)
    // and documents "none" as the explicit opt-out.
    ...(isAppleDevelopment
      ? {
          optionsForFile: (filePath) => ({
            ...(inheritedOptionsForFile?.(filePath) || {}),
            timestamp: 'none',
          }),
        }
      : {}),
  }));
}

export default sign;
