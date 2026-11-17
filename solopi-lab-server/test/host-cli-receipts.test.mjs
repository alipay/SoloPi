import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {loadHostCapabilities} from '../src/superagent-host-capabilities.mjs';
const {executeOperation}=createRequire(import.meta.url)('../src/desktop-agent/operation-receipts.js');
function setup(t,observationMs=8000){
 const dir=mkdtempSync(join(tmpdir(),'host-receipts-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 writeFileSync(join(dir,'host-capabilities.json'),JSON.stringify({programs:{fixture:{command:process.execPath}}}));
 const caps=loadHostCapabilities(dir,{observationMs}),session={};
 return {dir,workspace:caps.workspace,session,run:(name,args,id,scope='same-request')=>{
  const tool=caps.tools.find(t=>t.name===name);
  return executeOperation({session,save:()=>{},scope,tool,args,context:{operationId:id,conversationId:'conversation'}});
 }};
}
test('same argv reads current state; exact call replay retains its original receipt',async t=>{
 const f=setup(t),file=join(f.workspace,'body.txt');writeFileSync(file,'version-one');
 const args={program:'fixture',args:['-e','console.log(require("node:fs").readFileSync("body.txt","utf8"))']};
 const first=await f.run('start_host_cli',args,'one');writeFileSync(file,'version-two');
 assert.match((await f.run('start_host_cli',args,'two')).output,/version-two/);
 const replay=await f.run('start_host_cli',args,'one');assert.equal(replay.reused,true);assert.match(replay.output,/version-one/);
});
test('same update path and argv publishes changed bytes; compose also rereads current files',async t=>{
 const f=setup(t);writeFileSync(join(f.workspace,'input.txt'),'old');
 const compose={path:'report.txt',parts:[{file:'input.txt'}]};
 await f.run('compose_work_file',compose,'compose-one');
 const args={program:'fixture',args:['-e','require("node:fs").copyFileSync("report.txt","published.txt")']};
 await f.run('start_host_cli',args,'publish-one');writeFileSync(join(f.workspace,'input.txt'),'new');
 await f.run('compose_work_file',compose,'compose-two');await f.run('start_host_cli',args,'publish-two');
 assert.equal(readFileSync(join(f.workspace,'published.txt'),'utf8'),'new');
});
test('running identical command is not resubmitted; query reconciles its original operation',async t=>{
 const f=setup(t,1),args={program:'fixture',args:['-e','setTimeout(()=>console.log("done"),70)']};
 const first=await f.run('start_host_cli',args,'first');assert.equal(first.status,'running');
 const second=await f.run('start_host_cli',args,'second','different-request');assert.equal(second.operationId,'first');assert.equal(second.reused,true);
 let result;for(let i=0;i<100;i++){result=await f.run('read_host_operation',{operationId:'first'},'query-'+i);if(result.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(result.status,'succeeded');assert.equal(f.session.operationReceipts[0].result.status,'succeeded');
 assert.equal(f.session.operationReceipts.length,1);
});
test('unknown command outcome still blocks a different call and request',async t=>{
 const f=setup(t),args={program:'fixture',args:['-e','console.log("one")']};
 await f.run('start_host_cli',args,'first');f.session.operationReceipts[0].status='unknown';
 const second=await f.run('start_host_cli',args,'second');assert.equal(second.code,'OPERATION_OUTCOME_UNKNOWN');assert.equal(second.lookupTaskId,'first');assert.equal(f.session.operationReceipts.length,1);
});

test('writing an earlier file version again restores its bytes instead of reusing its obsolete write receipt',async t=>{
 const f=setup(t);
 await f.run('write_work_file',{path:'report.txt',content:'one'},'one');
 await f.run('write_work_file',{path:'report.txt',content:'two'},'two');
 const restored=await f.run('write_work_file',{path:'report.txt',content:'one'},'restore');
 assert.equal(readFileSync(join(f.workspace,'report.txt'),'utf8'),'one');assert.equal(restored.reused,undefined);
});

test('workspace-local timing helper runs through the configured eval entry with filesystem permission enabled',async t=>{
 const {realpathSync,mkdirSync}=await import('node:fs');
 const dir=mkdtempSync(join(tmpdir(),'host-helper-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const workspace=join(realpathSync(dir),'work');mkdirSync(workspace);
 writeFileSync(join(dir,'host-capabilities.json'),JSON.stringify({programs:{node:{command:process.execPath,args:['--permission','--allow-fs-read='+workspace,'--allow-fs-write='+workspace],argumentPolicy:{length:2,prefix:['-e']}}}}));
 const caps=loadHostCapabilities(dir),call=(name,args)=>caps.tools.find(t=>t.name===name).execute(args,{operationId:name,conversationId:'fixture'});
 const content='exports.summarize=x=>({durationMs:Date.parse(x.finishedAt)-Date.parse(x.startedAt)});';
 const written=await call('write_work_file',{path:'receipt-timing.cjs',content});
 const {createHash}=await import('node:crypto');assert.equal(written.sha256,createHash('sha256').update(content).digest('hex'));
 writeFileSync(join(workspace,'timing.json'),JSON.stringify({startedAt:'2026-11-16T00:00:00Z',finishedAt:'2026-11-16T00:00:10Z'}));
 const r=await call('start_host_cli',{program:'node',args:['-e',"const fs=require('node:fs');const t=require('./receipt-timing.cjs');console.log(JSON.stringify(t.summarize(JSON.parse(fs.readFileSync('timing.json','utf8')))));"]});
 assert.equal(r.status,'succeeded');assert.equal(JSON.parse(r.output).durationMs,10000);
});
