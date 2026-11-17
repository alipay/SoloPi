import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {prepareCliTaskQuery, verifyCliTaskQuery} from '../scripts/prepare-cli-task-query.mjs';
const root = path.resolve(import.meta.dirname, '..');
test('isolated packaged CLI returns native timing without Electron or application source dependencies', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-task-query-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  prepareCliTaskQuery(root, directory);
  verifyCliTaskQuery(root, directory);
  const {taskResultReceipt} = createRequire(import.meta.url)(path.join(directory, 'task-case-query.cjs'));
  const result = taskResultReceipt({id:'native-task',status:'failed',startedAt:1794806984425,finishedAt:1794807174559,cases:[]});
  assert.equal(result.timing.durationMs, 190134);
  assert.equal(result.status, 'failed');
  assert.equal(result.successScope, 'query');
  fs.unlinkSync(path.join(directory, 'agent/receipt-timing.js'));
  assert.throws(() => verifyCliTaskQuery(root, directory), /ENOENT/);
});
test('packaged resources include the shared timing dependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const resource = pkg.build.extraResources.find(item => item.from === 'build/packaged-cli');
  assert.ok(resource.filter.includes('agent/receipt-timing.js'));
});
