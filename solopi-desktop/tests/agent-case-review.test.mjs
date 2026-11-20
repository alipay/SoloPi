import {NativeRuntime,disposeAll} from './fixtures/harness-lifecycle.mjs';
import {boundary as nativeBoundary} from './fixtures/harness-lifecycle.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
test.after(disposeAll);
const require=createRequire(import.meta.url);
const {AgentRuntime}={AgentRuntime:NativeRuntime};
const {AgentStore}=require('../electron/agent/store');
const {reviewSnapshot}=require('../electron/agent/review-events');
const {createTools}=require('../electron/agent/tools');
const wait=async runtime=>nativeBoundary(runtime);
const event=(revision)=>({revision,eventId:`t:${revision}`,caseId:`c${revision}`,caseStatus:'failed'});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'review-'));t.after(async()=>{await disposeAll();fs.rmSync(dir,{recursive:true,force:true})});const store=new AgentStore(()=>dir);const s=store.create();s.status='waiting';s.watch={kind:'task',id:'t',reviewCases:true};store.save(s);const seen=[];const runtime=new AgentRuntime({store,tools:async()=>[],provider:()=>({}),model:async({messages})=>{seen.push(messages.at(-1).content);return{role:'assistant',content:'review completed'};}});runtime.contexts.set(s.id,{});return{store,s,runtime,seen};}
test('next review clears the current failure banner while retaining failed-review evidence',async t=>{
 const f=fixture(t);let turns=0;
 f.runtime.model=async()=>{
  if(++turns===1)throw Object.assign(Error('connection interrupted'),{diagnostics:{category:'disconnected'}});
  const current=f.store.get(f.s.id);assert.equal(current.error,'');assert.equal(current.errorDetails,undefined);
  assert.equal(current.reviewFailures[0].caseId,'c1');
  assert.equal(current.reviewFailures[0].error,'connection interrupted');
  const archived=f.store.readEvidence(f.s.id,current.reviewFailures[0].evidenceId);
  assert.equal(JSON.parse(archived.content).category,'MODEL_FAILED');
  return {role:'assistant',content:'review completed'};
 };
 f.runtime.notify('task','t',{status:'running',caseEvents:[event(1)]});await wait(f.runtime);
 assert.equal(f.store.get(f.s.id).error,'connection interrupted');
 f.runtime.notify('task','t',{status:'running',caseEvents:[event(1),event(2)]});await wait(f.runtime);
 assert.equal(turns,2);assert.equal(f.store.get(f.s.id).error,'');assert.equal(f.store.get(f.s.id).reviewFailures.length,1);
});
test('a failed supplemental conversation is retained without claiming that a case review was missed',async t=>{
 const f=fixture(t);f.runtime.model=async()=>{throw Error('supplement interrupted');};
 await f.runtime.start(f.s.id,'supplement',{});await wait(f.runtime);
 const failure=f.store.get(f.s.id).reviewFailures[0];assert.equal(failure.kind,'conversation');assert.equal(failure.caseId,undefined);
 f.runtime.model=async({messages})=>{f.seen.push(messages.at(-1).content);return {role:'assistant',content:'done'};};
 f.runtime.notify('task','t',{status:'completed',caseEvents:[event(1)]});await wait(f.runtime);
 assert.equal(f.seen.length,2);const terminal=f.seen.at(-1);
 assert.doesNotMatch(terminal,/conversationFailure|reviewFailure|supplement interrupted/);
});
test('each completed case wakes once, active arrivals queue, then final task review',async t=>{const f=fixture(t);f.runtime.notify('task','other',{status:'running',caseEvents:[event(1)]});assert.equal(f.seen.length,0);f.runtime.notify('task','t',{status:'running',caseEvents:[event(1)]});f.runtime.notify('task','t',{status:'running',caseEvents:[event(1),event(2)]});f.runtime.notify('task','t',{status:'running'});await wait(f.runtime);assert.equal(f.seen.length,2);assert.equal(f.store.get(f.s.id).status,'waiting');f.runtime.notify('task','t',{status:'failed',caseEvents:[event(1),event(2)]});await wait(f.runtime);assert.equal(f.seen.length,3);assert.match(f.seen[2],/平台任务完成事件/);assert.equal(f.store.get(f.s.id).status,'idle');});
test('persisted cursor survives restart; stop waiting prevents later reviews',async t=>{const f=fixture(t);f.runtime.notify('task','t',{status:'running',caseEvents:[event(1)]});await wait(f.runtime);const r=new AgentRuntime({store:f.store,tools:async()=>[],provider:()=>({}),model:async()=>({role:'assistant',content:'next'})});r.contexts.set(f.s.id,{});r.notify('task','t',{status:'running',caseEvents:[event(1),event(2)]});await wait(r);assert.equal(f.store.get(f.s.id).reviewCursors.t,2);r.stop(f.s.id);r.notify('task','t',{status:'failed',caseEvents:[event(1),event(2),event(3)]});assert.equal(f.store.get(f.s.id).reviewCursors.t,2);assert.equal(f.store.get(f.s.id).status,'interrupted');});
test('renderer disconnect preserves passive watch and consumes new cases only after UI rebind',async t=>{
 const f=fixture(t);f.runtime.notify('task','t',{status:'running',caseEvents:[event(1)]});await wait(f.runtime);
 f.runtime.disconnect(f.s.id);f.runtime.notify('task','t',{status:'running',caseEvents:[event(1),event(2)]});await wait(f.runtime);
 assert.equal(f.seen.length,1);assert.equal(f.store.get(f.s.id).status,'waiting');assert.equal(f.store.get(f.s.id).watch.reviewCases,true);
 f.runtime.contexts.set(f.s.id,{});f.runtime.resume(f.s.id);await wait(f.runtime);
 assert.equal(f.seen.length,2);assert.equal(f.store.get(f.s.id).reviewCursors.t,2);
});
test('active review lost with its renderer records incomplete analysis without replaying calls on rebind',async t=>{
 const f=fixture(t);let entered;const ready=new Promise(r=>entered=r);let first=true;
 f.runtime.model=async({messages,signal})=>{f.seen.push(messages.at(-1).content);if(first){first=false;entered();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}return {role:'assistant',content:'done'};};
 f.runtime.notify('task','t',{status:'running',caseEvents:[event(1)]});await ready;f.runtime.disconnect(f.s.id);await wait(f.runtime);
 assert.equal(f.store.get(f.s.id).status,'waiting');assert.equal(f.store.get(f.s.id).reviewFailures[0].caseId,'c1');
 f.runtime.notify('task','t',{status:'completed',caseEvents:[event(1),event(2)]});assert.equal(f.runtime.active.size,0);
 f.runtime.contexts.set(f.s.id,{});f.runtime.resume(f.s.id);await wait(f.runtime);
 assert.equal(f.seen.filter(text=>text.startsWith('平台用例完成事件') && text.includes('"revision":1')).length,1);assert.equal(f.seen.length,3);assert.doesNotMatch(f.seen.at(-1),/reviewFailures/);
});
test('80 cancellation artifacts require one terminal review while the actual failure is still reviewed',async t=>{
 const f=fixture(t),events=[event(1),...Array.from({length:80},(_,i)=>({...event(i+2),caseStatus:'stopped'}))];
 f.runtime.notify('task','t',{status:'stopped',caseEvents:events});await wait(f.runtime);
 assert.equal(f.seen.length,2);assert.match(f.seen[0],/"caseStatus":"failed"/);
 assert.match(f.seen[1],/平台任务完成事件/);
 assert.equal(f.store.get(f.s.id).reviewCursors.t,81);assert.equal(f.store.get(f.s.id).status,'idle');
 f.runtime.notify('task','t',{status:'stopped',caseEvents:events});await wait(f.runtime);assert.equal(f.seen.length,2);
});
test('terminal-only watches remain terminal-only',async t=>{const f=fixture(t);f.s.watch.reviewCases=false;f.store.save(f.s);f.runtime.notify('task','t',{status:'running',caseEvents:[event(1)]});assert.equal(f.runtime.active.size,0);});
test('review metadata excludes raw output and reuses durable revisions',()=>{const x=reviewSnapshot({status:'running',taskEvents:[{type:'case_terminal',revision:8,eventId:'t:8',caseId:'c',caseStatus:'failed',results:['PRIVATE_OUTPUT']},{type:'case_artifacts_ready',revision:9}]});assert.equal(x.caseEvents.length,1);assert.equal(x.caseEvents[0].revision,8);assert.doesNotMatch(JSON.stringify(x),/PRIVATE/);});
test('review wakeup carries bounded real failure metadata without raw output, credentials or snapshots',()=>{
 const snapshot=reviewSnapshot({status:'running',taskEvents:[{type:'case_terminal',revision:1,eventId:'t:1',caseId:'c',caseName:'fixture case',caseStatus:'failed',results:[
  {stepId:'a',stepName:'prepare',status:'success',stdout:'PRIVATE_COMMAND_OUTPUT'},
  {stepId:'b',stepName:'assert',status:'failed',error:'apiKey=PRIVATE_TOKEN '+ 'x'.repeat(4000),errorCode:'FIXTURE_TIMEOUT',stdout:'PRIVATE_RESPONSE',meta:{secret:'PRIVATE_SECRET'}},
 ]}]});
 const summary=snapshot.caseEvents[0].caseSummary;
 assert.equal(summary.stepCount,2);assert.equal(summary.successfulSteps,1);assert.equal(summary.firstFailedStep.stepId,'b');
 assert.equal(summary.firstFailedStep.name,'assert');assert.equal(summary.firstFailedStep.errorCode,'FIXTURE_TIMEOUT');assert.equal(summary.firstFailedStep.errorTruncated,true);
 assert.ok(summary.firstFailedStep.error.length<=1024);assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE_/);
});
test('review facts show attempted preparation without implying unreached business steps ran',()=>{
 const task={status:'running',taskEvents:[{type:'case_terminal',revision:1,eventId:'t:1',caseId:'c',caseName:'later business action',caseStatus:'failed',plannedStepCount:27,results:[
  {stepId:'prepare',stepName:'prepare input',status:'success'},
  {stepId:'assert',stepName:'wait for entry',status:'failed',meta:{logTextAssertion:{patternMatched:true,lastExtractedText:'initial',expectedText:'ready',matchOperator:'equals'}}},
 ]}]};
 const summary=reviewSnapshot(task).caseEvents[0].caseSummary;
 assert.equal(summary.plannedStepCount,27);assert.equal(summary.stepCount,2);
 assert.deepEqual(summary.attemptedSteps.map(s=>s.name),['prepare input','wait for entry']);
 assert.equal(summary.firstFailedStep.logTextAssertion.patternMatched,true);assert.equal(summary.firstFailedStep.logTextAssertion.lastExtractedText,'initial');
 delete task.taskEvents[0].plannedStepCount;task.cases=[{caseId:'c',caseSnapshot:{steps:Array.from({length:27},()=>({name:'PRIVATE_UNREACHED'}))}}];
 const recovered=reviewSnapshot(task);assert.equal(recovered.caseEvents[0].caseSummary.plannedStepCount,27);assert.doesNotMatch(JSON.stringify(recovered),/PRIVATE_UNREACHED/);
 task.taskEvents[0].results=Array.from({length:80},(_,i)=>({stepId:'s'+i,stepName:'prepare '+i,status:'success',stdout:'PRIVATE_RAW'}));
 const bounded=reviewSnapshot(task).caseEvents[0].caseSummary;assert.equal(bounded.attemptedSteps.length,16);assert.equal(bounded.attemptedStepsTruncated,true);assert.doesNotMatch(JSON.stringify(bounded),/PRIVATE_RAW/);
});
test('native subscription calls remain explicit and the official concludesTurn drains queued events',async t=>{
 const f=fixture(t);let subscriptions=0,models=0;
 f.runtime.tools=async()=>[{name:'watch_operation',schema:{type:'object'},execute:()=>{subscriptions++;return{success:true,waiting:{kind:'task',id:'t',reviewCases:true}};}}];
 f.runtime.model=async()=>({role:'assistant',content:'review done',tool_calls:[{id:`watch-${++models}`,type:'function',function:{name:'watch_operation',arguments:'{"kind":"task","id":"t","reviewCases":true}'}}]});
 f.runtime.notify('task','t',{status:'running',caseEvents:[event(1),event(2)]});await wait(f.runtime);
 const s=f.store.get(f.s.id);assert.equal(models,2);assert.equal(subscriptions,2);assert.equal(s.reviewCursors.t,2);assert.equal(s.status,'waiting');
 assert.ok(s.calls.every(c=>c.status==='done'));
});
test('explicit watch refresh still queries the backend and does not persist the transient refresh option',async t=>{
 const f=fixture(t);let queries=0;
 const tools=await createTools({invoke:async()=>{queries++;return {success:true,task:{id:'t',status:'running'}};},readState:()=>({}),skillsRoots:()=>[],config:()=>({}),mcp:{}})({});
 f.runtime.tools=async()=>tools;
 f.runtime.model=async()=>({role:'assistant',content:'refresh',tool_calls:[{id:'refresh',type:'function',function:{name:'watch_operation',arguments:'{"kind":"task","id":"t","reviewCases":true,"refresh":true}'}}]});
 f.runtime.notify('task','t',{status:'running',caseEvents:[event(1)]});await wait(f.runtime);
 assert.equal(queries,1);assert.equal(f.store.get(f.s.id).watch.refresh,undefined);
 assert.equal(f.store.get(f.s.id).watch.reviewCases,true);
});
test('watch tool returns existing events so events before subscription are not missed',async()=>{const tools=await createTools({invoke:async()=>({success:true,task:{id:'t',status:'running',taskEvents:[{type:'case_terminal',...event(7)}]}}),readState:()=>({}),skillsRoots:()=>[],config:()=>({}),mcp:{}})({});const result=await tools.find(t=>t.name==='watch_operation').execute({kind:'task',id:'t',reviewCases:true});assert.equal(result.taskSnapshot.caseEvents[0].revision,7);assert.equal(result.waiting.reviewCases,true);});
test('report projection preserves authoritative revisions even when renderer removes raw events',async()=>{const task={id:'t',status:'running',taskEvents:[{type:'case_terminal',...event(42)}],cases:[]};const {createWorkflowTaskRendererDetail}=require('../electron/workflow-task-sync');const reply={success:true,task:createWorkflowTaskRendererDetail(task),reviewSnapshot:reviewSnapshot(task)};assert.equal(reply.task.taskEvents,undefined);const tools=await createTools({invoke:async()=>reply,readState:()=>({}),skillsRoots:()=>[],config:()=>({}),mcp:{}})({});const result=await tools.find(t=>t.name==='watch_operation').execute({kind:'task',id:'t',reviewCases:true});assert.equal(result.taskSnapshot.caseEvents[0].revision,42);});
test('a failed task with pending cases is not a final event',()=>{assert.equal(reviewSnapshot({status:'failed',cases:[{caseId:'a',status:'failed'},{caseId:'b',status:'running'}]}).status,'running');});

