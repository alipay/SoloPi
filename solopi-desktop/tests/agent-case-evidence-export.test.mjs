import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';
const require=createRequire(import.meta.url);
const {exportCaseEvidence}=require('../electron/agent/case-evidence-export');
const {createTools}=require('../electron/agent/tools');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'case-export-'));t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
 const phone=path.join(dir,'phone.log'),glasses=path.join(dir,'glasses.log'),video=path.join(dir,'owned.mp4');
 fs.writeFileSync(phone,'phone-before\n\nphone-a\nphone-b\nphone-after\n');fs.writeFileSync(glasses,'glass-before\nglass-a\n\nglass-b\nglass-after\n');fs.writeFileSync(video,'owned-video');
 const make=(id,start,end)=>({caseId:id,caseName:'Case '+id,status:'failed',error:'raw assertion',artifacts:{logs:[{path:phone,deviceType:'phone',sharedTaskLog:true,startSequence:start,endSequence:end},{path:glasses,deviceType:'glasses',sharedTaskLog:true,startSequence:start,endSequence:end}],recordings:[{path:video,caseId:id,success:true,evidenceReady:true}]}});
 return {dir,phone,glasses,video,task:{id:'task',cases:[make('a',1,3),make('b',3,4)]},options:{root:path.join(dir,'exports')}};
}
const load=r=>JSON.parse(fs.readFileSync(r.manifestPath));
test('exports both devices from report nonempty sequence ranges, excluding adjacent cases and physical blank lines',async t=>{
 const f=fixture(t),r=await exportCaseEvidence(f.task,{taskId:'task',caseIds:['a','b']},f.options),m=load(r);
 assert.equal(r.success,true);assert.equal(m.cases.length,2);
 assert.equal(gunzipSync(fs.readFileSync(m.cases[0].artifacts[0].localPath)).toString(),'phone-a\nphone-b\n');
 assert.equal(gunzipSync(fs.readFileSync(m.cases[0].artifacts[1].localPath)).toString(),'glass-a\nglass-b\n');
 assert.equal(gunzipSync(fs.readFileSync(m.cases[1].artifacts[0].localPath)).toString(),'phone-after\n');
 assert.equal(m.cases[0].artifacts[0].lineCount,2);assert.equal(m.cases[0].artifacts[0].sha256.length,64);
 assert.equal(fs.statSync(r.manifestPath).mode&0o777,0o600);assert.ok(fs.existsSync(r.reportPath));
 assert.doesNotMatch(JSON.stringify(r),/phone-a|glass-a/);
});
test('four historical failed cases use their report phone ranges rather than near glasses ranges',async t=>{
 const f=fixture(t);fs.writeFileSync(f.phone,Array.from({length:30},(_,i)=>`line-${i+1}`).join('\n'));
 f.task.cases=['d6581f','7cc343','afffac','e0337b'].map((id,i)=>({caseId:id,status:'failed',artifacts:{logs:[{path:f.phone,deviceType:'phone',sharedTaskLog:true,startSequence:i*3,endSequence:i*3+2}]}}));
 const r=await exportCaseEvidence(f.task,{taskId:'task',caseIds:f.task.cases.map(c=>c.caseId)},f.options);
 for(const [i,c] of load(r).cases.entries())assert.equal(gunzipSync(fs.readFileSync(c.artifacts[0].localPath)).toString(),`line-${i*3+1}\nline-${i*3+2}\n`);
});
test('missing/truncated range never exports the entire task and recordings cannot fall back to task-wide or foreign clips',async t=>{
 const f=fixture(t),c=f.task.cases[0];delete c.artifacts.logs[0].endSequence;c.artifacts.logs[1].endSequence=99;c.artifacts.recordings[0].caseId='foreign';
 const r=await exportCaseEvidence(f.task,{taskId:'task',caseIds:['a']},f.options),m=load(r);
 assert.equal(m.cases[0].artifacts.filter(a=>a.localPath).length,0);assert.equal(r.cases[0].missing.length,3);
 assert.equal(fs.readdirSync(path.dirname(m.cases[0].artifacts[1].localPath||path.join(path.dirname(r.manifestPath),'0','missing'))).length,0);
});
test('explicit device filter selects report role; unknown task/case and unfinished cases reject before export',async t=>{
 const f=fixture(t);const r=await exportCaseEvidence(f.task,{taskId:'task',caseIds:['a'],deviceTypes:['glasses']},f.options);
 assert.deepEqual(load(r).cases[0].artifacts.filter(a=>a.kind==='logs').map(a=>a.deviceType),['glasses']);
 await assert.rejects(exportCaseEvidence(f.task,{taskId:'other',caseIds:['a']},f.options),/taskId/);
 await assert.rejects(exportCaseEvidence(f.task,{taskId:'task',caseIds:['missing']},f.options),/不存在/);
 f.task.cases[0].status='running';await assert.rejects(exportCaseEvidence(f.task,{taskId:'task',caseIds:['a']},f.options),/尚未结束/);
});
test('cancellation cleans partial files and repeated exports do not overwrite earlier provenance',async t=>{
 const f=fixture(t),a=await exportCaseEvidence(f.task,{taskId:'task',caseIds:['a']},f.options),before=fs.readFileSync(a.manifestPath);
 const b=await exportCaseEvidence(f.task,{taskId:'task',caseIds:['a']},f.options);assert.notEqual(a.manifestPath,b.manifestPath);assert.deepEqual(fs.readFileSync(a.manifestPath),before);
 const ctrl=new AbortController();ctrl.abort();await assert.rejects(exportCaseEvidence(f.task,{taskId:'task',caseIds:['a']},{...f.options,signal:ctrl.signal}),{name:'AbortError'});
});
test('native tool exposes task and case selection only; no hand-entered source or sequence parameters',async t=>{
 const f=fixture(t);const tools=await createTools({invoke:async()=>({success:true,task:f.task}),commandDirectory:()=>f.dir,config:()=>({}),skillsRoots:()=>[]})({});
 const tool=tools.find(t=>t.name==='export_case_evidence');assert.deepEqual(tool.schema.required,['taskId','caseIds']);assert.equal(tool.schema.additionalProperties,false);
 assert.equal(tool.schema.properties.startSequence,undefined);assert.equal(tool.schema.properties.sourcePath,undefined);
 const r=await tool.execute({taskId:'task',caseIds:['a']},{signal:new AbortController().signal});assert.equal(load(r).taskId,'task');
});
test('a shared source is scanned once per batch and mutation during export rejects the entire incomplete export',async t=>{
 const f=fixture(t),original=fs.createReadStream,counts=new Map();let mutate=false;
 fs.createReadStream=function(file,...args){const stream=original.call(this,file,...args);if(file===f.phone || file===f.glasses){counts.set(file,(counts.get(file)||0)+1);if(mutate&&file===f.phone)stream.once('data',()=>fs.appendFileSync(file,'late-new-data\n'));}return stream;};
 try{
  await exportCaseEvidence(f.task,{taskId:'task',caseIds:['a','b']},f.options);assert.equal(counts.get(f.phone),1);assert.equal(counts.get(f.glasses),1);
  const before=fs.readdirSync(f.options.root);mutate=true;
  await assert.rejects(exportCaseEvidence(f.task,{taskId:'task',caseIds:['a']},f.options),/导出期间变化/);assert.deepEqual(fs.readdirSync(f.options.root),before);
 }finally{fs.createReadStream=original;}
});
