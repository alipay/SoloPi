import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {discoverSkills,readSkill,readSkillReference}=require('../electron/agent/skills');
const {recordSkillRead,assertSkillRead}=require('../electron/agent/skill-reading');
const {refreshLoadedSkills,skillUpdateFrame}=require('../electron/agent/skill-refresh');
const {AgentRuntime}=require('../electron/agent/runtime');
const {AgentStore}=require('../electron/agent/store');
const {installAgent}=require('../electron/agent');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lw-skill-fresh-')),directory=path.join(root,'generic');
 fs.mkdirSync(path.join(directory,'references'),{recursive:true});
 const entry=path.join(directory,'SKILL.md'),reference=path.join(directory,'references/rule.md');
 fs.writeFileSync(entry,'---\nname: generic\ndescription: Generic fixture\n---\n# Rules\nold entry\n');
 fs.writeFileSync(reference,'# Details\nold reference\n');
 const catalog=()=>discoverSkills([root]).skills,s={id:'session',messages:[],calls:[]};
 recordSkillRead(s,readSkill(catalog(),'generic'));recordSkillRead(s,readSkillReference(catalog(),'generic','references/rule.md'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 return{root,directory,entry,reference,catalog,s,refresh:()=>refreshLoadedSkills(s,[root])};
}
test('unchanged sources cause no prompt growth or additional model calls',t=>{
 const f=fixture(t);for(let i=0;i<5;i++)assert.deepEqual(f.refresh(),[]);
 assert.equal(skillUpdateFrame(f.s),'');assert.equal(f.s.skillUpdates,undefined);
});
test('entry and reference changes auto-load current content, preserve original receipts and expire old read state',t=>{
 const f=fixture(t);f.s.calls=[{id:'old',result:{content:'original evidence'}}];
 f.s.referenceMemory=[{key:'old',skillName:'generic'},{key:'other',skillName:'other'}];
 fs.appendFileSync(f.entry,'new entry\n');fs.appendFileSync(f.reference,'new reference\n');
 assert.deepEqual(f.refresh(),['generic']);
 const frame=skillUpdateFrame(f.s);assert.ok(frame.includes('SKILL.md'));assert.ok(frame.includes('references/rule.md'));assert.ok(!frame.includes('new entry'));assert.ok(!frame.includes('new reference'));
 assert.equal(f.s.calls[0].result.content,'original evidence');assert.equal(f.s.referenceMemory.length,1);
 assert.throws(()=>assertSkillRead(f.s,{name:'generic',files:['references/rule.md']}));
 recordSkillRead(f.s,readSkill(f.catalog(),'generic'));recordSkillRead(f.s,readSkillReference(f.catalog(),'generic','references/rule.md'));
 assertSkillRead(f.s,{name:'generic',files:['references/rule.md']});
 assert.deepEqual(f.refresh(),[]);assert.equal(skillUpdateFrame(f.s),'');
});
test('only selected documents are refreshed; newly added mandatory references block commands until loaded',t=>{
 const f=fixture(t);fs.appendFileSync(f.entry,'new rule\n');
 fs.writeFileSync(f.entry,fs.readFileSync(f.entry,'utf8').replace('description: Generic fixture','description: Generic fixture\nrequired_reading: [references/new.md]'));
 fs.writeFileSync(path.join(f.directory,'references/new.md'),'new required body');
 f.refresh();recordSkillRead(f.s,readSkill(f.catalog(),'generic'));assert.throws(()=>assertSkillRead(f.s,{name:'generic'}),/new.md/);
 assert.equal(f.s.skillReads['generic:references/new.md'],undefined);
});
test('removed, disabled or escaped Skill sources invalidate execution instead of silently using historical content',t=>{
 for(const mode of ['removed','disabled','escape']){
  const f=fixture(t);
  if(mode==='removed')fs.rmSync(f.entry);
  if(mode==='escape'){fs.rmSync(f.reference);fs.symlinkSync(f.entry,f.reference);}
  const changed=mode==='disabled'?refreshLoadedSkills(f.s,[f.root],{disabledSkills:['generic']}):f.refresh();
  assert.deepEqual(changed,['generic']);
  assert.throws(()=>assertSkillRead(f.s,{name:'generic',files:['references/rule.md']}));
  assert.ok(skillUpdateFrame(f.s).includes('"success":false'));
 }
});
test('large changed references expose only a directory and require fresh complete sections',t=>{
 const f=fixture(t);fs.writeFileSync(f.reference,'# Details\n'+'content\n'.repeat(4000));
 f.refresh();assert.equal(f.s.skillReads['generic:references/rule.md'].complete,false);
 assert.equal(f.s.skillUpdates['generic:references/rule.md'].complete,false);
 assert.throws(()=>assertSkillRead(f.s,{name:'generic',files:['references/rule.md']}));
});
test('explicit read replaces the update frame; source relocation uses the new app-bundled copy',t=>{
 const f=fixture(t),newRoot=path.join(f.root,'new-package');fs.mkdirSync(newRoot);fs.cpSync(f.directory,path.join(newRoot,'generic'),{recursive:true});
 assert.deepEqual(refreshLoadedSkills(f.s,[newRoot,f.root]),['generic']);
 assert.ok(f.s.skillReads['generic:SKILL.md'].absolutePath.startsWith(fs.realpathSync(newRoot)));
 recordSkillRead(f.s,readSkill(discoverSkills([newRoot]).skills,'generic'));
 assert.equal(f.s.skillUpdates['generic:SKILL.md'],undefined);
});
const wait=async runtime=>{for(let i=0;i<200&&runtime.active.size;i++)await new Promise(r=>setTimeout(r,5));assert.equal(runtime.active.size,0);};
test('source changes appear as bounded system notices on the next request without changing user history',async t=>{
 const f=fixture(t),store=new AgentStore(()=>path.join(f.root,'sessions')),s=store.create();s.skillReads=f.s.skillReads;s.approvalMode='auto';store.save(s);
 let models=0,executions=0;
 const runtime=new AgentRuntime({store,refreshSkills:s=>refreshLoadedSkills(s,[f.root]),provider:()=>({contextWindowTokens:1000000}),
  tools:async()=>[{name:'probe',schema:{type:'object'},execute:()=>{executions++;fs.appendFileSync(f.entry,'new between-round rule\n');return{success:true};}}],
  model:async({messages})=>{models++;if(models===1)return{role:'assistant',tool_calls:[{id:'one',type:'function',function:{name:'probe',arguments:JSON.stringify({skillContext:{name:'generic'}})}}]};
   assert.ok(messages[0].content.includes('updated-skill-sources'));assert.ok(messages[0].content.includes('generic'));assert.ok(!JSON.stringify(messages).includes('new between-round rule'));return{role:'assistant',content:'done'};}});
 await runtime.start(s.id,'inspect');await wait(runtime);assert.equal(models,2);assert.equal(executions,1);
 assert.equal(store.get(s.id).status,'idle');assert.deepEqual(store.get(s.id).messages.filter(m=>m.role==='user').map(m=>m.content),['inspect']);
});
test('opening an old session publishes current catalog without reviving historical Skill reloads',async t=>{
 const f=fixture(t),prior=process.resourcesPath;process.resourcesPath=f.root;
 fs.mkdirSync(path.join(f.root,'skills'));fs.symlinkSync(f.directory,path.join(f.root,'skills/generic'));
 t.after(()=>{if(prior===undefined)delete process.resourcesPath;else process.resourcesPath=prior;});
 const directory=path.join(f.root,'data'),store=new AgentStore(()=>path.join(directory,'agent/sessions'));
 const s=store.create();s.skillReads=f.s.skillReads;store.save(s);fs.appendFileSync(f.entry,'page entered latest rule\n');
 const handlers=new Map(),agent=installAgent({ipcMain:{handle:(n,h)=>handlers.set(n,h)},directory:()=>directory,protect:x=>x,reveal:x=>x,readState:()=>({}),provider:()=>({}),invoke:async()=>({}),saveCase:()=>{}});t.after(()=>agent.stopAll());
 const result=await handlers.get('agent:get')({sender:{id:1,once(){},on(){},isDestroyed:()=>false,send(){}}},{id:s.id});
 assert.equal(result.error,undefined);assert.equal(skillUpdateFrame(result.session),'');assert.equal(result.session.skillReads['generic:SKILL.md'].complete,true);assert.ok(!skillUpdateFrame(result.session).includes('page entered latest rule'));assert.ok(result.session.skillCatalogView.entries.some(s=>s.name==='generic'));
});
test('page refresh during an in-flight model response cannot let that response execute an old-Skill command',async t=>{
 const f=fixture(t),store=new AgentStore(()=>path.join(f.root,'sessions')),s=store.create();s.skillReads=f.s.skillReads;s.approvalMode='auto';store.save(s);
 let models=0,executions=0,runtime;
 runtime=new AgentRuntime({store,refreshSkills:s=>refreshLoadedSkills(s,[f.root]),provider:()=>({contextWindowTokens:1000000}),
  tools:async()=>[{name:'probe',schema:{type:'object'},execute:()=>{executions++;return{success:true};}}],
  model:async()=>{models++;if(models===1){fs.appendFileSync(f.entry,'page concurrent update\n');runtime.refreshSkillSources(runtime.liveSessions.get(s.id));return{role:'assistant',tool_calls:[{id:'old-plan',type:'function',function:{name:'probe',arguments:JSON.stringify({skillContext:{name:'generic'}})}}]};}
    return{role:'assistant',content:'updated'};}});
 await runtime.start(s.id,'inspect');await wait(runtime);assert.equal(executions,0);assert.equal(models,2);
 assert.ok(store.get(s.id).calls[0].result.error.includes('Skill 来源变更尚未重新加载'));
});

test('legacy refresh backlog never injects full sources and reread clears each notice', t => {
 const f=fixture(t);
 for(let i=0;i<13;i++)f.s.skillUpdates ||= {},f.s.skillUpdates['large:'+i]={name:'large',file:'references/'+i+'.md',content:'PRIVATE_SOURCE_BODY'.repeat(10000),complete:true};
 const original=JSON.stringify(f.s.skillUpdates);
 const frame=skillUpdateFrame(f.s);
 assert.ok(frame.length<8000);assert.ok(!frame.includes('PRIVATE_SOURCE_BODY'));
 assert.ok(JSON.stringify(f.s.skillUpdates).length<3000);assert.ok(!JSON.stringify(f.s.skillUpdates).includes('PRIVATE_SOURCE_BODY'));
});

test('legacy full refresh backlog cannot overflow the actual runtime request', async t => {
 const f=fixture(t),store=new AgentStore(()=>path.join(f.root,'sessions')),s=store.create();
 s.skillReads=f.s.skillReads;s.skillUpdates={};
 for(let i=0;i<13;i++)s.skillUpdates['legacy:'+i]={name:'legacy',file:'references/'+i+'.md',content:'PRIVATE_SOURCE_BODY'.repeat(10000)};
 store.save(s);let calls=0;
 const {requestPolicy,inputEstimate}=require('../electron/agent/request-policy');
 const runtime=new AgentRuntime({store,refreshSkills:s=>refreshLoadedSkills(s,[f.root]),
  provider:()=>({contextWindowTokens:1048576,requestPolicy:requestPolicy()}),tools:async()=>[],
  model:async({messages,tools})=>{calls++;assert.ok(inputEstimate(messages,tools)<65536);
   assert.ok(!JSON.stringify(messages).includes('PRIVATE_SOURCE_BODY'));
   assert.ok(!messages[0].content.includes('updated-skill-sources'));assert.ok(messages[0].content.includes('current-skill-catalog'));assert.ok(messages[0].content.length<20000);
   return{role:'assistant',content:'done'};}});
 await runtime.start(s.id,'continue');await wait(runtime);assert.equal(calls,1);
 assert.equal(store.get(s.id).status,'idle');
});

 test('source switch blocks undeclared execution too, while recovery and read-only queries remain available', t=>{
 const f=fixture(t),other=path.join(f.root,'other');fs.mkdirSync(other);fs.cpSync(f.directory,path.join(other,'generic'),{recursive:true});
 fs.appendFileSync(path.join(other,'generic','SKILL.md'),'different older distribution\n');
 refreshLoadedSkills(f.s,[other,f.root]);
 const frame=skillUpdateFrame(f.s);assert.ok(frame.includes(f.entry));assert.ok(frame.includes(path.join(other,'generic','SKILL.md')));
 const {assertSkillUpdatesRead}=require('../electron/agent/skill-refresh');
 assert.throws(()=>assertSkillUpdatesRead(f.s,'run_command',{name:'generic'}),/未执行/);
 assert.throws(()=>assertSkillUpdatesRead(f.s,'run_command',{name:'generic'}),/未执行/);
 assert.throws(()=>assertSkillUpdatesRead(f.s,'run_command',{name:'unrelated'}),/未执行/);
 assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'read_operation_receipt',undefined,{executesOperation:false}));
 assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'read_skill'));
 assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'stop_task'));
 for(const file of ['SKILL.md','references/rule.md'])recordSkillRead(f.s,file==='SKILL.md'?readSkill(discoverSkills([other]).skills,'generic'):readSkillReference(discoverSkills([other]).skills,'generic',file));
 assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'run_command'));
 });
 test('read-only in-flight call without Skill dependency continues despite source refresh',async t=>{
 const f=fixture(t),store=new AgentStore(()=>path.join(f.root,'sessions')),s=store.create();s.skillReads=f.s.skillReads;s.approvalMode='auto';store.save(s);
 let models=0,executions=0;
 const runtime=new AgentRuntime({store,refreshSkills:s=>refreshLoadedSkills(s,[f.root]),provider:()=>({contextWindowTokens:1000000}),
 tools:async()=>[{name:'probe',schema:{type:'object'},execute:()=>{executions++;return{success:true};}}],
 model:async()=>{if(++models===1){fs.appendFileSync(f.entry,'changed during generation\n');return{role:'assistant',tool_calls:[{id:'without-context',type:'function',function:{name:'probe',arguments:'{}'}}]};}return{role:'assistant',content:'reload required'};}});
 await runtime.start(s.id,'inspect');await wait(runtime);assert.equal(executions,1);assert.equal(store.get(s.id).calls[0].result.success,true);
 });

 test('changed optional reference blocks only callers declaring that file',t=>{
 const f=fixture(t),{assertSkillUpdatesRead}=require('../electron/agent/skill-refresh');
 fs.appendFileSync(f.reference,'changed optional rule\n');f.refresh();
 assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'run_command',{name:'generic'}));
 assert.throws(()=>assertSkillUpdatesRead(f.s,'run_command',{name:'generic',files:['references/rule.md']}),/未执行/);
 recordSkillRead(f.s,readSkillReference(f.catalog(),'generic','references/rule.md'));
 assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'run_command',{name:'generic',files:['references/rule.md']}));
 });
 test('changed required reference still blocks calls without an explicit files list',t=>{
 const f=fixture(t),{assertSkillUpdatesRead}=require('../electron/agent/skill-refresh');
 f.s.skillReads['generic:SKILL.md'].requiredReading=['references/rule.md'];
 fs.appendFileSync(f.reference,'changed required rule\n');f.refresh();
 assert.throws(()=>assertSkillUpdatesRead(f.s,'run_command',{name:'generic'}),/未执行/);
 assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'stop_task',{name:'generic'}));
 });

