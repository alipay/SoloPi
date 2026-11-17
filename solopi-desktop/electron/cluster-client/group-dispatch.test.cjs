'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {GroupDispatchConsumer}=require('./group-dispatch.cjs');
const {GroupService}=require('./group-service.cjs'),{GroupNative}=require('./group-native.cjs'),{DeviceSnapshot}=require('./device-snapshot.cjs');
const {createWorkflowExecutionGate}=require('../workflow-execution-gate');
const C='01M6JT00C77PRVBE0000C00010',D='01M6JT00C77PRVBE0000D00010',context={clientId:C,epoch:7};
const canon=v=>JSON.stringify(v,(_k,x)=>x&&Object.getPrototypeOf(x)===Object.prototype?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const sha=v=>createHash('sha256').update(v).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(t,{host:over={},authorize=()=>true,checkpoint=()=>{}}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dg110-'));let effects=0,prepares=0,stops=0,service,consumer;const stopIds=[];
 const source='sha256:'+sha('android:ro.serialno\0fixture-id'),snapshot=new DeviceSnapshot(path.join(dir,'devices'));
 snapshot.data.owner={clientId:C,epoch:1};snapshot.data.mappings[source]={deviceId:D,connectedAt:new Date().toISOString()};snapshot.save();
 const gate=createWorkflowExecutionGate(),host={prepare:async()=>{prepares++;},run:async rec=>{effects++;return{taskId:rec.taskId,terminal:true,resourcesReleased:true,outcome:'succeeded'};},recover:async()=>null,stop:async rec=>{stops++;stopIds.push(rec.groupExecutionId);},...over};
 const native=new GroupNative({directory:path.join(dir,'native'),host});
 service=new GroupService({directory:path.join(dir,'groups'),clientId:C,native,gate,snapshot,discover:async()=>[{stableId:'fixture-id',serial:'fixture-serial'}]});
 const g=service.store.save({expectedRevision:0,name:'fixture',members:[{deviceId:D,role:'phone',sourceIdentity:source}]});
 const make=()=>{const payload={cases:[{id:'fixture',steps:[]}]},v={clientId:C,dispatchId:randomUUID(),requestId:randomUUID(),groupId:g.groupId,expectedRevision:1,payload,payloadSha256:sha(canon(payload)),payloadBytes:Buffer.byteLength(canon(payload)),memberSha256:sha(canon([{deviceId:D,role:'phone'}]))};return{...v,dispatchPlanSha256:sha(canon({groupId:v.groupId,expectedRevision:1,requestId:v.requestId,payload}))};};
 const start=opts=>consumer=new GroupDispatchConsumer({directory:path.join(dir,'inbox'),clientId:C,service,authorize,checkpoint,...opts});start();
 const event=(v,seq=1,type='group.dispatch.requested')=>({stream:'client:'+C,epoch:7,seq,type,data:v});
 const item=(v,n=1)=>({...v,status:'requested',createdAtMs:n,cancelRequestedAt:v.cancelRequestedAt||null,clientWire:{groupId:v.groupId,requestId:v.requestId,expectedRevision:v.expectedRevision,payload:v.payload,payloadSha256:v.payloadSha256,payloadBytes:v.payloadBytes,dispatchPlanSha256:v.dispatchPlanSha256,...(v.cancelRequestedAt?{cancelRequestedAt:v.cancelRequestedAt}:{})}});
 const sync=async vs=>consumer.reconcilePending(async()=>({items:vs.map((v,i)=>item(v,i)),nextCursor:null}),context);
 t.after(async()=>{await consumer.close();await service.close();fs.rmSync(dir,{recursive:true,force:true});});
 return{dir,service,native,gate,host,g,make,event,item,sync,start,stopIds,get consumer(){return consumer;},get effects(){return effects;},get prepares(){return prepares;},get stops(){return stops;}};
}
const cancel=v=>({clientId:C,dispatchId:v.dispatchId,requestId:v.requestId,cancelRequestedAt:'2026-11-07T00:00:00Z'});
test('durable inbox/cursor atomicity; duplicate receipt and request digest conflict',async t=>{
 const f=fixture(t),v=f.make();f.consumer.db.exec("CREATE TEMP TRIGGER fail_cursor BEFORE INSERT ON dispatch_cursor BEGIN SELECT RAISE(ABORT,'cursor failure'); END");
 await assert.rejects(f.consumer.ingest(f.event(v),context),/cursor failure/);assert.equal(f.consumer.row(v.requestId),null);assert.equal(f.consumer.db.prepare('SELECT count(*) n FROM dispatch_event').get().n,0);
 f.consumer.db.exec('DROP TRIGGER fail_cursor');await f.consumer.ingest(f.event(v),context);assert.equal(f.consumer.cursor(7).seq,1);assert.equal((await f.consumer.ingest(f.event(v),context)).duplicate,true);
 await assert.rejects(f.consumer.ingest(f.event({...v,payloadBytes:1},2),context),e=>e.code==='GROUP_EXECUTION_CONFLICT');assert.equal(f.consumer.cursor(7).seq,1);assert.equal(f.prepares,0);
});
test('cancel before request or prepare persists through reopen and prevents identity allocation',async t=>{
 const f=fixture(t),v=f.make();await f.consumer.ingest(f.event(cancel(v),1,'group.dispatch.cancel-requested'),context);await f.consumer.close();f.start();await f.consumer.ingest(f.event(v,2),context);await f.sync([v]);
 await assert.rejects(f.consumer.execute(v.requestId,context),e=>e.code==='GROUP_STOP_REQUESTED');assert.equal(f.prepares,0);assert.equal(f.native.db.prepare('SELECT count(*) n FROM native_group_request').get().n,0);assert.ok(f.consumer.row(v.requestId).cancel_at);
});
test('prepare window cancel binds real identity then stops before all-member gate and native execute',async t=>{
 const entered=deferred(),resume=deferred(),f=fixture(t,{host:{prepare:async()=>{entered.resolve();await resume.promise;}}}),v=f.make();await f.sync([v]);const running=f.consumer.execute(v.requestId,context);await entered.promise;
 await f.consumer.ingest(f.event(cancel(v),1,'group.dispatch.cancel-requested'),context);assert.ok(f.consumer.row(v.requestId).cancel_at);resume.resolve();await assert.rejects(running,e=>e.code==='GROUP_STOP_REQUESTED');
 const row=f.consumer.row(v.requestId),rec=f.service.request(v.requestId);assert.equal(row.task_id,rec.taskId);assert.equal(row.execution_id,rec.groupExecutionId);assert.equal(rec.phase,'prepared');assert.ok(rec.stopRequestedAt);assert.equal(f.effects,0);assert.equal(f.stops,1);assert.equal(f.service.store.db.prepare('SELECT count(*) n FROM group_reservation').get().n,0);
});
test('cancel is independent while run waits; stop acknowledgement never releases live lease',async t=>{
 const entered=deferred(),finish=deferred(),f=fixture(t,{host:{run:rec=>{entered.resolve(rec);return finish.promise;}}}),v=f.make();await f.sync([v]);const running=f.consumer.execute(v.requestId,context),rec=await entered.promise;
 await f.consumer.ingest(f.event(cancel(v),1,'group.dispatch.cancel-requested'),context);assert.equal(f.stops,1);assert.throws(()=>f.gate.acquire({id:'outside',reservedDeviceSerials:['fixture-serial']}));assert.notEqual(f.consumer.row(v.requestId).phase,'done');
 finish.resolve({taskId:rec.taskId,terminal:true,resourcesReleased:true,outcome:'cancelled'});assert.equal((await running).receipt.outcome,'cancelled');assert.ok(f.service.request(v.requestId).stopRequestedAt);const lease=f.gate.acquire({id:'after',reservedDeviceSerials:['fixture-serial']});lease.release();
});
test('mapping persisted before admit; cancellation during discovery still prevents execute',async t=>{
 const entered=deferred(),resume=deferred(),f=fixture(t),v=f.make();f.service.discover=async()=>{entered.resolve();await resume.promise;return[{stableId:'fixture-id',serial:'fixture-serial'}];};await f.sync([v]);const running=f.consumer.execute(v.requestId,context);await entered.promise;assert.ok(f.consumer.row(v.requestId).execution_id);
 await f.consumer.ingest(f.event(cancel(v),1,'group.dispatch.cancel-requested'),context);resume.resolve();await assert.rejects(running,e=>e.code==='GROUP_STOP_REQUESTED');assert.equal(f.effects,0);assert.ok(f.stops>=1);assert.deepEqual([...new Set(f.stopIds)],[f.consumer.row(v.requestId).execution_id]);
});
test('full pending pagination always starts from zero; gap/partial pass cannot execute',async t=>{
 const f=fixture(t),vs=Array.from({length:3},()=>f.make()).sort((a,b)=>a.dispatchId.localeCompare(b.dispatchId));let calls=[];
 await f.consumer.reconcilePending(async q=>{calls.push(q);return q.afterDispatchUid?{items:[f.item(vs[2],1)],nextCursor:null}:{items:vs.slice(0,2).map(v=>f.item(v,1)),nextCursor:{afterCreatedMs:1,afterDispatchUid:vs[1].dispatchId}};},context);assert.equal(calls.length,2);assert.equal(f.consumer.db.prepare('SELECT count(*) n FROM dispatch_inbox').get().n,3);
 await f.consumer.ingest(f.event(cancel(vs[0]),9,'group.dispatch.cancel-requested'),context);await assert.rejects(f.consumer.execute(vs[1].requestId,context),e=>e.code==='GROUP_RECONCILIATION_REQUIRED');
 await assert.rejects(f.consumer.reconcilePending(async()=>{throw Error('disconnected');},context),/disconnected/);assert.equal(f.consumer.cursor(7).needs_scan,1);
 calls=[];await f.consumer.reconcilePending(async q=>{calls.push(q);return{items:vs.map(v=>f.item(v,1)),nextCursor:null};},context);assert.equal(calls[0].afterDispatchUid,undefined);assert.equal(f.consumer.cursor(7).needs_scan,0);assert.ok(f.consumer.row(vs[0].requestId).cancel_at);assert.equal(f.effects,0);
});
test('trusted client/epoch/seq and payload/member binding reject without side effects',async t=>{
 const f=fixture(t),v=f.make();for(const ev of [{...f.event(v),epoch:8},{...f.event(v),stream:'client:'+D},{...f.event(v),seq:0}])await assert.rejects(f.consumer.ingest(ev,context));
 await assert.rejects(f.consumer.ingest(f.event({...v,payloadSha256:'0'.repeat(64)}),context));assert.equal(f.consumer.db.prepare('SELECT count(*) n FROM dispatch_inbox').get().n,0);
 await f.sync([{...v,memberSha256:'0'.repeat(64)}]);await assert.rejects(f.consumer.execute(v.requestId,context),e=>e.code==='GROUP_EXECUTION_CONFLICT');assert.equal(f.prepares,0);
 await f.consumer.reconcilePending(async()=>({items:[],nextCursor:null}),{clientId:C,epoch:8});await assert.rejects(f.consumer.ingest(f.event(f.make()),context),e=>e.code==='GROUP_OWNER_MISMATCH');
});
test('missing trusted execution authority denies even typed steps; no renderer permission inferred',async t=>{
 const f=fixture(t,{authorize:()=>false}),v=f.make();await f.sync([v]);await assert.rejects(f.consumer.execute(v.requestId,context),e=>e.code==='GROUP_AUTHORIZATION_REQUIRED');assert.equal(f.prepares,0);assert.equal(f.effects,0);
});
test('Server already-started state with missing local identity can only reconcile, never prepare again',async t=>{
 const f=fixture(t);for(const status of ['confirmed','dispatching','unknown']){
  const v=f.make();await f.consumer.reconcilePending(async()=>({items:[{...f.item(v),status}],nextCursor:null}),context);await assert.rejects(f.consumer.execute(v.requestId,context),e=>e.code==='GROUP_RECONCILIATION_REQUIRED');assert.equal(f.consumer.row(v.requestId).phase,'unknown');
 }assert.equal(f.prepares,0);assert.equal(f.effects,0);
});
test('durable attempt without known result is not resubmitted after reopen',async t=>{
 const f=fixture(t,{checkpoint:stage=>{if(stage==='attemptCommitted')throw Error('simulated process lost');}}),v=f.make();await f.sync([v]);await assert.rejects(f.consumer.execute(v.requestId,context),/process lost/);assert.equal(f.consumer.row(v.requestId).phase,'attempting');assert.equal(f.prepares,0);
 await f.consumer.close();f.start({checkpoint:()=>{}});await assert.rejects(f.consumer.execute(v.requestId,context),e=>e.code==='GROUP_RECONCILIATION_REQUIRED');assert.equal(f.prepares,0);
});
test('execution completed but inbox result lost: recover original receipt, never reexecute',async t=>{
 const f=fixture(t,{checkpoint:stage=>{if(stage==='resultBeforeInbox')throw Error('lost inbox completion');}}),v=f.make();await f.sync([v]);await assert.rejects(f.consumer.execute(v.requestId,context),/lost inbox completion/);const old=f.consumer.row(v.requestId);assert.equal(f.effects,1);
 await f.consumer.close();f.start({checkpoint:()=>{}});const done=await f.consumer.execute(v.requestId,context);assert.equal(done.phase,'done');assert.equal(done.taskId,old.task_id);assert.equal(done.groupExecutionId,old.execution_id);assert.equal(f.effects,1);assert.equal(f.prepares,1);
});
test('execution result interrupted retains reservation and original ID; receipt reconciliation releases',async t=>{
 let effects=0;const f=fixture(t,{host:{run:async()=>{effects++;throw Error('report connection lost');}}}),v=f.make();await f.sync([v]);await assert.rejects(f.consumer.execute(v.requestId,context),/connection lost/);const old=f.consumer.row(v.requestId);assert.equal(f.service.request(v.requestId).phase,'unknown');
 await f.consumer.close();f.start();await assert.rejects(f.consumer.execute(v.requestId,context),e=>e.code==='GROUP_RECONCILIATION_REQUIRED');assert.equal(effects,1);assert.throws(()=>f.gate.acquire({id:'other',reservedDeviceSerials:['fixture-serial']}));
 f.native.host.recover=async r=>({taskId:r.taskId,terminal:true,resourcesReleased:true,outcome:'failed'});const done=await f.consumer.execute(v.requestId,context);assert.equal(done.taskId,old.task_id);assert.equal(done.groupExecutionId,old.execution_id);assert.equal(effects,1);
});
test('same-process duplicate execute shares identity and effect; received-only reopen can start once',async t=>{
 const f=fixture(t),v=f.make();await f.sync([v]);await f.consumer.close();f.start();await assert.rejects(f.consumer.execute(v.requestId,context),e=>e.code==='GROUP_RECONCILIATION_REQUIRED');await f.sync([v]);const a=f.consumer.execute(v.requestId,context),b=f.consumer.execute(v.requestId,context);const [x,y]=await Promise.all([a,b]);assert.equal(x.taskId,y.taskId);assert.equal(f.effects,1);assert.equal(f.prepares,1);
});
test('authorization revoked after prepare is rechecked before admit, with no effect',async t=>{
 let allowed=true;const entered=deferred(),resume=deferred(),f=fixture(t,{authorize:()=>allowed}),v=f.make();
 f.service.discover=async()=>{entered.resolve();await resume.promise;return[{stableId:'fixture-id',serial:'fixture-serial'}];};
 await f.sync([v]);const running=f.consumer.execute(v.requestId,context);await entered.promise;allowed=false;resume.resolve();await assert.rejects(running,e=>e.code==='GROUP_AUTHORIZATION_REQUIRED');assert.equal(f.effects,0);assert.ok(f.consumer.row(v.requestId).task_id);assert.equal(f.service.store.db.prepare('SELECT count(*) n FROM group_reservation').get().n,0);
});
test('late succeeded receipt after cancel retains cancel intent and real outcome',async t=>{
 const entered=deferred(),finish=deferred(),f=fixture(t,{host:{run:rec=>{entered.resolve(rec);return finish.promise;}}}),v=f.make();await f.sync([v]);const running=f.consumer.execute(v.requestId,context),rec=await entered.promise;
 await f.consumer.ingest(f.event(cancel(v),1,'group.dispatch.cancel-requested'),context);finish.resolve({taskId:rec.taskId,terminal:true,resourcesReleased:true,outcome:'succeeded'});const done=await running;assert.equal(done.receipt.outcome,'succeeded');assert.ok(done.stopRequestedAt);assert.ok(f.consumer.row(v.requestId).cancel_at);assert.equal(f.consumer.row(v.requestId).phase,'done');
});
test('two consumer handles cannot both claim the same received request',async t=>{
 const f=fixture(t),v=f.make(),other=new GroupDispatchConsumer({directory:path.join(f.dir,'inbox'),clientId:C,service:f.service,authorize:()=>true});t.after(()=>other.close());await f.sync([v]);
 const results=await Promise.allSettled([f.consumer.execute(v.requestId,context),other.execute(v.requestId,context)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'GROUP_RECONCILIATION_REQUIRED');assert.equal(f.effects,1);assert.equal(f.prepares,1);
});

// Real abrupt child exit: committed SQLite state survives without finally/close.
test('abrupt process exit at each persistence boundary recovers only original IDs and never repeats effects',async t=>{
 const {spawnSync}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dg110-crash-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const worker=path.join(dir,'worker.cjs');
 fs.writeFileSync(worker,`
 const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
 const {GroupDispatchConsumer}=require(${JSON.stringify(require.resolve('./group-dispatch.cjs'))});
 const {GroupService}=require(${JSON.stringify(require.resolve('./group-service.cjs'))});
 const {GroupNative}=require(${JSON.stringify(require.resolve('./group-native.cjs'))});
 const {DeviceSnapshot}=require(${JSON.stringify(require.resolve('./device-snapshot.cjs'))});
 const {createWorkflowExecutionGate}=require(${JSON.stringify(require.resolve('../workflow-execution-gate'))});
 const dir=process.argv[2],point=process.argv[3],mode=process.argv[4],input=JSON.parse(fs.readFileSync(path.join(dir,'input.json'))),C=${JSON.stringify(C)},D=${JSON.stringify(D)},ctx={clientId:C,epoch:7};
 const snapshot=new DeviceSnapshot(path.join(dir,'devices'));const source='sha256:'+createHash('sha256').update('android:ro.serialno\\0fixture-id').digest('hex');snapshot.data.owner={clientId:C,epoch:1};snapshot.data.mappings[source]={deviceId:D,connectedAt:new Date().toISOString()};snapshot.save();
 const die=p=>{if(mode==='crash'&&point===p)process.exit(73);};
 const native=new GroupNative({directory:path.join(dir,'native'),host:{prepare:async()=>die('nativePrepared'),run:async rec=>{fs.appendFileSync(path.join(dir,'effects'),rec.taskId+'\\n');die('effectBeforeReceipt');return{taskId:rec.taskId,terminal:true,resourcesReleased:true,outcome:'succeeded'};},recover:async()=>null,stop:async()=>{}}});
 const service=new GroupService({directory:path.join(dir,'groups'),clientId:C,native,gate:createWorkflowExecutionGate(),snapshot,discover:async()=>[{stableId:'fixture-id',serial:'fixture-serial'}]});
 if(!service.store.get(input.groupId))service.store.save({groupId:input.groupId,expectedRevision:0,name:'fixture',members:[{deviceId:D,role:'phone',sourceIdentity:source}]});
 const consumer=new GroupDispatchConsumer({directory:path.join(dir,'inbox'),clientId:C,service,authorize:()=>true,checkpoint:die});
 (async()=>{let error=null;try{
 if(mode==='crash')await consumer.ingest({stream:'client:'+C,epoch:7,seq:1,type:'group.dispatch.requested',data:input},ctx);
 await consumer.reconcilePending(async()=>({items:[{...input,status:'requested',createdAtMs:1,cancelRequestedAt:null,clientWire:{groupId:input.groupId,expectedRevision:1,requestId:input.requestId,payload:input.payload,payloadSha256:input.payloadSha256,payloadBytes:input.payloadBytes,dispatchPlanSha256:input.dispatchPlanSha256}}],nextCursor:null}),ctx);
 await consumer.execute(input.requestId,ctx);
 }catch(e){error=e.code||e.message;}
 const row=consumer.row(input.requestId),rec=service.request(input.requestId),nr=native.db.prepare('SELECT task_id,phase FROM native_group_request WHERE request_id=?').get(input.requestId);
 fs.writeFileSync(path.join(dir,mode+'.json'),JSON.stringify({row,rec,nr,error}));await consumer.close();await service.close();})().catch(e=>{console.error(e);process.exitCode=1;});
 `);
 for(const point of ['inboxCommitted','pageCommitted','attemptCommitted','nativePrepared','mappingCommitted','effectBeforeReceipt','resultBeforeInbox']){
  const d=path.join(dir,point);fs.mkdirSync(d);const payload={cases:[{id:'fixture',steps:[]}]},v={clientId:C,dispatchId:randomUUID(),requestId:randomUUID(),groupId:randomUUID(),expectedRevision:1,payload,payloadSha256:sha(canon(payload)),payloadBytes:Buffer.byteLength(canon(payload)),memberSha256:sha(canon([{deviceId:D,role:'phone'}]))};v.dispatchPlanSha256=sha(canon({groupId:v.groupId,expectedRevision:1,requestId:v.requestId,payload}));fs.writeFileSync(path.join(d,'input.json'),JSON.stringify(v));
  const crashed=spawnSync(process.execPath,[worker,d,point,'crash'],{encoding:'utf8',timeout:10000});assert.equal(crashed.status,73,point+crashed.stderr);
  // Read original native identity before recovery in a separate, read-only SQLite handle.
  const {DatabaseSync}=require('node:sqlite');let originalTask=null;
  if(fs.existsSync(path.join(d,'native/native.sqlite'))){const db=new DatabaseSync(path.join(d,'native/native.sqlite'),{readOnly:true});originalTask=db.prepare('SELECT task_id FROM native_group_request').get()?.task_id;db.close();}
  const resumed=spawnSync(process.execPath,[worker,d,point,'resume'],{encoding:'utf8',timeout:10000});assert.equal(resumed.status,0,point+resumed.stderr);const out=JSON.parse(fs.readFileSync(path.join(d,'resume.json')));
  const effects=fs.existsSync(path.join(d,'effects'))?fs.readFileSync(path.join(d,'effects'),'utf8').trim().split('\n'):[];
  if(originalTask)assert.equal(out.nr.task_id,originalTask,point+' identity');assert.ok(effects.length<=1,point+' repeated effects');
  if(['inboxCommitted','pageCommitted','resultBeforeInbox'].includes(point)){assert.equal(out.rec.phase,'done',point);assert.equal(effects.length,1,point);}
  else{assert.equal(out.error,'GROUP_RECONCILIATION_REQUIRED',point);if(point==='effectBeforeReceipt')assert.equal(effects.length,1);else assert.equal(effects.length,0);}
 }
});
