import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { prepareThirdPartyNotices, verifyThirdPartyNotices } from '../scripts/third-party-notices.mjs';

function fixture(t, targetPlatform = 'darwin') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notices-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, data) => { const dest = path.join(root, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, typeof data === 'object' ? JSON.stringify(data) : data); };
  write('package.json', { name: 'generic-test-app', version: '1.0.0' });
  const lock = { packages: { '': { version: '1.0.0' }, 'node_modules/example': { version: '2.0.0', license: 'MIT' }, 'node_modules/unavailable-optional': { version: '1.0.0', optional: true }, 'node_modules/dev-only': { version: '1.0.0', dev: true } } };
  write('package-lock.json', lock);
  write('node_modules/example/package.json', { name: 'example', version: '2.0.0', license: 'MIT' });
  write('node_modules/example/LICENSE', 'Copyright example\nOriginal permission text');
  write('node_modules/example/vendor/NOTICE.txt', 'Vendor attribution');
  write('LICENSE', 'Project license'); write('NOTICE', 'Project notice');
  write('runtime/version', '44.7.0'); write('runtime/LICENSE', 'Electron license');
  write('runtime/LICENSES.chromium.html', '<html>Target Chromium notices</html>');
  write(`runtime/${{ darwin: 'Electron.app', linux: 'electron', win32: 'electron.exe' }[targetPlatform]}`, 'fixture');
  const options = { projectRoot: root, resourcesDir: path.join(root, 'packaged-resources'), electronDist: path.join(root, 'runtime'), targetPlatform, electronVersion: '44.7.0' };
  return { root, write, lock, options, output: path.join(root, 'packaged-resources/third-party') };
}
for (const platform of ['darwin', 'linux', 'win32']) test(`preserves exact notices and production tree on ${platform}`, t => {
  const f = fixture(t, platform); const result = prepareThirdPartyNotices(f.options);
  assert.equal(result.packages, 1);
  assert.equal(fs.readFileSync(path.join(f.output, 'electron/LICENSES.chromium.html'), 'utf8'), '<html>Target Chromium notices</html>');
  const text = fs.readFileSync(path.join(f.output, 'npm/THIRD-PARTY-LICENSES.txt'), 'utf8');
  assert.match(text, /Original permission text/); assert.match(text, /Vendor attribution/);
  assert.doesNotMatch(fs.readFileSync(path.join(f.output, 'inventory.json'), 'utf8'), new RegExp(f.root));
  assert.deepEqual(prepareThirdPartyNotices(f.options), result);
});
test('rejects runtime from a different platform or version', t => {
  const f = fixture(t); assert.throws(() => prepareThirdPartyNotices({ ...f.options, targetPlatform: 'linux' }), /mismatch/);
  assert.throws(() => prepareThirdPartyNotices({ ...f.options, electronVersion: '43.0.0' }), /mismatch/);
});
test('missing Chromium notice blocks packaging', t => {
  const f = fixture(t); fs.rmSync(path.join(f.root, 'runtime/LICENSES.chromium.html'));
  assert.throws(() => prepareThirdPartyNotices(f.options), /ENOENT/); assert.equal(fs.existsSync(f.output), false);
});
test('SPDX name alone cannot replace license text', t => {
  const f = fixture(t); fs.rmSync(path.join(f.root, 'node_modules/example/LICENSE'));
  assert.throws(() => prepareThirdPartyNotices(f.options), /Missing license text/);
});
test('missing required dependency and lock mismatch block packaging', t => {
  const f = fixture(t); f.write('node_modules/example/package.json', { name: 'example', version: '3.0.0' });
  assert.throws(() => prepareThirdPartyNotices(f.options), /lock mismatch/);
  fs.rmSync(path.join(f.root, 'node_modules/example'), { recursive: true });
  assert.throws(() => prepareThirdPartyNotices(f.options), /ENOENT/);
});
test('commit-pinned supplement preserves original text and detects tampering', t => {
  const f = fixture(t); fs.rmSync(path.join(f.root, 'node_modules/example/LICENSE'));
  const data = 'Original upstream permission text';
  const record = { name: 'example', version: '2.0.0', file: 'example.txt', source: `https://raw.githubusercontent.com/example/project/${'a'.repeat(40)}/LICENSE`, sha256: crypto.createHash('sha256').update(data).digest('hex') };
  f.write('resources/third-party/npm-supplements/example.txt', data);
  f.write('resources/third-party/npm-supplements/manifest.json', { licenses: [record] });
  prepareThirdPartyNotices(f.options);
  assert.match(fs.readFileSync(path.join(f.output, 'npm/THIRD-PARTY-LICENSES.txt'), 'utf8'), /Original upstream permission text/);
  f.write('resources/third-party/npm-supplements/example.txt', 'changed');
  assert.throws(() => prepareThirdPartyNotices(f.options), /hash mismatch/);
});
test('verification detects deleted, modified and wrong-target materials', t => {
  const f = fixture(t); prepareThirdPartyNotices(f.options);
  assert.throws(() => verifyThirdPartyNotices(f.output, { targetPlatform: 'linux' }), /mismatch/);
  fs.appendFileSync(path.join(f.output, 'electron/LICENSE.electron.txt'), 'changed');
  assert.throws(() => verifyThirdPartyNotices(f.output), /integrity mismatch/);
  fs.rmSync(path.join(f.output, 'electron/LICENSE.electron.txt'));
  assert.throws(() => verifyThirdPartyNotices(f.output), /ENOENT/);
});
test('inventory cannot redirect verification outside notice directory', t => {
  const f = fixture(t); prepareThirdPartyNotices(f.options);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.output, 'inventory.json')));
  manifest.artifacts[0].file = '../LICENSE'; f.write('packaged-resources/third-party/inventory.json', manifest);
  assert.throws(() => verifyThirdPartyNotices(f.output), /Unsafe notice path/);
});