test('declared single and batch Skill commands cannot bypass a deferred entry, and resume after an actual fresh read',async t=>{
 const f=fixture(t),store=new AgentStore(()=>path.join(f.root,'sessions')),s=store.create();
 const diagnostics=require('../electron/diagnostics'),originalRecord=diagnostics.record,events=[];
 diagnostics.record=data=>{events.push(diagnostics.sanitize(data));originalRecord(data);};t.after(()=>diagnostics.record=originalRecord);
 s.skillReads=f.s.skillReads;s.approvalMode='auto';store.save(s);
 fs.appendFileSync(f.entry,'LATEST_RULE_BODY\n');
 let models=0,executions=0;
 const call=(id,name,args={})=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
 const runtime=new AgentRuntime({store,refreshSkills:s=>refreshLoadedSkills(s,[f.root]),provider:()=>({contextWindowTokens:1000000}),
  tools:async()=>[
   ...['run_command','run_commands'].map(name=>({name,confirm:true,schema:{type:'object'},execute:()=>{executions++;return{success:true};}})),
   {name:'read_skill',schema:{type:'object'},execute:()=>readSkill(f.catalog(),'generic')}
  ],
  model:async({messages})=>{
   models++;
   if(models===1){assert.doesNotMatch(messages[0].content,/<updated-skill-sources>/);assert.match(messages[0].content,/<current-skill-catalog>/);assert.doesNotMatch(messages[0].content,/LATEST_RULE_BODY/);
    return{role:'assistant',tool_calls:[call('old-single','run_command',{skillContext:{name:'generic'}}),call('old-batch','run_commands',{skillContext:{name:'generic'}})]};}
   if(models===2){assert.equal(executions,0);const current=runtime.liveSessions.get(s.id);
    assert.ok(current.calls.slice(-2).every(c=>c.result.errorCode==='SKILL_RELOAD_REQUIRED'&&c.result.skillReload.executed===false));
    return{role:'assistant',tool_calls:[call('receipt','read_operation_receipt',{callId:'old-single'})]};}
   if(models===3)return{role:'assistant',tool_calls:[call('reload','read_skill',{name:'generic'})]};
   if(models===4){assert.ok(JSON.stringify(messages).includes('LATEST_RULE_BODY'));assert.doesNotMatch(messages[0].content,/<updated-skill-sources>/);
    return{role:'assistant',tool_calls:[call('new-single','run_command'),call('new-batch','run_commands')]};}
   return{role:'assistant',content:'done'};
  }});
 await runtime.start(s.id,'continue');await wait(runtime);
 const final=store.get(s.id);assert.equal(final.status,'idle',final.error);assert.equal(models,5);assert.equal(executions,2);
 assert.equal(final.skillReads['generic:SKILL.md'].complete,true);assert.equal(final.skillUpdates['generic:SKILL.md'],undefined);
 assert.equal(final.calls.find(c=>c.modelCallId==='receipt').result.result.errorCode,'SKILL_RELOAD_REQUIRED');
 assert.ok(events.some(e=>e.event==='agent.skill-refresh'&&e.status==='reload-required'));
 assert.equal(events.filter(e=>e.event==='agent.skill-refresh-blocked').length,2);
 assert.ok(events.some(e=>e.event==='agent.skill-read'&&e.status==='loaded'&&e.version===final.skillReads['generic:SKILL.md'].hash));
 assert.doesNotMatch(JSON.stringify(events),/LATEST_RULE_BODY|updated persisted rule/);
});
test('unrelated historical entry changes do not block an ordinary command without Skill dependency',async t=>{
 const f=fixture(t),store=new AgentStore(()=>path.join(f.root,'sessions')),s=store.create();s.skillReads=f.s.skillReads;s.approvalMode='auto';store.save(s);
 let models=0,executions=0;
 const runtime=new AgentRuntime({store,refreshSkills:s=>refreshLoadedSkills(s,[f.root]),provider:()=>({contextWindowTokens:1000000}),
 tools:async()=>[{name:'run_command',confirm:true,schema:{type:'object'},execute:()=>{executions++;return{success:true};}}],
 model:async()=>{if(++models===1){fs.appendFileSync(f.entry,'changed after request\n');return{role:'assistant',tool_calls:[{id:'unscoped-old',type:'function',function:{name:'run_command',arguments:'{}'}}]};}return{role:'assistant',content:'reload needed'};}});
 await runtime.start(s.id,'inspect');await wait(runtime);
 assert.equal(executions,1);assert.equal(store.get(s.id).calls[0].result.success,true);
});
test('rereading in another request cannot authorize arguments generated against the older entry',async t=>{
 const f=fixture(t),store=new AgentStore(()=>path.join(f.root,'sessions')),s=store.create();s.skillReads=f.s.skillReads;s.approvalMode='auto';store.save(s);
 let models=0,executions=0,runtime;
 runtime=new AgentRuntime({store,refreshSkills:s=>refreshLoadedSkills(s,[f.root]),provider:()=>({contextWindowTokens:1000000}),
 tools:async()=>[{name:'run_command',confirm:true,schema:{type:'object'},execute:()=>{executions++;return{success:true};}}],
 model:async()=>{if(++models===1){fs.appendFileSync(f.entry,'new rule\n');const live=runtime.liveSessions.get(s.id);runtime.refreshSkillSources(live);
   recordSkillRead(live,readSkill(f.catalog(),'generic'));recordSkillRead(live,readSkillReference(f.catalog(),'generic','references/rule.md'));
   return{role:'assistant',tool_calls:[{id:'stale-args',type:'function',function:{name:'run_command',arguments:JSON.stringify({skillContext:{name:'generic'}})}}]};}return{role:'assistant',content:'replan'};}});
 await runtime.start(s.id,'inspect');await wait(runtime);
 assert.equal(executions,0);assert.equal(store.get(s.id).calls[0].result.errorCode,'SKILL_PLAN_STALE');
});
test('new mandatory references and incomplete rereads cannot clear the execution guard',t=>{
 const f=fixture(t),{assertSkillUpdatesRead}=require('../electron/agent/skill-refresh');
 fs.writeFileSync(f.entry,'---\nname: generic\ndescription: generic\nrequired_reading: [references/new.md]\n---\n# New rules\n');
 fs.writeFileSync(path.join(f.directory,'references/new.md'),'# First\n'+'first\n'.repeat(2000)+'# Second\n'+'second\n'.repeat(2000));
 f.refresh();recordSkillRead(f.s,readSkill(f.catalog(),'generic'));
 assert.throws(()=>assertSkillUpdatesRead(f.s,'run_commands',{name:'generic'}),e=>e.code==='SKILL_RELOAD_REQUIRED'&&e.message.includes('new.md'));
 const outline=readSkillReference(f.catalog(),'generic','references/new.md');recordSkillRead(f.s,outline);
 assert.throws(()=>assertSkillUpdatesRead(f.s,'run_command',{name:'generic'}),/new.md/);
 recordSkillRead(f.s,readSkillReference(f.catalog(),'generic','references/new.md',{section:outline.sections[0].id}));
 assert.throws(()=>assertSkillUpdatesRead(f.s,'run_command',{name:'generic'}),/new.md/);
 recordSkillRead(f.s,readSkillReference(f.catalog(),'generic','references/new.md',{section:outline.sections[1].id}));
 assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'run_command'));
});
test('optional updates do not block undeclared operations, and stop/recovery stays available for unavailable entries',t=>{
 const f=fixture(t),{assertSkillUpdatesRead}=require('../electron/agent/skill-refresh');
 fs.appendFileSync(f.reference,'optional change\n');f.refresh();assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'run_commands'));
 fs.rmSync(f.entry);f.refresh();
 assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'run_commands'));
 assert.throws(()=>assertSkillUpdatesRead(f.s,'run_commands',{name:'generic'}),e=>e.code==='SKILL_RELOAD_REQUIRED');
 for(const name of ['read_skill','read_skill_reference','stop_task','stop_operation','cancel_operation'])assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,name));
 assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'read_operation_receipt',undefined,{executesOperation:false}));
});
test('deferred reload survives saving and reopening a session instead of becoming a valid read receipt',t=>{
 const f=fixture(t),store=new AgentStore(()=>path.join(f.root,'sessions')),s=store.create();s.skillReads=f.s.skillReads;require('../electron/agent/skill-scope').activateSkills(s,['generic']);
 fs.appendFileSync(f.entry,'updated persisted rule\n');refreshLoadedSkills(s,[f.root]);store.save(s);
 const reopened=store.get(s.id),{assertSkillUpdatesRead}=require('../electron/agent/skill-refresh');
 assert.throws(()=>assertSkillUpdatesRead(reopened,'run_command',{name:'generic'}),e=>e.code==='SKILL_RELOAD_REQUIRED');
 recordSkillRead(reopened,readSkill(f.catalog(),'generic'));assert.doesNotThrow(()=>assertSkillUpdatesRead(reopened,'run_command'));
});

