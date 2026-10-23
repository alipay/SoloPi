import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { convertSoloPiCase, assertImportReviewed } = require('../electron/solopi-case-converter');
const { createWorkflowExecutionGate } = require('../electron/workflow-execution-gate');
const { createSoloPiRecording } = require('../electron/solopi-recording');
const rawStep = (actionEnum, operationParam = {}, operationNode = null) => ({ operationMethod: { actionEnum, operationParam }, operationNode });
const fixture = steps => ({ caseName: 'Settings navigation', targetAppPackage: 'org.example.settings', operationLog: { steps } });

test('SoloPi JSON object, encoded log and case-get wrapper preserve ordering with fresh identifiers', () => {
  const source = fixture([rawStep('CLICK', {}, { resourceId: 'org.example:id/open' }), rawStep('sleep', { text: '750' }), rawStep('back'), rawStep('HOME')]);
  const one = convertSoloPiCase(source);
  const two = convertSoloPiCase({ success: true, case: { ...source, operationLog: JSON.stringify(source.operationLog) } });
  assert.notEqual(one.testCase.id, two.testCase.id);
  assert.deepEqual(one.testCase.steps.map(s => s.type), ['start', 'component', 'component', 'wait', 'component', 'component', 'end']);
  assert.equal(one.testCase.steps[2].inputs.action, 'tap');
  assert.equal(one.testCase.steps[3].config.durationMs, 750);
  assert.equal(one.testCase.steps[4].inputs.action, 'back');
  assert.equal(one.testCase.defaults.phonePackage, source.targetAppPackage);
  assert.equal(one.issues.length, 0);
  assert.equal(one.addsBusinessAssertions, false);
  assertImportReviewed(one.testCase);
});
test('control flow, arbitrary scripts and XPath-only selectors stay blocked; relative clicks convert', () => {
  const result = convertSoloPiCase(fixture([rawStep('IF'), rawStep('EXECUTE_SHELL', { text: 'secret shell' }), rawStep('CLICK', {}, { xpath: '//node' }), rawStep('CLICK', { localClickPos: '.8,.5' }, { text: 'button' })]));
  assert.equal(result.operationCount, 4);
  assert.equal(result.testCase.steps.length, 7);
  assert.equal(result.issues.length, 3);
  assert.equal(JSON.stringify(result).includes('secret shell'), false);
  assert.throws(() => assertImportReviewed(result.testCase), { code: 'CASE_IMPORT_REVIEW_REQUIRED' });
});
test('input values and encrypted arguments never enter converted cases or warnings', () => {
  const source = fixture([rawStep('input', { text: 'do-not-export-this-password' }, { resourceId: 'password', text: 'do-not-export-this-password' }),
    { operationMethod: { actionEnum: 'INPUT', encrypt: true, operationParam: { text: 'encrypted-secret' } } }]);
  const result = convertSoloPiCase(source);
  assert.equal(result.issues.length, 2);
  assert.equal(JSON.stringify(result).includes('do-not-export-this-password'), false);
  assert.equal(JSON.stringify(result).includes('encrypted-secret'), false);
  assert.equal(result.testCase.steps[2].inputs.inputText, '');
});
test('malformed and oversized exports fail; advanced settings and dynamic variables use the native engine', () => {
  for (const value of ['{}', 'bad-json', fixture([]), fixture([{ operationMethod: {} }])]) assert.throws(() => convertSoloPiCase(value));
  assert.throws(() => convertSoloPiCase(' '.repeat(10 * 1024 * 1024 + 1)), /10 MiB/);
  assert.equal(convertSoloPiCase({ ...fixture([rawStep('BACK')]), advanceSettings: '{"overrideApp":true}' }).runnable, true);
  assert.equal(convertSoloPiCase(fixture([rawStep('SLEEP', { text: '${duration}' })])).runnable, true);
});
test('CLI import creates a new file only; subsequent attempts cannot overwrite it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solopi-import-'));
  try {
    const input = path.join(dir, 'old case.json'), output = path.join(dir, 'new case.json');
    fs.writeFileSync(input, JSON.stringify(fixture([rawStep('BACK')])));
    const args = ['scripts/glassbox-cli.mjs', 'cases', 'import-solopi', '--file', input, '--out', output, '--json'];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, GLASSBOX_CLI_DATA_DIR: dir } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).runnable, true);
    assert.equal(JSON.parse(fs.readFileSync(output)).steps.length, 4);
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('desktop save/reload normalization preserves source, private components, order and review barriers', () => {
  const ts = require('typescript');
  const source = fs.readFileSync(new URL('../src/lib/automationCase.ts', import.meta.url), 'utf8');
  const context = { exports: {}, require: name => name === '../../electron/workflow-failure-policy' ? require('../electron/workflow-failure-policy') : require(name) };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  const converted = convertSoloPiCase(fixture([rawStep('INPUT', { text: 'private' }, { resourceId: 'field' }), rawStep('IF'), rawStep('BACK')]));
  const reloaded = context.exports.normalizeCase(JSON.parse(JSON.stringify(converted.testCase)));
  assert.equal(reloaded.conversionSource.type, 'solopi');
  assert.equal(reloaded.components[0].id, converted.testCase.components[0].id);
  assert.deepEqual([...reloaded.steps.map(s => s.id)], converted.testCase.steps.map(s => s.id));
  assert.throws(() => assertImportReviewed(reloaded), { code: 'CASE_IMPORT_REVIEW_REQUIRED' });
});
test('actual CLI validator blocks unresolved SoloPi nodes before a task is submitted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solopi-validate-'));
  try {
    const file = path.join(dir, 'case.json');
    fs.writeFileSync(file, JSON.stringify(convertSoloPiCase(fixture([rawStep('EXECUTE_SHELL')])).testCase));
    const result = spawnSync(process.execPath, ['scripts/glassbox-cli.mjs', 'cases', 'validate', file, '--json'], { encoding: 'utf8', env: { ...process.env, GLASSBOX_CLI_DATA_DIR: dir } });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(JSON.parse(result.stdout).errors.some(message => message.includes('SoloPi 导入节点待处理')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('actual step dispatcher rejects unresolved nodes even through a direct/debug entry', async () => {
  const source = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const code = source.match(/async function executeWorkflowStep\([^]*?\n\}/)[0];
  const context = { assertImportReviewed, resolveWorkflowValue: () => assert.fail('must reject before resolving/executing config') };
  vm.createContext(context); vm.runInContext(code, context);
  const step = convertSoloPiCase(fixture([rawStep('EXECUTE_SHELL')])).testCase.steps.find(s=>s.inputs?.action==='solopi_replay');
  await assert.rejects(context.executeWorkflowStep(step, {}), { code: 'CASE_IMPORT_REVIEW_REQUIRED' });
});
test('record and import dialogs render distinct entry points without a device connection', () => {
  const ts = require('typescript');
  const source = fs.readFileSync(new URL('../src/components/SoloPiImport.tsx', import.meta.url), 'utf8');
  const loadTs = filename => {
    const loaded = { exports: {} };
    const resolve = name => name.startsWith('./') ? loadTs(path.resolve(path.dirname(filename), name + '.tsx')) : require(name);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports: loaded.exports, require: resolve });
    return loaded.exports;
  };
  const context = { exports: loadTs(path.resolve('src/components/SoloPiImport.tsx')) };
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  for (const mode of ['import', 'record']) {
    const html = renderToStaticMarkup(React.createElement(context.exports.default, { api: null, mode, phoneSerial: '', phonePackage: '', onImport() {}, onClose() {} }));
    assert.ok(html.includes(mode === 'import' ? '选择 SoloPi 导出的 JSON' : '开始录制'));
    assert.ok(html.includes('输入内容默认移除'));
    assert.ok(html.includes('aria-modal="true"'));
  }
});
function recorder(t, runner, gate = createWorkflowExecutionGate()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solopi-recorder-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const service = createSoloPiRecording({ directory: () => dir, gate, provider: { execute: async (entry, command, args) => JSON.parse((await runner('builtin', [command, ...args])).stdout) } });
  return { service, dir, gate };
}
test('recording start/stop/export use one exact owned session and exclude tests on the same device', async t => {
  let providerName; const calls = [];
  const { service, gate } = recorder(t, async (executable, args) => {
    calls.push({ executable, args });
    if (args.includes('record-start')) { providerName = args[args.indexOf('--name') + 1]; return { stdout: JSON.stringify({ success: true, sessionId: 'owned-123', state: 'recording', caseName: providerName, targetPackage: 'org.example.settings' }) }; }
    if (args.includes('record-stop')) { assert.equal(args.at(-1), 'owned-123'); return { stdout: JSON.stringify({ success: true, state: 'stopped', sessionId: 'owned-123' }) }; }
    return { stdout: JSON.stringify({ success: true, case: { ...fixture([rawStep('BACK')]), caseName: providerName } }) };
  });
  const start = await service.start({ serial: 'phone-a', name: 'my case', targetPackage: 'org.example.settings' });
  assert.throws(() => gate.acquire({ id: 'task', reservedDeviceSerials: ['phone-a'] }), { code: 'TEST_TASK_BUSY' });
  gate.acquire({ id: 'other', reservedDeviceSerials: ['phone-b'] }).release();
  const result = await service.stop(start.id);
  assert.equal(result.testCase.name, 'my case');
  assert.equal(result.testCase.defaults.phoneSerial, 'phone-a');
  assert.equal(calls[0].executable, 'builtin');
  assert.equal(calls[0].args[0], 'record-start');
  gate.acquire({ id: 'task', reservedDeviceSerials: ['phone-a'] }).release();
  await service.discard(start.id);
  assert.equal(service.current().sessions.length, 0);
  await assert.rejects(service.stop('foreign-session'), /不是 desktop/);
});
test('ambiguous startup retains a lease and recovery never stops a foreign SoloPi session', async t => {
  const calls = [];
  const { service, gate, dir } = recorder(t, async (_executable, args) => {
    calls.push(args);
    if (args.includes('record-start')) throw new Error('network interrupted');
    return { stdout: JSON.stringify({ success: true, kind: 'recording', active: true, state: 'recording', sessionId: 'foreign', caseName: 'other-user', targetPackage: 'org.other.app' }) };
  });
  await assert.rejects(service.start({ serial: 'phone-a', name: 'test', targetPackage: 'org.example.settings' }));
  const id = service.current().sessions[0].id;
  assert.throws(() => gate.acquire({ reservedDeviceSerials: ['phone-a'] }), { code: 'TEST_TASK_BUSY' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'solopi-recording.json'))).sessions[0].state, 'recovery-required');
  await service.discard(id);
  assert.equal(calls.some(args => args.includes('record-stop')), false);
  gate.acquire({ reservedDeviceSerials: ['phone-a'] }).release();
});
test('stop failure retains ownership and restart recovery reserves the device', async t => {
  const { service, dir } = recorder(t, async (_exe, args) => {
    if (args.includes('record-start')) return { stdout: JSON.stringify({ success: true, state: 'recording', sessionId: 'owned', caseName: args[args.indexOf('--name') + 1], targetPackage: 'org.example.settings' }) };
    return { stdout: '{"success":false,"error":"stop failed"}' };
  });
  const start = await service.start({ serial: 'phone', name: 'test', targetPackage: 'org.example.settings' });
  await assert.rejects(service.stop(start.id), /stop failed/);
  const gate = createWorkflowExecutionGate();
  const restored = createSoloPiRecording({ directory: () => dir, adbPath: () => 'adb', gate });
  assert.equal(restored.current().sessions[0].id, start.id);
  assert.throws(() => gate.acquire({ reservedDeviceSerials: ['phone'] }), { code: 'TEST_TASK_BUSY' });
});
test('normal shutdown requests stop only for the owned session and releases its device', async t => {
  const stopped = [];
  const { service, gate } = recorder(t, async (_exe, args) => {
    if (args.includes('record-start')) return { stdout: JSON.stringify({ success: true, state: 'recording', sessionId: 'owned-shutdown', caseName: args[args.indexOf('--name') + 1], targetPackage: 'org.example.settings' }) };
    stopped.push(args.at(-1));
    return { stdout: '{"success":true,"state":"stopped","sessionId":"owned-shutdown"}' };
  });
  await service.start({ serial: 'phone', name: 'shutdown', targetPackage: 'org.example.settings' });
  await service.stopAll();
  assert.deepEqual(stopped, ['owned-shutdown']);
  gate.acquire({ reservedDeviceSerials: ['phone'] }).release();
  await assert.rejects(service.start({ serial: 'phone', name: 'late', targetPackage: 'org.example.settings' }), /正在退出/);
});

