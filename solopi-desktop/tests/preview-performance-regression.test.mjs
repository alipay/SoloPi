import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {AgentStore}=require('../electron/agent/store');
const {AgentRuntime}=require('../electron/agent/runtime');
const {createTaskSummaryCache,readTaskSummaries}=require('../electron/task-summary-cache');
const ts=require('typescript');
function folder(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'preview-performance-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('5000-message waiting session does zero full loads for 1000 unchanged or unrelated progress notifications',t=>{
 const dir=folder(t), store=new AgentStore(()=>dir), s=store.create();
 s.messages=Array.from({length:5000},()=>({role:'user',content:'synthetic history'}));s.status='waiting';s.watch={kind:'task',id:'target',reviewCases:true};s.reviewCursors={target:1};store.save(s);
 const runtime=new AgentRuntime({store,tools:()=>[],provider:()=>({})});runtime.contexts.set(s.id,{});
 let loads=0;const get=store.get.bind(store);store.get=id=>{loads++;return get(id);};
 for(let i=0;i<1000;i++) {runtime.notify('task','other',{status:'running',caseEvents:[{revision:i+1}]});runtime.notify('task','target',{status:'running',caseEvents:[{revision:1}]});}
 runtime.resume(s.id);assert.equal(loads,0);
});
test('lightweight subscription index invalidates on external save and restart',t=>{
 const dir=folder(t),store=new AgentStore(()=>dir),s=store.create();s.status='waiting';s.watch={kind:'task',id:'old'};store.save(s);
 const external=new AgentStore(()=>dir);s.watch={kind:'battery',id:'new',reviewCases:false};s.reviewCursors={new:4};external.save(s);
 assert.equal(store.metadata(s.id).watch.id,'new');const restarted=new AgentStore(()=>dir);assert.equal(restarted.metadata(s.id).watch.kind,'battery');assert.equal(restarted.metadata(s.id).reviewCursors.new,4);
});
test('task summaries coalesce concurrent queries, reuse revision and invalidate atomic same-size replacements',async t=>{
 const dir=folder(t),file=path.join(dir,'state.json');fs.writeFileSync(file,'one');let loads=0;
 const read=createTaskSummaryCache({files:()=>[file],load:async()=>{loads++;await new Promise(setImmediate);return fs.readFileSync(file,'utf8');}});
 assert.deepEqual(await Promise.all(Array.from({length:50},()=>read())),Array(50).fill('one'));assert.equal(loads,1);
 await read();assert.equal(loads,1);fs.writeFileSync(file+'.tmp','two');fs.renameSync(file+'.tmp',file);assert.equal(await read(),'two');assert.equal(loads,2);
 fs.rmSync(file);await assert.rejects(read());fs.writeFileSync(file,'new');assert.equal(await read(),'new');
});
test('a revision changed during load is never retained as a cached snapshot',async t=>{
 const dir=folder(t),file=path.join(dir,'state');fs.writeFileSync(file,'before');let loads=0;
 const read=createTaskSummaryCache({files:()=>[file],load:async()=>{loads++;if(loads===1){fs.writeFileSync(file,'after');return 'before';}return 'after';}});
 assert.equal(await read(),'before');assert.equal(await read(),'after');assert.equal(loads,2);
});
test('worker projects large histories to summaries, supports backup, and surfaces corruption',async t=>{
 const dir=folder(t),file=path.join(dir,'state.json'),backup=path.join(dir,'backup.json');
 const task={id:'t',status:'success',cases:Array.from({length:5000},(_,i)=>({caseId:String(i),status:'success',caseSnapshot:{steps:[{config:{payload:'x'.repeat(100)}}]}})),performanceReports:{large:{samples:[1,2,3]}}};
 fs.writeFileSync(file,JSON.stringify({automationTasks:[task]}));let ticks=0;const timer=setInterval(()=>ticks++,1);
 const tasks=await readTaskSummaries([file,backup]);clearInterval(timer);assert.ok(ticks>0);assert.equal(tasks[0].summary.successCount,5000);assert.equal(tasks[0].cases,undefined);assert.equal(tasks[0].performanceReports,undefined);
 fs.renameSync(file,backup);fs.writeFileSync(file,'broken');assert.equal((await readTaskSummaries([file,backup]))[0].id,'t');fs.rmSync(backup);await assert.rejects(readTaskSummaries([file,backup]),/JSON|Unexpected/);
});
test('presentation feedback coalesces 300 draws, retains first-frame readiness, and rejects stale stream ACKs',()=>{
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/preview-feedback.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports});
 const sent=[],feedback=new exports.PreviewFeedback(p=>sent.push(p));feedback.reset('one');
 for(let i=0;i<300;i++){feedback.draw('one');if(i%8===7)feedback.ack(String(i),'one');}
 feedback.flush();assert.equal(sent.reduce((n,p)=>n+(p.presentedCount || 0),0),300);assert.ok(sent.length<42);assert.equal(sent[0].presentedCount,1);
 feedback.reset('two');const before=sent.length;feedback.draw('one');feedback.ack('stale','one');assert.equal(sent.length,before);feedback.draw('two');assert.equal(sent.at(-1).streamId,'two');
});

