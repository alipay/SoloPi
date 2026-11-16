import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createHarnessControl, validateTarget, validateVirtualReport } = require('../electron/harness-control');
const { createWorkflowExecutionGate } = require('../electron/workflow-execution-gate');
const target = { platform: 'android', deviceId: 'phone', deviceKind: 'physical', appId: 'org.example.demo' };

function fixture(t, response = request => ({ success: true, data: { state: request.operation === 'disconnect' ? 'disconnected' : 'recording' } }), shared = {}) {
  const root = shared.root || fs.mkdtempSync(path.join(os.tmpdir(), 'harness-desktop-test-'));
  if (!shared.root) t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'solopi_harness'), { recursive:true });
  fs.writeFileSync(path.join(root, 'solopi_harness/desktop_control.py'), '');
  const gate = createWorkflowExecutionGate();
  const sent = [], spawned = [];
  let processHandle;
  const bridge = createHarnessControl({ sourceDirectory: () => root, artifactDirectory: () => path.join(root, 'artifacts'),
    gate, recoveryStore: shared.recoveryStore, adbPath: () => 'adb', spawnProcess(executable, args, options) {
      spawned.push({ executable, args, options });
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.stdin = new Writable({ write(buffer, _encoding, done) {
        const request = JSON.parse(buffer.toString()); sent.push(request); done();
        const result = response(request);
        if (result) queueMicrotask(() => child.stdout.write(JSON.stringify({ id: request.id, ...result }) + '\n'));
      } });
      child.kill = () => { queueMicrotask(() => child.emit('close', 0)); return true; };
      processHandle = child;
      return child;
    } });
  t.after(() => bridge.stop());
  return { bridge, sent, spawned, gate, root, child: () => processHandle };
}

test('stdio uses trusted source and argv, with no shell or renderer executable', async t => {
  const f = fixture(t);
  await f.bridge.request('connect', target);
  assert.equal(f.spawned[0].options.shell, false);
  assert.ok(f.spawned[0].args.includes('solopi_harness.desktop_control'));
  assert.equal(f.sent[0].payload.deviceId, 'phone');
  assert.equal(f.sent[0].operation, 'connect');
});

test('connected device lease blocks old desktop tasks and is released on disconnect', async t => {
  const f = fixture(t);
  await f.bridge.request('connect', target);
  assert.throws(() => f.gate.acquire({ reservedDeviceSerials: ['phone'] }), { code: 'TEST_TASK_BUSY' });
  await f.bridge.request('disconnect');
  f.gate.acquire({ reservedDeviceSerials: ['phone'] }).release();
});

test('busy device is rejected without starting a bridge process', async t => {
  const f = fixture(t);
  const owner = f.gate.acquire({ reservedDeviceSerials: ['phone'] });
  await assert.rejects(f.bridge.request('connect', target), { code: 'TEST_TASK_BUSY' });
  assert.equal(f.spawned.length, 0);
  owner.release();
});

test('failed connection releases the acquired lease', async t => {
  const f = fixture(t, () => ({ success: false, error: 'driver_not_ready' }));
  assert.equal((await f.bridge.request('connect', target)).success, false);
  f.gate.acquire({ reservedDeviceSerials: ['phone'] }).release();
});

test('a rejected second connect cannot stop or release the current recording', async t => {
  const f = fixture(t);
  await f.bridge.request('connect', target);
  await assert.rejects(f.bridge.request('connect', { ...target, deviceId: 'other' }), /disconnect_before_replay/);
  assert.equal(f.sent.length, 1);
  assert.throws(() => f.gate.acquire({ reservedDeviceSerials: ['phone'] }), { code: 'TEST_TASK_BUSY' });
  await f.bridge.request('command', { type: 'observe' });
  assert.equal(f.sent.length, 2);
});

test('concurrent actions are rejected instead of queued and stop never resends', async t => {
  const f = fixture(t, r => r.operation === 'command' ? null : { success: true, data: {} });
  await f.bridge.request('connect', target);
  const action = f.bridge.request('command', { type: 'act' });
  const rejected = assert.rejects(action, /harness_exited_outcome_unknown/);
  await assert.rejects(f.bridge.request('command', { type: 'act' }), /desktop_operation_busy/);
  await f.bridge.stop();
  await rejected;
  assert.equal(f.sent.filter(r => r.operation === 'command').length, 1);
  f.gate.acquire({ reservedDeviceSerials: ['phone'] }).release();
});