test('builtin preflight failure releases only the owned lease without leaving a phantom recording',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-preflight-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const gate=createWorkflowExecutionGate();
 const service=createSoloPiRecording({directory:()=>dir,gate,provider:{execute:async()=>{throw Object.assign(Error('phone offline'),{notDispatched:true});}}});
 await assert.rejects(service.start({serial:'phone-fixture',name:'fixture',targetPackage:'org.example.app'}),/offline/);assert.equal(service.current().sessions.length,0);gate.acquire({reservedDeviceSerials:['phone-fixture']}).release();
});

test('converted recordings launch the recorded application before UI actions using the standard Desktop ADB component',()=>{
 const result=convertSoloPiCase(fixture([rawStep('CLICK',{}, {resourceId:'org.example:id/first'})]),{phoneSerial:'recorded-phone'});
 const [start,launch,click,end]=result.testCase.steps;
 assert.equal(start.type,'start');assert.equal(start.config.keepScreenAwake,true);assert.equal(end.type,'end');
 const component=result.testCase.components.find(c=>c.id===launch.componentId);
 assert.equal(component.kind,'adb');assert.match(component.commandTemplate,/am start -S -W.*android.intent.category.LAUNCHER/);
 assert.equal(launch.inputs.packageName,'org.example.settings');assert.equal(launch.device,'phone');
 assert.equal(click.inputs.action,'tap');assert.equal(result.testCase.defaults.phoneSerial,'recorded-phone');assert.equal(result.operationCount,1);assert.equal(result.runnable,true);
 assert.throws(()=>convertSoloPiCase({...fixture([rawStep('BACK')]),targetAppPackage:'org.example;id'}),/包名/);
});

