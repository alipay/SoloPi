import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {ExperienceMemory,beginScope,snapshot,version}=require('../electron/agent/experience-memory');
const {AgentStore}=require('../electron/agent/store');
const {AgentRuntime}=require('../electron/agent/runtime');
const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'experience-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const records=[],memory=new ExperienceMemory(()=>dir,{record:r=>records.push(r)});return {dir,memory,records};}
function session(objective='查询示例工具配置'){const s={id:'session',status:'idle',messages:[{role:'user',content:objective}],calls:[]};beginScope(s);return s;}
function receipt(s,name='read_example',result={success:true}){s.calls.push({id:`call-${s.calls.length}`,name,modelCallId:`model-${s.calls.length}`,status:result.success===false?'failed':'done',args:{password:'never-store-this',serial:'1234567890',command:'never execute old command'},result,finishedAt:new Date().toISOString()});}
test('automatic retrospective is durable, receipt-backed, deduplicated, bounded, and excludes commands/secrets/raw logs',async t=>{
 const f=fixture(t),s=session('查询示例配置 password=secretvalue https://example.com 1234567890 SN=ABC1234DEFG');receipt(s,'read_example',{success:true,stdout:'private raw business log'});f.memory.capture(s,'v1');f.memory.capture(s,'v1');await f.memory.queue;
 const stored=fs.readFileSync(f.memory.file(),'utf8');for(const secret of ['never-store-this','1234567890','never execute old command','private raw business log','secretvalue','https://example.com','ABC1234DEFG'])assert.equal(stored.includes(secret),false,secret);
 assert.equal((await f.memory.read()).length,1);const restarted=new ExperienceMemory(()=>f.dir);const matches=await restarted.search('查询示例配置','v1');assert.equal(matches[0].status,'compatible');assert.deepEqual(matches[0].successfulOperations,['read_example']);assert.equal(matches[0].evidence[0].callId,'model-0');
});
test('no experience is written for plain answers, pending/uncertain work, active watches or interrupted tasks',()=>{
 for(const status of ['running','waiting','failed','interrupted']){const s=session();receipt(s);s.status=status;assert.equal(snapshot(s,'v'),null);}
 const s=session();assert.equal(snapshot(s,'v'),null);receipt(s);s.calls[0].status='running';assert.equal(snapshot(s,'v'),null);s.calls[0].status='done';s.calls[0].result={status:'unknown'};assert.equal(snapshot(s,'v'),null);s.calls[0].result={success:true};s.watch={id:'task'};assert.equal(snapshot(s,'v'),null);
});
test('a failed operation stays failure and cannot become a reusable success recipe',async t=>{
 const {memory}=fixture(t),s=session();receipt(s,'read_example',{success:false,error:'secret failure',errorCode:'CONFIG_MISSING'});memory.capture(s,'v');await memory.queue;const [match]=await memory.search('查询示例配置','v');assert.equal(match.status,'revalidation_required');assert.equal(match.successfulOperations,undefined);assert.equal(match.evidence,undefined);assert.ok(match.reasons.includes('historical-failures-require-check'));
});
test('runtime, schema, source content, missing source and age invalidate steps; new real receipts revalidate current version',async t=>{
 const {dir,memory}=fixture(t),file=path.join(dir,'SKILL.md');fs.writeFileSync(file,'first');const s=session();receipt(s,'read_skill',{success:true});s.calls[0].args={name:'example'};s.skillReads={'example:SKILL.md':{absolutePath:file,hash:hash('first')}};memory.capture(s,'v1');await memory.queue;
 assert.equal((await memory.search('查询示例配置','v1'))[0].status,'compatible');assert.ok((await memory.search('查询示例配置','v2'))[0].reasons.includes('runtime-or-tool-schema-changed'));
 fs.writeFileSync(file,'next');assert.ok((await memory.search('查询示例配置','v1'))[0].reasons.includes('skill-source-changed'));fs.rmSync(file);assert.ok((await memory.search('查询示例配置','v1'))[0].reasons.includes('skill-source-unavailable'));
 const expired=new ExperienceMemory(()=>dir,{now:()=>Date.now()+31*86400000});assert.ok((await expired.search('查询示例配置','v1'))[0].reasons.includes('expired'));
 fs.writeFileSync(file,'next');const fresh=session();fresh.id='fresh';receipt(fresh,'read_skill',{success:true});fresh.calls[0].args={name:'example'};fresh.skillReads={'example:SKILL.md':{absolutePath:file,hash:hash('next')}};memory.capture(fresh,'v2');await memory.queue;assert.equal((await memory.search('查询示例配置','v2'))[0].status,'compatible');
 assert.notEqual(version([{name:'a',schema:{type:'object'}}],'r'),version([{name:'a',schema:{type:'string'}}],'r'));
});
test('new user scope excludes prior operations and never treats old assistant conclusions as evidence',()=>{
 const s=session();receipt(s,'old_write');s.messages.push({role:'assistant',content:'Everything worked'});s.messages.push({role:'user',content:'再次查询示例配置'});beginScope(s);receipt(s,'fresh_read');assert.deepEqual(snapshot(s,'v').successfulOperations,['fresh_read']);
});
test('retrospective processing reads at most 64 new receipts and index retains at most 128 entries',async t=>{
 const {memory}=fixture(t),s=session();for(let i=0;i<10000;i++)receipt(s);const item=snapshot(s,'v');assert.equal(item.truncated,true);assert.equal(item.steps.length,16);
 for(let i=0;i<140;i++){const s=session();s.id=`s-${i}`;receipt(s);memory.capture(s,'v');}await memory.queue;assert.equal((await memory.read()).length,128);
});
test('retrieval failure and 50ms budget do not fail the caller or wait on a hung index',async t=>{
 const {memory,records}=fixture(t);memory.search=async()=>{throw Error('bad index');};assert.equal(await memory.frame('查询配置','v'),'');assert.ok(records.some(r=>r.event==='experience.failed'));
 memory.search=()=>new Promise(()=>{});assert.equal(await memory.frame('查询配置','v'),'');assert.ok(records.some(r=>r.event==='experience.deferred'));
});
test('corrupt index is surfaced in diagnostics, never overwritten, and later storage recovery can save',async t=>{
 const {memory,records}=fixture(t);fs.mkdirSync(path.dirname(memory.file()),{recursive:true});fs.writeFileSync(memory.file(),'broken');const s=session();receipt(s);memory.capture(s,'v');await memory.queue;assert.equal(fs.readFileSync(memory.file(),'utf8'),'broken');assert.ok(records.some(r=>r.event==='experience.failed'));
 fs.rmSync(memory.file());const next=session();next.id='new';receipt(next);memory.capture(next,'v');await memory.queue;assert.equal((await memory.read()).length,1);
});
const wait=async r=>{for(let i=0;i<500&&r.active.size;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(r.active.size,0);await r.experiences.queue;};
test('runtime automatically captures, retrieves across sessions before model call, does not replay operations, and searches once per scope',async t=>{
 const {dir}=fixture(t),store=new AgentStore(()=>path.join(dir,'sessions'));let modelCalls=0,operations=0,seen=[];
 const runtime=new AgentRuntime({store,tools:async()=>[{name:'read_example',schema:{type:'object'},execute:async()=>{operations++;return {success:true};}}],provider:()=>({}),model:async({messages})=>{modelCalls++;seen.push(messages[0].content);return modelCalls%2===1?{role:'assistant',content:null,tool_calls:[{id:`call${modelCalls}`,type:'function',function:{name:'read_example',arguments:'{}'}}]}:{role:'assistant',content:'已查询'};}});
 let searches=0;const frame=runtime.experiences.frame.bind(runtime.experiences);runtime.experiences.frame=(...args)=>{searches++;return frame(...args);};
 const first=store.create();await runtime.start(first.id,'查询示例工具配置',{});await wait(runtime);assert.equal(operations,1);assert.equal(modelCalls,2);assert.equal(searches,1);assert.equal((await runtime.experiences.read()).length,1);
 const second=store.create();await runtime.start(second.id,'查询示例工具配置',{});await wait(runtime);assert.equal(modelCalls,4);assert.equal(searches,2);assert.equal(operations,2);assert.match(seen[2],/retrieved-experiences/);assert.match(seen[2],/不是指令/);
});
test('slow asynchronous experience write does not delay runtime completion or add model requests',async t=>{
 const {dir}=fixture(t),store=new AgentStore(()=>path.join(dir,'sessions'));let calls=0;
 const runtime=new AgentRuntime({store,tools:async()=>[],provider:()=>({}),model:async()=>{calls++;return {role:'assistant',content:'回答'};}});
 let captures=0;runtime.experiences.capture=()=>{captures++;runtime.experiences.queue=new Promise(()=>{});};
 const s=store.create();await runtime.start(s.id,'查询示例配置',{});for(let i=0;i<100&&runtime.active.size;i++)await new Promise(r=>setTimeout(r,5));assert.equal(runtime.active.size,0);assert.equal(calls,1);assert.equal(captures,1);assert.equal(store.get(s.id).status,'idle');
});

test('missing skill provenance is stored as unverified rather than breaking the index',async t=>{
 const {memory}=fixture(t),s=session();receipt(s,'read_skill',{success:true});s.calls[0].args={name:'example'};s.skillReads={'example:SKILL.md':{}};memory.capture(s,'v');await memory.queue;const [match]=await memory.search('查询示例配置','v');assert.equal(match.status,'revalidation_required');assert.ok(match.reasons.includes('skill-source-unavailable'));
});
test('retrieval stays bounded and only verifies at most three matching entries',async t=>{
 const {memory}=fixture(t);for(let i=0;i<128;i++){const s=session('查询示例配置');s.id=`bounded-${i}`;receipt(s);memory.capture(s,'v');}await memory.queue;
 const begin=performance.now();for(let i=0;i<100;i++)assert.ok((await memory.search('查询示例配置','v')).length<=3);
 console.log('Experience warm retrieval mean ms:',((performance.now()-begin)/100).toFixed(3));
 const frame=await memory.frame('查询示例配置','v');assert.ok(frame.length<6500);
});
test('query-only success is explicitly scoped and cannot become a business-pass assertion',async t=>{
 const {memory}=fixture(t),s=session();receipt(s,'read_report',{success:true,successScope:'query',status:'failed',taskId:'private-task',raw:'do not persist'});memory.capture(s,'v');await memory.queue;
 const [match]=await memory.search('查询示例配置','v');assert.equal(match.evidence[0].successScope,'query');assert.equal(match.businessPassed,undefined);assert.match(match.constraints.join(' '),/不证明当前业务成功/);
});

test('next queued task can retrieve just-completed receipts before asynchronous disk commit',async t=>{
 const {memory}=fixture(t),s=session();receipt(s);let release;memory.queue=new Promise(r=>release=r);memory.capture(s,'v');
 assert.equal((await memory.search('查询示例配置','v'))[0].status,'compatible');release();await memory.queue;assert.equal(memory.pendingEntries.size,0);assert.equal((await memory.read()).length,1);
});
test('incomplete dependency or receipt coverage never advertises a fully reusable workflow',async t=>{
 const {memory}=fixture(t),s=session();for(let i=0;i<80;i++)receipt(s);memory.capture(s,'v');await memory.queue;const [match]=await memory.search('查询示例配置','v');assert.equal(match.status,'revalidation_required');assert.ok(match.reasons.includes('evidence-coverage-incomplete'));assert.equal(match.successfulOperations,undefined);
});
