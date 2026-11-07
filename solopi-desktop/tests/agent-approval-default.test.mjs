import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { AgentStore } = require('../electron/agent/store');
const { AgentRuntime } = require('../electron/agent/runtime');

test('new conversations execute confirmed tools automatically and can switch back to approval', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'solopi-approval-default-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new AgentStore(() => directory);
  const automatic = store.create();
  assert.equal(store.get(automatic.id).approvalMode, 'auto');
  let calls = 0, requests = 0;
  const runtime = new AgentRuntime({
    store,
    tools: async () => [{ name: 'example_action', confirm: true, schema: { type: 'object' },
      execute: async () => { calls++; return { success: true }; } }],
    provider: () => ({}),
    model: async () => ++requests % 2 === 1
      ? { role: 'assistant', tool_calls: [{ id: `call-${requests}`, type: 'function',
        function: { name: 'example_action', arguments: '{}' } }] }
      : { role: 'assistant', content: 'done' },
  });
  t.after(() => runtime.stopAll());
  const wait = async id => {
    for (let i = 0; i < 1000 && runtime.active.has(id); i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(runtime.active.has(id), false);
  };
  await runtime.start(automatic.id, 'run the action');
  await wait(automatic.id);
  assert.equal(calls, 1);
  assert.equal(store.get(automatic.id).status, 'idle');

  const manual = store.create();
  await runtime.setApprovalMode(manual.id, 'ask');
  await runtime.start(manual.id, 'run the action');
  await wait(manual.id);
  assert.equal(calls, 1);
  assert.equal(store.get(manual.id).status, 'awaiting_approval');
  assert.equal(store.get(manual.id).approvalMode, 'ask');
  assert.equal(store.get(automatic.id).approvalMode, 'auto');
});
