import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import ts from 'typescript';
const { mergeCaseUpdate } = createRequire(import.meta.url)('../electron/case-update.js');

const fixture = () => ({
  cases: [{ id: 'one', name: 'before', steps: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }], components: [{ id: 'audio', commandTemplate: 'case command' }] }, { id: 'two', name: 'untouched' }],
  components: [{ id: 'audio', commandTemplate: 'global command' }],
  caseLibraries: [{ id: 'library' }],
  caseFolders: [{ id: 'folder', libraryId: 'library' }],
  caseEdges: { one: [{ id: 'edge', source: 's', target: 'e' }] },
  nodePositions: { one: { s: { x: 1, y: 2 } } },
});

test('create preserves scoped components, edges and positions without modifying other cases', () => {
  const state = fixture();
  const document = { case: { ...state.cases[0], id: 'new' }, edges: state.caseEdges.one, nodePositions: state.nodePositions.one };
  const next = mergeCaseUpdate(state, 'new', document, { create: true, libraryId: 'library', folderId: 'folder' });
  assert.equal(next.cases.length, 3);
  assert.equal(next.cases[2].libraryId, 'library');
  assert.equal(next.cases[2].folderId, 'folder');
  assert.equal(next.cases[2].components, document.case.components);
  assert.equal(next.caseEdges.new, document.edges);
  assert.equal(next.nodePositions.new, document.nodePositions);
  assert.equal(next.components, state.components);
  assert.equal(next.cases[0], state.cases[0]);
});

test('create rejects collisions, absent library and folders outside target library', () => {
  const state = fixture();
  const before = JSON.stringify(state);
  const doc = { ...state.cases[0], id: 'new' };
  assert.throws(() => mergeCaseUpdate(state, 'one', state.cases[0], { create: true, libraryId: 'library' }), /already exists/);
  assert.throws(() => mergeCaseUpdate(state, 'new', doc, { create: true, libraryId: 'missing' }), /library/);
  assert.throws(() => mergeCaseUpdate(state, 'new', doc, { create: true, libraryId: 'library', folderId: 'missing' }), /folder/);
  assert.equal(JSON.stringify(state), before);
});

test('single case update preserves all unrelated state, edges, positions and global components', () => {
  const state = fixture();
  const before = JSON.stringify(state);
  const result = mergeCaseUpdate(state, 'one', { id: 'one', name: 'after', components: [{ id: 'audio', commandTemplate: 'new local command' }] });
  assert.equal(result.cases[0].name, 'after');
  assert.equal(result.cases[0].components[0].commandTemplate, 'new local command');
  for (const key of ['components', 'caseFolders', 'nodePositions']) assert.equal(result[key], state[key]);
  assert.equal(result.caseEdges.one, state.caseEdges.one);
  assert.equal(result.cases[1], state.cases[1]);
  assert.equal(JSON.stringify(state), before);
});

test('cases show document can be edited and submitted with explicit edges/positions', () => {
  const state = fixture();
  const result = mergeCaseUpdate(state, 'one', { case: { ...state.cases[0], name: 'after' }, edges: [], nodePositions: {} });
  assert.deepEqual(result.caseEdges.one, []);
  assert.deepEqual(result.nodePositions.one, {});
});

test('invalid case updates fail before any mutation', () => {
  const state = fixture();
  const before = JSON.stringify(state);
  for (const patch of [{ id: 'other' }, { id: 'one', steps: [] }, { id: 'one', edges: [{ source: 'missing', target: 'e' }] }]) {
    assert.throws(() => mergeCaseUpdate(state, 'one', patch));
  }
  assert.throws(() => mergeCaseUpdate(state, 'missing', { id: 'missing' }));
  assert.equal(JSON.stringify(state), before);
});

const main = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
function broker(withWindow) {
  let state = fixture();
  const handlers = new Map();
  const events = [];
  const sender = { isDestroyed: () => false, send: (...args) => events.push(args) };
  const context = {
    require:createRequire(new URL('../electron/main.js',import.meta.url)),
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    mainWindow: withWindow ? { isDestroyed: () => false, webContents: sender } : null,
    caseEditGuard: createRequire(import.meta.url)('../electron/case-edit-guard'),
    mergeCaseUpdate, crypto, setTimeout, clearTimeout,
    readWorkflowState: () => state,
    writeWorkflowState: (next) => { state = next; return '/fixture/state.json'; },
    mergeWorkflowStateForRendererSave: (next) => next,
    synchronizeLocalCaseLibraryWatchers: () => {}, getWorkflowStatePath: () => '/fixture/state.json',
  };
  vm.createContext(context);
  vm.runInContext(main.slice(main.indexOf('const pendingCaseUpdates ='), main.indexOf("registerApplicationHandler('workflow-task:list'")), context);
  return { context, handlers, events, sender, state: () => state };
}

