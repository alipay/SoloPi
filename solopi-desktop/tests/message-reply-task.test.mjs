import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createMessageReplyTask, FIXTURE_PACKAGE } = require('../electron/message-reply-task');

function setup() {
  let persisted, run, opened, closeConfirmed = true, closed = 0, sequence = 0;
  let messages = [{id:'old',direction:'incoming',kind:'text'}];
  const session = {
    notificationStatus:async () => ({available:true,epoch:'test',sequence}),
    observe:async () => ({contactId:'friend-1',identityVerified:true,complete:true,observationId:'obs',messages}),
    send:async ({contactId,messageId,observationId}) => ({confirmed:true,contactId,messageId,observationId,contentVerified:true,outgoingId:'out'}),
    close:async () => {closed++; return {cleanupConfirmed:closeConfirmed};},
  };
  const engineStore = {load:() => persisted,save:v => {persisted=structuredClone(v);}};
  const runStore = {load:() => run,save:v => {run=structuredClone(v);}};
  const timers = {setTimeout:() => 1,clearTimeout:() => {}};
  const options = {openSession:async config => {opened=config; return session;},recoverSession:async () => ({cleanupConfirmed:closeConfirmed}),
    engineStore,runStore,timers,generate:async () => 'reply'};
  return { options,session,engineStore,runStore,opened:()=>opened,closed:()=>closed,
    failClose:()=>{closeConfirmed=false;},allowClose:()=>{closeConfirmed=true;},wake:()=>{sequence++;},add:m=>{messages=[...messages,m];} };
}
const message = {id:'new',direction:'incoming',kind:'text',text:'question?',isQuestion:true,unique:true,retracted:false,afterBaseline:true};

test('evidence stays blocked until owner cleanup is confirmed and pending is reviewed', async () => {
  const f=setup(); const calls=[];
  f.options.evidenceStore={begin:(owner,id)=>calls.push(['begin',owner,id]),complete:(owner,id)=>calls.push(['complete',owner,id]),
    list:()=>[],remove:id=>calls.push(['remove',id])};
  const task=createMessageReplyTask(f.options);
  await task.start({deviceId:'device',contactId:'friend-1'});
  const {owner,evidenceRunId}=f.opened();
  assert.match(evidenceRunId,/^[0-9a-f]{32}$/);
  assert.deepEqual(calls[0],['begin',owner,evidenceRunId]);
  assert.equal(f.runStore.load().evidenceRunId,evidenceRunId);
  assert.throws(()=>task.removeEvidence(evidenceRunId),/reply_evidence_busy/);
  f.failClose(); await task.stop();
  assert.throws(()=>task.removeEvidence(evidenceRunId),/reply_evidence_busy/);
  assert.equal(calls.some(call=>call[0]==='complete'),false);
  f.allowClose(); await task.recover();
  assert.deepEqual(calls[1],['complete',owner,evidenceRunId]);
  f.engineStore.save({pending:{id:'pending'}});
  assert.throws(()=>task.removeEvidence(evidenceRunId),/reply_evidence_busy/);
  f.engineStore.save({pending:null}); task.removeEvidence(evidenceRunId);
  assert.deepEqual(calls[2],['remove',evidenceRunId]);
});

test('a persisted evidence binding survives cleanup recovery after restart', async () => {
  const f=setup(); const calls=[];
  f.options.evidenceStore={begin:(owner,id)=>calls.push(['begin',owner,id]),complete:(owner,id)=>calls.push(['complete',owner,id]),
    list:()=>[],remove:()=>{}};
  const task=createMessageReplyTask(f.options);
  await task.start({deviceId:'device',contactId:'friend-1'});
  const saved=f.runStore.load(); f.failClose(); await task.stop();
  const restarted=createMessageReplyTask(f.options);
  f.allowClose(); assert.equal((await restarted.recover()).cleanupConfirmed,true);
  assert.deepEqual(calls[1],['complete',saved.owner,saved.evidenceRunId]);
});

