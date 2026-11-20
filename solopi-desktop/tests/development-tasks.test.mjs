import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),dev=require('../electron/development-tasks'),visibility=require('../electron/task-visibility');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lw-retention-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const owner=path.join(dir,'owner'),root=path.join(dir,'managed');fs.mkdirSync(owner);fs.mkdirSync(root);return{dir,owner,root};}
function workspace(f,name,tasks=[],preparedAt='2026-10-01T00:00:00Z') {const dir=path.join(f.root,name);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'dev-workspace.json'),JSON.stringify({schemaVersion:'lenswiper.dev-workspace.v1',mode:'development',sourceDataDir:f.owner,dataDir:dir,preparedAt}));fs.writeFileSync(path.join(dir,'workflow-editor-state.json'),JSON.stringify({automationTasks:tasks}));dev.registerWorkspace(dir,f.owner);return dir;}
const oldTask={id:'old',status:'failed',finishedAt:'2026-10-01T00:00:00Z',executionProvenance:{mode:'development'}};
test('managed development tasks share UI visibility and require its capability before dispatch',t=>{
 const f=fixture(t),dir=workspace(f,'new',[oldTask]);
 assert.throws(()=>visibility.assertTaskVisibility(dir,f.owner),{code:'TASK_UI_VISIBILITY_UNAVAILABLE'});
 visibility.enableTaskVisibility(f.owner);
 assert.equal(visibility.assertTaskVisibility(dir,f.owner).mode,'indexed');
 assert.equal(visibility.readVisibleTasks(f.owner)[0].id,'old'); // restart recovery from registry
 const running={...oldTask,status:'running',updatedAt:new Date().toISOString()};fs.writeFileSync(path.join(dir,'workflow-editor-state.json'),JSON.stringify({automationTasks:[running]}));visibility.publishVisibleTask(dir,running,f.owner);
 assert.equal(visibility.readVisibleTasks(f.owner)[0].status,'running');
 assert.deepEqual(dev.visibleTasks([oldTask,{id:'normal',name:'[DEV] innocent title'}],f.owner).map(t=>t.id),['old','normal']);
 assert.deepEqual(visibility.readVisibleTasks(f.owner,{includeDevelopment:false}),[]);
 assert.throws(()=>visibility.deleteVisibleTask(f.owner,'old'),/先停止/);
 const stopped={...oldTask,status:'stopped',updatedAt:new Date().toISOString()};fs.writeFileSync(path.join(dir,'workflow-editor-state.json'),JSON.stringify({automationTasks:[stopped]}));visibility.publishVisibleTask(dir,stopped,f.owner);
 assert.equal(visibility.getVisibleTask(f.owner,'old').status,'stopped');
 assert.equal(visibility.deleteVisibleTask(f.owner,'old'),true);
 assert.deepEqual(visibility.readVisibleTasks(f.owner),[]);
});
test('expired managed workspaces are removed; active, recent, unknown, live-owner and symlink targets are preserved',async t=>{
 const f=fixture(t),expired=workspace(f,'expired',[oldTask]),active=workspace(f,'active',[{...oldTask,status:'running'}]),recent=workspace(f,'recent',[oldTask],'2026-10-14T00:00:00Z'),unknown=workspace(f,'ordinary',[{...oldTask,executionProvenance:undefined}]),live=workspace(f,'live',[oldTask]);
 const manifest=JSON.parse(fs.readFileSync(path.join(live,'dev-workspace.json')));manifest.ownerPid=42;fs.writeFileSync(path.join(live,'dev-workspace.json'),JSON.stringify(manifest));
 const r=await dev.sweep({ownerDir:f.owner,root:f.root,now:Date.parse('2026-10-15T00:00:00Z'),alive:p=>p===42});assert.deepEqual(r.removedWorkspaces,[fs.realpathSync(f.root)+path.sep+path.basename(expired)]);for(const dir of [active,recent,unknown,live])assert.equal(fs.existsSync(dir),true);
 const outside=path.join(f.dir,'outside');fs.mkdirSync(outside);const link=path.join(f.root,'linked');fs.symlinkSync(outside,link);assert.equal(dev.registerWorkspace(link,f.owner),false);assert.equal(fs.existsSync(outside),true);
});
test('legacy expiry batches by real source through owner cleanup and excludes normal or active tasks',async t=>{
 const f=fixture(t),calls=[],sourceA=workspace(f,'source-a',[{...oldTask,id:'a'},{...oldTask,id:'b'}]),sourceB=workspace(f,'source-b',[{...oldTask,id:'c'}]),task=(id,source)=>({...oldTask,id,externalSource:{dataDir:source==='source-a'?sourceA:sourceB}});
 const r=await dev.sweep({ownerDir:f.owner,now:Date.parse('2026-10-15T00:00:00Z'),listLegacy:()=>[task('a','source-a'),task('b','source-a'),task('c','source-b'),{...task('running','source-b'),status:'pending'},{...task('normal','source-a'),executionProvenance:undefined}],cleanLegacy:async(tasks,request)=>{calls.push({tasks,request});return{success:true,removedTaskIds:request.taskIds};}});
 assert.equal(calls.length,2);assert.deepEqual(calls[0].request,{taskIds:['a','b'],purgeArtifacts:true,limit:2});assert.deepEqual(r.removedTaskIds,['a','b','c']);
});
test('retention runs on startup and each day, and stops scheduling on application exit',async t=>{
 const f=fixture(t);t.mock.timers.enable({apis:['setInterval']});let calls=0;
 const stop=dev.startRetention({ownerDir:f.owner,listLegacy:()=>{calls++;return[];}});await new Promise(setImmediate);assert.equal(calls,1);
 t.mock.timers.tick(dev.INTERVAL_MS);await new Promise(setImmediate);assert.equal(calls,2);
 stop();t.mock.timers.tick(dev.INTERVAL_MS);await new Promise(setImmediate);assert.equal(calls,2);t.mock.timers.reset();
});
test('stopping retention before a delayed listing completes does not launch cleanup',async t=>{
 const f=fixture(t);let release,cleaned=0;const listing=new Promise(r=>release=r);
 const stop=dev.startRetention({ownerDir:f.owner,listLegacy:()=>listing,cleanLegacy:()=>{cleaned++;}});stop();release([{...oldTask,externalSource:{dataDir:'old-source'}}]);await new Promise(setImmediate);assert.equal(cleaned,0);
});
test('packaged CLI visibility helper loads its staged development policy dependency',t=>{
 const f=fixture(t);for(const [source,target] of [['product-identity.js','product-identity.js'],['task-visibility.js','task-visibility.cjs'],['task-removal-index.js','task-removal-index.cjs'],['development-tasks.js','development-tasks.cjs']])fs.copyFileSync(new URL('../electron/'+source,import.meta.url),path.join(f.dir,target));
 const staged=require(path.join(f.dir,'task-visibility.cjs'));assert.deepEqual(staged.visibleTaskSummaries([oldTask,{id:'keep',name:'[DEV] title only'}],f.owner).map(t=>t.id),['old','keep']);
});
test('formal CLI list and reports retain development task identity and queryable detail',async t=>{
 const f=fixture(t),prior={data:process.env.GLASSBOX_CLI_DATA_DIR,ui:process.env.LENSWIPER_TASK_UI_DATA_DIR};
 process.env.GLASSBOX_CLI_DATA_DIR=f.owner;process.env.LENSWIPER_TASK_UI_DATA_DIR=f.owner;
 t.after(()=>{for(const [key,value] of [['GLASSBOX_CLI_DATA_DIR',prior.data],['LENSWIPER_TASK_UI_DATA_DIR',prior.ui]])if(value===undefined)delete process.env[key];else process.env[key]=value;});
 fs.writeFileSync(path.join(f.owner,'workflow-editor-state.json'),JSON.stringify({automationTasks:[oldTask,{id:'formal',name:'[DEV] user title only',status:'success',finishedAt:'2026-10-01T00:00:00Z'}]}));
 const cli=await import('../scripts/glassbox-cli.mjs');assert.deepEqual(cli.getTasksQueryPayloadForCli(['tasks','list']).tasks.map(t=>t.id),['old','formal']);assert.deepEqual(cli.getTasksQueryPayloadForCli(['reports','list'],{reportsOnly:true}).tasks.map(t=>t.id),['old','formal']);
 assert.equal(cli.getTaskDetailPayloadForCli('old').success,true);
});

