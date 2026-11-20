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
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dg110-'));let effects=0,prepares=0,stops=0,service,consumer,runtime;const stopIds=[];
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
 t.after(async()=>{await runtime?.close();await consumer.close();await service.close();fs.rmSync(dir,{recursive:true,force:true});});
 return{dir,service,native,gate,host,g,make,event,item,sync,start,stopIds,setRuntime:r=>runtime=r,get consumer(){return consumer;},get effects(){return effects;},get prepares(){return prepares;},get stops(){return stops;}};
}

const {GroupRuntime}=require('./group-runtime.cjs');
function rig(t,{policy=()=>true,host,reply,events=[]}={}){
 const f=fixture(t,{host}),session={sessionId:'fixture-session',epoch:7};let rows=[],calls=0;const connector={state:{clientId:C,mediaCursor:{seq:999}},session,
 async groupEvents(seq){return{events:events.filter(e=>e.seq>seq),snapshotSeq:1,hasMore:false};},
 async call(method,route,body){if(route.startsWith('/v1/group-dispatches?'))return reply?reply(route):{items:rows.map((v,i)=>({...f.item(v,i),mirrorError:null})),nextCursor:null};
  if(route==='/v1/group-grants/verify'){calls++;const w=rows.find(v=>v.requestId===body.requestId);return{authorized:true,grantId:'11111111-1111-4111-8111-111111111111',stepProfile:'bound-payload',targetClientId:C,groupId:w.groupId,expectedRevision:w.expectedRevision,memberSha256:w.memberSha256,payloadSha256:w.payloadSha256,payloadBytes:w.payloadBytes,dispatchPlanSha256:w.dispatchPlanSha256,issuedAtMs:Date.now()-10,expiresAtMs:Date.now()+60000,revoked:false,consumedByRequest:w.requestId,cancelRequestedAt:null,sessionEpoch:7};}throw Error('unexpected route');}};
 const runtime=new GroupRuntime({directory:path.join(f.dir,'transport'),connector,service:f.service,trustedExecution:policy});f.setRuntime(runtime);return{f,connector,runtime,setRows:v=>rows=v,get calls(){return calls;}};
}
async function idle(runtime){await Promise.all([...runtime.active.values()]);}
test('independent persistent cursor handles unrelated events, cancellation and pending without media cursor changes',async t=>{
 const r=rig(t,{events:[{stream:'client:'+C,epoch:7,seq:1,type:'media.ignored',data:{}}]}),w=r.f.make();r.setRows([w]);await r.runtime.tick();await idle(r.runtime);assert.equal(r.f.effects,1);assert.equal(r.calls,4);assert.equal(r.connector.state.mediaCursor.seq,999);assert.equal(r.runtime.consumer.db.prepare('SELECT seq FROM group_transport_cursor').get().seq,1);await r.runtime.tick();await idle(r.runtime);assert.equal(r.f.effects,1);
});
test('mirrorError and 503 reject new execution; missing mirror state also fails closed',async t=>{
 for(const bad of ['conflict','missing','503']){let row;const r=rig(t,{reply:()=>{if(bad==='503')throw Object.assign(Error('down'),{code:'UNAVAILABLE'});const item={...r.f.item(row),...(bad==='missing'?{}:{mirrorError:{code:'conflict'}})};return{items:[item],nextCursor:null};}});row=r.f.make();r.setRows([row]);await assert.rejects(r.runtime.tick());assert.equal(r.f.prepares,0);assert.equal(r.f.effects,0);assert.equal(r.calls,0);}
});
test('pending mirror conflict still preserves valid independent stop fact',async t=>{
 let w;const r=rig(t,{reply:()=>({items:[{...r.f.item({...w,cancelRequestedAt:'2026-11-07T00:00:00Z'}),mirrorError:{code:'conflict'}}],nextCursor:null})});w=r.f.make();r.setRows([w]);await assert.rejects(r.runtime.tick());assert.ok(r.runtime.consumer.row(w.requestId).cancel_at);assert.equal(r.f.prepares,0);
});
test('native and trusted step policy remains fail closed even though transport is readable',async t=>{
 const r=rig(t,{policy:()=>false}),w=r.f.make();r.setRows([w]);await r.runtime.tick();await idle(r.runtime);assert.equal(r.f.prepares,0);assert.equal(r.f.effects,0);assert.equal(r.calls,0);assert.equal(r.runtime.errors.get(w.requestId),'GROUP_AUTHORIZATION_REQUIRED');
});
test('full pending pagination completes before execution; late page failure cannot run page one',async t=>{
 let ws,seen=[];const r=rig(t,{reply:route=>{const q=new URL('http://fixture'+route).searchParams;seen.push(q.get('afterDispatchUid'));if(q.has('afterDispatchUid'))throw Object.assign(Error('page2'),{code:'UNAVAILABLE'});return{items:[{...r.f.item(ws[0],1),mirrorError:null}],nextCursor:{afterCreatedMs:1,afterDispatchUid:ws[0].dispatchId}};}});ws=[r.f.make(),r.f.make()];r.setRows(ws);await assert.rejects(r.runtime.tick());assert.equal(seen.length,2);assert.equal(r.f.effects,0);assert.equal(r.f.prepares,0);
});
test('Desktop Main factory path consumes groups even if outgoing projection publish fails',async t=>{
 const {DesktopConnection}=require('./desktop-service.cjs');const directory=fs.mkdtempSync(path.join(os.tmpdir(),'group-main-'));let ticks=0,closed=0;
 const connector={state:{clientId:C},session:{sessionId:'one',epoch:7,heartbeatIntervalSec:300},status:()=>({phase:'approved'}),heartbeat:async()=>({}),close(){this.session=null;}};
 const connection=new DesktopConnection({directory,version:'isolated',makeConnector:()=>connector,groupServiceFactory:()=>({async publish(){throw Object.assign(Error('outgoing'),{code:'UNAVAILABLE'});},async close(){}}),groupDispatchFactory:o=>{assert.equal(o.connector,connector);return{async tick(){ticks++;return{status:'reconciled'};},async close(){closed++;}};}});
 t.after(async()=>{await connection.close();assert.equal(closed,1);fs.rmSync(directory,{recursive:true,force:true});});connection.settings.config={serverUrl:'https://isolated',orgKey:'o',projectKey:'p'};connection.settings.enabled=true;connection.deviceReporter={};await connection.tick();clearTimeout(connection.timer);assert.equal(ticks,1);assert.equal(connection.snapshot().groups.errorCode,'UNAVAILABLE');
});
test('Connector group cursor is caller-owned, rejects replaced session and never checkpoints media',async()=>{
 const {Connector}=require('./connector.cjs'),c=Object.create(Connector.prototype);c.state={clientId:C,mediaCursor:{seq:100}};c.session={sessionId:'one',epoch:7};let route;c.call=async(_m,r)=>{route=r;return{events:[],snapshotSeq:1,hasMore:false};};await c.groupEvents(5);assert.ok(route.includes('sinceSeq=5'));assert.equal(c.state.mediaCursor.seq,100);c.call=async()=>{c.session={...c.session};return{events:[],snapshotSeq:1,hasMore:false};};await assert.rejects(c.groupEvents(5));
});

test('async local approval does not block independent group cancel consumption',async t=>{
 const gate=deferred(),r=rig(t),w=r.f.make();r.setRows([w]);r.runtime.authority={prepare:()=>gate.promise,invalidate(){},close(){}};await r.runtime.tick();assert.equal(r.runtime.active.size,1);
 const stop={stream:'client:'+C,epoch:7,seq:1,type:'group.dispatch.cancel-requested',data:{clientId:C,dispatchId:w.dispatchId,requestId:w.requestId,cancelRequestedAt:'2026-11-07T00:00:00Z'}};r.connector.groupEvents=async seq=>({events:seq<1?[stop]:[],snapshotSeq:1,hasMore:false});await r.runtime.tick();assert.ok(r.runtime.consumer.row(w.requestId).cancel_at);gate.resolve();await idle(r.runtime);assert.equal(r.f.prepares,0);assert.equal(r.f.effects,0);
});
