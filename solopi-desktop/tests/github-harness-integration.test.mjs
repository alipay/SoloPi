import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { nativeFixture, toolCall, boundary } from './fixtures/native-harness.mjs';
const require = createRequire(import.meta.url);
const { createScreenSettings } = require('../electron/agent/screen-settings');
const { createHarnessTasks } = require('../electron/harness-tasks');
const { AgentStore } = require('../electron/agent/store');

test('screen settings round-trip without exposing or changing request policy', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-settings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createScreenSettings(() => dir);
  assert.deepEqual(store.load(), { screenMode: 'main', virtualChecks: [] });
  const settings = { screenMode: 'virtual', virtualChecks: [{ selectorKey: 'text', selectorValue: 'Done', operator: 'equals', expected: 'Done' }] };
  assert.deepEqual(store.save(settings), settings);
  assert.deepEqual(createScreenSettings(() => dir).load(), settings);
  assert.throws(() => store.save({ ...settings, inputBudgetTokens: 100 }), /屏幕模式/);
  assert.throws(() => store.save({ ...settings, virtualChecks: [{ selectorKey: 'shell' }] }), /验收/);
});

test('native Harness freezes virtual device/checks, isolates host tools and saves cleanup before ack', async t => {
  let selected = { serial: 'original', runtime: 'android' }, seen, acknowledged = false;
  const checks = [{ selectorKey: 'text', selectorValue: 'Done', operator: 'equals', expected: 'Done' }];
  let f;
  f = nativeFixture(t, [options => {
    assert.ok(options.tools.some(tool => tool.name === 'virtual_start'));
    assert.ok(!options.tools.some(tool => ['read', 'write', 'edit', 'run_command', 'list_skills'].includes(tool.name)));
    selected = { serial: 'different', runtime: 'android' }; checks[0].expected = 'changed';
    return [toolCall('virtual_start')];
  }, () => '已完成'], [], {
    screen: { settings: () => ({ screenMode: 'virtual', virtualChecks: checks }), device: () => selected,
      finish: async s => { s.screenReport = { status: 'passed', reportPath: null, checkpoints: [] }; return { success: true, cleanupConfirmed: true,
        acknowledge: () => { assert.equal(f.store.get(s.id).screenCleanup.confirmed, true); acknowledged = true; return true; } }; } },
    tools: async (_event, _signal, s) => [{ name: 'virtual_start', schema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => { seen = structuredClone({ device: s.screenDevice, checks: s.screenChecks }); return { success: true }; } }],
  });
  const s = await f.run();
  assert.equal(s.executor.name, 'deepseek-harness');
  assert.equal(seen.device.serial, 'original'); assert.equal(seen.checks[0].expected, 'Done');
  assert.equal(s.screenCleanup.confirmed, true); assert.equal(acknowledged, true);
});

test('unconfirmed virtual cleanup blocks a new turn until explicit recovery', async t => {
  let confirmed = false;
  const f = nativeFixture(t, [() => '结束'], [], { screen: {
    settings: () => ({ screenMode: 'virtual', virtualChecks: [] }), device: () => ({ serial: 'phone', runtime: 'android' }),
    finish: async () => ({ success: confirmed, cleanupConfirmed: confirmed }),
  } });
  const s = await f.run(); assert.equal(s.status, 'failed'); assert.equal(s.screenCleanup.confirmed, false);
  await assert.rejects(f.runtime.start(s.id, '再试', {}), /清理尚未确认/);
  assert.equal(f.adapter.requests.length, 1);
  confirmed = true; assert.equal((await f.runtime.retryScreenCleanup(s.id)).screenCleanup.confirmed, true);
});

test('stop during native approval does not execute a virtual action and still releases screen', async t => {
  let executions = 0, cleanup = 0;
  const f = nativeFixture(t, [() => [toolCall('virtual_start')]], [{ name: 'virtual_start', confirm: true,
    schema: { type: 'object', properties: {}, additionalProperties: false }, execute: async () => { executions++; return {}; } }], {
    screen: { settings: () => ({ screenMode: 'virtual', virtualChecks: [] }), device: () => ({ serial: 'phone', runtime: 'android' }),
      finish: async () => { cleanup++; return { success: true, cleanupConfirmed: true }; } },
  });
  f.s.approvalMode = 'ask'; f.store.save(f.s);
  await f.runtime.start(f.s.id, '开始', {}); await boundary(f.runtime);
  assert.equal(f.runtime.approvals.size, 1);
  await f.runtime.stop(f.s.id); await boundary(f.runtime);
  assert.equal(executions, 0); assert.equal(cleanup, 1); assert.equal(f.store.get(f.s.id).screenCleanup.confirmed, true);
});

