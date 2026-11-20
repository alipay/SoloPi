import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Context} from '@deepseek-ai/cordis';
import {ToolResultPruner} from '@deepseek-ai/dsh-compaction-tool-result-pruner';
const {AgentStore}=createRequire(import.meta.url)('../electron/agent/store.js');
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'evidence-page-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return{dir,store:new AgentStore(()=>dir),pruner:new ToolResultPruner(new Context())};}
test('escaped evidence pages survive native pruning and nextOffset reconstructs every original character',t=>{
 const f=fixture(t);f.store.saveEvidence('session','evidence',{document:('前\\"\n'+String.fromCharCode(1)+'😀').repeat(5000)+'MIDDLE_REQUIRED_RULE_END'},{taskId:'task-one',caseId:'case-one'});
 const original=readFileSync(join(f.dir,'session-evidence/evidence.json'),'utf8'),pages=[];let offset=0;
 do{const p=f.store.readEvidence('session','evidence',offset,16000);assert.equal(f.pruner.pruneContent([{type:'text',text:JSON.stringify(p)}]),null);assert.equal(p.search.source.taskId,'task-one');assert.equal(p.offset,offset);pages.push(p.content);if(p.nextOffset===null)break;assert.equal(p.nextOffset,offset+p.content.length);assert.ok(p.nextOffset>offset);offset=p.nextOffset;}while(pages.length<1000);
 assert.equal(pages.join(''),original);assert.ok(pages.length>2);
});
test('literal search preserves its true source offset when the serialized page shrinks',t=>{
 const f=fixture(t);f.store.saveEvidence('session','evidence',{document:'PREFIX_TARGET'+('\\"'.repeat(12000))+'SUFFIX'});
 const original=readFileSync(join(f.dir,'session-evidence/evidence.json'),'utf8'),p=f.store.readEvidence('session','evidence',0,16000,'TARGET');assert.equal(p.offset,original.indexOf('TARGET'));assert.ok(p.content.startsWith('TARGET'));assert.equal(p.nextOffset,p.offset+p.content.length);assert.equal(f.pruner.pruneContent([{type:'text',text:JSON.stringify(p)}]),null);assert.equal(f.store.readEvidence('session','evidence',0,16000,'absent').found,false);
});
test('evidence projection example uses an actual array accepted by the runtime schema',async t=>{
 const f=fixture(t),{AgentRuntime}=createRequire(import.meta.url)('../electron/agent/runtime.js'),Ajv=createRequire(import.meta.url)('ajv');const s=f.store.create();s.approvalMode='auto';f.store.save(s);f.store.saveEvidence(s.id,'fixture-evidence',{content:{result:{stdout:'完整中文😀'}}});let checked=false;
 const runtime=new AgentRuntime({store:f.store,provider:async()=>({}),tools:async()=>[],model:async options=>{const tool=options.tools.find(x=>x.function?.name==='read_evidence');const match=/完整示例：(\{[^。]+\})。/.exec(tool.function.description);assert.ok(match);const args=JSON.parse(match[1]);args.evidenceId='fixture-evidence';const validate=new Ajv({strict:false}).compile(tool.function.parameters);assert.equal(validate(args),true);assert.equal(validate({...args,jsonPointers:JSON.stringify(args.jsonPointers)}),false);const result=f.store.projectEvidence(s.id,args.evidenceId,args.jsonPointers);assert.match(JSON.stringify(result),/完整中文😀/);checked=true;return{role:'assistant',content:'done'};}});t.after(()=>runtime.stopAll());await runtime.start(s.id,'read evidence');for(let i=0;i<100&&runtime.active.size;i++)await new Promise(r=>setTimeout(r,5));assert.equal(checked,true);assert.equal(f.store.get(s.id).status,'idle');
});
