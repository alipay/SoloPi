import soloPiConverter from '../electron/solopi-case-converter.js';
const { assertImportReviewed } = soloPiConverter;
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { executeWorkflowAssertionStep, createAssertionTimeoutError } = require('../electron/workflow-assertion');
const { createTaskReportWriter } = require('../electron/task-report-writer');
const ts = require('typescript');
const source = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
const editor = fs.readFileSync(new URL('../src/components/WorkflowEditor.tsx', import.meta.url), 'utf8');
const extract = name => source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))[0];
const kinds = ['tts_assert', 'json_assert', 'llm_assert', 'mobile_ui_assert'];
const timeout = kind => kind === 'mobile_ui_assert'
  ? Object.assign(new Error('element deadline'), { errorCode: 'MOBILE_UI_ELEMENT_NOT_FOUND', snapshot: { elements: [] }, attempts: 3 })
  : createAssertionTimeoutError('observation deadline', 42, { lastMissReason: 'field mismatch' });
function fixture(kind, mode, blocking) {
  const ran = [], progress = [];
  const components = [{ id: 'assert', kind }];
  const context = {
    console, Date, Map, Set, Promise, crypto: { randomBytes: () => Buffer.from('test') }, cliBackgroundMode: false,
    workflowCommandScope: { run: (_id, fn) => fn() }, executeWorkflowAssertionStep,
    applyWorkflowStartConfigOverride: steps => steps, orderWorkflowStepsByEdges: steps => steps,
    getWorkflowCaseEdges: p => p.edges || [], normalizeWorkflowEdges: edges => edges,
    getWorkflowCaseComponents: list => Object.fromEntries(list.map(c => [c.id, c])),
    shouldCleanupWorkflowAudioFiles: () => false, shouldCleanupWorkflowImageFiles: () => false,
    createWorkflowRunDir: () => '/fixture', getWorkflowEvidenceOptions: () => ({}),
    initializeWorkflowLogAssertCheckpoints: async () => {},
    activeWorkflowRuntimes: new Map(), workflowCancelRequests: new Set(), logAssertStreams: new Map(),
    persistScrcpyMirrorDiagnostic: x => x, trackGlassBoxUsage() {}, isWorkflowCanceled: () => false,
    prepareWorkflowActionLogBoundary: async () => {}, updateWorkflowLogAssertCheckpointForStep() {},
    shouldApplyPostDelay: () => false, releaseOwnedLogAssertions() {}, stopLogAssertStream() {}, stopWorkflowScreenRecord() {}, stopWorkflowScreenMirror() {}, stopWorkflowLogCapture() {},
    executeWorkflowStep: async (step,runtime) => {
      if(step.id==='after') assert.equal(runtime.nodeOutputs.assert.success,true);
      ran.push(step.id);
      if (step.id === 'assert' && mode !== 'hit') throw mode === 'timeout' ? timeout(kind) : Object.assign(new Error(mode), { code: mode });
      return { stdout: 'matched evidence', meta: { retained: true } };
    },
  };
  vm.createContext(Object.assign(context, { assertImportReviewed }));
  vm.runInContext(extract('selectWorkflowNextStep') + '\n' + extract('runWorkflowCase') + '\nglobalThis.run = runWorkflowCase;', context);
  const steps = [
    { id: 'start', type: 'start', config: {} },
    { id: 'assert', type: 'component', componentId: 'assert', config: blocking === undefined ? {} : { assertBlocking: blocking } },
    { id: 'after', type: 'wait', config: {} },
    { id: 'end', type: 'end', config: {} },
  ].map(s => ({ ...s, name: s.id }));
  return { ran, progress, steps, run: (graph = true) => context.run({ testCase: { id: 'case', steps, assetBaseDir: '/fixture/assets' }, components,
    ...(graph ? { edges: steps.slice(1).map((s, i) => ({ source: steps[i].id, target: s.id })) } : {}) },
    { onProgress: p => progress.push(p.result) }) };
}
for (const kind of kinds) {
  test(`${kind}: default and explicit blocking preserve timeout failure and stop the graph`, async () => {
    for (const blocking of [undefined, true]) {
      const f = fixture(kind, 'timeout', blocking), result = await f.run();
      assert.equal(result.success, false); assert.equal(result.results.at(-1).status, 'failed');
      assert.deepEqual(f.ran, ['start', 'assert']);
    }
  });
  test(`${kind}: nonblocking timeout reaches next and end, reports observation separately`, async () => {
    for (const graph of [true, false]) {
      const f = fixture(kind, 'timeout', false), result = await f.run(graph);
      assert.equal(result.success, true); assert.deepEqual(f.ran, ['start', 'assert', 'after', 'end']);
      const node = result.results.find(r => r.stepId === 'assert');
      assert.equal(node.status, 'success'); assert.equal(node.meta.assertion.outcome, 'timeout');
      assert.equal(node.meta.assertion.passed, false); assert.equal(node.meta.assertion.blocking, false);
      assert.match(node.stdout, /超时未命中/); assert.equal(node.error, undefined);
      assert.equal(f.progress.find(r => r.stepId === 'assert' && r.status === 'success').meta.assertion.outcome, 'timeout');
    }
  });
  test(`${kind}: both modes immediately continue on a match and retain original metadata`, async () => {
    for (const blocking of [false, true]) {
      const f = fixture(kind, 'hit', blocking), result = await f.run();
      assert.equal(result.success, true); assert.deepEqual(f.ran, ['start', 'assert', 'after', 'end']);
      const meta = result.results.find(r => r.stepId === 'assert').meta;
      assert.equal(meta.retained, true); assert.equal(meta.assertion.outcome, 'matched'); assert.equal(meta.assertion.passed, true);
    }
  });
  test(`${kind}: nonblocking errors succeed in graph and linear mode while preserving evidence`, async () => {
    for (const graph of [true,false]) for (const code of ['LOG_EVIDENCE_UNAVAILABLE', 'MODEL_REQUEST_TIMEOUT', 'INVALID_REGEX', 'NEGATIVE_ASSERTION_FAILED']) {
      const f=fixture(kind,code,false), result=await f.run(graph);
      assert.equal(result.success,true);assert.deepEqual(f.ran,['start','assert','after','end']);
      const node=result.results.find(r=>r.stepId==='assert');assert.equal(node.status,'success');
      assert.equal(node.meta.assertion.errorCode,code);assert.equal(node.meta.assertion.passed,false);
      assert.equal(node.meta.assertion.ignored,true);assert.equal(node.meta.nodeOutput.success,true);
      assert.equal(f.progress.find(r=>r.stepId==='assert'&&r.status==='success').meta.assertion.errorCode,code);
    }
  });
  test(`${kind}: blocking errors and explicit cancellation still stop the workflow`,async()=>{
    for(const blocking of [true,false]) for(const code of blocking?['INVALID_REGEX','NEGATIVE_ASSERTION_FAILED','WORKFLOW_STOPPED']:['WORKFLOW_STOPPED']){
      const f=fixture(kind,code,blocking),result=await f.run();assert.equal(result.success,false);
      assert.equal(result.results.at(-1).status,code==='WORKFLOW_STOPPED'?'stopped':'failed');assert.deepEqual(f.ran,['start','assert']);
    }
  });
}
test('non-assertion timeouts still fail; legacy string false and actual timeout evidence are retained', async () => {
  const e = createAssertionTimeoutError('deadline', 12, { line: 'last observed line' });
  e.stdout = 'full evidence'; e.meta = { original: true };
  const step = { type: 'component', componentId: 'node', config: { assertBlocking: 'false' } };
  await assert.rejects(executeWorkflowAssertionStep(step, { components: { node: { kind: 'pc_command' } } }, () => Promise.reject(e)), { code: 'ASSERTION_TIMEOUT' });
  const result = await executeWorkflowAssertionStep(step, { components: { node: { kind: 'tts_assert' } } }, () => Promise.reject(e));
  assert.equal(result.meta.original, true); assert.equal(result.meta.assertion.timeoutMs, 12);
  assert.deepEqual(result.meta.assertion.diagnostics, { line: 'last observed line' }); assert.match(result.stdout, /full evidence/);
});
test('real text/json/log wait deadlines have structured codes and preserve mismatch diagnostics', async () => {
  for (const name of ['waitForTtsTextAssert', 'waitForJsonLogAssert', 'waitForLogMatch']) {
    const timers = [], stream = { waiters: new Set() };
    const context = { createAssertionTimeoutError, Number, String, Math,
      createTtsTextExtractor: () => () => null, createJsonLogAssertMatcher: () => () => null,
      createLogMatcher: () => () => false, getExplicitLogAssertIgnoreBeforeSequence: () => 0,
      prepareLogAssertStream: async () => stream, getWorkflowLogEntries: () => [], findRecentLogMatch: () => null,
      isNegativeTextAssertOperator: () => false, JSON_LOG_ASSERT_MIN_TIMEOUT_MS: 1,
      setTimeout: fn => { queueMicrotask(fn); return 1; },
      createWorkflowLogWait: (_stream, setup) => new Promise((resolve, reject) => setup(resolve, reject, w => stream.waiters.add(w))),
    };
    vm.createContext(Object.assign(context, { assertImportReviewed })); vm.runInContext(extract(name) + `\nglobalThis.wait = ${name};`, context);
    const pending = context.wait('fixture', { extractRegex: 'a', lineRegex: 'a', pattern: 'a' }, 3);
    await assert.rejects(pending, e => ['ASSERTION_TIMEOUT', 'LOG_TEXT_ASSERT_TIMEOUT'].includes(e.code) && e.timeoutMs === 3);
    assert.equal(stream.waiters.size, 0);
  }
});
test('saved report JSON retains nonblocking error evidence and final task success', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lw-optional-assert-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const f = fixture('json_assert', 'INVALID_REGEX', false), result = await f.run();
  const writer = createTaskReportWriter(), file = path.join(root, 'task.json');
  writer.schedule(file, { success: result.success, cases: [result] }); await writer.flush(file);
  const saved = JSON.parse(fs.readFileSync(file));
  assert.equal(saved.success, true); assert.equal(saved.cases[0].results[1].meta.assertion.outcome, 'error');
});
test('UI checkbox stores node config only; normalization, JSON and YAML round-trip preserve false', () => {
  const lib = fs.readFileSync(new URL('../src/lib/automationCase.ts', import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(lib, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: createRequire(new URL('../src/lib/automationCase.ts', import.meta.url)) });
  const f = fixture('tts_assert', 'timeout', false);
  const normalized = exports.normalizeCase({ schemaVersion: 'glassbox.workflow.v1', id: 'case', name: 'generic', steps: f.steps });
  assert.equal(normalized.steps[1].config.assertBlocking, false);
  assert.equal(JSON.parse(exports.automationCaseToJson(normalized)).steps[1].config.assertBlocking, false);
  const yaml = exports.automationCaseToYaml(normalized); assert.match(yaml, /assertBlocking: false/);
  assert.match(editor, /assertComponentKinds\.has\(selectedStepComponentKind\)/);
  const checkbox = editor.slice(editor.indexOf('                          是否卡点'), editor.indexOf('                          是否卡点') + 700);
  assert.match(checkbox, /updateStep\(selectedStep.id/); assert.match(checkbox, /config: \{ \.\.\.selectedStep.config, assertBlocking: event.target.checked \}/);
  assert.doesNotMatch(checkbox, /updateSelectedCaseComponent|updateStepInput/);
});
test('nonblocking LLM assertion preserves mismatch and stream errors without failing execution', async () => {
  for (const code of ['ASSERTION_TIMEOUT', 'LOG_EVIDENCE_UNAVAILABLE']) {
    let waits = 0;
    const context = { require: createRequire(new URL('../electron/main.js', import.meta.url)), Date, Number, String, Object, createAssertionTimeoutError,
      resolveWorkflowValue: v => v, getComponentSerial: () => 'fixture',
      getComponentDevice: () => 'glasses', normalizeComponentParamValue: (_p, v) => v,
      getWorkflowLogAssertCheckpoint: () => 0, resolveWorkflowLlmProvider: () => ({}),
      parseWorkflowBoolean: (v, fallback) => v === undefined ? fallback : v === true,
      waitForLogMatch: async () => { if (waits++) throw Object.assign(new Error('stream reason'), { code }); return { sequence: 1, line: 'fixture JSON' }; },
      createLlmAssertLogPayload: () => ({ parsedContent: { value: 0 } }),
      createLlmAssertRequestPayload: () => ({ currentLog: 'fixture JSON' }),
      requestWorkflowLlmAssert: async () => ({ assertion: { pass: false, reason: 'value mismatch' }, rawContent: '{}' }),
      formatLlmAssertDebugOutput: () => 'complete LLM result evidence', isLlmServiceError: () => false,
      captureWorkflowAssertScreenshot: async () => {},
    };
    vm.createContext(Object.assign(context, { assertImportReviewed })); vm.runInContext(extract('executeWorkflowStep') + '\nglobalThis.execute = executeWorkflowStep;', context);
    const step = { id: 'assert', type: 'component', componentId: 'llm', config: { assertBlocking: false }, inputs: { assertionPrompt: 'check value', lineRegex: '.+' } };
    const executionContext = { defaults: {}, components: { llm: { kind: 'llm_assert', timeoutSeconds: 10 } } };
    const pending = executeWorkflowAssertionStep(step, executionContext, () => context.execute(step, executionContext));
    if (code === 'LOG_EVIDENCE_UNAVAILABLE') {const result=await pending;assert.equal(result.success,true);assert.equal(result.meta.assertion.outcome,'error');assert.equal(result.meta.assertion.errorCode,code);assert.equal(result.meta.assertion.continued,true);}
    else { const result = await pending; assert.equal(result.meta.assertion.outcome, 'timeout'); assert.equal(result.meta.llmAssertion.reason, 'value mismatch'); assert.match(result.stdout, /complete LLM result evidence/); }
  }
});
test('actual assertion checkbox defaults on, toggles locally, saves and renders after reload', () => {
  const start = editor.indexOf("                    {selectedStep.type === 'component' && assertComponentKinds.has(selectedStepComponentKind) && (");
  const end = editor.indexOf("                    {selectedStep.type === 'if' ? (", start);
  const jsx = editor.slice(start, end).trim().slice(1, -1);
  const transpiled = ts.transpileModule(`globalThis.render = () => (${jsx});`, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const flatten = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(flatten)];
  for (const kind of kinds) {
    const selectedStep = { id: 'node', type: 'component', config: { unrelated: 'preserved' } };
    const sandbox = { exports: {}, selectedStep, selectedStepComponentKind: kind, assertComponentKinds: new Set(kinds),
      updateStep: (id, patch) => { assert.equal(id, 'node'); Object.assign(selectedStep, JSON.parse(JSON.stringify(patch))); },
      require: () => ({ jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }),
    };
    vm.createContext(Object.assign(sandbox, { assertImportReviewed })); vm.runInContext(transpiled, sandbox);
    const input = () => flatten(sandbox.render()).find(n => n.type === 'input');
    assert.equal(input().props.checked, true);
    input().props.onChange({ target: { checked: false } });
    const saved = JSON.stringify(selectedStep); Object.assign(selectedStep, JSON.parse(saved));
    assert.equal(input().props.checked, false); assert.equal(selectedStep.config.unrelated, 'preserved');
    input().props.onChange({ target: { checked: true } }); assert.equal(input().props.checked, true);
  }
});

for (const kind of kinds) {
  test(`${kind}: blocking failure overrides legacy continueOnError in graph and linear execution`, async () => {
    for (const graph of [true, false]) for (const blocking of [undefined, true, 'true']) for (const mode of ['timeout', 'INVALID_REGEX', 'NEGATIVE_ASSERTION_FAILED']) {
      const f = fixture(kind, mode, blocking);
      Object.assign(f.steps[1], { continueOnError: true, onError: 'continue' });
      const result = await f.run(graph);
      assert.equal(result.success, false);
      assert.deepEqual(f.ran, ['start', 'assert']);
      const failure = result.results.at(-1);
      assert.equal(failure.status, 'failed');
      assert.equal(failure.meta.assertion.blocking, true);
      assert.equal(failure.meta.assertion.continued, false);
      assert.equal(result.terminationReason, 'step_failed');
    }
  });
  test(`${kind}: explicitly nonblocking still continues with either legacy error setting`, async () => {
    for (const graph of [true, false]) for (const blocking of [false, 'false']) for (const continueOnError of [true, false]) {
      const f = fixture(kind, 'timeout', blocking);
      Object.assign(f.steps[1], { continueOnError, onError: continueOnError ? 'continue' : 'stop' });
      const result = await f.run(graph);
      assert.equal(result.success, true);
      assert.deepEqual(f.ran, ['start', 'assert', 'after', 'end']);
      assert.equal(result.results.find(r => r.stepId === 'assert').meta.assertion.continued, true);
    }
  });
}

test('LLM waiting-state sidebar edits only selected inputs and survives save/reload', () => {
  const marker = editor.indexOf("value={String(getStepConfigValue(selectedStep, 'waitingStates'");
  const start = editor.lastIndexOf('<textarea', marker);
  const end = editor.indexOf('/>', marker) + 2;
  assert.ok(marker > 0);
  const code = ts.transpileModule(`globalThis.render = () => (${editor.slice(start, end)});`, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const selectedStep = { id: 'selected', inputs: { assertionPrompt: 'original expectation' } };
  const sibling = { inputs: { waitingStates: '[]' } };
  const sandbox = { exports: {}, selectedStep,
    getStepConfigValue: (s, k, fallback) => s.inputs[k] ?? fallback,
    setStepConfigValue: (s, k, v) => { s.inputs[k] = v; },
    require: () => ({ jsx: (type, props) => ({ type, props }) }),
  };
  vm.createContext(sandbox); vm.runInContext(code, sandbox);
  assert.equal(sandbox.render().props.value, '[]');
  const rules = JSON.stringify([{ path: 'status', values: ['pending'] }]);
  sandbox.render().props.onChange({ target: { value: rules } });
  sandbox.selectedStep = JSON.parse(JSON.stringify(selectedStep));
  assert.equal(sandbox.render().props.value, rules);
  assert.equal(sandbox.selectedStep.inputs.assertionPrompt, 'original expectation');
  assert.equal(sibling.inputs.waitingStates, '[]');
});
test('LLM timeout editor defaults 30s and persists independent of node log timeout',()=>{
 const marker=editor.indexOf("value={String(getStepConfigValue(selectedStep, 'llmTimeoutMs'");
 const jsx=editor.slice(editor.lastIndexOf('<input',marker),editor.indexOf('/>',marker)+2);
 const code=ts.transpileModule(`globalThis.render = () => (${jsx});`,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;
 const s={exports:{},selectedStep:{timeoutMs:20000,inputs:{assertionPrompt:'unchanged'}},getStepConfigValue:(s,k,f)=>s.inputs[k]??f,setStepConfigValue:(s,k,v)=>s.inputs[k]=v,require:()=>({jsx:(type,props)=>({type,props})})};
 vm.createContext(s);vm.runInContext(code,s);assert.equal(s.render().props.value,'15000');s.render().props.onChange({target:{value:'45000'}});s.selectedStep=JSON.parse(JSON.stringify(s.selectedStep));assert.equal(s.render().props.value,'45000');assert.equal(s.selectedStep.timeoutMs,20000);assert.equal(s.selectedStep.inputs.assertionPrompt,'unchanged');
});