test('slow model never blocks case notifications or task completion; reviews drain afterwards', async t => {
  const f = fixture(t);
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  t.after(async()=>{release()});
  f.runtime.model = async ({messages}) => {
    f.seen.push(messages.at(-1).content);
    if (f.seen.length === 1) { entered(); await blocked; }
    return {role:'assistant', content:'review completed'};
  };
  f.runtime.notify('task', 't', {status:'running', caseEvents:[event(1)]});
  await started;
  // The producer can publish every subsequent completion while model 1 is blocked.
  for (let revision = 2; revision <= 4; revision++) {
    assert.equal(f.runtime.notify('task', 't', {
      status: revision === 4 ? 'completed' : 'running', caseEvents:[event(revision)],
    }), undefined);
  }
  assert.equal(f.seen.length, 1);
  assert.equal(f.runtime.events.get('task:t').status, 'completed');
  assert.equal(f.runtime.events.get('task:t').caseEvents.length, 4);
  release();
  await wait(f.runtime);
  assert.equal(f.seen.length, 5);
  for (let i = 0; i < 4; i++) assert.match(f.seen[i], new RegExp(`"revision":${i + 1}`));
  assert.match(f.seen[4], /平台任务完成事件/);
});

test('review failure leaves task events progressing; stopping the task requires explicit tool call', async t => {
  const f = fixture(t);
  const calls = [];
  const tools = await createTools({invoke:async(channel, _event, args)=>{
    calls.push({channel,args}); return {success:true};
  },readState:()=>({}),skillsRoots:()=>[],config:()=>({}),mcp:{}})({});
  f.runtime.tools = async () => tools;
  f.runtime.model = async () => { throw Error('isolated model failure'); };
  f.runtime.notify('task','t',{status:'running',caseEvents:[event(1)]});
  await wait(f.runtime);
  assert.equal(f.store.get(f.s.id).status,'waiting');
  assert.equal(f.store.get(f.s.id).reviewFailures[0].caseId,'c1');
  f.runtime.notify('task','t',{status:'completed',caseEvents:[event(2)]});
  await wait(f.runtime);
  assert.equal(f.runtime.events.get('task:t').status,'completed');
  assert.deepEqual(calls, []);
  await tools.find(tool=>tool.name==='stop_task').execute({taskId:'t'});
  assert.deepEqual(calls,[{channel:'workflow-task:stop',args:{taskId:'t'}}]);
});