test('restart marks interrupted virtual approval as ownerless for capability recovery', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-recovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new AgentStore(() => dir), s = store.create();
  Object.assign(s, { status: 'awaiting_approval', screenMode: 'virtual', screenCleanup: { confirmed: false, ownerActive: true } }); store.save(s);
  store.list(true); const recovered = store.get(s.id);
  assert.equal(recovered.status, 'interrupted'); assert.deepEqual(recovered.screenCleanup, { confirmed: false });
});

test('fixed replay appears before dispatch and preserves one taskId through completion', async () => {
  const records = []; let called = false;
  const tasks = createHarnessTasks({ readTasks: () => [], persist: task => records.push(task), control: { request: async operation => {
    assert.equal(operation, 'replay'); assert.equal(records[0].status, 'running'); called = true;
    return { success: true, data: { exitCode: 0, result: { status: 'passed' }, artifacts: '/fixture/evidence' } };
  } } });
  const result = await tasks.replay({ config: { deviceId: 'fixture' }, requirement: {} });
  assert.equal(called, true); assert.equal(records.at(-1).status, 'success');
  assert.ok(records.every(task => task.id === result.taskId));
  assert.equal(records.at(-1).cases[0].harnessArtifacts, '/fixture/evidence');
});

test('visibility failure prevents replay; completed request with failed Judge is still failed', async () => {
  let calls = 0;
  const invisible = createHarnessTasks({ readTasks: () => [], persist: () => { throw Error('cannot persist'); }, control: { request: async () => { calls++; } } });
  await assert.rejects(invisible.replay({ requirement: {} }), /cannot persist/); assert.equal(calls, 0);
  const records = [], tasks = createHarnessTasks({ readTasks: () => [], persist: task => records.push(task), control: {
    request: async () => ({ success: true, data: { exitCode: 0, result: { status: 'failed' } } }),
  } });
  await tasks.replay({ requirement: {} }); assert.equal(records.at(-1).status, 'failed');
});

test('replay stop and restart recovery never submit the original action again', async () => {
  let resolve, executions = 0; const records = [];
  const tasks = createHarnessTasks({ readTasks: () => [], persist: task => records.push(task), control: {
    request: () => { executions++; return new Promise(r => { resolve = r; }); },
    stop: async () => resolve({ success: false, error: 'interrupted' }),
  } });
  const running = tasks.replay({ requirement: {} }); await new Promise(resolve=>setImmediate(resolve)); const id = records[0].id;
  await tasks.stop(id); await running; assert.equal(records.at(-1).status, 'stopped');
  const previous = { ...records[0], executionEngine: 'device-harness', status: 'running' };
  await createHarnessTasks({ readTasks: () => [previous], persist: task => records.push(task), control: { request: () => { executions++; } } }).recover();
  assert.equal(records.at(-1).id, id); assert.equal(records.at(-1).status, 'interrupted'); assert.equal(executions, 1);
});

test('controlled activity keeps one task and only treats confirmed manual stop as stopped', async () => {
  const records = [];
  const tasks = createHarnessTasks({ readTasks: () => [], persist: task => records.push(task), control: {} });
  let activity;
  activity = await tasks.beginActivity({ name: 'fixture', deviceId: 'phone', stop: () => activity.update({ status: 'paused', reason: 'stopped', cleanupConfirmed: true, pending: false }) });
  await activity.update({ status: 'running', processed: 1 });
  await tasks.stop(activity.id);
  assert.ok(records.every(task => task.id === activity.id)); assert.equal(records.at(-1).status, 'stopped');
  assert.equal(tasks.owns(activity.id), false);
  const failed = await tasks.beginActivity({ name: 'fixture', deviceId: 'phone', stop() {} });
  await failed.update({ status: 'paused', reason: 'cleanup_unconfirmed', cleanupConfirmed: false });
  assert.equal(records.at(-1).status, 'failed');
});

test('virtual observations use native pruning while the full execution receipt stays readable', async t => {
  const raw = { success: true, observationId: 'current', nodes: [{ text: 'large observation '.repeat(24000) }], receipt: { status: 'succeeded' } };
  const f = nativeFixture(t, [() => [toolCall('virtual_observe')], options => {
    assert.match(JSON.stringify(options.messages), /tool result middle pruned/);
    return '已观察';
  }], [{ name: 'virtual_observe', schema: { type: 'object', properties: {}, additionalProperties: false }, execute: async () => raw }], {
    screen: { settings: () => ({ screenMode: 'virtual', virtualChecks: [] }), device: () => ({ serial: 'phone', runtime: 'android' }), finish: async () => ({ success: true, cleanupConfirmed: true }) },
  });
  const s = await f.run();
  assert.deepEqual(s.calls[0].result, raw);
  assert.equal(s.screenCleanup.confirmed, true);
});
