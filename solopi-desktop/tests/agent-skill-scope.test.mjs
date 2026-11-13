import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {discoverSkills,readSkill}=require('../electron/agent/skills');
const {recordSkillRead}=require('../electron/agent/skill-reading');
const {refreshLoadedSkills,skillUpdateFrame,assertSkillUpdatesRead}=require('../electron/agent/skill-refresh');
const {activateSkills,activeSkillNames}=require('../electron/agent/skill-scope');
const {skillCatalogFrame}=require('../electron/agent/skill-catalog-frame');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-skill-scope-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const write=(name,body='Rules')=>{const p=path.join(root,name,'SKILL.md');fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,`---\nname: ${name}\ndescription: Generic ${name}\n---\n${body}\n`);return p;};
 write('archived');write('current');const catalog=()=>discoverSkills([root]).skills;
 const s={id:'scope-test',messages:[{role:'user',content:'Earlier unrelated task'}],calls:[]};
 recordSkillRead(s,readSkill(catalog(),'archived'));s.messages.push({role:'user',content:'New request'});
 return{root,s,write,catalog,refresh:()=>refreshLoadedSkills(s,[root])};
}
test('legacy missing Skill and changed historical body create no new read obligations or prompt notices',t=>{
 const f=fixture(t);delete f.s.activeSkillScope;
 f.s.skillUpdates={'archived:SKILL.md':{name:'archived',file:'SKILL.md',success:false,error:'Skill 不存在',content:'PRIVATE_OLD_BODY'}};
 fs.rmSync(path.join(f.root,'archived'),{recursive:true});const prior=JSON.stringify(f.s.skillReads);
 assert.deepEqual(f.refresh(),[]);assert.equal(skillUpdateFrame(f.s),'');assert.equal(JSON.stringify(f.s.skillReads),prior);
 const frame=skillCatalogFrame(f.s);assert.match(frame,/current/);assert.doesNotMatch(frame,/archived|PRIVATE_OLD_BODY/);
 assert.ok(f.s.skillUpdates['archived:SKILL.md']);assert.equal(f.s.skillUpdates['archived:SKILL.md'].content,undefined);
 assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'run_command'));
});
test('only explicit use activates dependencies; new human messages reset scope without guessing continuation text',t=>{
 const f=fixture(t);assert.equal(activeSkillNames(f.s).size,0);
 recordSkillRead(f.s,readSkill(f.catalog(),'current'));assert.deepEqual([...activeSkillNames(f.s)],['current']);
 f.s.messages.push({role:'user',source:'platform',content:'Task result notification'});assert.ok(activeSkillNames(f.s).has('current'));
 f.s.messages.push({role:'user',content:'Continue'});assert.equal(activeSkillNames(f.s).size,0);
 assert.ok(f.s.skillReads['current:SKILL.md'].complete);activateSkills(f.s,['current']);assert.ok(activeSkillNames(f.s).has('current'));
 f.s.messages.push({role:'user',content:'A different request'});assert.equal(activeSkillNames(f.s).size,0);
});
test('a resumed current dependency remains active, but legacy sessions do not infer scope from all read receipts',t=>{
 const f=fixture(t);recordSkillRead(f.s,readSkill(f.catalog(),'current'));
 const reopened=JSON.parse(JSON.stringify(f.s));fs.appendFileSync(path.join(f.root,'current/SKILL.md'),'New rule');
 refreshLoadedSkills(reopened,[f.root]);assert.match(skillUpdateFrame(reopened),/current/);assert.doesNotMatch(skillUpdateFrame(reopened),/archived/);
 const legacy=JSON.parse(JSON.stringify(f.s));delete legacy.activeSkillScope;
 refreshLoadedSkills(legacy,[f.root]);assert.equal(skillUpdateFrame(legacy),'');assert.equal(legacy.skillReads['current:SKILL.md'].complete,true);
});
test('current catalog replaces removed and disabled entries and never injects instruction bodies',t=>{
 const f=fixture(t);f.write('current','PRIVATE_INSTRUCTION_BODY');f.refresh();const before=f.s.skillCatalogView.revision;
 assert.doesNotMatch(skillCatalogFrame(f.s),/PRIVATE_INSTRUCTION_BODY/);
 fs.rmSync(path.join(f.root,'archived'),{recursive:true});f.write('added');f.refresh();
 assert.notEqual(f.s.skillCatalogView.revision,before);assert.deepEqual(f.s.skillCatalogView.entries.map(s=>s.name),['added','current']);
 refreshLoadedSkills(f.s,[f.root],{disabledSkills:['current']});assert.deepEqual(f.s.skillCatalogView.entries.map(s=>s.name),['added']);
 assert.ok(fs.existsSync(path.join(f.root,'current/SKILL.md')));
});
test('missing active dependency affects only its load/declaration and can recover after the source reappears',t=>{
 const f=fixture(t);recordSkillRead(f.s,readSkill(f.catalog(),'current'));fs.rmSync(path.join(f.root,'current'),{recursive:true});f.refresh();
 assert.match(skillUpdateFrame(f.s),/current/);assert.throws(()=>assertSkillUpdatesRead(f.s,'run_command',{name:'current'}),e=>e.code==='SKILL_RELOAD_REQUIRED');
 assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'run_command'));assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'stop_task',{name:'current'}));
 f.write('current','Restored rules');f.refresh();assert.equal(f.s.skillUpdates['current:SKILL.md'].success,undefined);
 recordSkillRead(f.s,readSkill(f.catalog(),'current'));assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'run_command',{name:'current'}));assert.equal(skillUpdateFrame(f.s),'');
});
test('incomplete provider scans do not falsely remove Skills or lock ordinary tools',t=>{
 const f=fixture(t);recordSkillRead(f.s,readSkill(f.catalog(),'current'));f.refresh();const prior=f.s.skillCatalogView.entries;
 const unavailableRoot=path.join(f.root,'root-is-file');fs.writeFileSync(unavailableRoot,'not a directory');
 refreshLoadedSkills(f.s,[unavailableRoot]);assert.equal(f.s.skillCatalogView.complete,false);assert.deepEqual(f.s.skillCatalogView.entries,prior);
 assert.match(skillCatalogFrame(f.s),/不得据此推断任何Skill已删除/);assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'run_command'));
 assert.throws(()=>assertSkillUpdatesRead(f.s,'run_command',{name:'current'}),e=>e.code==='SKILL_CATALOG_UNAVAILABLE');
 f.refresh();assert.equal(f.s.skillCatalogView.complete,true);assert.doesNotThrow(()=>assertSkillUpdatesRead(f.s,'run_command',{name:'current'}));
});
test('inactive body edits leave catalog identity stable, then explicit reuse validates the current source',t=>{
 const f=fixture(t);recordSkillRead(f.s,readSkill(f.catalog(),'current'));f.refresh();const revision=f.s.skillCatalogView.revision;
 f.s.messages.push({role:'user',content:'Next request'});fs.appendFileSync(path.join(f.root,'current/SKILL.md'),'Updated body');f.refresh();
 assert.equal(f.s.skillCatalogView.revision,revision);assert.equal(skillUpdateFrame(f.s),'');
 activateSkills(f.s,['current']);f.refresh();assert.match(skillUpdateFrame(f.s),/current/);assert.throws(()=>assertSkillUpdatesRead(f.s,'run_command',{name:'current'}),e=>e.code==='SKILL_RELOAD_REQUIRED');
});
test('actual runtime resumes from a valid receipt without chasing an unavailable historical Skill',async t=>{
 const f=fixture(t),{AgentStore}=require('../electron/agent/store'),{AgentRuntime}=require('../electron/agent/runtime');
 const store=new AgentStore(()=>path.join(f.root,'sessions')),s=store.create();s.messages=f.s.messages.slice(0,1);s.skillReads=f.s.skillReads;
 recordSkillRead(s,readSkill(f.catalog(),'current'));fs.rmSync(path.join(f.root,'archived'),{recursive:true});
 s.skillUpdates={'archived:SKILL.md':{name:'archived',file:'SKILL.md',success:false,error:'Skill 不存在'}};s.approvalMode='auto';store.save(s);
 let requests=0,executed=0;
 const runtime=new AgentRuntime({store,refreshSkills:s=>refreshLoadedSkills(s,[f.root]),provider:()=>({contextWindowTokens:1000000}),
  tools:async()=>[{name:'run_command',confirm:true,schema:{type:'object'},execute:()=>{executed++;return{success:true};}}],
  model:async({messages})=>{requests++;assert.doesNotMatch(messages[0].content,/archived|updated-skill-sources/);
   if(requests===1)return{role:'assistant',tool_calls:[{id:'reuse-current',type:'function',function:{name:'run_command',arguments:JSON.stringify({skillContext:{name:'current'}})}}]};
   return{role:'assistant',content:'done'};}});
 t.after(()=>runtime.stopAll());await runtime.start(s.id,'Continue');for(let i=0;i<200&&runtime.active.size;i++)await new Promise(r=>setTimeout(r,5));
 const final=store.get(s.id);assert.equal(final.status,'idle',final.error);assert.equal(requests,2);assert.equal(executed,1);assert.deepEqual(final.calls.map(c=>c.name),['run_command']);assert.ok(final.skillUpdates['archived:SKILL.md']);
});