test('evidence write failure retries locally after confirmed device cleanup', async () => {
  const f=setup(); let fails=true, acknowledged=0;
  f.session.close=async()=>{ f.closeCalls++; return {cleanupConfirmed:true,recoveryRecordPendingAck:true}; };
  f.closeCalls=0;
  f.options.acknowledgeCleanup=()=>{acknowledged++;return true;};
  f.options.evidenceStore={begin:()=>{},complete:()=>{if(fails) throw Error('index_unavailable');}};
  const task=createMessageReplyTask(f.options);
  await task.start({deviceId:'device',contactId:'friend-1'});
  assert.equal((await task.stop()).cleanupConfirmed,false);
  assert.equal(f.runStore.load().deviceCleanupConfirmed,true);
  assert.equal(acknowledged,0);
  fails=false;
  assert.equal((await task.recover()).cleanupConfirmed,true);
  assert.equal(f.closeCalls,1);
  assert.equal(acknowledged,1);
  assert.equal(f.runStore.load().owner,null);
});

test('restart finishes evidence cleanup without reissuing a device action', async () => {
  const f=setup(); let fails=true, acknowledged=0, recoverCalls=0;
  f.session.close=async()=>({cleanupConfirmed:true,recoveryRecordPendingAck:true});
  f.options.recoverSession=async()=>{recoverCalls++;throw Error('unexpected_device_recovery');};
  f.options.acknowledgeCleanup=()=>{acknowledged++;return true;};
  f.options.evidenceStore={begin:()=>{},complete:()=>{if(fails) throw Error('index_unavailable');}};
  const task=createMessageReplyTask(f.options);
  await task.start({deviceId:'device',contactId:'friend-1'});
  assert.equal((await task.stop()).cleanupConfirmed,false);
  fails=false;
  const restarted=createMessageReplyTask(f.options);
  assert.equal((await restarted.recover()).cleanupConfirmed,true);
  assert.equal(recoverCalls,0);
  assert.equal(acknowledged,1);
  assert.equal(f.runStore.load().owner,null);
});

test('failure to persist device cleanup keeps recovery capability for restart', async () => {
  const f=setup(); let failMarker=true, acknowledged=0, recoverCalls=0;
  const save=f.runStore.save;
  f.runStore.save=value=>{if(failMarker && value.deviceCleanupConfirmed) throw Error('disk_unavailable');save(value);};
  f.session.close=async()=>({cleanupConfirmed:true,recoveryRecordPendingAck:true});
  f.options.recoverSession=async()=>{recoverCalls++;return {cleanupConfirmed:true,recoveryRecordPendingAck:true};};
  f.options.acknowledgeCleanup=()=>{acknowledged++;return true;};
  f.options.evidenceStore={begin:()=>{},complete:()=>{}};
  const task=createMessageReplyTask(f.options);
  await task.start({deviceId:'device',contactId:'friend-1'});
  assert.equal((await task.stop()).cleanupConfirmed,false);
  assert.equal(acknowledged,0);
  assert.equal(f.runStore.load().deviceCleanupConfirmed,undefined);
  failMarker=false;
  const restarted=createMessageReplyTask(f.options);
  assert.equal((await restarted.recover()).cleanupConfirmed,true);
  assert.equal(recoverCalls,1);
  assert.equal(acknowledged,1);
});

