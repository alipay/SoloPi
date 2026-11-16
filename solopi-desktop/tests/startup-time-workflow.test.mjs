import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const startup = require('../electron/startup-time');
const { createTools } = require('../electron/agent/tools');
const { collectRequiredDeviceRoles } = require('../electron/task-device-selection');
const { mergeCaseUpdate } = require('../electron/case-update');
const { newAgentCase } = require('../electron/agent/mirrors');

const output = n => `Status: ok\nLaunchState: COLD\nActivity: com.example.app/.Main\nTotalTime: ${n}\nWaitTime: ${n + 1}\nComplete\n`;

test('agent creates a reusable case through the normal case persistence bridge', async () => {
  let saved;
  const tools = await createTools({ readState: () => ({ caseLibraries: [{id:'local'}], selectedCaseLibraryId:'local' }), skillsRoots: () => [], config: () => ({}), mcp: {},
    saveCase: async payload => { saved = payload; return { success: true, libraryId: 'local' }; } })({});
  const tool = tools.find(t => t.name === 'create_startup_time_case');
  const receipt = await tool.execute({ packageName: 'com.example.app', iterations: 10, intervalSeconds: 3 });
  assert.equal(receipt.caseId, saved.caseId);
  assert.equal(receipt.stepId, saved.document.steps[1].id);
  assert.equal(saved.action, 'create-case');
  assert.equal(saved.libraryId, 'local');
  assert.equal(saved.document.steps[1].inputs.iterations, '10');
  assert.deepEqual(saved.document.steps[1].config, {});
  assert.deepEqual([...collectRequiredDeviceRoles({ cases: [saved.document] })], ['phone']);
});

test('cold startup resolves launcher, collects each round and computes median and nearest-rank P90', async () => {
  const commands = [], sleeps = [];
  const samples = [335, 243, 222, 195, 196, 199, 198, 193, 227, 195];
  const result = await startup.measure({ serial: 'device', packageName: 'com.example.app', iterations: 10, intervalSeconds: 3 }, {
    runAdb: async args => { commands.push(args); return args.includes('resolve-activity') ? 'com.example.app/.Main\n' : output(samples.shift()); },
    sleep: async ms => sleeps.push(ms),
  });
  assert.deepEqual(result.samples.map(s => s.TotalTime), [335, 243, 222, 195, 196, 199, 198, 193, 227, 195]);
  assert.equal(result.statistics.TotalTime.median, 198.5);
  assert.equal(result.statistics.TotalTime.p90, 243);
  assert.equal(commands.length, 11);
  assert.deepEqual(commands[1], ['-s', 'device', 'shell', 'am', 'start', '-W', '-S', '-n', 'com.example.app/.Main']);
  assert.deepEqual(sleeps, Array(9).fill(3000));
});

test('saved case can be submitted as a normal persistent task', async () => {
  let state = { caseLibraries: [{ id: 'local' }], selectedCaseLibraryId: 'local', cases: [], components: [] };
  let submitted;
  const tools = await createTools({ readState: () => state, skillsRoots: () => [], config: () => ({}), mcp: {},
    saveCase: async payload => { state = mergeCaseUpdate(state, payload.caseId, newAgentCase(payload.document), { create: true, libraryId: payload.libraryId }); return { success: true, caseId: payload.caseId }; },
    invoke: async (channel, _event, payload) => {
      if (channel === 'workflow:validate-task-selection') return { success: true, devices: { phone: { serial: 'phone', runtime: 'android' } } };
      if (channel === 'workflow-task:submit') { submitted = payload; return { success: true, submitted: true, taskId: payload.taskId, task: { caseIds: payload.caseIds } }; }
      throw Error(`unexpected channel ${channel}`);
    } })({});
  const created = await tools.find(t => t.name === 'create_startup_time_case').execute({ packageName: 'com.example.app' });
  const result = await tools.find(t => t.name === 'submit_task').execute({ caseIds: [created.caseId] }, { operationId: 'test' });
  assert.equal(result.taskId, 'agent-test');
  assert.equal(submitted.cases[0].steps[1].inputs.action, 'startup_time');
  assert.equal(submitted.cases[0].defaults.phoneSerial, 'phone');
  assert.equal(state.cases[0].reviewStatus, 'draft');
});

test('invalid parameters, non-cold or malformed results never produce successful statistics', async () => {
  assert.throws(() => startup.createCase({ packageName: 'com.example;id', iterations: 2, intervalSeconds: 0 }), /包名/);
  assert.throws(() => startup.parseSample(output(100).replace('COLD', 'HOT'), 'com.example.app'), /冷启动/);
  assert.throws(() => startup.parseSample(output(100).replace('TotalTime: 100', 'TotalTime: x'), 'com.example.app'), /TotalTime/);
  let count = 0;
  await assert.rejects(startup.measure({ serial: 'device', packageName: 'com.example.app', iterations: 3, intervalSeconds: 0 }, {
    runAdb: async args => args.includes('resolve-activity') ? 'com.example.app/.Main' : (++count === 2 ? output(100).replace('COLD', 'HOT') : output(100)),
    sleep: async () => {},
  }), /第 2 轮失败（已完成 1 轮）/);
  assert.equal(count, 2);
});

test('cancellation during interval prevents the next launch', async () => {
  let stopped = false, launches = 0;
  await assert.rejects(startup.measure({ serial: 'device', packageName: 'com.example.app', iterations: 2, intervalSeconds: 1 }, {
    runAdb: async args => { if (args.includes('resolve-activity')) return 'com.example.app/.Main'; launches++; return output(100); },
    sleep: async () => { stopped = true; }, checkCanceled: () => { if (stopped) throw Error('stopped'); },
  }), /stopped/);
  assert.equal(launches, 1);
});
