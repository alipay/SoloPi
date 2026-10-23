import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createSoloPiRecording}=require('../electron/solopi-recording');
const {createWorkflowExecutionGate}=require('../electron/workflow-execution-gate');
function fixture(t,execute,extra={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'record-recovery-'));t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
 fs.writeFileSync(path.join(dir,'solopi-recording.json'),JSON.stringify({sessions:[{id:'stale',serial:'phone',name:'Fixture',providerName:'desktop-stale',targetPackage:'org.example',sessionId:'old-phone-id',state:'recovery-required',finished:false}]}));
 const gate=createWorkflowExecutionGate(),cancelled=[];
 const service=createSoloPiRecording({directory:()=>dir,gate,provider:{execute,cancelPending:id=>cancelled.push(id)},...extra});
 service.current();return{service,gate,cancelled,dir};
}
const status=(sessionId,state='recording')=>({success:true,kind:'recording',sessionId,active:state==='recording',state,caseName:'desktop-stale',targetPackage:'org.example'});
for(const [id,state] of [['old-phone-id','failed'],['old-phone-id','stopped'],['foreign','recording'],['','idle']])test(`discard revalidates known session ${id}/${state}, never stops unrelated/inactive sessions and frees lease`,async t=>{
 const calls=[];const f=fixture(t,async(_entry,command)=>{calls.push(command);return status(id,state);});
 await f.service.discard('stale');assert.deepEqual(calls,id==='old-phone-id'?['record-status','record-release']:['record-status']);assert.equal(f.service.current().sessions.length,0);
 f.gate.acquire({reservedDeviceSerials:['phone']}).release();
 assert.equal(fs.readdirSync(path.join(f.dir,'solopi-recording-history')).length,1);
});
test('owned active session is stopped before discard, other device leases remain held',async t=>{
 const calls=[];const f=fixture(t,async(_entry,command)=>{calls.push(command);return status('old-phone-id',command==='record-stop'?'stopped':'recording');});
 const other=f.gate.acquire({reservedDeviceSerials:['other']});await f.service.discard('stale');assert.deepEqual(calls,['record-status','record-stop','record-release']);
 assert.throws(()=>f.gate.acquire({reservedDeviceSerials:['other']}),{code:'TEST_TASK_BUSY'});other.release();
});
test('discard interrupts a stuck stop only for this entry and late completion cannot recreate it',async t=>{
 let resolveStop,started;const ready=new Promise(r=>started=r);
 const f=fixture(t,async(_entry,command)=>{if(command==='record-stop'){started();return new Promise(r=>resolveStop=r);}return status('foreign');});
 const stopped=f.service.stop('stale');const rejected=assert.rejects(stopped,/取消/);await ready;
 await f.service.discard('stale');await rejected;assert.deepEqual(f.cancelled,['stale']);assert.equal(f.service.current().sessions.length,0);
 resolveStop(status('old-phone-id','stopped'));await new Promise(setImmediate);assert.equal(f.service.current().sessions.length,0);
});
test('unresponsive status has a bounded deadline; explicit discard archives uncertainty and unblocks local entry',async t=>{
 const f=fixture(t,async()=>new Promise(()=>{}),{operationTimeoutMs:20});
 const result=await f.service.discard('stale');assert.match(result.warning,/未能确认手机/);assert.equal(f.service.current().sessions.length,0);
 assert.deepEqual(f.cancelled,['stale']);f.gate.acquire({reservedDeviceSerials:['phone']}).release();
});

test('permission preflight rejection releases the recording lease and preserves structured popup details',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'permission-preflight-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const gate=createWorkflowExecutionGate();const permissionCheck={root:false,missing:[{key:'float',label:'悬浮窗',action:'允许悬浮窗'}]};
 const service=createSoloPiRecording({directory:()=>dir,gate,provider:{execute:async()=>{throw Object.assign(Error('权限未就绪'),{code:'SOLOPI_PERMISSIONS_REQUIRED',notDispatched:true,permissionCheck});}}});
 await assert.rejects(service.start({serial:'phone',targetPackage:'org.example',name:'Fragment',startMode:'command-prepared',preparationShell:'am start example'}),error=>error.permissionCheck===permissionCheck);
 assert.deepEqual(service.current().sessions,[]);gate.acquire({reservedDeviceSerials:['phone']}).release();
});

test('permission override is a validated transient start option, never a saved default',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'permission-override-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const seen=[];const service=createSoloPiRecording({directory:()=>dir,gate:createWorkflowExecutionGate(),provider:{execute:async(entry)=>{seen.push(entry.skipPermissionPrecheck);return {success:true,caseName:entry.providerName,targetPackage:entry.targetPackage,sessionId:'owned',state:'recording'};}}});
 const input={serial:'one',name:'Fixture',targetPackage:'org.example'};
 await assert.rejects(service.start({...input,skipPermissionPrecheck:'false'}),/权限预检选项无效/);assert.deepEqual(seen,[]);
 await service.start({...input,skipPermissionPrecheck:true});await service.start({...input,serial:'two'});
 assert.deepEqual(seen,[true,false]);assert.equal(fs.readFileSync(path.join(dir,'solopi-recording.json'),'utf8').includes('skipPermissionPrecheck'),false);
});

test('stop caches export durably before releasing phone; reread after restart needs no companion and clears old preparation error',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'record-release-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const calls=[];let released=false;
 const provider={execute:async(e,command)=>{
  calls.push(command);if(released)throw Error('companion stopped');
  if(command==='record-start')return{success:true,state:'recording',sessionId:'ours',caseName:e.providerName,targetPackage:e.targetPackage};
  if(command==='record-stop')return{success:true,state:'stopped',sessionId:'ours'};
  if(command==='case-get')return{success:true,case:{caseName:e.providerName,targetAppPackage:e.targetPackage,operationLog:{steps:[{operationMethod:{actionEnum:'BACK',operationParam:{}}}]}}};
  if(command==='record-release'){assert.ok(JSON.parse(fs.readFileSync(path.join(dir,'solopi-recording.json'))).sessions[0].exportedCase);released=true;return{success:true,released:true};}
 }};
 const options={directory:()=>dir,gate:createWorkflowExecutionGate(),provider};const service=createSoloPiRecording(options);
 const session=await service.start({serial:'phone',name:'Fixture',targetPackage:'org.example'});
 const result=await service.stop(session.id);assert.equal(result.testCase.name,'Fixture');
 assert.deepEqual(calls,['record-start','record-stop','case-get','record-release']);
 const restored=createSoloPiRecording({...options,gate:createWorkflowExecutionGate()});assert.equal((await restored.stop(session.id)).testCase.name,'Fixture');
 await restored.discard(session.id);assert.equal(calls.length,4);
});
