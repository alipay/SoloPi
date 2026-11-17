import {nativeFixture,toolCall} from './fixtures/native-harness.mjs';
import {boundary as nativeBoundary} from './fixtures/harness-lifecycle.mjs';
import {NativeRuntime,disposeAll} from './fixtures/harness-lifecycle.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
test.after(disposeAll);
const require=createRequire(import.meta.url),Ajv=require('ajv');
const {validationDiagnostic,schemaGuide}=require('../electron/agent/tool-validation');
const schema={type:'object',properties:{commands:{type:'array',items:{type:'object',properties:{command:{type:'string'},args:{type:'array',items:{type:'string'}},cwd:{type:'string'}},required:['command'],additionalProperties:false}}},required:['commands'],additionalProperties:false};
test('nested batch errors identify extra fields and show correct shape without argument values or schema defaults',()=>{
 const args={cwd:'PRIVATE_PATH_VALUE',commands:[{command:'fixture',arguments:['SECRET_VALUE']}]},ajv=new Ajv({allErrors:true});assert.equal(ajv.validate(schema,args),false);
 const d=validationDiagnostic('schema',{id:'call',function:{name:'batch',arguments:JSON.stringify(args)}},Error(),ajv.errors,schema);
 assert.ok(d.issues.some(e=>e.path===''&&e.additionalProperty==='cwd'));assert.ok(d.issues.some(e=>e.path==='/commands/0'&&e.additionalProperty==='arguments'));
 assert.equal(d.expectedSchema.properties.commands.items.properties.args.type,'array');assert.equal(d.expectedSchema.properties.cwd,undefined);
 assert.doesNotMatch(JSON.stringify(d),/SECRET_VALUE|PRIVATE_PATH_VALUE/);
 assert.doesNotMatch(JSON.stringify(schemaGuide({type:'object',description:'PRIVATE_DEFAULT',properties:{password:{type:'string',default:'PRIVATE_DEFAULT',examples:['PRIVATE_DEFAULT']}}})),/PRIVATE_DEFAULT/);
});
test('runtime feeds complete nested schema errors to model, then executes corrected batch exactly once',async()=>{
 const {AgentStore}=require('../electron/agent/store'),{AgentRuntime}={AgentRuntime:NativeRuntime};const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lw-schema-feedback-')),store=new AgentStore(()=>dir),s=store.create();s.approvalMode='auto';store.save(s);let round=0,executed=0;
 const runtime=new AgentRuntime({store,provider:async()=>({}),tools:async()=>[{name:'batch',schema,execute:async a=>{executed++;assert.deepEqual(a.commands[0].args,['ok']);return {success:true};}}],model:async options=>{
  if(round++===0)return {role:'assistant',content:null,tool_calls:[{id:'bad',type:'function',function:{name:'batch',arguments:JSON.stringify({cwd:'private',commands:[{command:'fixture',arguments:['ok']}]})}}]};
  if(round===2){assert.equal(executed,0);assert.equal(options.messages.at(-1).role,'tool');assert.match(options.messages.at(-1).content,/Error|invalid|must|unexpected/i);return {role:'assistant',content:null,tool_calls:[{id:'fixed',type:'function',function:{name:'batch',arguments:JSON.stringify({commands:[{command:'fixture',args:['ok'],cwd:'private'}]})}}]};}
  return {role:'assistant',content:'done'};
 }});
 try{await runtime.start(s.id,'read fixture');for(let i=0;i<100&&runtime.active.size;i++)await new Promise(r=>setTimeout(r,5));const result=store.get(s.id);assert.equal(result.status,'idle');assert.equal(executed,1);assert.deepEqual(result.calls.map(c=>c.status),['failed','done']);}finally{await runtime.stopAll();fs.rmSync(dir,{recursive:true,force:true});}
});

