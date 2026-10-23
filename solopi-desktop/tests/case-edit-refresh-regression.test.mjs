import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../electron/main.js', import.meta.url));
const { mergeCaseUpdate } = require('./case-update');
const caseEditGuard = require('./case-edit-guard');
const { createCaseLibraryWatcherManager } = require('./case-library-watcher');
const main = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
const handlersSource = main.slice(main.indexOf('const pendingCaseUpdates ='), main.indexOf("registerApplicationHandler('workflow-task:list'"));
function fixture() {
  return {
    caseLibraries: [{ id: 'library', localRevision: 'source-1' }],
    caseFolders: [{ id: 'folder', libraryId: 'library' }],
    cases: ['one', 'two'].map(id => ({ id, name: id, folderId: 'folder', variables: {}, steps: [
      { id: 'start', type: 'start', device: 'phone' },
      { id: 'end', type: 'end', device: 'phone' },
    ] })),
    caseEdges: Object.fromEntries(['one', 'two'].map(id => [id, [{ source: 'start', target: 'end' }]])),
    components: [], automationTasks: [],
  };
}
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'case-refresh-regression-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, JSON.stringify(fixture()));
  return { dir, file };
}
function broker(file) {
  const handlers = new Map(), events = [];
  let failNextWrite = false;
  const sender = { isDestroyed: () => false, send: (...args) => events.push(args) };
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const context = {
    require, caseEditGuard, mergeCaseUpdate, crypto, setTimeout, clearTimeout,
    mainWindow: { isDestroyed: () => false, webContents: sender },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    readWorkflowState: read,
    writeWorkflowState: state => {
      if (failNextWrite) { failNextWrite = false; throw new Error('fixture write failed'); }
      const temporary = `${file}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(state));
      fs.renameSync(temporary, file);
      return file;
    },
    mergeWorkflowStateForRendererSave: incoming => incoming,
    synchronizeLocalCaseLibraryWatchers() {}, getWorkflowStatePath: () => file,
  };
  vm.createContext(context);
  vm.runInContext(handlersSource, context);
  return {
    read, handlers, sender,
    failWrite() { failNextWrite = true; },
    async edit(id = 'one') {
      const previous = read(), original = previous.cases.find(c => c.id === id);
      const document = { ...original, steps: [original.steps[0], {
        id: 'terminal-condition', type: 'if', device: 'phone',
        config: { condition: '{{variables.result.type}}', equals: 'Exit' },
      }, original.steps[1]], edges: [
        { source: 'start', target: 'terminal-condition' },
        { source: 'terminal-condition', sourceHandle: 'true', target: 'end' },
        { source: 'terminal-condition', sourceHandle: 'false', target: 'end' },
      ] };
      const pending = context.updateCaseFromCli({ caseId: id, document });
      const request = events.at(-1)[1];
      const next = mergeCaseUpdate(read(), id, request.document);
      await handlers.get('workflow-state:save')({ sender }, next, request.requestId);
      return pending;
    },
    check(state, source = 'local') {
      return handlers.get('case-library:check-apply')({}, {
        libraryId: 'library', cases: state.cases, caseEdges: state.caseEdges, components: state.components, source,
      });
    },
    save(state) { return handlers.get('workflow-state:save')({ sender }, state); },
  };
}

for (const source of ['navigation', 'local', 'manual', 'pull']) {
  test(`${source}: successful CLI save, editor restart and old source refresh preserve exact saved disk content`, async t => {
    const { file } = setup(t), first = broker(file), oldSource = first.read();
    assert.equal((await first.edit()).success, true);
    const savedBytes = fs.readFileSync(file);
    // A fresh main-process handler context has no renderer dirty flag or old in-memory state.
    const restarted = broker(file), checked = restarted.check(oldSource, source);
    assert.equal(checked.success, false);
    assert.equal(checked.errorCode, 'CASE_LIBRARY_LOCAL_EDITS_CONFLICT');
    assert.deepEqual(Array.from(checked.caseIds), ['one']);
    assert.deepEqual(fs.readFileSync(file), savedBytes);
    assert(restarted.read().cases[0].steps.some(s => s.type === 'if'));
  });
}

test('a new Node process still rejects the old source using only persisted guard data', async t => {
  const { dir, file } = setup(t), app = broker(file), original = app.read();
  await app.edit();
  const sourceFile = path.join(dir, 'source.json');
  fs.writeFileSync(sourceFile, JSON.stringify(original));
  const modulePath = require.resolve('./case-edit-guard');
  const child = spawnSync(process.execPath, ['-e', `
    const fs=require('node:fs');
    const {assertLibraryApplySafe}=require(process.argv[1]);
    const state=JSON.parse(fs.readFileSync(process.argv[2]));
    const source=JSON.parse(fs.readFileSync(process.argv[3]));
    try { assertLibraryApplySafe(state,{libraryId:'library',cases:source.cases,caseEdges:source.caseEdges,components:source.components}); process.exitCode=3; }
    catch(error) { if(error.code!=='CASE_LIBRARY_LOCAL_EDITS_CONFLICT')throw error; process.stdout.write(error.code); }
  `, modulePath, file, sourceFile], { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'CASE_LIBRARY_LOCAL_EDITS_CONFLICT');
});

test('a refresh passing preflight cannot overwrite a CLI edit saved before its final write', async t => {
  const { file } = setup(t), app = broker(file), incoming = app.read();
  assert.equal(app.check(incoming).success, true);
  incoming.caseLibraries[0].localRevision = 'source-2';
  await app.edit();
  const savedBytes = fs.readFileSync(file), result = await app.save(incoming);
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'CASE_LIBRARY_LOCAL_EDITS_CONFLICT');
  assert.deepEqual(fs.readFileSync(file), savedBytes);
});

test('one conflicting case prevents partial guard acknowledgement for a multi-case library refresh', async t => {
  const { file } = setup(t), app = broker(file), oldSource = app.read();
  await app.edit('one'); await app.edit('two');
  const candidate = app.read(); candidate.cases[1] = oldSource.cases[1]; candidate.caseEdges.two = oldSource.caseEdges.two;
  const result = app.check(candidate);
  assert.equal(result.success, false);
  assert.deepEqual(Object.keys(app.read().caseEditGuards).sort(), ['one', 'two']);
});

test('disk-write failure returns a failed CLI acknowledgement and leaves both case and guards untouched', async t => {
  const { file } = setup(t), app = broker(file), bytes = fs.readFileSync(file);
  app.failWrite(); const result = await app.edit();
  assert.equal(result.success, false); assert.match(result.error, /fixture write failed/);
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal(app.read().caseEditGuards, undefined);
});

test('an edit made after source synchronization restores protection before a delayed refresh saves', async t => {
  const { file } = setup(t), app = broker(file);
  await app.edit(); const synchronized = app.read();
  assert.equal(app.check(synchronized).success, true);
  assert.deepEqual(Object.keys(app.read().caseEditGuards), []);
  const newer = app.read(); newer.cases[0].variables.latest = 'new edit';
  assert.equal((await app.save(newer)).success, true);
  synchronized.caseLibraries[0].localRevision = 'source-2';
  assert.equal((await app.save(synchronized)).errorCode, 'CASE_LIBRARY_LOCAL_EDITS_CONFLICT');
  assert.equal(app.read().cases[0].variables.latest, 'new edit');
});

test('real fs.watch atomic replacement reaches the persisted conflict check without touching saved cases', async t => {
  const { dir, file } = setup(t), app = broker(file), oldSource = app.read();
  await app.edit(); const savedBytes = fs.readFileSync(file);
  const casesDir = path.join(dir, 'cases'); fs.mkdirSync(casesDir);
  const sourceFile = path.join(casesDir, 'library.json'); fs.writeFileSync(sourceFile, JSON.stringify(oldSource));
  let manager, timeout;
  t.after(() => { clearTimeout(timeout); manager?.close(); });
  const observed = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('No file watcher event observed')), 5000);
    manager = createCaseLibraryWatcherManager({ debounceMs: 50,
      onChange: () => { try { resolve(app.check(JSON.parse(fs.readFileSync(sourceFile)), 'local')); } catch (error) { reject(error); } },
      onError: reject,
    });
  });
  manager.sync([{ libraryId: 'library', repoPath: dir, casesRoot: 'cases' }]);
  const temporary = path.join(casesDir, 'library.tmp');
  fs.writeFileSync(temporary, `${JSON.stringify(oldSource)}\n`); fs.renameSync(temporary, sourceFile);
  const result = await observed;
  assert.equal(result.success, false); assert.equal(result.errorCode, 'CASE_LIBRARY_LOCAL_EDITS_CONFLICT');
  assert.deepEqual(fs.readFileSync(file), savedBytes);
});