test('command-prepared conversion keeps ordered ADB preparation and UI steps without a launcher restart', () => {
  const preparationShell = `set -e\nprintf '%s\\n' "miniapp ready"\nprintf '%s' 'second command'`;
  const converted = convertSoloPiCase(fixture([rawStep('CLICK', {}, {resourceId:'org.example:id/agree'}), rawStep('BACK')]), {
    replayStart:'current-page',preparationShell,phoneSerial:'selected-phone',
  });
  const doc = converted.testCase;
  assert.equal(converted.operationCount,2);
  assert.deepEqual(doc.steps.map(s=>s.name),['开始','进入录制起始页面','1. 点击 · org.example:id/agree','2. BACK','结束']);
  assert.equal(doc.components.some(c=>/am start -S|force-stop/.test(c.commandTemplate)),false);
  assert.equal(doc.steps[2].inputs.action,'tap');
  // Execute the production ADB parser, ensuring multiline scripts are not flattened into arguments.
  const main = fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
  const functions = main.slice(main.indexOf('function buildAdbCommandPreview('),main.indexOf('function createAudioAdbExecution('));
  const context={getAdbPath:()=>'/fixture/adb'};vm.createContext(context);vm.runInContext(functions,context);
  const command=doc.components.find(c=>c.id===doc.steps[1].componentId).commandTemplate.replace('{{serial}}','selected-phone');
  const execution=context.createAdbExecution(command);
  assert.deepEqual(Array.from(execution.args),['-s','selected-phone','shell',preparationShell]);
  const actual=spawnSync('sh',['-c',execution.args.at(-1)],{encoding:'utf8'});
  assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,'miniapp ready\nsecond command');
});
test('prepared native operation sequence disables replay restart while legacy imports keep their default', () => {
  const source={...fixture([rawStep('BACK')]),advanceSettings:'{"params":{}}'};
  const prepared=convertSoloPiCase(source,{replayStart:'current-page',preparationShell:'am start example'});
  assert.equal(prepared.executionEngine,'solopi-native');
  assert.equal(prepared.testCase.steps[1].name,'进入录制起始页面');
  assert.equal(prepared.testCase.steps[2].inputs.restartApp,'false');
  assert.equal(convertSoloPiCase(source).testCase.steps[1].inputs.restartApp,'true');
  assert.throws(()=>convertSoloPiCase(source,{replayStart:'current-page'}),/前置命令/);
});
test('prepared recording persists its exact preparation through restart recovery and conversion', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prepared-recording-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const calls=[];let started;
  const provider={execute:async(e,command)=>{
    calls.push({command,preparationShell:e.preparationShell});started=e;
    if(command==='case-get')return{success:true,case:{...fixture([rawStep('BACK')]),caseName:e.providerName,targetAppPackage:e.targetPackage}};
    return{success:true,caseName:e.providerName,targetPackage:e.targetPackage,sessionId:'owned-phone',state:command==='record-stop'?'stopped':'recording'};
  }};
  const options={directory:()=>dir,provider};
  const first=createSoloPiRecording({...options,gate:createWorkflowExecutionGate()});
  const script='am start -d "example://miniapp"\nsleep 1';
  const session=await first.start({serial:'selected-phone',targetPackage:'org.example',name:'Fragment',startMode:'command-prepared',preparationShell:script});
  assert.equal(started.preparationShell,`set -e\n${script}`);
  const recovered=createSoloPiRecording({...options,gate:createWorkflowExecutionGate()});
  assert.equal(recovered.current().sessions[0].state,'recovery-required');
  const result=await recovered.stop(session.id);
  assert.equal(result.session.finished,true);assert.equal(result.testCase.name,'Fragment');
  assert.equal(result.testCase.steps[1].name,'进入录制起始页面');
  assert.ok(result.testCase.components.find(c=>c.kind==='adb').commandTemplate.includes(`set -e\n${script}`));
  assert.equal(calls.filter(c=>c.command==='record-start').length,1);
});
test('empty preparation is rejected before acquiring a device lease or persisting a session', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bad-preparation-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const gate=createWorkflowExecutionGate();let calls=0;
  const service=createSoloPiRecording({directory:()=>dir,gate,provider:{execute:()=>{calls++;}}});
  await assert.rejects(service.start({serial:'phone',targetPackage:'org.example',name:'Fragment',startMode:'command-prepared'}),/前置命令/);
  assert.equal(calls,0);assert.deepEqual(service.current().sessions,[]);gate.acquire({reservedDeviceSerials:['phone']}).release();
});