test('unclosed nested JSON reports current schema and full-regeneration action without leaking arguments',()=>{
 const raw='{"command":"PRIVATE_COMMAND","arguments":["PRIVATE_SECRET"],"skillContext":{"name":"private-skill"}';
 const expected={type:'object',properties:{command:{type:'string'},arguments:{type:'array',items:{type:'string'}},skillContext:{type:'object',properties:{name:{type:'string'}},required:['name']}},required:['command','arguments']};
 const d=validationDiagnostic('json',{id:'bad',function:{name:'run_command',arguments:raw}},Error('Unexpected end of JSON'),[],expected);
 assert.equal(d.reason,'unclosed_container');assert.equal(d.expectedClosing,'}');assert.equal(d.recovery,'regenerate_complete_json_object');
 assert.deepEqual(d.expectedSchema.required,['command','arguments']);assert.equal(d.expectedSchema.properties.skillContext.properties.name.type,'string');
 assert.doesNotMatch(JSON.stringify(d),/PRIVATE_COMMAND|PRIVATE_SECRET|private-skill/);assert.equal(raw.endsWith('}}'),false);
});
test('malformed JSON recovery exposes only failed tools, preserves successful siblings, then restores the catalog',async()=>{
 const {AgentStore}=require('../electron/agent/store'),{AgentRuntime}={AgentRuntime:NativeRuntime};
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lw-json-recovery-')),store=new AgentStore(()=>dir),s=store.create();s.approvalMode='auto';store.save(s);
 let round=0;const executed=[];const call=(id,name,args)=>({id,type:'function',function:{name,arguments:args}});
 const commandSchema={type:'object',properties:{command:{type:'string'},skillContext:{type:'object'}},required:['command'],additionalProperties:false};
 const runtime=new AgentRuntime({store,provider:async()=>({}),tools:async()=>[
  {name:'run_command',schema:commandSchema,execute:async args=>{executed.push(args.command);return{success:true};}},
  {name:'read_fixture',schema:{type:'object'},execute:async()=>{executed.push('read');return{success:true};}}
 ],model:async options=>{
  round++;
  if(round===1)return{role:'assistant',tool_calls:[call('bad','run_command','{"command":"fixture","skillContext":{}'),call('read','read_fixture','{}')]};
  if(round===2){
   assert.deepEqual(executed,['read']);assert.ok(options.tools.some(t=>t.function.name==='run_command'));assert.ok(options.tools.some(t=>t.function.name==='read_fixture'));
   assert.doesNotMatch(options.messages[0].content,/<tool-argument-recovery>/);
   assert.match(options.messages.find(m=>m.role==='tool'&&m.tool_call_id==='bad').content,/Error|must|invalid/i);
   return{role:'assistant',tool_calls:[call('corrected','run_command','{"command":"fixture"}')]};
  }
  assert.ok(options.tools.some(t=>t.function.name==='read_fixture'));assert.doesNotMatch(options.messages[0].content,/<tool-argument-recovery>/);
  return{role:'assistant',content:'done'};
 }});
 try{await runtime.start(s.id,'execute fixture');for(let i=0;i<200&&runtime.active.size;i++)await new Promise(r=>setTimeout(r,5));const final=store.get(s.id);assert.equal(final.status,'idle',final.error);assert.deepEqual(executed,['read','fixture']);assert.deepEqual(final.calls.map(c=>c.status),['failed','done','done']);}finally{await runtime.stopAll();fs.rmSync(dir,{recursive:true,force:true});}
});
test("external native steering abandons the old invalid-call turn without restricting the new tool catalog",async t=>{let entered;const ready=new Promise(r=>entered=r),executed=[];const f=nativeFixture(t,[()=>[toolCall('first','{','bad')],async o=>{entered();await new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true}));return[toolCall('first',{},'discard-late-response')];},o=>{assert.ok(o.tools.some(t=>t.name==='first'));assert.ok(o.tools.some(t=>t.name==='second'));assert.doesNotMatch(JSON.stringify(o.messages),/tool-argument-recovery/);return[toolCall('second',{},'new-query')];},()=> 'done'],['first','second'].map(name=>({name,schema:{type:'object'},execute:()=>{executed.push(name);return{success:true};}})));await f.runtime.start(f.s.id,'first',{});await ready;await f.runtime.start(f.s.id,'switch to second',{});await nativeBoundary(f.runtime);const s=f.store.get(f.s.id);assert.equal(s.status,'idle');assert.deepEqual(executed,['second']);assert.ok(!s.calls.some(c=>c.modelCallId==='discard-late-response'));});

