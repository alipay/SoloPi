import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const helper = fs.readFileSync(new URL('../src/lib/report-detail-request.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(helper, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
vm.runInNewContext(output, { exports, setTimeout, clearTimeout });
const { createReportDetailRequests } = exports;

test('simultaneous report opens share a single read; summary polling does not retry failures', async () => {
  const loader = createReportDetailRequests();
  let calls = 0;
  const read = async () => { calls++; throw Error('missing source'); };
  const first = loader.load('task-rev1', read);
  assert.equal(loader.load('task-rev1', read), first);
  await assert.rejects(first, /missing source/);
  await assert.rejects(loader.load('task-rev1', read), /missing source/);
  assert.equal(calls, 1);
  const recovered = await loader.load('task-rev1', async () => { calls++; return { id: 'task', cases: [1] }; }, true);
  assert.equal(recovered.cases.length, 1);
  assert.equal(calls, 2);
});

test('timeout releases loading; late old responses cannot replace a manual retry', async () => {
  const loader = createReportDetailRequests(15);
  let finish;
  const first = loader.load('task', () => new Promise(resolve => { finish = resolve; }));
  assert.equal(loader.load('task', async () => 'duplicate', true), first);
  await assert.rejects(first, /读取超时/);
  assert.equal(await loader.load('task', async () => 'recovered', true), 'recovered');
  finish('stale');
  await Promise.resolve();
  // Successful payloads belong to the task store, not a second unbounded cache.
  assert.equal(await loader.load('task', async () => 'fresh'), 'fresh');
  assert.equal(await loader.load('task-new-revision', async () => 'updated'), 'updated');
});

test('real report IPC returns an actionable missing-source error and reads recovered data', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-detail-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const detailPath = path.join(root, 'detail.json');
  const source = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const handlerSource = source.slice(source.indexOf("registerApplicationHandler('workflow-report:load-task'"), source.indexOf('\nfunction getRemovedWorkflowTaskIds'));
  let handler;
  vm.runInNewContext(handlerSource, {
    registerApplicationHandler: (_, fn) => { handler = fn; }, fs,
    getRemovedWorkflowTaskIds: () => [], getVisibleTask: () => ({ reportDetailPath: detailPath }),
    getGlassBoxDataDir: () => root, getWorkflowReportDetailPath: () => detailPath,
    activeWorkflowTasks: new Map(), createWorkflowTaskRendererDetail: task => task,
    readWorkflowReportDetail: require('../electron/report-detail-reader').createReportDetailReader(),
    require: () => ({ reviewSnapshot: () => ({}) }),
  });
  const missing = await handler(null, { taskId: 'task' });
  assert.equal(missing.success, false);
  assert.equal(missing.errorCode, 'REPORT_DETAIL_NOT_FOUND');
  assert.ok(missing.error.includes(detailPath));
  assert.equal(missing.taskId, 'task');
  assert.equal(missing.reportDetailPath, detailPath);
  assert.doesNotMatch(missing.error, /清理|删除/);
  fs.writeFileSync(detailPath, '{broken');
  assert.equal((await handler(null, { taskId: 'task' })).success, false);
  fs.writeFileSync(detailPath, JSON.stringify({ id: 'task', cases: [{ caseId: 'case' }] }));
  const recovered = await handler(null, { taskId: 'task' });
  assert.equal(recovered.task.reportDetailLoaded, true);
  assert.equal(recovered.task.cases.length, 1);
  const rewrittenId = await handler(null, { taskId: 'cli-task-task' });
  assert.equal(rewrittenId.success, false);
  assert.equal(rewrittenId.error, 'REPORT_TASK_IDENTITY_MISMATCH');
});

test('report page uses a static first-load hint, hides it during background refresh, and exposes retry', () => {
  const source = fs.readFileSync(new URL('../src/components/WorkflowEditor.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('`全部 ${caseCount}`'));
  assert.ok(source.includes('/ {caseCount}{isReportDetailUnavailable'));
  assert.match(source, /reportDetailError && \([\s\S]*?role="alert"[\s\S]*?ensureAutomationTaskDetail\(selectedTask, true\)/);
  const visibility = source.match(/const isReportDetailUnavailable = [^\n]+\n\s*const isInitialReportDetailLoading = [^\n]+/)[0];
  const shouldShowHint = Function('selectedTask', 'reportDetailError', visibility + '; return isInitialReportDetailLoading;');
  assert.equal(shouldShowHint({ reportDetailLoaded: false }, ''), true);
  assert.equal(shouldShowHint({ reportDetailLoaded: false, reportDetailRetained: true }, ''), false);
  assert.equal(shouldShowHint({ reportDetailLoaded: true }, ''), false);
  assert.equal(shouldShowHint({ reportDetailLoaded: false }, 'file missing'), false);
  const hint = source.match(/\{isInitialReportDetailLoading && \(([\s\S]*?)\n\s*\)\}/)[1];
  assert.match(hint, /role="status"/);
  assert.doesNotMatch(hint, /animate-|Loader2/);
});