test('restart retries idempotent acknowledgment if final run record write fails', async () => {
  const f=setup(); let failFinal=true, acknowledged=0, recoverCalls=0;
  const save=f.runStore.save;
  f.runStore.save=value=>{if(failFinal && value.owner===null) throw Error('disk_unavailable');save(value);};
  f.session.close=async()=>({cleanupConfirmed:true,recoveryRecordPendingAck:true});
  f.options.recoverSession=async()=>{recoverCalls++;throw Error('unexpected_device_recovery');};
  f.options.acknowledgeCleanup=()=>{acknowledged++;return true;};
  f.options.evidenceStore={begin:()=>{},complete:()=>{}};
  const task=createMessageReplyTask(f.options);
  await task.start({deviceId:'device',contactId:'friend-1'});
  assert.equal((await task.stop()).cleanupConfirmed,false);
  assert.equal(acknowledged,1);
  assert.equal(f.runStore.load().deviceCleanupConfirmed,true);
  failFinal=false;
  const restarted=createMessageReplyTask(f.options);
  assert.equal((await restarted.recover()).cleanupConfirmed,true);
  assert.equal(recoverCalls,0);
  assert.equal(acknowledged,2);
  assert.equal(f.runStore.load().owner,null);
});

test('simulation requires an active task and serializes device access',async()=>{
  const f=setup(), task=createMessageReplyTask(f.options); let finish, received;
  f.session.simulateArrival=options=>new Promise(resolve=>{received=options;finish=resolve;});
  await assert.rejects(task.simulateArrival(),/reply_not_running/);
  await task.start({deviceId:'device',contactId:'friend-1'});
  await assert.rejects(task.simulateArrival('__proto__'),/invalid_fixture_simulation/);
  const pending=task.simulateArrival('image');
  assert.equal(received.kind,'image');
  await assert.rejects(task.simulateArrival(),/reply_busy/);
  finish(); assert.equal((await pending).status,'running');
  await task.stop();
});
test('simulation failure pauses and cleans without retrying',async()=>{
  const f=setup(), task=createMessageReplyTask(f.options); let calls=0;
  f.session.simulateArrival=async()=>{calls++;throw Error('unknown_device_outcome');};
  await task.start({deviceId:'device',contactId:'friend-1'});
  const result=await task.simulateArrival();
  assert.equal(result.status,'paused'); assert.equal(result.reason,'fixture_simulation_failed');
  assert.equal(result.cleanupConfirmed,true); assert.equal(calls,1);
  await assert.rejects(task.simulateArrival(),/reply_not_running/);
});
test('simulation after the task deadline cleans up without a device action',async()=>{
  const f=setup();let now=0,calls=0;
  f.options.clock=()=>now;
  f.session.simulateArrival=async()=>{calls++;};
  const task=createMessageReplyTask(f.options);
  await task.start({deviceId:'device',contactId:'friend-1'});
  now=1680000;
  const result=await task.simulateArrival();
  assert.equal(result.reason,'session_duration_limit'); assert.equal(result.cleanupConfirmed,true);
  assert.equal(calls,0);
});
test('stopping an active simulation aborts it before cleanup',async()=>{
  const f=setup(), task=createMessageReplyTask(f.options); let entered=false;
  f.session.simulateArrival=({signal})=>new Promise((_resolve,reject)=>{
    entered=true; signal.addEventListener('abort',()=>reject(Error('cancelled')));
  });
  await task.start({deviceId:'device',contactId:'friend-1'});
  const simulation=task.simulateArrival(); assert.equal(entered,true);
  const stopped=task.stop(); await simulation;
  assert.equal((await stopped).cleanupConfirmed,true); assert.equal(f.closed(),1);
});

