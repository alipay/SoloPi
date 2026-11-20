import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const visibility = createRequire(import.meta.url)('../electron/task-visibility');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'task-visibility-')));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const directory = name => { const dir = path.join(root, name); fs.mkdirSync(dir); return dir; };
test('isolated execution fails before submission against an old UI', () => {
  const source = directory('old-source'), ui = directory('old-ui');
  assert.throws(() => visibility.assertTaskVisibility(source, ui), { code: 'TASK_UI_VISIBILITY_UNAVAILABLE' });
  assert.equal(fs.existsSync(path.join(ui, 'external-tasks')), false);
  assert.equal(visibility.assertTaskVisibility(ui, ui).mode, 'shared');
});
test('submitted, running, stopping and terminal tasks share identity, details and survive restart', () => {
  const source = directory('source'), ui = directory('ui'); visibility.enableTaskVisibility(ui);
  fs.writeFileSync(path.join(ui, 'workflow-editor-state.json'), '{"cases":[{"id":"keep"}]}');
  for (const status of ['submitted', 'running', 'stopping', 'stopped']) {
    visibility.publishVisibleTask(source, { id: 'single-task', source: 'cli', status, updatedAt: new Date().toISOString(), cases: [{ caseId: 'fixture', status }], reportPackagePath: '/fixture/report.glassreport' }, ui);
    const tasks = visibility.readVisibleTasks(ui);
    assert.equal(tasks.length, 1); assert.equal(tasks[0].id, 'single-task'); assert.equal(tasks[0].status, status);
    assert.equal(tasks[0].cases[0].status, status); assert.equal(tasks[0].externalSource.dataDir, source);
    assert.equal(JSON.parse(fs.readFileSync(tasks[0].reportDetailPath)).status, status);
  }
  assert.equal(visibility.getVisibleTask(ui, 'single-task').reportPackagePath, '/fixture/report.glassreport');
  assert.equal(fs.readFileSync(path.join(ui, 'workflow-editor-state.json'), 'utf8'), '{"cases":[{"id":"keep"}]}');
  fs.rmSync(source, { recursive: true }); // Restart/read does not require the source to remain present.
  assert.equal(visibility.readVisibleTasks(ui)[0].status, 'stopped');
  assert.equal(visibility.deleteVisibleTask(ui, 'single-task'), true); assert.deepEqual(visibility.readVisibleTasks(ui), []);
});
test('registered historical sources become visible without rerun or manual report import', () => {
  const source = directory('history'), ui = directory('history-ui'); visibility.enableTaskVisibility(ui);
  const task = { id: 'history-task', status: 'success', updatedAt: '2026-09-18T00:00:00Z', total: 10, completed: 10, cases: [{ status: 'success' }] };
  fs.writeFileSync(path.join(source, 'workflow-editor-state.json'), JSON.stringify({ automationTasks: [task] }));
  visibility.registerTaskSource(source, ui);
  assert.equal(visibility.readVisibleTasks(ui)[0].completed, 10);
  visibility.deleteVisibleTask(ui, task.id);
  assert.deepEqual(visibility.readVisibleTasks(ui), []); // Deleted history cannot reappear on the next refresh.
});
test('running tasks cannot be deleted and IDs cannot silently switch owners', () => {
  const ui = directory('conflict-ui'), a = directory('a'), b = directory('b'); visibility.enableTaskVisibility(ui);
  visibility.publishVisibleTask(a, { id: 'same', status: 'running' }, ui);
  assert.throws(() => visibility.deleteVisibleTask(ui, 'same'), /先停止/);
  assert.throws(() => visibility.publishVisibleTask(b, { id: 'same', status: 'running' }, ui), /TASK_ID_SOURCE_CONFLICT/);
});
test('renderer saves cannot copy external records into the local task authority', () => {
  const { mergeWorkflowStateForRendererSave } = createRequire(import.meta.url)('../electron/workflow-task-sync');
  const result = mergeWorkflowStateForRendererSave({ automationTasks: [{ id: 'external', status: 'running', externalSource: { dataDir: '/isolated' } }, { id: 'local', status: 'success' }] }, {});
  assert.deepEqual(result.automationTasks.map(task => task.id), ['local']);
});
test('UI task-list IPC recovers isolated records even when its incremental cursor is newer', async () => {
  const ui = directory('ipc-ui'), source = directory('ipc-source'); visibility.enableTaskVisibility(ui);
  visibility.publishVisibleTask(source, { id: 'ipc-task', status: 'running', updatedAt: '2026-09-18T00:00:00Z', cases: [{ status: 'running' }] }, ui);
  const requireDevelopmentVisible=createRequire(import.meta.url)('../electron/development-tasks').visibleTasks;
  const main = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const start = main.indexOf("registerApplicationHandler('workflow-task:list', ");
  const callback = main.slice(start + "registerApplicationHandler('workflow-task:list', ".length, main.indexOf('\n});', start) + 2);
  const dependencies = {
    require:()=>({visibleTasks:requireDevelopmentVisible}),
    readPersistedTaskSummaries: async () => [{ id: 'local', status: 'success', updatedAt: '2026-09-17T00:00:00Z' }],
    readWorkflowState: () => ({ automationTasks: [{ id: 'local', status: 'success', updatedAt: '2026-09-17T00:00:00Z' }] }),
    reconcileHistoricalWorkflowTasksOnce: async state => state,
    readVisibleTasks: visibility.readVisibleTasks, getGlassBoxDataDir: () => ui,
    activeWorkflowTasks: new Map(), createWorkflowReportSummary: task => ({ ...task, cases: undefined, reportDetailLoaded: false }),
    getWorkflowTaskUpdatedAtMs: task => Date.parse(task.updatedAt), fs,
    getSafeAppUpdateErrorMessage: error => error.message,
    getRemovedWorkflowTaskIds:()=>visibility.readRemovedTaskIds(ui),
  };
  const handler = Function(...Object.keys(dependencies), 'return (' + callback + ')')(...Object.values(dependencies));
  const response = await handler(null, { since: '2026-09-19T00:00:00Z' });
  assert.equal(response.success, true); assert.equal(response.tasks.length, 1);
  assert.equal(response.tasks[0].id, 'ipc-task'); assert.equal(response.tasks[0].cases, undefined); assert.equal(response.tasks[0].status, 'running');
});
test('main task-list includes active development tasks without deleting their identity',async()=>{
 const ui=directory('dev-ipc-ui'),devTask={id:'old-development',status:'failed',executionProvenance:{mode:'development'},updatedAt:'2026-10-01T00:00:00Z'};
 const main=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8'),a=main.indexOf("registerApplicationHandler('workflow-task:list', "),callback=main.slice(a+"registerApplicationHandler('workflow-task:list', ".length,main.indexOf('\n});',a)+2);
 const dev=createRequire(import.meta.url)('../electron/development-tasks');
 const deps={require:()=>dev,readPersistedTaskSummaries:async()=>[devTask],readWorkflowState:()=>({automationTasks:[devTask]}),reconcileHistoricalWorkflowTasksOnce:async s=>s,readVisibleTasks:()=>[],getGlassBoxDataDir:()=>ui,activeWorkflowTasks:new Map([['active-dev',{task:{...devTask,id:'active-dev',status:'running'}}]]),createWorkflowReportSummary:t=>t,getWorkflowTaskUpdatedAtMs:t=>t.id==='active-dev'?Date.now():0,getRemovedWorkflowTaskIds:()=>[],getSafeAppUpdateErrorMessage:e=>e.message};
 const handler=Function(...Object.keys(deps),'return ('+callback+')')(...Object.values(deps)),result=await handler(null,{since:'2026-10-15T00:00:00Z'});
 assert.equal(result.success,true);assert.deepEqual(result.tasks.map(t=>t.id),['active-dev']);assert.deepEqual(result.removedTaskIds,[]);
});