test('oversized request never enters stdin and cannot retain a lease', async t => {
  const f = fixture(t);
  await assert.rejects(f.bridge.request('replay', { config: target, requirement: 'x'.repeat(1024 * 1024) }), /too_large/);
  assert.equal(f.sent.length, 0);
  f.gate.acquire({ reservedDeviceSerials: ['phone'] }).release();
});

test('unknown operations and invalid devices are rejected', async t => {
  const f = fixture(t);
  await assert.rejects(f.bridge.request('exec', { command: 'echo test' }), /unsupported/);
  assert.throws(() => validateTarget({ ...target, deviceId: 'foo;echo bad' }), /invalid_device/);
  assert.throws(() => validateTarget({ ...target, platform: 'harmony_next' }), /physical_harmony/);
});

test('virtual session keeps its device lease until cleanup is confirmed', async t => {
  let confirmed = false;
  const f = fixture(t, r => r.operation === 'virtual_end'
    ? { success: true, data: { state: 'closed', cleanupConfirmed: confirmed } }
    : { success: true, data: { screenMode: 'virtual' } });
  await f.bridge.request('virtual_start', target, { owner: 'owner-a' });
  assert.equal((await f.bridge.stop()).error, 'virtual_owner_mismatch');
  assert.equal(f.sent.filter(r => r.operation === 'virtual_end').length, 0);
  await assert.rejects(f.bridge.request('disconnect'), /virtual_session_owned/);
  await assert.rejects(f.bridge.request('virtual_end', {}, { owner: 'owner-b' }), /virtual_owner_mismatch/);
  await f.bridge.request('virtual_end', {}, { owner: 'owner-a' });
  assert.throws(() => f.gate.acquire({ reservedDeviceSerials: ['phone'] }), { code: 'TEST_TASK_BUSY' });
  confirmed = true;
  await f.bridge.request('virtual_end', {}, { owner: 'owner-a' });
  f.gate.acquire({ reservedDeviceSerials: ['phone'] }).release();
});

test('notification status only reaches the owner of the active virtual session', async t => {
  const f = fixture(t, r => r.operation === 'virtual_notification_status'
    ? { success: true, data: { available: true, epoch: 'e', sequence: 1 } }
    : { success: true, data: {} });
  await f.bridge.request('virtual_start', target, { owner: 'owner-a' });
  await assert.rejects(f.bridge.request('virtual_notification_status', {}, { owner: 'owner-b' }), /virtual_owner_mismatch/);
  const status = await f.bridge.request('virtual_notification_status', {}, { owner: 'owner-a' });
  assert.deepEqual(status.data, { available: true, epoch: 'e', sequence: 1 });
  assert.equal(f.sent.filter(r => r.operation === 'virtual_notification_status').length, 1);
});

test('fixture reply actions remain bound to the active virtual owner', async t => {
  const f = fixture(t, () => ({ success:true, data:{} }));
  await f.bridge.request('virtual_start', target, { owner:'owner-a' });
  for (const operation of ['virtual_fixture_input', 'virtual_fixture_send']) {
    await assert.rejects(f.bridge.request(operation, {}, { owner:'owner-b' }), /virtual_owner_mismatch/);
    await f.bridge.request(operation, {}, { owner:'owner-a' });
    assert.equal(f.sent.filter(request => request.operation === operation).length, 1);
  }
});

test('trusted context binds virtual run ID while payload cannot select bridge fields', async t => {
  let reportPath;
  const f = fixture(t, r => r.operation === 'virtual_start'
    ? {success:true,data:{pendingReport:{status:'not_tested',cleanup:'pending',checkpoints:[],reportPath}}}
    : {success:true,data:{cleanupConfirmed:true}});
  const directory = path.join(f.root, 'artifacts', 'virtual-' + 'a'.repeat(32));
  fs.mkdirSync(directory, {recursive:true}); reportPath = path.join(directory, 'report.html'); fs.writeFileSync(reportPath, '');
  for (const payload of [{...target,_desktopRunId:'a'.repeat(32)}, {...target,_desktopOwnerToken:'a'.repeat(64)}])
    await assert.rejects(f.bridge.request('virtual_start', payload, {owner:'owner-a'}), /reserved_desktop_field/);
  for (const evidenceRunId of ['../other', 'A'.repeat(32), 'a'.repeat(31), 42])
    await assert.rejects(f.bridge.request('virtual_start', target, {owner:'owner-a',evidenceRunId}), /invalid_evidence_run_id/);
  await assert.rejects(f.bridge.request('virtual_observe', {}, {owner:'owner-a',evidenceRunId:'a'.repeat(32)}), /invalid_evidence_run_id/);
  await f.bridge.request('virtual_start', target, {owner:'owner-a',evidenceRunId:'a'.repeat(32)});
  assert.equal(f.sent[0].payload._desktopRunId, 'a'.repeat(32));
});

