import {nodeFixtureSpawn} from './fixtures/node-broker.mjs';
import {NativeRuntime,disposeAll} from './fixtures/harness-lifecycle.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {taskCleanupRequest,taskCleanupWithBrokerForCli,getTasksQueryPayloadForCli,getTaskDetailPayloadForCli,getReportsReindexPayloadForCli} from '../scripts/glassbox-cli.mjs';
test.after(disposeAll);
const require=createRequire(import.meta.url),cleanup=require('../electron/task-cleanup'),visibility=require('../electron/task-visibility'),{mergeWorkflowStateForRendererSave}=require('../electron/workflow-task-sync');
function fixture(t,count=3){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task-cleanup-'));t.after(async()=>{await disposeAll();fs.rmSync(dir,{recursive:true,force:true})});const file=path.join(dir,'workflow-editor-state.json'),events=[];let failWrite=false;
 const tasks=Array.from({length:count},(_,i)=>({id:`tasks-${i}`,name:i<100?'temporary stress':'retained',status:'success',finishedAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z',reportDetailPath:path.join(dir,'workflow-report-details',`tasks-${i}.json`)}));
 fs.mkdirSync(path.join(dir,'workflow-report-details'),{recursive:true});for(const task of tasks)fs.writeFileSync(task.reportDetailPath,JSON.stringify({...task,cases:[]}));
 const write=s=>{if(failWrite)throw Error('fixture write failed');fs.writeFileSync(file,JSON.stringify(s));};write({cases:[{id:'unrelated-case'}],automationTasks:tasks});
 const read=()=>JSON.parse(fs.readFileSync(file,'utf8')),active=new Set();
 const run=cleanup.createTaskCleanup({dataDir:dir,readState:read,writeState:write,activeIds:()=>active,emit:e=>events.push(e)});
 return {dir,file,tasks,read,write,run,events,active,setFail:v=>{failWrite=v;}};
}
function withEnv(t,dir){const old=process.env.GLASSBOX_CLI_DATA_DIR,ui=process.env.LENSWIPER_TASK_UI_DATA_DIR;process.env.GLASSBOX_CLI_DATA_DIR=dir;process.env.LENSWIPER_TASK_UI_DATA_DIR=dir;t.after(()=>{if(old===undefined)delete process.env.GLASSBOX_CLI_DATA_DIR;else process.env.GLASSBOX_CLI_DATA_DIR=old;if(ui===undefined)delete process.env.LENSWIPER_TASK_UI_DATA_DIR;else process.env.LENSWIPER_TASK_UI_DATA_DIR=ui;});}
test('465 isolated records -> preview exactly 100 IDs -> remove 100 -> lists both 365, keep artifacts and stale UI saves cannot revive',async t=>{
 const f=fixture(t,465);withEnv(t,f.dir);const before=fs.readFileSync(f.file,'utf8'),request={query:'temporary stress',limit:100};
 const preview=await f.run({...request,dryRun:true});assert.equal(preview.success,true);assert.equal(preview.count,100);assert.equal(fs.readFileSync(f.file,'utf8'),before);assert.ok(preview.artifactBytes>0);
 const result=await f.run({...request});assert.equal(result.success,true);assert.deepEqual(result.taskIds,preview.taskIds);assert.equal(f.read().automationTasks.length,365);assert.deepEqual(f.events[0].removedTaskIds,preview.taskIds);assert.equal(f.read().cases[0].id,'unrelated-case');
 assert.equal(getTasksQueryPayloadForCli(['tasks','list']).total,365);assert.equal(getTasksQueryPayloadForCli(['reports','list'],{reportsOnly:true}).total,365);
 assert.equal(getTaskDetailPayloadForCli('tasks-0',{reportsOnly:true}).success,false);assert.equal(getTaskDetailPayloadForCli(f.tasks[0].reportDetailPath,{reportsOnly:true}).retainedArtifact,true);
 const merged=mergeWorkflowStateForRendererSave(JSON.parse(before),f.read());assert.equal(merged.automationTasks.length,365);assert.equal(merged.removedAutomationTasks.length,100);
 const reindex=getReportsReindexPayloadForCli(['reports','reindex','--dry-run']);assert.ok(reindex.results.every(r=>!result.taskIds.includes(r.taskId)));assert.equal(fs.existsSync(f.tasks[0].reportDetailPath),true);
});
test('requires target, validates flags/dates, keep exemption, AND filters, and rejects over-limit without silently truncating',async t=>{
 const f=fixture(t,55);for(const request of [{},{query:''},{before:'2026-02-30'},{olderThan:'1month'},{limit:0,query:'temporary'},{query:'temporary',dryRun:'true'},{status:'running'},{query:'temporary',unexpected:true}])assert.equal((await f.run(request)).success,false);
 const over=await f.run({query:'temporary'});assert.equal(over.errorCode,'TASK_CLEANUP_LIMIT');assert.equal(f.read().automationTasks.length,55);
 const preview=await f.run({query:'temporary',dryRun:true});assert.equal(preview.count,55);assert.equal(preview.overLimit,true);
 const actual=await f.run({query:'temporary',status:'success',before:'2026-10-01',keep:['tasks-0','tasks-1','tasks-2','tasks-3','tasks-4']});assert.equal(actual.count,50);assert.deepEqual(f.read().automationTasks.map(t=>t.id).sort(),['tasks-0','tasks-1','tasks-2','tasks-3','tasks-4']);
 assert.equal(cleanup.selectTasks([{id:'old',status:'stopped',updatedAt:'2026-10-01T00:00:00Z'},{id:'new',status:'stopped',updatedAt:'2026-10-02T00:00:00Z'}],{olderThan:'1d'},Date.parse('2026-10-02T12:00:00Z')).selected[0].id,'old');
});
test('all active/pending states and live-owner map refuse whole batch without stopping tasks',async t=>{
 const f=fixture(t);for(const status of ['pending','submitted','running','stopping']){const s=f.read();s.automationTasks[1].status=status;f.write(s);const r=await f.run({taskIds:['tasks-0','tasks-1']});assert.equal(r.errorCode,'TASK_ACTIVE');assert.equal(f.read().automationTasks.length,3);}
 const s=f.read();s.automationTasks[1].status='success';f.write(s);f.active.add('tasks-0');assert.equal((await f.run({taskIds:['tasks-0']})).errorCode,'TASK_ACTIVE');
});
test('purge removes owned package/run directory/logs/videos/detail; backup contains index and summary',async t=>{
 const f=fixture(t),task=f.tasks[0],runDir=path.join(f.dir,'logs/workflow-runs/run-0'),recordDir=path.join(f.dir,'logs/workflow-task-recordings/record-0'),pkg=path.join(f.dir,'report-packages/report-0.glassreport');
 for(const p of [path.join(runDir,'screenshot.png'),path.join(recordDir,'video.mp4'),path.join(recordDir,'log.txt'),pkg]){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'owned artifact');}
 fs.writeFileSync(task.reportDetailPath,JSON.stringify({...task,reportPackagePath:pkg,taskLogs:[{path:path.join(recordDir,'log.txt')}],cases:[{artifacts:{runDir,recordings:[{path:path.join(recordDir,'video.mp4')}]}}]}));
 const backup=path.join(f.dir,'backups'),preview=await f.run({taskIds:[task.id],purgeArtifacts:true,dryRun:true,backup});assert.equal(preview.success,true);assert.equal(fs.existsSync(backup),false);
 const actual=await f.run({taskIds:[task.id],purgeArtifacts:true,backup});assert.equal(actual.success,true);assert.equal(actual.purgeComplete,true);for(const p of [runDir,recordDir,pkg,task.reportDetailPath])assert.equal(fs.existsSync(p),false,p);assert.equal(JSON.parse(fs.readFileSync(actual.backupPath)).entries[0].id,task.id);
 assert.equal(fs.existsSync(f.tasks[1].reportDetailPath),true);
});
test('shared artifacts, symlink escape and foreign paths are refused before index or file changes',async t=>{
 const f=fixture(t),shared=path.join(f.dir,'logs/workflow-runs/shared');fs.mkdirSync(shared,{recursive:true});
 for(const task of f.tasks.slice(0,2))fs.writeFileSync(task.reportDetailPath,JSON.stringify({...task,cases:[{artifacts:{runDir:shared}}]}));
 assert.equal((await f.run({taskIds:['tasks-0'],purgeArtifacts:true})).errorCode,'TASK_ARTIFACT_SHARED');assert.equal(f.read().automationTasks.length,3);
 const outside=path.join(f.dir,'outside');fs.mkdirSync(outside);const link=path.join(f.dir,'logs/workflow-runs/link');fs.symlinkSync(outside,link);
 fs.writeFileSync(f.tasks[0].reportDetailPath,JSON.stringify({...f.tasks[0],cases:[{artifacts:{runDir:link}}]}));assert.equal((await f.run({taskIds:['tasks-0'],purgeArtifacts:true})).errorCode,'TASK_ARTIFACT_UNSAFE');assert.equal(fs.existsSync(outside),true);
});
test('optional preview does not bind later deletion; index commit failure rolls artifacts back',async t=>{
 const f=fixture(t),request={taskIds:['tasks-0'],purgeArtifacts:true};
 const preview=await f.run({...request,dryRun:true});assert.equal(preview.planToken,undefined);
 fs.appendFileSync(f.tasks[0].reportDetailPath,' ');assert.equal((await f.run(request)).success,true);assert.equal(f.read().automationTasks.length,2);
 const rollback=fixture(t);rollback.setFail(true);const r=await rollback.run(request);assert.equal(r.success,false);assert.equal(rollback.read().automationTasks.length,3);assert.equal(fs.existsSync(rollback.tasks[0].reportDetailPath),true);rollback.setFail(false);
});
test('crash recovery restores uncommitted moved files, completes committed purge, and visibility never republishes removed source tasks',async t=>{
 const f=fixture(t),trash=path.join(f.dir,'.task-cleanup-trash/recovery'),from=f.tasks[0].reportDetailPath,to=path.join(trash,'0');fs.mkdirSync(trash,{recursive:true});fs.renameSync(from,to);fs.writeFileSync(path.join(trash,'journal.json'),JSON.stringify({ids:['tasks-0'],moves:[[from,to]]}));cleanup.recoverCleanup(f.dir,f.read());assert.equal(fs.existsSync(from),true);
 const ui=path.join(f.dir,'ui');fs.mkdirSync(ui);visibility.enableTaskVisibility(ui);visibility.registerTaskSource(f.dir,ui);visibility.readVisibleTasks(ui);await f.run({taskIds:['tasks-0']});assert.equal(visibility.readVisibleTasks(ui).some(t=>t.id==='tasks-0'),false);assert.ok(visibility.readRemovedTaskIds(ui).includes('tasks-0'));
 visibility.publishVisibleTask(f.dir,{...f.tasks[0],updatedAt:'2099-01-01T00:00:00Z'},ui);assert.equal(visibility.readVisibleTasks(ui).some(t=>t.id==='tasks-0'),false);
 fs.renameSync(f.file,f.file+'.offline');assert.equal(visibility.readVisibleTasks(ui).some(t=>t.id==='tasks-0'),false);assert.ok(visibility.readRemovedTaskIds(ui).includes('tasks-0'));fs.renameSync(f.file+'.offline',f.file);
 fs.mkdirSync(trash,{recursive:true});fs.renameSync(from,to);fs.writeFileSync(path.join(trash,'journal.json'),JSON.stringify({ids:['tasks-0'],moves:[[from,to]]}));cleanup.recoverCleanup(f.dir,f.read());assert.equal(fs.existsSync(from),false);assert.equal(fs.existsSync(trash),false);
});
test('CLI parser and real child broker request use owner channel only; no deletion fallback',async t=>{
 assert.throws(()=>taskCleanupRequest(['tasks','clean']),/筛选/);assert.throws(()=>taskCleanupRequest(['tasks','clean','--query','x','--unknown']),/未知/);
 assert.deepEqual(taskCleanupRequest(['tasks','remove','a','b','--keep','b','--dry-run','--limit','100','--json']),{taskIds:['a','b'],keep:['b'],dryRun:true,limit:100});
 const f=fixture(t),broker=path.join(f.dir,'broker.cjs');fs.writeFileSync(broker,`const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--glassbox-cli-control-payload')+1]));if(p.action!=='task-cleanup')throw Error('wrong channel');const {createTaskCleanup}=require(${JSON.stringify(path.resolve('electron/task-cleanup.js'))});createTaskCleanup({dataDir:p.dataDir,readState:()=>JSON.parse(fs.readFileSync(${JSON.stringify(f.file)})),writeState:s=>fs.writeFileSync(${JSON.stringify(f.file)},JSON.stringify(s))})(p.request).then(r=>fs.writeFileSync(p.ackPath,JSON.stringify(r)));`);
 const deps={dataDir:f.dir,spawn:nodeFixtureSpawn(t),launch:{command:process.execPath,argsPrefix:[broker],packaged:true,cwd:f.dir}};
 const preview=await taskCleanupWithBrokerForCli(['tasks','remove','tasks-0','--dry-run'],deps);assert.equal(preview.count,1);assert.equal(f.read().automationTasks.length,3);
 const actual=await taskCleanupWithBrokerForCli(['tasks','remove','tasks-0'],deps);assert.deepEqual(actual.taskIds,preview.taskIds);assert.equal(f.read().automationTasks.length,2);
});
test('UI uses direct delete/ACK and deletion events; preload permits cleanup and blocks arbitrary channels',async()=>{
 const editor=fs.readFileSync(new URL('../src/components/WorkflowEditor.tsx',import.meta.url),'utf8');assert.match(editor,/invoke\('workflow-task:clean',request\)/);assert.match(editor,/applyTaskRemovals\(result.removedTaskIds/);assert.match(editor,/payload\?\.removedTaskIds/);assert.doesNotMatch(editor,/deletableTargets.forEach/);
 let api,forwarded=0;vm.runInNewContext(fs.readFileSync(new URL('../electron/preload.js',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_n,v)=>{api=v;}},ipcRenderer:{invoke:async()=>{forwarded++;return{success:true};}},webUtils:{}})});
 assert.equal((await api.ipcRenderer.invoke('workflow-task:clean',{dryRun:true})).success,true);await assert.rejects(api.ipcRenderer.invoke('workflow-task:erase-files'),/Unsupported/);assert.equal(forwarded,1);
});
test('actual UI delete controller -> actual preload -> registered owner handler removes 100/465 without preview and with live event',async t=>{
 const f=fixture(t,465),main=fs.readFileSync(new URL('../electron/main.js',import.meta.url),'utf8'),marker="registerApplicationHandler('workflow-task:clean',",start=main.indexOf(marker),handlerSource=main.slice(start+marker.length,main.indexOf('\n});',start)+2);
 const ui={tasks:[...f.tasks],confirmed:false,message:'',events:[],calls:[]},apply=ids=>{ui.tasks=ui.tasks.filter(t=>!ids.includes(t.id));};
 const deps={require:name=>require('../electron/'+name.slice(2)),readWorkflowState:f.read,writeWorkflowState:f.write,getGlassBoxDataDir:()=>f.dir,readVisibleTasks:()=>[],stopExternalWorkflowTask:()=>assert.fail('not external'),activeWorkflowTasks:new Map(),workflowReportWriter:{flush:async()=>{}},getWorkflowReportDetailPath:id=>path.join(f.dir,'workflow-report-details',id+'.json'),mainWindow:{isDestroyed:()=>false,webContents:{send:(name,payload)=>{ui.events.push({name,payload});apply(payload.removedTaskIds);}}},taskCleanupService:undefined};
 const handler=Function(...Object.keys(deps),'return ('+handlerSource+')')(...Object.values(deps));
 let api;vm.runInNewContext(fs.readFileSync(new URL('../electron/preload.js',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_n,v)=>{api=v;}},ipcRenderer:{invoke:async(channel,args)=>{ui.calls.push({channel,args});assert.equal(channel,'workflow-task:clean');return handler(null,args);}},webUtils:{}})});
 const editor=fs.readFileSync(new URL('../src/components/WorkflowEditor.tsx',import.meta.url),'utf8'),a=editor.indexOf('  const deleteAutomationTasks = async'),b=editor.indexOf('  const renderAutomationTasks',a),ts=require('typescript');
 const code=ts.transpileModule(editor.slice(a,b),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const args={taskCleanupSupported:true,taskCleanupLockRef:{current:false},electronApi:api,setRunMessage:s=>{ui.message=s;},setTaskCleanupBusy:()=>{},purgeTaskArtifacts:false,window:{confirm:()=>ui.confirmed},applyTaskRemovals:apply};
 const remove=Function(...Object.keys(args),code+';return deleteAutomationTasks;')(...Object.values(args)),ids=f.tasks.slice(0,100).map(t=>t.id);
 await remove(ids);assert.equal(f.read().automationTasks.length,365);assert.equal(ui.tasks.length,365);assert.equal(ui.events.length,1);assert.equal(ui.events[0].name,'workflow-task:changed');assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].args.dryRun,undefined);assert.equal(ui.calls[0].args.planToken,undefined);
 assert.match(ui.message,/已移除 100/);
 const oldService=Function(...Object.keys(args),code+';return deleteAutomationTasks;')(...Object.values({...args,taskCleanupSupported:false})),count=ui.calls.length;await oldService(['tasks-100']);assert.equal(ui.calls.length,count);assert.match(ui.message,/重启/);
});
test('corrupt details still allow index-only removal, but purge refuses unknown ownership',async t=>{
 const f=fixture(t);fs.writeFileSync(f.tasks[0].reportDetailPath,'invalid json');assert.equal((await f.run({taskIds:['tasks-0'],purgeArtifacts:true})).success,false);
 const r=await f.run({taskIds:['tasks-0']});assert.equal(r.success,true);assert.ok(r.tasks[0].detailWarning);assert.equal(fs.existsSync(f.tasks[0].reportDetailPath),true);
 const s=f.read();delete s.automationTasks[0].reportDetailPath;f.write(s);assert.equal((await f.run({taskIds:['tasks-1'],purgeArtifacts:true})).success,true);assert.equal(fs.existsSync(f.tasks[1].reportDetailPath),false);
});
test('backup symlink into selected run directory is rejected before any task is removed',async t=>{
 const f=fixture(t),run=path.join(f.dir,'logs/workflow-runs/owned'),backup=path.join(f.dir,'backup-link');fs.mkdirSync(run,{recursive:true});fs.symlinkSync(run,backup);
 fs.writeFileSync(f.tasks[0].reportDetailPath,JSON.stringify({...f.tasks[0],cases:[{artifacts:{runDir:run}}]}));
 const r=await f.run({taskIds:['tasks-0'],purgeArtifacts:true,backup});assert.equal(r.errorCode,'TASK_BACKUP_UNSAFE');assert.equal(f.read().automationTasks.length,3);assert.deepEqual(fs.readdirSync(run),[]);
});
test('a committed index with later persistence failure is reported as already removed and recovers pending purge',async t=>{
 const f=fixture(t),run=cleanup.createTaskCleanup({dataDir:f.dir,readState:f.read,writeState:s=>{f.write(s);throw Error('backup-state write failed');}});
 const result=await run({taskIds:['tasks-0'],purgeArtifacts:true});assert.equal(result.success,false);assert.equal(result.errorCode,'TASK_CLEANUP_COMMIT_ACK_FAILED');assert.deepEqual(result.removedTaskIds,['tasks-0']);assert.equal(f.read().automationTasks.length,2);cleanup.recoverCleanup(f.dir,f.read());assert.equal(fs.existsSync(f.tasks[0].reportDetailPath),false);
});
test('concurrent requests serialize and cannot delete the same task twice',async t=>{
 const f=fixture(t);const results=await Promise.all([f.run({taskIds:['tasks-0']}),f.run({taskIds:['tasks-0']}),f.run({taskIds:['tasks-1']})]);assert.equal(results[0].success,true);assert.equal(results[1].errorCode,'TASK_NOT_FOUND');assert.equal(results[2].success,true);assert.equal(f.read().automationTasks.length,1);assert.equal(f.events.length,2);
});
test('Agent directly deletes isolated tasks without preview or token and retains credential redaction',async t=>{
 const f=fixture(t,17),{createTools,redact}=require('../electron/agent/tools');
 const tools=await createTools({readState:f.read,config:()=>({mcpServers:[]}),skillsRoots:()=>[],invoke:async(channel,_event,args)=>{assert.equal(channel,'workflow-task:clean');assert.equal(args.dryRun,undefined);return{...await f.run(args),apiKey:'private-api',nested:{accessToken:'private-access'}};}})({},new AbortController().signal);
 const tool=tools.find(t=>t.name==='clean_tasks');assert.equal(tool.schema.properties.planToken,undefined);
 const result=await tool.execute({query:'temporary stress'});assert.equal(result.success,true);assert.equal(result.count,17);assert.equal(result.planToken,undefined);assert.equal(f.read().automationTasks.length,0);assert.doesNotMatch(JSON.stringify(result),/private-api|private-access/);
 assert.deepEqual(redact({apiKey:'secret',nested:{accessToken:'secret'}}),{nested:{}});
});
test('restored Agent with legacy token error and old CLI help discovers current schema, corrects invalid refresh and deletes without token',async t=>{
 const f=fixture(t,17),{createTools}=require('../electron/agent/tools'),{AgentRuntime}={AgentRuntime:NativeRuntime},{AgentStore}=require('../electron/agent/store');
 const store=new AgentStore(()=>path.join(f.dir,'agent')),s=store.create();s.approvalMode='auto';
 s.messages=[{role:'user',content:'old cleanup request'},{role:'assistant',content:'Historical result: execution requires planToken. Installed CLI supports tasks list/show/watch/stop.'}];store.save(s);
 let requests=0,executions=0;
 const factory=createTools({config:()=>({mcpServers:[]}),skillsRoots:()=>[],readState:f.read,executeCommand:()=>assert.fail('old installed CLI must not be called'),invoke:async(channel,_event,args)=>{assert.equal(channel,'workflow-task:clean');assert.equal(args.planToken,undefined);assert.equal(args.dryRun,undefined);executions++;return f.run(args);}});
 const call=(name,args)=>({role:'assistant',content:null,tool_calls:[{id:'current-'+requests,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
 const runtime=new AgentRuntime({store,tools:factory,provider:()=>({}),model:async({tools,messages})=>{
  requests++;

  const schema=tools.find(t=>t.function.name==='clean_tasks').function.parameters;assert.equal(schema.properties.planToken,undefined);assert.equal(schema.properties.refresh,undefined);
  if(requests===1)return call('clean_tasks',{query:'temporary stress',refresh:true});
  if(requests===2){assert.match(messages.findLast(m=>m.role==='tool').content,/additional properties|refresh|Error/);return call('clean_tasks',{query:'temporary stress'});}
  const result=JSON.parse(messages.findLast(m=>m.role==='tool').content);assert.equal(result.success,true);assert.equal(result.count,17);return{role:'assistant',content:'删除完成'};
 }});
 await runtime.start(s.id,'删除已指定的临时任务',{});for(let i=0;i<800 && runtime.active.size;i++)await new Promise(r=>setTimeout(r,5));
 const final=store.get(s.id);assert.equal(final.status,'idle',final.error);assert.equal(requests,3);assert.equal(executions,1);assert.equal(f.read().automationTasks.length,0);assert.equal(final.calls.filter(c=>c.name==='clean_tasks' && c.status==='done').length,1);
});