test('fresh installs and existing brands use the same UI directory resolver on all platforms',()=>{
 const {defaultDataDirectory}=createRequire(import.meta.url)('../electron/product-identity');
 for(const platform of ['darwin','linux','win32'])for(const brand of [null,'Glass Box','solopi-harness-desktop']){
  const home=directory('identity-'+platform+'-'+(brand||'new'));const appData=platform==='darwin'?path.join(home,'Library','Application Support'):platform==='win32'?path.join(home,'AppData','Roaming'):path.join(home,'.config');fs.mkdirSync(appData,{recursive:true});if(brand)fs.mkdirSync(path.join(appData,brand));
  const ui=defaultDataDirectory(appData);visibility.enableTaskVisibility(ui);
  const resolved=visibility.defaultUiDataDir({platform,home,env:{}});assert.equal(resolved,ui);assert.equal(visibility.assertTaskVisibility(ui,resolved).mode,'shared');
  if(!brand)assert.equal(fs.existsSync(path.join(appData,'Glass Box')),false);
 }
});
test('explicit UI owner remains authoritative for isolated background tasks',()=>{
 const owner=directory('explicit-ui'),source=directory('explicit-source');visibility.enableTaskVisibility(owner);
 const resolved=visibility.defaultUiDataDir({platform:'linux',home:root,env:{LENSWIPER_TASK_UI_DATA_DIR:owner,XDG_CONFIG_HOME:directory('elsewhere')}});
 assert.equal(resolved,owner);assert.equal(visibility.assertTaskVisibility(source,resolved).mode,'indexed');visibility.publishVisibleTask(source,{id:'isolated-explicit-owner',status:'success'},resolved);assert.equal(visibility.readVisibleTasks(owner)[0].id,'isolated-explicit-owner');
});
test('foreground task persistence and publishing target the current UI rather than the default owner',()=>{
 const main=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');
 const fn=main.slice(main.indexOf('function getWorkflowTaskUiDataDir()'),main.indexOf('function getGlassBoxCliModulePath()'));
 for(const background of [true,false]){const resolve=new Function('cliBackgroundMode','defaultUiDataDir','getGlassBoxDataDir',fn+';return getWorkflowTaskUiDataDir;')(background,()=>'/owner-ui',()=>'/current-custom-ui');assert.equal(resolve(),background?'/owner-ui':'/current-custom-ui');}
 assert.match(main,/assertTaskVisibility\(getGlassBoxDataDir\(\), getWorkflowTaskUiDataDir\(\)\)/);
 assert.match(main,/publishVisibleTask\(getGlassBoxDataDir\(\), \{ \.\.\.summary, reportDetailPath: detailPath \}, getWorkflowTaskUiDataDir\(\)\)/);
});