test('bound run refuses missing or mismatched report and keeps ownership for cleanup', async t => {
  let reportPath;
  const f = fixture(t, r => r.operation === 'virtual_end'
    ? {success:true,data:{cleanupConfirmed:true}}
    : {success:true,data:reportPath ? {pendingReport:{status:'not_tested',cleanup:'pending',checkpoints:[],reportPath}} : {}});
  await assert.rejects(f.bridge.request('virtual_start', target, {owner:'owner-a',evidenceRunId:'a'.repeat(32)}), /invalid_virtual_report/);
  assert.throws(() => f.gate.acquire({reservedDeviceSerials:['phone']}), {code:'TEST_TASK_BUSY'});
  await f.bridge.request('virtual_end', {}, {owner:'owner-a'});
  const directory = path.join(f.root,'artifacts','virtual-' + 'b'.repeat(32));
  fs.mkdirSync(directory,{recursive:true}); reportPath=path.join(directory,'report.html'); fs.writeFileSync(reportPath,'');
  await assert.rejects(f.bridge.request('virtual_start', target, {owner:'owner-a',evidenceRunId:'a'.repeat(32)}), /invalid_virtual_report/);
  await f.bridge.request('virtual_end', {}, {owner:'owner-a'});
});

test('losing the virtual owner process does not assert cleanup', async t => {
  const f = fixture(t, r => r.operation === 'virtual_recover'
    ? { success: false, error: 'virtual_cleanup_unconfirmed' } : { success: true, data: {} });
  await f.bridge.request('virtual_start', target, { owner: 'owner-a' });
  f.child().emit('close', 1);
  assert.throws(() => f.gate.acquire({ reservedDeviceSerials: ['phone'] }), { code: 'TEST_TASK_BUSY' });
  assert.equal((await f.bridge.request('virtual_end', {}, { owner: 'owner-a' })).success, false);
  assert.throws(() => f.gate.acquire({ reservedDeviceSerials: ['phone'] }), { code: 'TEST_TASK_BUSY' });
});

test('worker restart recovers only the same owner and never replays a physical action', async t => {
  const f = fixture(t, r => r.operation === 'virtual_recover'
    ? { success: true, data: { state:'closed', cleanupConfirmed:true, recovered:true } }
    : { success: true, data: {} });
  await f.bridge.request('virtual_start', target, { owner:'owner-a' });
  const start = f.sent[0];
  assert.match(start.payload._desktopOwnerToken, /^[0-9a-f]{64}$/);
  f.child().emit('close', 1);
  await assert.rejects(f.bridge.request('virtual_end', {}, { owner:'other' }), /virtual_owner_mismatch/);
  const result = await f.bridge.request('virtual_end', {}, { owner:'owner-a' });
  assert.equal(result.data.cleanupConfirmed, true);
  assert.equal(f.sent[1].operation, 'virtual_recover');
  assert.equal(f.sent[1].payload.ownerToken, start.payload._desktopOwnerToken);
  assert.deepEqual(f.sent.map(r=>r.operation), ['virtual_start','virtual_recover']);
  f.gate.acquire({ reservedDeviceSerials:['phone'] }).release();
});

test('failed recovery keeps its capability for a cleanup-only retry', async t => {
  let attempts=0;
  const f=fixture(t,r=>r.operation==='virtual_recover'
    ? (++attempts===1 ? {success:false,error:'virtual_cleanup_unconfirmed'}
      : {success:true,data:{cleanupConfirmed:true,recovered:true}})
    : {success:true,data:{}});
  await f.bridge.request('virtual_start',target,{owner:'owner-a'});
  f.child().emit('close',1);
  assert.equal((await f.bridge.request('virtual_end',{}, {owner:'owner-a'})).success,false);
  assert.throws(()=>f.gate.acquire({reservedDeviceSerials:['phone']}),{code:'TEST_TASK_BUSY'});
  assert.equal((await f.bridge.request('virtual_end',{}, {owner:'owner-a'})).data.cleanupConfirmed,true);
  assert.deepEqual(f.sent.map(r=>r.operation),['virtual_start','virtual_recover','virtual_recover']);
  f.gate.acquire({reservedDeviceSerials:['phone']}).release();
});