test('workflow executes a compound preparation even when the app is absent, while isolated force-stop still skips', async () => {
  const main=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
  const start=main.indexOf('    const shellIndex =');
  const body='let result;\n'+main.slice(start,main.indexOf('    applyCommandOutputMappings(context, result, outputMappings);',start))+'\nreturn result;';
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const run=AsyncFunction('isPcCommand','execution','componentSerial','queryAndroidProcessState','runCommand','runCommandWithOptions','assertCommandResult','timeout','acceptedExitCodes','resultAssertions','onError',body);
  for(const script of ['am force-stop org.example','am force-stop org.example; am start -p org.example','set -e\nam force-stop org.example\nam start -p org.example','am force-stop org.example && am start -p org.example']){
    const calls=[];let processQueries=0;
    const result=await run(false,{command:'/fixture/adb',args:['-s','phone','shell',script]},'phone',async()=>{processQueries++;return{success:true,running:false};},
      async(_command,args)=>{calls.push(args);return{success:true,stdout:'prepared'};},async()=>{throw Error('PC execution not expected');},()=>{},30000,[0],[],'fail');
    if(script==='am force-stop org.example'){
      assert.equal(result.skipped,true);assert.equal(calls.length,0);assert.equal(processQueries,1);
    }else{
      assert.equal(result.stdout,'prepared');assert.equal(calls[0].at(-1),script);assert.equal(processQueries,0);
    }
  }
});