test('fixture task holds ownership, processes a wake, and confirms cleanup', async () => {
  const f=setup(), task=createMessageReplyTask(f.options);
  assert.equal((await task.start({deviceId:'device',contactId:'friend-1'})).status,'running');
  assert.equal(f.opened().appId,FIXTURE_PACKAGE);
  assert.equal(f.runStore.load().owner,f.opened().owner);
  f.add(message); f.wake(); assert.equal((await task.poll()).processed,1);
  const stopped=await task.stop(); assert.equal(stopped.cleanupConfirmed,true); assert.equal(f.closed(),1);
  assert.equal(f.runStore.load().owner,null);
});
test('unknown cleanup blocks a new task and can be recovered after restart', async () => {
  const f=setup(), task=createMessageReplyTask(f.options);
  await task.start({deviceId:'device',contactId:'friend-1'}); f.failClose();
  assert.equal((await task.stop()).cleanupConfirmed,false);
  const restarted=createMessageReplyTask(f.options);
  assert.equal(restarted.status().reason,'cleanup_recovery_required');
  assert.equal(restarted.status().cleanupConfirmed,false);
  await assert.rejects(restarted.start({deviceId:'device',contactId:'friend-1'}),/cleanup_recovery_required/);
  assert.equal((await restarted.recover()).cleanupConfirmed,false);
  f.allowClose();
  assert.equal((await restarted.recover()).reason,'stopped');
});
test('unreadable previous state is exposed as a blocked status',()=>{
  const f=setup(); f.runStore.load=()=>{throw Error('secret content');};
  const task=createMessageReplyTask(f.options);
  assert.equal(task.status().reason,'state_storage_unavailable');
  assert.equal(task.status().cleanupConfirmed,false);
  assert.equal(JSON.stringify(task.status()).includes('secret content'),false);
});
test('failed cleanup can be retried while the original session remains available',async()=>{
  const f=setup(), task=createMessageReplyTask(f.options);
  await task.start({deviceId:'device',contactId:'friend-1'}); f.failClose();
  assert.equal((await task.stop()).cleanupConfirmed,false);
  f.allowClose(); assert.equal((await task.recover()).cleanupConfirmed,true);
  assert.equal(f.closed(),2);
});
test('pending dispatch prevents starting before a device session is opened', async () => {
  const f=setup(); f.engineStore.save({pending:{id:'uncertain'}});
  const task=createMessageReplyTask(f.options);
  await assert.rejects(task.start({deviceId:'device',contactId:'friend-1'}),/send_requires_manual_review/);
  assert.equal(f.opened(),undefined);
});
test('stop during session creation cleans the created session and does not start', async () => {
  const f=setup(); let resolve;
  f.options.openSession=() => new Promise(done => {resolve=done;});
  const task=createMessageReplyTask(f.options), starting=task.start({deviceId:'device',contactId:'friend-1'});
  const stopping=task.stop(); resolve(f.session);
  await assert.rejects(starting,/reply_start_cancelled/);
  assert.equal((await stopping).cleanupConfirmed,true); assert.equal(f.closed(),1);
});
test('settings are frozen when the task opens the session', async () => {
  const f=setup(); let used;
  f.options.createGenerate=(config)=>{used=config;return async()=> 'reply';};
  const task=createMessageReplyTask(f.options);
  const config={deviceId:'device',contactId:'friend-1',role:'first'};
  await task.start(config); config.role='changed';
  assert.equal(used.role,'first'); await task.stop();
});
test('idle heartbeat observes without consuming a new message and late notification can process it', async () => {
  const f=setup(); let now=0, observations=0, sends=0;
  const observe=f.session.observe, send=f.session.send;
  f.session.observe=async()=>{observations++;return observe();};
  f.session.send=async value=>{sends++;return send(value);};
  f.options.clock=()=>now;
  const task=createMessageReplyTask(f.options);
  await task.start({deviceId:'device',contactId:'friend-1'});
  f.add(message); now=180000;
  assert.equal((await task.poll()).status,'running');
  assert.equal(observations,2);
  assert.equal(sends,0);
  f.wake(); assert.equal((await task.poll()).processed,1); assert.equal(sends,1);
  await task.stop();
});
test('duration limit pauses and releases before device hard deadline, restart resets baseline', async () => {
  const f=setup(); let now=0,sends=0;
  const send=f.session.send; f.session.send=async value=>{sends++;return send(value);};
  f.options.clock=()=>now;
  const task=createMessageReplyTask(f.options);
  await task.start({deviceId:'device',contactId:'friend-1'});
  now=1680000; f.add(message); f.wake();
  const expired=await task.poll();
  assert.equal(expired.status,'paused'); assert.equal(expired.reason,'session_duration_limit');
  assert.equal(expired.cleanupConfirmed,true); assert.equal(sends,0);
  await task.start({deviceId:'device',contactId:'friend-1'});
  await task.poll(); assert.equal(sends,0);
  await task.stop();
});
test('elapsed wall time also closes a task after the desktop sleeps',async()=>{
  const f=setup(); let monotonic=0, wall=0;
  f.options.clock=()=>monotonic; f.options.wallClock=()=>wall;
  const task=createMessageReplyTask(f.options);
  await task.start({deviceId:'device',contactId:'friend-1'});
  wall=1680000;
  assert.equal((await task.poll()).reason,'session_duration_limit');
  assert.equal(f.closed(),1);
});
test('review is blocked until stopped and cleanup confirmed, then permits only the matching pending message',async()=>{
  const f=setup(); let reviews=0,sends=0;
  f.engineStore.reviewPending=id=>{
    const value=f.engineStore.load();
    if(value?.pending?.id!==id) throw Error('pending_review_changed');
    reviews++; f.engineStore.save({...value,pending:null,seen:[...value.seen,id],history:[...value.history,{id,status:'reviewed'}]});
  };
  const task=createMessageReplyTask(f.options);
  await task.start({deviceId:'device',contactId:'friend-1'});
  assert.throws(()=>task.reviewPending('new'),/reply_already_active/);
  f.add(message); f.wake(); f.session.send=async()=>{sends++;return {confirmed:false};}; f.failClose();
  const paused=await task.poll(); assert.equal(paused.pending,true); assert.equal(paused.cleanupConfirmed,false);
  assert.throws(()=>task.reviewPending('new'),/reply_already_active/);
  f.allowClose(); await task.recover();
  assert.throws(()=>task.reviewPending('other'),/pending_review_changed/);
  assert.equal(task.reviewPending('new').pending,false);
  assert.equal(reviews,1); assert.equal(f.engineStore.load().history[0].status,'reviewed');
  await task.start({deviceId:'device',contactId:'friend-1'}); f.wake(); await task.poll();
  assert.equal(reviews,1); assert.equal(sends,1); await task.stop();
});

