import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
import {LlmAdapter,resolveRetryPolicy,LlmError} from '@deepseek-ai/dsh-llm';
import {NativeRuntime,boundary} from './harness-lifecycle.mjs';
const require=createRequire(import.meta.url),{AgentStore}=require('../../electron/agent/store');
export {LlmError,boundary};
export const toolCall=(name,args={},id=name)=>({type:'tool-call',id,name,arguments:typeof args==='string'?args:JSON.stringify(args)});
export class NativeScript extends LlmAdapter{
 constructor(steps,{retryPolicy}={}){super();this.steps=steps;this.requests=[];this.policy=retryPolicy;}
 providerRetryPolicy(){return this.policy?resolveRetryPolicy(this.policy,'fixture'):undefined;}
 async *stream(options){this.requests.push(options);const step=this.steps.shift();if(!step)throw new LlmError('Fixture exhausted','AUTH');const output=await step(options,this);if(output?.[Symbol.asyncIterator]){yield* output;return;}const blocks=Array.isArray(output)?output:[{type:'text',text:output}];for(const[index,block]of blocks.entries()){yield{type:'block-start',index,blockType:block.type};yield{type:'block-end',index,block};}yield{type:'finish',reason:blocks.some(b=>b.type==='tool-call')?'tool-calls':'stop'};}
}
export function nativeFixture(t,steps,tools=[],options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-contract-')),store=new AgentStore(()=>dir),s=store.create();s.approvalMode='auto';store.save(s);
 const adapter=new NativeScript(steps,options),runtime=new NativeRuntime({store,provider:()=>({model:'fixture',maxOutputTokens:16384,contextWindowTokens:262144}),tools:async()=>tools,adapter,...options});
 t.after(async()=>{await runtime.stopAll();fs.rmSync(dir,{recursive:true,force:true});});
 return{dir,store,s,runtime,adapter,async run(text='verify'){await runtime.start(s.id,text,{});await boundary(runtime);return store.get(s.id);}};
}
