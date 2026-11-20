'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {GroupService}=require('./group-service.cjs'),{GroupNative}=require('./group-native.cjs'),{DeviceSnapshot}=require('./device-snapshot.cjs');
const {createWorkflowExecutionGate}=require('../workflow-execution-gate');
const C='01M6JT00C77PRVBE0000C00010',D='01M6JT00C77PRVBE0000D00010';
function fixture(t,overrides={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dg104-'));let effects=0,stops=0,prepared=0;const gate=createWorkflowExecutionGate();
 const source='sha256:'+createHash('sha256').update('android:ro.serialno\0fixture-id').digest('hex');const snapshot=new DeviceSnapshot(path.join(dir,'devices'));
 snapshot.data.owner={clientId:C,epoch:1};snapshot.data.mappings[source]={deviceId:D,connectedAt:new Date().toISOString()};snapshot.save();
 const host={prepare:async()=>{prepared++;},run:async rec=>{effects++;assert.equal(rec.taskId,native.db.prepare('SELECT task_id FROM native_group_request').get().task_id);assert.equal(service.store.execution(rec.groupExecutionId).phase,'dispatching');assert.throws(()=>gate.acquire({id:'outside',reservedDeviceSerials:['private-serial']}),e=>e.code==='TEST_TASK_BUSY');return {taskId:rec.taskId,terminal:true,resourcesReleased:true,outcome:'succeeded'};},recover:async()=>null,stop:async()=>{stops++;},...overrides};
 const native=new GroupNative({directory:path.join(dir,'native'),host});const service=new GroupService({directory:path.join(dir,'groups'),clientId:C,native,gate,snapshot,discover:async()=>[{stableId:'fixture-id',serial:'private-serial'}]});
 const g=service.store.save({expectedRevision:0,name:'explicit fixture',members:[{deviceId:D,role:'phone',sourceIdentity:source}]});
 const input={groupId:g.groupId,expectedRevision:1,requestId:randomUUID(),payload:{cases:[{id:'isolated',steps:[]}]}};
 const sent=[],connector={state:{clientId:C},session:{sessionId:'isolated-session'},async call(method,route,body,token){assert.equal(token,this.session.sessionId);sent.push(structuredClone(body));return route.endsWith('registrations')?{groupId:body.groupId,currentRevision:body.revision,accepted:true}:{groupExecutionId:body.groupExecutionId,phase:body.phase,eventSeq:body.eventSeq,accepted:true};}};
 t.after(async()=>{await service.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,service,native,host,gate,input,g,sent,connector,get effects(){return effects;},get prepared(){return prepared;},get stops(){return stops;}};
}
test('native allocation, immutable snapshot, one all-member gate and durable ordered sanitized projection',async t=>{
 const f=fixture(t);const r=await f.service.run(f.input);assert.match(r.taskId,/^[0-9a-f-]{36}$/);assert.equal(r.phase,'done');assert.equal(f.effects,1);
 await f.service.publish(f.connector);assert.deepEqual(f.sent.map(x=>x.phase).filter(Boolean),['prepared','dispatching','done']);
 const text=JSON.stringify(f.sent);for(const secret of ['private-serial','sourceIdentity','sha256:','steps','payload'])assert.ok(!text.includes(secret));
 assert.deepEqual((await f.service.run(f.input)).groupExecutionId,r.groupExecutionId);assert.equal(f.effects,1);assert.equal(f.prepared,1);
 f.service.store.save({...f.g,expectedRevision:1,name:'new revision'});assert.equal(f.service.store.execution(r.groupExecutionId).groupSnapshot.revision,1);assert.equal((await f.service.run(f.input)).groupExecutionId,r.groupExecutionId);assert.equal(f.effects,1);
 const lease=f.gate.acquire({id:'free',reservedDeviceSerials:['private-serial']});lease.release();
});
test('lost report retains original identity/reservation, restart recovers receipt without second execution',async t=>{
 const f=fixture(t,{run:async()=>{throw Error('lost native result');}});await assert.rejects(f.service.run(f.input),/lost native result/);
 const before=f.native.db.prepare('SELECT * FROM native_group_request').get();const rec=f.service.store.db.prepare('SELECT body FROM group_execution').get();const r=JSON.parse(rec.body);assert.equal(r.phase,'unknown');
 await assert.rejects(f.service.run(f.input),e=>e.code==='GROUP_RECONCILIATION_REQUIRED');assert.throws(()=>f.gate.acquire({id:'other',reservedDeviceSerials:['private-serial']}));
 f.native.host.recover=async x=>({taskId:x.taskId,terminal:true,resourcesReleased:true,outcome:'failed'});assert.equal((await f.service.reconcile(r.groupExecutionId)).phase,'done');
 assert.equal(f.native.db.prepare('SELECT task_id FROM native_group_request').get().task_id,before.task_id);
});
test('cancel intent is published separately before done; stop ack never releases a running lease',async t=>{
 let resolve,started;const ready=new Promise(r=>started=r);const f=fixture(t,{run:rec=>{started(rec);return new Promise(r=>resolve=()=>r({taskId:rec.taskId,terminal:true,resourcesReleased:true,outcome:'cancelled'}));}});
 const operation=f.service.run(f.input);const rec=await ready;await f.service.stop(rec.groupExecutionId);assert.equal(f.stops,1);assert.equal(f.service.store.execution(rec.groupExecutionId).phase,'dispatching');
 assert.throws(()=>f.gate.acquire({id:'other',reservedDeviceSerials:['private-serial']}));await f.service.publish(f.connector);assert.ok(f.sent.some(r=>r.phase==='dispatching'&&r.stopRequestedAt));assert.ok(!f.sent.some(r=>r.phase==='done'));
 resolve();const done=await operation;assert.ok(done.stopRequestedAt);await f.service.publish(f.connector);assert.ok(f.sent.at(-1).stopRequestedAt);assert.equal(f.sent.at(-1).receipt.outcome,'cancelled');
});
test('unacknowledged projection replays exact bytes under renewed session and rejects owner/invalid acknowledgements',async t=>{
 const f=fixture(t);await f.service.run(f.input);let body;const call=f.connector.call;f.connector.call=async(_m,_r,b)=>{body=JSON.stringify(b);throw Error('response lost');};await assert.rejects(f.service.publish(f.connector),/response lost/);
 f.connector.session={sessionId:'renewed'};f.connector.call=async function(...a){assert.equal(JSON.stringify(a[2]),body);this.call=call;return call.apply(this,a);};await f.service.publish(f.connector);assert.equal(f.sent.length,4);
 f.connector.state.clientId=D;await assert.rejects(f.service.publish(f.connector),e=>e.code==='GROUP_OWNER_MISMATCH');
});
test('request mismatch and unsupported member cannot invoke native execution',async t=>{
 const f=fixture(t);await f.service.run(f.input);await assert.rejects(f.service.run({...f.input,payload:{changed:true}}),e=>e.code==='GROUP_EXECUTION_CONFLICT');assert.equal(f.effects,1);
 const g=f.service.store.save({expectedRevision:0,name:'unsupported',members:[{deviceId:D,role:'tablet',sourceIdentity:'explicit-source'}]});await assert.rejects(f.service.run({...f.input,requestId:randomUUID(),groupId:g.groupId}),e=>e.code==='GROUP_RUNNER_UNSUPPORTED');assert.equal(f.effects,1);
});
test('bad ack and session replacement cannot checkpoint; repeated stop preserves first intent',async t=>{
 const f=fixture(t);const ids=await f.native.prepare(f.input.requestId,f.input.payload),rec=f.service.store.prepare({...f.input,...ids});
 const first=f.service.store.requestStop(rec.groupExecutionId);f.service.store.requestStop(rec.groupExecutionId);assert.equal(f.service.store.execution(rec.groupExecutionId).stopRequestedAt,first.stopRequestedAt);
 const count=f.service.store.db.prepare('SELECT count(*) n FROM group_projection_outbox').get().n;assert.equal(count,3);
 f.connector.call=async()=>({accepted:true,groupId:randomUUID(),currentRevision:1});await assert.rejects(f.service.publish(f.connector),e=>e.code==='GROUP_RECONCILIATION_REQUIRED');assert.equal(f.service.store.db.prepare('SELECT sum(acked) n FROM group_projection_outbox').get().n,0);
 f.connector.call=async(_m,_r,b)=>{f.connector.session={sessionId:'changed'};return {accepted:true,groupId:b.groupId,currentRevision:1};};await assert.rejects(f.service.publish(f.connector),e=>e.code==='GROUP_RECONCILIATION_REQUIRED');assert.equal(f.service.store.db.prepare('SELECT sum(acked) n FROM group_projection_outbox').get().n,0);
});
test('outbox insertion failure atomically rolls back group mutation and local event',async t=>{
 const f=fixture(t),before=f.service.store.eventsSince().length;
 f.service.store.db.exec("CREATE TEMP TRIGGER reject_wire BEFORE INSERT ON group_projection_outbox BEGIN SELECT RAISE(ABORT,'wire storage failure'); END");
 assert.throws(()=>f.service.store.save({...f.g,expectedRevision:1,name:'must not save'}),/wire storage failure/);assert.equal(f.service.store.get(f.g.groupId).revision,1);assert.equal(f.service.store.eventsSince().length,before);
});
test('Desktop heartbeat publishes via Main factory with existing snapshot and survives session replacement',async t=>{
 const {DesktopConnection}=require('./desktop-service.cjs');const directory=fs.mkdtempSync(path.join(os.tmpdir(),'group-connection-'));let factory=0,published=0,closed=0;
 const connector={state:{clientId:C},session:{sessionId:'first',heartbeatIntervalSec:300},status:()=>({phase:'approved'}),heartbeat:async()=>({}),close(){}};
 const connection=new DesktopConnection({directory,version:'isolated',discoverDevices:async()=>[],makeConnector:()=>connector,groupServiceFactory:o=>{factory++;assert.equal(o.snapshot,connection.deviceReporter);assert.equal(o.clientId,C);return{async publish(c){assert.equal(c,connector);published++;},async close(){closed++;}};}});
 t.after(async()=>{await connection.close();assert.equal(closed,1);fs.rmSync(directory,{recursive:true,force:true});});
 connection.settings.config={serverUrl:'https://isolated',orgKey:'o',projectKey:'p'};connection.settings.enabled=true;connection.deviceReporter={};await connection.tick();assert.equal(connection.snapshot().groups.status,'reported');clearTimeout(connection.timer);connector.session={sessionId:'second',heartbeatIntervalSec:300};await connection.tick();assert.equal(factory,1);assert.equal(published,2);
});
test('historical events without frozen wire bytes fail closed and close construction handles',()=>{
 const {DeviceGroupStore}=require('./device-groups.cjs');const directory=fs.mkdtempSync(path.join(os.tmpdir(),'group-legacy-'));let closed=0;
 try{const store=new DeviceGroupStore({directory,clientId:C});store.save({expectedRevision:0,name:'legacy',members:[{deviceId:D,role:'phone',sourceIdentity:'local-private'}]});store.db.exec('DELETE FROM group_projection_outbox');store.close();
 assert.throws(()=>new GroupService({directory,clientId:C,native:{close(){closed++;}},gate:createWorkflowExecutionGate()}),e=>e.code==='GROUP_RECONCILIATION_REQUIRED');assert.equal(closed,1);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
