import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createReplySettings } = require('../electron/reply-settings');

test('configuration is bounded, normalized and persists across store instances', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'reply-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createReplySettings({ directory });
  assert.deepEqual((await store.load()).contacts, []);
  const value = { device: 'test', contacts: [' Alice ', 'Alice'], textModel: 'text', visionModel: 'image', role: 'helper', contextCount: 5 };
  await store.save(value);
  const loaded = await createReplySettings({ directory }).load();
  assert.deepEqual(loaded.contacts, ['Alice']);
  assert.equal(loaded.textModel, 'text');
  await assert.rejects(store.save({ ...value, contextCount: 31 }), /invalid_settings/);
  await assert.rejects(store.save({ ...value, contacts: Array(21).fill('x') }), /invalid_settings/);
});