test('running UI updates its in-memory case and acknowledges only after main-process persistence', async () => {
  const b = broker(true);
  const document = { id: 'one', name: 'after' };
  const promise = b.context.updateCaseFromCli({ caseId: 'one', document });
  assert.equal(b.state().cases[0].name, 'before');
  const [channel, request] = b.events[0];
  assert.equal(channel, 'workflow-case:update');
  const rendererState = mergeCaseUpdate(b.state(), request.caseId, request.document);
  await b.handlers.get('workflow-state:save')({ sender: b.sender }, rendererState, request.requestId);
  assert.equal((await promise).uiUpdated, true);
  assert.equal(b.state().cases[0].name, 'after');
});

test('headless update persists without UI; dry-run performs no write', async () => {
  const b = broker(false);
  const payload = { caseId: 'one', document: { id: 'one', name: 'after' } };
  assert.equal((await b.context.updateCaseFromCli({ ...payload, dryRun: true })).success, true);
  assert.equal(b.state().cases[0].name, 'before');
  assert.equal((await b.context.updateCaseFromCli(payload)).success, true);
  assert.equal(b.state().cases[0].name, 'after');
});

test('create broker uses editor save acknowledgement and returns target location', async () => {
  const b = broker(true);
  const document = { ...fixture().cases[0], id: 'new' };
  const promise = b.context.updateCaseFromCli({ action: 'create-case', caseId: 'new', libraryId: 'library', folderId: 'folder', document });
  assert.equal(b.state().cases.length, 2);
  const request = b.events[0][1];
  const next = mergeCaseUpdate(b.state(), request.caseId, request.document, request.options);
  await b.handlers.get('workflow-state:save')({ sender: b.sender }, next, request.requestId);
  const result = await promise;
  assert.equal(result.libraryId, 'library');
  assert.equal(result.folderId, 'folder');
  assert.equal(result.uiUpdated, true);
  assert.equal(b.state().cases[2].id, 'new');
});

