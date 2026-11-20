import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyPackagedHarness } from '../scripts/verify-packaged-harness.mjs';

test('packaged Harness must contain the current Python sources and resources', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solopi-harness-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const resources = path.join(root, 'resources');
  const packaged = path.join(resources, 'harness');
  for (const [name, body] of [
    ['solopi_harness/desktop_control.py', 'bridge'],
    ['solopi_harness/virtual_desktop.py', 'virtual'],
    ['solopi_harness/resources/workflows/sample.json', '{}'],
  ]) {
    for (const base of [source, packaged]) {
      const file = path.join(base, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    }
  }
  assert.equal(verifyPackagedHarness(source, resources).checkedFiles, 3);
  const target = path.join(packaged, 'solopi_harness/virtual_desktop.py');
  fs.rmSync(target);
  assert.throws(() => verifyPackagedHarness(source, resources), /Packaged Harness missing/);
  fs.writeFileSync(target, 'old version');
  assert.throws(() => verifyPackagedHarness(source, resources), /differs from source/);
});