test('desktop restart recovers encrypted owner, blocks wrong owners, then removes the record', async t => {
  const {createVirtualRecoveryStore}=require('../electron/virtual-recovery-store');
  const {createCredentialStorage}=require('../electron/credential-storage');
  const responder=r=>r.operation==='virtual_recover' ? {success:true,data:{cleanupConfirmed:true,recovered:true}}
    : {success:true,data:{}};
  const first=fixture(t,responder);
  const store=createVirtualRecoveryStore({directory:()=>first.root,storage:createCredentialStorage({directory:()=>first.root,env:{LENSWIPER_CREDENTIAL_BACKEND:'file'}})});
  // Bind storage on a fresh controller, as happens when the application starts.
  const starting=fixture(t,responder,{root:first.root,recoveryStore:store});
  await starting.bridge.request('virtual_start',target,{owner:'owner-a'});
  const originalToken=starting.sent[0].payload._desktopOwnerToken;
  starting.child().emit('close',1);
  const restarted=fixture(t,responder,{root:first.root,recoveryStore:store});
  await assert.rejects(restarted.bridge.recoverVirtual('other-owner'),/virtual_recovery_unavailable/);
  const result=await restarted.bridge.recoverVirtual('owner-a');
  assert.equal(result.data.cleanupConfirmed,true);
  assert.deepEqual(restarted.sent.map(r=>r.operation),['virtual_recover']);
  assert.equal(restarted.sent[0].payload.ownerToken,originalToken);
  assert.equal(result.recoveryRecordPendingAck,true);
  assert.equal(store.load('owner-a').ownerToken,originalToken);
  assert.equal(restarted.bridge.acknowledgeVirtualCleanup('owner-a'),true);
  assert.throws(()=>store.load('owner-a'));
  restarted.gate.acquire({reservedDeviceSerials:['phone']}).release();
});

test('failure to persist a recovery capability prevents any device request', async t => {
  const f=fixture(t,undefined,{recoveryStore:{save(){throw Error('storage_unavailable');}}});
  await assert.rejects(f.bridge.request('virtual_start',target,{owner:'owner-a'}),/storage_unavailable/);
  assert.equal(f.sent.length,0);f.gate.acquire({reservedDeviceSerials:['phone']}).release();
});

test('failed virtual start retains its encrypted record until confirmed cleanup is saved', async t => {
  const records=new Set();
  const recoveryStore={save(owner){records.add(owner);},load(owner){if(!records.has(owner))throw Error('missing');return {};},remove(owner){records.delete(owner);}};
  const f=fixture(t,()=>({success:false,error:'virtual_initial_frame_unavailable',cleanupConfirmed:true}),{recoveryStore});
  const result=await f.bridge.request('virtual_start',target,{owner:'owner-a'});
  assert.equal(result.success,false);assert.equal(result.cleanupConfirmed,true);
  assert.equal(result.recoveryRecordPendingAck,true);assert.equal(records.has('owner-a'),true);
  assert.equal(f.bridge.acknowledgeVirtualCleanup('owner-a'),true);assert.equal(records.size,0);
  f.gate.acquire({reservedDeviceSerials:['phone']}).release();
});

test('failed virtual start with unknown cleanup retains its device lease', async t => {
  const f=fixture(t,()=>({success:false,error:'outcome_unknown'}));
  const result=await f.bridge.request('virtual_start',target,{owner:'owner-a'});
  assert.equal(result.cleanupPending,true);
  assert.throws(()=>f.gate.acquire({reservedDeviceSerials:['phone']}),{code:'TEST_TASK_BUSY'});
});

test('virtual request rejected before dispatch discards its unused recovery record', async t => {
  const saved=new Set();
  const f=fixture(t,undefined,{recoveryStore:{save(owner){saved.add(owner);},remove(owner){saved.delete(owner);}}});
  await assert.rejects(f.bridge.request('virtual_start',{...target,oversize:'x'.repeat(1024*1024)}, {owner:'owner-a'}),/too_large/);
  assert.equal(f.sent.length,0);assert.equal(saved.size,0);
  f.gate.acquire({reservedDeviceSerials:['phone']}).release();
});

