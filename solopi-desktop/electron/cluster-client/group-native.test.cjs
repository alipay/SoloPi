'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {GroupNative}=require('./group-native.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
test('native identity survives reopen, execution uncertainty never invokes run again, forged bindings rejected',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'native-group-restart-'));let calls=0;const host={prepare:async()=>{},run:async()=>{calls++;throw Error('after execution report interrupted');},recover:async()=>null,stop:async()=>{}};let n;
 try{n=new GroupNative({directory,host});const requestId=randomUUID(),payload={cases:[{id:'fixture'}]};const ids=await n.prepare(requestId,payload),rec={...ids,payload,groupExecutionId:randomUUID()};await assert.rejects(n.execute(rec),/report interrupted/);n.close();
 n=new GroupNative({directory,host});assert.deepEqual(await n.prepare(requestId,payload),ids);await assert.rejects(n.execute(rec),e=>e.code==='GROUP_RECONCILIATION_REQUIRED');assert.equal(calls,1);
 await assert.rejects(n.execute({...rec,taskId:randomUUID()}),e=>e.code==='GROUP_EXECUTION_CONFLICT');await assert.rejects(n.execute({...rec,groupExecutionId:randomUUID()}),e=>e.code==='GROUP_EXECUTION_CONFLICT');
 host.recover=async()=>({taskId:ids.taskId,terminal:true,resourcesReleased:true,outcome:'succeeded'});assert.equal((await n.recover(rec)).outcome,'succeeded');n.close();n=new GroupNative({directory,host});host.recover=async()=>{throw Error('should use persisted receipt');};assert.equal((await n.recover(rec)).taskId,ids.taskId);assert.equal(calls,1);
 }finally{n?.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('Main actual factory uses the existing admitted native queue, never public submit or a second gate',async()=>{
 const vm=require('node:vm');const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');const block=source.slice(source.indexOf('let desktopConnection;'),source.indexOf("ipcMain.handle('cluster-connection:api'"));let options,factoryOptions,preparedTask,runPayload,borrowed;
 const ctx={path,process:{},app:{getPath:()=>'/isolated',getVersion:()=> 'fixture'},runAdb(){},parseAdbDevices(){},agentService:{remoteExecutor(){}},workflowExecutionGate:{acquire(){throw Error('must not reacquire');}},createWorkflowTaskRecord:(_p,_c,id)=>({id}),persistWorkflowTaskRecord:t=>{preparedTask=t;},enqueueWorkflowTaskExecution:async(p,_o,lease)=>{runPayload=p;borrowed=lease;lease.release();return {success:true};},stopWorkflowTaskById:async id=>({taskId:id}),require:name=>{
  if(name.endsWith('desktop-service.cjs'))return{DesktopConnection:class{constructor(x){options=x;}}};
  if(name.endsWith('device-snapshot.cjs'))return{androidDiscovery:()=>()=>[]};
  if(name.endsWith('group-native.cjs'))return{GroupNative:class{constructor(x){factoryOptions=x;}}};
  if(name.endsWith('group-service.cjs'))return{GroupService:class{constructor(x){this.options=x;}}};
  throw Error(name);
 }};
 vm.runInNewContext(block+';getDesktopConnection();globalThis.seedAuthority=(id,value)=>groupNativeAuthorities.set(id,value);',ctx);options.groupServiceFactory({directory:'/isolated/groups',clientId:'fixture-client'});const ids={requestId:randomUUID(),taskId:randomUUID(),payload:{cases:[]}};assert.throws(()=>factoryOptions.host.prepare(ids),e=>e.code==='GROUP_AUTHORIZATION_REQUIRED');
 ctx.seedAuthority('fixture-client',{native:()=>({cases:[],configuration:{components:[],caseEdges:{}}}),records:new Map([[ids.requestId,{plans:{context:()=>({platformContext:{webContents:{fixture:true}}})},ctx:{}}]])});
 await factoryOptions.host.prepare(ids);assert.equal(preparedTask.id,ids.taskId);assert.equal(preparedTask.status,'prepared');
 const r=await factoryOptions.host.run({...ids,nativePayload:{cases:[],taskId:'forged'}});assert.equal(runPayload.taskId,ids.taskId);assert.equal(r.taskId,ids.taskId);assert.equal(r.resourcesReleased,true);assert.equal(typeof borrowed.release,'function');assert.equal(await factoryOptions.host.recover(ids),null);
});
test('native prepare failure preserves allocation and retries only record preparation, not execution',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'native-group-prepare-'));let first=true,seen=[];const host={prepare:async r=>{seen.push(r.taskId);if(first){first=false;throw Error('record flush failed');}},run:async()=>{throw Error('not authorized');},recover:async()=>null,stop:async()=>{}};const n=new GroupNative({directory,host});
 try{const id=randomUUID(),payload={cases:[]};await assert.rejects(n.prepare(id,payload),/record flush failed/);const recovered=await n.prepare(id,payload);assert.deepEqual(seen,[recovered.taskId,recovered.taskId]);assert.equal(n.db.prepare('SELECT phase FROM native_group_request').get().phase,'prepared');}finally{n.close();fs.rmSync(directory,{recursive:true,force:true});}
});
