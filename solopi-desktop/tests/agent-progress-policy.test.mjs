import {NativeRuntime,disposeAll} from './fixtures/harness-lifecycle.mjs';
import {boundary as nativeBoundary} from './fixtures/harness-lifecycle.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';test.after(disposeAll);
const require=createRequire(import.meta.url);
const {AgentRuntime}={AgentRuntime:NativeRuntime};const {AgentStore}=require('../electron/agent/store');const policy=require('../electron/agent/progress-policy');
const call=(id,name,args={})=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const batch=(...calls)=>({role:'assistant',tool_calls:calls});
async function wait(runtime){await nativeBoundary(runtime);}
function fixture(t,tools,model,progressOptions={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-progress-'));t.after(async()=>{await disposeAll();fs.rmSync(dir,{recursive:true,force:true})});const store=new AgentStore(()=>dir),session=store.create();session.approvalMode='auto';store.save(session);const runtime=new AgentRuntime({store,tools:async()=>tools,provider:()=>({}),model,progressOptions});t.after(async()=>{await runtime.stopAll()});return{store,session,runtime};}
test('evidence reads preserve source scope and miss meaning; parallel and serial reads agree',async t=>{const f=fixture(t,[],async()=>({role:'assistant',content:'ok'}));f.store.saveEvidence(f.session.id,'e',{caseId:'case-a',value:'payload'}, {toolName:'read_case_results',taskId:'task-a'});const queries=['case-a','case-b','case-c'];const serial=queries.map(q=>f.store.readEvidence(f.session.id,'e',0,1000,q));const parallel=await Promise.all(queries.map(async q=>f.store.readEvidence(f.session.id,'e',0,1000,q)));assert.deepEqual(parallel,serial);assert.equal(serial[1].found,false);assert.equal(serial[1].search.source.caseId,'case-a');assert.equal(serial[1].search.source.taskId,'task-a');assert.match(serial[1].message,/不证明并发冲突/);});




test('missing/failed/old/preparatory receipts cannot finish an action; blocked can stop without writes',()=>{const s={messages:[{role:'user',content:'do'}],calls:[{modelCallId:'read',scopeUserIndex:0,status:'done',name:'read_evidence',result:{found:false}},{modelCallId:'help',scopeUserIndex:0,status:'done',name:'read_skill',result:{success:true}}],workState:{scopeUserIndex:0}};for(const id of ['missing','read','help'])assert.throws(()=>policy.completeWork(s,{outcome:'completed',sourceCallIds:[id],summary:'done'},[]));assert.equal(policy.completeWork(s,{outcome:'blocked',sourceCallIds:[],summary:'missing evidence'},[]).outcome,'blocked');});
test('explicit new task searches are not replaced by an old task scope',()=>{const {taskRoute}=require('../electron/agent/task-routing');const s={messages:[{role:'user'},{role:'assistant',tool_calls:[{id:'a'}]}],calls:[{modelCallId:'a',args:{taskId:'old'}}]};for(const args of [{query:'other'},{status:'failed'},{offset:20}])assert.equal(taskRoute(s,'list_tasks',args),null);assert.equal(taskRoute(s,'list_tasks',{}).args.taskId,'old');});
test('analysis can complete with fresh read evidence and stale prior work never activates a new request',()=>{const s={messages:[{role:'user',content:'analyze'}],calls:[{modelCallId:'e',scopeUserIndex:0,status:'done',name:'read_result',result:{success:true}}],workState:{scopeUserIndex:0,completionMode:'analysis'}};assert.equal(policy.completeWork(s,{outcome:'completed',summary:'analysis from receipt',sourceCallIds:['e']},[]).outcome,'completed');s.workState.resolution=undefined;s.messages.push({role:'user',content:'new question'});assert.equal(policy.activeWork(s),false);});
test('productive work completes beyond 100 model requests without a count ceiling',async t=>{
 let n=0;const pages=[];
 const f=fixture(t,[{name:'read',schema:{type:'object'},execute:args=>{pages.push(args.page);return{success:true,page:args.page};}}],async()=>++n<=105?batch(call('step'+n,'read',{page:n})):({role:'assistant',content:'全部读取完成'}));
 await f.runtime.start(f.session.id,'read all pages');await wait(f.runtime);
 const s=f.store.get(f.session.id);assert.equal(n,106);assert.equal(s.status,'idle');assert.equal(s.turnMetrics.modelRequests,106);assert.equal(s.turnMetrics.toolCalls,105);assert.deepEqual(pages,Array.from({length:105},(_,i)=>i+1));assert.ok(!s.error);
});
test('obsolete request ceiling configuration cannot reintroduce the removed stop',async t=>{
 let n=0;const f=fixture(t,[{name:'read',schema:{type:'object'},execute:()=>({success:true})}],async()=>++n<=3?batch(call('step'+n,'read',{page:n})):({role:'assistant',content:'done'}),{maxModelRequests:2});
 await f.runtime.start(f.session.id,'read');await wait(f.runtime);assert.equal(n,4);assert.equal(f.store.get(f.session.id).status,'idle');
});
test('user cancellation still aborts an in-flight model request beyond the old 100 request limit',async t=>{
 let n=0,entered;const ready=new Promise(resolve=>entered=resolve);
 const f=fixture(t,[{name:'read',schema:{type:'object'},execute:()=>({success:true})}],async({signal})=>{
  if(++n<=100)return batch(call('step'+n,'read',{page:n}));
  entered();return new Promise((resolve,reject)=>{if(signal.aborted)return reject(signal.reason);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
 });
 await f.runtime.start(f.session.id,'read until stopped');await ready;f.runtime.stop(f.session.id);await wait(f.runtime);
 const s=f.store.get(f.session.id);assert.equal(n,101);assert.equal(s.status,'interrupted');assert.equal(s.turnMetrics.toolCalls,100);assert.equal(f.runtime.active.size,0);
});
test('request diagnostics distinguish requested thinking-off from actual reasoning still returned',async()=>{const diagnostics=require('../electron/diagnostics'),original=diagnostics.record,events=[];diagnostics.record=e=>events.push(e);try{const{requestModel}=require('../electron/agent/model');await requestModel({provider:{model:'fixture',baseUrl:'https://fixture.invalid',thinking:'disabled'},messages:[{role:'user',content:'fixture'}],tools:[],stream:false,retry:false,fetchImpl:async(_url,r)=>{assert.equal(JSON.parse(r.body).thinking.type,'disabled');return{ok:true,status:200,headers:{get:()=>null},json:async()=>({choices:[{finish_reason:'stop',message:{content:'answer',reasoning_content:'still thinks'}}]})};}});const r=events.find(e=>e.event==='model.response');assert.equal(r.thinkingDisabledRequested,true);assert.equal(r.reasoningReturnedWhileDisabled,true);}finally{diagnostics.record=original;}});
test('observing a genuine prior successful write can finish without executing that write again',()=>{const s={messages:[{role:'user',content:'check existing'}],calls:[{id:'original',modelCallId:'write-before',name:'write',scopeUserIndex:-1,status:'done',result:{success:true,id:'existing'}},{modelCallId:'observed',name:'read_operation_receipt',args:{callId:'write-before'},scopeUserIndex:0,status:'done',finishedAt:'2026-10-22T15:02:00Z',result:{success:true,status:'done'}}],workState:{scopeUserIndex:0,updatedAt:'2026-10-22T15:01:00Z'}};assert.equal(policy.completeWork(s,{outcome:'completed',summary:'已有成功回执，未重放',sourceCallIds:['observed']},[{name:'write',confirm:true}]).outcome,'completed');});
test('a completed action remains valid after later progress notes including a persisted session reload',()=>{
 const s={messages:[{role:'user',content:'authorized task'}],calls:[{modelCallId:'write',name:'action',scopeUserIndex:0,status:'done',finishedAt:'2026-10-22T16:20:28Z',result:{success:true,id:'receipt'}}],workState:{scopeUserIndex:0,updatedAt:'2026-10-22T16:20:57Z'}};
 s.workState={...s.workState,phase:'delivered',updatedAt:'2026-10-22T16:21:48Z'};
 const restored=JSON.parse(JSON.stringify(s));const r=policy.completeWork(restored,{outcome:'completed',summary:'confirmed result',sourceCallIds:['write']},[{name:'action',confirm:true}]);
 assert.equal(r.receiptVerified,true);assert.equal(restored.workState.resolution.outcome,'completed');assert.equal(s.workState.resolution,undefined);
});

test('later progress cannot make failed, unknown, foreign-scope or nonexistent actions valid',()=>{
 const base={messages:[{role:'user',content:'task'}],workState:{scopeUserIndex:0,updatedAt:'2099-01-01'},calls:[]};
 for(const change of [{scopeUserIndex:-1},{status:'running'},{status:'failed',result:{success:false}},{result:{found:false}},{result:{success:false}}]){
  const s=structuredClone(base);s.calls=[{modelCallId:'a',scopeUserIndex:0,status:'done',name:'action',result:{success:true},...change}];assert.throws(()=>policy.completeWork(s,{outcome:'completed',sourceCallIds:['a'],summary:'done'},[{name:'action',confirm:true}]),/本轮有效回执/);
 }
 const s=structuredClone(base);assert.throws(()=>policy.completeWork(s,{outcome:'completed',sourceCallIds:['invented'],summary:'done'},[]),/本轮有效回执/);
});
test('observed historical success remains valid after progress updates; read-only results alone cannot complete an action',()=>{
 const s={messages:[{role:'user',content:'verify existing result'}],workState:{scopeUserIndex:0,updatedAt:'2026-10-22T16:21:48Z'},calls:[{modelCallId:'old',name:'action',scopeUserIndex:-1,status:'done',result:{success:true}},{modelCallId:'observed',name:'read_operation_receipt',scopeUserIndex:0,status:'done',finishedAt:'2026-10-22T16:20:48Z',args:{callId:'old'},result:{success:true,status:'done'}}]};
 assert.equal(policy.completeWork(s,{outcome:'completed',sourceCallIds:['observed'],summary:'verified without replay'},[{name:'action',confirm:true}]).outcome,'completed');
 delete s.workState.resolution;s.calls[1]={...s.calls[1],name:'read_evidence'};assert.throws(()=>policy.completeWork(s,{outcome:'completed',sourceCallIds:['observed'],summary:'read only'},[{name:'action',confirm:true}]),/本轮成功操作回执/);
});