test('a failed later session start does not restore a reviewed pending send', async () => {
  const f = setup();
  const open = f.options.openSession; let failOpen = false;
  f.options.openSession = config => failOpen ? Promise.reject(Error('open_failed')) : open(config);
  f.engineStore.reviewPending = id => {
    const value = f.engineStore.load();
    assert.equal(value.pending.id, id);
    f.engineStore.save({...value, pending:null, seen:[...value.seen, id],
      history:[...value.history, {id, status:'reviewed'}]});
  };
  const task = createMessageReplyTask(f.options);
  await task.start({deviceId:'device', contactId:'friend-1'});
  f.add(message); f.wake(); f.session.send = async () => ({confirmed:false});
  assert.equal((await task.poll()).pending, true);
  assert.equal(task.reviewPending('new').pending, false);
  const reviewed = structuredClone(f.engineStore.load());
  failOpen = true;
  await assert.rejects(task.start({deviceId:'device', contactId:'friend-1'}), /open_failed/);
  assert.deepEqual(f.engineStore.load(), reviewed);
});

test('a failed later session start does not restore cleared history', async () => {
  const f = setup();
  const open = f.options.openSession; let failOpen = false;
  f.options.openSession = config => failOpen ? Promise.reject(Error('open_failed')) : open(config);
  const task = createMessageReplyTask(f.options);
  await task.start({deviceId:'device', contactId:'friend-1'});
  f.add(message); f.wake(); await task.poll();
  await task.stop();
  f.engineStore.save({...f.engineStore.load(), history:[]});
  const cleared = structuredClone(f.engineStore.load());
  failOpen = true;
  await assert.rejects(task.start({deviceId:'device', contactId:'friend-1'}), /open_failed/);
  assert.deepEqual(f.engineStore.load(), cleared);
});
