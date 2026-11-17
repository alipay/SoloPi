import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {EventEmitter} from 'node:events';
const require=createRequire(import.meta.url);
test('upstream request settings persist per-model policy and run real paired comparison through IPC without executing tools',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'request-settings-ipc-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const factory=require('../electron/agent/desktop-runtime'),original=factory.createDesktopRuntime;
 const runtime={active:new Map(),lastRequest:new Map(),stopAll:async()=>{},disconnect(){}};let options;
 factory.createDesktopRuntime=o=>(options=o,runtime);const modulePath=require.resolve('../electron/agent/index');delete require.cache[modulePath];
 const {installAgent}=require(modulePath);factory.createDesktopRuntime=original;t.after(()=>{delete require.cache[modulePath];factory.createDesktopRuntime=original;});
 const handlers=new Map(),calls=[];const selected={id:'fixture',model:'fixture-model',baseUrl:'https://model.example.test/v1'};
 const state={llmProviders:[selected],selectedLlmProviderId:selected.id};
 const agent=installAgent({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},directory:()=>dir,invoke:async()=>{throw Error('No device/tool dispatch allowed');},readState:()=>state,saveCase:async()=>{},provider:async()=>selected,protect:x=>x,reveal:x=>x,getMirrorTargets:()=>[],saveConfiguration:async()=>({success:true}),model:async input=>{calls.push(input);return {content:'fixture reply'};}});t.after(()=>agent.stopAll());
 const sender=Object.assign(new EventEmitter(),{id:17,isDestroyed:()=>false,isCrashed:()=>false,send(){}}),event={sender};
 const call=(action,args={})=>handlers.get('agent:'+action)(event,args);
 const initial=await call('request-policy');assert.equal(typeof initial.policy.stream,'boolean');
 const saved=await call('save-request-policy',{policy:{...initial.policy,stream:false,firstResponseSeconds:12,conversationReasoning:'low'}});assert.equal(saved.success,true,saved.error);
 assert.equal((await call('request-policy')).policy.firstResponseSeconds,12);assert.equal((await options.provider()).requestPolicy.stream,false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'agent/conversation-overrides.json'))).fixture,'low');
 runtime.lastRequest.set('session',{provider:selected,messages:[{role:'user',content:'synthetic input'}],tools:[]});
 const started=await call('compare-model',{id:'session',pairs:1});assert.equal(started.success,true,started.error);
 let report;for(let i=0;i<100;i++){report=(await call('comparison',{id:'session'})).report;if(report?.status==='completed')break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(report.status,'completed');assert.equal(report.rows.length,2);assert.deepEqual(calls.map(x=>x.stream),[true,false]);assert.ok(calls.every(x=>x.retry===false&&x.purpose==='comparison'));assert.deepEqual(await call('stop-comparison',{id:'session'}),{success:true});
});
