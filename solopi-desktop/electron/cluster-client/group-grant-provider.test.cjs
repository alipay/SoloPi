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
function fixture(t,{host:over={},authorize=()=>true,checkpoint=()=>{},bridgeFactory}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dg110-'));let effects=0,prepares=0,stops=0,service,consumer;const stopIds=[];
 const source='sha256:'+sha('android:ro.serialno\0fixture-id'),snapshot=new DeviceSnapshot(path.join(dir,'devices'));
 snapshot.data.owner={clientId:C,epoch:1};snapshot.data.mappings[source]={deviceId:D,connectedAt:new Date().toISOString()};snapshot.save();
 const gate=createWorkflowExecutionGate(),host={prepare:async()=>{prepares++;},run:async rec=>{effects++;return{taskId:rec.taskId,terminal:true,resourcesReleased:true,outcome:'succeeded'};},recover:async()=>null,stop:async rec=>{stops++;stopIds.push(rec.groupExecutionId);},...over};
 const native=new GroupNative({directory:path.join(dir,'native'),host});
 service=new GroupService({directory:path.join(dir,'groups'),clientId:C,native,gate,snapshot,discover:async()=>[{stableId:'fixture-id',serial:'fixture-serial'}]});
 const g=service.store.save({expectedRevision:0,name:'fixture',members:[{deviceId:D,role:'phone',sourceIdentity:source}]});
 const make=()=>{const payload={cases:[{id:'fixture',steps:[]}]},v={clientId:C,dispatchId:randomUUID(),requestId:randomUUID(),groupId:g.groupId,expectedRevision:1,payload,payloadSha256:sha(canon(payload)),payloadBytes:Buffer.byteLength(canon(payload)),memberSha256:sha(canon([{deviceId:D,role:'phone'}]))};return{...v,dispatchPlanSha256:sha(canon({groupId:v.groupId,expectedRevision:1,requestId:v.requestId,payload}))};};
 const start=opts=>consumer=new GroupDispatchConsumer({directory:path.join(dir,'inbox'),clientId:C,service,authorize,checkpoint,grantBridge:bridgeFactory?.(),...opts});start();
 const event=(v,seq=1,type='group.dispatch.requested')=>({stream:'client:'+C,epoch:7,seq,type,data:v});
 const item=(v,n=1)=>({...v,status:'requested',createdAtMs:n,cancelRequestedAt:v.cancelRequestedAt||null,clientWire:{groupId:v.groupId,requestId:v.requestId,expectedRevision:v.expectedRevision,payload:v.payload,payloadSha256:v.payloadSha256,payloadBytes:v.payloadBytes,dispatchPlanSha256:v.dispatchPlanSha256,...(v.cancelRequestedAt?{cancelRequestedAt:v.cancelRequestedAt}:{})}});
 const sync=async vs=>consumer.reconcilePending(async()=>({items:vs.map((v,i)=>item(v,i)),nextCursor:null}),context);
 t.after(async()=>{await consumer.close();await service.close();fs.rmSync(dir,{recursive:true,force:true});});
 return{dir,service,native,gate,host,g,make,event,item,sync,start,stopIds,get consumer(){return consumer;},get effects(){return effects;},get prepares(){return prepares;},get stops(){return stops;}};
}