test('confirmed device cleanup reports an encrypted-record deletion failure', async t => {
  const f=fixture(t,r=>r.operation==='virtual_end' ? {success:true,data:{cleanupConfirmed:true}}
    : {success:true,data:{}}, {recoveryStore:{save(){},load(){return {};},remove(){throw Error('cannot_remove');}}});
  await f.bridge.request('virtual_start',target,{owner:'owner-a'});
  const result=await f.bridge.request('virtual_end',{}, {owner:'owner-a'});
  assert.equal(result.data.cleanupConfirmed,true);assert.equal(result.recoveryRecordPendingAck,true);
  assert.equal(f.bridge.acknowledgeVirtualCleanup('owner-a'),false);
  f.gate.acquire({reservedDeviceSerials:['phone']}).release();
});

test('replay preserves failed Judge result and releases lease', async t => {
  const f = fixture(t, () => ({ success: true, data: { result: { status: 'failed' }, exitCode: 2 } }));
  assert.equal((await f.bridge.request('replay', { config: target, requirement: {} })).data.result.status, 'failed');
  f.gate.acquire({ reservedDeviceSerials: ['phone'] }).release();
});

test('artifact traversal cannot be exposed through reveal', async t => {
  const f = fixture(t, () => ({ success: true, data: { artifacts: os.tmpdir() } }));
  await f.bridge.request('discover');
  assert.equal(f.bridge.artifactPath(), null);
});

test('only a current-root virtual report may be opened', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solopi-report-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'solopi-report-other-'));
  t.after(() => { fs.rmSync(root, {recursive:true,force:true}); fs.rmSync(outside,{recursive:true,force:true}); });
  const name = 'virtual-' + 'a'.repeat(32);
  fs.mkdirSync(path.join(root, name)); fs.writeFileSync(path.join(root,name,'report.html'),'ok');
  assert.equal(validateVirtualReport(root,path.join(root,name,'report.html')), fs.realpathSync(path.join(root,name,'report.html')));
  fs.mkdirSync(path.join(outside,name)); fs.writeFileSync(path.join(outside,name,'report.html'),'bad');
  assert.throws(() => validateVirtualReport(root,path.join(outside,name,'report.html')), /invalid_virtual_report/);
  fs.rmSync(path.join(root,name,'report.html')); fs.symlinkSync(path.join(outside,name,'report.html'),path.join(root,name,'report.html'));
  assert.throws(() => validateVirtualReport(root,path.join(root,name,'report.html')), /invalid_virtual_report/);
});

test('pending report is accepted only inside the controller artifact root', async t => {
  let candidate;
  const f = fixture(t, request => request.operation === 'virtual_end'
    ? { success: true, data: { cleanupConfirmed: true } }
    : { success: true, data: { pendingReport: { status: 'not_tested', cleanup: 'pending', checkpoints: [], reportPath: candidate } } });
  const dir = path.join(f.root, 'artifacts', 'virtual-' + 'a'.repeat(32));
  fs.mkdirSync(dir, { recursive: true }); candidate = path.join(dir, 'report.html'); fs.writeFileSync(candidate, 'ok');
  const response = await f.bridge.request('virtual_start', target, { owner: 'owner-a' });
  assert.equal(response.data.pendingReport.reportPath, fs.realpathSync(candidate));
  await f.bridge.request('virtual_end', {}, { owner: 'owner-a' });
  candidate = path.join(os.tmpdir(), 'virtual-' + 'a'.repeat(32), 'report.html');
  await assert.rejects(f.bridge.request('virtual_start', target, { owner: 'owner-a' }));
  assert.throws(() => f.gate.acquire({ reservedDeviceSerials: ['phone'] }), { code: 'TEST_TASK_BUSY' });
  await f.bridge.request('virtual_end', {}, { owner: 'owner-a' });
});

test('new IPC channels are allowlisted and registered after main-frame sender gate', () => {
  const main = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  const preload = fs.readFileSync(new URL('../electron/preload.js', import.meta.url), 'utf8');
  assert.ok(main.indexOf('Untrusted IPC sender') < main.indexOf("require('./harness-control')"));
  for (const op of ['discover', 'connect', 'command', 'disconnect', 'replay', 'stop', 'reveal']) {
    assert.ok(preload.includes(`'harness:${op}'`));
  }
  assert.ok(preload.includes("'reply-task:simulate-image'"));
  assert.ok(main.includes("ipcMain.handle('reply-task:simulate-image', () => replyTaskResult(() => replyTask.simulateArrival('image')))"));
});
