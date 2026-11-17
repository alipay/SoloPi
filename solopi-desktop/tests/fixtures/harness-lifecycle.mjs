import assert from 'node:assert/strict';
// Native agent.whenIdle keeps the turn open while awaiting approval. Tests may
// inspect that boundary without claiming the turn has completed.
export async function boundary(runtime){
 for(let i=0;i<1000;i++){
  if(runtime.approvals?.size)return;
  if(!runtime.active.size&&!runtime.creating?.size){await new Promise(r=>setImmediate(r));if(!runtime.active.size&&!runtime.creating?.size)return;}
  await new Promise(r=>setTimeout(r,5));
 }
 assert.fail('native runtime did not reach idle or an approval boundary');
}
export async function close(runtime,cleanup){await runtime.stopAll();cleanup?.();}
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {HarnessRuntime}=require('../../electron/agent/harness-runtime');
const runtimes=new Set();
export class NativeRuntime extends HarnessRuntime{
 constructor(options){super(options);runtimes.add(this);}
 start(id,text,context={},attachments=[]){return super.start(id,text,context,attachments);}
}
export async function disposeAll(){for(const runtime of runtimes)await runtime.stopAll();runtimes.clear();}
