import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
if(!zlib.createZstdCompress){
  test('official Harness persistence regressions on the desktop Node runtime',()=>{
    const env={...process.env,ELECTRON_RUN_AS_NODE:'1'};delete env.NODE_TEST_CONTEXT;
    const r=spawnSync(require('electron'),['--test',new URL(import.meta.url).pathname],{env,encoding:'utf8',timeout:90000});
    assert.equal(r.status,0,r.stdout+r.stderr);
    assert.match(r.stdout,/official file tool reads/);
  });
}else{
  const {LlmAdapter,isAgentLoopRequest}=await import('@deepseek-ai/dsh-llm');
  const {createHarnessHost}=await import('../electron/agent/harness-host.mjs');
  const {HarnessRuntime}=require('../electron/agent/harness-runtime');
  const {AgentStore}=require('../electron/agent/store');
  class Script extends LlmAdapter{
    constructor(steps){super();this.steps=steps;this.requests=[];}
    async *stream(options){this.requests.push(options);const reply=await this.steps.shift()(options);const blocks=Array.isArray(reply)?reply:[{type:'text',text:reply}];for(const [index,block] of blocks.entries()){yield{type:'block-start',index,blockType:block.type};yield{type:'block-end',index,block};}yield{type:'finish',reason:blocks.some(b=>b.type==='tool-call')?'tool-calls':'stop'};}
  }
  function largeHistory(legacySeed){
    const base=legacySeed([{role:'user',content:'historical'}]);
    const user=base.find(e=>e.type==='user/message');
    return [...base.slice(0,3),...Array.from({length:32},(_,i)=>({...structuredClone(user),data:{...structuredClone(user.data),content:[{type:'text',text:`history ${i} receipt:saved-42 constraint:no-replay `+'archive '.repeat(6000)}]}})),{type:'request/header',time:Date.now(),data:{header:{config:{provider:'configured',model:'fixture'}},reason:'initial'}},...base.slice(4)].map((e,seq)=>({...e,seq}));
  }
  const call=(name,args,id='call-1')=>({type:'tool-call',id,name,arguments:typeof args==='string'?args:JSON.stringify(args)});
  const schema={type:'object',properties:{},additionalProperties:false};
  function fixture(t,steps,tools=[]){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-harness-'));const store=new AgentStore(()=>dir);const s=store.create();s.approvalMode='auto';store.save(s);const adapter=new Script(steps);const runtime=new HarnessRuntime({store,provider:async()=>({model:'fixture'}),tools:async()=>tools,adapter});t.after(async()=>{await runtime.stopAll();fs.rmSync(dir,{recursive:true,force:true});});return {runtime,store,s,adapter,dir};}
  async function settled(runtime,id){await runtime.hosts.get(id).idle();await new Promise(r=>setImmediate(r));return runtime.liveSessions.get(id);}
  test('CLI progress reaches assistant stream before model completion without duplicated text',{timeout:5000},async t=>{
    let release,seen;const gate=new Promise(r=>release=r),first=new Promise(r=>seen=r);let complete=false,failure;
    const h=await createHarnessHost({system:'fixture',id:'cli-progress',provider:{model:'fixture'},compaction:false,model:async({onProgress})=>{onProgress({type:'text-delta',text:'Visible progress'});await gate;complete=true;return{content:'Visible progress',tool_calls:[]};},onError:e=>{failure=e;seen();},onStream:({frame})=>{if(frame.type==='chunk'&&frame.chunk.type==='text-delta')seen();}});
    t.after(()=>h.dispose());h.send('test');try{await first;assert.equal(failure,undefined);assert.equal(complete,false);}finally{release();}await h.idle();const last=h.agent.session.deriveMessages().at(-1);assert.equal(last.content.filter(b=>b.type==='text').map(b=>b.text).join(''),'Visible progress');
  });
  test('submitted user message is visible before model preparation settles and is never duplicated',async t=>{
    let release;const blocked=new Promise(resolve=>{release=resolve;});
    const f=fixture(t,[async()=>{await blocked;return 'finished';}]);
    try{
      await f.runtime.start(f.s.id,'keep my latest instruction visible',{});
      const pending=f.runtime.liveSessions.get(f.s.id);
      assert.equal(pending.messages.filter(m=>m.role==='user'&&m.content==='keep my latest instruction visible').length,1);
      assert.equal(f.store.get(f.s.id).messages.at(-1).content,'keep my latest instruction visible');
      assert.ok(pending.turnMetrics.startedAt>Date.now()-10000);
    }finally{release();}
    const done=await settled(f.runtime,f.s.id);
    assert.equal(done.messages.filter(m=>m.role==='user').length,1);
  });
  test('upstream drives tool results and completion without local work-state/Skill gates',async t=>{
    let executed=0;const f=fixture(t,[()=>[call('read_fixture',{})],o=>{assert.match(JSON.stringify(o.messages),/receipt/);assert.ok(!o.tools.some(t=>t.name==='finish_work'||t.name==='update_work_state'));return '完成';}],[{name:'read_fixture',description:'read',schema,execute:async()=>{executed++;return{success:true,receipt:'receipt'};}}]);
    f.s.workState={objective:'old',phase:'unfinished'};f.s.skillUpdates={old:{success:false}};f.store.save(f.s);
    await f.runtime.start(f.s.id,'read',{});const s=await settled(f.runtime,f.s.id);assert.equal(executed,1);assert.equal(s.status,'idle');assert.equal(s.messages.at(-1).content,'完成');assert.equal(s.calls.at(-1).status,'done');
  });
  test('interruption recovery remains model context without appearing as a user bubble or authorization scope',async t=>{
    const f=fixture(t,[o=>{assert.match(JSON.stringify(o.messages),/lastInterruption/);return 'continued';}]);
    f.s.lastInterruption={category:'error',lastCompletedCallId:'prior-call',partialOutputValidated:false};f.store.save(f.s);
    await f.runtime.start(f.s.id,'continue the investigation',{});const s=await settled(f.runtime,f.s.id);
    assert.deepEqual(s.messages.filter(m=>m.role==='user').map(m=>m.content),['continue the investigation']);
    assert.ok(s.lastInterruption.resumedAt);
    const h=f.runtime.hosts.get(s.id);const events=[];
    for(let seq=0;seq<h.agent.session.seq;seq++){const e=h.agent.session.eventAt(seq);if(e.type==='user/message')events.push(e.data);}
    const recovery=events.find(m=>JSON.stringify(m.content).includes('lastInterruption'));
    assert.equal(recovery.source.kind,'solopi-context');
    // Replay durable events after a lost UI checkpoint, without calling a model.
    await f.runtime.stopAll();s.messages=[];s.harnessProjectionSeq=-1;f.store.save(s);
    const restored=new HarnessRuntime({store:f.store,provider:async()=>({model:'fixture'}),tools:async()=>[],adapter:new Script([])});
    try{await restored.host(s,{});
      assert.deepEqual(s.messages.filter(m=>m.role==='user').map(m=>m.content),['continue the investigation']);
    }finally{await restored.stopAll();}
  });
  test('error-only tool responses stay failed while successful report reads may contain business errors',async t=>{
    const f=fixture(t,[()=>[call('read_error',{},'error'),call('read_report',{},'report'),call('read_is_error',{},'flag')],()=> 'verified'],[
      {name:'read_error',description:'read',schema,execute:async()=>({error:'retrieval failed'})},
      {name:'read_report',description:'read',schema,execute:async()=>({success:true,error:'business assertion failed',caseStatus:'failed'})},
      {name:'read_is_error',description:'read',schema,execute:async()=>({isError:true,message:'retrieval failed'})}
    ]);await f.runtime.start(f.s.id,'read',{});const s=await settled(f.runtime,f.s.id);
    assert.deepEqual(s.calls.map(c=>c.status),['failed','done','failed']);assert.equal(s.calls[0].result.error,'retrieval failed');assert.equal(s.calls[1].result.caseStatus,'failed');
  });
  test('unrepaired arguments end visibly incomplete without prose heuristics or forced retries',async t=>{
    let ran=0;const f=fixture(t,[()=>[call('repair','{"value":','bad'),call('sibling',{},'good')],()=> '现在我来核实实际值'],[
      {name:'repair',description:'repair',schema:{type:'object',required:['value'],properties:{value:{type:'integer'}}},execute:async()=>{ran++;}},
      {name:'sibling',description:'read',schema,execute:async()=>({success:true})}
    ]);await f.runtime.start(f.s.id,'verify',{});const s=await settled(f.runtime,f.s.id);
    assert.equal(s.status,'interrupted');assert.equal(s.errorDetails.code,'UNRESOLVED_TOOL_ARGUMENTS');assert.equal(ran,0);assert.equal(f.adapter.requests.length,2);assert.equal(s.calls.filter(c=>c.status==='done').length,1);
  });
  for(const outcome of ['success','unknown','preflight'])test('durable operation boundary handles '+outcome+' without duplicate side effects',async t=>{
    let dispatched=0;const f=fixture(t,[()=>[call('submit_fixture',{},'first')],()=>[call('submit_fixture',{},'second')],()=> 'verified'],[
      {name:'submit_fixture',description:'submit',schema,operationReceipt:{kind:'fixture',key:()=>({selection:'same'}),lookupId:id=>'task-'+id},execute:async()=>{dispatched++;if(outcome!=='success'&&dispatched===1)throw Object.assign(Error('fixture'),outcome==='preflight'?{submissionOutcome:'not-submitted'}:{});return{success:true,taskId:'task-one'};}}
    ]);await f.runtime.start(f.s.id,'submit once',{});const s=await settled(f.runtime,f.s.id);
    assert.equal(dispatched,outcome==='preflight'?2:1);assert.equal(s.status,'idle');
    if(outcome==='success')assert.equal(s.calls[1].result.reused,true);
    if(outcome==='unknown')assert.equal(s.calls[1].result.code,'OPERATION_OUTCOME_UNKNOWN');
  });
  for(const selection of ['caseIds','selectionId','libraryId'])test('real desktop submit schema and idempotency accept '+selection,async t=>{
    const state={cases:[{id:'a',libraryId:'lib',steps:[],defaults:{}}],caseLibraries:[{id:'lib',name:'fixture'}],components:[]};let submissions=0;
    const {createTools}=require('../electron/agent/tools');
    const tools=await createTools({readState:()=>state,config:()=>({}),skillsRoots:()=>[],mcp:{},invoke:async(channel,_event,p)=>{if(channel==='workflow:validate-task-selection')return{success:true};if(channel==='workflow-task:submit'){submissions++;return{success:true,taskId:p.taskId,task:{taskType:'regular',caseIds:p.caseIds}};}throw Error(channel);}})({sender:{id:1}});
    const listed=await tools.find(t=>t.name==='list_cases').execute({libraryId:'lib'});
    const args=selection==='caseIds'?{caseIds:['a']}:selection==='selectionId'?{selectionId:listed.selectionId}:{libraryId:'lib',expectedCaseCount:1};
    const f=fixture(t,[()=>[call('submit_task',args,'first')],()=>[call('submit_task',{...args,taskName:'renamed only'},'second')],()=> 'done'],tools);
    await f.runtime.start(f.s.id,'submit once',{});const s=await settled(f.runtime,f.s.id);assert.equal(s.status,'idle',s.error);assert.equal(submissions,1);assert.equal(s.calls[1].result.reused,true);assert.equal(s.calls[0].result.taskId,s.calls[1].result.taskId);
  });
  test('real desktop mixed selectors fail JSON Schema before approval or submission',async t=>{
    let submissions=0;const {createTools}=require('../electron/agent/tools');const tools=await createTools({readState:()=>({cases:[{id:'a'}]}),config:()=>({}),skillsRoots:()=>[],mcp:{},invoke:async()=>{submissions++;return{success:true};}})({});
    const f=fixture(t,[()=>[call('submit_task',{caseIds:['a'],libraryId:'lib',expectedCaseCount:1})],()=> 'cannot complete invalid selection'],tools);f.s.approvalMode='ask';f.store.save(f.s);await f.runtime.start(f.s.id,'submit',{});const s=await settled(f.runtime,f.s.id);assert.equal(s.status,'interrupted');assert.equal(submissions,0);assert.equal(f.runtime.approvals.size,0);assert.equal(s.calls[0].status,'failed');
  });
  test('stop during platform host preparation cannot send a late model request',async t=>{
    const f=fixture(t,[()=> 'must not run']);let release,entered;const ready=new Promise(r=>entered=r);f.runtime.provider=async()=>{entered();await new Promise(r=>release=r);return{model:'fixture'};};f.s.status='waiting';f.s.watch={kind:'task',id:'target'};f.store.save(f.s);f.runtime.contexts.set(f.s.id,{});
    f.runtime.notify('task','target',{status:'completed'});await ready;f.runtime.stop(f.s.id);release();await new Promise(r=>setTimeout(r,40));for(let i=0;i<100&&f.runtime.active.size;i++)await new Promise(r=>setTimeout(r,5));assert.equal(f.adapter.requests.length,0);assert.equal(f.store.get(f.s.id).status,'interrupted');assert.equal(f.runtime.active.size,0);
  });
  test('stopping a parked platform notice never converts it into a human queued instruction',async t=>{
    const f=fixture(t,[]);f.runtime.liveSessions.set(f.s.id,f.s);const h=await f.runtime.host(f.s,{});const {userInput}=await import('../electron/agent/harness-host.mjs');h.agent.send(userInput('platform notice','platform'),'next-turn',false);f.runtime.stop(f.s.id);assert.equal(f.s.queuedMessages?.length||0,0);assert.equal(h.agent.inbox.hasPending,false);assert.equal(f.adapter.requests.length,0);
  });
  for(const scenario of ['same-batch-valid-sibling','two-rejected-one-repair','failed-retry-then-repair'])test('native unresolved argument projection: '+scenario,async t=>{
    let runs=0;const bad=id=>call('work','{"value":',id),good=id=>call('work',{value:1},id);
    const steps=scenario==='same-batch-valid-sibling'?[()=>[bad('bad'),good('sibling')],()=> 'inspect next']:scenario==='two-rejected-one-repair'?[()=>[bad('bad1'),bad('bad2')],()=>[good('fixed1')],()=> 'inspect next']:[()=>[bad('bad1')],()=>[bad('retry-bad')],()=>[good('fixed')],()=> 'done'];
    const f=fixture(t,steps,[{name:'work',description:'work',schema:{type:'object',required:['value'],properties:{value:{type:'integer'}}},execute:()=>{runs++;return{success:true};}}]);await f.runtime.start(f.s.id,'execute requested work',{});const s=await settled(f.runtime,f.s.id);assert.equal(runs,1);assert.equal(s.status,scenario==='failed-retry-then-repair'?'idle':'interrupted');if(scenario!=='failed-retry-then-repair')assert.equal(s.errorDetails.pending.length,1);
  });
  test('reused provider call IDs cannot reuse task identities or target an old approval',async t=>{
    const ids=[];const f=fixture(t,[()=>[call('job',{},'reused')],()=> 'first',()=>[call('job',{},'reused')],()=> 'second'],[{name:'job',description:'job',schema,confirm:true,operationReceipt:{kind:'job',key:a=>a,lookupId:id=>'job-'+id},execute:async(_a,c)=>{ids.push(c.operationId);return{success:true,taskId:'job-'+c.operationId};}}]);f.s.approvalMode='ask';f.store.save(f.s);
    for(const text of ['first user request','new user request']){await f.runtime.start(f.s.id,text,{});for(let i=0;i<100&&!f.runtime.approvals.size;i++)await new Promise(r=>setTimeout(r,5));const s=f.runtime.liveSessions.get(f.s.id),pending=s.calls.findLast(c=>c.status==='pending');assert.ok(pending);assert.ok(f.runtime.approvals.has(pending.id));await f.runtime.approve(s.id,pending.id,true);await settled(f.runtime,s.id);}
    assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1]);assert.ok(ids.every(id=>/^[0-9a-f-]{36}$/.test(id)));const saved=f.store.get(f.s.id);assert.notEqual(saved.calls[0].result.taskId,saved.calls[1].result.taskId);
    f.adapter.steps.push(()=>[call('read_operation_receipt',{callId:'reused'},'lookup')],()=> 'ambiguous',()=>[call('read_operation_receipt',{callId:saved.calls[0].id},'lookup')],()=> 'exact');await f.runtime.start(f.s.id,'lookup duplicate alias',{});await settled(f.runtime,f.s.id);assert.equal(f.store.get(f.s.id).calls[2].result.code,'AMBIGUOUS_OPERATION_RECEIPT');await f.runtime.start(f.s.id,'lookup unique operation',{});await settled(f.runtime,f.s.id);const last=f.store.get(f.s.id).calls.at(-1).result;assert.equal(last.operationId,saved.calls[0].id);assert.equal(last.result.taskId,saved.calls[0].result.taskId);assert.equal(ids.length,2);
  });
  test('invalid JSON is upstream tool feedback; valid sibling is not replayed',async t=>{
    const ids=[];const f=fixture(t,[()=>[call('read_fixture',{},'good'),call('read_fixture','{"x":','bad')],()=>[call('read_fixture',{},'repaired')],()=> 'done'],[{name:'read_fixture',description:'read',schema,execute:async(_a,c)=>{ids.push(c.modelCallId);return{success:true};}}]);await f.runtime.start(f.s.id,'read',{});const s=await settled(f.runtime,f.s.id);assert.deepEqual(ids,['good','repaired']);assert.equal(s.status,'idle');assert.ok(s.calls.some(c=>c.modelCallId==='bad'&&c.status==='failed'));
  });
  test('ask-mode waits for the actual UI approval; rejection cannot dispatch',async t=>{
    let writes=0;const f=fixture(t,[()=>[call('write_fixture',{})],()=> 'denied'],[{name:'write_fixture',description:'write',schema,confirm:true,execute:async()=>{writes++;return{success:true};}}]);f.s.approvalMode='ask';f.store.save(f.s);await f.runtime.start(f.s.id,'write',{});for(let i=0;i<40&&!f.runtime.approvals.size;i++)await new Promise(r=>setTimeout(r,5));const s=f.runtime.liveSessions.get(f.s.id);assert.equal(s.status,'awaiting_approval');await f.runtime.approve(s.id,s.calls.at(-1).id,false);await settled(f.runtime,s.id);assert.equal(writes,0);
  });
  test('stop aborts the running tool and never dispatches the next write',async t=>{
    let writes=0;const f=fixture(t,[()=>[call('wait_fixture',{},'wait'),call('write_fixture',{},'write')]],[{name:'wait_fixture',description:'wait',schema,execute:async(_a,{signal})=>{await new Promise(r=>{signal.addEventListener('abort',r,{once:true});});signal.throwIfAborted();}},{name:'write_fixture',description:'write',schema,execute:async()=>{writes++;return{success:true};}}]);await f.runtime.start(f.s.id,'wait',{});for(let i=0;i<50&&!f.runtime.liveSessions.get(f.s.id).calls.some(c=>c.status==='running');i++)await new Promise(r=>setTimeout(r,5));f.runtime.stop(f.s.id);await settled(f.runtime,f.s.id);assert.equal(writes,0);assert.equal(f.runtime.liveSessions.get(f.s.id).status,'interrupted');
  });
  test('official JSONL restart preserves receipts without replaying tools',async t=>{
    let writes=0;const f=fixture(t,[()=>[call('write_fixture',{})],()=> 'done',o=>{assert.match(JSON.stringify(o.messages),/saved-once/);return 'already done';}],[{name:'write_fixture',description:'write',schema,execute:async()=>{writes++;return{success:true,receipt:'saved-once'};}}]);await f.runtime.start(f.s.id,'write',{});await settled(f.runtime,f.s.id);await f.runtime.hosts.get(f.s.id).dispose();f.runtime.hosts.clear();f.runtime.liveSessions.clear();await f.runtime.start(f.s.id,'check prior result',{});const s=await settled(f.runtime,f.s.id);assert.equal(writes,1);assert.equal(s.messages.at(-1).content,'already done');
  });
  test('steering arrives through the upstream inbox at a tool boundary',async t=>{
    let release;const f=fixture(t,[()=>[call('read_fixture',{})],o=>{assert.match(JSON.stringify(o.messages),/new direction/);return 'steered';}],[{name:'read_fixture',description:'read',schema,execute:async()=>{await new Promise(r=>release=r);return{success:true};}}]);await f.runtime.start(f.s.id,'read',{});for(let i=0;i<50&&!release;i++)await new Promise(r=>setTimeout(r,5));await f.runtime.start(f.s.id,'new direction',{});release();const s=await settled(f.runtime,f.s.id);assert.equal(s.messages.at(-1).content,'steered');
  });
  test('case identity/status/times remain exact through tool projection',async t=>{
    const row={taskId:'task-fixture',caseOrdinal:17,caseId:'id17',name:'target',status:'failed',startedAt:'2026-10-22T16:41:29.989Z',error:'expected MovieShowtimes actual OrderPreview'};
    const f=fixture(t,[()=>[call('read_case_results',{caseOrdinal:17})],o=>{const last=o.messages.at(-1);assert.deepEqual(JSON.parse(last.content[0].text),row);return 'target #17 failed';}],[{name:'read_case_results',description:'read',schema:{type:'object',properties:{caseOrdinal:{type:'integer'}},required:['caseOrdinal']},execute:async()=>row}]);await f.runtime.start(f.s.id,'explain case17',{});const s=await settled(f.runtime,f.s.id);assert.equal(s.calls[0].result.caseOrdinal,17);assert.equal(s.calls[0].result.status,'failed');
  });
  test('official file tool reads tool-produced paths directly, including spaces',async t=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'harness files '));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    const file=path.join(dir,'case17.log');fs.writeFileSync(file,'case17 OrderPreview\n');
    const adapter=new Script([()=>[call('read',{file_path:file})],o=>{assert.match(JSON.stringify(o.messages),/case17 OrderPreview/);return 'read';}]);
    let error;const h=await createHarnessHost({id:'file-test',provider:{model:'fixture'},cwd:dir,system:'read',adapter,onError:e=>error=e});t.after(()=>h.dispose());h.send('read the file');await h.idle();assert.equal(error,undefined);assert.match(h.agent.session.deriveMessages().at(-1).content[0].text,/read/);
  });
  test('official skill loader publishes enabled catalog without stale-read gates',async t=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'harness-skills-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(dir,'SKILL.md'),'---\nname: fixture-skill\ndescription: fixture\n---\nFixture instructions.\n');
    const adapter=new Script([o=>{assert.ok(o.tools.some(t=>t.name==='skill'));return [call('skill',{name:'fixture-skill'})];},o=>{assert.match(JSON.stringify(o.messages),/Fixture instructions/);return 'loaded';}]);
    let error;const h=await createHarnessHost({id:'skill-test',provider:{model:'fixture'},system:'test',cwd:dir,skillCatalog:()=>[{name:'fixture-skill',description:'fixture',directory:dir}],adapter,onError:e=>error=e});t.after(()=>h.dispose());h.send('use skill');await h.idle();assert.equal(error,undefined);assert.equal(h.agent.session.deriveMessages().at(-1).content[0].text,'loaded');
  });
  test('the complete desktop tool catalog registers in the official tool service',async t=>{
    const {createTools}=require('../electron/agent/tools');const tools=await createTools({readState:()=>({}),config:()=>({}),skillsRoots:()=>[],mcp:{},invoke:async()=>({}),commandDirectory:()=>os.tmpdir()})(null,new AbortController().signal);
    const h=await createHarnessHost({id:'catalog-test',provider:{model:'fixture'},system:'test',tools,adapter:new Script([()=> 'ok'])});t.after(()=>h.dispose());h.send('hello');await h.idle();assert.ok(h.ctx.tools.schemas().length>40);
  });
  test('editing a queued prompt parks it through idle, then sends the saved text once',async t=>{
    let release;const f=fixture(t,[async()=>{await new Promise(r=>release=r);return 'first';},o=>{assert.match(JSON.stringify(o.messages),/edited prompt/);return 'second';}]);
    await f.runtime.start(f.s.id,'first',{});for(let i=0;i<40&&!release;i++)await new Promise(r=>setTimeout(r,5));
    await f.runtime.enqueue(f.s.id,'draft');const id=f.s.id,s=f.runtime.liveSessions.get(id),qid=s.queuedMessages[0].id;
    f.runtime.editQueued(id,qid,{editing:true});release();await settled(f.runtime,id);assert.equal(f.adapter.requests.length,1);assert.equal(s.queuedMessages[0].editing,true);
    f.runtime.editQueued(id,qid,{text:'edited prompt',editing:false});await settled(f.runtime,id);assert.equal(f.adapter.requests.length,2);assert.equal(s.queuedMessages.length,0);
  });
  test('native JSONL repairs UI state missed after a durable assistant commit',async t=>{
    const f=fixture(t,[()=> 'durable answer',()=> 'restored']);await f.runtime.start(f.s.id,'first',{});await settled(f.runtime,f.s.id);
    const s=f.store.get(f.s.id);const m=s.messages.pop();assert.equal(m.content,'durable answer');s.harnessProjectionSeq-=3;f.store.save(s);
    await f.runtime.hosts.get(s.id).dispose();f.runtime.hosts.clear();f.runtime.liveSessions.clear();await f.runtime.start(s.id,'continue',{});const restored=await settled(f.runtime,s.id);assert.equal(restored.messages.filter(m=>m.content==='durable answer').length,1);
  });
  test('images are admitted into the official durable attachment store',async t=>{
    const f=fixture(t,[o=>{assert.ok(o.messages.some(m=>m.content.some(b=>b.type==='image')));return 'seen';}]);
    const file=path.join(f.dir,'input.png');await require('sharp')({create:{width:2,height:2,channels:3,background:'#ffffff'}}).png().toFile(file);
    await f.runtime.start(f.s.id,'inspect',{},[{path:file,name:'input.png',mime:'image/png',size:fs.statSync(file).size}]);const s=await settled(f.runtime,f.s.id);assert.equal(s.messages[0].attachments[0].path,file);assert.equal(s.messages.at(-1).content,'seen');
  });
  test('large tool output is pruned by the upstream engine, without changing its durable receipt',async t=>{
    const events=[];const adapter=new Script([()=>[call('read_large',{})],o=>{assert.ok(JSON.stringify(o.messages).includes('x'.repeat(40000)));return [call('tick',{})];},o=>{assert.match(JSON.stringify(o.messages),/tool result middle pruned/);return 'done';}]);
    adapter.resolveModel=async(provider,id)=>({provider,id,name:id,context:{contextWindow:131072},defaultMaxTokens:16384});
    const h=await createHarnessHost({id:'large-test',provider:{model:'fixture',requestPolicy:{inputBudgetTokens:262144}},system:'test',adapter,tools:[{name:'tick',description:'tick',schema,execute:()=>({ok:true})},{name:'read_large',description:'read',schema,execute:async()=>({data:'x'.repeat(40000)})}],onEvent:e=>events.push(e)});t.after(()=>h.dispose());h.send('read');await h.idle();assert.ok(events.some(e=>e.type==='compaction/prune'));const original=events.find(e=>e.type==='tool/result');assert.equal(JSON.parse(original.data.message.content[0].text).data.length,40000);
  });
  test('a model selection change rebuilds the provider host while preserving native history',async t=>{
    const f=fixture(t,[()=> 'first',o=>{assert.equal(o.model,'changed');assert.match(JSON.stringify(o.messages),/first/);return 'second';}]);let model='fixture';f.runtime.provider=async()=>({model});
    await f.runtime.start(f.s.id,'first question',{});await settled(f.runtime,f.s.id);model='changed';await f.runtime.start(f.s.id,'second question',{});const s=await settled(f.runtime,f.s.id);assert.equal(s.messages.at(-1).content,'second');assert.equal(f.runtime.hosts.get(s.id).agent.options.model,'changed');
  });
  test('changed deadline policy rebuilds an idle host and preserves completed history',async t=>{
    const f=fixture(t,[()=> 'saved answer',o=>{assert.match(JSON.stringify(o.messages),/saved answer/);return 'continued';}]);
    let policy={firstResponseSeconds:45,idleSeconds:45,totalSeconds:180};
    f.runtime.provider=async()=>({model:'fixture',requestPolicy:{...policy}});
    await f.runtime.start(f.s.id,'first',{});await settled(f.runtime,f.s.id);
    const previous=f.runtime.hosts.get(f.s.id);
    assert.equal(await f.runtime.host(f.s,{}),previous,'unchanged policy reuses idle host');
    policy={firstResponseSeconds:5,idleSeconds:5,totalSeconds:10};
    await f.runtime.start(f.s.id,'continue',{});const s=await settled(f.runtime,f.s.id);
    assert.notEqual(f.runtime.hosts.get(f.s.id),previous);
    assert.deepEqual(f.runtime.hosts.get(f.s.id).provider.requestPolicy,policy);
    assert.equal(s.messages.at(-1).content,'continued');
  });
  test('invalid write arguments return feedback before asking for approval',async t=>{
    let writes=0;const f=fixture(t,[()=>[call('write_fixture',{unexpected:true})],()=> 'invalid input'],[{name:'write_fixture',description:'write',schema,confirm:true,execute:async()=>{writes++;return{success:true};}}]);f.s.approvalMode='ask';f.store.save(f.s);await f.runtime.start(f.s.id,'write',{});const s=await settled(f.runtime,f.s.id);assert.equal(writes,0);assert.equal(f.runtime.approvals.size,0);assert.equal(s.calls.at(-1).status,'failed');assert.equal(s.status,'interrupted');assert.equal(s.errorDetails.code,'UNRESOLVED_TOOL_ARGUMENTS');
  });
  test('legacy operation receipt queries retain the exact call identity and never repeat it',async t=>{
    const f=fixture(t,[()=>[call('read_operation_receipt',{callId:'original-write'})],o=>{const receipt=JSON.parse(o.messages.at(-1).content[0].text);assert.equal(receipt.callId,'original-write');assert.equal(receipt.status,'done');assert.equal(receipt.result.receipt,'already-saved');return 'verified';}]);
    f.s.calls.push({id:'legacy-row',modelCallId:'original-write',name:'write_fixture',status:'done',result:{success:true,receipt:'already-saved'}});f.store.save(f.s);
    await f.runtime.start(f.s.id,'check old operation',{});const s=await settled(f.runtime,f.s.id);assert.equal(s.status,'idle');assert.equal(s.calls.length,2);assert.equal(s.calls.at(-1).result.callId,'original-write');
  });
  test('large-window history compacts before 180k pressure and keeps receipts plus recent constraints',async t=>{
    const {legacySeed}=await import('../electron/agent/harness-host.mjs');
    const seed=largeHistory(legacySeed);
    const records=[],events=[];let failure;
    let h,resumed;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'compact-checkpoint-'));t.after(async()=>{if(resumed)await resumed.dispose();else if(h)await h.dispose();fs.rmSync(dir,{recursive:true,force:true});});
    const {isAgentLoopRequest}=await import('@deepseek-ai/dsh-llm');
    const summary=o=>{assert.match(JSON.stringify(o.messages),/saved-42/);assert.ok(JSON.stringify(o.messages).length<300000);return 'Goal: continue. Constraint: no-replay. Operation receipt saved-42 already succeeded; do not execute again.';};
    const adapter=new Script([]);
    adapter.stream=async function*(o){this.requests.push(o);const value=o.tools?.length?'continued safely':summary(o);if(o.tools?.length){const body=JSON.stringify(o.messages);assert.match(body,/recent constraint|resume/);assert.match(body,/no-replay/);assert.ok(body.length<400000);}yield{type:'block-start',index:0,blockType:'text'};yield{type:'block-end',index:0,block:{type:'text',text:value}};yield{type:'finish',reason:'stop'};};
    adapter.resolveModel=async(provider,id)=>({provider,id,name:id,context:{contextWindow:1048576},defaultMaxTokens:16384});
    h=await createHarnessHost({id:'compact-large',provider:{model:'fixture'},system:'test',seed,adapter,persistenceDirectory:dir,onModel:r=>records.push(r),onEvent:e=>events.push(e),onError:e=>failure=e});
    h.send('recent constraint: do not repeat saved operations');await h.idle();
    assert.equal(failure,undefined);assert.ok(adapter.requests.length>2,JSON.stringify(records));
    const priorRequests=adapter.requests.length;
    assert.ok(events.some(e=>e.type==='compaction/summary'));assert.ok(events.some(e=>e.type==='compaction/end'&&!e.data.error));
    const compact=records.find(e=>e.event==='context.compaction'&&e.outcome==='completed');assert.ok(compact,JSON.stringify(records));
    assert.ok(compact.beforeTokensEstimate>180000);assert.ok(compact.afterTokensEstimate<50000);assert.equal(compact.thresholdTokens,180000);assert.equal(compact.retainTokens,24000);
    assert.ok(h.agent.session.eventAt(3).data.content[0].text.includes('archive '));
    await h.dispose();adapter.steps.push(o=>{const body=JSON.stringify(o.messages);assert.match(body,/saved-42/);assert.match(body,/no-replay/);assert.ok(body.length<400000);return 'resumed';});
    resumed=await createHarnessHost({id:'compact-large',provider:{model:'fixture'},system:'test',adapter,persistenceDirectory:dir});resumed.send('resume');await resumed.idle();assert.equal(adapter.requests.length,priorRequests+1);
    assert.equal(resumed.agent.session.deriveMessages().at(-1).content[0].text,'continued safely');
  });

  test('small-window compaction keeps capacity reservation and reports skipped checks',async t=>{
    const records=[];const adapter=new Script([()=> 'ok']);
    adapter.resolveModel=async(provider,id)=>({provider,id,name:id,context:{contextWindow:32768},defaultMaxTokens:4096});
    const h=await createHarnessHost({id:'compact-small',provider:{model:'fixture'},system:'test',adapter,onModel:r=>records.push(r)});t.after(()=>h.dispose());h.send('hello');await h.idle();
    const r=records.find(r=>r.event==='context.compaction');assert.equal(r.outcome,'skipped');assert.equal(r.thresholdTokens,12288);assert.equal(r.retainTokens,5242);
  });
  test('failed summary preserves history and blocks oversized fallback',async t=>{
    const {legacySeed}=await import('../electron/agent/harness-host.mjs');const records=[],events=[];let blockedError;
    const unavailable=()=>{throw Object.assign(new Error('fixture summary unavailable'),{code:'AUTH'});};
    const adapter=new Script([unavailable,unavailable,unavailable]);
    adapter.resolveModel=async(provider,id)=>({provider,id,name:id,context:{contextWindow:1048576},defaultMaxTokens:16384});
    const h=await createHarnessHost({id:'compact-failure',provider:{model:'fixture'},system:'test',seed:largeHistory(legacySeed),adapter,onModel:r=>records.push(r),onEvent:e=>events.push(e),onError:e=>blockedError=e});t.after(()=>h.dispose());
    h.send('continue');await h.idle();
    assert.ok(events.some(e=>e.type==='compaction/end'&&e.data.error));assert.equal(events.some(e=>e.type==='compaction/summary'),false);
    assert.ok(h.agent.session.deriveMessages().some(m=>m.content.some(b=>b.text?.includes('archive '))));
    const failure=records.find(e=>e.event==='context.compaction'&&e.outcome==='failed');assert.ok(failure);assert.equal(failure.beforeTokensEstimate,failure.afterTokensEstimate);
    assert.ok(records.some(e=>e.event==='context.compaction-error'));assert.ok(adapter.requests[0].maxTokens<=8192);
    assert.ok(adapter.requests.length>=1&&adapter.requests.length<=3,'native overflow recovery is bounded');
    assert.ok(adapter.requests.every(r=>!isAgentLoopRequest(r)),'oversized conversation must never reach the provider');assert.equal(blockedError.code,'CONTEXT_WINDOW_EXCEEDED');
    assert.equal(records.some(e=>e.event==='model.request-blocked'),true);
    assert.notEqual(h.agent.session.deriveMessages().at(-1).content[0].text,'still available');
    assert.equal(events.some(e=>e.type==='llm/retry'),false);
  });

  test('tool results prune before next small-context request without corrupting durable failed receipts',async t=>{
    let executions=0;const original={success:false,padding:'x'.repeat(25000),error:'MIDDLE_KEY_ERROR',errorCode:'FIXTURE_FAILURE',exitCode:7,stderr:'CRITICAL_STDERR'};
    const f=fixture(t,[()=>[call('fixture_large',{},'large-call')],o=>{
      const text=o.messages.at(-1).content.map(b=>b.text||'').join('');assert.match(text,/tool result middle pruned/);assert.match(text,/MIDDLE_KEY_ERROR/);assert.match(text,/FIXTURE_FAILURE/);assert.match(text,/CRITICAL_STDERR/);assert.match(text,/read_operation_receipt/);assert.ok(text.length<8192);
      return [call('read_operation_receipt',{callId:'large-call',pointers:['/error','/exitCode']},'lookup-large')];
    },o=>{const detail=JSON.parse(o.messages.at(-1).content[0].text);assert.equal(detail.status,'failed');assert.equal(detail.fields[0].matches[0].value,'MIDDLE_KEY_ERROR');assert.equal(detail.fields[1].matches[0].value,7);return 'checked';}],
    [{name:'fixture_large',description:'generic',schema,readOnly:true,execute:()=>{executions++;return original;}}]);
    await f.runtime.start(f.s.id,'run and inspect',{});await settled(f.runtime,f.s.id);
    const saved=f.store.get(f.s.id),ledger=saved.calls.find(c=>c.modelCallId==='large-call');assert.equal(ledger.status,'failed');assert.deepEqual(ledger.result,original);assert.equal(executions,1);
    assert.equal(saved.messages.filter(m=>m.role==='tool'&&m.tool_call_id==='large-call').length,1);
    const h=f.runtime.hosts.get(f.s.id);assert.equal([...h.agent.session.surface.nodes].map(seq=>h.agent.session.eventAt(seq)).filter(e=>e.type==='tool/result'&&e.data.message.toolCallId==='large-call').length,1);
    await h.dispose();f.runtime.hosts.clear();f.runtime.liveSessions.clear();f.adapter.steps.push(()=>[call('read_operation_receipt',{callId:'large-call',pointers:['/padding']},'read-after-restart')],o=>{
      const detail=JSON.parse(o.messages.at(-1).content[0].text);assert.equal(detail.projectionComplete,false);const raw=JSON.parse(fs.readFileSync(detail.projectionPath,'utf8'));assert.equal(raw.fields[0].matches[0].value,original.padding);return 'recovered';});
    await f.runtime.start(f.s.id,'read original after restart',{});await settled(f.runtime,f.s.id);assert.equal(executions,1);assert.deepEqual(f.store.get(f.s.id).calls[0].result,original);
  });

}