test('fully read declared Skill isolates unrelated stale entries without allowing missing or invented dependencies',t=>{
 const f=fixture(t),{assertSkillUpdatesRead,skillEntryVersions}=require('../electron/agent/skill-refresh');
 const currentDir=path.join(f.root,'current');fs.mkdirSync(currentDir);
 fs.writeFileSync(path.join(currentDir,'SKILL.md'),'---\nname: current\ndescription: Current fixture\n---\n# Current rules\n');
 recordSkillRead(f.s,readSkill(f.catalog(),'current'));
 const versions=skillEntryVersions(f.s);fs.appendFileSync(f.entry,'unrelated change\n');f.refresh();
 for(const tool of ['run_command','run_commands'])assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,tool,{name:'current'},{entryVersions:versions}));
 assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'run_command'));
 for(const dependency of [{name:'invented'},{name:'generic'}])assert.throws(()=>assertSkillUpdatesRead(f.s,'run_command',dependency),e=>e.code==='SKILL_RELOAD_REQUIRED');
 assert.ok(f.s.skillUpdates['generic:SKILL.md']);
 const store=new AgentStore(()=>path.join(f.root,'sessions'));store.save(f.s);
 const reopened=store.get(f.s.id);assert.doesNotThrow(()=>assertSkillUpdatesRead(reopened,'run_commands',{name:'current'}));
 assert.throws(()=>assertSkillUpdatesRead(reopened,'run_commands',{name:'generic'}),e=>e.code==='SKILL_RELOAD_REQUIRED');
});
test('a partial declared entry or a newly required unread file cannot narrow away stale dependencies',t=>{
 const f=fixture(t),{assertSkillUpdatesRead}=require('../electron/agent/skill-refresh');
 fs.appendFileSync(f.entry,'unrelated stale source\n');f.refresh();
 f.s.skillReads['other:SKILL.md']={complete:false,requiredReading:[]};
 assert.throws(()=>assertSkillUpdatesRead(f.s,'run_command',{name:'other'}),/未执行/);
 f.s.skillReads['other:SKILL.md'].complete=true;f.s.skillReads['other:SKILL.md'].requiredReading=['references/new.md'];
 assert.throws(()=>assertSkillUpdatesRead(f.s,'run_command',{name:'other'}),/未执行/);
 f.s.skillReads['other:references/new.md']={complete:true};
 assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'run_command',{name:'other'}));
});
test('unrelated source changes during generation do not block an explicitly loaded current Skill command',async t=>{
 const f=fixture(t),store=new AgentStore(()=>path.join(f.root,'sessions')),s=store.create();
 const currentDir=path.join(f.root,'current');fs.mkdirSync(currentDir);
 fs.writeFileSync(path.join(currentDir,'SKILL.md'),'---\nname: current\ndescription: Current fixture\n---\n# Current rules\n');
 s.skillReads=f.s.skillReads;recordSkillRead(s,readSkill(f.catalog(),'current'));s.approvalMode='auto';store.save(s);
 let models=0,executions=0;
 const runtime=new AgentRuntime({store,refreshSkills:s=>refreshLoadedSkills(s,[f.root]),provider:()=>({contextWindowTokens:1000000}),
 tools:async()=>[{name:'run_command',confirm:true,schema:{type:'object'},execute:()=>{executions++;return{success:true};}}],
 model:async()=>{if(++models===1){fs.appendFileSync(f.entry,'unrelated change during request\n');return{role:'assistant',tool_calls:[{id:'current-operation',type:'function',function:{name:'run_command',arguments:JSON.stringify({skillContext:{name:'current'}})}}]};}return{role:'assistant',content:'done'};}});
 await runtime.start(s.id,'run current operation');await wait(runtime);
 assert.equal(executions,1);const final=store.get(s.id);assert.equal(final.status,'idle');assert.equal(final.calls[0].result.success,true);
 assert.equal(final.skillUpdates?.['generic:SKILL.md'],undefined);assert.equal(final.skillReads['generic:SKILL.md'].complete,true);
});
test('rereading a changed declared entry cannot authorize old arguments even with an unrelated stale entry',t=>{
 const f=fixture(t),{assertSkillUpdatesRead,skillEntryVersions}=require('../electron/agent/skill-refresh');
 const versions=skillEntryVersions(f.s);fs.appendFileSync(f.entry,'changed rule\n');f.refresh();
 recordSkillRead(f.s,readSkill(f.catalog(),'generic'));recordSkillRead(f.s,readSkillReference(f.catalog(),'generic','references/rule.md'));
 f.s.skillUpdates['other:SKILL.md']={name:'other',file:'SKILL.md'};
 assert.throws(()=>assertSkillUpdatesRead(f.s,'run_command',{name:'generic'},{entryVersions:versions}),e=>e.code==='SKILL_PLAN_STALE');
 assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'run_command',{name:'generic'},{entryVersions:skillEntryVersions(f.s)}));
});
test('receipt absolute paths across multiple loaded Skills do not revive an unrelated missing Skill gate',t=>{
 const f=fixture(t),{assertSkillUpdatesRead,skillEntryVersions}=require('../electron/agent/skill-refresh');
 for(const name of ['primary','support']){fs.mkdirSync(path.join(f.root,name));fs.writeFileSync(path.join(f.root,name,'SKILL.md'),`---\nname: ${name}\ndescription: Generic rules\n---\nRules\n`);recordSkillRead(f.s,readSkill(f.catalog(),name));}
 const primary=f.s.skillReads['primary:SKILL.md'].absolutePath,support=f.s.skillReads['support:SKILL.md'].absolutePath;
 fs.rmSync(f.directory,{recursive:true});f.refresh();
 const context={name:'primary',files:[primary,support]};
 for(const tool of ['run_command','run_commands'])assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,tool,context,{entryVersions:skillEntryVersions(f.s)}));
 assert.doesNotThrow(()=>assertSkillRead(f.s,context));
 assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'run_commands'));
 assert.throws(()=>assertSkillUpdatesRead(f.s,'run_commands',{name:'generic'}),e=>e.code==='SKILL_RELOAD_REQUIRED');
 assert.throws(()=>assertSkillRead(f.s,{name:'primary',files:[path.join(f.root,'invented/SKILL.md')]}),/读取凭证/);
 // A stale or partial cross-Skill dependency still cannot be bypassed.
 f.s.skillReads['support:SKILL.md'].complete=false;
 assert.throws(()=>assertSkillRead(f.s,context),/入口尚未完整加载/);
 assert.throws(()=>assertSkillUpdatesRead(f.s,'run_commands',context),e=>e.code==='SKILL_RELOAD_REQUIRED');
});
test('runtime accepts exact cross-Skill receipt paths and rejects a cross-dependency race',async t=>{
 for(const race of [false,true]){
  const f=fixture(t),store=new AgentStore(()=>path.join(f.root,'sessions')),s=store.create();
  for(const name of ['primary','support']){fs.mkdirSync(path.join(f.root,name));fs.writeFileSync(path.join(f.root,name,'SKILL.md'),`---\nname: ${name}\ndescription: Generic rules\n---\nRules\n`);recordSkillRead(f.s,readSkill(f.catalog(),name));}
  s.skillReads=f.s.skillReads;s.approvalMode='auto';store.save(s);fs.rmSync(f.directory,{recursive:true});
  const args={skillContext:{name:'primary',files:['primary','support'].map(name=>f.s.skillReads[`${name}:SKILL.md`].absolutePath)}};
  let models=0,executions=0;
  const runtime=new AgentRuntime({store,refreshSkills:s=>refreshLoadedSkills(s,[f.root]),provider:()=>({contextWindowTokens:1000000}),
   tools:async()=>[{name:'run_commands',confirm:true,schema:{type:'object'},execute:()=>{executions++;return{success:true};}}],
   model:async()=>{if(++models===1){if(race){fs.appendFileSync(path.join(f.root,'support/SKILL.md'),'changed during generation');const live=runtime.liveSessions.get(s.id);runtime.refreshSkillSources(live);recordSkillRead(live,readSkill(f.catalog(),'support'));}return{role:'assistant',tool_calls:[{id:'cross-receipts',type:'function',function:{name:'run_commands',arguments:JSON.stringify(args)}}]};}return{role:'assistant',content:'done'};}});
  await runtime.start(s.id,'run fixture');await wait(runtime);const final=store.get(s.id);
  assert.equal(executions,race?0:1);assert.equal(final.calls[0].result.success,!race);if(race)assert.equal(final.calls[0].result.errorCode,'SKILL_PLAN_STALE');
 }
});