test('stale visibility caches never launch a Broker for absent sources, missing IDs or changed task status',async t=>{
 const f=fixture(t),changed=workspace(f,'changed',[{...oldTask,id:'active',status:'running'},{...oldTask,id:'recent',finishedAt:'2026-10-15T00:00:00Z'},{...oldTask,id:'normal',executionProvenance:undefined}]);
 const missing=path.join(f.dir,'does-not-exist'),rows=[{...oldTask,id:'absent-source',externalSource:{dataDir:missing}},...['missing-id','active','recent','normal'].map(id=>({...oldTask,id,externalSource:{dataDir:changed}}))];
 let launches=0;const r=await dev.sweep({ownerDir:f.owner,root:f.root,now:Date.parse('2026-10-15T00:00:00Z'),listLegacy:()=>rows,cleanLegacy:()=>{launches++;assert.fail('stale records must not launch Electron');}});
 assert.equal(launches,0);assert.deepEqual(r.errors,[]);assert.equal(fs.existsSync(missing),false);assert.equal(fs.existsSync(changed),true);
});
test('missing cached IDs do not block cleanup of real eligible source tasks',async t=>{
 const f=fixture(t),dir=workspace(f,'mixed',[oldTask]);let request;
 await dev.sweep({ownerDir:f.owner,root:f.root,now:Date.parse('2026-10-15T00:00:00Z'),listLegacy:()=>[{...oldTask,id:'stale',externalSource:{dataDir:dir}}],cleanLegacy:async(_tasks,r)=>{request=r;return{success:true,removedTaskIds:r.taskIds};}});
 assert.deepEqual(request.taskIds,['old']);
});

test('default workspace root is durable, owner-scoped and respects seven-day retention', async t => {
 const f=fixture(t); f.root=dev.workspaceRoot(f.owner); fs.mkdirSync(f.root,{recursive:true});
 assert.equal(f.root.startsWith(f.owner + path.sep),false);
 assert.notEqual(dev.workspaceRoot(path.join(f.dir,'other-owner')),f.root);
 const task={...oldTask,finishedAt:'2026-11-01T00:00:00Z'};
 const dir=workspace(f,'retained',[task],'2026-11-01T00:00:00Z');
 const options={ownerDir:f.owner,now:Date.parse('2026-11-02T00:00:00Z'),alive:()=>false};
 assert.deepEqual((await dev.sweep(options)).removedWorkspaces,[]);
 assert.equal(fs.existsSync(dir),true);
 const expired=await dev.sweep({...options,now:Date.parse('2026-11-09T00:00:00Z')});
 assert.deepEqual(expired.removedWorkspaces,[dir]);
});