async function recoveryFixture(t,responses){
 const {AgentStore}=require('../electron/agent/store'),{AgentRuntime}={AgentRuntime:NativeRuntime};
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lw-text-repair-')),store=new AgentStore(()=>dir),s=store.create(),executed=[],requests=[];
 s.approvalMode='auto';s.workState={scopeUserIndex:-1,objective:'historical work',completed:[],sourceCallIds:[],sourceUserIndices:[],phase:'done',nextAction:'delivered'};store.save(s);
 const runtime=new AgentRuntime({store,provider:async()=>({}),tools:async()=>['repair','sibling'].map(name=>({name,schema:{type:'object',required:['value'],properties:{value:{type:'integer'}},additionalProperties:false},execute:async args=>{executed.push([name,args.value]);return{success:true};}})),model:async options=>{requests.push(options);assert.ok(responses.length,'unexpected unbounded continuation');return responses.shift();}});
 t.after(async()=>{await disposeAll();await runtime.stopAll();fs.rmSync(dir,{recursive:true,force:true});});
 await runtime.start(s.id,'Investigate existing evidence');
 for(let i=0;i<200&&runtime.active.size;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(runtime.active.size,0);
 return {result:store.get(s.id),executed,requests};
}
const repairCall=(id,name,args)=>({id,type:'function',function:{name,arguments:args}});
const broken=()=>({role:'assistant',tool_calls:[repairCall('bad','repair','{"value":') ,repairCall('sibling','sibling','{"value":1}')]});
test("native stop with unrepaired arguments reports incomplete without replaying the successful sibling",async t=>{const f=await recoveryFixture(t,[broken(),{role:'assistant',content:'现在我来核实失败信息中的 actual 值'}]);assert.equal(f.result.status,'interrupted');assert.equal(f.result.errorDetails.code,'UNRESOLVED_TOOL_ARGUMENTS');assert.deepEqual(f.executed,[['sibling',1]]);assert.equal(f.requests.length,2);});
test("native pure-text failure response stays incomplete without an extra forced model attempt",async t=>{const f=await recoveryFixture(t,[broken(),{role:'assistant',content:'无法完成参数修复'}]);assert.equal(f.result.status,'interrupted');assert.equal(f.result.errorDetails.code,'UNRESOLVED_TOOL_ARGUMENTS');assert.deepEqual(f.executed,[['sibling',1]]);assert.equal(f.requests.length,2);});
test('ordinary text answer remains one model request with no completion-repair overhead',async t=>{
 const f=await recoveryFixture(t,[{role:'assistant',content:'A direct answer'}]);
 assert.equal(f.result.status,'idle');assert.equal(f.requests.length,1);assert.equal(f.requests.length,1);
});
test("native consecutive invalid calls execute nothing and preserve their failure receipts",async t=>{const f=await recoveryFixture(t,[{role:'assistant',tool_calls:[repairCall('bad1','repair','{')]},{role:'assistant',tool_calls:[repairCall('bad2','repair','{')]},{role:'assistant',content:'cannot complete'}]);assert.equal(f.result.status,'interrupted');assert.deepEqual(f.executed,[]);assert.equal(f.result.calls.filter(c=>c.status==='failed').length,2);assert.equal(f.requests.length,3);});

test("native repairs may span steps without hiding tools or replaying valid siblings",async t=>{const f=await recoveryFixture(t,[{role:'assistant',tool_calls:[repairCall('bad1','repair','{'),repairCall('bad2','sibling','{')]},{role:'assistant',tool_calls:[repairCall('fixed1','repair','{"value":2}')]},{role:'assistant',tool_calls:[repairCall('fixed2','sibling','{"value":3}')]},{role:'assistant',content:'verified'}]);assert.equal(f.result.status,'idle');assert.deepEqual(f.executed,[['repair',2],['sibling',3]]);assert.equal(f.result.calls.filter(c=>c.status==='failed').length,2);});

// Read-only validation failures are ordinary tool results, not pending writes.
for (const retry of ['alternate', 'none', 'failed-alternate']) test(`read-only argument rejection permits native completion (${retry})`, async t => {
 const executed=[];
 const steps=[()=>[toolCall('query_a',{extra:true},'bad-query')]];
 if(retry!=='none')steps.push(()=>[toolCall('query_b',{},'alternate-query')]);
 steps.push(()=> 'query conclusion');
 const f=nativeFixture(t,steps,['query_a','query_b'].map(name=>({name,readOnly:true,schema:{type:'object',additionalProperties:false},execute:async()=>{executed.push(name);return{success:retry!=='failed-alternate'};}})));
 const result=await f.run();
 assert.equal(result.status,'idle');assert.equal(result.errorDetails?.code,undefined);
 assert.equal(result.calls[0].status,'failed');assert.match(result.messages.find(m=>m.tool_call_id==='bad-query').content,/additional properties/);
 assert.deepEqual(executed,retry==='none'?[]:['query_b']);assert.equal(f.adapter.requests.length,retry==='none'?2:3);
});
test('a successful read cannot hide an unperformed write or replay successful siblings',async t=>{
 const executed=[];const f=nativeFixture(t,[()=>[toolCall('mutate',{extra:true},'bad-write'),toolCall('query',{},'good-read')],()=> 'conclusion'],[
 {name:'mutate',schema:{type:'object',additionalProperties:false},execute:async()=>{executed.push('write');return{success:true};}},
 {name:'query',readOnly:true,schema:{type:'object'},execute:async()=>{executed.push('read');return{success:true};}}
 ]);
 const result=await f.run();assert.equal(result.status,'interrupted');assert.equal(result.errorDetails.code,'UNRESOLVED_TOOL_ARGUMENTS');assert.deepEqual(result.errorDetails.pending.map(p=>p.callId),['bad-write']);assert.deepEqual(executed,['read']);
});
test('desktop result-to-report recovery uses explicit read-only metadata and real schemas',async t=>{
 const {createTools}=require('../electron/agent/tools');const loads=[];
 const tools=await createTools({readState:()=>({}),config:()=>({}),skillsRoots:()=>[],invoke:async(channel,_event,args)=>{assert.equal(channel,'workflow-report:load-task');loads.push(args.taskId);return{success:true,task:{id:args.taskId,status:'failed',cases:[{caseId:'case-one',status:'failed',results:[]}]}};}})({},undefined,{platformOnly:true});
 for(const name of ['read_task_result','read_task_report'])assert.equal(tools.find(t=>t.name===name).readOnly,true);
 const f=nativeFixture(t,[()=>[toolCall('read_task_result',{taskId:'fixture-task',limit:20,statuses:['failed']},'rejected')],()=>[toolCall('read_task_report',{taskId:'fixture-task',limit:20,statuses:['failed'],view:'cases'},'recovered')],()=> 'report delivered'],tools);
 const result=await f.run();assert.equal(result.status,'idle');assert.deepEqual(result.calls.map(c=>c.status),['failed','done']);assert.deepEqual(loads,['fixture-task']);assert.equal(f.adapter.requests.length,3);
});