test('actual renderer event handler merges into current in-memory state and requests immediate save', () => {
  const source = fs.readFileSync(new URL('../src/components/WorkflowEditor.tsx', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('editor.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'handleCaseUpdate') handler = node.initializer.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  const state = fixture();
  state.cases[1].name = 'unsaved edit in another case';
  const context = {
    require:createRequire(new URL('../electron/main.js',import.meta.url)),
    mergeCaseUpdate, liveCaseStateRef: { current: state }, workflowStateHydratedRef: { current: true },
    pendingCaseUpdateRef: { current: '' }, workflowStateSaveTimerRef: { current: 7 },
    window: { clearTimeout: (id) => assert.equal(id, 7) },
    setCases: (cases) => { state.cases = cases; },
    setCaseEdges: (edges) => { state.caseEdges = edges; },
    setNodePositions: (positions) => { state.nodePositions = positions; },
    electronApi: { ipcRenderer: { invoke: () => assert.fail('Unexpected renderer failure') } },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpile(`globalThis.handle = ${handler}`), context);
  context.handle(null, { requestId: 'request', caseId: 'one', document: { id: 'one', name: 'updated by CLI' } });
  assert.equal(state.cases[0].name, 'updated by CLI');
  assert.equal(state.cases[1].name, 'unsaved edit in another case');
  assert.equal(context.pendingCaseUpdateRef.current, 'request');
  assert.match(source, /invoke\('workflow-state:save', payload, requestId\)/);
});

test('CLI update transports JSON through broker and never writes workflow state directly', async () => {
  const source = fs.readFileSync(new URL('../scripts/glassbox-cli.mjs', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('async function updateCaseWithBrokerForCli('), source.indexOf('\nfunction stopTaskWithBrokerForCli('));
  let transport;
  const context = {
    require:createRequire(new URL('../electron/main.js',import.meta.url)),
    getOption: () => '/fixture/input.json', hasFlag: () => false,
    getHeadlessElectronLaunchForCli: () => ({ command: 'fake-runtime', argsPrefix: [] }),
    readWorkflowStateForCli: () => ({ state: fixture() }), validatePayload: () => ({ success: true }),
    caseStorage: createRequire(import.meta.url)('../electron/case-storage'),
    caseGraphErrors: createRequire(import.meta.url)('../electron/agent/case-graph.js').caseGraphErrors,
    getGlassBoxCliDataDir: () => '/fixture', createHeadlessElectronEnvForCli: () => ({}),
    process: { cwd: () => '/fixture' }, path: { resolve: (v) => v, join: (...v) => v.join('/') },
    fs: {
      readFileSync: (p) => JSON.stringify(p.endsWith('ack.json') ? { success: true, caseId: 'one', uiUpdated: true } : { id: 'one', name: 'updated' }),
      mkdirSync: () => {}, mkdtempSync: () => '/fixture/request',
      writeFileSync: (_p, value) => { transport = JSON.parse(value); },
      existsSync: () => true, rmSync: () => {},
    },
    spawn: () => ({ on: () => {}, unref: () => {} }), setTimeout,
  };
  vm.createContext(context);
  vm.runInContext(fn, context);
  const result = await context.updateCaseWithBrokerForCli(['cases', 'update', 'one', '--file', '/fixture/input.json']);
  assert.equal(result.uiUpdated, true);
  assert.equal(transport.action, 'update-case');
  assert.equal(transport.document.name, 'updated');
  assert.doesNotMatch(fn, /writeWorkflowStateForCli/);
  context.getOption = (_command, flag) => ({ '--file': '/fixture/input.json', '--library': 'library', '--folder': 'folder' }[flag]);
  context.fs.readFileSync = (p) => JSON.stringify(p.endsWith('ack.json') ? { success: true, caseId: 'new', uiUpdated: true } : {
    cases: [{ ...fixture().cases[0], id: 'new' }], caseEdges: { new: fixture().caseEdges.one }, nodePositions: { new: fixture().nodePositions.one },
  });
  const created = await context.updateCaseWithBrokerForCli(['cases', 'create', '--file', '/fixture/input.json', '--library', 'library']);
  assert.equal(created.success, true);
  assert.equal(transport.action, 'create-case');
  assert.equal(transport.libraryId, 'library');
  assert.equal(transport.folderId, 'folder');
  assert.equal(transport.caseId, 'new');
  assert.deepEqual(transport.document.edges, fixture().caseEdges.one);
  assert.deepEqual(transport.document.nodePositions, fixture().nodePositions.one);
  transport = undefined;
  const cycleStep = fixture().cases[0].steps.at(-1).id;
  context.fs.readFileSync = () => JSON.stringify({ case: { ...fixture().cases[0], id: 'new' }, edges: [{source: cycleStep, target: cycleStep}] });
  const rejected = await context.updateCaseWithBrokerForCli(['cases', 'create', '--file', '/fixture/input.json', '--library', 'library']);
  assert.equal(rejected.code, 'CASE_EDGE_CYCLE');
  assert.equal(transport, undefined);
});

test('actual broker persists edit protection and rejects a later stale library refresh before writing', async () => {
  const b=broker(true); b.state().cases[0].folderId='folder';
  const original=structuredClone(b.state());
  const promise=b.context.updateCaseFromCli({caseId:'one',document:{id:'one',name:'saved CLI version'}});
  const [,request]=b.events[0];
  await b.handlers.get('workflow-state:save')({sender:b.sender},mergeCaseUpdate(b.state(),request.caseId,request.document),request.requestId);
  assert.equal((await promise).success,true);
  assert.equal(b.state().caseEditGuards.one.source,'cli');
  const checked=b.handlers.get('case-library:check-apply')({}, {libraryId:'library',cases:original.cases,caseEdges:original.caseEdges,components:original.components});
  assert.equal(checked.success,false);assert.equal(checked.errorCode,'CASE_LIBRARY_LOCAL_EDITS_CONFLICT');
  const stale={...original,caseLibraries:[{id:'library',localRevision:'old-repo-reloaded'}]};
  const rejected=await b.handlers.get('workflow-state:save')({sender:b.sender},stale);
  assert.equal(rejected.success,false);assert.equal(rejected.errorCode,'CASE_LIBRARY_LOCAL_EDITS_CONFLICT');
  assert.equal(b.state().cases[0].name,'saved CLI version');
});

test('a matching imported source acknowledges only its library guards so future source edits can refresh', async()=>{
 const b=broker(true);b.state().cases[0].folderId='folder';
 const saved=b.context.updateCaseFromCli({caseId:'one',document:{id:'one',name:'synchronized'}});const [,request]=b.events[0];
 await b.handlers.get('workflow-state:save')({sender:b.sender},mergeCaseUpdate(b.state(),request.caseId,request.document),request.requestId);await saved;
 b.state().caseEditGuards.other={libraryId:'other',digest:'unrelated'};
 const checked=b.handlers.get('case-library:check-apply')({}, {libraryId:'library',cases:b.state().cases,caseEdges:b.state().caseEdges,components:b.state().components});
 assert.equal(checked.success,true);assert.equal(b.state().caseEditGuards.one,undefined);assert(b.state().caseEditGuards.other);
 const upstream=structuredClone(b.state());upstream.caseLibraries[0].localRevision='r3';upstream.cases[0].name='new upstream';
 assert.equal((await b.handlers.get('workflow-state:save')({sender:b.sender},upstream)).success,true);assert.equal(b.state().cases[0].name,'new upstream');
});

test('case saves reject an end self-loop and multi-node cycles before changing existing state',()=>{
 const state=fixture(),before=JSON.stringify(state);
 for(const edges of [[{source:'s',target:'e'},{source:'e',target:'e'}],[{source:'s',target:'e'},{source:'e',target:'s'}]]){
  assert.throws(()=>mergeCaseUpdate(state,'one',{id:'one',edges}),e=>e.code==='CASE_EDGE_CYCLE');
  assert.throws(()=>mergeCaseUpdate(state,'new',{...state.cases[0],id:'new',edges},{create:true,libraryId:'library'}),e=>e.code==='CASE_EDGE_CYCLE');
 }
 assert.equal(JSON.stringify(state),before);
 const repaired=mergeCaseUpdate({...state,caseEdges:{one:[{source:'s',target:'e'},{source:'e',target:'e'}]}},'one',{id:'one',edges:[{source:'s',target:'e'}]});assert.equal(repaired.caseEdges.one.length,1);
});