test('hidden document does not start a decoder; hiding active panel requests owned force-stop',()=>{
 const effects=[],calls=[],events=new Map();let stateIndex=0;
 const document={hidden:true,addEventListener:(n,fn)=>events.set(n,fn),removeEventListener:n=>events.delete(n)};
 const react={useState:initial=>{stateIndex++;return [typeof initial==='function'?initial():initial,()=>{}];},useRef:()=>({current:null}),useEffect:fn=>effects.push(fn)};
 const api={invoke:(channel,args)=>{calls.push({channel,args});return Promise.resolve({success:true});},on(){},removeListener(){}};
 const exports={};const code=ts.transpileModule(fs.readFileSync(new URL('../src/components/AgentMirrors.tsx',import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>name==='react'?react:name==='react/jsx-runtime'?{jsx:()=>null,jsxs:()=>null}:name==='lucide-react'?{}:name.includes('preview-feedback')?{PreviewFeedback:class{flush(){}}}:{H264PreviewDecoder:class{close(){}}},document,window:{glassbox:{ipcRenderer:api}},setInterval:()=>1,clearInterval(){},cancelAnimationFrame(){}});
 const target={role:'glasses',serial:'synthetic',taskId:'task'};
 exports.DevicePreview({target,sessionId:'session',embedded:true});const hiddenCleanups=effects.map(fn=>fn());assert.equal(calls.length,0);hiddenCleanups.forEach(fn=>fn?.());
 effects.length=0;document.hidden=false;exports.DevicePreview({target,sessionId:'session',embedded:true});const cleanups=effects.map(fn=>fn());assert.equal(calls[0].channel,'preview:start');
 document.hidden=true;events.get('visibilitychange')();cleanups.forEach(fn=>fn?.());assert.equal(calls.at(-1).channel,'preview:stop');assert.equal(calls.at(-1).args.force,true);assert.equal(calls.at(-1).args.serial,'synthetic');
});

test('cached persisted summaries still merge fresh active progress, external tasks, removals and delta filters',async()=>{
 const source=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');const start=source.indexOf("registerApplicationHandler('workflow-task:list'");const end=source.indexOf('\nasync function stopExternalWorkflowTask',start);let handler;
 const persisted={id:'local',status:'success',updatedAt:'2026-01-01T00:00:00Z',summary:{successCount:1}};
 const active={task:{id:'active',status:'running',updatedAt:'2026-01-02T00:00:00Z',cases:[{status:'success'},{status:'running'}]}};
 const {createWorkflowTaskSummary,getWorkflowTaskUpdatedAtMs}=require('../electron/workflow-task-sync');
 const context={registerApplicationHandler:(_name,fn)=>handler=fn,readPersistedTaskSummaries:async()=>[persisted],readVisibleTasks:()=>[{id:'external',externalSource:{dataDir:'/synthetic'},updatedAt:'2026-01-01T00:00:00Z'}],activeWorkflowTasks:new Map([['active',active]]),createWorkflowReportSummary:createWorkflowTaskSummary,getWorkflowTaskUpdatedAtMs,getGlassBoxDataDir:()=>'/synthetic',getRemovedWorkflowTaskIds:()=>['removed'],require:()=>({visibleTasks:tasks=>tasks})};
 vm.runInNewContext(source.slice(start,end),context);
 const first=await handler(null,{});assert.equal(first.success,true);assert.equal(first.tasks.find(t=>t.id==='active').summary.runningCount,1);assert.equal(first.tasks.length,3);assert.ok(first.removedTaskIds.includes('removed'));
 active.task={...active.task,status:'success',updatedAt:'2026-01-03T00:00:00Z',cases:[{status:'success'},{status:'success'}]};
 const next=await handler(null,{since:'2026-01-02T00:00:00Z'});assert.equal(next.tasks.length,2);assert.equal(next.tasks.find(t=>t.id==='active').summary.successCount,2);assert.equal(persisted.status,'success');
});

test('automatic next-case preparation never restarts preview while window remains hidden or minimized',async()=>{
 const source=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8');const start=source.indexOf('async function prepareEmbeddedPreview('),end=source.indexOf('\n}\n',start)+2;
 for(const minimized of [false,true]){
  const context={mainWindow:{isMinimized:()=>minimized,isVisible:()=>false,isDestroyed:()=>false,webContents:{isDestroyed:()=>false}},};vm.runInNewContext(source.slice(start,end),context);
  const result=await context.prepareEmbeddedPreview({start:()=>assert.fail('hidden preview must not restart')},{taskId:'fixture'});assert.equal(result.success,true);assert.equal(result.stage,'hidden');
 }
});