test('user message while waiting preserves review subscription and drains cases arriving during the new work',async t=>{
 const f=fixture(t);let release,entered;
 const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 t.after(async()=>{release()});
 f.runtime.model=async({messages})=>{
  const text=messages.at(-1).content;f.seen.push(text);
  if(text==='补充写报告'){entered();await gate;}
  return {role:'assistant',content:'done'};
 };
 await f.runtime.start(f.s.id,'补充写报告',{});await started;
 f.runtime.notify('task','t',{status:'completed',caseEvents:[event(1),event(2)]});
 release();await wait(f.runtime);
 assert.equal(f.seen.length,4);assert.match(f.seen[1],/"revision":1/);assert.match(f.seen[2],/"revision":2/);
 assert.match(f.seen[3],/平台任务完成事件/);assert.equal(f.store.get(f.s.id).reviewCursors.t,2);
});
test('queued steering during active review retains subscription without replaying reviewed cases',async t=>{
 const f=fixture(t);let entered;const started=new Promise(r=>entered=r);let count=0;
 f.runtime.model=async({messages,signal})=>{
  f.seen.push(messages.at(-1).content);
  if(++count===1){entered();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('steered')),{once:true}));}
  return {role:'assistant',content:'done'};
 };
 f.runtime.notify('task','t',{status:'running',caseEvents:[event(1)]});await started;
 await f.runtime.enqueue(f.s.id,'补充要求');const q=f.store.get(f.s.id).queuedMessages[0];
 await f.runtime.steerQueued(f.s.id,q.id,{});
 f.runtime.notify('task','t',{status:'running',caseEvents:[event(1),event(2)]});await wait(f.runtime);
 assert.equal(f.store.get(f.s.id).status,'waiting');assert.equal(f.store.get(f.s.id).watch.reviewCases,true);
 assert.equal(f.store.get(f.s.id).reviewCursors.t,2);
 assert.equal(f.seen.filter(x=>x.includes('"revision":1')).length,1);
 assert.equal(f.seen.filter(x=>x.includes('"revision":2')).length,1);
});
test('invalid review arguments retain subscription, record incomplete review and never replay invalid calls',async t=>{
 const f=fixture(t);let requests=0;
 f.runtime.tools=async()=>[{name:'read',schema:{type:'object',properties:{},additionalProperties:false},execute:()=>assert.fail('invalid call must not execute')}];
 f.runtime.model=async({messages})=>{
  f.seen.push(messages.at(-1).content);requests++;
  return requests<=2?{role:'assistant',content:null,tool_calls:[{id:`invalid-${requests}`,type:'function',function:{name:'read',arguments:'{"x":'}}]}:{role:'assistant',content:'review completed'};
 };
 f.runtime.notify('task','t',{status:'running',caseEvents:[event(1)]});await wait(f.runtime);
 let s=f.store.get(f.s.id);
 assert.equal(requests,3);assert.equal(s.status,'waiting');assert.equal(s.watch.reviewCases,true);
 assert.equal(s.reviewFailures.length,1);assert.equal(s.reviewFailures[0].caseId,'c1');assert.equal(s.reviewFailures[0].revision,1);
 assert.match(s.error,/参数无效|未完成/);
 f.runtime.notify('task','t',{status:'running',caseEvents:[event(1),event(2)]});await wait(f.runtime);
 s=f.store.get(f.s.id);assert.equal(requests,4);assert.equal(s.reviewCursors.t,2);assert.equal(s.status,'waiting');
 f.runtime.notify('task','t',{status:'failed',caseEvents:[event(1),event(2)]});await wait(f.runtime);
 assert.equal(requests,5);assert.doesNotMatch(f.seen.at(-1),/reviewFailure/);assert.match(f.seen.at(-1),/"caseId":"c1"/);
 assert.equal(f.store.get(f.s.id).calls.length,2);assert.equal(f.store.get(f.s.id).status,'idle');
});
test('explicit stop during review stays interrupted and does not recover on later events',async t=>{
 const f=fixture(t);let entered;const started=new Promise(r=>entered=r);
 f.runtime.model=async({signal})=>{entered();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
 f.runtime.notify('task','t',{status:'running',caseEvents:[event(1)]});await started;
 f.runtime.stop(f.s.id);await wait(f.runtime);
 assert.equal(f.store.get(f.s.id).status,'interrupted');assert.equal(f.store.get(f.s.id).reviewFailures,undefined);
 f.runtime.notify('task','t',{status:'running',caseEvents:[event(2)]});assert.equal(f.runtime.active.size,0);
});


test('terminal notice is summarized with first failure and original recording/case records readable after restart',async t=>{
 const f=fixture(t);f.s.watch={kind:'task',id:'t'};f.store.save(f.s);
 const cases=Array.from({length:149},(_,i)=>({...event(i+1),caseSummary:{firstFailedStep:{stepId:'failed-step',error:'KEY_FAILURE',errorCode:'ASSERTION_FAILED'},attemptedSteps:Array.from({length:25},()=>({name:'verbose step',detail:'x'.repeat(200)}))}}));
 f.runtime.notify('task','t',{status:'failed',error:'TASK_KEY_ERROR',caseEvents:cases,recordingSession:{markers:Array(100).fill('ORIGINAL_MARKER')}});await wait(f.runtime);
 const notice=f.seen.at(-1);assert.ok(notice.length<6000,notice.length);assert.match(notice,/KEY_FAILURE/);assert.match(notice,/TASK_KEY_ERROR/);assert.doesNotMatch(notice,/ORIGINAL_MARKER|attemptedSteps/);
 const summary=JSON.parse(notice.slice(notice.indexOf('{')));assert.equal(summary.caseEventCount,149);assert.equal(summary.caseStatusCounts.failed,149);assert.equal(summary.failureExamples.length,2);
 const store=new AgentStore(()=>f.store.directory());const selected=store.projectEvidence(f.s.id,summary.contextRecord.evidenceId,['/caseEvents/148/caseId','/recordingSession/markers/99']);assert.equal(selected.fields[0].matches[0].value,'c149');assert.equal(selected.fields[1].matches[0].value,'ORIGINAL_MARKER');
 let phase=0;f.runtime.model=async({messages})=>{
  if(phase++===0)return {role:'assistant',content:null,tool_calls:[{id:'context-lookup',type:'function',function:{name:'read_context_record',arguments:JSON.stringify({evidenceId:summary.contextRecord.evidenceId,pointers:['/recordingSession/markers/99']})}}]};
  const result=JSON.parse(messages.at(-1).content);assert.equal(result.fields[0].matches[0].value,'ORIGINAL_MARKER');return {role:'assistant',content:'read confirmed'};
 };await f.runtime.start(f.s.id,'inspect original context record',{});await wait(f.runtime);assert.equal(phase,2);

});


test('notification evidence storage failure does not consume review cursor or clear its subscription',async t=>{
 const f=fixture(t);const write=f.store.saveEvidence.bind(f.store);f.store.saveEvidence=()=>{throw Object.assign(Error('fixture write failed'),{code:'ENOSPC'});};
 f.runtime.notify('task','t',{status:'running',caseEvents:[event(1)]});await wait(f.runtime);
 const saved=f.store.get(f.s.id);assert.equal(saved.watch.id,'t');assert.equal(saved.reviewCursors?.t,undefined);assert.match(saved.error,/ENOSPC/);assert.equal(f.seen.length,0);
 f.store.saveEvidence=write;f.runtime.resume(f.s.id);await wait(f.runtime);assert.equal(f.seen.length,1);assert.equal(f.store.get(f.s.id).reviewCursors.t,1);
});

test('terminal callback excludes historical assistant failures from another task and preserves execution evidence',async t=>{
 const f=fixture(t);
 const prior=[{kind:'case',caseId:'old-case',revision:146,error:'old model timeout',evidenceId:'old-review'},{kind:'conversation',error:'old TPM limit',evidenceId:'old-chat'}];
 f.s.reviewFailures=prior;f.s.watch={kind:'task',id:'new-task',reviewCases:false};f.store.save(f.s);
 const receipt={schemaVersion:'glassbox.task.result.v1',taskId:'new-task',status:'success',executionComplete:true,counts:{total:1,success:1,failed:0}};
 f.runtime.notify('task','new-task',{status:'success',executionReceipt:receipt,caseEvents:[{caseId:'new-case',revision:1,caseStatus:'success'}],reviewFailures:prior,conversationFailures:prior});await wait(f.runtime);
 const text=f.seen.at(-1);assert.match(text,/new-task/);assert.match(text,/"success":1/);assert.doesNotMatch(text,/reviewFailure|conversationFailure|old model|old TPM|old-case/);
 const payload=JSON.parse(text.slice(text.indexOf('{')));const evidence=JSON.parse(f.store.readEvidence(f.s.id,payload.contextRecord.evidenceId).content);
 assert.equal(evidence.executionReceipt.taskId,'new-task');assert.equal(evidence.caseEvents[0].caseId,'new-case');assert.equal(evidence.reviewFailures,undefined);assert.equal(evidence.conversationFailures,undefined);
 assert.deepEqual(f.store.get(f.s.id).reviewFailures,prior);assert.deepEqual(payload.contextRecord.pointers,['/executionReceipt','/caseEvents','/recordingSession']);
});
