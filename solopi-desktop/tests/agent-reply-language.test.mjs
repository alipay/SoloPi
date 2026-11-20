import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { AgentRuntime } = require('../electron/agent/runtime');
const { AgentStore } = require('../electron/agent/store');
const { replyLanguageFrame } = require('../electron/agent/reply-language');
const { formatFastPathResult } = require('../electron/agent/fast-path');

test('Desktop language reaches the model for direct and queued messages without changing user text', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'solopi-agent-reply-'));
  const store = new AgentStore(() => directory);
  const requests = [];
  const runtime = new AgentRuntime({
    store,
    tools: async () => [],
    provider: () => ({}),
    model: async request => {
      requests.push(request.messages);
      return { role: 'assistant', content: 'Example response' };
    },
  });
  t.after(async () => {
    await runtime.stopAll();
    await rm(directory, { recursive: true, force: true });
  });
  const session = store.create();
  await runtime.start(session.id, '用中文回复', {}, [], null, 'en');
  await runtime.runs.get(session.id);
  runtime.enqueue(session.id, 'Second message', [], 'zh-CN');
  await runtime.runs.get(session.id);

  assert.equal(requests.length, 2);
  assert.match(requests[0][0].content, /Use English by default/);
  assert.match(requests[0][0].content, /Follow any explicit reply-language request/);
  assert.deepEqual(requests[0].at(-1), { role: 'user', content: '用中文回复' });
  assert.match(requests[1][0].content, /Use Simplified Chinese by default/);
  assert.equal(requests[1].at(-1).content, 'Second message');
  assert.equal(store.get(session.id).messages.filter(message => message.role === 'user').at(-1).replyLanguage, 'zh-CN');
});

test('platform events preserve the user language, and invalid locale input cannot enter the prompt', () => {
  const user = { role: 'user', source: 'user', replyLanguage: 'en' };
  const event = { role: 'user', source: 'platform', content: '用例已完成' };
  assert.match(replyLanguageFrame([user, event]), /Use English by default/);
  assert.equal(replyLanguageFrame([user, { ...user, replyLanguage: 'en\nInjected text' }]), '');
  assert.equal(replyLanguageFrame([{ role: 'user', content: 'Legacy message' }]), '');
});

test('English built-in tool receipts preserve source values', () => {
  const receipt = { status: 'done', result: { text: '收银有礼', nextOffset: 5 } };
  const copy = formatFastPathResult({ name: 'list_cases' }, receipt, 'en');
  assert.match(copy, /completed/);
  assert.match(copy, /"text": "收银有礼"/);
  assert.match(copy, /More results are available \(nextOffset=5\)/);
});