const {GroupGrantProvider}=require('./group-grant-provider.cjs');
function bridge({call=async()=>({}),session,policy=()=>true}={}){
 const state={session:session||{clientId:C,epoch:7,sessionId:'isolated-handle'},calls:[]};
 const normalize=(w,o,c)=>{assert.equal(o.clientId,c.clientUlid);return{...o};};
 const checkVerdict=(v,b)=>{assert.equal(v.authorized,true);assert.equal(v.requestId,b.requestId);assert.equal(v.payloadSha256,b.payloadSha256);assert.ok(v.expiresAtMs>Date.now());return true;};
 state.provider=new GroupGrantProvider({getSession:()=>state.session,normalize,checkVerdict,trustedExecution:policy,call:async(...a)=>{state.calls.push(a);return call(...a);}});return state;
}
const response=(w,extra={})=>({...w,targetClientId:w.clientId,consumedByRequest:w.requestId,authorized:true,requestId:w.requestId,payloadSha256:w.payloadSha256,sessionEpoch:7,cancelRequestedAt:null,expiresAtMs:Date.now()+60000,...extra});
test('async stages refresh independently, retain native IDs, original recovery never repeats effect',async t=>{
 let w;const b=bridge({call:async()=>response(w)}),f=fixture(t,{bridgeFactory:()=>b.provider});w=f.make();await f.sync([w]);const done=await f.consumer.execute(w.requestId,context);assert.equal(done.phase,'done');assert.equal(b.calls.length,4);assert.equal(f.effects,1);assert.equal(f.prepares,1);await f.consumer.close();f.start();assert.equal((await f.consumer.execute(w.requestId,context)).taskId,done.taskId);assert.equal(f.effects,1);
});
test('replacement with same epoch and token still invalidates in-flight session handle',async t=>{
 let w;const gate=deferred(),b=bridge({call:async()=>{await gate.promise;return response(w);}}),f=fixture(t,{bridgeFactory:()=>b.provider});w=f.make();await f.sync([w]);const p=f.consumer.execute(w.requestId,context);b.session={...b.session};gate.resolve();await assert.rejects(p,e=>e.code==='GROUP_RECONCILIATION_REQUIRED');assert.equal(f.prepares,0);assert.equal(f.effects,0);
});
test('cancel disclosed by verify is durable before prepare and survives reopen',async t=>{
 let w;const b=bridge({call:async()=>response(w,{cancelRequestedAt:'2026-11-07T00:00:00Z'})}),f=fixture(t,{bridgeFactory:()=>b.provider});w=f.make();await f.sync([w]);await assert.rejects(f.consumer.execute(w.requestId,context),e=>e.code==='GROUP_STOP_REQUESTED');assert.ok(f.consumer.row(w.requestId).cancel_at);assert.equal(f.prepares,0);await f.consumer.close();f.start();await assert.rejects(f.consumer.execute(w.requestId,context),e=>e.code==='GROUP_STOP_REQUESTED');assert.equal(f.effects,0);
});
test('cancel during identity preparation persists mapping, no admit/effect; original ID reconciles',async t=>{
 let w;const prep=deferred(),b=bridge({call:async()=>response(w)}),f=fixture(t,{bridgeFactory:()=>b.provider,host:{prepare:async()=>{await prep.promise;}}});w=f.make();await f.sync([w]);const p=f.consumer.execute(w.requestId,context);while(b.calls.length<2)await new Promise(r=>setImmediate(r));await f.consumer.ingest(f.event({clientId:C,dispatchId:w.dispatchId,requestId:w.requestId,cancelRequestedAt:'2026-11-07T00:00:00Z'},1,'group.dispatch.cancel-requested'),context);prep.resolve();await assert.rejects(p,e=>e.code==='GROUP_STOP_REQUESTED');const rec=f.service.request(w.requestId);assert.ok(rec.taskId);assert.equal(f.effects,0);assert.equal(f.consumer.row(w.requestId).task_id,rec.taskId);
});
test('session epoch replaced after identity mapping refuses before admission, never re-prepares',async t=>{
 let w,n=0;const b=bridge({call:async()=>{if(++n===3)b.session={...b.session,epoch:8};return response(w);}}),f=fixture(t,{bridgeFactory:()=>b.provider});w=f.make();await f.sync([w]);await assert.rejects(f.consumer.execute(w.requestId,context));const id=f.consumer.row(w.requestId).task_id;assert.ok(id);assert.equal(f.effects,0);await f.consumer.close();f.start();await assert.rejects(f.consumer.execute(w.requestId,context),e=>e.code==='GROUP_RECONCILIATION_REQUIRED');assert.equal(f.consumer.row(w.requestId).task_id,id);assert.equal(f.prepares,1);
});
test('beforeAdmit always fetches again; expired or incomplete verdict cannot execute',async t=>{
 for(const bad of [{expiresAtMs:0},{sessionEpoch:8},{cancelRequestedAt:undefined},{authorized:false}]){
 let w,n=0;const b=bridge({call:async()=>response(w,++n===4?bad:{})}),f=fixture(t,{bridgeFactory:()=>b.provider});w=f.make();await f.sync([w]);await assert.rejects(f.consumer.execute(w.requestId,context));assert.equal(f.effects,0);assert.equal(n,4);
 }
});
test('missing trusted native policy denies before network, promise policy never authorizes',async t=>{
 for(const policy of [undefined,async()=>true]){
 let calls=0;const options={getSession:()=>({clientId:C,epoch:7,sessionId:'fixture'}),call:async()=>{calls++;},normalize:()=>({}),checkVerdict:()=>true,...(policy?{trustedExecution:policy}:{})};
 const p=new GroupGrantProvider(options);await assert.rejects(p.verify({requestId:randomUUID()},context,'beforeClaim'),e=>e.code==='GROUP_AUTHORIZATION_REQUIRED');assert.equal(calls,0);
 }
});
test('durable mapping crash with bridge keeps original ID and does not repeat prepare or execute',async t=>{
 let w;const b=bridge({call:async()=>response(w)}),f=fixture(t,{bridgeFactory:()=>b.provider,checkpoint:stage=>{if(stage==='mappingCommitted')throw Error('bridge crash');}});w=f.make();await f.sync([w]);await assert.rejects(f.consumer.execute(w.requestId,context),/bridge crash/);const task=f.consumer.row(w.requestId).task_id;assert.ok(task);await f.consumer.close();f.start({checkpoint:()=>{}});await assert.rejects(f.consumer.execute(w.requestId,context),e=>e.code==='GROUP_RECONCILIATION_REQUIRED');assert.equal(f.consumer.row(w.requestId).task_id,task);assert.equal(f.prepares,1);assert.equal(f.effects,0);
});
test('independent cancellation during beforeAdmit network wait cannot be hidden by success reply',async t=>{
 let w,n=0;const reached=deferred(),release=deferred(),b=bridge({call:async()=>{if(++n===4){reached.resolve();await release.promise;}return response(w);}}),f=fixture(t,{bridgeFactory:()=>b.provider});w=f.make();await f.sync([w]);const p=f.consumer.execute(w.requestId,context);await reached.promise;await f.consumer.ingest(f.event({clientId:C,dispatchId:w.dispatchId,requestId:w.requestId,cancelRequestedAt:'2026-11-07T00:00:00Z'},1,'group.dispatch.cancel-requested'),context);release.resolve();await assert.rejects(p,e=>e.code==='GROUP_STOP_REQUESTED');assert.equal(f.effects,0);assert.equal(f.consumer.row(w.requestId).cancel_at,'2026-11-07T00:00:00Z');assert.ok(f.consumer.row(w.requestId).task_id);
});
test('bridge deny cannot fall back to legacy authorize true',async t=>{
 let w;const b=bridge({policy:()=>false}),f=fixture(t,{bridgeFactory:()=>b.provider,authorize:()=>true});w=f.make();await f.sync([w]);await assert.rejects(f.consumer.execute(w.requestId,context),e=>e.code==='GROUP_AUTHORIZATION_REQUIRED');assert.equal(f.prepares,0);assert.equal(f.effects,0);assert.equal(b.calls.length,0);
});
test('request-bound cancel remains durable when authorization expires during response transit',async t=>{
 let w;const b=bridge({call:async()=>({...response(w,{expiresAtMs:0,cancelRequestedAt:'2026-11-07T00:00:00Z'}),targetClientId:C,consumedByRequest:w.requestId,dispatchId:w.dispatchId,groupId:w.groupId,expectedRevision:w.expectedRevision,memberSha256:w.memberSha256,payloadBytes:w.payloadBytes,dispatchPlanSha256:w.dispatchPlanSha256})}),f=fixture(t,{bridgeFactory:()=>b.provider});w=f.make();await f.sync([w]);await assert.rejects(f.consumer.execute(w.requestId,context),e=>e.code==='GROUP_STOP_REQUESTED');assert.ok(f.consumer.row(w.requestId).cancel_at);assert.equal(f.effects,0);
});

// Real abrupt child exit: committed SQLite state survives without finally/close.
test('async bridge abrupt process exit at each persistence boundary recovers only original IDs and never repeats effects',async t=>{
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
 const {GroupGrantProvider}=require(${JSON.stringify(require.resolve('./group-grant-provider.cjs'))});
 const session={clientId:C,epoch:7,sessionId:'isolated-handle'};
 const grantBridge=new GroupGrantProvider({getSession:()=>session,normalize:(_w,o)=>o,checkVerdict:()=>true,trustedExecution:()=>true,call:async()=>({sessionEpoch:7,cancelRequestedAt:null})});
 const consumer=new GroupDispatchConsumer({directory:path.join(dir,'inbox'),clientId:C,service,grantBridge,checkpoint:die});
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
