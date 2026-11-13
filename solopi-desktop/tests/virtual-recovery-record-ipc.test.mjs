import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {installAgent}=require('../electron/agent');
const {AgentStore}=require('../electron/agent/store');

test('desktop IPC retries only its saved confirmed conversation and does not access a device',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-recovery-ipc-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const handlers=new Map(),seen=[];
 const virtualControl={acknowledgeVirtualCleanup:id=>{seen.push(id);return true;},request(){assert.fail('must not contact device');}};
 const service=installAgent({ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},directory:()=>dir,
  virtualControl,protect:x=>x,reveal:x=>x,readState:()=>({}),provider:()=>({}),invoke:async()=>({}),saveCase:()=>{}});
 t.after(()=>service.stopAll());
 const store=new AgentStore(()=>path.join(dir,'agent','sessions')),s=store.create();
 s.screenMode='virtual';s.status='failed';s.screenCleanup={confirmed:true};
 s.screenReport={status:'not_tested',reportPath:null,checkpoints:[],recoveryRecordRemovalFailed:true};store.save(s);
 const sender=new EventEmitter();sender.isDestroyed=()=>false;sender.isCrashed=()=>false;sender.send=()=>{};
 const handler=handlers.get('agent:virtual-forget-recovery');assert.equal(typeof handler,'function');
 const result=await handler({sender},{id:s.id});
 assert.equal(result.session.screenCleanup.confirmed,true);
 assert.equal(result.session.screenReport.recoveryRecordRemovalFailed,undefined);
 assert.deepEqual(seen,[s.id]);
 const second=await handler({sender},{id:s.id});assert.equal(second.success,false);assert.deepEqual(seen,[s.id]);
});
