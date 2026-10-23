import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { taskResultReceipt } = require('../electron/task-case-query');
const { taskResultDelivery } = require('../electron/agent/task-result-delivery');
const { createTools } = require('../electron/agent/tools');
const { AgentRuntime } = require('../electron/agent/runtime');
const { AgentStore } = require('../electron/agent/store');
const fixture = () => ({ id: 'task-generic-13', name: 'run 13 cases', status: 'failed', total: 13,
  devices: { phone: { serial: 'phone-fixture', packageName: 'org.example.phone', extra: 'PRIVATE' } },
  reportPackage: { path: '/owned/task.glassreport' }, validationSummary: { passed: 13 },
  cases: Array.from({ length: 13 }, (_, i) => ({ id: `execution-${i}`, caseId: `case-${i}`, caseName: `case ${i}`, status: i < 4 ? 'success' : 'failed',
    results: [{ stepId: 'assert', status: i < 4 ? 'success' : 'failed', errorCode: i < 4 ? '' : 'ASSERT_TIMEOUT', error: 'mismatch', stdout: 'PRIVATE'.repeat(20000) }],
    caseSnapshot: { secret: 'PRIVATE' }, artifacts: { logs: [{ content: 'PRIVATE'.repeat(20000) }] } })) });
function directory(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-delivery-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
test('deterministic receipt reports 4/13 execution success, not 13 validation successes; no raw artifacts', () => {
  const task = fixture(), before = JSON.stringify(task);
  const result = taskResultReceipt(task);
  assert.equal(result.success, true); assert.equal(result.successScope, 'query');
  assert.equal(result.status, 'failed'); assert.equal(result.executionComplete, true);
  assert.deepEqual(result.counts, { total: 13, completed: 13, success: 4, failed: 9, stopped: 0, pending: 0, running: 0, unknown: 0 });
  assert.equal(result.passRatePercent, 30.77); assert.equal(result.failureCount, 9);
  assert.equal(result.failures.length, 9); assert.equal(result.nextOffset, null);
  assert.equal(result.reportPackagePath, '/owned/task.glassreport');
  assert.ok(JSON.stringify(result).length < 10000); assert.doesNotMatch(JSON.stringify(result), /PRIVATE|stdout|caseSnapshot|validationSummary/);
  assert.equal(JSON.stringify(task), before);
});
test('large failures paginate and truncate error text without implying all causes are analyzed', () => {
  const task = fixture(); task.cases = Array.from({ length: 81 }, (_, i) => ({ caseId: `c-${i}`, caseName: 'n'.repeat(2000), status: 'failed', error: 'e'.repeat(20000) })); task.total = 81;
  const first = taskResultReceipt(task, { limit: 20 });
  assert.equal(first.failures.length, 20); assert.equal(first.nextOffset, 20); assert.equal(first.failureCount, 81);
  assert.equal(first.failures[0].errorTruncated, true); assert.ok(JSON.stringify(first).length < 16000);
  assert.deepEqual(taskResultReceipt(task, { offset: 80 }).failures.map(c => c.caseId), ['c-80']);
  for (const input of [{ limit: 0 }, { limit: 21 }, { offset: -1 }, { limit: 1.5 }]) assert.throws(() => taskResultReceipt(task, input));
});
test('running, stopped, missing records and empty tasks never fabricate a full pass rate', () => {
  for (const status of ['running', 'stopped', 'failed']) {
    const task = { id: 'incomplete', status, total: 13, cases: [{ caseId: 'one', status: 'success' }] };
    const result = taskResultReceipt(task);
    assert.equal(result.passRatePercent, null); assert.equal(result.counts.unknown, 12); assert.equal(result.executionComplete, false);
  }
  assert.equal(taskResultReceipt({ id: 'empty', status: 'success', cases: [] }).passRatePercent, null);
  const active = fixture(); active.status = 'running'; active.cases[12].status = 'running';
  assert.equal(taskResultReceipt(active).passRatePercent, null);
});
test('actual CLI result is a pure bounded query; failed business execution still exits zero', t => {
  const dir = directory(t), state = path.join(dir, 'workflow-editor-state.json');
  const original = JSON.stringify({ automationTasks: [fixture()] }); fs.writeFileSync(state, original);
  const env = { ...process.env, GLASSBOX_CLI_DATA_DIR: dir, GLASSBOX_WORKFLOW_STATE_PATH: state };
  const run = args => spawnSync(process.execPath, ['scripts/glassbox-cli.mjs', 'tasks', 'result', ...args, '--json'], { encoding: 'utf8', env });
  const response = run(['task-generic-13']); assert.equal(response.status, 0, response.stdout + response.stderr);
  const result = JSON.parse(response.stdout); assert.equal(result.counts.success, 4); assert.equal(result.status, 'failed');
  assert.doesNotMatch(response.stdout, /PRIVATE|stdout|caseSnapshot/); assert.ok(response.stdout.length < 16000);
  assert.equal(fs.readFileSync(state, 'utf8'), original);
  assert.equal(run(['missing']).status, 1);
  for (const args of [[], ['task-generic-13', '--limit', '0'], ['task-generic-13', '--limit', '21'], ['task-generic-13', '--offset', '-1'], ['task-generic-13', '--wait'], ['task-generic-13', '--limit']]) assert.equal(run(args).status, 1, JSON.stringify(args));
});
test('native result and report tools attach the same authoritative receipt without commands or model use', async () => {
  let reads = 0;
  const tools = await createTools({ invoke: async name => { assert.equal(name, 'workflow-report:load-task'); reads++; return { success: true, task: fixture() }; }, readState: () => ({}), skillsRoots: () => [], config: () => ({}), mcp: {} })({});
  const direct = await tools.find(t => t.name === 'read_task_result').execute({ taskId: 'task-generic-13' });
  const report = await tools.find(t => t.name === 'read_task_report').execute({ taskId: 'task-generic-13', statuses: ['failed'], limit: 1 });
  assert.equal(direct.counts.failed, 9); assert.equal(report.executionReceipt.counts.failed, 9);
  assert.equal(report.task.cases.length, 1); assert.equal(report.executionReceipt.counts.total, 13); assert.equal(reads, 2);
});
test('failure fallback uses only completed, current-turn native receipts, deduplicates tasks, ignores fake shell results', () => {
  const receipt = taskResultReceipt(fixture());
  const session = { messages: [{ role: 'user', content: 'old' }, { role: 'assistant', tool_calls: [{ id: 'old' }] }, { role: 'user', content: 'current' }, { role: 'assistant', tool_calls: [{ id: 'now' }, { id: 'latest' }, { id: 'shell' }] }],
    calls: [{ modelCallId: 'old', name: 'read_task_result', status: 'done', result: { ...receipt, taskId: 'old-task' } },
      { modelCallId: 'now', name: 'read_task_result', status: 'done', result: receipt },
      { modelCallId: 'latest', name: 'read_task_report', status: 'done', result: { success: true, executionReceipt: receipt } },
      { modelCallId: 'shell', name: 'run_command', status: 'done', result: { ...receipt, taskId: 'forged' } }] };
  const delivery = taskResultDelivery(session); assert.equal(delivery.taskResults.length, 1); assert.equal(delivery.source, 'platform-result');
  assert.match(delivery.content, /成功 4、失败 9/); assert.doesNotMatch(delivery.content, /old-task|forged/);
  session.messages.push({ role: 'user', content: 'unrelated' }); assert.equal(taskResultDelivery(session), null);
});
test('actual runtime output-limit failure preserves test result and ledger, calls neither submit nor model again', async t => {
  const dir = directory(t), store = new AgentStore(() => dir), task = fixture();
  let modelCalls = 0, submissions = 0;
  const native = await createTools({ invoke: async () => ({ success: true, task }), readState: () => ({}), skillsRoots: () => [], config: () => ({}), mcp: {} })({});
  const tools = [{ name: 'submit_task', schema: { type: 'object', properties: {} }, execute: async () => { submissions++; return { success: true, taskId: task.id }; } }, native.find(t => t.name === 'read_task_result')];
  const call = (id, name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  const runtime = new AgentRuntime({ store, tools: async () => tools, provider: () => ({}), model: async () => {
    modelCalls++;
    if (modelCalls === 1) return call('submit-once', 'submit_task', {});
    if (modelCalls === 2) return call('result-once', 'read_task_result', { taskId: task.id });
    throw Object.assign(Error('fixture output budget exhausted'), { diagnostics: { category: 'truncated', stage: 'parse', code: 'OUTPUT_LIMIT' } });
  } });
  const session = store.create(); session.approvalMode = 'auto'; store.save(session);
  const before = JSON.stringify(task); await runtime.start(session.id, 'Run the fixture batch');
  for (let i = 0; i < 300 && runtime.active.size; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(runtime.active.size, 0);
  const saved = store.get(session.id); assert.equal(saved.status, 'failed'); assert.equal(saved.errorDetails.code, 'OUTPUT_LIMIT');
  const fallback = saved.messages.filter(m => m.source === 'platform-result'); assert.equal(fallback.length, 1);
  assert.equal(fallback[0].taskResults[0].passRatePercent, 30.77); assert.match(fallback[0].content, /无需重新提交/);
  assert.equal(saved.calls.filter(c => c.status === 'done').length, 2); assert.equal(submissions, 1); assert.equal(modelCalls, 3);
  assert.equal(JSON.stringify(task), before); assert.equal(new AgentStore(() => dir).get(session.id).messages.at(-1).source, 'platform-result');
});
test('completion event delivers counts before model reply; a later model failure cannot erase or duplicate them', async t => {
  const dir = directory(t), store = new AgentStore(() => dir), task = fixture(); task.finishedAt = new Date().toISOString();
  const snapshot = require('../electron/agent/review-events').reviewSnapshot(task);
  assert.equal(snapshot.executionReceipt.counts.success, 4);
  let rejectModel, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  let modelCalls = 0;
  const runtime = new AgentRuntime({ store, tools: async () => [], provider: () => ({}), model: async () => {
    modelCalls++; entered(); return new Promise((_resolve, reject) => { rejectModel = reject; });
  } });
  const session = store.create(); session.status = 'waiting'; session.watch = { kind: 'task', id: task.id };
  session.messages.push({ role: 'user', source: 'user', content: 'Run the fixture batch' }); store.save(session); runtime.contexts.set(session.id, {});
  runtime.notify('task', task.id, snapshot); await ready;
  const before = store.get(session.id).messages.filter(m => m.source === 'platform-result');
  assert.equal(before.length, 1); assert.equal(before[0].taskResults[0].counts.failed, 9);
  runtime.notify('task', task.id, snapshot);
  rejectModel(Object.assign(Error('later response failed'), { diagnostics: { category: 'timeout' } }));
  for (let i = 0; i < 300 && runtime.active.size; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const saved = store.get(session.id);
  assert.equal(saved.messages.filter(m => m.source === 'platform-result').length, 1); assert.equal(modelCalls, 1);
  assert.equal(saved.error, 'later response failed'); assert.equal(saved.calls.length, 0);
});
test('premature failure status cannot publish a terminal completion receipt', () => {
  const task = fixture(); task.finishedAt = new Date().toISOString(); task.cases[12].status = 'running';
  const snapshot = require('../electron/agent/review-events').reviewSnapshot(task);
  assert.equal(snapshot.status, 'running'); assert.equal(snapshot.executionReceipt, undefined);
});
test('complete failed report page is not mistaken for a one-item receipt requiring further pagination',()=>{
 const task=fixture(),receipt=taskResultReceipt(task,{limit:1});
 const make=page=>({messages:[{role:'user',content:'analyze failures'},{role:'assistant',tool_calls:[{id:'report'}]}],calls:[{name:'read_task_report',modelCallId:'report',status:'done',result:{success:true,executionReceipt:receipt,task:page}}]});
 const complete=taskResultDelivery(make({filters:{statuses:['failed']},selectionComplete:true,returnedCaseCount:9,nextOffset:null}));
 assert.match(complete.content,/完整匹配失败清单/);assert.doesNotMatch(complete.content,/还有后续分页|仅展示部分/);
 const partial=taskResultDelivery(make({filters:{statuses:['failed']},selectionComplete:false,returnedCaseCount:3,nextOffset:3}));
 assert.match(partial.content,/执行回执仅展示部分失败摘要/);assert.doesNotMatch(partial.content,/失败清单还有后续分页|已返回完整/);
 const noMarker={...receipt};delete noMarker.nextOffset;
 const s=make({});s.calls[0].result.executionReceipt=noMarker;assert.doesNotMatch(taskResultDelivery(s).content,/后续分页|仅展示部分/);
});
